import type { QuarterChanges } from './changes';
import type { Cell, Grid, SlotContent } from './grid';
import { isRecord, readCell } from './json';
import * as Quarter from './quarter';
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
    const first = selection.quarters.at(0);
    if (first === undefined || selection.quarters.every((quarter) => grid.at(quarter) === null)) {
        return null;
    }

    return {
        cells: selection.quarters.map((quarter) => ({
            offset: (quarter - first) / Quarter.MINUTES,
            content: grid.at(quarter),
        })),
    };
}

/** Un seul ticket à coller : ce que copie un clic sur un favori. */
export function clipboardOf(content: SlotContent): Clipboard {
    return { cells: [{ offset: 0, content }] };
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
    const single = clipboard.cells.length === 1 ? clipboard.cells[0] : undefined;
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
        const content = isRecord(cell) ? readCell(cell.content) : undefined;
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

    return { cells };
}
