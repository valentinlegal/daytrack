import { readFileSync } from 'node:fs';

import fc from 'fast-check';

import { type Cell, Grid, PAUSE, type SlotContent, work } from '../../../assets/grid/grid';
import * as Quarter from '../../../assets/grid/quarter';
import type { TabStorage } from '../../../assets/grid/tabStore';

/** Une plage telle que l'écrivent les cas partagés : début, fin, nature, ticket, commentaire. */
export type Range = readonly [string, string, 'work' | 'pause', string | null, string | null];

/** Les cas d'un fichier de tests/cases, que le serveur rejoue aussi. */
export function readCases(file: string): unknown[] {
    const json: unknown = JSON.parse(readFileSync(new URL(`../../cases/${file}`, import.meta.url), 'utf-8'));
    if (typeof json !== 'object' || json === null || !('cases' in json) || !Array.isArray(json.cases)) {
        throw new TypeError(`${file} n'a pas de cas.`);
    }

    return json.cases as unknown[];
}

export function minutes(time: string): number {
    const parsed = Quarter.parse(time);
    if (parsed === null) {
        throw new RangeError(`${time} n'est pas une heure.`);
    }

    return parsed;
}

export function contentOf(range: Range): SlotContent {
    return range[2] === 'pause' ? PAUSE : work(range[3] ?? '', range[4]);
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

/** Les blocs d'une grille, écrits comme dans les cas partagés. */
export function rangesOf(grid: Grid): Range[] {
    return grid
        .blocks()
        .map(({ start, end, content }) => [
            Quarter.format(start),
            Quarter.format(end),
            content.kind,
            content.kind === 'work' ? content.ticket : null,
            content.kind === 'work' ? content.comment : null,
        ]);
}

/**
 * Un stockage d'onglet en mémoire, qui peut tout refuser, comme un navigateur en
 * navigation privée, ou se remplir, comme un vrai : au-delà de `quota` caractères,
 * une écriture est refusée et laisse le stockage tel qu'il était.
 */
export function memoryStorage({ refuse = false } = {}): TabStorage & {
    items: Map<string, string>;
    quota: number;
    used: () => number;
} {
    const items = new Map<string, string>();
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
