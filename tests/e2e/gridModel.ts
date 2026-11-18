/**
 * Ce que chaque geste de la grille doit laisser, écrit sans rien emprunter à l'application.
 * Les suites tirées au hasard le tiennent à côté des gestes, dans Chromium
 * (grid-random.spec.ts) comme sans navigateur (tests/front/day/gridRandom.test.tsx) :
 * après chaque geste, la base contient exactement ce qu'il attend.
 *
 * Les gestes se concentrent sur une matinée, de 08:00 à 11:45, pour qu'ils se chevauchent
 * souvent ; un groupe collé n'y déborde jamais de la journée.
 */

/** 08:00 à 11:45 : seize quarts d'heure. */
export const QUARTERS = Array.from({ length: 16 }, (_, index) => 480 + index * 15);
const LAST = QUARTERS.at(-1) ?? 705;

export function time(minutes: number): string {
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Ce qu'un quart d'heure contient : « SHOP-1|Revue », « SHOP-1| », « pause », ou rien. */
export type Cell = string | null;

export interface Model {
    cells: Map<number, Cell>;
    undo: Map<number, Cell>[];
    redo: Map<number, Cell>[];
    clipboard: Cell[] | null;
}

export function emptyModel(): Model {
    return { cells: new Map(), undo: [], redo: [], clipboard: null };
}

export function cellAt(model: Model, quarter: number): Cell {
    return model.cells.get(quarter) ?? null;
}

/** Un geste qui change la grille se range pour être annulé ; un geste qui ne change rien, non. */
export function change(model: Model, changes: Map<number, Cell>): void {
    const next = new Map(model.cells);
    let changed = false;
    for (const [quarter, cell] of changes) {
        changed ||= cellAt(model, quarter) !== cell;
        next.set(quarter, cell);
    }
    if (changed) {
        model.undo.push(model.cells);
        model.redo = [];
        model.cells = next;
    }
}

/** Annuler ou rétablir : rien quand il n'y a rien à défaire ou à refaire. */
export function rewind(model: Model, direction: 'undo' | 'redo'): void {
    const [from, to] = direction === 'undo' ? [model.undo, model.redo] : [model.redo, model.undo];
    const previous = from.pop();
    if (previous !== undefined) {
        to.push(model.cells);
        model.cells = previous;
    }
}

export function rangeOf(at: number, length: number): number[] {
    return QUARTERS.filter((quarter) => quarter >= at && quarter <= Math.min(at + (length - 1) * 15, LAST));
}

/** Le bloc qui couvre un quart d'heure : ses voisins au même contenu. */
export function blockOf(model: Model, quarter: number): number[] {
    const cell = cellAt(model, quarter);
    let start = quarter;
    while (start > 420 && cellAt(model, start - 15) === cell) {
        start -= 15;
    }
    let end = quarter;
    while (end < 1185 && cellAt(model, end + 15) === cell) {
        end += 15;
    }
    const block: number[] = [];
    for (let minute = start; minute <= end; minute += 15) {
        block.push(minute);
    }

    return block;
}

export function fill(quarters: readonly number[], cell: Cell): Map<number, Cell> {
    return new Map(quarters.map((quarter) => [quarter, cell]));
}

/** Le titre de la fenêtre qu'un double-clic ou Entrée ouvrent sur un créneau saisi. */
export function editTitle(model: Model, quarter: number): string {
    return cellAt(model, quarter) === 'pause' ? 'Modifier la pause' : 'Modifier le ticket';
}

/**
 * Entrée ouvre-t-elle la fenêtre du bloc ? Oui quand toute la sélection tient dans un bloc,
 * comme un double-clic ; sinon, Nouveau ticket sur toute la sélection — une plage vide, des
 * morceaux, ou à cheval sur un bloc.
 */
export function entersBlock(model: Model, quarters: readonly number[]): boolean {
    const [first] = quarters;
    if (first === undefined || cellAt(model, first) === null) {
        return false;
    }
    const block = blockOf(model, first);

    return quarters.every((quarter) => block.includes(quarter));
}

/** Ce qu'écrit la fenêtre qu'Entrée ouvre sur la sélection : tout le bloc, ou toute la sélection (entersBlock). */
export function enterQuarters(model: Model, quarters: readonly number[]): readonly number[] {
    const [first] = quarters;

    return first !== undefined && entersBlock(model, quarters) ? blockOf(model, first) : quarters;
}

/** Modifier la sélection ne s'ouvre que sur un seul ticket avec un seul commentaire : le voici, ou null. */
export function retouched(model: Model, quarters: readonly number[]): string | null {
    const [first] = quarters;
    const cell = first === undefined ? null : cellAt(model, first);

    return cell !== null && cell !== 'pause' && quarters.every((quarter) => cellAt(model, quarter) === cell)
        ? cell
        : null;
}

/** Copier : une plage vide ne se copie pas, le presse-papier garde ce qu'il tenait. */
export function copy(model: Model, quarters: readonly number[]): void {
    if (quarters.some((quarter) => cellAt(model, quarter) !== null)) {
        model.clipboard = quarters.map((quarter) => cellAt(model, quarter));
    }
}

/** Couper : copier, puis effacer, quand la plage n'est pas vide. */
export function cut(model: Model, quarters: readonly number[]): void {
    if (quarters.some((quarter) => cellAt(model, quarter) !== null)) {
        copy(model, quarters);
        change(model, fill(quarters, null));
    }
}

/**
 * Coller sur la sélection : un seul créneau copié la remplit, un groupe se colle en entier à
 * partir de son premier créneau. Sans rien de copié, rien ne bouge.
 */
export function paste(model: Model, quarters: readonly number[]): void {
    const { clipboard } = model;
    const [first] = quarters;
    if (clipboard === null || first === undefined) {
        return;
    }
    const [single] = clipboard;
    change(
        model,
        clipboard.length === 1
            ? fill(quarters, single ?? null)
            : new Map(clipboard.map((cell, offset) => [first + offset * 15, cell])),
    );
}

/** Convertir en pause : grisé quand toute la sélection est déjà en pause. */
export function canPause(model: Model, quarters: readonly number[]): boolean {
    return quarters.some((quarter) => cellAt(model, quarter) !== 'pause');
}

/** Ce que la liste des créneaux dit de chaque quart d'heure : « 09:30, SHOP-1, Revue ». */
export function labelsOf(cells: Map<number, Cell>): string[] {
    const labels: string[] = [];
    for (let minute = 420; minute < 1200; minute += 15) {
        const cell = cells.get(minute) ?? null;
        if (cell === null) {
            labels.push(`${time(minute)}, vide`);
        } else if (cell === 'pause') {
            labels.push(`${time(minute)}, pause`);
        } else {
            const [ticket = '', comment = ''] = cell.split('|');
            labels.push([time(minute), ticket, comment].filter((part) => part !== '').join(', '));
        }
    }

    return labels;
}
