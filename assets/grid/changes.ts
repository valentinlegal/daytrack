import { type Cell, sameCell } from './grid';
import * as Quarter from './quarter';

/**
 * Ce qu'un geste change : des quarts d'heure, par leur début, et ce que chacun
 * devient — un contenu, ou null pour le vider.
 *
 * Poser, remplacer en superposant, coller par-dessus, effacer, convertir en pause,
 * annuler, rétablir : tout geste s'écrit ainsi, comme côté serveur.
 */
export type QuarterChanges = ReadonlyMap<number, Cell>;

/** Un créneau tel que l'API l'écrit (src/Api/Input/SlotChangeInput.php). */
export interface SlotChange {
    readonly start: string;
    readonly end: string;
    readonly kind: 'work' | 'pause' | 'empty';
    readonly ticket: string | null;
    readonly comment: string | null;
    /** La récurrence qui le pose, quand annuler ou rétablir la lui rend ; tout autre geste n'en envoie pas. */
    readonly recurrence?: string;
}

/** Chaque quart d'heure nommé prend le même contenu : effacer, convertir en pause, remplir une plage. */
export function fill(quarters: Iterable<number>, content: Cell): QuarterChanges {
    const changes = new Map<number, Cell>();
    for (const quarter of quarters) {
        Quarter.assertQuarter(quarter);
        changes.set(quarter, content);
    }

    return changes;
}

/**
 * Les créneaux à envoyer pour PATCH /api/days/{date}/slots : les quarts d'heure
 * voisins qui prennent le même contenu, regroupés. Deux créneaux ne couvrent jamais
 * le même quart d'heure, et il n'y en a jamais plus que la grille n'a de quarts.
 */
export function toSlotChanges(changes: QuarterChanges): SlotChange[] {
    const quarters = [...changes.keys()].sort((a, b) => a - b);
    const ranges: { start: number; end: number; content: Cell }[] = [];
    for (const quarter of quarters) {
        Quarter.assertQuarter(quarter);
        const content = changes.get(quarter) ?? null;
        const last = ranges.at(-1);
        if (last?.end === quarter && sameCell(last.content, content)) {
            last.end = quarter + Quarter.MINUTES;
        } else {
            ranges.push({ start: quarter, end: quarter + Quarter.MINUTES, content });
        }
    }

    return ranges.map(({ start, end, content }) => ({
        start: Quarter.format(start),
        end: Quarter.format(end),
        kind: content === null ? 'empty' : content.kind,
        ticket: content?.kind === 'work' ? content.ticket : null,
        comment: content?.kind === 'work' ? content.comment : null,
        ...(content?.recurrence == null ? {} : { recurrence: content.recurrence }),
    }));
}
