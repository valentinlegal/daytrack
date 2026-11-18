import { isDate } from '../day/calendar';
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
    /**
     * Les fins des récurrences qu'un geste de la fenêtre a créées, coupées ou arrêtées :
     * annuler leur rend celle d'avant, rétablir celle d'après (src/Recurrence/UntilChange.php).
     */
    readonly untils?: readonly UntilStep[];
    /**
     * Les récurrences dont l'annulation de ce geste a rendu la fois à sa série sans l'écrire —
     * une journée à 0h00, ou à venir et non travaillée : rétablir la leur détache de nouveau
     * (src/Day/DayWriter.php, detachAgain).
     */
    readonly detaches?: readonly string[];
}

/** La fin d'une récurrence avant et après un geste ; une récurrence retirée finit la veille de son premier jour. */
export interface UntilStep {
    readonly recurrence: string;
    readonly before: string | null;
    readonly after: string | null;
}

/** Une fin à rendre : seulement si la récurrence a encore celle de `from` (src/Recurrence/UntilRewind.php). */
export interface UntilRewind {
    readonly recurrence: string;
    readonly from: string | null;
    readonly to: string | null;
}

export interface History {
    readonly undo: readonly Step[];
    readonly redo: readonly Step[];
}

export const EMPTY_HISTORY: History = { undo: [], redo: [] };

export type Rewind =
    /** Ce qu'il faut écrire pour défaire, ou refaire, le dernier geste. */
    | {
          readonly kind: 'changes';
          readonly changes: QuarterChanges;
          readonly untils: readonly UntilRewind[];
          /** Rétablir : les récurrences dont la fois redevient détachée. */
          readonly detaches?: readonly string[];
      }
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

    return step === undefined
        ? { kind: 'nothing' }
        : rewind(
              grid,
              step.quarters,
              step.after,
              step.before,
              (step.untils ?? []).map(({ recurrence, before, after }) => ({ recurrence, from: after, to: before })),
              [],
          );
}

export function planRedo(history: History, grid: Grid): Rewind {
    const step = history.redo.at(-1);

    return step === undefined
        ? { kind: 'nothing' }
        : rewind(
              grid,
              step.quarters,
              // Une fois rendue à sa série ne se montre pas : la grille y est vide.
              step.before.map((cell) => (detached(cell, step.detaches) ? null : cell)),
              step.after,
              (step.untils ?? []).map(({ recurrence, before, after }) => ({ recurrence, from: before, to: after })),
              step.detaches ?? [],
          );
}

function detached(cell: Cell, detaches: readonly string[] | undefined): boolean {
    return cell?.recurrence != null && (detaches ?? []).includes(cell.recurrence);
}

/**
 * Le dernier geste est défait : il passe dans rétablir, avec ce que la grille vaut désormais. Sur
 * une journée qui ne reçoit aucune récurrence (`withholds`), une fois qu'il rendait et que la
 * grille ne montre pas est revenue à sa série : rétablir la détachera de nouveau. Le geste garde
 * alors la fois telle qu'elle était, pour qu'annuler de nouveau la rende encore.
 */
export function undone(history: History, grid: Grid, withholds = false): History {
    const step = history.undo.at(-1);
    if (step === undefined) {
        return history;
    }
    const shown = new Set(grid.blocks().map((block) => block.content.recurrence));
    const detaches = withholds
        ? [...new Set(step.before.map((cell) => cell?.recurrence ?? null))].filter(
              (id): id is string => id !== null && !shown.has(id),
          )
        : [];
    const redo = {
        ...withoutDetaches(step),
        before: step.quarters.map((quarter, index) => {
            const cell = step.before[index] ?? null;

            return detached(cell, detaches) ? cell : grid.at(quarter);
        }),
    };

    return {
        undo: history.undo.slice(0, -1),
        redo: [...history.redo, detaches.length === 0 ? redo : { ...redo, detaches }],
    };
}

/** Le dernier geste défait est refait : il revient dans annuler, avec ce que la grille vaut désormais. */
export function redone(history: History, grid: Grid): History {
    const step = history.redo.at(-1);
    if (step === undefined) {
        return history;
    }

    return {
        undo: [...history.undo, { ...withoutDetaches(step), after: step.quarters.map((quarter) => grid.at(quarter)) }],
        redo: history.redo.slice(0, -1),
    };
}

function withoutDetaches(step: Step): Step {
    return step.untils === undefined
        ? { quarters: step.quarters, before: step.before, after: step.after }
        : { quarters: step.quarters, before: step.before, after: step.after, untils: step.untils };
}

function rewind(
    grid: Grid,
    quarters: readonly number[],
    expected: readonly Cell[],
    target: readonly Cell[],
    untils: readonly UntilRewind[],
    detaches: readonly string[],
): Rewind {
    const changes = new Map<number, Cell>();
    for (const [index, quarter] of quarters.entries()) {
        if (!sameCell(grid.at(quarter), expected[index] ?? null)) {
            return { kind: 'conflict' };
        }
        changes.set(quarter, target[index] ?? null);
    }

    return detaches.length === 0
        ? { kind: 'changes', changes, untils }
        : { kind: 'changes', changes, untils, detaches };
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
        const untils = isRecord(step) ? readUntils(step.untils) : undefined;
        const detaches = isRecord(step) ? readDetaches(step.detaches) : undefined;
        // Un geste qui n'a changé que la fin d'une récurrence n'a touché aucun quart d'heure.
        if (
            quarters === undefined ||
            untils === undefined ||
            (quarters.length === 0 && untils.length === 0) ||
            before === undefined ||
            after === undefined ||
            detaches === undefined
        ) {
            return undefined;
        }
        steps.push({
            quarters,
            before,
            after,
            ...(untils.length === 0 ? {} : { untils }),
            ...(detaches.length === 0 ? {} : { detaches }),
        });
    }

    return steps;
}

/**
 * Les fins rangées avec un geste, ou rendues par le serveur avec la récurrence enregistrée :
 * aucune pour un geste de la grille. Undefined si elles n'en ont pas la forme.
 */
export function readUntils(json: unknown): UntilStep[] | undefined {
    if (json === undefined) {
        return [];
    }
    if (!Array.isArray(json)) {
        return undefined;
    }
    const untils: UntilStep[] = [];
    for (const until of json as unknown[]) {
        if (
            !isRecord(until) ||
            typeof until.recurrence !== 'string' ||
            !isUntil(until.before) ||
            !isUntil(until.after)
        ) {
            return undefined;
        }
        untils.push({ recurrence: until.recurrence, before: until.before, after: until.after });
    }

    return untils;
}

/** Les récurrences qu'un geste à rétablir détache de nouveau : aucune le plus souvent. */
function readDetaches(json: unknown): string[] | undefined {
    if (json === undefined) {
        return [];
    }

    return Array.isArray(json) && json.every((id) => typeof id === 'string') ? json : undefined;
}

function isUntil(value: unknown): value is string | null {
    return value === null || (typeof value === 'string' && isDate(value));
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
