import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Tense } from '../../../assets/day/calendar';
import { figuresLine } from '../../../assets/day/figuresLine';
import { dayFigures } from '../../../assets/grid/figures';
import * as Quarter from '../../../assets/grid/quarter';
import { gridArbitrary, gridOf, type Range } from '../grid/support';

const worked = (ranges: [string, string][]) =>
    gridOf(ranges.map(([start, end]): Range => [start, end, 'work', 'SHOP-482', null]));

describe('figuresLine', () => {
    it('le jour en cours, sous l’objectif : le reste et la fin prévue', () => {
        const grid = worked([['09:00', '14:00']]);
        const line = figuresLine(dayFigures(grid, 450, 920), 450, 'today');

        expect(line).toEqual({
            working: true,
            declaredOff: false,
            worked: 300,
            objective: 450,
            progress: 300 / 450,
            reached: false,
            tail: { kind: 'remaining', remaining: 150, projectedEnd: 1065 },
        });
    });

    it('un jour non travaillé : ni objectif ni barre, tout compte en plus', () => {
        const grid = gridOf([
            ['09:00', '12:00', 'work', 'OPS-7', null],
            ['12:00', '13:00', 'pause', null, null],
        ]);
        for (const tense of ['past', 'today', 'future'] satisfies Tense[]) {
            const line = figuresLine(dayFigures(grid, 0, tense === 'today' ? 920 : null), 0, tense, false);

            expect(line).toMatchObject({ working: false, worked: 180, tail: { kind: 'balance', balance: 180 } });
        }
        expect(figuresLine(dayFigures(worked([]), 0, null), 0, 'past', false)).toMatchObject({
            working: false,
            worked: 0,
        });
    });

    it('un jour mis à 0h00 : l’objectif sans barre, « Jour non travaillé » tant que rien n’y est travaillé', () => {
        for (const tense of ['past', 'today', 'future'] satisfies Tense[]) {
            const now = tense === 'today' ? 920 : null;
            expect(figuresLine(dayFigures(worked([]), 0, now), 0, tense, true, true)).toMatchObject({
                working: true,
                declaredOff: true,
                objective: 0,
                tail: { kind: 'off' },
            });
            const pause = gridOf([['12:00', '13:00', 'pause', null, null]]);
            expect(figuresLine(dayFigures(pause, 0, now), 0, tense, true, true).tail).toEqual({ kind: 'off' });
            expect(figuresLine(dayFigures(worked([['09:00', '10:30']]), 0, now), 0, tense, true, true)).toMatchObject({
                declaredOff: true,
                worked: 90,
                tail: { kind: 'balance', balance: 90 },
            });
        }
    });

    it('un objectif à 0h00 qui ne déclare rien, ou un samedi mis à 0h00 : comme avant', () => {
        expect(figuresLine(dayFigures(worked([]), 0, null), 0, 'past').tail).toEqual({ kind: 'reached' });
        expect(figuresLine(dayFigures(worked([]), 0, null), 0, 'past', false, true)).toMatchObject({
            working: false,
            declaredOff: false,
            tail: { kind: 'balance', balance: 0 },
        });
    });

    it('le jour en cours, encore vide : le reste seul, sans fin prévue', () => {
        const line = figuresLine(dayFigures(worked([]), 450, 520), 450, 'today');

        expect(line.tail).toEqual({ kind: 'remaining', remaining: 450, projectedEnd: null });
    });

    it('le jour en cours, passé minuit pour la fin : le reste seul', () => {
        const line = figuresLine(dayFigures(worked([['09:00', '09:15']]), 450, 1400), 450, 'today');

        expect(line.tail).toEqual({ kind: 'remaining', remaining: 435, projectedEnd: null });
    });

    it('un jour à venir : le reste, sans fin prévue', () => {
        const line = figuresLine(dayFigures(worked([]), 450, null), 450, 'future');

        expect(line.tail).toEqual({ kind: 'remaining', remaining: 450, projectedEnd: null });
    });

    it('un jour passé sous l’objectif, vide compris : le solde négatif', () => {
        expect(figuresLine(dayFigures(worked([['09:00', '15:45']]), 450, null), 450, 'past').tail).toEqual({
            kind: 'balance',
            balance: -45,
        });
        expect(figuresLine(dayFigures(worked([]), 450, null), 450, 'past').tail).toEqual({
            kind: 'balance',
            balance: -450,
        });
    });

    it('pile sur l’objectif : atteint, quel que soit le jour', () => {
        for (const tense of ['past', 'today', 'future'] as const) {
            const line = figuresLine(dayFigures(worked([['09:00', '16:30']]), 450, null), 450, tense);

            expect(line.tail).toEqual({ kind: 'reached' });
            expect(line.reached).toBe(true);
            expect(line.progress).toBe(1);
        }
    });

    it('au-dessus : le solde positif, la barre pleine', () => {
        const line = figuresLine(dayFigures(worked([['09:00', '17:15']]), 450, 1120), 450, 'today');

        expect(line.tail).toEqual({ kind: 'balance', balance: 45 });
        expect(line.progress).toBe(1);
    });

    it('un objectif à zéro est atteint d’office, sans division par zéro', () => {
        expect(figuresLine(dayFigures(worked([]), 0, 600), 0, 'today')).toMatchObject({
            progress: 1,
            reached: true,
            tail: { kind: 'reached' },
        });
        expect(figuresLine(dayFigures(worked([['09:00', '10:00']]), 0, null), 0, 'past').tail).toEqual({
            kind: 'balance',
            balance: 60,
        });
    });

    it('ne recalcule rien : il montre les chiffres de dayFigures', () => {
        const tenses = fc.constantFrom<Tense>('past', 'today', 'future');
        const objectives = fc.integer({ min: 0, max: 52 }).map((quarters) => quarters * Quarter.MINUTES);

        fc.assert(
            fc.property(
                gridArbitrary,
                objectives,
                fc.integer({ min: 0, max: 1439 }),
                tenses,
                (grid, objective, minute, tense) => {
                    const figures = dayFigures(grid, objective, tense === 'today' ? minute : null);
                    const line = figuresLine(figures, objective, tense);

                    expect(line.worked).toBe(figures.worked);
                    expect(line.progress).toBeGreaterThanOrEqual(0);
                    expect(line.progress).toBeLessThanOrEqual(1);
                    expect(line.reached).toBe(figures.worked >= objective);
                    switch (line.tail.kind) {
                        case 'remaining':
                            expect(tense).not.toBe('past');
                            expect(line.tail.remaining).toBe(figures.remaining);
                            expect(line.tail.projectedEnd).toBe(
                                tense === 'today' && figures.worked > 0 ? figures.projectedEnd : null,
                            );
                            break;
                        case 'reached':
                            expect(figures.balance).toBe(0);
                            break;
                        case 'balance':
                            expect(line.tail.balance).toBe(figures.balance);
                            expect(figures.balance > 0 || tense === 'past').toBe(true);
                            break;
                    }
                },
            ),
        );
    });
});
