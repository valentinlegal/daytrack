import type { QuarterChanges } from './changes';
import { type Cell, type Grid, sameCell, type SlotContent, unlinked } from './grid';
import { isDate } from '../day/calendar';
import { isRecord, isUuid, readCell } from './json';
import * as Quarter from './quarter';
import { LAST_WEEK, type RecurrenceRule } from './recurrence';
import type { Selection } from './selection';
import { type TabStorage, TabValues } from './tabStore';

/**
 * Un groupe de créneaux copiés, qui garde sa forme : chaque créneau à son écart, en
 * quarts d'heure, du premier sélectionné. Un créneau vide copié efface ce qu'il
 * recouvre au collage ; un quart d'heure laissé hors de la sélection n'est pas copié,
 * et le collage n'y touche pas.
 */
export interface Clipboard {
    readonly cells: readonly ClipboardCell[];
    /**
     * Une récurrence coupée avec les suivantes : son rythme et sa fin, que son bloc emporte. Le
     * premier collage qui la fait repartir la quitte (daySession.ts) ; ses cellules sont alors
     * celles d'un seul bloc, d'un seul tenant.
     */
    readonly recurrence?: RecurrenceRule;
    /** La récurrence coupée, et le jour de la coupe : toujours avec `recurrence`, jamais sans. */
    readonly source?: CutSource;
}

/**
 * D'où vient une récurrence coupée : collée, la nouvelle reprend ses fois effacées ou détachées
 * (src/Day/DayWriter.php, saveRecurrence), et elle ne repart pas d'avant le jour de la coupe.
 */
export interface CutSource {
    readonly id: string;
    /** « AAAA-MM-JJ ». */
    readonly date: string;
}

export interface ClipboardCell {
    readonly offset: number;
    readonly content: Cell;
}

export type Paste =
    /** Ce que le collage change, et les quarts d'heure collés, que la sélection devient. */
    | { readonly kind: 'paste'; readonly changes: QuarterChanges; readonly quarters: readonly number[] }
    /** Le groupe déborde après 20:00 : rien n'est collé. */
    | { readonly kind: 'overflow' }
    /** Rien n'est sélectionné. */
    | { readonly kind: 'nothing' };

/**
 * Copier la sélection ; null quand elle est vide, ou qu'elle ne couvre que des créneaux
 * vides : une plage vide ne se copie pas, et le presse-papier garde ce qu'il tenait.
 */
export function copy(grid: Grid, selection: Selection): Clipboard | null {
    return copyQuarters(grid, selection.quarters);
}

/** Copier ces quarts d'heure, dans l'ordre : ce que copie une sélection. */
export function copyQuarters(grid: Grid, quarters: readonly number[]): Clipboard | null {
    const first = quarters.at(0);
    if (first === undefined || quarters.every((quarter) => grid.at(quarter) === null)) {
        return null;
    }

    return {
        // Copier ne garde pas la récurrence : ce qu'on colle est une saisie ordinaire.
        cells: quarters.map((quarter) => {
            const content = grid.at(quarter);

            return {
                offset: (quarter - first) / Quarter.MINUTES,
                content: content === null ? null : unlinked(content),
            };
        }),
    };
}

/**
 * Ce que coupe « Cette fois et les suivantes » : la fois du jour, d'un seul tenant, son
 * rythme, que le collage emporte (followRhythm), et d'où elle vient.
 */
export function cutRecurrence(
    grid: Grid,
    occurrence: readonly number[],
    rule: RecurrenceRule,
    source: CutSource,
): Clipboard | null {
    const copied = copyQuarters(grid, occurrence);

    return copied === null || copied.cells.some(({ content }) => content === null)
        ? null
        : { cells: copied.cells, recurrence: rule, source };
}

/** Le même presse-papier, sans la récurrence coupée : son bloc seul. */
export function withoutRecurrence(clipboard: Clipboard): Clipboard {
    return { cells: clipboard.cells };
}

/** Un seul ticket à coller : ce que copie un clic sur un favori. */
export function clipboardOf(content: SlotContent): Clipboard {
    return { cells: [{ offset: 0, content: unlinked(content) }] };
}

/**
 * Coller sur la sélection.
 *
 * Un seul créneau copié remplit chaque quart d'heure sélectionné : c'est ainsi qu'un
 * favori remplace un ticket sur toute une plage. Un groupe se colle en entier à partir
 * du premier quart d'heure sélectionné, même s'il dépasse la sélection : elle ne donne
 * que le point de départ, et le coller seulement dedans en perdrait une partie sans le
 * dire. Un groupe qui déborde après 20:00 ne se colle pas du tout, pour la même raison ;
 * un créneau vide au-delà de 20:00 ne fait pas déborder : il n'efface rien, et rien ne se
 * perd.
 */
