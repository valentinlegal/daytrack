import type { SlotChange } from '../grid/changes';
import { type DayState, readDay } from '../grid/day';
import type { DayApi, SendResult, WriteResult } from '../grid/daySession';
import { isRecord } from '../grid/json';
import { type TicketInfo, ticketsOf } from '../jira/ticketInfo';
import { refused, serverApi } from '../serverApi';

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
    fetcher?: typeof fetch,
    onTickets: (tickets: Record<string, TicketInfo>) => void = () => undefined,
): DayApi {
    const server = serverApi(fetcher);
    const url = (date: string, path = ''): string => `/api/days/${encodeURIComponent(date)}${path}`;

    const day = (json: unknown): DayState => {
        ticketsOf(json, onTickets);

        return readDay(json);
    };
    // La journée à jour, que joint un refus (409).
    const dayIn = (json: unknown): DayState => day(isRecord(json) ? json.day : undefined);

    function write(method: 'PATCH' | 'PUT', target: string, body: unknown): Promise<WriteResult> {
        return server.request<WriteResult>(
            method,
            target,
            {
                200: (json) => ({ status: 'saved', day: day(json) }),
                409: (json) => ({ status: 'stale', day: dayIn(json) }),
                422: refused,
            },
            { body, keepalive: true },
        );
    }

    return {
        read: (date) => server.read(url(date), day),
        changeSlots(date, version, changes: readonly SlotChange[]) {
            return write('PATCH', url(date, '/slots'), { version, changes });
        },
        setObjective(date, version, objective) {
            return write('PUT', url(date, '/objective'), { version, objective });
        },
        send(date, version) {
            const target = url(date, '/send');

            return server.request<SendResult>(
                'POST',
                target,
                {
                    200: (json) => ({ status: 'done', day: day(json) }),
                    409: (json) => {
                        const error = isRecord(json) ? json.error : undefined;
                        if (error !== 'stale' && error !== 'sending' && error !== 'nothing') {
                            throw new Error(`L'API a répondu 409 à POST ${target} sans dire pourquoi.`);
                        }

                        return { status: error, day: dayIn(json) };
                    },
                },
                { body: { version } },
            );
        },
    };
}
