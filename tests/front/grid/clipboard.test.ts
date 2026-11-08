import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    CLIPBOARD_STORAGE_KEY,
    type Clipboard,
    clipboardOf,
    copy,
    paste,
    storedClipboard,
} from '../../../assets/grid/clipboard';
import { Grid, PAUSE, work } from '../../../assets/grid/grid';
import * as Quarter from '../../../assets/grid/quarter';
import {
    EMPTY_SELECTION,
    type Selection,
    extendTo,
    selectQuarter,
    selectQuarters,
    toggleQuarter,
} from '../../../assets/grid/selection';
import { gridArbitrary, gridOf, memoryStorage, minutes, quarterArbitrary, rangesOf } from './support';

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
