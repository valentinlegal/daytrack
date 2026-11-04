import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { emptyHintStart, OTHER_DAY_TOP, openingTop } from '../../../assets/day/scroll';
import * as Quarter from '../../../assets/grid/quarter';

/** Ce que montre la grille sous la barre, en minutes : 1440 × 900, 1280 × 800, 1024 × 720. */
const VISIBLE = [(900 - 64 - 12) * (15 / 24), (800 - 64 - 12) * (15 / 24), (720 - 64 - 12) * (15 / 24)];

describe('openingTop', () => {
    it('un autre jour s’ouvre sur 08:00', () => {
        expect(openingTop(null, VISIBLE[0] ?? 0)).toBe(OTHER_DAY_TOP);
    });

    it.each([
        // Les états de l'écran, à 1440 × 900. À 17:40, commencer à 10:00 ne laisserait que
        // 55 minutes après « maintenant ».
        ['15:20', '08:00'],
        ['17:40', '11:00'],
        ['17:50', '11:00'],
        ['08:40', '07:00'],
        ['06:10', '07:00'],
        // Passé 20:00, la grille est déjà tout en bas : le navigateur l'y arrête.
        ['23:30', '16:00'],
    ])('aujourd’hui à %s, la grille commence à %s', (now, top) => {
        expect(openingTop(Quarter.parse(now), VISIBLE[0] ?? 0)).toBe(Quarter.parse(top));
    });

    it('garde au moins une heure visible après « maintenant », sur une heure pleine, sans le cacher', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: Quarter.FIRST, max: Quarter.DAY_END - 61 }),
                fc.constantFrom(...VISIBLE),
                (now, visible) => {
                    const top = openingTop(now, visible);

                    expect(top % 60).toBe(0);
                    expect(top).toBeGreaterThanOrEqual(Quarter.FIRST);
                    expect(top).toBeLessThanOrEqual(now);
                    expect(top + visible).toBeGreaterThanOrEqual(Math.min(now + 60, Quarter.DAY_END));
                },
            ),
        );
    });
});

describe('emptyHintStart', () => {
    // Le haut de la vue, en minutes : 7,5 de marge au-dessus de l'heure posée en haut.
    it.each([
        // Un jour ouvert sur 08:00 : le premier quart d'heure entier, puis une ligne d'air.
        ['ouverte sur 08:00', 472.5, null, '08:15'],
        ['ouverte sur 07:00', 412.5, null, '07:15'],
        // 18:20, grille défilée jusqu'en bas à 1440 × 900 : la vue commence à 11:25.
        ['défilée jusqu’en bas à 18:20', 685, '18:20', '11:45'],
        // La ligne « maintenant » sous le message ou sur son bord ne le touche pas.
        ['maintenant plus bas', 412.5, '08:40', '07:15'],
        ['maintenant sur son bord haut', 412.5, '07:15', '07:15'],
        // Elle passe dedans : il descend au quart d'heure qui la suit.
        ['maintenant dans sa première ligne', 412.5, '07:20', '07:30'],
        ['maintenant entre ses deux lignes', 412.5, '07:30', '07:30'],
        ['maintenant dans sa seconde ligne', 412.5, '07:40', '07:45'],
        // Ses deux lignes tiennent dans la grille.
        ['ouverte sur 19:45', 1177.5, null, '19:30'],
        ['tout en bas, maintenant dedans', 1147.5, '19:50', '19:30'],
    ])('%s : le message commence à %s', (_, viewTop, now, start) => {
        expect(emptyHintStart(viewTop, now === null ? null : Quarter.parse(now))).toBe(Quarter.parse(start));
    });

    it('commence toujours sur un quart d’heure, ses deux lignes dans la grille, jamais traversé par « maintenant » sauf tout en bas', () => {
        fc.assert(
            fc.property(
                fc.double({ min: Quarter.FIRST - 8, max: Quarter.DAY_END, noNaN: true }),
                fc.option(fc.integer({ min: 0, max: 1439 })),
                (viewTop, now) => {
                    const start = emptyHintStart(viewTop, now);

                    expect(Quarter.isQuarter(start)).toBe(true);
                    expect(Quarter.isQuarter(start + Quarter.MINUTES)).toBe(true);
                    if (now !== null && start < Quarter.DAY_END - 2 * Quarter.MINUTES) {
                        expect(now > start && now < start + 2 * Quarter.MINUTES).toBe(false);
                    }
                },
            ),
        );
    });
});
