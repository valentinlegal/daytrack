import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    CLIPBOARD_STORAGE_KEY,
    type Clipboard,
    clipboardOf,
    copy,
    copyQuarters,
    cutRecurrence,
    type CutSource,
    paste,
    storedClipboard,
    withoutRecurrence,
} from '../../../assets/grid/clipboard';
import { Grid, linkedTo, PAUSE, unlinked, work } from '../../../assets/grid/grid';
import * as Quarter from '../../../assets/grid/quarter';
import { LAST_WEEK, monthlyDate, monthlyWeekday, type RecurrenceRule, weekly } from '../../../assets/grid/recurrence';
import {
    EMPTY_SELECTION,
    type Selection,
    extendTo,
    selectQuarter,
    selectQuarters,
    toggleQuarter,
} from '../../../assets/grid/selection';
import {
    gridArbitrary,
    gridOf,
    linkedGridArbitrary,
    memoryStorage,
    minutes,
    quarterArbitrary,
    rangesOf,
} from './support';

const day = gridOf([
    ['09:00', '10:00', 'work', 'SHOP-482', 'Mapping'],
    ['10:30', '10:45', 'pause', null, null],
]);

/** La copie d'une sélection qui n'est pas vide. */
function copied(grid: Grid, selection: Selection): Clipboard {
    const clipboard = copy(grid, selection);
    if (clipboard === null) {
        throw new Error('La sélection est vide.');
    }

    return clipboard;
}

function pasted(grid: Grid, clipboard: Clipboard, ...times: string[]): Grid {
    const selection = selectQuarters(times.map(minutes));
    const result = paste(clipboard, selection);
    if (result.kind !== 'paste') {
        throw new Error(`Le collage a rendu ${result.kind}.`);
    }

    return grid.with(result.changes);
}

describe('copier', () => {
    it('garde la forme du groupe, créneaux vides compris', () => {
        const selection = extendTo(selectQuarter(minutes('09:45')), minutes('10:30'));

        expect(copy(day, selection)).toEqual({
            cells: [
                { offset: 0, content: work('SHOP-482', 'Mapping') },
                { offset: 1, content: null },
                { offset: 2, content: null },
                { offset: 3, content: PAUSE },
            ],
        });
    });

    it('laisse de côté ce que Ctrl/⌘+clic n’a pas sélectionné', () => {
        const selection = toggleQuarter(selectQuarter(minutes('09:00')), minutes('10:30'));

        expect(copy(day, selection)?.cells.map((cell) => cell.offset)).toEqual([0, 6]);
    });

    it('ne copie rien sans sélection', () => {
        expect(copy(day, EMPTY_SELECTION)).toBeNull();
    });

    it('ne copie pas une plage vide, même en morceaux', () => {
        expect(copy(day, extendTo(selectQuarter(minutes('10:00')), minutes('10:15')))).toBeNull();
        expect(copy(day, toggleQuarter(selectQuarter(minutes('08:00')), minutes('10:15')))).toBeNull();
    });
});

