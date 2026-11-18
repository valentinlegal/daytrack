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
    readUntils,
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
            untils: [],
        });
        const back = undone(history, before);
        expect(back.undo).toHaveLength(0);
        expect(planRedo(back, before)).toEqual({
            kind: 'changes',
            changes: new Map([
                [nine, PAUSE],
                [quarterPast, PAUSE],
            ]),
            untils: [],
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

describe('les récurrences dans l’historique', () => {
    const daily = work('OPS-12', 'Daily', 'a');
    const linked = Grid.empty().with(fill([nine, quarterPast], daily));
    /** Un quart d'heure effacé : la fois entière se détache, l'autre garde son contenu sans lien. */
    const detached = linked.with(
        new Map([
            [nine, null],
            [quarterPast, work('OPS-12', 'Daily')],
        ]),
    );
    /** La fenêtre a créé la récurrence « a » : elle finissait la veille de son premier jour. */
    const created: Step = {
        quarters: [nine, quarterPast],
        before: [null, null],
        after: [daily, daily],
        untils: [{ recurrence: 'a', before: '2026-10-05', after: null }],
    };

    it('range un lien perdu comme un changement, même quand le contenu reste', () => {
        expect(stepBetween(linked, detached, [nine, quarterPast])).toEqual({
            quarters: [nine, quarterPast],
            before: [daily, daily],
            after: [null, work('OPS-12', 'Daily')],
        });
    });

    it('rend le lien en annulant, et le reprend en rétablissant', () => {
        const step = stepBetween(linked, detached, [nine, quarterPast]);
        if (step === null) {
            throw new Error('Le geste n’a rien changé.');
        }
        const history = record(EMPTY_HISTORY, step);

        expect(planUndo(history, detached)).toEqual({
            kind: 'changes',
            changes: new Map([
                [nine, daily],
                [quarterPast, daily],
            ]),
            untils: [],
        });
        expect(planRedo(undone(history, linked), linked)).toEqual({
            kind: 'changes',
            changes: new Map([
                [nine, null],
                [quarterPast, work('OPS-12', 'Daily')],
            ]),
            untils: [],
        });
    });

    it('rend les fins d’avant en annulant, celles d’après en rétablissant, chacune si elle n’a pas bougé', () => {
        const history = record(EMPTY_HISTORY, created);

        expect(planUndo(history, linked)).toEqual({
            kind: 'changes',
            changes: new Map([
                [nine, null],
                [quarterPast, null],
            ]),
            untils: [{ recurrence: 'a', from: null, to: '2026-10-05' }],
        });
        const back = undone(history, Grid.empty());
        expect(back.redo.at(-1)?.untils).toEqual(created.untils);
        expect(planRedo(back, Grid.empty())).toEqual({
            kind: 'changes',
            changes: new Map([
                [nine, daily],
                [quarterPast, daily],
            ]),
            untils: [{ recurrence: 'a', from: '2026-10-05', to: null }],
        });
        expect(redone(back, linked)).toEqual(history);
    });

    it('défait un geste qui n’a changé qu’une fin, sans quart d’heure à rendre', () => {
        const history = record(EMPTY_HISTORY, {
            quarters: [],
            before: [],
            after: [],
            untils: [{ recurrence: 'a', before: null, after: '2026-11-04' }],
        });

        expect(planUndo(history, linked)).toEqual({
            kind: 'changes',
            changes: new Map(),
            untils: [{ recurrence: 'a', from: '2026-11-04', to: null }],
        });
    });

    it('refuse d’annuler quand un autre onglet a détaché la fois, même sans en changer le contenu', () => {
        const history = record(EMPTY_HISTORY, created);
        const elsewhere = linked.with(fill([nine, quarterPast], work('OPS-12', 'Daily')));

        expect(planUndo(history, elsewhere)).toEqual({ kind: 'conflict' });
    });

    it('garde les liens et les fins dans le stockage de l’onglet', () => {
        const storage = memoryStorage();
        const step = stepBetween(linked, detached, [nine, quarterPast]);
        if (step === null) {
            throw new Error('Le geste n’a rien changé.');
        }
        const history: History = { undo: [step, created], redo: [{ ...created, quarters: [], before: [], after: [] }] };
        storedHistory(storage).write('2026-10-06', history);

        expect(storedHistory(storage).read('2026-10-06')).toEqual(history);
    });

    it('range avec le geste à rétablir la fois qu’annuler a rendue à sa série sans l’écrire, sur une journée qui n’en reçoit pas', () => {
        const erased: Step = { quarters: [nine, quarterPast], before: [daily, daily], after: [null, null] };
        const history = record(EMPTY_HISTORY, erased);

        // Mise à 0h00 : la grille ne la montre pas après l'annulation.
        const off = undone(history, Grid.empty(), true);
        expect(off.redo.at(-1)?.detaches).toEqual(['a']);
        expect(planRedo(off, Grid.empty())).toEqual({
            kind: 'changes',
            changes: new Map([
                [nine, null],
                [quarterPast, null],
            ]),
            untils: [],
            detaches: ['a'],
        });
        // Rétablie, elle ne l'est plus : la prochaine annulation en décide de nouveau.
        expect(redone(off, Grid.empty()).undo.at(-1)?.detaches).toBeUndefined();
        // Une journée ordinaire montre ce qu'annuler relie : rien à détacher.
        expect(undone(history, linked, true).redo.at(-1)?.detaches).toBeUndefined();
        expect(undone(history, Grid.empty()).redo.at(-1)?.detaches).toBeUndefined();

        const storage = memoryStorage();
        storedHistory(storage).write('2026-10-06', off);
        expect(storedHistory(storage).read('2026-10-06')).toEqual(off);
    });

    it('vaut un historique vide quand un lien ou une fin rangés sont de travers', () => {
        const valid = { quarters: [nine], before: [null], after: [{ kind: 'pause', recurrence: 'a' }] };
        const until = { recurrence: 'a', before: null, after: '2026-11-04' };
        for (const step of [
            { ...valid, after: [{ kind: 'pause', recurrence: 7 }] },
            { ...valid, after: [{ kind: 'work', ticket: 'OPS-12', comment: null, recurrence: false }] },
            { ...valid, untils: {} },
            { ...valid, untils: [{ ...until, recurrence: 7 }] },
            { ...valid, untils: [{ ...until, before: 'demain' }] },
            { ...valid, untils: [{ ...until, after: undefined }] },
            { ...valid, untils: ['a'] },
            { ...valid, detaches: 'a' },
            { ...valid, detaches: [7] },
            { quarters: [], before: [], after: [], untils: [] },
        ]) {
            const storage = memoryStorage();
            storage.items.set(`${HISTORY_STORAGE_PREFIX}2026-10-06`, JSON.stringify({ undo: [step], redo: [] }));

            expect(storedHistory(storage).read('2026-10-06')).toEqual(EMPTY_HISTORY);
        }
    });

    it('lit un contenu sans récurrence dite comme posé à la main', () => {
        const storage = memoryStorage();
        storage.items.set(
            `${HISTORY_STORAGE_PREFIX}2026-10-06`,
            JSON.stringify({
                undo: [
                    { quarters: [nine], before: [null], after: [{ kind: 'work', ticket: 'OPS-12', comment: null }] },
                ],
                redo: [],
            }),
        );

        expect(storedHistory(storage).read('2026-10-06').undo[0]?.after).toEqual([work('OPS-12')]);
    });
});

describe('readUntils', () => {
    it('ne rend aucune fin pour un geste de la grille, et lit celles que rend le serveur', () => {
        expect(readUntils(undefined)).toEqual([]);
        expect(readUntils([])).toEqual([]);
        expect(
            readUntils([
                { recurrence: 'a', before: '2026-10-05', after: null },
                { recurrence: 'b', before: null, after: '2026-11-04' },
            ]),
        ).toEqual([
            { recurrence: 'a', before: '2026-10-05', after: null },
            { recurrence: 'b', before: null, after: '2026-11-04' },
        ]);
    });

    it('ne lit pas ce qui n’en a pas la forme', () => {
        for (const json of [
            null,
            'a',
            {},
            [null],
            [{ recurrence: 'a', before: null }],
            [{ recurrence: null, before: null, after: null }],
            [{ recurrence: 'a', before: '5 octobre', after: null }],
        ]) {
            expect(readUntils(json)).toBeUndefined();
        }
    });
});
