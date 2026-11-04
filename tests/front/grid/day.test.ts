import { describe, expect, it } from 'vitest';

import { readDay } from '../../../assets/grid/day';
import { rangesOf } from './support';

const day = {
    date: '2026-10-06',
    version: 3,
    objective: 450,
    habitualObjective: 450,
    working: true,
    declaredOff: false,
    workingDays: [1, 2, 3, 4, 5],
    blocks: [
        { start: '09:15', end: '11:15', kind: 'work', ticket: 'SHOP-482', comment: 'Mapping' },
        { start: '12:30', end: '13:30', kind: 'pause', ticket: null, comment: null },
    ],
    figures: { worked: 120, remaining: 330, balance: -330, projectedEnd: '17:00' },
    send: { state: 'nothing', sentAt: null, attemptedAt: null, failure: null, inJira: {}, outcomes: {}, removed: [] },
};

describe('readDay', () => {
    it('lit une journée rendue par l’API', () => {
        const read = readDay(day);

        expect(read).toMatchObject({
            date: '2026-10-06',
            version: 3,
            objective: 450,
            habitualObjective: 450,
            working: true,
            declaredOff: false,
            workingDays: [1, 2, 3, 4, 5],
        });
        expect(rangesOf(read.grid)).toEqual([
            ['09:15', '11:15', 'work', 'SHOP-482', 'Mapping'],
            ['12:30', '13:30', 'pause', null, null],
        ]);
    });

    it('lit un jour non travaillé, et des réglages sans aucun jour travaillé', () => {
        expect(readDay({ ...day, working: false, objective: 0, workingDays: [] })).toMatchObject({
            working: false,
            objective: 0,
            workingDays: [],
        });
    });

    it('lit un jour mis à 0h00, qui reste travaillé selon les réglages', () => {
        expect(readDay({ ...day, objective: 0, declaredOff: true })).toMatchObject({
            working: true,
            declaredOff: true,
            objective: 0,
        });
    });

    it('accepte un objectif de 0h00 à 13h00', () => {
        expect(readDay({ ...day, objective: 0 }).objective).toBe(0);
        expect(readDay({ ...day, objective: 780 }).objective).toBe(780);
    });

    it('refuse une journée de travers plutôt que de l’afficher', () => {
        const block = day.blocks[0];
        for (const broken of [
            null,
            [],
            { ...day, date: '6 octobre' },
            { ...day, version: -1 },
            { ...day, version: 1.5 },
            { ...day, objective: 1e9 },
            { ...day, objective: 795 },
            { ...day, objective: 7 },
            { ...day, habitualObjective: '7h30' },
            { ...day, working: 'oui' },
            { ...day, working: undefined },
            { ...day, declaredOff: 'non' },
            { ...day, declaredOff: undefined },
            { ...day, workingDays: undefined },
            { ...day, workingDays: [0] },
            { ...day, workingDays: [8] },
            { ...day, workingDays: [1, 1] },
            { ...day, workingDays: [1.5] },
            { ...day, workingDays: ['lundi'] },
            { ...day, blocks: 'aucun' },
            { ...day, blocks: [{ ...block, start: '9:15' }] },
            { ...day, blocks: [{ ...block, end: '20:15' }] },
            { ...day, blocks: [{ ...block, kind: 'vacances' }] },
            { ...day, blocks: [{ ...block, ticket: null }] },
            { ...day, blocks: [{ ...block, comment: 7 }] },
            { ...day, blocks: [block, { ...block, start: '10:00', end: '10:30' }] },
        ]) {
            expect(() => readDay(broken)).toThrow();
        }
    });
});
