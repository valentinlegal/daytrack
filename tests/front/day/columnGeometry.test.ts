import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { type Column, edgeScroll, gridScale, quarterAt, quarterTop } from '../../../assets/day/columnGeometry';
import * as Quarter from '../../../assets/grid/quarter';

/** La colonne à 1440 × 900 : --h-row à 28 px, 07:00 à 76 px du haut, la grille au début. */
const COLUMN: Column = { top: 76, row: 28 };

/** Une colonne posée n'importe où, ses rangées au pixel près ou non (zoom du navigateur). */
const columns = fc.record({
    top: fc.double({ min: -2000, max: 2000, noNaN: true }),
    row: fc.double({ min: 8, max: 64, noNaN: true }),
});

describe('quarterAt', () => {
    it.each([
        [76, '07:00'],
        [76 + 27.9, '07:00'],
        [76 + 28, '07:15'],
        [76 + 8 * 28 + 14, '09:00'],
        [76 + 52 * 28 - 1, '19:45'],
    ])('le pointeur à %d px vise %s', (y, time) => {
        expect(quarterAt(COLUMN, y)).toBe(Quarter.parse(time));
    });

    it('au-dessus de 07:00 ou sous 20:00, il vise le quart d’heure le plus proche de la grille', () => {
        expect(quarterAt(COLUMN, 0)).toBe(Quarter.FIRST);
        expect(quarterAt(COLUMN, -500)).toBe(Quarter.FIRST);
        // Le bord bas de la colonne, sous la dernière rangée.
        expect(quarterAt(COLUMN, 76 + 52 * 28)).toBe(Quarter.LAST);
        expect(quarterAt(COLUMN, 5000)).toBe(Quarter.LAST);
    });

    it('rend toujours un quart d’heure de la grille, et celui dont la rangée est sous le pointeur', () => {
        fc.assert(
            fc.property(columns, fc.double({ min: -5000, max: 5000, noNaN: true }), (column, y) => {
                const quarter = quarterAt(column, y);

                expect(Quarter.isQuarter(quarter)).toBe(true);
                if (quarter !== Quarter.FIRST) {
                    expect(y).toBeGreaterThanOrEqual(quarterTop(column, quarter) - 1e-6);
                }
                if (quarter !== Quarter.LAST) {
                    expect(y).toBeLessThan(quarterTop(column, quarter + Quarter.MINUTES) + 1e-6);
                }
            }),
        );
    });
});

describe('quarterTop', () => {
    it('place chaque quart d’heure à une rangée du précédent, 20:00 au bas de la grille', () => {
        expect(quarterTop(COLUMN, Quarter.FIRST)).toBe(76);
        expect(quarterTop(COLUMN, Quarter.parse('09:00') ?? 0)).toBe(76 + 8 * 28);
        expect(quarterTop(COLUMN, Quarter.DAY_END)).toBe(76 + 52 * 28);
    });

    it('le milieu de chaque rangée vise son quart d’heure', () => {
        fc.assert(
            fc.property(columns, fc.constantFrom(...Quarter.all()), (column, quarter) => {
                expect(quarterAt(column, quarterTop(column, quarter) + column.row / 2)).toBe(quarter);
            }),
        );
    });
});

describe('edgeScroll', () => {
    /** La vue de la grille à 1440 × 900 : sous la barre, jusqu'en bas de l'écran. */
    const VIEW = { top: 64, bottom: 900, left: 320 };
    const EDGE = 2 * 28;

    it('fait défiler vers le bord dont le pointeur approche, à moins de deux rangées', () => {
        expect(edgeScroll(VIEW, 28, { x: 600, y: 64 + EDGE - 1 }, 500)).toBe(-EDGE / 8);
        expect(edgeScroll(VIEW, 28, { x: 600, y: 900 - EDGE + 1 }, 500)).toBe(EDGE / 8);
    });

    it('ne fait rien loin des bords', () => {
        expect(edgeScroll(VIEW, 28, { x: 600, y: 64 + EDGE }, 500)).toBe(0);
        expect(edgeScroll(VIEW, 28, { x: 600, y: 900 - EDGE }, 500)).toBe(0);
        expect(edgeScroll(VIEW, 28, { x: 600, y: 480 }, 500)).toBe(0);
    });

    it('continue quand le pointeur est sorti de la vue par le haut ou le bas', () => {
        expect(edgeScroll(VIEW, 28, { x: 600, y: 10 }, 500)).toBe(-EDGE / 8);
        expect(edgeScroll(VIEW, 28, { x: 600, y: 2000 }, 500)).toBe(EDGE / 8);
    });

    it('ne fait rien à gauche de la vue, sur la colonne des favoris', () => {
        expect(edgeScroll(VIEW, 28, { x: 319, y: 70 }, 500)).toBe(0);
        expect(edgeScroll(VIEW, 28, { x: 319, y: 890 }, 500)).toBe(0);
    });

    it('ne défile que vers où le pointeur est allé depuis l’appui', () => {
        // Parti de la dernière ligne visible, un glisser qui remonte n'y fait pas descendre la grille.
        expect(edgeScroll(VIEW, 28, { x: 600, y: 880 }, 890)).toBe(0);
        expect(edgeScroll(VIEW, 28, { x: 600, y: 895 }, 890)).toBe(EDGE / 8);
        // Parti de la première, un glisser qui descend n'y fait pas monter la grille.
        expect(edgeScroll(VIEW, 28, { x: 600, y: 80 }, 70)).toBe(0);
        expect(edgeScroll(VIEW, 28, { x: 600, y: 66 }, 70)).toBe(-EDGE / 8);
    });

    it('ne défile jamais à l’envers de ce que le pointeur a parcouru', () => {
        fc.assert(
            fc.property(
                fc.double({ min: -500, max: 1500, noNaN: true }),
                fc.double({ min: -500, max: 1500, noNaN: true }),
                (y, startY) => {
                    const delta = edgeScroll(VIEW, 28, { x: 600, y }, startY);

                    expect(delta === 0 || Math.sign(delta) === Math.sign(y - startY)).toBe(true);
                },
            ),
        );
    });
});

describe('gridScale', () => {
    /** 1440 × 900 : --h-row à 28 px, une marge de --s-3 au-dessus de 07:00. */
    const scale = gridScale(28, 12, 900 - 64);

    it('passe d’une heure au défilement qui la montre en haut, et retour', () => {
        expect(scale.toPixels(Quarter.FIRST)).toBe(0);
        expect(scale.toPixels(Quarter.parse('08:00') ?? 0)).toBe(4 * 28);
        fc.assert(
            fc.property(fc.integer({ min: Quarter.FIRST, max: Quarter.DAY_END }), (minutes) => {
                expect(scale.toMinutes(scale.toPixels(minutes))).toBeCloseTo(minutes, 9);
            }),
        );
    });

    it('lit l’heure au bord haut de la vue, marge comprise', () => {
        expect(scale.viewTop(12)).toBe(Quarter.FIRST);
        expect(scale.viewTop(0)).toBeLessThan(Quarter.FIRST);
        expect(scale.viewTop(12 + 8 * 28)).toBe(Quarter.parse('09:00'));
    });

    it('dit ce que la vue montre de la grille, en minutes', () => {
        expect(scale.visibleMinutes).toBeCloseTo((900 - 64 - 12) * (15 / 28), 9);
    });
});
