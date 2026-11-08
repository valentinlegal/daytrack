import { isRecord } from './grid/json';

/**
 * Parler au serveur de DayTrack : chaque API de l'écran — journées, favoris, réglages,
 * Jira, calendrier, version, reprise de la v1 — passe par ici, pour envoyer sa requête,
 * lire sa réponse et rendre un refus champ par champ.
 */

/** Une saisie refusée, champ par champ (src/EventListener/ApiErrorListener.php). */
export interface Violation {
    readonly field: string;
    readonly message: string;
}

/** Une règle refuse le geste : rien n'est écrit (422). Chaque motif nomme le champ qu'il vise. */
export interface Refused {
    readonly status: 'invalid';
    readonly violations: readonly Violation[];
}

/**
 * Ce que dit un enregistrement que le serveur n'a pas pris : sous ce qu'il visait dans une
 * fenêtre ou une carte, dans le message en bas de la grille pour un geste de la grille.
 */
export const UNSAVED = "L'enregistrement n'a pas abouti. Réessayez.";

/** Ce que dit un refus quand l'écran n'a qu'une place pour le dire : le premier motif du serveur, ou l'échec. */
export function firstRefusal(violations: readonly Violation[]): string {
    return violations[0]?.message ?? UNSAVED;
}

/** Les méthodes de l'API : GET lit sans rien écrire, les autres écrivent. */
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Comment lire la réponse, statut par statut. Le lecteur reçoit le corps JSON (null pour
 * un 204, qui n'en a pas), et lève sur un corps qui n'a pas la forme attendue.
 */
export type Readers<T> = Readonly<Partial<Record<number, (body: unknown) => T>>>;

export interface Sent {
    /** Le corps, envoyé en JSON. */
    readonly body?: unknown;
    /**
     * La requête arrive même si la page se ferme pendant qu'elle part : une fenêtre qui
     * s'enregistre au moment où l'on quitte la page. Le navigateur refuse une telle requête
     * au-delà de 64 Kio : une plus grosse — annuler l'effacement d'une journée aux longs
     * commentaires — part comme les autres.
     */
    readonly keepalive?: boolean;
}

export interface ServerApi {
    /**
     * Envoie la requête et lit sa réponse par le lecteur de son statut. Un statut sans
     * lecteur, une panne du réseau, un corps illisible ou de travers lèvent : l'appelant
     * relit plutôt que de croire ce qu'il a envoyé.
     */
    request<T>(method: Method, target: string, readers: Readers<T>, sent?: Sent): Promise<T>;
    /** Lit une ressource que le serveur rend en 200 ; tout autre statut lève. */
    read<T>(target: string, reader: (body: unknown) => T): Promise<T>;
}

/** Ce qu'une requête qui survit à la page peut porter (norme fetch, « keepalive »). */
const KEEPALIVE_LIMIT = 64 * 1024;

export function serverApi(fetcher: typeof fetch = (input, init) => fetch(input, init)): ServerApi {
    async function request<T>(method: Method, target: string, readers: Readers<T>, sent: Sent = {}): Promise<T> {
        const init: RequestInit = {
            method,
            // Une écriture est du JSON même sans corps : le serveur refuse le reste
            // (src/EventListener/SameOriginGuard.php).
            headers:
                method === 'GET'
                    ? { Accept: 'application/json' }
                    : { Accept: 'application/json', 'Content-Type': 'application/json' },
        };
        if (sent.body !== undefined) {
            const json = JSON.stringify(sent.body);
            init.body = json;
            if (sent.keepalive === true) {
                init.keepalive = new TextEncoder().encode(json).length <= KEEPALIVE_LIMIT;
            }
        }
        const response = await fetcher(target, init);
        const read = readers[response.status];
        if (read === undefined) {
            throw new Error(`L'API a répondu ${String(response.status)} à ${method} ${target}.`);
        }

        return read(await bodyOf(response, `${method} ${target}`));
    }

    return {
        request,
        read: (target, reader) => request('GET', target, { 200: reader }),
    };
}

/** Le lecteur d'un refus (422) : ses motifs, champ par champ. */
export function refused(body: unknown): Refused {
    const violations = isRecord(body) ? body.violations : undefined;
    if (!Array.isArray(violations)) {
        throw new TypeError("L'API refuse le geste sans dire pourquoi.");
    }

    return {
        status: 'invalid',
        violations: violations.map((violation: unknown) => {
            if (!isRecord(violation) || typeof violation.field !== 'string' || typeof violation.message !== 'string') {
                throw new TypeError("L'API refuse le geste sans dire pourquoi.");
            }

            return { field: violation.field, message: violation.message };
        }),
    };
}

/** Le corps JSON d'une réponse attendue ; un 204 n'en a pas. */
async function bodyOf(response: Response, request: string): Promise<unknown> {
    if (response.status === 204) {
        return null;
    }
    try {
        return await response.json();
    } catch {
        throw new TypeError(`L'API a répondu ${String(response.status)} à ${request} sans JSON lisible.`);
    }
}
