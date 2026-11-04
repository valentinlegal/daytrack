import type { SlotChange } from '../grid/changes';
import { readDay } from '../grid/day';
import type { DayApi, SendResult, Violation, WriteResult } from '../grid/daySession';
import { isRecord } from '../grid/json';
import { type TicketInfo, ticketsOf } from '../jira/ticketInfo';

/** Ce qu'une requête qui survit à la page peut porter (norme fetch, « keepalive »). */
const KEEPALIVE_LIMIT = 64 * 1024;

/**
 * L'API des journées (src/Controller/Api/DayController.php), vue du moteur.
 *
 * Une réponse inattendue — panne du réseau, erreur du serveur, corps illisible —
 * lève : le moteur relit alors la journée plutôt que de croire ce qu'il a envoyé.
 *
 * Une journée décrit aussi ses tickets, leur titre et leur type venus de Jira : ils vont
 * à qui les affiche (onTickets), jamais au moteur, qui n'en a pas besoin.
 */
export function httpDayApi(
    fetcher: typeof fetch = (input, init) => fetch(input, init),
    onTickets: (tickets: Record<string, TicketInfo>) => void = () => undefined,
): DayApi {
    const url = (date: string, path = ''): string => `/api/days/${encodeURIComponent(date)}${path}`;

    async function write(method: 'PATCH' | 'PUT', target: string, body: unknown): Promise<WriteResult> {
        const sent = JSON.stringify(body);
        const response = await fetcher(target, {
            method,
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: sent,
            // Une fenêtre qui s'enregistre au moment où l'on quitte la page arrive quand
            // même. Le navigateur refuse une telle requête au-delà de 64 Kio : une plus
            // grosse — annuler l'effacement d'une journée aux longs commentaires — part
            // comme les autres.
            keepalive: new TextEncoder().encode(sent).length <= KEEPALIVE_LIMIT,
        });
        const json = await bodyOf(response);
        if (response.status === 200) {
            ticketsOf(json, onTickets);

            return { status: 'saved', day: readDay(json) };
        }
        if (response.status === 409 && isRecord(json)) {
            ticketsOf(json.day, onTickets);

            return { status: 'stale', day: readDay(json.day) };
        }
        if (response.status === 422 && isRecord(json)) {
            return { status: 'invalid', violations: readViolations(json.violations) };
        }

        throw new Error(`L'API a répondu ${String(response.status)} à ${method} ${target}.`);
    }

    return {
        async read(date) {
            const response = await fetcher(url(date), { headers: { Accept: 'application/json' } });
            if (response.status !== 200) {
                throw new Error(`L'API a répondu ${String(response.status)} pour le ${date}.`);
            }

            const json = await bodyOf(response);
            ticketsOf(json, onTickets);

            return readDay(json);
        },
        changeSlots(date, version, changes: readonly SlotChange[]) {
            return write('PATCH', url(date, '/slots'), { version, changes });
        },
        setObjective(date, version, objective) {
            return write('PUT', url(date, '/objective'), { version, objective });
        },
        async send(date, version): Promise<SendResult> {
            const target = url(date, '/send');
            const response = await fetcher(target, {
                method: 'POST',
                headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({ version }),
            });
            const json = await bodyOf(response);
            if (response.status === 200) {
                ticketsOf(json, onTickets);

                return { status: 'done', day: readDay(json) };
            }
            if (
                response.status === 409 &&
                isRecord(json) &&
                (json.error === 'stale' || json.error === 'sending' || json.error === 'nothing')
            ) {
                ticketsOf(json.day, onTickets);

                return { status: json.error, day: readDay(json.day) };
            }

            throw new Error(`L'API a répondu ${String(response.status)} à POST ${target}.`);
        },
    };
}

/** Le corps JSON d'une réponse, ou null s'il ne se lit pas. */
export async function bodyOf(response: Response): Promise<unknown> {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

/** Les refus d'une saisie, champ par champ (src/EventListener/ApiErrorListener.php). */
export function readViolations(json: unknown): Violation[] {
    if (!Array.isArray(json)) {
        throw new TypeError("L'API refuse le geste sans dire pourquoi.");
    }

    return json.map((violation: unknown) => {
        if (!isRecord(violation) || typeof violation.field !== 'string' || typeof violation.message !== 'string') {
            throw new TypeError("L'API refuse le geste sans dire pourquoi.");
        }

        return { field: violation.field, message: violation.message };
    });
}
