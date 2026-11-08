// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import type { SlotChange } from '../../../assets/grid/changes';
import { TICKET_NOT_FOUND } from '../../../assets/jira/lookupMessages';
import { type Bench, mountScreen, unmountAll } from './gridBench';

/**
 * Le clic droit à côté d'une fenêtre qui s'enregistre, puis un autre geste pendant
 * l'attente, sur la vraie grille, son vrai menu et la vraie fenêtre de ticket : c'est leur
 * focus rendu à la grille qui faisait s'enregistrer seule une fenêtre neuve.
 */

const HOUR: SlotChange = { start: '14:00', end: '15:00', kind: 'work', ticket: 'SHOP-482', comment: 'Mapping' };

afterEach(() => {
    unmountAll();
});

const menuOpen = () => document.querySelector('[role="menu"]') !== null;
const dialogs = () => document.querySelectorAll('[role="dialog"]').length;

/**
 * Modifier le ticket ouvert sur le bloc de 14:00, un autre ticket tapé, puis le serveur
 * retenu : le clic droit à côté enregistrera la fenêtre, qui attendra sa réponse.
 */
async function openedThenHeld(bench: Bench): Promise<void> {
    bench.press('ArrowDown');
    expect(bench.editing.selection.quarters).toEqual([885]);
    bench.press('Enter');
    await bench.settle();
    expect(bench.editing.window?.target.kind).toBe('edit');
    expect(dialogs()).toBe(1);
    bench.type('SHOP-483');
    await bench.settle();
    bench.slow.hold();
}

describe('le clic droit à côté pendant que la fenêtre s’enregistre, sur la vraie grille', () => {
    it('le menu s’ouvre une fois la fenêtre fermée, jamais dessous', async () => {
        const bench = mountScreen({ blocks: [HOUR], top: 885 });
        await openedThenHeld(bench);
        bench.rightClick(960);
        await bench.settle();
        expect(bench.editing.window?.sending).toBe(true);
        expect(menuOpen()).toBe(false);

        await bench.answer(bench.slow);
        expect(bench.editing.window).toBeNull();
        expect(dialogs()).toBe(0);
        expect(menuOpen()).toBe(true);
        expect(bench.menus).toEqual([960]);
        expect(bench.slow.ranges()).toEqual([['14:00', '15:00', 'work', 'SHOP-483', 'Mapping']]);
    });

    it('puis un double-clic ailleurs : pas de menu, seule la fenêtre du double-clic s’ouvre', async () => {
        const bench = mountScreen({ blocks: [HOUR], top: 885 });
        await openedThenHeld(bench);
        bench.rightClick(960);
        await bench.settle();
        bench.doubleClick(1020);
        await bench.settle();
        expect(menuOpen()).toBe(false);

        await bench.answer(bench.slow);
        expect(menuOpen()).toBe(false);
        expect(bench.menus).toEqual([]);
        expect(bench.editing.window?.target.kind).toBe('new');
        expect(dialogs()).toBe(1);
        expect(bench.slow.ranges()).toEqual([['14:00', '15:00', 'work', 'SHOP-483', 'Mapping']]);
    });

    for (const rightClick of [true, false]) {
        it(`${rightClick ? 'puis un clic ailleurs et des lettres' : 'sans clic droit, un clic ailleurs et des lettres'} : Nouveau ticket s’ouvre avec elles, et ne s’enregistre pas tout seul`, async () => {
            const bench = mountScreen({ blocks: [HOUR], top: 885 });
            await openedThenHeld(bench);
            if (rightClick) {
                bench.rightClick(960);
                await bench.settle();
            }
            bench.click(1020);
            await bench.settle();
            for (const letter of 'OPS-1') {
                bench.press(letter);
            }
            await bench.settle();

            const before = bench.slow.server.writes.length;
            await bench.answer(bench.slow);
            await bench.settle();
            expect(menuOpen()).toBe(false);
            expect(bench.menus).toEqual([]);
            expect(bench.editing.window?.target.kind).toBe('new');
            expect(bench.editing.window?.sending).toBe(false);
            expect(bench.editing.window?.draft).toEqual({ ticket: 'OPS-1', comment: '' });
            expect(bench.editing.selection.quarters).toEqual([1020]);
            // Seule la fenêtre d'avant s'est enregistrée : la neuve attend Entrée.
            expect(bench.slow.server.writes.length - before).toBe(0);
            expect(bench.slow.ranges()).toEqual([['14:00', '15:00', 'work', 'SHOP-483', 'Mapping']]);
        });
    }
});

