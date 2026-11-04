import { describe, expect, it } from 'vitest';

import { dropTicket } from '../../../assets/grid/drop';
import { work } from '../../../assets/grid/grid';
import { minutes } from './support';

describe('un favori déposé sur la grille', () => {
    it('ne change que le quart d’heure sous le pointeur, sans commentaire', () => {
        expect([...dropTicket('SHOP-482', minutes('10:00'))]).toEqual([[minutes('10:00'), work('SHOP-482', null)]]);
    });

    it('se refuse hors de la grille', () => {
        expect(() => dropTicket('SHOP-482', minutes('20:00'))).toThrow();
    });
});
