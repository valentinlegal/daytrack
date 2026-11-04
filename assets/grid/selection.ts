import * as Quarter from './quarter';

/**
 * La sélection de la grille, comme dans un tableur : des quarts d'heure, pas des
 * blocs. Un clic sur un bloc sélectionne le seul quart d'heure cliqué, pour qu'on
 * puisse poser une pause ou un autre ticket au milieu.
 *
 * Chaque geste rend une nouvelle sélection, sans rien changer à l'ancienne.
 */
export interface Selection {
    /** Les quarts d'heure sélectionnés, dans l'ordre, chacun une fois. */
    readonly quarters: readonly number[];
    /** Le quart d'heure d'où part Maj+clic : le premier cliqué. */
    readonly anchor: number | null;
    /** Le dernier quart d'heure atteint : celui d'où partent les flèches. */
    readonly head: number | null;
}

export const EMPTY_SELECTION: Selection = { quarters: [], anchor: null, head: null };

/** Un clic, ou le début d'un glisser : ce seul quart d'heure. */
export function selectQuarter(quarter: number): Selection {
    Quarter.assertQuarter(quarter);

    return { quarters: [quarter], anchor: quarter, head: quarter };
}

/** Maj+clic, ou le glisser qui avance : tout, du premier quart d'heure cliqué à celui-ci. */
export function extendTo(selection: Selection, quarter: number): Selection {
    Quarter.assertQuarter(quarter);
    const anchor = selection.anchor ?? quarter;

    return {
        quarters: Quarter.between(Math.min(anchor, quarter), Math.max(anchor, quarter) + Quarter.MINUTES),
        anchor,
        head: quarter,
    };
}

/** Ctrl/⌘+clic : ajoute le quart d'heure, ou le retire s'il y était. */
export function toggleQuarter(selection: Selection, quarter: number): Selection {
    Quarter.assertQuarter(quarter);
    const quarters = selection.quarters.includes(quarter)
        ? selection.quarters.filter((selected) => selected !== quarter)
        : [...selection.quarters, quarter].sort((a, b) => a - b);

    return { quarters, anchor: quarter, head: quarter };
}

/**
 * Les flèches : passe au quart d'heure voisin, ou étend la sélection jusqu'à lui avec
 * Maj. Rien ne bouge au bord de la grille, ni avant le premier clic. Comme dans la v1,
 * elles repartent du dernier quart d'heure cliqué, même retiré par Ctrl/⌘+clic.
 */
export function moveSelection(selection: Selection, step: -1 | 1, extend: boolean): Selection {
    if (selection.head === null) {
        return selection;
    }
    const next = selection.head + step * Quarter.MINUTES;
    if (!Quarter.isQuarter(next)) {
        return selection;
    }

    return extend ? extendTo(selection, next) : selectQuarter(next);
}

/**
 * Échap, ou un clic qui quitte la grille : plus rien n'est sélectionné, mais le curseur
 * reste où il était, comme celui d'un tableur. Les flèches et Maj en repartent, comme
 * après un Ctrl/⌘+clic qui retire le dernier quart d'heure.
 */
export function deselect(selection: Selection): Selection {
    return selection.head === null ? EMPTY_SELECTION : { quarters: [], anchor: selection.head, head: selection.head };
}

/**
 * Ces quarts d'heure, et rien d'autre : ce qui vient d'être collé, pour qu'on le voie, ou
 * ce que vise une fenêtre de ticket. La sélection s'arrête sur le dernier, ou sur `head`
 * quand il en fait partie : le quart d'heure double-cliqué d'un bloc.
 */
export function selectQuarters(quarters: Iterable<number>, head: number | null = null): Selection {
    const sorted = [...new Set(quarters)].sort((a, b) => a - b);
    sorted.forEach(Quarter.assertQuarter);
    const first = sorted.at(0);
    const last = sorted.at(-1);

    return first === undefined || last === undefined
        ? EMPTY_SELECTION
        : { quarters: sorted, anchor: first, head: head !== null && sorted.includes(head) ? head : last };
}

export function isSelected(selection: Selection, quarter: number): boolean {
    return selection.quarters.includes(quarter);
}

/**
 * Les suites de quarts d'heure voisins de la sélection, de leur début à leur fin :
 * chacune se dessine d'un seul cadre.
 */
export function selectionRuns(selection: Selection): { start: number; end: number }[] {
    const runs: { start: number; end: number }[] = [];
    for (const quarter of selection.quarters) {
        const last = runs.at(-1);
        if (last?.end === quarter) {
            last.end = quarter + Quarter.MINUTES;
        } else {
            runs.push({ start: quarter, end: quarter + Quarter.MINUTES });
        }
    }

    return runs;
}
