// @vitest-environment jsdom
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    choosePreference,
    followTheme,
    onPreferenceChange,
    readPreference,
    resolveTheme,
    THEME_STORAGE_KEY,
    type ThemePreference,
} from '../../assets/theme';
import { blockedStorage, memoryStorage } from './grid/support';

const preferences: ThemePreference[] = ['light', 'dark', 'system'];

/** La page, quand le navigateur refuse d'ouvrir son stockage. */
function windowWithoutStorage(): typeof window {
    return new Proxy(window, {
        get(target, property) {
            if (property === 'localStorage') {
                return blockedStorage();
            }

            const value: unknown = Reflect.get(target, property, target);

            return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
    });
}

describe('resolveTheme', () => {
    it('suit le système seulement quand on le lui demande', () => {
        fc.assert(
            fc.property(fc.constantFrom(...preferences), fc.boolean(), (preference, systemDark) => {
                const theme = resolveTheme(preference, systemDark);

                expect(theme).toBe(preference === 'system' ? (systemDark ? 'dark' : 'light') : preference);
            }),
        );
    });
});

describe('readPreference', () => {
    it('rend « Système » pour tout ce qui n’est pas un choix connu', () => {
        fc.assert(
            fc.property(fc.option(fc.string()), (stored) => {
                const preference = readPreference({ getItem: () => stored });

                expect(preference).toBe(stored === 'light' || stored === 'dark' ? stored : 'system');
            }),
        );
    });

    it('rend « Système » quand le navigateur refuse le stockage', () => {
        const preference = readPreference(memoryStorage({ refuse: true }));

        expect(preference).toBe('system');
    });
});

describe('followTheme', () => {
    // jsdom n'a pas de matchMedia : chaque test pose le sien, qui imite le système.
    afterEach(() => {
        localStorage.clear();
        vi.unstubAllGlobals();
    });

    function stubSystem(query: MediaQueryList): void {
        vi.stubGlobal('matchMedia', () => query);
    }

    function fakeSystem(dark: boolean): { query: MediaQueryList; setDark: (value: boolean) => void } {
        const listeners = new Set<() => void>();
        const query = {
            matches: dark,
            addEventListener: (_: string, listener: () => void) => listeners.add(listener),
            removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
        } as unknown as MediaQueryList;

        return {
            query,
            setDark: (value) => {
                (query as { matches: boolean }).matches = value;
                listeners.forEach((listener) => {
                    listener();
                });
            },
        };
    }

    it('suit le système quand il change en cours de journée', () => {
        const system = fakeSystem(false);
        stubSystem(system.query);
        const stop = followTheme(document.documentElement, window);

        expect(document.documentElement.dataset.theme).toBe('light');
        system.setDark(true);
        expect(document.documentElement.dataset.theme).toBe('dark');

        stop();
        system.setDark(false);
        expect(document.documentElement.dataset.theme).toBe('dark');
    });

    it('garde le choix enregistré, quel que soit le système', () => {
        localStorage.setItem(THEME_STORAGE_KEY, 'light');
        const system = fakeSystem(true);
        stubSystem(system.query);
        const stop = followTheme(document.documentElement, window);

        expect(document.documentElement.dataset.theme).toBe('light');
        system.setDark(false);
        expect(document.documentElement.dataset.theme).toBe('light');

        stop();
    });

    it('suit le système quand le navigateur bloque l’accès au stockage', () => {
        stubSystem(fakeSystem(true).query);
        const blocked = windowWithoutStorage();

        const stop = followTheme(document.documentElement, blocked);

        expect(document.documentElement.dataset.theme).toBe('dark');
        stop();
    });

    it('pose aussitôt le choix fait dans les réglages, et le retient', () => {
        stubSystem(fakeSystem(false).query);
        const stop = followTheme(document.documentElement, window);
        const heard = vi.fn();
        const stopListening = onPreferenceChange(window, heard);

        choosePreference(window, 'dark');
        expect(document.documentElement.dataset.theme).toBe('dark');
        expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
        expect(heard).toHaveBeenCalledWith('dark');

        choosePreference(window, 'system');
        expect(document.documentElement.dataset.theme).toBe('light');
        expect(readPreference(localStorage)).toBe('system');

        stopListening();
        stop();
    });

    it('pose le choix pour la page quand le navigateur refuse de le retenir', () => {
        const system = fakeSystem(false);
        stubSystem(system.query);
        const blocked = windowWithoutStorage();
        const stop = followTheme(document.documentElement, blocked);

        choosePreference(blocked, 'dark');
        expect(document.documentElement.dataset.theme).toBe('dark');
        system.setDark(false);
        expect(document.documentElement.dataset.theme, 'Le système ne défait pas le choix de la page.').toBe('dark');

        stop();
    });

    it('suit un choix changé dans un autre onglet', () => {
        stubSystem(fakeSystem(false).query);
        const stop = followTheme(document.documentElement, window);

        localStorage.setItem(THEME_STORAGE_KEY, 'dark');
        window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY }));
        expect(document.documentElement.dataset.theme).toBe('dark');

        stop();
    });
});
