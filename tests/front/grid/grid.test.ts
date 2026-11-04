import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { Grid, normalizeComment, normalizeTicket, PAUSE, sameCell, work } from '../../../assets/grid/grid';
import * as Quarter from '../../../assets/grid/quarter';
import { gridArbitrary, gridOf, minutes, type Range, rangesOf, readCases } from './support';

describe('les cas partagés avec le serveur', () => {
    const cases = readCases('blocks.json') as { name: string; slots: Range[]; blocks: Range[] }[];

    it.each(cases)('$name', ({ slots, blocks }) => {
        expect(rangesOf(gridOf(slots))).toEqual(blocks);
    });
});

describe('la réécriture du ticket et du commentaire, partagée avec le serveur', () => {
    const cases = readCases('slot-text.json') as {
        name: string;
        ticket: string | null;
        comment: string | null;
        expected: { ticket: string | null; comment: string | null };
    }[];

    it.each(cases)('$name', ({ ticket, comment, expected }) => {
        expect({
            ticket: ticket === null ? null : normalizeTicket(ticket),
            comment: normalizeComment(comment),
        }).toEqual(expected);
    });
});

describe('Grid', () => {
    it('ne connaît que les quarts d’heure de 07:00 à 19:45', () => {
        for (const start of [Quarter.FIRST - Quarter.MINUTES, Quarter.DAY_END, 425, 420.5]) {
            expect(() => Grid.of([[start, PAUSE]])).toThrow(RangeError);
        }
        expect(
            Grid.of([
                [Quarter.FIRST, PAUSE],
                [Quarter.LAST, PAUSE],
            ]).blocks(),
        ).toHaveLength(2);
    });

    it('refuse deux blocs du serveur qui se recouvrent', () => {
        const blocks = [
            { start: minutes('09:00'), end: minutes('10:00'), content: work('SHOP-482') },
            { start: minutes('09:45'), end: minutes('10:15'), content: PAUSE },
        ];

        expect(() => Grid.fromBlocks(blocks)).toThrow(RangeError);
    });

    it('refuse un bloc du serveur qui déborde ou finit avant son début', () => {
        for (const [start, end] of [
            ['19:45', '20:15'],
            ['10:00', '10:00'],
            ['10:00', '09:45'],
            ['06:45', '07:15'],
        ] as const) {
            const block = { start: minutes(start), end: minutes(end), content: PAUSE };

            expect(() => Grid.fromBlocks([block])).toThrow(RangeError);
        }
    });

    it('rend ses blocs tels qu’il les a reçus', () => {
        fc.assert(
            fc.property(gridArbitrary, (grid) => {
                expect(Grid.fromBlocks(grid.blocks()).equals(grid)).toBe(true);
            }),
        );
    });

    it('découpe en blocs sans chevauchement, sans trou ni voisins identiques', () => {
        fc.assert(
            fc.property(gridArbitrary, (grid) => {
                const blocks = grid.blocks();
                blocks.forEach((block, index) => {
                    const next = blocks[index + 1];
                    expect(block.end).toBeGreaterThan(block.start);
                    if (next !== undefined) {
                        expect(next.start).toBeGreaterThanOrEqual(block.end);
                        expect(next.start > block.end || !sameCell(next.content, block.content)).toBe(true);
                    }
                    for (const quarter of Quarter.between(block.start, block.end)) {
                        expect(grid.at(quarter)).toEqual(block.content);
                    }
                });
                const covered = blocks.reduce((total, block) => total + (block.end - block.start), 0);
                const occupied = Quarter.all().filter((quarter) => grid.at(quarter) !== null).length;
                expect(covered).toBe(occupied * Quarter.MINUTES);
            }),
        );
    });

    it('compte dans le travaillé la somme des blocs de travail, jamais une pause', () => {
        fc.assert(
            fc.property(gridArbitrary, (grid) => {
                const worked = grid
                    .blocks()
                    .filter((block) => block.content.kind === 'work')
                    .reduce((total, block) => total + block.end - block.start, 0);

                expect(grid.workedMinutes()).toBe(worked);
            }),
        );
    });

    it('trouve le bloc d’un quart d’heure, ou rien sur un créneau vide', () => {
        const grid = gridOf([['09:00', '10:00', 'work', 'SHOP-482', null]]);

        expect(grid.blockAt(minutes('09:30'))).toEqual({
            start: minutes('09:00'),
            end: minutes('10:00'),
            content: work('SHOP-482'),
        });
        expect(grid.blockAt(minutes('10:00'))).toBeNull();
    });

    it('passe d’une grille à l’autre par ce qui les sépare, et rien d’autre', () => {
        fc.assert(
            fc.property(gridArbitrary, gridArbitrary, (from, to) => {
                const changes = from.changesTo(to);

                expect(from.with(changes).equals(to)).toBe(true);
                for (const [quarter] of changes) {
                    expect(sameCell(from.at(quarter), to.at(quarter))).toBe(false);
                }
            }),
        );
    });

    it('ne change pas : un geste rend une nouvelle grille', () => {
        const grid = Grid.empty();
        const filled = grid.with(new Map([[minutes('09:00'), PAUSE]]));

        expect(grid.at(minutes('09:00'))).toBeNull();
        expect(filled.at(minutes('09:00'))).toEqual(PAUSE);
    });
});

describe('Quarter', () => {
    it('lit et écrit une heure, et refuse ce qui n’en est pas une', () => {
        expect(Quarter.parse('09:15')).toBe(555);
        expect(Quarter.format(555)).toBe('09:15');
        for (const time of ['9:15', '24:00', '09:60', '09h15', '', ' 09:15']) {
            expect(Quarter.parse(time)).toBeNull();
        }
    });

    it('compte 52 quarts d’heure, de 07:00 à 19:45', () => {
        expect(Quarter.all()).toHaveLength(52);
        expect(Quarter.all().at(0)).toBe(Quarter.FIRST);
        expect(Quarter.all().at(-1)).toBe(Quarter.LAST);
    });
});
