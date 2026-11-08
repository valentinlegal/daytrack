// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import {
    type Address,
    addressOf,
    currentAddress,
    dayAddress,
    followArrow,
    pathOf,
    refuseArrow,
    SETTINGS,
    showAddress,
    useBrowserArrows,
    WELCOME,
} from '../../assets/address';

// React vérifie que ses rendus de test passent par act().
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('addressOf', () => {
    it('lit un jour, les réglages et la bienvenue', () => {
        expect(addressOf('/2026-10-06')).toEqual({ screen: 'day', date: '2026-10-06' });
        expect(addressOf('/2028-02-29')).toEqual({ screen: 'day', date: '2028-02-29' });
        expect(addressOf('/reglages')).toEqual(SETTINGS);
        expect(addressOf('/bienvenue')).toEqual(WELCOME);
    });

    it('laisse au serveur ce qu’il est seul à savoir lire : un jour impossible ou mal écrit', () => {
        for (const path of [
            '/',
            '',
            '/2026-02-30',
            '/2027-02-29',
            '/2026-13-01',
            '/2026-10-5',
            '/2026-10-06/',
            '2026-10-06',
            '/2026-10-06x',
            '/reglages/',
            '/Reglages',
            '/bienvenue/x',
        ]) {
            expect(addressOf(path), path).toEqual({ screen: 'other' });
        }
    });

    it('relit ce qu’elle écrit', () => {
        for (const address of [dayAddress('2026-10-06'), SETTINGS, WELCOME]) {
            expect(addressOf(pathOf(address))).toEqual(address);
        }
    });
});

describe('showAddress', () => {
    afterEach(() => {
        window.history.replaceState(null, '', '/');
    });

    it('ajoute une étape que Précédent défait, ou corrige celle où l’on est', () => {
        window.history.replaceState(null, '', '/2026-10-06');
        const steps = window.history.length;

        showAddress(dayAddress('2026-10-07'));
        expect(window.location.pathname).toBe('/2026-10-07');
        expect(window.history.length).toBe(steps + 1);

        showAddress(SETTINGS, 'replace');
        expect(currentAddress()).toEqual(SETTINGS);
        expect(window.history.length).toBe(steps + 1);
    });
});

describe('useBrowserArrows', () => {
    let root: ReturnType<typeof createRoot> | null = null;

    afterEach(() => {
        act(() => {
            root?.unmount();
        });
        root = null;
        window.history.replaceState(null, '', '/');
    });

    it('donne l’adresse où mènent les flèches, au gestionnaire du dernier rendu, et cesse d’écouter au démontage', () => {
        const heard: string[] = [];
        function Probe({ name }: { name: string }) {
            useBrowserArrows((address: Address) => {
                heard.push(`${name} ${address.screen === 'day' ? address.date : address.screen}`);
            });

            return null;
        }
        root = createRoot(document.createElement('div'));
        act(() => {
            root?.render(<Probe name="premier" />);
        });
        act(() => {
            root?.render(<Probe name="second" />);
        });

        window.history.replaceState(null, '', '/2026-10-06');
        window.dispatchEvent(new PopStateEvent('popstate'));
        window.history.replaceState(null, '', '/2026-02-30');
        window.dispatchEvent(new PopStateEvent('popstate'));
        expect(heard).toEqual(['second 2026-10-06', 'second other']);

        act(() => {
            root?.unmount();
        });
        root = null;
        window.dispatchEvent(new PopStateEvent('popstate'));
        expect(heard).toHaveLength(2);
    });
});

describe('les flèches refusées', () => {
    let root: ReturnType<typeof createRoot> | null = null;

    afterEach(() => {
        act(() => {
            root?.unmount();
        });
        root = null;
        window.history.replaceState(null, '', '/');
    });

    /** La prochaine flèche, une fois arrivée : jsdom parcourt l'historique au tour suivant. */
    function arrived(): Promise<void> {
        return new Promise((resolve) => {
            window.addEventListener(
                'popstate',
                () => {
                    resolve();
                },
                { once: true },
            );
        });
    }

    function step(): { run?: unknown; place?: unknown } | null {
        return window.history.state as { run?: unknown; place?: unknown } | null;
    }

    /**
     * L'écran : il suit les flèches vers un jour, sauf celui qu'on refuse, et reste sur ce
     * qu'il montre.
     */
    function mount(refused: string): { shown: () => string } {
        let shown = currentAddress();
        function Screen() {
            useBrowserArrows((address) => {
                if (address.screen !== 'day' || address.date === refused) {
                    refuseArrow(shown.screen === 'day' ? dayAddress(shown.date) : SETTINGS);
                } else {
                    followArrow();
                    shown = address;
                }
            });

            return null;
        }
        root = createRoot(document.createElement('div'));
        act(() => {
            root?.render(<Screen />);
        });

        return { shown: () => (shown.screen === 'day' ? shown.date : shown.screen) };
    }

    it('chaque étape écrite porte sa suite et sa place, qui avance d’un', () => {
        showAddress(dayAddress('2026-10-05'), 'replace');
        const first = step();
        showAddress(dayAddress('2026-10-06'));
        expect(step()).toEqual({ run: first?.run, place: (first?.place as number) + 1 });
        showAddress(SETTINGS, 'replace');
        expect(step()).toEqual({ run: first?.run, place: (first?.place as number) + 1 });
    });

    it('ramènent à l’étape affichée sans en ajouter, et Précédent mène ensuite où il menait', async () => {
        showAddress(dayAddress('2026-10-05'), 'replace');
        showAddress(dayAddress('2026-10-06'));
        showAddress(dayAddress('2026-10-07'));
        const steps = window.history.length;
        const screen = mount('2026-10-07');
        let step = arrived();
        window.history.back();
        await step;
        expect(screen.shown()).toBe('2026-10-06');

        // Suivant mène au 7, refusé : l'historique revient au 6, sans étape de plus.
        step = arrived();
        window.history.forward();
        await step;
        step = arrived();
        await step;
        expect(window.location.pathname).toBe('/2026-10-06');
        expect(window.history.length).toBe(steps);
        expect(screen.shown()).toBe('2026-10-06');

        // Précédent mène au jour d'avant le 6, et Suivant de nouveau au 6.
        step = arrived();
        window.history.back();
        await step;
        expect(window.location.pathname).toBe('/2026-10-05');
        expect(screen.shown()).toBe('2026-10-05');
        step = arrived();
        window.history.forward();
        await step;
        expect(window.location.pathname).toBe('/2026-10-06');
    });

    it('ouvre une suite à part pour une étape qu’elle n’a pas écrite, et y réécrit l’adresse refusée', async () => {
        showAddress(dayAddress('2026-10-05'), 'replace');
        showAddress(dayAddress('2026-10-06'));
        const before = step();
        // Des étapes que l'application n'a pas écrites, comme avant une mise à jour.
        window.history.pushState(null, '', '/2026-10-07');
        window.history.pushState(null, '', '/2026-10-06');
        const screen = mount('2026-10-07');

        let arrival = arrived();
        window.history.back();
        await arrival;
        const unknown = step();
        expect(unknown?.run).not.toBe(before?.run);
        expect(window.location.pathname).toBe('/2026-10-06');
        expect(screen.shown()).toBe('2026-10-06');
        expect(step()).toEqual({ run: unknown?.run, place: 1 });

        // Une ancre ajoutée à l'adresse ouvre aussi la sienne.
        arrival = arrived();
        window.location.hash = 'x';
        await arrival;
        expect(window.location.pathname).toBe('/2026-10-06');
        expect(step()?.run).not.toBe(unknown?.run);
    });
});
