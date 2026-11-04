import { partTarget } from './entry';
import type { Cell, Grid } from './grid';
import type { Selection } from './selection';

/**
 * Ce que le menu de la sélection propose : ce qui ne servirait à rien est grisé, et le
 * raccourci du même geste ne fait rien non plus.
 *
 * Sur des créneaux vides, seuls « Nouveau ticket… », « Coller » et « Convertir en
 * pause » servent : c'est ainsi qu'on pose une pause sur une plage, comme dans la v1.
 */
export interface SelectionActions {
    /** « Nouveau ticket… » : la sélection exacte, saisie ou non. */
    readonly entry: boolean;
    /** « Modifier la sélection… » : quand toute la sélection porte un seul ticket et un seul commentaire. */
    readonly edit: boolean;
    readonly copy: boolean;
    readonly cut: boolean;
    readonly paste: boolean;
    readonly pause: boolean;
    readonly clear: boolean;
    /** « Ajouter aux favoris » : le ticket, quand la sélection n'en porte qu'un, pauses et vides mis à part. */
    readonly favorite: string | null;
}

export function selectionActions(grid: Grid, selection: Selection, hasClipboard: boolean): SelectionActions {
    const cells = selection.quarters.map((quarter) => grid.at(quarter));
    const filled = cells.some((cell) => cell !== null);

    return {
        entry: cells.length > 0,
        edit: partTarget(grid, selection) !== null,
        copy: filled,
        cut: filled,
        paste: cells.length > 0 && hasClipboard,
        pause: cells.some((cell) => cell?.kind !== 'pause'),
        clear: filled,
        favorite: onlyTicket(cells),
    };
}

function onlyTicket(cells: readonly Cell[]): string | null {
    const tickets = new Set(cells.flatMap((cell) => (cell?.kind === 'work' ? [cell.ticket] : [])));

    return tickets.size === 1 ? ([...tickets][0] ?? null) : null;
}
