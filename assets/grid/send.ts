import { isRecord } from './json';

/**
 * L'envoi d'une journée sur Jira, tel que le serveur l'a enregistré (src/Sending/SendView.php) :
 * il se déduit de la base, jamais de la mémoire du navigateur, et survit à un rechargement.
 */
export type SendState = 'nothing' | 'unsent' | 'sending' | 'sent' | 'modified' | 'partial' | 'unverified' | 'failed';

/** Pourquoi un ticket n'est pas arrivé dans Jira (src/Sending/TicketFailure.php). */
export type TicketFailure =
    | 'closed'
    | 'rejected'
    | 'not_found'
    | 'unreachable'
    | 'throttled'
    | 'mismatch'
    | 'unverified'
    | 'unanswered'
    | 'token_refused';

/** Ce qui a tout arrêté : Jira muet, ou le jeton refusé. */
export type SendFailure = 'unreachable' | 'refused' | 'missing_scope';

/** Un instant, dans le fuseau de l'utilisateur. */
export interface SendMoment {
    /** « AAAA-MM-JJ ». */
    readonly date: string;
    /** « HH:MM ». */
    readonly time: string;
}

export interface SendStatus {
    readonly state: SendState;
    /** Le dernier envoi que Jira, relu, a confirmé en entier. */
    readonly sentAt: SendMoment | null;
    /** Le dernier essai, quand il n'a pas tout envoyé. */
    readonly attemptedAt: SendMoment | null;
    readonly failure: SendFailure | null;
    /** Ce que le dernier essai a donné, ticket par ticket : null pour un ticket arrivé. */
    readonly outcomes: ReadonlyMap<string, TicketFailure | null>;
    /**
     * Les tickets retirés de la journée : dont Jira a peut-être encore des heures, que le
     * renvoi retire ; une journée envoyée, ceux que son dernier envoi a retirés de Jira.
     */
    readonly removed: readonly string[];
    /** Ce que la relecture a trouvé dans Jira, en minutes, sur un ticket qui n'y est pas arrivé tel quel. */
    readonly inJira: ReadonlyMap<string, number>;
}

export const NOTHING_SENT: SendStatus = {
    state: 'nothing',
    sentAt: null,
    attemptedAt: null,
    failure: null,
    outcomes: new Map(),
    removed: [],
    inJira: new Map(),
};

const STATES: readonly string[] = [
    'nothing',
    'unsent',
    'sending',
    'sent',
    'modified',
    'partial',
    'unverified',
    'failed',
] satisfies SendState[];
const TICKET_FAILURES: readonly string[] = [
    'closed',
    'rejected',
    'not_found',
    'unreachable',
    'throttled',
    'mismatch',
    'unverified',
    'unanswered',
    'token_refused',
] satisfies TicketFailure[];
const FAILURES: readonly string[] = ['unreachable', 'refused', 'missing_scope'] satisfies SendFailure[];

/** Une réponse qui n'en a pas la forme lève : l'écran n'affiche rien plutôt qu'un état de travers. */
export function readSend(json: unknown): SendStatus {
    if (!isRecord(json) || typeof json.state !== 'string' || !STATES.includes(json.state)) {
        throw new TypeError('La journée ne dit pas où en est son envoi.');
    }
    if (json.failure !== null && (typeof json.failure !== 'string' || !FAILURES.includes(json.failure))) {
        throw new TypeError("L'envoi a échoué sans dire pourquoi.");
    }
    // Le sérialiseur du serveur rend un objet vide en tableau vide.
    const read = Array.isArray(json.outcomes) && json.outcomes.length === 0 ? {} : json.outcomes;
    const held = Array.isArray(json.inJira) && json.inJira.length === 0 ? {} : json.inJira;
    if (!isRecord(read) || !isRecord(held) || !Array.isArray(json.removed)) {
        throw new TypeError("L'envoi ne dit pas ce qu'il a donné.");
    }

    const outcomes = new Map<string, TicketFailure | null>();
    for (const [ticket, outcome] of Object.entries(read)) {
        if (outcome !== null && (typeof outcome !== 'string' || !TICKET_FAILURES.includes(outcome))) {
            throw new TypeError(`L'envoi ne dit pas ce qu'est devenu ${ticket}.`);
        }
        outcomes.set(ticket, outcome as TicketFailure | null);
    }
    const removed = json.removed.map((ticket: unknown) => {
        if (typeof ticket !== 'string') {
            throw new TypeError("Un ticket retiré n'a pas d'identifiant.");
        }

        return ticket;
    });
    const inJira = new Map<string, number>();
    for (const [ticket, minutes] of Object.entries(held)) {
        if (typeof minutes !== 'number') {
            throw new TypeError(`L'envoi ne dit pas ce que Jira a gardé de ${ticket}.`);
        }
        inJira.set(ticket, minutes);
    }

    return {
        state: json.state as SendState,
        sentAt: readMoment(json.sentAt),
        attemptedAt: readMoment(json.attemptedAt),
        failure: json.failure as SendFailure | null,
        outcomes,
        removed,
        inJira,
    };
}

function readMoment(json: unknown): SendMoment | null {
    if (json === null) {
        return null;
    }
    if (
        !isRecord(json) ||
        typeof json.date !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(json.date) ||
        typeof json.time !== 'string' ||
        !/^\d{2}:\d{2}$/.test(json.time)
    ) {
        throw new TypeError("L'heure d'un envoi ne se lit pas.");
    }

    return { date: json.date, time: json.time };
}
