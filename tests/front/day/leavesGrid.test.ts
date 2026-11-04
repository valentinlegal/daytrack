// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { leavesGrid } from '../../../assets/day/leavesGrid';

/** L'écran Journée, réduit à ce que le clic distingue. */
const SCREEN = `
    <aside id="favoris">
        <h2>Favoris</h2>
        <button aria-label="Ajouter un favori"><svg><path></path></svg></button>
        <ul id="liste">
            <li><button data-favorite="1"><span>SHOP-482</span></button></li>
        </ul>
        <div role="menu"><div role="menuitem">Renommer…</div></div>
        <div role="separator" aria-label="Largeur des favoris"></div>
    </aside>
    <main><div role="listbox" aria-label="Créneaux de la journée"></div></main>
    <aside id="recap"><h2>Récapitulatif</h2></aside>
`;

const at = (selector: string, offsetX = 4, offsetY = 4) => ({
    target: document.querySelector(selector),
    offsetX,
    offsetY,
});

describe('un clic quitte la grille', () => {
    beforeEach(() => {
        document.body.innerHTML = SCREEN;
    });

    it('dans la colonne des favoris, à côté des favoris, ou dans le récapitulatif', () => {
        expect(leavesGrid(at('#favoris h2'))).toBe(true);
        expect(leavesGrid(at('#liste'))).toBe(true);
        expect(leavesGrid(at('#favoris path'))).toBe(true);
        expect(leavesGrid(at('#recap h2'))).toBe(true);
    });

    it('jamais sur un favori, son menu ou le bord de la colonne, ni dans la grille', () => {
        expect(leavesGrid(at('[data-favorite] span'))).toBe(false);
        expect(leavesGrid(at('[role="menuitem"]'))).toBe(false);
        expect(leavesGrid(at('[role="separator"]'))).toBe(false);
        expect(leavesGrid(at('[role="listbox"]'))).toBe(false);
        expect(leavesGrid({ target: null, offsetX: 0, offsetY: 0 })).toBe(false);
    });

    it('jamais sur la barre de défilement de la liste, qui la fait défiler', () => {
        const list = document.querySelector('#liste');
        // La liste de 224 px, dont 12 de barre à droite et en bas.
        Object.defineProperty(list, 'clientWidth', { value: 212 });
        Object.defineProperty(list, 'clientHeight', { value: 288 });

        expect(leavesGrid(at('#liste', 100, 100))).toBe(true);
        expect(leavesGrid(at('#liste', 216, 100))).toBe(false);
        expect(leavesGrid(at('#liste', 100, 292))).toBe(false);
    });
});
