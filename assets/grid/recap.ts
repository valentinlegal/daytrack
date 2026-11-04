import type { Grid } from './grid';

/**
 * Le récapitulatif d'une journée : un ticket par carte, du plus long au plus court, avec
 * chacun de ses commentaires et le temps qu'il a pris. Les pauses n'y entrent pas.
 *
 * À durée égale, un ticket garde sa place dans la journée : le premier saisi passe
 * devant. Deux blocs du même ticket au même commentaire n'en font qu'une ligne.
 */
export interface RecapTicket {
    readonly ticket: string;
    /** Le temps passé sur le ticket, en minutes. */
    readonly minutes: number;
    readonly comments: readonly RecapComment[];
}

export interface RecapComment {
    readonly text: string;
    readonly minutes: number;
}

export function recap(grid: Grid): RecapTicket[] {
    const tickets = new Map<string, { minutes: number; comments: Map<string, number> }>();
    for (const { start, end, content } of grid.blocks()) {
        if (content.kind !== 'work') {
            continue;
        }
        const entry = tickets.get(content.ticket) ?? { minutes: 0, comments: new Map<string, number>() };
        entry.minutes += end - start;
        if (content.comment !== null) {
            entry.comments.set(content.comment, (entry.comments.get(content.comment) ?? 0) + end - start);
        }
        tickets.set(content.ticket, entry);
    }

    // Le tri de JavaScript est stable : à durée égale, l'ordre de la journée reste.
    return [...tickets]
        .map(([ticket, { minutes, comments }]) => ({
            ticket,
            minutes,
            comments: [...comments].map(([text, commentMinutes]) => ({ text, minutes: commentMinutes })),
        }))
        .sort((a, b) => b.minutes - a.minutes);
}
