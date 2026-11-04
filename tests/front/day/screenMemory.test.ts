import { describe, expect, it } from 'vitest';

import { screenMemory } from '../../../assets/day/screenMemory';
import { memoryStorage } from '../grid/support';

describe('screenMemory', () => {
    it('retient la position de la grille, et la retrouve après un rechargement', () => {
        const storage = memoryStorage();
        const memory = screenMemory(storage);
        expect(memory.gridTop()).toBeUndefined();

        memory.setGridTop(607.5);

        expect(screenMemory(storage).gridTop()).toBe(607.5);
    });

    it('ignore ce qui n’a pas la forme attendue', () => {
        const storage = memoryStorage();
        storage.setItem('daytrack.screen.grid-top', '{');

        expect(screenMemory(storage).gridTop()).toBeUndefined();
    });

    it('garde sa position le temps de l’onglet quand le navigateur refuse le stockage', () => {
        const memory = screenMemory(memoryStorage({ refuse: true }));

        memory.setGridTop(420);

        expect(memory.gridTop()).toBe(420);
    });

    it('retient le jour d’où l’on est parti vers les réglages, s’il en est un', () => {
        const storage = memoryStorage();
        expect(screenMemory(storage).settingsBack()).toBeUndefined();

        screenMemory(storage).setSettingsBack('2026-10-06');
        expect(screenMemory(storage).settingsBack()).toBe('2026-10-06');

        storage.setItem('daytrack.screen.settings-back', '"2026-02-30"');
        expect(screenMemory(storage).settingsBack()).toBeUndefined();
    });
});