describe('Échap pendant le glisser d’un favori, sur la vraie grille et la vraie fenêtre', () => {
    it('n’abandonne que le glisser : la fenêtre restée ouverte garde sa saisie, et rien n’est posé', async () => {
        const bench = mountScreen({ favorites: ['ESSAI-1'] });
        await bench.settle();
        bench.doubleClick(540);
        await bench.settle();
        bench.type('SHOP-999', 'Tapé avant');
        bench.enter();
        await bench.drain();
        // Jira ne connaît pas le ticket : la fenêtre reste ouverte, le refus sous le champ.
        expect(bench.editing.window?.errors.ticket).toBe(TICKET_NOT_FOUND);

        // L'appui sur le favori est un clic à côté : le ticket introuvable garde la fenêtre.
        bench.holdFavorite('ESSAI-1');
        bench.moveTo(660);
        await bench.settle();
        expect(bench.favoriteDrag).toMatchObject({ kind: 'favorite', quarter: 660 });
        expect(dialogs()).toBe(1);

        bench.escape();
        await bench.settle();
        expect(bench.favoriteDrag).toBeNull();
        expect(dialogs()).toBe(1);
        expect(bench.editing.window?.draft).toEqual({ ticket: 'SHOP-999', comment: 'Tapé avant' });

        // Le relâcher ne pose rien : le glisser est fini.
        bench.release(660);
        await bench.drain();
        expect(bench.favoriteDrag).toBeNull();
        expect(dialogs()).toBe(1);
        expect(bench.editing.window?.draft).toEqual({ ticket: 'SHOP-999', comment: 'Tapé avant' });
        expect(bench.slow.ranges()).toEqual([]);

        // Échap, maintenant, est pour la fenêtre.
        bench.escape();
        await bench.settle();
        expect(dialogs()).toBe(0);
    });

    it('mené au bout, sans fenêtre, il pose le favori sur le quart d’heure visé', async () => {
        const bench = mountScreen({ favorites: ['ESSAI-1'] });
        await bench.settle();
        bench.holdFavorite('ESSAI-1');
        bench.moveTo(660);
        await bench.settle();
        expect(bench.favoriteDrag).toMatchObject({ kind: 'favorite', quarter: 660 });

        bench.release(660);
        await bench.drain();
        expect(bench.favoriteDrag).toBeNull();
        expect(bench.slow.ranges()).toEqual([['11:00', '11:15', 'work', 'ESSAI-1', null]]);
    });

    for (const ending of ['posé sur la grille', 'abandonné par Échap'] as const) {
        it(`${ending}, relâché loin de sa carte : la carte activée ensuite au clavier copie le favori`, async () => {
            const bench = mountScreen({ favorites: ['ESSAI-1'] });
            await bench.settle();
            bench.holdFavorite('ESSAI-1');
            bench.moveTo(660);
            if (ending === 'abandonné par Échap') {
                bench.escape();
            }
            bench.release(660);
            await bench.drain();
            expect(bench.session.hasClipboard()).toBe(false);

            // Entrée ou Espace sur la carte : un clic sans pointeur.
            bench.activateFavorite('ESSAI-1');
            await bench.drain();
            expect(bench.session.hasClipboard()).toBe(true);
        });
    }
});
