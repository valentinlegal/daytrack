import { describe, expect, it } from 'vitest';

import { RECAP_STORAGE_KEY, readRecapOpen, writeRecapOpen } from '../../../assets/day/recapPreference';

function storage(initial: Record<string, string> = {}) {
    const values = new Map(Object.entries(initial));

    return () => ({
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
    });
}

const blocked = () => {
    throw new DOMException('Accès refusé', 'SecurityError');
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
        expect(readRecapOpen(blocked)).toBeNull();
        expect(() => {
            writeRecapOpen(blocked, true);
        }).not.toThrow();
    });
});