describe('coller', () => {
    it('colle le groupe à partir du créneau sélectionné, sur un autre jour aussi', () => {
        const clipboard = copied(day, extendTo(selectQuarter(minutes('09:00')), minutes('09:15')));

        expect(rangesOf(pasted(Grid.empty(), clipboard, '14:00'))).toEqual([
            ['14:00', '14:30', 'work', 'SHOP-482', 'Mapping'],
        ]);
    });

    it('efface ce que recouvre un créneau vide copié, et laisse ce qui était hors de la sélection', () => {
        const clipboard: Clipboard = {
            cells: [
                { offset: 0, content: PAUSE },
                { offset: 1, content: null },
                { offset: 3, content: PAUSE },
            ],
        };

        expect(rangesOf(pasted(day, clipboard, '09:15'))).toEqual([
            ['09:00', '09:15', 'work', 'SHOP-482', 'Mapping'],
            ['09:15', '09:30', 'pause', null, null],
            ['09:45', '10:00', 'work', 'SHOP-482', 'Mapping'],
            ['10:00', '10:15', 'pause', null, null],
            ['10:30', '10:45', 'pause', null, null],
        ]);
    });

    it('colle tout le groupe à partir du premier créneau sélectionné, même au-delà de la sélection', () => {
        const clipboard: Clipboard = {
            cells: [0, 1, 2, 3].map((offset) => ({ offset, content: work('OPS-7') })),
        };
        const result = paste(clipboard, selectQuarters([minutes('14:00'), minutes('14:15')]));

        expect(result).toEqual({
            kind: 'paste',
            changes: new Map([0, 1, 2, 3].map((offset) => [minutes('14:00') + offset * 15, work('OPS-7')])),
            quarters: [minutes('14:00'), minutes('14:15'), minutes('14:30'), minutes('14:45')],
        });
    });

    it('remplit chaque créneau sélectionné avec un seul créneau copié', () => {
        const selection = toggleQuarter(extendTo(selectQuarter(minutes('09:15')), minutes('09:30')), minutes('11:00'));
        const result = paste(clipboardOf(work('SHOP-519')), selection);

        expect(result).toEqual({
            kind: 'paste',
            changes: new Map(['09:15', '09:30', '11:00'].map((time) => [minutes(time), work('SHOP-519')])),
            quarters: [minutes('09:15'), minutes('09:30'), minutes('11:00')],
        });
    });

    it('refuse tout le groupe s’il déborde après 20:00', () => {
        const clipboard: Clipboard = {
            cells: [
                { offset: 0, content: PAUSE },
                { offset: 1, content: PAUSE },
            ],
        };

        expect(paste(clipboard, selectQuarter(minutes('19:45')))).toEqual({ kind: 'overflow' });
        expect(paste(clipboard, selectQuarter(minutes('19:30'))).kind).toBe('paste');
    });

    it('colle sur 19:45 un groupe dont seul le créneau vide dépasserait 20:00', () => {
        const clipboard: Clipboard = {
            cells: [
                { offset: 0, content: work('SHOP-519') },
                { offset: 1, content: null },
            ],
        };

        expect(paste(clipboard, selectQuarter(minutes('19:45')))).toEqual({
            kind: 'paste',
            changes: new Map([[minutes('19:45'), work('SHOP-519')]]),
            quarters: [minutes('19:45')],
        });
    });

    it('refuse un groupe dont un ticket dépasse après un créneau vide', () => {
        const clipboard: Clipboard = {
            cells: [
                { offset: 0, content: work('SHOP-519') },
                { offset: 1, content: null },
                { offset: 2, content: PAUSE },
            ],
        };

        expect(paste(clipboard, selectQuarter(minutes('19:30')))).toEqual({ kind: 'overflow' });
    });

    it('efface ce que le trou d’un groupe recouvre', () => {
        const clipboard: Clipboard = {
            cells: [
                { offset: 0, content: work('SHOP-519') },
                { offset: 1, content: null },
                { offset: 2, content: PAUSE },
            ],
        };

        const result = paste(clipboard, selectQuarter(minutes('09:00')));

        expect(result.kind === 'paste' && result.changes.get(minutes('09:15'))).toBeNull();
    });

    it('ne colle rien sans sélection', () => {
        expect(paste(clipboardOf(PAUSE), EMPTY_SELECTION)).toEqual({ kind: 'nothing' });
    });

    it('rend la même journée en recollant au même endroit ce qu’on vient de copier', () => {
        fc.assert(
            fc.property(gridArbitrary, fc.array(quarterArbitrary, { minLength: 1 }), (grid, quarters) => {
                const selection = selectQuarters(quarters);
                // Une plage vide ne se copie pas.
                fc.pre(quarters.some((quarter) => grid.at(quarter) !== null));
                const result = paste(copied(grid, selection), selection);

                expect(result.kind).toBe('paste');
                expect(result.kind === 'paste' && grid.with(result.changes).equals(grid)).toBe(true);
            }),
        );
    });

    it('reporte chaque créneau copié à son écart du point de départ', () => {
        fc.assert(
            fc.property(
                gridArbitrary,
                fc.array(quarterArbitrary, { minLength: 2 }),
                quarterArbitrary,
                (grid, quarters, target) => {
                    const selection = selectQuarters(quarters);
                    fc.pre(quarters.some((quarter) => grid.at(quarter) !== null));
                    const first = selection.quarters[0] ?? Quarter.FIRST;
                    const result = paste(copied(grid, selection), selectQuarter(target));

                    // Seul ce qui porte quelque chose déborde : un créneau vide au-delà de 20:00 n'efface rien.
                    const overflows = selection.quarters.some(
                        (quarter) => target + (quarter - first) > Quarter.LAST && grid.at(quarter) !== null,
                    );
                    if (selection.quarters.length > 1 && overflows) {
                        expect(result.kind).toBe('overflow');

                        return;
                    }
                    expect(result.kind).toBe('paste');
                    const after = result.kind === 'paste' ? Grid.empty().with(result.changes) : Grid.empty();
                    for (const quarter of selection.quarters) {
                        if (target + (quarter - first) <= Quarter.LAST) {
                            expect(after.at(target + quarter - first)).toEqual(grid.at(quarter));
                        }
                    }
                },
            ),
        );
    });
});

