import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { dayFigures } from '../../../assets/grid/figures';
import { work } from '../../../assets/grid/grid';
import * as Quarter from '../../../assets/grid/quarter';
import { gridArbitrary, gridOf, type Range, readCases } from './support';

interface FiguresCase {
    name: string;
    blocks: [string, string, 'work' | 'pause'][];
    objective: number;
    now: string | null;
    expected: { worked: number; remaining: number; balance: number; projectedEnd: string | null };
}

describe('les cas partagés avec le serveur', () => {
    const cases = readCases('day-figures.json') as FiguresCase[];

    it.each(cases)('$name', ({ blocks, objective, now, expected }) => {
        const grid = gridOf(blocks.map(([start, end, kind]): Range => [start, end, kind, 'SHOP-482', null]));
        const figures = dayFigures(grid, objective, now === null ? null : Quarter.parse(now));

        expect({
            ...figures,
            projectedEnd: figures.projectedEnd === null ? null : Quarter.format(figures.projectedEnd),
        }).toEqual(expected);
    });
});

describe('dayFigures', () => {
    const objective = fc.integer({ min: 0, max: 52 }).map((quarters) => quarters * Quarter.MINUTES);
    const now = fc.option(fc.integer({ min: 0, max: 1439 }));

    it('tient reste et solde à partir du travaillé et de l’objectif', () => {
        fc.assert(
            fc.property(gridArbitrary, objective, now, (grid, target, minute) => {
                const figures = dayFigures(grid, target, minute);

                expect(figures.worked).toBe(grid.workedMinutes());
                expect(figures.remaining).toBe(Math.max(0, target - figures.worked));
                expect(figures.balance).toBe(figures.worked - target);
            }),
        );
    });

    it('ne prévoit une fin que le jour même, avant minuit, tant qu’il reste du temps à faire', () => {
        fc.assert(
            fc.property(gridArbitrary, objective, now, (grid, target, minute) => {
                const { remaining, projectedEnd } = dayFigures(grid, target, minute);

                if (minute === null || remaining === 0) {
                    expect(projectedEnd).toBeNull();
                } else if (projectedEnd !== null) {
                    expect(projectedEnd).toBeGreaterThan(Math.max(minute, Quarter.FIRST));
                    expect(projectedEnd).toBeLessThan(1440);
                }
            }),
        );
    });

    it('prévoit la fin au premier quart d’heure où l’objectif est atteint, jamais avant', () => {
        fc.assert(
            fc.property(gridArbitrary, objective, fc.integer({ min: 0, max: 1439 }), (grid, target, minute) => {
                const { projectedEnd } = dayFigures(grid, target, minute);
                if (projectedEnd === null) {
                    return;
                }
                // Ce qui sera fait à une heure donnée en travaillant depuis le début du
                // créneau en cours, pauses posées exclues : la même règle, écrite autrement.
                const start = Math.max(minute - (minute % Quarter.MINUTES), Quarter.FIRST);
                const workedBy = (end: number) => {
                    let worked = grid.workedBefore(start);
                    for (let at = start; at < end; at += 1) {
                        worked += grid.isPauseAt(at) ? 0 : 1;
                    }

                    return worked;
                };

                expect(projectedEnd % Quarter.MINUTES).toBe(0);
                expect(workedBy(projectedEnd)).toBeGreaterThanOrEqual(target);
                expect(workedBy(projectedEnd - Quarter.MINUTES)).toBeLessThan(target);
            }),
        );
    });

    it('ne déplace pas la fin prévue quand on saisit le créneau en cours', () => {
        const inGrid = fc.integer({ min: Quarter.FIRST, max: Quarter.DAY_END - 1 });
        fc.assert(
            fc.property(gridArbitrary, objective, inGrid, (grid, target, minute) => {
                const current = minute - (minute % Quarter.MINUTES);
                fc.pre(grid.at(current) === null);
                const before = dayFigures(grid, target, minute);
                const after = dayFigures(grid.with(new Map([[current, work('SHOP-482', null)]])), target, minute);

                // Objectif atteint en le saisissant : la fin laisse place à « Objectif atteint ».
                if (after.remaining > 0) {
                    expect(after.projectedEnd).toBe(before.projectedEnd);
                }
            }),
        );
    });
});