export function paste(clipboard: Clipboard, selection: Selection): Paste {
    const first = selection.quarters.at(0);
    // Une récurrence coupée se déplace avec son bloc, à sa longueur : elle ne remplit pas la sélection.
    const single = clipboard.cells.length === 1 && clipboard.recurrence === undefined ? clipboard.cells[0] : undefined;
    if (first === undefined) {
        return { kind: 'nothing' };
    }

    const changes = new Map<number, Cell>();
    if (single !== undefined) {
        for (const quarter of selection.quarters) {
            changes.set(quarter, single.content);
        }
    } else {
        for (const { offset, content } of clipboard.cells) {
            const quarter = first + offset * Quarter.MINUTES;
            if (Quarter.isQuarter(quarter)) {
                changes.set(quarter, content);
            } else if (content !== null) {
                return { kind: 'overflow' };
            }
        }
    }

    return { kind: 'paste', changes, quarters: [...changes.keys()].sort((a, b) => a - b) };
}

/** Le presse-papier de l'onglet : il survit à un rechargement et à un changement de jour. */
export interface ClipboardStore {
    /**
     * Ce qu'il tient : le même objet que la dernière écriture de l'onglet, tant que rien d'autre
     * n'y a été écrit — un collage en route sait ainsi si l'on a copié ou coupé depuis.
     */
    read(): Clipboard | null;
    write(clipboard: Clipboard): void;
}

export const CLIPBOARD_STORAGE_KEY = 'daytrack.clipboard';

/** Le presse-papier gardé par l'onglet. Ce qui s'y lit de travers vaut un presse-papier vide. */
export function storedClipboard(storage: TabStorage): ClipboardStore {
    const values = new TabValues(storage, CLIPBOARD_STORAGE_KEY, (json) => readClipboard(json) ?? undefined);

    return {
        read: () => values.get('') ?? null,
        write: (clipboard) => {
            values.set('', clipboard);
        },
    };
}

function readClipboard(json: unknown): Clipboard | null {
    if (!isRecord(json) || !Array.isArray(json.cells) || json.cells.length === 0) {
        return null;
    }
    const cells: ClipboardCell[] = [];
    for (const cell of json.cells as unknown[]) {
        const read = isRecord(cell) ? readCell(cell.content) : undefined;
        // Un presse-papier gardé ne porte jamais de récurrence, même écrit d'ailleurs.
        const content = read === undefined || read === null ? read : unlinked(read);
        const offset = isRecord(cell) ? cell.offset : undefined;
        if (
            content === undefined ||
            typeof offset !== 'number' ||
            !Number.isInteger(offset) ||
            offset < 0 ||
            offset >= Quarter.COUNT ||
            cells.some((known) => known.offset === offset)
        ) {
            return null;
        }
        cells.push({ offset, content });
    }
    // Une récurrence coupée part avec ce dont elle vient, l'une jamais sans l'autre.
    if (json.recurrence === undefined && json.source === undefined) {
        return { cells };
    }
    const recurrence = readRule(json.recurrence);
    const source = readSource(json.source);
    // Une récurrence ne part qu'avec un seul bloc, sans trou ni créneau vide.
    const first = cells[0]?.content ?? null;
    const offsets = cells.map(({ offset }) => offset).sort((a, b) => a - b);
    const whole =
        first !== null &&
        offsets.every((offset, index) => offset === index) &&
        cells.every(({ content }) => sameCell(content, first));

    return recurrence === null || source === null || !whole ? null : { cells, recurrence, source };
}

/** La récurrence coupée et le jour de la coupe, tous deux là ; null sinon. */
function readSource(json: unknown): CutSource | null {
    if (!isRecord(json)) {
        return null;
    }
    const { id, date } = json;

    return typeof id === 'string' && isUuid(id) && typeof date === 'string' && isDate(date) ? { id, date } : null;
}

/** Un rythme et une fin gardés avec une coupe ; null s'ils n'en ont pas la forme. */
function readRule(json: unknown): RecurrenceRule | null {
    if (!isRecord(json)) {
        return null;
    }
    const { kind, weekdays, everyWeeks, monthWeek, monthDay, until } = json;
    const weekday = (day: unknown) => typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 7;
    if (
        !Array.isArray(weekdays) ||
        !weekdays.every(weekday) ||
        typeof everyWeeks !== 'number' ||
        !Number.isInteger(everyWeeks) ||
        everyWeeks < 1 ||
        everyWeeks > 4 ||
        (until !== null && (typeof until !== 'string' || !isDate(until)))
    ) {
        return null;
    }
    const days = weekdays as number[];
    switch (kind) {
        case 'weekly':
            return days.length > 0 && monthWeek === null && monthDay === null
                ? { kind, weekdays: days, everyWeeks, monthWeek: null, monthDay: null, until }
                : null;
        case 'monthly_weekday':
            return days.length === 1 &&
                everyWeeks === 1 &&
                (monthWeek === LAST_WEEK || (typeof monthWeek === 'number' && [1, 2, 3, 4].includes(monthWeek))) &&
                monthDay === null
                ? { kind, weekdays: days, everyWeeks, monthWeek, monthDay: null, until }
                : null;
        case 'monthly_date':
            return days.length === 0 &&
                everyWeeks === 1 &&
                monthWeek === null &&
                typeof monthDay === 'number' &&
                Number.isInteger(monthDay) &&
                monthDay >= 1 &&
                monthDay <= 31
                ? { kind, weekdays: days, everyWeeks, monthWeek: null, monthDay, until }
                : null;
        default:
            return null;
    }
}
