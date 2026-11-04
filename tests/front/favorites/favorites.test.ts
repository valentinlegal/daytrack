import { describe, expect, it } from 'vitest';

import { type Favorite, moved, readFavorites } from '../../../assets/favorites/favorites';

const LIST: Favorite[] = ['A', 'B', 'C', 'D'].map((letter) => ({ id: letter, ticket: `SHOP-${letter}`, name: null }));

const ids = (list: Favorite[] | null) => list?.map((favorite) => favorite.id).join('');

describe('les favoris', () => {
    it("lisent la liste de l'API sans la croire sur parole", () => {
        expect(readFavorites({ favorites: [{ id: 'a', ticket: 'SHOP-482', name: null }] })).toEqual([
            { id: 'a', ticket: 'SHOP-482', name: null },
        ]);
        for (const json of [
            null,
            {},
            { favorites: {} },
            { favorites: [{ id: 'a', ticket: 'SHOP-482' }] },
            { favorites: [{ id: 1, ticket: 'X', name: null }] },
        ]) {
            expect(() => readFavorites(json)).toThrow(TypeError);
        }
    });

    it('passent à une place comptée dans la liste sans eux', () => {
        expect(ids(moved(LIST, 'A', 2))).toBe('BCAD');
        expect(ids(moved(LIST, 'D', 0))).toBe('DABC');
        expect(ids(moved(LIST, 'B', 3))).toBe('ACDB');
        expect(ids(moved(LIST, 'B', 99))).toBe('ACDB');
        expect(ids(moved(LIST, 'C', -1))).toBe('CABD');
    });

    it("ne bougent pas quand ils sont déjà à leur place, ou qu'ils n'y sont plus", () => {
        expect(moved(LIST, 'B', 1)).toBeNull();
        expect(moved(LIST, 'D', 3)).toBeNull();
        expect(moved(LIST, 'D', 99)).toBeNull();
        expect(moved(LIST, 'Z', 0)).toBeNull();
    });
});
