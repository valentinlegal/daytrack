// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SAME_RETURN, watchReturns } from '../../assets/useReturns';

describe('watchReturns', () => {
    let returns = 0;
    let stop: () => void = () => undefined;
    let visibility: DocumentVisibilityState = 'visible';

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-06T08:00:00Z'));
        visibility = 'visible';
        vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
        returns = 0;
        stop = watchReturns(window, () => {
            returns += 1;
        });
    });

    afterEach(() => {
        stop();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    const shown = () => {
        visibility = 'visible';
        document.dispatchEvent(new Event('visibilitychange'));
    };
    const hidden = () => {
        visibility = 'hidden';
        document.dispatchEvent(new Event('visibilitychange'));
    };
    const focused = () => {
        window.dispatchEvent(new FocusEvent('focus'));
    };
    const later = (milliseconds: number) => {
        vi.advanceTimersByTime(milliseconds);
    };

    it('compte l’onglet qui redevient visible, pas celui qui se cache', () => {
        hidden();
        expect(returns).toBe(0);
        shown();
        expect(returns).toBe(1);
    });

    it('compte la fenêtre qui reprend la main, deux fenêtres côte à côte', () => {
        focused();
        later(5000);
        focused();
        expect(returns).toBe(2);
    });

    it('ne compte qu’une fois l’onglet retrouvé, qui redevient visible puis reprend la main', () => {
        hidden();
        later(60_000);
        shown();
        later(20);
        focused();
        expect(returns).toBe(1);

        // L'inverse aussi.
        later(60_000);
        focused();
        later(SAME_RETURN - 1);
        shown();
        expect(returns).toBe(2);
    });

    it('compte deux retours du même genre, même rapprochés', () => {
        shown();
        shown();
        focused();
        focused();
        expect(returns).toBe(3);
    });

    it('compte l’autre genre arrivé après le délai, ou après une paire', () => {
        shown();
        later(SAME_RETURN);
        focused();
        expect(returns).toBe(2);

        later(60_000);
        shown();
        focused();
        focused();
        expect(returns).toBe(4);
    });

    it('ne prend pas le focus d’un élément de la page pour un retour', () => {
        const field = document.createElement('input');
        document.body.append(field);
        field.focus();
        field.blur();
        field.focus();
        field.remove();
        expect(returns).toBe(0);
    });

    it('cesse d’écouter quand on l’arrête', () => {
        stop();
        shown();
        focused();
        expect(returns).toBe(0);
    });
});
