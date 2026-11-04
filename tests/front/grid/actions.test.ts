import { describe, expect, it } from 'vitest';

import { selectionActions } from '../../../assets/grid/actions';
import {
    EMPTY_SELECTION,
    type Selection,
    extendTo,
    selectQuarter,
    toggleQuarter,
} from '../../../assets/grid/selection';
import { gridOf, minutes } from './support';

const GRID = gridOf([
    ['09:30', '10:00', 'work', 'SHOP-482', null],
    ['10:30', '11:00', 'work', 'SHOP-482', 'Relecture'],
    ['11:00', '11:30', 'work', 'OPS-12', null],
    ['12:30', '13:00', 'pause', null, null],
]);

const range = (from: string, to: string) => extendTo(selectQuarter(minutes(from)), minutes(to));

describe('ce que le menu de la sélection propose', () => {
    it('propose tout sur une sélection qui touche un ticket', () => {
        expect(selectionActions(GRID, range('09:45', '10:15'), true)).toEqual({
            entry: true,
            edit: false,
            copy: true,
            cut: true,
            paste: true,
            pause: true,
            clear: true,
            favorite: 'SHOP-482',
        });
    });

    it('ne garde que Nouveau ticket, Coller et Convertir en pause sur des créneaux vides', () => {
        expect(selectionActions(GRID, range('14:00', '14:30'), true)).toEqual({
            entry: true,
            edit: false,
            copy: false,
            cut: false,
            paste: true,
            pause: true,
            clear: false,
            favorite: null,
        });
    });

    it('ne colle rien sans presse-papier, et ne convertit pas une pause en pause', () => {
        expect(selectionActions(GRID, range('12:30', '12:45'), false)).toEqual({
            entry: true,
            edit: false,
            copy: true,
            cut: true,
            paste: false,
            pause: false,
            clear: true,
            favorite: null,
        });
    });

    it('ne propose rien sans sélection', () => {
        expect(selectionActions(GRID, EMPTY_SELECTION, true)).toEqual({
            entry: false,
            edit: false,
            copy: false,
            cut: false,
            paste: false,
            pause: false,
            clear: false,
            favorite: null,
        });
    });

    it('n’ajoute aux favoris qu’un seul ticket, quels que soient ses blocs, pauses et vides mis à part', () => {
        expect(selectionActions(GRID, range('09:30', '10:45'), false).favorite).toBe('SHOP-482');
        expect(selectionActions(GRID, range('10:45', '11:15'), false).favorite).toBeNull();
        expect(selectionActions(GRID, range('12:30', '12:45'), false).favorite).toBeNull();
        expect(selectionActions(GRID, range('12:00', '14:00'), false).favorite).toBeNull();
    });

    it('ne modifie la sélection que si elle porte partout le même ticket et le même commentaire', () => {
        const edit = (selection: Selection) => selectionActions(GRID, selection, false).edit;
        expect(edit(range('09:30', '09:45'))).toBe(true);
        expect(edit(range('10:30', '10:45'))).toBe(true);
        // En plusieurs morceaux, tant que chacun porte la même chose.
        expect(edit(toggleQuarter(selectQuarter(minutes('09:30')), minutes('09:45')))).toBe(true);
        // Le même ticket, deux commentaires.
        expect(edit(toggleQuarter(selectQuarter(minutes('09:45')), minutes('10:30')))).toBe(false);
        // Deux tickets, un créneau vide, une pause.
        expect(edit(range('10:45', '11:00'))).toBe(false);
        expect(edit(range('09:45', '10:00'))).toBe(false);
        expect(edit(range('12:30', '12:45'))).toBe(false);
        expect(edit(range('14:00', '14:30'))).toBe(false);
        expect(edit(EMPTY_SELECTION)).toBe(false);
    });
});
