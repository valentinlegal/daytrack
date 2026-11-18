import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    Grid,
    linkedTo,
    normalizeCell,
    normalizeComment,
    normalizeTicket,
    PAUSE,
    sameCell,
    sameContent,
    unlinked,
    work,
} from '../../../assets/grid/grid';
import * as Quarter from '../../../assets/grid/quarter';
import { gridOf, linkedGridArbitrary, minutes, type Range, rangesOf, readCases } from './support';

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
            fc.property(linkedGridArbitrary, (grid) => {
                expect(Grid.fromBlocks(grid.blocks()).equals(grid)).toBe(true);
            }),
        );
    });

    it('découpe en blocs sans chevauchement, sans trou ni voisins identiques', () => {
        fc.assert(
            fc.property(linkedGridArbitrary, (grid) => {
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
            fc.property(linkedGridArbitrary, (grid) => {
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
            fc.property(linkedGridArbitrary, linkedGridArbitrary, (from, to) => {
                const changes = from.changesTo(to);

                expect(from.with(changes).equals(to)).toBe(true);
                for (const [quarter] of changes) {
                    expect(sameCell(from.at(quarter), to.at(quarter))).toBe(false);
                }
            }),
        );
    });

    it('rend chaque ticket de la journée une fois, dans l’ordre de la journée, sans les pauses', () => {
        const grid = gridOf([
            ['09:00', '10:00', 'work', 'SHOP-482', 'Revue'],
            ['10:00', '10:30', 'work', 'OPS-12', null],
            ['10:30', '11:00', 'pause', null, null],
            ['11:00', '11:30', 'work', 'SHOP-482', 'Suite'],
            ['19:45', '20:00', 'work', 'ESSAI-3', null],
        ]);

        expect(grid.tickets()).toEqual(['SHOP-482', 'OPS-12', 'ESSAI-3']);
        expect(Grid.empty().tickets()).toEqual([]);
        expect(gridOf([['09:00', '09:15', 'pause', null, null]]).tickets()).toEqual([]);
    });

    it('sait s’il a une pause, jusqu’au dernier quart d’heure', () => {
        expect(Grid.empty().hasPause()).toBe(false);
        expect(gridOf([['09:00', '18:00', 'work', 'SHOP-482', null]]).hasPause()).toBe(false);
        expect(gridOf([['07:00', '07:15', 'pause', null, null]]).hasPause()).toBe(true);
        expect(gridOf([['19:45', '20:00', 'pause', null, null]]).hasPause()).toBe(true);
        fc.assert(
            fc.property(linkedGridArbitrary, (grid) => {
                expect(grid.hasPause()).toBe(grid.blocks().some((block) => block.content.kind === 'pause'));
                expect(grid.tickets()).toEqual([
                    ...new Set(
                        grid.blocks().flatMap((block) => (block.content.kind === 'work' ? [block.content.ticket] : [])),
                    ),
                ]);
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

describe('le lien d’un quart d’heure à la récurrence qui l’a posé', () => {
    const daily = work('OPS-12', 'Daily');

    it('sépare deux contenus égaux de récurrences différentes, ou l’un à la main, et les lit pareil', () => {
        expect(sameCell(linkedTo(daily, 'a'), work('OPS-12', 'Daily', 'a'))).toBe(true);
        expect(sameCell(linkedTo(daily, 'a'), linkedTo(daily, 'b'))).toBe(false);
        expect(sameCell(linkedTo(daily, 'a'), daily)).toBe(false);
        expect(sameCell(linkedTo(PAUSE, 'a'), PAUSE)).toBe(false);

        expect(sameContent(linkedTo(daily, 'a'), linkedTo(daily, 'b'))).toBe(true);
        expect(sameContent(linkedTo(daily, 'a'), daily)).toBe(true);
        expect(sameContent(linkedTo(PAUSE, 'a'), PAUSE)).toBe(true);
        expect(sameContent(linkedTo(PAUSE, 'a'), daily)).toBe(false);
        expect(sameContent(daily, work('OPS-12', 'Revue'))).toBe(false);
    });

    it('se retire sans toucher au contenu, et rend le même contenu quand il ne change pas', () => {
        const linked = work('OPS-12', 'Daily', 'a');

        expect(unlinked(linked)).toEqual(daily);
        expect(unlinked(linkedTo(PAUSE, 'a'))).toEqual(PAUSE);
        expect(linkedTo(linked, 'a')).toBe(linked);
        expect(unlinked(PAUSE)).toBe(PAUSE);
        expect(linkedTo(PAUSE, 'b')).toEqual({ kind: 'pause', recurrence: 'b' });
    });

    it('survit à la réécriture du ticket et du commentaire', () => {
        expect(normalizeCell(work(' ops-12 ', 'Daily  du\u{a0}matin', 'a'))).toEqual(
            work('OPS-12', 'Daily du matin', 'a'),
        );
        expect(normalizeCell(linkedTo(PAUSE, 'a'))).toEqual(linkedTo(PAUSE, 'a'));
    });

    it('ne change rien au temps travaillé ni aux pauses : un quart d’heure lié compte une fois', () => {
        fc.assert(
            fc.property(linkedGridArbitrary, fc.integer({ min: 0, max: 1440 }), (grid, minute) => {
                const hand = Grid.of(
                    Quarter.all().flatMap((quarter) => {
                        const cell = grid.at(quarter);

                        return cell === null ? [] : [[quarter, unlinked(cell)] as const];
                    }),
                );

                expect(grid.workedMinutes()).toBe(hand.workedMinutes());
                expect(grid.workedBefore(minute)).toBe(hand.workedBefore(minute));
                expect(grid.isPauseAt(minute)).toBe(hand.isPauseAt(minute));
                expect(grid.tickets()).toEqual(hand.tickets());
                expect(grid.blocks().length).toBeGreaterThanOrEqual(hand.blocks().length);
            }),
        );
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

    it.each([
        // L'heure, puis le début de son quart d'heure et le premier qui commence à elle ou après.
        ['10:00', '10:00', '10:00'],
        ['10:01', '10:00', '10:15'],
        ['10:14', '10:00', '10:15'],
        ['10:15', '10:15', '10:15'],
        ['00:00', '00:00', '00:00'],
        ['06:59', '06:45', '07:00'],
        ['19:59', '19:45', '20:00'],
        ['23:59', '23:45', '00:00'],
    ])('arrondit %s au quart d’heure : %s vers le bas, %s vers le haut', (time, down, up) => {
        const minutes = Quarter.parse(time) ?? Number.NaN;

        expect(Quarter.floor(minutes)).toBe(Quarter.parse(down));
        // Minuit passé, le quart d'heure suivant est celui du lendemain : 24:00.
        expect(Quarter.ceil(minutes) % 1440).toBe(Quarter.parse(up));
    });

    it('arrondit une heure qui a des secondes, sans jamais dépasser un quart d’heure', () => {
        fc.assert(
            fc.property(fc.integer({ min: 0, max: 1440 * 60 }), (seconds) => {
                const minutes = seconds / 60;
                const down = Quarter.floor(minutes);
                const up = Quarter.ceil(minutes);

                expect(down % Quarter.MINUTES).toBe(0);
                expect(up % Quarter.MINUTES).toBe(0);
                expect(down).toBeLessThanOrEqual(minutes);
                expect(up).toBeGreaterThanOrEqual(minutes);
                expect(minutes - down).toBeLessThan(Quarter.MINUTES);
                expect(up - minutes).toBeLessThan(Quarter.MINUTES);
                expect(up - down).toBe(seconds % (Quarter.MINUTES * 60) === 0 ? 0 : Quarter.MINUTES);
            }),
        );
    });

    it('ne rend jamais -0 en arrondissant vers le haut une heure négative', () => {
        expect(Object.is(Quarter.ceil(-5), 0)).toBe(true);
        expect(Quarter.floor(-5)).toBe(-15);
    });
});