describe('le presse-papier de l’onglet', () => {
    it('survit à un rechargement', () => {
        const storage = memoryStorage();
        const clipboard = copied(day, extendTo(selectQuarter(minutes('09:45')), minutes('10:30')));
        storedClipboard(storage).write(clipboard);

        expect(storedClipboard(storage).read()).toEqual(clipboard);
    });

    it('vaut un presse-papier vide quand ce qui est rangé est de travers', () => {
        for (const stored of [
            'pas du JSON',
            'null',
            '[]',
            '{"cells":[]}',
            '{"cells":[{"offset":-1,"content":null}]}',
            '{"cells":[{"offset":52,"content":null}]}',
            '{"cells":[{"offset":0,"content":null},{"offset":0,"content":null}]}',
            '{"cells":[{"offset":0.5,"content":null}]}',
            '{"cells":[{"offset":0,"content":{"kind":"work"}}]}',
            '{"cells":[{"offset":0,"content":{"kind":"work","ticket":"SHOP-482","comment":7}}]}',
            '{"cells":[{"offset":0,"content":{"kind":"vacances"}}]}',
            '{"cells":[{"offset":0}]}',
        ]) {
            const storage = memoryStorage();
            storage.items.set(CLIPBOARD_STORAGE_KEY, stored);

            expect(storedClipboard(storage).read()).toBeNull();
        }
    });

    it('reste en mémoire quand le navigateur refuse le stockage', () => {
        const store = storedClipboard(memoryStorage({ refuse: true }));
        store.write(clipboardOf(PAUSE));

        expect(store.read()).toEqual(clipboardOf(PAUSE));
    });
});

describe('copier un bloc qui revient', () => {
    const linked = gridOf([
        ['09:00', '09:30', 'work', 'OPS-12', 'Daily', 'a'],
        ['12:30', '13:00', 'pause', null, null, 'b'],
    ]);

    it('ne garde pas la récurrence : ce qu’on colle est une saisie ordinaire', () => {
        const selection = selectQuarters([minutes('09:15'), minutes('12:30')]);

        expect(copied(linked, selection)).toEqual({
            cells: [
                { offset: 0, content: work('OPS-12', 'Daily') },
                { offset: 13, content: PAUSE },
            ],
        });
    });

    it('ne garde pas celle d’un contenu copié d’un clic, comme un favori', () => {
        expect(clipboardOf(work('OPS-12', 'Daily', 'a'))).toEqual(clipboardOf(work('OPS-12', 'Daily')));
        expect(clipboardOf(linkedTo(PAUSE, 'b'))).toEqual(clipboardOf(PAUSE));
    });

    it('recollé au même endroit, le bloc garde ce qu’il montre et perd son lien', () => {
        fc.assert(
            fc.property(linkedGridArbitrary, fc.array(quarterArbitrary, { minLength: 1 }), (grid, quarters) => {
                const selection = selectQuarters(quarters);
                fc.pre(quarters.some((quarter) => grid.at(quarter) !== null));
                const result = paste(copied(grid, selection), selection);
                if (result.kind !== 'paste') {
                    throw new Error(`Le collage a rendu ${result.kind}.`);
                }
                for (const [quarter, cell] of result.changes) {
                    const before = grid.at(quarter);
                    expect(cell === null ? before : unlinked(before ?? cell)).toEqual(cell);
                    expect(cell?.recurrence ?? null).toBeNull();
                }
            }),
        );
    });

    it('ne range jamais une récurrence dans l’onglet, ni n’en relit une écrite d’ailleurs', () => {
        const storage = memoryStorage();
        storedClipboard(storage).write(copied(linked, selectQuarters([minutes('09:00'), minutes('12:30')])));

        expect(storage.items.get(CLIPBOARD_STORAGE_KEY)).not.toMatch(/"recurrence":"[ab]"/);

        storage.items.set(
            CLIPBOARD_STORAGE_KEY,
            JSON.stringify({
                cells: [
                    { offset: 0, content: { kind: 'work', ticket: 'OPS-12', comment: 'Daily', recurrence: 'a' } },
                    { offset: 1, content: { kind: 'pause', recurrence: 'b' } },
                ],
            }),
        );
        expect(storedClipboard(storage).read()).toEqual({
            cells: [
                { offset: 0, content: work('OPS-12', 'Daily') },
                { offset: 1, content: PAUSE },
            ],
        });

        storage.items.set(
            CLIPBOARD_STORAGE_KEY,
            JSON.stringify({ cells: [{ offset: 0, content: { kind: 'pause', recurrence: 7 } }] }),
        );
        expect(storedClipboard(storage).read()).toBeNull();
    });
});

