// @vitest-environment jsdom
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';

import { rewind } from '../../e2e/gridModel';
import { DATE, EVE, mountGrid, unmountAll } from './gridBench';
import {
    aliveAfterUndoingAll,
    apart,
    differences,
    earlier,
    expectShownOnceSaved,
    expectSound,
    linkedButEnded,
    MAX_STEPS,
    seeds,
    startModel,
    steps,
    take,
} from './gridDriver';

/**
 * Des suites de gestes tirées au hasard, jouées sur le crochet des gestes comme l'écran les
 * reçoit — appuis, touches, menu, fenêtre de ticket, favori déposé, « Annuler » du
 * message, la journée relue au retour sur la page —, avec un serveur et un Jira qui retiennent leurs réponses, puis les lâchent,
 * entre deux gestes. Les gestes se croisent donc : un effacement part pendant qu'une
 * fenêtre attend Jira, une fenêtre est demandée pendant qu'un collage est en route, un
 * menu attend qu'une fenêtre se ferme.
 *
 * La journée part avec des blocs qui reviennent, ou sans : une ou deux récurrences nées la
 * veille, posées sur la matinée des gestes, qui ne se chevauchent pas — le serveur refuse deux
 * récurrences sur un créneau —, autour d'une saisie faite avant elles, s'il y en a une. Un geste
 * qui leur prend un quart d'heure détache leur fois entière ; la fenêtre les crée — chaque
 * semaine, une semaine sur 2 à 4, chaque mois au rang, au dernier ou à la date que le jour du
 * bloc propose —, les coupe, les arrête ou change leur fin, et refuse un créneau qu'une autre
 * prend déjà, y compris quand un autre onglet vient de le prendre pendant qu'elle était ouverte :
 * le serveur le refuse alors, et la fenêtre le dit à son tour. Modifier
 * un bloc qui revient, décocher sa case, la corbeille, le ticket vidé, Suppr sur une fois
 * entière posent la question « quelles fois », comme Ctrl+X sur une fois entière, Ctrl+V ou un
 * favori au bord d'un bloc qui revient, du même contenu, Nouveau ticket à son bord à son rythme,
 * et Suppr sur son haut ou son bas : la suite y répond au hasard — cette fois
 * seulement ou avec les suivantes, par Entrée, le bouton ou un clic à côté —, revient d'abord
 * en arrière, ou y renonce par Échap. La journée
 * est aujourd'hui, ou passée : la fenêtre d'un bloc qui revient y garde sa case, cochée à son
 * rythme, mais ce qu'on change au bloc ne vaut que pour cette fois. Ou elle est à venir : ses
 * récurrences n'y sont pas posées mais prévues, et les mêmes gestes doivent y laisser la même
 * journée — une fois prévue qu'un geste touche se pose détachée, et annuler la rend à la
 * prévision. Ses récurrences de départ ne s'y chevauchent pas (apart).
 *
 * Ce que chaque geste doit laisser est celui de la suite jouée dans Chromium
 * (tests/e2e/gridModel.ts), récurrences en plus (gridDriver.ts) : les gestes s'enregistrent dans l'ordre où on les fait, chacun
 * sur la journée que laissent ceux d'avant. Un geste qui doit voir quelque chose — une
 * fenêtre, un menu — l'attend comme quelqu'un devant l'écran : les réponses retenues
 * arrivent alors une à une.
 *
 * À tout moment, l'écran montre une journée que la base a vraiment contenue, aucune paire de
 * récurrences du serveur ne prend un même créneau après aujourd'hui, aucun quart d'heure n'est
 * montré deux fois, et rien en route, la grille montre ce que la base contient. Une fois tout
 * arrivé, la base contient exactement ce que le modèle attend, liens compris, la grille ce que
 * la base contient, et rien ne reste en route : ni fenêtre ni menu coincés, ni réponse en
 * attente. Une récurrence qui pose un bloc ce jour-là y tombe encore. Puis tout annuler ramène
 * à la journée de départ : les récurrences de départ vivent, celles nées en route sont retirées.
 *
 * Chaque passage tire une graine neuve ; FC_SEED en rejoue une (tests/front/setup.ts), FC_RUNS
 * en tire davantage, et FC_STEPS allonge les suites.
 */

const RUNS = Number(process.env.FC_RUNS ?? 200);

/** Le lendemain de la journée jouée : elle est alors passée, et ses blocs qui reviennent ne se touchent que cette fois. */
const TOMORROW = '2026-10-07';

afterEach(() => {
    unmountAll();
});

describe('des gestes de la grille qui se croisent, tirés au hasard', () => {
    it(
        'laissent la base telle que le modèle l’attend, la grille telle que la base, et rien en route',
        async () => {
            await fc.assert(
                fc.asyncProperty(
                    seeds,
                    earlier,
                    steps,
                    fc.constantFrom(DATE, TOMORROW, EVE),
                    async (recurrences, drawnEarlier, drawn, today) => {
                        // Un jour à venir, une saisie d'avant ne se joue que hors de leurs plages (apart).
                        const before =
                            today === EVE
                                ? apart([...recurrences, ...drawnEarlier]).slice(recurrences.length)
                                : drawnEarlier;
                        const bench = mountGrid({ top: 480, recurrences, earlier: before, today });
                        const model = startModel(bench);
                        try {
                            expectSound(bench);
                            for (const step of drawn) {
                                await take(bench, model, step);
                                expectShownOnceSaved(bench);
                                expectSound(bench);
                            }
                            const menus = bench.menus.length;
                            await bench.drain();

                            expect(differences(bench, model)).toEqual([]);
                            expect(bench.shown()).toEqual(bench.slow.ranges());
                            expect(bench.editing.window).toBeNull();
                            expect(bench.menus).toHaveLength(menus);
                            expect(bench.snapshot().busy).toBe(false);
                            expect(bench.slow.count + bench.jira.count).toBe(0);
                            expect(linkedButEnded(bench)).toEqual([]);

                            // Tout annuler, un geste après l'autre, chacun une fois le précédent arrivé.
                            for (let undone = 0; model.undo.length > 0 && undone < 60; undone += 1) {
                                bench.undo();
                                rewind(model, 'undo');
                                await bench.drain();
                                expectSound(bench);
                            }
                            expect(differences(bench, model)).toEqual([]);
                            expect(bench.shown()).toEqual(bench.slow.ranges());
                            expect(aliveAfterUndoingAll(bench, model)).toEqual([]);
                        } finally {
                            unmountAll();
                        }
                    },
                ),
                { numRuns: RUNS },
            );
            // Une machine lente, FC_RUNS ou FC_STEPS allongent la suite : son délai la suit.
        },
        Math.max(30_000, RUNS * MAX_STEPS * 3),
    );
});
