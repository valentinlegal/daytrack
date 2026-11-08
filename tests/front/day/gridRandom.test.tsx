// @vitest-environment jsdom
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';

import { emptyModel } from '../../e2e/gridModel';
import { mountGrid, unmountAll } from './gridBench';
import { differences, expectShownOnceSaved, steps, take } from './gridDriver';

/**
 * Des suites de gestes tirées au hasard, jouées sur le crochet des gestes comme l'écran les
 * reçoit — appuis, touches, menu, fenêtre de ticket, favori déposé, « Annuler » du
 * message, la journée relue au retour sur la page —, avec un serveur et un Jira qui retiennent leurs réponses, puis les lâchent,
 * entre deux gestes. Les gestes se croisent donc : un effacement part pendant qu'une
 * fenêtre attend Jira, une fenêtre est demandée pendant qu'un collage est en route, un
 * menu attend qu'une fenêtre se ferme.
 *
 * Ce que chaque geste doit laisser est celui de la suite jouée dans Chromium
 * (tests/e2e/gridModel.ts) : les gestes s'enregistrent dans l'ordre où on les fait, chacun
 * sur la journée que laissent ceux d'avant. Un geste qui doit voir quelque chose — une
 * fenêtre, un menu — l'attend comme quelqu'un devant l'écran : les réponses retenues
 * arrivent alors une à une.
 *
 * À tout moment, l'écran montre une journée que la base a vraiment contenue. Une fois tout
 * arrivé, la base contient exactement ce que le modèle attend, la grille ce que la base
 * contient, et rien ne reste en route : ni fenêtre ni menu coincés, ni réponse en attente.
 *
 * Chaque passage tire une graine neuve ; FC_SEED en rejoue une (tests/front/setup.ts), et
 * FC_RUNS en tire davantage.
 */

const RUNS = Number(process.env.FC_RUNS ?? 200);

afterEach(() => {
    unmountAll();
});

describe('des gestes de la grille qui se croisent, tirés au hasard', () => {
    it(
        'laissent la base telle que le modèle l’attend, la grille telle que la base, et rien en route',
        async () => {
            await fc.assert(
                fc.asyncProperty(steps, async (drawn) => {
                    const bench = mountGrid({ top: 480 });
                    const model = emptyModel();
                    try {
                        for (const step of drawn) {
                            await take(bench, model, step);
                            expectShownOnceSaved(bench);
                        }
                        const menus = bench.menus.length;
                        await bench.drain();

                        expect(differences(bench, model)).toEqual([]);
                        expect(bench.shown()).toEqual(bench.slow.ranges());
                        expect(bench.editing.window).toBeNull();
                        expect(bench.menus).toHaveLength(menus);
                        expect(bench.snapshot().busy).toBe(false);
                        expect(bench.slow.count + bench.jira.count).toBe(0);
                    } finally {
                        unmountAll();
                    }
                }),
                { numRuns: RUNS },
            );
            // Une machine lente, ou FC_RUNS, allongent la suite : son délai la suit.
        },
        Math.max(30_000, RUNS * 50),
    );
});
