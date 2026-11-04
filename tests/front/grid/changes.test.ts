import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { fill, type SlotChange, toSlotChanges } from '../../../assets/grid/changes';
import { type Cell, PAUSE, work } from '../../../assets/grid/grid';
import * as Quarter from '../../../assets/grid/quarter';
import { cellArbitrary, minutes, quarterArbitrary } from './support';

describe('toSlotChanges', () => {
    it('regroupe les quarts d’heure voisins qui prennent le même contenu', () => {
        const changes = new Map<number, Cell>([
            [minutes('09:15'), work('SHOP-482', 'Tests')],
            [minutes('09:00'), work('SHOP-482', 'Tests')],
            [minutes('09:30'), work('SHOP-482')],
            [minutes('10:00'), null],
            [minutes('10:15'), null],
            [minutes('11:00'), PAUSE],
        ]);

        expect(toSlotChanges(changes)).toEqual([
            { start: '09:00', end: '09:30', kind: 'work', ticket: 'SHOP-482', comment: 'Tests' },
            { start: '09:30', end: '09:45', kind: 'work', ticket: 'SHOP-482', comment: null },
            { start: '10:00', end: '10:30', kind: 'empty', ticket: null, comment: null },
            { start: '11:00', end: '11:15', kind: 'pause', ticket: null, comment: null },
        ]);
    });

    it('écrit le dernier quart d’heure jusqu’à 20:00', () => {
        expect(toSlotChanges(fill([Quarter.LAST], PAUSE))).toEqual([
            { start: '19:45', end: '20:00', kind: 'pause', ticket: null, comment: null },
        ]);
    });

    it('refuse ce qui n’est pas un quart d’heure de la grille', () => {
        expect(() => toSlotChanges(new Map([[Quarter.DAY_END, PAUSE]]))).toThrow(RangeError);
        expect(() => fill([Quarter.FIRST - Quarter.MINUTES], PAUSE)).toThrow(RangeError);
    });

    it('rend des créneaux ordonnés, sans recouvrement, qui disent exactement le geste', () => {
        fc.assert(
            fc.property(fc.array(fc.tuple(quarterArbitrary, cellArbitrary)), (pairs) => {
                const changes = new Map(pairs);
                const slots = toSlotChanges(changes);

                expect(slots.length).toBeLessThanOrEqual(Quarter.COUNT);
                expect(expand(slots)).toEqual(new Map([...changes].sort(([a], [b]) => a - b)));
                slots.forEach((slot, index) => {
                    const next = slots[index + 1];
                    if (next !== undefined) {
                        expect(minutes(next.start)).toBeGreaterThanOrEqual(minutes(slot.end));
                    }
                });
            }),
        );
    });
});

/** Ce que le serveur comprend des créneaux reçus, quart d'heure par quart d'heure. */
function expand(slots: readonly SlotChange[]): Map<number, Cell> {
    const quarters = new Map<number, Cell>();
    for (const slot of slots) {
        for (const quarter of Quarter.between(minutes(slot.start), minutes(slot.end))) {
            expect(quarters.has(quarter)).toBe(false);
            quarters.set(
                quarter,
                slot.kind === 'empty' ? null : slot.kind === 'pause' ? PAUSE : work(slot.ticket ?? '', slot.comment),
            );
        }
    }

    return quarters;
}
