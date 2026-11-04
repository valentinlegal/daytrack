import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import * as Quarter from '../../../assets/grid/quarter';
import {
    deselect,
    EMPTY_SELECTION,
    extendTo,
    isSelected,
    moveSelection,
    type Selection,
    selectionRuns,
    selectQuarter,
    selectQuarters,
    toggleQuarter,
} from '../../../assets/grid/selection';
import { minutes, quarterArbitrary } from './support';

const at = (...times: string[]): number[] => times.map(minutes);

describe('la sélection', () => {
    it('ne prend au clic que le quart d’heure cliqué', () => {
        expect(selectQuarter(minutes('09:30'))).toEqual({
            quarters: at('09:30'),
            anchor: minutes('09:30'),
            head: minutes('09:30'),
        });
    });

    it('étend à Maj+clic du premier quart d’heure cliqué, vers le bas comme vers le haut', () => {
        const start = selectQuarter(minutes('10:00'));

        expect(extendTo(start, minutes('10:30')).quarters).toEqual(at('10:00', '10:15', '10:30'));
        expect(extendTo(extendTo(start, minutes('10:30')), minutes('09:30')).quarters).toEqual(
            at('09:30', '09:45', '10:00'),
        );
    });

    it('commence à Maj+clic sans sélection, comme un clic', () => {
        expect(extendTo(EMPTY_SELECTION, minutes('10:00'))).toEqual(selectQuarter(minutes('10:00')));
    });

    it('ajoute et retire à Ctrl/⌘+clic, en gardant l’ordre', () => {
        let selection = selectQuarter(minutes('10:00'));
        selection = toggleQuarter(selection, minutes('09:00'));
        selection = toggleQuarter(selection, minutes('11:00'));
        expect(selection.quarters).toEqual(at('09:00', '10:00', '11:00'));

        selection = toggleQuarter(selection, minutes('10:00'));
        expect(selection.quarters).toEqual(at('09:00', '11:00'));
    });

    it('étend à Maj+clic depuis le dernier Ctrl/⌘+clic, comme la v1', () => {
        const selection = toggleQuarter(selectQuarter(minutes('09:00')), minutes('11:00'));

        expect(extendTo(selection, minutes('11:30')).quarters).toEqual(at('11:00', '11:15', '11:30'));
    });

    it('passe d’un quart d’heure au suivant aux flèches, et étend avec Maj', () => {
        const start = selectQuarter(minutes('10:00'));

        expect(moveSelection(start, 1, false).quarters).toEqual(at('10:15'));
        expect(moveSelection(start, -1, false).quarters).toEqual(at('09:45'));
        expect(moveSelection(moveSelection(start, 1, true), 1, true).quarters).toEqual(at('10:00', '10:15', '10:30'));
        expect(moveSelection(moveSelection(start, 1, true), -1, true).quarters).toEqual(at('10:00'));
    });

    it('ne sort pas de la grille aux flèches, et ne bouge pas sans sélection', () => {
        const first = selectQuarter(Quarter.FIRST);
        const last = selectQuarter(Quarter.LAST);

        expect(moveSelection(first, -1, false)).toBe(first);
        expect(moveSelection(last, 1, true)).toBe(last);
        expect(moveSelection(EMPTY_SELECTION, 1, false)).toBe(EMPTY_SELECTION);
    });

    it('s’efface sans perdre le curseur : les flèches et Maj repartent du créneau atteint', () => {
        const cleared = deselect(extendTo(selectQuarter(minutes('18:00')), minutes('18:30')));

        expect(cleared.quarters).toEqual([]);
        expect(moveSelection(cleared, 1, false).quarters).toEqual(at('18:45'));
        expect(moveSelection(cleared, -1, false).quarters).toEqual(at('18:15'));
        expect(moveSelection(cleared, 1, true).quarters).toEqual(at('18:30', '18:45'));
        expect(extendTo(cleared, minutes('19:00')).quarters).toEqual(at('18:30', '18:45', '19:00'));
        expect(deselect(EMPTY_SELECTION)).toBe(EMPTY_SELECTION);
        // Au bord de la grille, la flèche ne sort pas, et rien ne se sélectionne.
        expect(moveSelection(deselect(selectQuarter(Quarter.LAST)), 1, false).quarters).toEqual([]);
    });

    it('refuse ce qui n’est pas un quart d’heure de la grille', () => {
        for (const minute of [Quarter.FIRST - Quarter.MINUTES, Quarter.DAY_END, 610]) {
            expect(() => selectQuarter(minute)).toThrow(RangeError);
            expect(() => toggleQuarter(EMPTY_SELECTION, minute)).toThrow(RangeError);
        }
    });

    it('devient ce qui vient d’être collé', () => {
        expect(selectQuarters(at('11:00', '09:00', '09:00'))).toEqual({
            quarters: at('09:00', '11:00'),
            anchor: minutes('09:00'),
            head: minutes('11:00'),
        });
        expect(selectQuarters([])).toBe(EMPTY_SELECTION);
    });

    it('s’arrête sur le quart d’heure double-cliqué d’un bloc, et sur le dernier s’il n’en est pas', () => {
        const block = at('09:30', '09:45', '10:00', '10:15');

        expect(selectQuarters(block, minutes('09:45'))).toEqual({
            quarters: block,
            anchor: minutes('09:30'),
            head: minutes('09:45'),
        });
        // Les flèches en repartent.
        expect(moveSelection(selectQuarters(block, minutes('09:45')), 1, false).head).toBe(minutes('10:00'));
        expect(selectQuarters(block, minutes('11:00')).head).toBe(minutes('10:15'));
        expect(selectQuarters(block, null).head).toBe(minutes('10:15'));
    });

    it('se dessine d’un cadre par suite de quarts d’heure voisins', () => {
        const selection = selectQuarters(at('09:00', '09:15', '09:30', '10:00', '11:00', '11:15'));

        expect(selectionRuns(selection)).toEqual([
            { start: minutes('09:00'), end: minutes('09:45') },
            { start: minutes('10:00'), end: minutes('10:15') },
            { start: minutes('11:00'), end: minutes('11:30') },
        ]);
    });

    it('reste ordonnée, sans double, dans la grille, quels que soient les gestes', () => {
        const gesture: fc.Arbitrary<(selection: Selection) => Selection> = fc.oneof(
            quarterArbitrary.map((quarter) => () => selectQuarter(quarter)),
            quarterArbitrary.map((quarter) => (selection: Selection) => extendTo(selection, quarter)),
            quarterArbitrary.map((quarter) => (selection: Selection) => toggleQuarter(selection, quarter)),
            fc.tuple(fc.constantFrom(-1 as const, 1 as const), fc.boolean()).map(
                ([step, extend]) =>
                    (selection: Selection) =>
                        moveSelection(selection, step, extend),
            ),
            fc.constant(deselect),
        );

        fc.assert(
            fc.property(fc.array(gesture, { maxLength: 40 }), (gestures) => {
                let selection = EMPTY_SELECTION;
                for (const apply of gestures) {
                    selection = apply(selection);
                    const { quarters, anchor, head } = selection;

                    expect([...new Set(quarters)].sort((a, b) => a - b)).toEqual(quarters);
                    expect(quarters.every(Quarter.isQuarter)).toBe(true);
                    expect(anchor === null).toBe(head === null);
                    expect(quarters.every((quarter) => isSelected(selection, quarter))).toBe(true);
                }
            }),
        );
    });
});
