import { describe, expect, it } from 'vitest';

import { fill } from '../../../assets/grid/changes';
import { Grid, PAUSE, work } from '../../../assets/grid/grid';
import {
    EMPTY_HISTORY,
    HISTORY_STORAGE_PREFIX,
    type History,
    LIMIT,
    planRedo,
    planUndo,
    record,
    redone,
    type Step,
    stepBetween,
    storedHistory,
    undone,
} from '../../../assets/grid/history';
import { memoryStorage, minutes } from './support';

const nine = minutes('09:00');
const quarterPast = minutes('09:15');
const before = Grid.empty().with(fill([nine], work('SHOP-482')));
const after = before.with(fill([nine, quarterPast], PAUSE));

function step(): Step {
    const between = stepBetween(before, after, [nine, quarterPast]);
    if (between === null) {
        throw new Error('Le geste n’a rien changé.');
    }

    return between;
}

describe('stepBetween', () => {
    it('ne garde que les quarts d’heure qui ont changé', () => {
        expect(stepBetween(before, after, [nine, quarterPast, minutes('10:00')])).toEqual({
            quarters: [nine, quarterPast],
            before: [work('SHOP-482'), null],
            after: [PAUSE, PAUSE],
        });
    });

    it('ne range rien pour un geste qui ne change rien', () => {
        expect(stepBetween(before, before, [nine])).toBeNull();
    });
});

describe('record', () => {
    it('garde les 50 derniers gestes et vide rétablir', () => {
        let history: History = { undo: [], redo: [step()] };
        for (let index = 0; index < LIMIT + 5; index += 1) {
            history = record(history, { ...step(), quarters: [nine, quarterPast], before: [null, null] });
        }

        expect(history.undo).toHaveLength(LIMIT);
        expect(history.redo).toHaveLength(0);
    });
});

describe('annuler et rétablir', () => {
    it('rend aux quarts d’heure leur valeur d’avant, puis celle d’après', () => {
        const history = record(EMPTY_HISTORY, step());
        const undo = planUndo(history, after);

        expect(undo).toEqual({
            kind: 'changes',
            changes: new Map([
                [nine, work('SHOP-482')],
                [quarterPast, null],
            ]),
        });
        const back = undone(history, before);
        expect(back.undo).toHaveLength(0);
        expect(planRedo(back, before)).toEqual({
            kind: 'changes',
            changes: new Map([
                [nine, PAUSE],
                [quarterPast, PAUSE],
            ]),
        });
        expect(redone(back, after)).toEqual(history);
    });

    it('refuse d’annuler quand un quart d’heure du geste a changé ailleurs', () => {
        const elsewhere = after.with(fill([quarterPast], work('OPS-7')));

        expect(planUndo(record(EMPTY_HISTORY, step()), elsewhere)).toEqual({ kind: 'conflict' });
        expect(planRedo(undone(record(EMPTY_HISTORY, step()), before), elsewhere)).toEqual({ kind: 'conflict' });
    });

    it('annule malgré ce qui a changé ailleurs, hors des quarts d’heure du geste', () => {
        const elsewhere = after.with(fill([minutes('14:00')], work('OPS-7')));

        expect(planUndo(record(EMPTY_HISTORY, step()), elsewhere).kind).toBe('changes');
    });

    it('ne fait rien sans geste à annuler ou à rétablir', () => {
        expect(planUndo(EMPTY_HISTORY, after)).toEqual({ kind: 'nothing' });
        expect(planRedo(EMPTY_HISTORY, after)).toEqual({ kind: 'nothing' });
        expect(undone(EMPTY_HISTORY, after)).toBe(EMPTY_HISTORY);
        expect(redone(EMPTY_HISTORY, after)).toBe(EMPTY_HISTORY);
    });
});

describe('l’historique de l’onglet', () => {
    it('survit à un rechargement, une journée à la fois', () => {
        const storage = memoryStorage();
        storedHistory(storage).write('2026-10-06', record(EMPTY_HISTORY, step()));

        expect(storedHistory(storage).read('2026-10-06')).toEqual(record(EMPTY_HISTORY, step()));
        expect(storedHistory(storage).read('2026-10-07')).toEqual(EMPTY_HISTORY);
    });

    it('vaut un historique vide quand ce qui est rangé est de travers', () => {
        const valid = { quarters: [nine], before: [null], after: [{ kind: 'pause' }] };
        for (const stored of [
            'pas du JSON',
            'null',
            '[]',
            JSON.stringify({ undo: [valid] }),
            JSON.stringify({ undo: [{ ...valid, quarters: [], before: [], after: [] }], redo: [] }),
            JSON.stringify({ undo: [{ ...valid, quarters: [nine + 5] }], redo: [] }),
            JSON.stringify({
                undo: [{ ...valid, quarters: [nine, nine], before: [null, null], after: [null, null] }],
                redo: [],
            }),
            JSON.stringify({ undo: [{ ...valid, before: [] }], redo: [] }),
            JSON.stringify({ undo: [{ ...valid, after: [{ kind: 'vacances' }] }], redo: [] }),
            JSON.stringify({ undo: Array.from({ length: LIMIT + 1 }, () => valid), redo: [] }),
        ]) {
            const storage = memoryStorage();
            storage.items.set(`${HISTORY_STORAGE_PREFIX}2026-10-06`, stored);

            expect(storedHistory(storage).read('2026-10-06')).toEqual(EMPTY_HISTORY);
        }
    });

    it('reste en mémoire quand le navigateur refuse le stockage', () => {
        const store = storedHistory(memoryStorage({ refuse: true }));
        store.write('2026-10-06', record(EMPTY_HISTORY, step()));

        expect(store.read('2026-10-06')).toEqual(record(EMPTY_HISTORY, step()));
    });
});
