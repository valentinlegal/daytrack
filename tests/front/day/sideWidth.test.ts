import { describe, expect, it } from 'vitest';

import { clampWidth, readSideWidth, SIDE_WIDTH_STORAGE_KEY, writeSideWidth } from '../../../assets/day/sideWidth';
import { blockedStorage, memoryStorage } from '../grid/support';

const BOUNDS = { min: 224, max: 360, initial: 256 };

/** Le stockage tel que la préférence l'ouvre : à chaque lecture, le même. */
function storage(initial: Record<string, string> = {}) {
    const kept = memoryStorage({ initial });

    return { values: kept.items, get: () => kept };
}

describe('la largeur de la colonne de gauche', () => {
    it('reste entre ses bornes, au pixel près', () => {
        expect(clampWidth(100, BOUNDS)).toBe(224);
        expect(clampWidth(300.6, BOUNDS)).toBe(301);
        expect(clampWidth(999, BOUNDS)).toBe(360);
    });

    it('se retrouve, et se lit dans ses bornes', () => {
        const kept = storage();
        writeSideWidth(kept.get, 300);
        expect(readSideWidth(kept.get, BOUNDS)).toBe(300);

        expect(readSideWidth(storage({ [SIDE_WIDTH_STORAGE_KEY]: '1200' }).get, BOUNDS)).toBe(360);
        writeSideWidth(kept.get, null);
        expect(kept.values.has(SIDE_WIDTH_STORAGE_KEY)).toBe(false);
    });

    it("vaut sa largeur de départ quand rien de lisible n'est gardé, ou que le navigateur refuse le stockage", () => {
        expect(readSideWidth(storage().get, BOUNDS)).toBeNull();
        expect(readSideWidth(storage({ [SIDE_WIDTH_STORAGE_KEY]: 'large' }).get, BOUNDS)).toBeNull();
        expect(readSideWidth(storage({ [SIDE_WIDTH_STORAGE_KEY]: '' }).get, BOUNDS)).toBeNull();
        expect(readSideWidth(blockedStorage, BOUNDS)).toBeNull();
        expect(() => {
            writeSideWidth(blockedStorage, 300);
        }).not.toThrow();
    });
});
