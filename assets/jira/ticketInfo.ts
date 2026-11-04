import { isRecord } from '../grid/json';
import { isTint, NO_TINT, type Tint } from '../settings/tints';

/**
 * Ce que DayTrack sait d'un ticket : son titre et son type venus de Jira, et la teinte
 * que les réglages donnent à ce type ; ou rien encore.
 */
export interface TicketInfo {
    readonly title: string | null;
    readonly type: string | null;
    readonly color: Tint | null;
}

/**
 * Les tickets que décrit une réponse — une journée, les favoris, une relecture —, clés en
 * identifiant. Un ticket qui n'en a pas la forme est laissé de côté : un titre manque,
 * l'écran ne casse pas.
 */
export function readTickets(json: unknown): Record<string, TicketInfo> {
    // Une liste vide arrive en tableau : PHP ne distingue pas.
    if (Array.isArray(json) && json.length === 0) {
        return {};
    }
    if (!isRecord(json)) {
        throw new TypeError("L'API ne décrit pas les tickets.");
    }
    const tickets: Record<string, TicketInfo> = {};
    for (const [key, value] of Object.entries(json)) {
        const info = readTicket(value);
        if (info !== null) {
            tickets[key] = info;
        }
    }

    return tickets;
}

export function readTicket(json: unknown): TicketInfo | null {
    if (
        !isRecord(json) ||
        !(json.title === null || typeof json.title === 'string') ||
        !(json.type === null || typeof json.type === 'string')
    ) {
        return null;
    }

    // Une teinte inconnue ne coûte pas le titre : le ticket prend celle d'un type sans teinte.
    return { title: json.title, type: json.type, color: isTint(json.color) ? json.color : null };
}

/** La teinte d'un ticket à l'écran : celle de son type, le gris tant qu'il n'en a pas. */
export function tintOf(info: TicketInfo | undefined): Tint {
    return info?.color ?? NO_TINT;
}

/**
 * Ce qu'une réponse qui porte une journée ou des favoris décrit de leurs tickets, pour
 * qui les affiche. Une description de travers ne fait pas échouer la réponse : seul un
 * titre manque.
 */
export function ticketsOf(json: unknown, learn: (tickets: Record<string, TicketInfo>) => void): void {
    if (!isRecord(json) || json.tickets === undefined) {
        return;
    }
    try {
        learn(readTickets(json.tickets));
    } catch {
        // Les titres attendront la relecture.
    }
}

/**
 * Le type et le titre d'un ticket, comme l'infobulle les dit : « Story, Export CSV des
 * commandes filtrées » ; le titre seul sans type, rien sans titre.
 */
export function describedTicket(info: TicketInfo | undefined): string | null {
    if (info === undefined || info.title === null) {
        return null;
    }

    return info.type === null ? info.title : `${info.type}, ${info.title}`;
}
