// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type PointerDrag, startPointerDrag } from '../../../assets/day/pointerDrag';

/**
 * Le glisser commun à la grille et aux favoris, seul : ce qu'il entend, quand, et ce qu'il
 * laisse passer. Ce qu'il fait dans l'écran se prouve sur la vraie grille (gridScreenCrossings)
 * et dans Chromium (favorites.spec.ts, grid-editing.spec.ts).
 */

interface Calls {
    readonly calls: string[];
    readonly drag: PointerDrag;
}

function recorded(threshold: number, scroller: HTMLElement | null = null, lane: HTMLElement | null = null): Calls {
    const calls: string[] = [];

    return {
        calls,
        drag: {
            start: { x: 100, y: 300 },
            threshold,
            lane: () => lane,
            scroller: () => scroller,
            onStart: () => calls.push('start'),
            onMove: (x, y) => calls.push(`move ${String(x)},${String(y)}`),
            onEnd: (x, y) => calls.push(`end ${String(x)},${String(y)}`),
            onCancel: () => calls.push('cancel'),
        },
    };
}

function mouse(type: 'mousemove' | 'mouseup', x: number, y: number): void {
    document.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
}

/** Échap, tapé dans un champ : rend vrai si le document l'a entendu, comme Radix l'écoute. */
function escape(): { readonly heard: boolean; readonly prevented: boolean } {
    const field = document.createElement('input');
    document.body.append(field);
    let heard = false;
    const listener = () => {
        heard = true;
    };
    document.addEventListener('keydown', listener, true);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    field.dispatchEvent(event);
    document.removeEventListener('keydown', listener, true);
    field.remove();

    return { heard, prevented: event.defaultPrevented };
}

let stops: (() => void)[] = [];

function start(drag: PointerDrag): () => void {
    const stop = startPointerDrag(drag);
    stops.push(stop);

    return stop;
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
    stops.forEach((stop) => {
        stop();
    });
    stops = [];
    vi.useRealTimers();
});

describe('le seuil', () => {
    it('sans seuil, l’appui est déjà un glisser : chaque mouvement le suit, le relâcher le finit', () => {
        const { calls, drag } = recorded(0);
        start(drag);
        mouse('mousemove', 110, 320);
        mouse('mouseup', 110, 340);

        expect(calls).toEqual(['start', 'move 110,320', 'end 110,340']);
    });

    it('avec un seuil, un mouvement plus court n’est rien, et un relâcher sans glisser n’est qu’un clic', () => {
        const { calls, drag } = recorded(4);
        start(drag);
        mouse('mousemove', 102, 302);
        mouse('mouseup', 102, 302);

        expect(calls).toEqual([]);
    });

    it('le seuil passé, le glisser commence et suit le pointeur', () => {
        const { calls, drag } = recorded(4);
        start(drag);
        mouse('mousemove', 102, 302);
        mouse('mousemove', 104, 304);
        mouse('mousemove', 120, 330);
        mouse('mouseup', 121, 331);

        expect(calls).toEqual(['start', 'move 104,304', 'move 120,330', 'end 121,331']);
    });
});

describe('Échap', () => {
    it('abandonne le glisser, et ne parvient pas au document : une fenêtre ouverte ne l’entend pas', () => {
        const { calls, drag } = recorded(0);
        start(drag);
        mouse('mousemove', 110, 320);

        expect(escape()).toEqual({ heard: false, prevented: true });
        expect(calls).toEqual(['start', 'move 110,320', 'cancel']);
    });

    it('le glisser abandonné n’entend plus rien : ni le pointeur, ni le relâcher, ni un autre Échap', () => {
        const { calls, drag } = recorded(0);
        start(drag);
        escape();
        mouse('mousemove', 110, 320);
        mouse('mouseup', 110, 320);

        expect(escape()).toEqual({ heard: true, prevented: false });
        expect(calls).toEqual(['start', 'cancel']);
    });

    it('avant le seuil, l’appui n’est pas encore un glisser : Échap n’est pas pour lui', () => {
        const { calls, drag } = recorded(4);
        start(drag);
        mouse('mousemove', 101, 301);

        expect(escape()).toEqual({ heard: true, prevented: false });
        expect(calls).toEqual([]);
    });

    it('après le relâcher, Échap est pour les autres', () => {
        const { calls, drag } = recorded(0);
        start(drag);
        mouse('mouseup', 100, 300);

        expect(escape()).toEqual({ heard: true, prevented: false });
        expect(calls).toEqual(['start', 'end 100,300']);
    });

    it('une autre touche passe, même pendant le glisser', () => {
        const { drag } = recorded(0);
        start(drag);
        const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
        document.body.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
    });
});

describe('arrêté par un autre geste', () => {
    it('n’entend plus rien, et n’appelle rien', () => {
        const { calls, drag } = recorded(0);
        const stop = start(drag);
        stop();
        mouse('mousemove', 110, 320);
        mouse('mouseup', 110, 320);

        expect(escape()).toEqual({ heard: true, prevented: false });
        expect(calls).toEqual(['start']);
    });
});

describe('près du bord de la grille', () => {
    /** La colonne : 52 rangées de 20 px sous le haut de la vue ; la vue en montre 400 px. */
    function grid(): { scroller: HTMLElement; lane: HTMLElement } {
        const scroller = document.createElement('div');
        const lane = document.createElement('div');
        scroller.append(lane);
        document.body.append(scroller);
        lane.style.setProperty('--h-row', '20px');
        lane.getBoundingClientRect = () => new DOMRect(0, 0, 400, 52 * 20);
        scroller.getBoundingClientRect = () => new DOMRect(0, 0, 400, 400);

        return { scroller, lane };
    }

    it('fait défiler la grille vers le bord dont le pointeur approche, et suit le pointeur', () => {
        const { scroller, lane } = grid();
        const scrolled: number[] = [];
        Object.defineProperty(scroller, 'scrollTop', {
            get: () => 0,
            set: (value: number) => scrolled.push(value),
        });
        const { calls, drag } = recorded(0, scroller, lane);
        start({ ...drag, start: { x: 100, y: 200 } });
        mouse('mousemove', 100, 390);
        vi.advanceTimersToNextFrame();
        vi.advanceTimersToNextFrame();

        // Deux rangées de bord, un huitième par image.
        expect(scrolled).toEqual([5, 5]);
        expect(calls).toEqual(['start', 'move 100,390', 'move 100,390', 'move 100,390']);
        scroller.remove();
    });

    it('s’arrête au relâcher', () => {
        const { scroller, lane } = grid();
        const scrolled: number[] = [];
        Object.defineProperty(scroller, 'scrollTop', {
            get: () => 0,
            set: (value: number) => scrolled.push(value),
        });
        const { drag } = recorded(0, scroller, lane);
        start({ ...drag, start: { x: 100, y: 200 } });
        mouse('mousemove', 100, 390);
        mouse('mouseup', 100, 390);
        vi.advanceTimersToNextFrame();

        expect(scrolled).toEqual([]);
        scroller.remove();
    });
});
