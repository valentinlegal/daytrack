import { readFileSync } from 'node:fs';

import fc from 'fast-check';

import { type Block, type Cell, Grid, linkedTo, PAUSE, type SlotContent, work } from '../../../assets/grid/grid';
import * as Quarter from '../../../assets/grid/quarter';
import type { RecurrenceRule } from '../../../assets/grid/recurrence';
import type { TabStorage } from '../../../assets/grid/tabStore';

/**
 * Une plage telle que l'écrivent les cas partagés : début, fin, nature, ticket, commentaire,
 * et en sixième, s'il y en a une, la récurrence qui l'a posée.
 */
export type Range = readonly [string, string, 'work' | 'pause', string | null, string | null, string?];

/** Les cas d'un fichier de tests/cases, que le serveur rejoue aussi : ceux de `section`. */
export function readCases(file: string, section = 'cases'): unknown[] {
    const json: unknown = JSON.parse(readFileSync(new URL(`../../cases/${file}`, import.meta.url), 'utf-8'));
    const cases: unknown =
        typeof json === 'object' && json !== null ? (json as Record<string, unknown>)[section] : null;
    if (!Array.isArray(cases)) {
        throw new TypeError(`${file} n'a pas de cas « ${section} ».`);
    }

    return cases as unknown[];
}

/**
 * La règle « chaque semaine, ces jours-là » telle que la fenêtre l'envoie, ses jours tels
 * quels : un test peut en envoyer deux fois le même.
 */
export function weeklyRule(weekdays: readonly number[], until: string | null = null, everyWeeks = 1): RecurrenceRule {
    return { kind: 'weekly', weekdays: [...weekdays], everyWeeks, monthWeek: null, monthDay: null, until };
}

export function minutes(time: string): number {
    const parsed = Quarter.parse(time);
    if (parsed === null) {
        throw new RangeError(`${time} n'est pas une heure.`);
    }

    return parsed;
}

export function contentOf(range: Range): SlotContent {
    return linkedTo(range[2] === 'pause' ? PAUSE : work(range[3] ?? '', range[4]), range[5] ?? null);
}

/** La grille où chaque plage est posée quart d'heure par quart d'heure. */
export function gridOf(ranges: readonly Range[]): Grid {
    return Grid.of(
        ranges.flatMap((range) =>
            Quarter.between(minutes(range[0]), minutes(range[1])).map(
                (quarter) => [quarter, contentOf(range)] as const,
            ),
        ),
    );
}

/**
 * La journée telle qu'un jour à venir la montre : ses saisies, et sur les quarts d'heure
 * qu'elles laissent libres, les fois prévues de ses récurrences, chacune à son tour. Ce qui
 * est saisi l'emporte, et une fois prévue ne prend pas le quart d'heure d'une autre placée
 * avant elle. C'est le serveur qui les prévoit (src/Day/Grid.php, withPlanned) ; les cas de
 * tests/cases/day-figures.json éprouvent cette copie, celle des tests du navigateur, sur la
 * même règle.
 */
export function withPlanned(grid: Grid, planned: Iterable<Block>): Grid {
    const changes = new Map<number, Cell>();
    for (const occurrence of planned) {
        for (const quarter of Quarter.between(occurrence.start, occurrence.end)) {
            if (grid.at(quarter) === null && !changes.has(quarter)) {
                changes.set(quarter, occurrence.content);
            }
        }
    }

    return grid.with(changes);
}

/** Les blocs d'une grille, écrits comme dans les cas partagés. */
export function rangesOf(grid: Grid): Range[] {
    return grid.blocks().map(({ start, end, content }): Range => {
        const range = [
            Quarter.format(start),
            Quarter.format(end),
            content.kind,
            content.kind === 'work' ? content.ticket : null,
            content.kind === 'work' ? content.comment : null,
        ] as const;

        return content.recurrence === null ? range : [...range, content.recurrence];
    });
}

/**
 * Un stockage d'onglet en mémoire, qui peut tout refuser, comme un navigateur en
 * navigation privée, ou se remplir, comme un vrai : au-delà de `quota` caractères,
 * une écriture est refusée et laisse le stockage tel qu'il était.
 */
export function memoryStorage({
    refuse = false,
    initial = {},
}: { refuse?: boolean; initial?: Record<string, string> } = {}): TabStorage & {
    items: Map<string, string>;
    quota: number;
    used: () => number;
} {
    const items = new Map(Object.entries(initial));
    const guard = (): void => {
        if (refuse) {
            throw new DOMException('Accès refusé', 'SecurityError');
        }
    };
    const used = (): number => [...items].reduce((total, [key, value]) => total + key.length + value.length, 0);
    const storage = {
        items,
        quota: Number.POSITIVE_INFINITY,
        used,
        get length() {
            return items.size;
        },
        key: (index: number) => [...items.keys()][index] ?? null,
        getItem(key: string) {
            guard();

            return items.get(key) ?? null;
        },
        setItem(key: string, value: string) {
            guard();
            const previous = items.get(key);
            items.set(key, value);
            if (used() > storage.quota) {
                if (previous === undefined) {
                    items.delete(key);
                } else {
                    items.set(key, previous);
                }
                throw new DOMException('Stockage plein', 'QuotaExceededError');
            }
        },
        removeItem(key: string) {
            guard();
            items.delete(key);
        },
    };

    return storage;
}

/** Un stockage que le navigateur refuse d'ouvrir : y accéder lève, comme en navigation privée. */
export const blockedStorage = (): never => {
    throw new DOMException('Accès refusé', 'SecurityError');
};

/** Peu de contenus, pour que des voisins identiques se rencontrent souvent. */
export const CONTENTS: readonly Cell[] = [
    null,
    PAUSE,
    work('SHOP-482'),
    work('SHOP-482', 'Tests'),
    work('OPS-7'),
    work('OPS-7', 'Revue'),
];

export const cellArbitrary = fc.constantFrom(...CONTENTS);

export const quarterArbitrary = fc
    .integer({ min: 0, max: Quarter.COUNT - 1 })
    .map((index) => Quarter.FIRST + index * Quarter.MINUTES);

export const gridArbitrary = fc
    .array(cellArbitrary, { minLength: Quarter.COUNT, maxLength: Quarter.COUNT })
    .map((cells) =>
        Grid.of(
            cells.flatMap((content, index) =>
                content === null ? [] : [[Quarter.FIRST + index * Quarter.MINUTES, content] as const],
            ),
        ),
    );

/**
 * Les mêmes, et quelques-uns posés par deux récurrences, « a » et « b » : deux contenus égaux,
 * l'un à la main, l'autre d'une récurrence, ou de deux récurrences, se rencontrent souvent.
 * Le moteur ne vérifie pas qu'une récurrence n'a qu'un contenu : le serveur, si.
 */
export const LINKED_CONTENTS: readonly Cell[] = [
    ...CONTENTS,
    linkedTo(PAUSE, 'a'),
    work('SHOP-482', null, 'a'),
    work('SHOP-482', null, 'b'),
    work('OPS-7', 'Revue', 'b'),
];

export const linkedCellArbitrary = fc.constantFrom(...LINKED_CONTENTS);

export const linkedGridArbitrary = fc
    .array(linkedCellArbitrary, { minLength: Quarter.COUNT, maxLength: Quarter.COUNT })
    .map((cells) =>
        Grid.of(
            cells.flatMap((content, index) =>
                content === null ? [] : [[Quarter.FIRST + index * Quarter.MINUTES, content] as const],
            ),
        ),
    );
