import { describe, expect, it } from 'vitest';

import { RECAP_STORAGE_KEY, readRecapOpen, writeRecapOpen } from '../../../assets/day/recapPreference';
import { blockedStorage, memoryStorage } from '../grid/support';

/** Le stockage tel que la préférence l'ouvre : à chaque lecture, le même. */
const storage = (initial: Record<string, string> = {}) => {
    const kept = memoryStorage({ initial });

    return () => kept;
};

describe('le récapitulatif ouvert ou fermé', () => {
    it('se retrouve d’un onglet à l’autre', () => {
        const kept = storage();
        expect(readRecapOpen(kept)).toBeNull();

        writeRecapOpen(kept, false);
        expect(readRecapOpen(kept)).toBe(false);
        writeRecapOpen(kept, true);
        expect(readRecapOpen(kept)).toBe(true);
    });

    it('ignore ce qui n’a pas la forme attendue', () => {
        expect(readRecapOpen(storage({ [RECAP_STORAGE_KEY]: 'oui' }))).toBeNull();
        expect(readRecapOpen(storage({ [RECAP_STORAGE_KEY]: '' }))).toBeNull();
    });

    it('ne lève pas quand le navigateur refuse le stockage', () => {
        expect(readRecapOpen(blockedStorage)).toBeNull();
        expect(() => {
            writeRecapOpen(blockedStorage, true);
        }).not.toThrow();
    });
});
