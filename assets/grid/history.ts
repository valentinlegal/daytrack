import type { QuarterChanges } from './changes';
import { type Cell, type Grid, sameCell } from './grid';
import { isRecord, readCell, readQuarters } from './json';
import { type TabStorage, TabValues } from './tabStore';

/**
 * Annuler et rétablir, jusqu'à 50 gestes par journée.
 *
 * Un geste se range par les quarts d'heure qu'il a touchés : ce qu'ils valaient avant,
 * et ce que le serveur en a fait. L'annuler, c'est leur rendre leur valeur d'avant —
 * seulement s'ils ont encore celle d'après : un autre onglet a pu les changer depuis,
 * et annuler ne défait jamais ce qu'il a écrit.
 */
export const LIMIT = 50;

export interface Step {
    readonly quarters: readonly number[];
    readonly before: readonly Cell[];
    readonly after: readonly Cell[];
}

export interface History {
    readonly undo: readonly Step[];
    readonly redo: readonly Step[];
}

export const EMPTY_HISTORY: History = { undo: [], redo: [] };

export type Rewind =
    /** Ce qu'il faut écrire pour défaire, ou refaire, le dernier geste. */
    | { readonly kind: 'changes'; readonly changes: QuarterChanges }
    /** Rien à annuler, ou à rétablir. */
    | { readonly kind: 'nothing' }
    /** Les quarts d'heure du geste ont changé depuis, ailleurs : rien ne s'écrit. */
    | { readonly kind: 'conflict' };

/** Le geste qui a fait passer ces quarts d'heure d'une grille à l'autre ; null s'il n'a rien changé. */
export function stepBetween(before: Grid, after: Grid, quarters: Iterable<number>): Step | null {
    const touched = [...quarters].filter((quarter) => !sameCell(before.at(quarter), after.at(quarter)));

    return touched.length === 0
        ? null
        : {
              quarters: touched,
              before: touched.map((quarter) => before.at(quarter)),
              after: touched.map((quarter) => after.at(quarter)),
          };
}

/** Un nouveau geste : il se range au sommet, le plus ancien tombe au-delà de 50, et rétablir se vide. */
export function record(history: History, step: Step): History {
    return { undo: [...history.undo, step].slice(-LIMIT), redo: [] };
}

export function planUndo(history: History, grid: Grid): Rewind {
    const step = history.undo.at(-1);

    return step === undefined ? { kind: 'nothing' } : rewind(grid, step.quarters, step.after, step.before);
}

export function planRedo(history: History, grid: Grid): Rewind {
    const step = history.redo.at(-1);

    return step === undefined ? { kind: 'nothing' } : rewind(grid, step.quarters, step.before, step.after);
}

/** Le dernier geste est défait : il passe dans rétablir, avec ce que la grille vaut désormais. */
export function undone(history: History, grid: Grid): History {
    const step = history.undo.at(-1);
    if (step === undefined) {
        return history;
    }

    return {
        undo: history.undo.slice(0, -1),
        redo: [...history.redo, { ...step, before: step.quarters.map((quarter) => grid.at(quarter)) }],
    };
}

/** Le dernier geste défait est refait : il revient dans annuler, avec ce que la grille vaut désormais. */
export function redone(history: History, grid: Grid): History {
    const step = history.redo.at(-1);
    if (step === undefined) {
        return history;
    }

    return {
        undo: [...history.undo, { ...step, after: step.quarters.map((quarter) => grid.at(quarter)) }],
        redo: history.redo.slice(0, -1),
    };
}

function rewind(grid: Grid, quarters: readonly number[], expected: readonly Cell[], target: readonly Cell[]): Rewind {
    const changes = new Map<number, Cell>();
    for (const [index, quarter] of quarters.entries()) {
        if (!sameCell(grid.at(quarter), expected[index] ?? null)) {
            return { kind: 'conflict' };
        }
        changes.set(quarter, target[index] ?? null);
    }

    return { kind: 'changes', changes };
}

/** L'historique de chaque journée, gardé par l'onglet : il survit à un rechargement. */
export interface HistoryStore {
    read(date: string): History;
    write(date: string, history: History): void;
    /**
     * La version d'où est partie une écriture du jour pas encore revenue, ou null. Un
     * rechargement en plein envoi la retrouve : il ne saura jamais si l'écriture est
     * passée, ni si elle passera.
     */
    sending(date: string): number | null;
    markSending(date: string, version: number | null): void;
}

export const HISTORY_STORAGE_PREFIX = 'daytrack.history.';
export const SENDING_STORAGE_PREFIX = 'daytrack.sending.';

/**
 * L'historique gardé par l'onglet, une clé par journée. Ce qui s'y lit de travers vaut
 * un historique vide : mieux vaut ne rien pouvoir annuler qu'annuler à côté.
 */
export function storedHistory(storage: TabStorage): HistoryStore {
    const histories = new TabValues(storage, HISTORY_STORAGE_PREFIX, readHistory, true);
    const sending = new TabValues(storage, SENDING_STORAGE_PREFIX, (json) =>
        typeof json === 'number' && Number.isInteger(json) && json >= 0 ? json : undefined,
    );

    return {
        read: (date) => histories.get(date) ?? EMPTY_HISTORY,
        write: (date, history) => {
            histories.set(date, history);
        },
        sending: (date) => sending.get(date) ?? null,
        markSending: (date, version) => {
            if (version === null) {
                sending.delete(date);
            } else if (!sending.set(date, version)) {
                // Sans la marque, un rechargement croirait l'historique à jour : il ne le
                // retrouvera pas du tout.
                histories.unstore(date);
            }
        },
    };
}

function readHistory(json: unknown): History | undefined {
    if (!isRecord(json)) {
        return undefined;
    }
    const undo = readSteps(json.undo);
    const redo = readSteps(json.redo);

    return undo === undefined || redo === undefined ? undefined : { undo, redo };
}

function readSteps(json: unknown): Step[] | undefined {
    if (!Array.isArray(json) || json.length > LIMIT) {
        return undefined;
    }
    const steps: Step[] = [];
    for (const step of json as unknown[]) {
        const quarters = isRecord(step) ? readQuarters(step.quarters) : undefined;
        const before = isRecord(step) ? readCells(step.before, quarters?.length) : undefined;
        const after = isRecord(step) ? readCells(step.after, quarters?.length) : undefined;
        if (quarters === undefined || quarters.length === 0 || before === undefined || after === undefined) {
            return undefined;
        }
        steps.push({ quarters, before, after });
    }

    return steps;
}

function readCells(json: unknown, length: number | undefined): Cell[] | undefined {
    if (!Array.isArray(json) || json.length !== length) {
        return undefined;
    }
    const cells: Cell[] = [];
    for (const cell of json as unknown[]) {
        const content = readCell(cell);
        if (content === undefined) {
            return undefined;
        }
        cells.push(content);
    }

    return cells;
}