describe('couper un bloc qui revient avec les suivantes', () => {
    /** Le Daily de 09:00 à 09:30, un mardi sur deux ; et la pause de 12:30 à 13:00. */
    const day = gridOf([
        ['09:00', '09:30', 'work', 'OPS-12', 'Daily', 'a'],
        ['12:30', '13:00', 'pause', null, null, 'b'],
    ]);
    const RULE: RecurrenceRule = { ...weekly([2], 2), until: '2026-11-04' };
    const DAILY = [minutes('09:00'), minutes('09:15')];
    /** Coupée le mardi 6 octobre. */
    const SOURCE: CutSource = { id: '01900000-0000-7000-8000-000000000001', date: '2026-10-06' };

    function cut(grid: Grid, quarters: readonly number[], rule: RecurrenceRule = RULE): Clipboard {
        const clipboard = cutRecurrence(grid, quarters, rule, SOURCE);
        if (clipboard === null) {
            throw new Error('La fois ne se coupe pas.');
        }

        return clipboard;
    }

    it('emporte la fois, sans son lien, avec son rythme et sa fin, la récurrence coupée et le jour de la coupe', () => {
        expect(cut(day, DAILY)).toEqual({
            cells: [
                { offset: 0, content: work('OPS-12', 'Daily') },
                { offset: 1, content: work('OPS-12', 'Daily') },
            ],
            recurrence: RULE,
            source: SOURCE,
        });
    });

    it('n’emporte pas une fois qui a un trou', () => {
        expect(cutRecurrence(day, [minutes('09:00'), minutes('09:15'), minutes('09:30')], RULE, SOURCE)).toBeNull();
        expect(cutRecurrence(day, [minutes('08:45')], RULE, SOURCE)).toBeNull();
        expect(cutRecurrence(day, [], RULE, SOURCE)).toBeNull();
    });

    it('copier ne garde jamais la récurrence ; le premier collage la quitte, et d’où elle vient', () => {
        expect(copyQuarters(day, DAILY)).toEqual({ cells: cut(day, DAILY).cells });
        expect(withoutRecurrence(cut(day, DAILY))).toEqual({ cells: cut(day, DAILY).cells });
    });

    it('se colle à sa longueur, à partir du premier quart d’heure choisi, sans remplir la sélection', () => {
        const short = cut(day, [minutes('12:30')], { ...monthlyDate(16), until: null });
        const selection = extendTo(selectQuarter(minutes('15:00')), minutes('16:00'));

        expect(paste(short, selection)).toEqual({
            kind: 'paste',
            changes: new Map([[minutes('15:00'), PAUSE]]),
            quarters: [minutes('15:00')],
        });
        // Le même bloc, sans sa récurrence, remplit la sélection.
        expect(paste(withoutRecurrence(short), selection)).toMatchObject({
            quarters: Quarter.between(minutes('15:00'), minutes('16:15')),
        });
        expect(paste(cut(day, DAILY), selectQuarters([minutes('16:00'), minutes('18:00')]))).toEqual({
            kind: 'paste',
            changes: new Map([
                [minutes('16:00'), work('OPS-12', 'Daily')],
                [minutes('16:15'), work('OPS-12', 'Daily')],
            ]),
            quarters: [minutes('16:00'), minutes('16:15')],
        });
    });

    it('ne se colle pas s’il dépasse 20:00, et se colle jusqu’au bout de la journée', () => {
        expect(paste(cut(day, DAILY), selectQuarter(minutes('19:45')))).toEqual({ kind: 'overflow' });
        expect(paste(cut(day, DAILY), selectQuarter(minutes('19:30')))).toMatchObject({
            kind: 'paste',
            quarters: [minutes('19:30'), minutes('19:45')],
        });
        expect(paste(cut(day, DAILY), selectQuarter(Quarter.FIRST))).toMatchObject({
            quarters: [Quarter.FIRST, Quarter.FIRST + Quarter.MINUTES],
        });
    });

    it('se relit dans l’onglet comme le même objet, tant que rien d’autre n’y est écrit', () => {
        const store = storedClipboard(memoryStorage());
        const clipboard = cut(day, DAILY);
        store.write(clipboard);
        expect(store.read()).toBe(clipboard);
        // Le même contenu, copié de nouveau, est une autre écriture.
        store.write(cut(day, DAILY));
        expect(store.read()).not.toBe(clipboard);
    });

    it('se garde dans l’onglet avec son rythme, et se relit tel quel', () => {
        for (const rule of [
            RULE,
            { ...weekly([1, 2, 3, 4, 5]), until: null },
            { ...monthlyWeekday(5, 3), until: null },
            { ...monthlyWeekday(4, LAST_WEEK), until: '2027-01-31' },
            { ...monthlyDate(31), until: null },
        ]) {
            const storage = memoryStorage();
            const clipboard = cut(day, DAILY, rule);
            storedClipboard(storage).write(clipboard);

            expect(storedClipboard(storage).read()).toEqual(clipboard);
        }
    });

    it.each([
        ['un rythme d’une nature inconnue', { kind: 'daily' }],
        ['un jour 8', { weekdays: [8] }],
        ['aucun jour à la semaine', { weekdays: [] }],
        ['une semaine sur 5', { everyWeeks: 5 }],
        ['une semaine sur 1,5', { everyWeeks: 1.5 }],
        ['une fin qui n’existe pas', { until: '2026-02-30' }],
        ['une fin absente', { until: undefined }],
        ['un rang du mois sur une semaine', { monthWeek: 2 }],
        ['un rang 5', { kind: 'monthly_weekday', weekdays: [5], monthWeek: 5 }],
        ['deux jours au rang du mois', { kind: 'monthly_weekday', weekdays: [4, 5], monthWeek: 2 }],
        ['un rang une semaine sur deux', { kind: 'monthly_weekday', weekdays: [5], monthWeek: 2, everyWeeks: 2 }],
        ['un 32 du mois', { kind: 'monthly_date', weekdays: [], monthDay: 32 }],
        ['une date du mois avec des jours', { kind: 'monthly_date', weekdays: [1], monthDay: 3 }],
        ['un rythme qui n’est pas un objet', 'chaque mardi'],
    ])('se relit vide, plutôt qu’à moitié, avec %s', (_, broken) => {
        const storage = memoryStorage();
        const kept = JSON.parse(JSON.stringify(cut(day, DAILY))) as { recurrence: Record<string, unknown> };
        storage.items.set(
            CLIPBOARD_STORAGE_KEY,
            JSON.stringify({
                ...kept,
                recurrence: typeof broken === 'string' ? broken : { ...kept.recurrence, ...broken },
            }),
        );

        expect(storedClipboard(storage).read()).toBeNull();
    });

    it.each([
        ['sans la récurrence coupée ni le jour de la coupe', undefined],
        ['sans la récurrence coupée', { date: SOURCE.date }],
        ['sans le jour de la coupe', { id: SOURCE.id }],
        ['un identifiant qui n’est pas un UUID', { ...SOURCE, id: 'daily' }],
        ['un jour qui n’existe pas', { ...SOURCE, date: '2026-02-30' }],
        ['une source qui n’est pas un objet', SOURCE.id],
    ])('se relit vide, plutôt qu’à moitié, %s', (_, source) => {
        const storage = memoryStorage();
        const kept = JSON.parse(JSON.stringify(cut(day, DAILY))) as Record<string, unknown>;
        storage.items.set(CLIPBOARD_STORAGE_KEY, JSON.stringify({ ...kept, source }));

        expect(storedClipboard(storage).read()).toBeNull();
    });

    it('se relit vide avec la source d’une coupe, mais sans son rythme', () => {
        const storage = memoryStorage();
        storage.items.set(CLIPBOARD_STORAGE_KEY, JSON.stringify({ cells: cut(day, DAILY).cells, source: SOURCE }));

        expect(storedClipboard(storage).read()).toBeNull();
    });

    it.each([
        ['un trou', [0, 2]],
        ['un départ décalé', [1, 2]],
    ])('se relit vide, avec %s dans son bloc', (_, offsets) => {
        const storage = memoryStorage();
        const daily = { kind: 'work', ticket: 'OPS-12', comment: 'Daily' };
        storage.items.set(
            CLIPBOARD_STORAGE_KEY,
            JSON.stringify({
                cells: offsets.map((offset) => ({ offset, content: daily })),
                recurrence: RULE,
                source: SOURCE,
            }),
        );

        expect(storedClipboard(storage).read()).toBeNull();
    });

    it('se relit vide, avec deux contenus ou un créneau vide dans son bloc', () => {
        const storage = memoryStorage();
        for (const second of [{ kind: 'pause' }, null]) {
            storage.items.set(
                CLIPBOARD_STORAGE_KEY,
                JSON.stringify({
                    cells: [
                        { offset: 0, content: { kind: 'work', ticket: 'OPS-12', comment: 'Daily' } },
                        { offset: 1, content: second },
                    ],
                    recurrence: RULE,
                    source: SOURCE,
                }),
            );

            expect(storedClipboard(storage).read()).toBeNull();
        }
    });
});
