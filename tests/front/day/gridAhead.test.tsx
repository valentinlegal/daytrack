// @vitest-environment jsdom
import fc from 'fast-check';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { SlotChange } from '../../../assets/grid/changes';
import type { RecurrenceResult, SendResult, WriteResult } from '../../../assets/grid/daySession';
import { paste } from '../../../assets/grid/clipboard';
import { dropTicket } from '../../../assets/grid/drop';
import { Grid, unlinked } from '../../../assets/grid/grid';
import type { UntilRewind } from '../../../assets/grid/history';
import * as Quarter from '../../../assets/grid/quarter';
import { type RecurrenceRule, type SeenRecurrence, weekly } from '../../../assets/grid/recurrence';
import { gestureExtension, selectionCut, selectionErase, selectionShorten } from '../../../assets/day/recurrenceDraft';
import { selectQuarters } from '../../../assets/grid/selection';
import { QUARTERS, time } from '../../e2e/gridModel';
import { bruteEarliest } from '../grid/clashOracle';
import { FakeDayServer } from '../grid/fakeDayServer';
import { minutes, type Range, rangesOf, weeklyRule } from '../grid/support';
import { type Bench, DATE, EVE, mountGrid, SlowServer, unmountAll } from './gridBench';
import { expectShownOnceSaved } from './gridDriver';

/**
 * Un jour à venir, joué par gridBench.tsx : aujourd'hui est la veille, et
 * ses récurrences n'y sont pas posées mais prévues — montrées, comptées, jamais écrites
 * avant que l'envoi ou un geste qui les touche ne le fasse. Le faux serveur les prévoit
 * comme le vrai (src/Recurrence/RecurrenceForecast.php), et sa version dit lesquelles : un
 * autre onglet qui change une récurrence depuis un autre jour change la journée sans
 * l'écrire.
 *
 * Les gestes se croisent avec un serveur qui retient ses réponses : un geste qui attend
 * pendant qu'un autre onglet arrête la récurrence, un envoi derrière un geste en route.
 * Puis des suites tirées au hasard, sans modèle — effacer, couper, coller, allonger, raccourcir
 * et déplacer un bloc qui revient compris, chaque question répondue au hasard : après chacune, la
 * grille montre ce que le serveur montre — saisies et fois prévues —, ni double, ni fantôme, et le
 * serveur n'a rien refusé de ce que l'écran lui a envoyé, sauf un créneau qu'une autre récurrence
 * prend, que l'écran ne sait qu'en écrivant.
 */

/** Le Daily, de 09:00 à 09:30, né la veille, chaque jour ouvré. */
const DAILY: SlotChange = { start: '09:00', end: '09:30', kind: 'work', ticket: 'OPS-12', comment: 'Daily' };
/** La pause du déjeuner, de 12:30 à 13:30, née la veille, chaque jour ouvré. */
const LUNCH: SlotChange = { start: '12:30', end: '13:30', kind: 'pause', ticket: null, comment: null };
/** Une heure saisie à la main, l'après-midi. */
const HOUR: SlotChange = { start: '14:00', end: '15:00', kind: 'work', ticket: 'SHOP-482', comment: 'Mapping' };
const STALE = "La journée a changé entre-temps. Rien n'a été modifié.";

afterEach(() => {
    unmountAll();
});

/** Les récurrences du banc, dans l'ordre où elles sont nées. */
function seeded(bench: Bench): string[] {
    return bench.slow.server.allRecurrences().map((recurrence) => recurrence.id);
}

/** Ce que la base garde de la journée, sans ses fois prévues. */
function saved(bench: Bench): Range[] {
    return rangesOf(bench.slow.server.saved(DATE).grid);
}

/** Les écritures que la journée du banc a reçues. */
function writesOfDay(bench: Bench): string[] {
    return bench.slow.server.writes.filter((request) => request.date === DATE).map((request) => request.kind);
}

describe('un jour à venir et ses fois prévues, gestes croisés', () => {
    it('montre ses fois prévues, liées à leur récurrence, sans rien écrire', async () => {
        const bench = mountGrid({ recurrences: [DAILY, LUNCH], top: 540, today: EVE });
        await bench.settle();
        const [daily, lunch] = seeded(bench);

        expect(bench.shown()).toEqual([
            ['09:00', '09:30', 'work', 'OPS-12', 'Daily', daily],
            ['12:30', '13:30', 'pause', null, null, lunch],
        ]);
        expect(bench.snapshot().day.grid.workedMinutes()).toBe(30);
        expect(saved(bench)).toEqual([]);
        expect(writesOfDay(bench)).toEqual([]);
    });

    it('un autre onglet arrête la récurrence depuis la veille pendant qu’un geste attend : le geste suivant est refusé, et la journée relue ne la montre plus', async () => {
        const bench = mountGrid({ recurrences: [DAILY], blocks: [HOUR], top: 840, today: EVE });
        const [daily] = seeded(bench);
        expect(bench.shown()).toEqual([
            ['09:00', '09:30', 'work', 'OPS-12', 'Daily', daily],
            ['14:00', '15:00', 'work', 'SHOP-482', 'Mapping'],
        ]);
        bench.slow.hold();
        bench.click(840);
        bench.press('Delete');
        await bench.settle();
        expect(bench.slow.count).toBe(1);

        // Lundi, dans un autre onglet, la case du Daily est décochée : il ne tombe plus mardi.
        bench.recurrenceElsewhere(daily ?? '', EVE, null);
        bench.click(855);
        bench.press('Delete');
        const writes = writesOfDay(bench).length;
        await bench.answer(bench.slow);
        await bench.drain();

        expect(bench.editing.message?.content).toBe(STALE);
        expect(writesOfDay(bench)).toHaveLength(writes);
        expect(bench.slow.ranges()).toEqual([['14:15', '15:00', 'work', 'SHOP-482', 'Mapping']]);
        expect(bench.shown()).toEqual(bench.slow.ranges());
        expectShownOnceSaved(bench);

        // Refait sur la journée relue, il efface.
        bench.press('Delete');
        await bench.drain();
        expect(bench.slow.ranges()).toEqual([['14:30', '15:00', 'work', 'SHOP-482', 'Mapping']]);
        expect(bench.shown()).toEqual(bench.slow.ranges());
    });

    it('un autre onglet coupe la récurrence depuis la veille : relue, la journée montre la nouvelle, une seule fois', async () => {
        const bench = mountGrid({ recurrences: [DAILY], top: 540, today: EVE });
        const [daily] = seeded(bench);
        bench.recurrenceElsewhere(daily ?? '', EVE, weeklyRule([2, 4]));
        const born = seeded(bench).find((id) => id !== daily);

        bench.comeBack();
        await bench.drain();
        expect(bench.shown()).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', born]]);
        expect(saved(bench)).toEqual([]);

        // En effacer le haut cette fois seulement détache la nouvelle ; annuler la rend prévue.
        bench.click(540);
        bench.press('Delete');
        await bench.drain();
        expect(bench.question()?.action.question).toBe('shorten');
        bench.enter();
        await bench.drain();
        expect(bench.shown()).toEqual([['09:15', '09:30', 'work', 'OPS-12', 'Daily']]);
        bench.undo();
        await bench.drain();
        expect(bench.shown()).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', born]]);
        expect(saved(bench)).toEqual([]);
    });

    it('envoyé derrière un geste en route, écrit ses fois prévues : la journée envoyée est celle qu’on voyait', async () => {
        const bench = mountGrid({ recurrences: [DAILY, LUNCH], top: 540, today: EVE });
        const [, lunch] = seeded(bench);
        bench.slow.hold();
        bench.click(555);
        bench.press('Delete');
        // Le bas du Daily : cette fois seulement, choisi d'avance, part et attend le serveur.
        await bench.settle();
        expect(bench.question()?.action.question).toBe('shorten');
        bench.enter();
        await bench.settle();
        const sent = bench.sendToJira();
        await bench.answer(bench.slow);
        await bench.drain();

        await expect(sent).resolves.toEqual({ kind: 'done' });
        const shown = [
            ['09:00', '09:15', 'work', 'OPS-12', 'Daily'],
            ['12:30', '13:30', 'pause', null, null, lunch],
        ];
        expect(bench.shown()).toEqual(shown);
        expect(saved(bench)).toEqual(shown);
        expect(bench.snapshot().day.send.state).toBe('sent');
        expect(writesOfDay(bench)).toEqual(['changeSlots', 'pose', 'send']);
    });

    it('envoyé, garde ce que l’envoi y a posé : une récurrence née ou coupée ensuite ailleurs ne s’y montre pas, et l’onglet qui montrait sa flèche est en retard', async () => {
        const bench = mountGrid({ recurrences: [DAILY], blocks: [HOUR], top: 840, today: EVE });
        const [daily] = seeded(bench);
        const sent = bench.sendToJira();
        await bench.drain();
        await expect(sent).resolves.toEqual({ kind: 'done' });
        const posed = [
            ['09:00', '09:30', 'work', 'OPS-12', 'Daily', daily],
            ['14:00', '15:00', 'work', 'SHOP-482', 'Mapping'],
        ];
        expect(saved(bench)).toEqual(posed);
        const { server } = bench.slow;
        const version = server.read(DATE).version;

        // Lundi, dans un autre onglet : une revue naît chaque jour ouvré. Rien n'y change.
        const review: SlotChange = { start: '16:00', end: '16:15', kind: 'work', ticket: 'OPS-7', comment: 'Revue' };
        expect(
            server.saveRecurrence(EVE, server.read(EVE).version, [review], weeklyRule([1, 2, 3, 4, 5]), null).status,
        ).toBe('saved');
        expect(server.read(DATE).version).toBe(version);
        // Puis le Daily passe au mardi et au jeudi. Le Daily posé par l'envoi reste, sans flèche :
        // sa récurrence s'arrête avant lui, et la journée change de version.
        bench.recurrenceElsewhere(daily ?? '', EVE, weeklyRule([2, 4]));
        expect(server.read(DATE).version).not.toBe(version);

        // L'onglet qui montrait sa flèche est en retard : rien ne s'écrit, et la journée relue la perd.
        bench.click(840);
        bench.press('Delete');
        await bench.drain();
        expect(bench.editing.message?.content).toBe(STALE);
        const unlinked = [
            ['09:00', '09:30', 'work', 'OPS-12', 'Daily'],
            ['14:00', '15:00', 'work', 'SHOP-482', 'Mapping'],
        ];
        expect(bench.slow.ranges()).toEqual(unlinked);
        expect(bench.shown()).toEqual(unlinked);
        expectShownOnceSaved(bench);

        // Relu, il efface le Daily sans question, et Ctrl+Z le rend.
        bench.click(540);
        bench.click(555, { shiftKey: true });
        bench.press('Delete');
        await bench.drain();
        expect(bench.question()).toBeUndefined();
        expect(bench.shown()).toEqual([['14:00', '15:00', 'work', 'SHOP-482', 'Mapping']]);
        bench.undo();
        await bench.drain();
        expect(bench.editing.message?.content).not.toBe(STALE);
        expect(bench.shown()).toEqual(unlinked);
        expect(bench.slow.ranges()).toEqual(unlinked);
        bench.comeBack();
        await bench.drain();
        expect(bench.shown()).toEqual(bench.slow.ranges());
        expectShownOnceSaved(bench);

        // Vidé puis renvoyé vide, il n'a plus d'envoi : la revue née depuis s'y montre, prévue.
        const empty = { kind: 'empty', ticket: null, comment: null } as const;
        bench.elsewhere({ start: '09:00', end: '09:30', ...empty }, { start: '14:00', end: '15:00', ...empty });
        bench.comeBack();
        await bench.drain();
        const resent = bench.sendToJira();
        await bench.drain();
        await expect(resent).resolves.toEqual({ kind: 'done' });
        // Le Daily coupé depuis, qui revient le mardi, aussi : rien ne l'y avait effacé.
        const named = (comment: string) =>
            seeded(bench).find((id) => {
                const content = server.recurrence(id)?.content;

                return id !== daily && content?.kind === 'work' && content.comment === comment;
            });
        expect(bench.shown()).toEqual([
            ['09:00', '09:30', 'work', 'OPS-12', 'Daily', named('Daily')],
            ['16:00', '16:15', 'work', 'OPS-7', 'Revue', named('Revue')],
        ]);
        expect(saved(bench)).toEqual([]);
    });

    it('envoyé pendant une panne de Jira puis vidé de ses tickets, se rouvre : la revue née depuis s’y montre, la pause redevient prévue, et Ctrl+Z rend le ticket', async () => {
        const bench = mountGrid({ recurrences: [DAILY, LUNCH], blocks: [HOUR], top: 840, today: EVE });
        const [daily, lunch] = seeded(bench);
        const { server } = bench.slow;
        server.setJiraDown(true);
        const sent = bench.sendToJira();
        await bench.drain();
        server.setJiraDown(false);
        await expect(sent).resolves.toEqual({ kind: 'done' });
        const posed = [
            ['09:00', '09:30', 'work', 'OPS-12', 'Daily', daily],
            ['12:30', '13:30', 'pause', null, null, lunch],
            ['14:00', '15:00', 'work', 'SHOP-482', 'Mapping'],
        ];
        expect(saved(bench)).toEqual(posed);

        // Lundi, dans un autre onglet : une revue naît chaque jour ouvré ; l'envoi raté garde le
        // jour tel qu'il l'a posé. Puis le Daily y est effacé cette fois seulement.
        const review: SlotChange = { start: '16:00', end: '16:15', kind: 'work', ticket: 'OPS-7', comment: 'Revue' };
        expect(
            server.saveRecurrence(EVE, server.read(EVE).version, [review], weeklyRule([1, 2, 3, 4, 5]), null).status,
        ).toBe('saved');
        expect(server.read(DATE).settledAhead).toEqual(new Set([DATE]));
        bench.elsewhere({ start: '09:00', end: '09:30', kind: 'empty', ticket: null, comment: null });
        bench.comeBack();
        await bench.drain();
        expect(bench.shown()).toEqual(posed.slice(1));

        // Le dernier ticket effacé, Jira n'a rien de lui : il redevient un jour à venir comme un autre.
        bench.click(840);
        bench.click(885, { shiftKey: true });
        bench.press('Delete');
        await bench.drain();
        const revue = seeded(bench).find((id) => server.recurrence(id)?.content.kind === 'work' && id !== daily);
        const reopened = [
            ['12:30', '13:30', 'pause', null, null, lunch],
            ['16:00', '16:15', 'work', 'OPS-7', 'Revue', revue],
        ];
        expect(bench.shown()).toEqual(reopened);
        expect(saved(bench)).toEqual([]);
        expect(server.read(DATE).settledAhead).toEqual(new Set());
        expectShownOnceSaved(bench);

        // Ctrl+Z rend le ticket ; rien ne referme le jour.
        bench.undo();
        await bench.drain();
        expect(bench.editing.message).toBeNull();
        expect(bench.shown()).toEqual([
            ...reopened.slice(0, 1),
            ['14:00', '15:00', 'work', 'SHOP-482', 'Mapping'],
            ...reopened.slice(1),
        ]);
        expect(bench.shown()).toEqual(bench.slow.ranges());
        expectShownOnceSaved(bench);
    });

    it('n’envoie pas une journée dont un autre onglet a arrêté la récurrence depuis qu’on l’a vue', async () => {
        const bench = mountGrid({ recurrences: [DAILY], top: 540, today: EVE });
        const [daily] = seeded(bench);
        bench.recurrenceElsewhere(daily ?? '', EVE, null);

        const sent = bench.sendToJira();
        await bench.drain();
        await expect(sent).resolves.toEqual({ kind: 'stale' });
        expect(writesOfDay(bench)).toEqual([]);
        expect(bench.shown()).toEqual([]);
    });

    it('s’enregistre une seule fois quand Entrée est répétée dans la fenêtre d’une fois prévue', async () => {
        const bench = mountGrid({ recurrences: [DAILY], top: 540, today: EVE });
        const [daily] = seeded(bench);
        bench.doubleClick(540);
        await bench.drain();
        expect(bench.editing.window?.target.kind).toBe('edit');
        expect(bench.editing.windowRecurrence?.on).toBe(true);

        bench.type('OPS-13', 'Daily');
        bench.slow.hold();
        bench.jira.hold();
        bench.enter();
        // La question vient tout de suite, sans attendre Jira : rien n'est encore parti.
        await bench.settle();
        expect(bench.question()).toMatchObject({ action: { question: 'modify' }, choice: 'once' });
        expect(writesOfDay(bench)).toEqual([]);

        // Avec les suivantes : la même touche, répétée pendant que Jira cherche le ticket, puis
        // pendant l'écriture.
        bench.chooseScope('following');
        bench.enter();
        bench.enter();
        expect(bench.editing.window?.sending).toBe(true);
        await bench.answer(bench.jira);
        bench.enter();
        await bench.drain();

        expect(writesOfDay(bench)).toEqual(['saveRecurrence']);
        // Le ticket change à partir de cette fois : la récurrence se coupe, la nouvelle pose la sienne.
        const born = seeded(bench).find((id) => id !== daily);
        expect(bench.shown()).toEqual([['09:00', '09:30', 'work', 'OPS-13', 'Daily', born]]);
        expect(bench.shown()).toEqual(bench.slow.ranges());
        expect(bench.slow.server.recurrence(daily ?? '')?.until).toBe(EVE);

        // Entrée de nouveau, sur la grille : la fenêtre se rouvre sur ce qui est enregistré, sans rien écrire.
        bench.press('Enter');
        await bench.drain();
        expect(bench.editing.window?.draft).toEqual({ ticket: 'OPS-13', comment: 'Daily' });
        bench.escape();
        await bench.drain();
        expect(writesOfDay(bench)).toEqual(['saveRecurrence']);
    });

    it('mis à 0h00, ne prévoit plus rien ; revenu à son objectif, prévoit de nouveau', async () => {
        const bench = mountGrid({ recurrences: [DAILY], blocks: [HOUR], top: 540, today: EVE });
        const [daily] = seeded(bench);
        await act(async () => {
            await bench.session.setObjective(0);
        });
        expect(bench.snapshot().day.declaredOff).toBe(true);
        expect(bench.shown()).toEqual([['14:00', '15:00', 'work', 'SHOP-482', 'Mapping']]);

        await act(async () => {
            await bench.session.setObjective(bench.snapshot().day.habitualObjective);
        });
        expect(bench.shown()).toEqual([
            ['09:00', '09:30', 'work', 'OPS-12', 'Daily', daily],
            ['14:00', '15:00', 'work', 'SHOP-482', 'Mapping'],
        ]);
        expect(saved(bench)).toEqual([['14:00', '15:00', 'work', 'SHOP-482', 'Mapping']]);
    });

    it('mis à 0h00 pendant que l’effacement d’une fois prévue attend : Ctrl+Z, parti derrière, ne la ramène pas, et le retour à l’objectif la rend', async () => {
        const bench = mountGrid({ recurrences: [DAILY], blocks: [HOUR], top: 540, today: EVE });
        const [daily] = seeded(bench);
        const hour: Range = ['14:00', '15:00', 'work', 'SHOP-482', 'Mapping'];
        bench.select([540, 555]);
        bench.press('Delete');
        await bench.drain();
        expect(bench.question()?.action.question).toBe('erase');
        bench.enter();
        await bench.drain();
        expect(bench.shown()).toEqual([hour]);

        // Le 0h00 part et attend le serveur ; Ctrl+Z part derrière lui, sur la journée qu'il rend.
        bench.slow.hold();
        act(() => {
            void bench.session.setObjective(0);
        });
        bench.undo();
        await bench.answer(bench.slow);
        await bench.drain();

        expect(bench.snapshot().day.declaredOff).toBe(true);
        expect(bench.shown()).toEqual([hour]);
        expect(saved(bench)).toEqual([hour]);
        expect(bench.slow.server.isHeld(daily ?? '', DATE)).toBe(true);
        expect(bench.editing.message).toBeNull();
        expectShownOnceSaved(bench);

        await act(async () => {
            await bench.session.setObjective(bench.snapshot().day.habitualObjective);
        });
        expect(bench.shown()).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', daily], hour]);
        expect(saved(bench)).toEqual([hour]);
    });

    it('vidé puis mis à 0h00, se ferme ; « Annuler » du message reste juste : la fois revient à sa série, et le retour à l’objectif la rend', async () => {
        const bench = mountGrid({ recurrences: [DAILY], top: 540, today: EVE, closes: true });
        const [daily] = seeded(bench);
        bench.select([540, 555]);
        bench.press('Delete');
        await bench.drain();
        bench.enter();
        await bench.drain();
        expect(bench.shown()).toEqual([]);
        expect(bench.editing.message?.action).toBeDefined();

        await act(async () => {
            await bench.session.setObjective(0);
        });
        expect(bench.editing.closed).toBe(true);
        expect(bench.editing.message?.action).toBeDefined();

        bench.undoMessage();
        await bench.drain();
        expect(bench.editing.message).toBeNull();
        expect(bench.shown()).toEqual([]);
        expect(bench.slow.server.isHeld(daily ?? '', DATE)).toBe(true);

        await act(async () => {
            await bench.session.setObjective(bench.snapshot().day.habitualObjective);
        });
        expect(bench.shown()).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', daily]]);
        expect(saved(bench)).toEqual([]);
    });

    it('fermé sous le curseur, garde Ctrl/⌘+Z et Ctrl/⌘+Maj+Z tant qu’on y est ; quitté puis revenu, ni l’un ni l’autre', async () => {
        const bench = mountGrid({ recurrences: [DAILY], top: 540, today: EVE, closes: true });
        const [daily = ''] = seeded(bench);
        const { server } = bench.slow;
        bench.select([540, 555]);
        bench.press('Delete');
        await bench.drain();
        bench.enter();
        await bench.drain();
        await act(async () => {
            await bench.session.setObjective(0);
        });
        expect(bench.editing.closed).toBe(true);

        // Ctrl+Z rend la fois à sa série, que le 0h00 retient ; Ctrl+Maj+Z refait l'effacement.
        bench.undo();
        await bench.drain();
        expect(server.isHeld(daily, DATE)).toBe(true);
        bench.undo(true);
        await bench.drain();
        expect(server.isHeld(daily, DATE)).toBe(false);
        expect(server.isSkipped(daily, DATE)).toBe(true);
        expect(bench.snapshot().canUndo).toBe(true);

        // Revenu, il est fermé : ni Ctrl+Z ni Ctrl+Maj+Z, pendant qu'il s'ouvre comme une fois lu.
        const before = writesOfDay(bench);
        expect(await bench.switchDay(EVE)).toBe(true);
        expect(await bench.openSlowly(DATE)).toBe(true);
        bench.undo();
        await bench.arrive();
        await bench.drain();
        expect(server.isHeld(daily, DATE)).toBe(false);
        bench.undo();
        await bench.drain();
        bench.undo(true);
        await bench.drain();
        expect(bench.editing.closed).toBe(true);
        expect(writesOfDay(bench)).toEqual(before);
        expect(server.isSkipped(daily, DATE)).toBe(true);
        expect(server.isHeld(daily, DATE)).toBe(false);

        // Rendu à son objectif, il rouvre sans la fois ; Ctrl+Z la rend, liée à sa série.
        await act(async () => {
            await bench.session.setObjective(bench.snapshot().day.habitualObjective);
        });
        expect(bench.shown()).toEqual([]);
        bench.undo();
        await bench.drain();
        expect(bench.shown()).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', daily]]);
        expectShownOnceSaved(bench);
    });

    it('mis à 0h00 dans un autre onglet, garde l’effacement à annuler : Ctrl+Z, refusé puis refait sur le congé, ne ramène pas la fois', async () => {
        const bench = mountGrid({ recurrences: [DAILY], blocks: [HOUR], top: 540, today: EVE });
        const [daily] = seeded(bench);
        const hour: Range = ['14:00', '15:00', 'work', 'SHOP-482', 'Mapping'];
        bench.select([540, 555]);
        bench.press('Delete');
        await bench.drain();
        bench.enter();
        await bench.drain();
        const { server } = bench.slow;
        expect(server.setObjective(DATE, server.read(DATE).version, 0).status).toBe('saved');

        bench.undo();
        await bench.drain();
        expect(bench.editing.message?.content).toBe(STALE);
        expect(bench.snapshot().day.declaredOff).toBe(true);

        // Le geste reste à annuler sur la journée relue, où rien n'a bougé à sa place.
        bench.undo();
        await bench.drain();
        expect(bench.shown()).toEqual([hour]);
        expect(saved(bench)).toEqual([hour]);
        expect(server.isHeld(daily ?? '', DATE)).toBe(true);
        expectShownOnceSaved(bench);
    });

    /**
     * Le Daily de 09:00 à 10:00 passe avant la pause de 09:30 à 10:30, qui ne prévoit que 10:00 à
     * 10:30 : deux récurrences nées avant le refus d'un créneau pris, qui se croisent encore.
     */
    function overlapping(): { bench: Bench; start: Range[]; pause: string } {
        const bench = mountGrid({
            recurrences: [
                { ...DAILY, end: '10:00' },
                { ...LUNCH, start: '09:30', end: '10:30' },
            ],
            crossing: true,
            top: 540,
            today: EVE,
        });
        const [daily = '', pause = ''] = seeded(bench);
        const start: Range[] = [
            ['09:00', '10:00', 'work', 'OPS-12', 'Daily', daily],
            ['10:00', '10:30', 'pause', null, null, pause],
        ];
        expect(bench.shown()).toEqual(start);

        return { bench, start, pause };
    }

    it('deux récurrences qui se chevauchent : le quart d’heure qu’un geste libère dans la plage de l’autre lui revient', async () => {
        const { bench, pause } = overlapping();

        bench.click(570);
        bench.press('Delete');
        await bench.drain();

        // Comme le jour venu la poserait : la pause prend le quart d'heure libéré.
        expect(bench.shown()).toEqual([
            ['09:00', '09:30', 'work', 'OPS-12', 'Daily'],
            ['09:30', '09:45', 'pause', null, null, pause],
            ['09:45', '10:00', 'work', 'OPS-12', 'Daily'],
            ['10:00', '10:30', 'pause', null, null, pause],
        ]);
        expect(bench.shown()).toEqual(bench.slow.ranges());
        expect(saved(bench)).toEqual([
            ['09:00', '09:30', 'work', 'OPS-12', 'Daily'],
            ['09:45', '10:00', 'work', 'OPS-12', 'Daily'],
        ]);
    });

    // Annuler rend 09:30 au Daily alors que la pause l'y prévoit entre-temps : elle lui cède,
    // sans se détacher, et retrouve 10:00 à 10:30 avec sa flèche.
    it('deux récurrences qui se chevauchent : Ctrl+Z rend la journée de départ, la pause comprise', async () => {
        const { bench, start, pause } = overlapping();
        bench.click(570);
        bench.press('Delete');
        await bench.drain();

        bench.undo();
        await bench.drain();
        expect(bench.shown()).toEqual(bench.slow.ranges());
        expect(bench.shown()).toEqual(start);
        expect(saved(bench)).toEqual([]);
        expect(bench.slow.server.isSkipped(pause, DATE)).toBe(false);
    });

    it('deux récurrences qui se chevauchent : effacer la plus ancienne, annuler, puis rétablir la redétache', async () => {
        // Le Daily de 09:30 à 10:00, né d'abord, passe avant la pause de 09:00 à 10:30, née ensuite.
        const bench = mountGrid({
            recurrences: [
                { ...DAILY, start: '09:30', end: '10:00' },
                { ...LUNCH, start: '09:00', end: '10:30' },
            ],
            crossing: true,
            top: 540,
            today: EVE,
        });
        const [daily = '', pause = ''] = seeded(bench);
        const start: Range[] = [
            ['09:00', '09:30', 'pause', null, null, pause],
            ['09:30', '10:00', 'work', 'OPS-12', 'Daily', daily],
            ['10:00', '10:30', 'pause', null, null, pause],
        ];
        const erased: Range[] = [['09:00', '10:30', 'pause', null, null, pause]];
        expect(bench.shown()).toEqual(start);

        bench.select([570, 585]);
        bench.press('Delete');
        await bench.drain();
        // La fois entière du Daily : la question, cette fois seulement choisi d'avance.
        expect(bench.question()?.action.question).toBe('erase');
        bench.enter();
        await bench.drain();
        expect(bench.shown()).toEqual(erased);
        expect(bench.slow.server.isSkipped(daily, DATE)).toBe(true);

        bench.undo();
        await bench.drain();
        expect(bench.shown()).toEqual(start);
        expect(bench.slow.server.isSkipped(daily, DATE)).toBe(false);

        // Rétablir relie 09:30 à 10:00 à la pause, qui passe après le Daily : le Daily se détache de nouveau.
        bench.undo(true);
        await bench.drain();
        expect(bench.shown()).toEqual(erased);
        expect(bench.shown()).toEqual(bench.slow.ranges());
        expect(bench.slow.server.isSkipped(daily, DATE)).toBe(true);
        expect(bench.slow.server.isSkipped(pause, DATE)).toBe(false);
        expect(saved(bench)).toEqual([]);

        bench.undo();
        await bench.drain();
        expect(bench.shown()).toEqual(start);
    });
});

/** Les quarts d'heure des gestes tirés : la matinée, et les deux bornes de la journée. */
const SPOTS = [420, 435, ...QUARTERS, 1170, 1185];

/** Du quart d'heure n° `from` de SPOTS à celui `length - 1` plus loin, d'un seul tenant. */
function spanOf(from: number, length: number): number[] {
    const first = SPOTS[from] ?? 420;
    const last = SPOTS[Math.min(from + length - 1, SPOTS.length - 1)] ?? first;
    const quarters: number[] = [];
    for (let quarter = first; quarter <= last; quarter += 15) {
        quarters.push(quarter);
    }

    return quarters;
}

const span = fc.record({
    from: fc.integer({ min: 0, max: SPOTS.length - 1 }),
    length: fc.integer({ min: 1, max: 4 }),
});

/**
 * Une ou deux récurrences nées la veille, qui peuvent se chevaucher — nées avant le refus d'un
 * créneau pris, que le serveur garde —, et toucher les bornes de la journée.
 */
const aheadSeeds = fc.array(
    fc.tuple(span, fc.constantFrom('SHOP-1|Revue', 'OPS-3|', 'pause')).map(([{ from, length }, content]) => {
        const quarters = spanOf(from, length);
        const [ticket = '', comment = ''] = content.split('|');

        return {
            start: time(quarters[0] ?? 420),
            end: time((quarters.at(-1) ?? 420) + 15),
            kind: content === 'pause' ? 'pause' : 'work',
            ticket: content === 'pause' ? null : ticket,
            comment: content === 'pause' || comment === '' ? null : comment,
        } satisfies SlotChange;
    }),
    { maxLength: 2 },
);

/** La réponse à la question qu'un geste pose sur un bloc qui revient, ou Annuler. */
type AheadAnswer = 'once' | 'following' | 'cancel';

type AheadStep =
    /**
     * Suppr ; sur une fois entière d'une récurrence, ou son haut ou son bas, la question :
     * cette fois seulement, avec les suivantes, ou Annuler.
     */
    | { type: 'clear'; from: number; length: number; answer: AheadAnswer }
    /**
     * Ctrl+X ; sur une fois entière d'une récurrence, d'un seul tenant, la question « Couper ».
     * Puis, s'il est tiré, Ctrl+V sur ce quart d'heure : avec les suivantes, la récurrence y
     * repart, ou le créneau est refusé.
     */
    | {
          type: 'cut';
          from: number;
          length: number;
          answer: AheadAnswer;
          then: number | null;
          /** Ces quarts d'heure plutôt que la plage tirée. */
          span?: readonly number[];
      }
    | { type: 'pause'; from: number; length: number }
    /**
     * Copier puis coller — ou coller ce que tient le presse-papier, une récurrence coupée
     * comprise ; au bord d'un bloc qui revient, du même contenu, la question « Allonger ».
     */
    | { type: 'paste'; from: number; length: number; to: number; copies: boolean; answer: AheadAnswer }
    /** Un favori déposé ; au bord d'un bloc qui revient du même ticket, sans commentaire, la question « Allonger ». */
    | { type: 'drop'; at: number; ticket: string; answer: AheadAnswer }
    /**
     * Le premier quart d'heure d'un bloc qui revient, copié puis collé juste au-dessus ou
     * au-dessous de lui, sur un ou deux quarts d'heure : la question « Allonger », si le bloc est
     * entier ; ou son ticket déposé depuis les favoris, s'il n'a pas de commentaire.
     */
    | { type: 'extend'; seed: number; below: boolean; length: number; by: 'paste' | 'drop'; answer: AheadAnswer }
    /** Le bloc entier d'une récurrence de départ, coupé — la question « Couper » —, puis collé là. */
    | { type: 'move'; seed: number; answer: AheadAnswer; to: number }
    | { type: 'undo' | 'redo' | 'return' | 'send' }
    /** Jira tombe en panne, ou revient : un envoi en panne pose ce qu'il montre sans rien écrire dans Jira. */
    | { type: 'jira'; down: boolean }
    | { type: 'objective'; minutes: number }
    /** Un autre onglet, lundi, décoche une récurrence, lui donne d'autres jours, ou la fait finir lundi. */
    | { type: 'elsewhere'; seed: number; then: 'stop' | 'days' | 'until' }
    | { type: 'hold' | 'one' | 'all' };

/** Les gestes de la page seule : la grille, annuler et rétablir, la relecture, le serveur qui tarde. */
const aheadAnswer = fc.constantFrom<AheadAnswer>('once', 'following', 'following', 'cancel');

const pageSteps = [
    {
        arbitrary: fc.tuple(span, aheadAnswer).map(([s, answer]): AheadStep => ({ type: 'clear', ...s, answer })),
        weight: 3,
    },
    {
        arbitrary: fc
            .tuple(span, aheadAnswer, fc.option(fc.constantFrom(...SPOTS), { nil: null }))
            .map(([s, answer, then]): AheadStep => ({ type: 'cut', ...s, answer, then })),
        weight: 3,
    },
    { arbitrary: span.map((s): AheadStep => ({ type: 'pause', ...s })), weight: 2 },
    {
        arbitrary: fc
            .tuple(span, fc.integer({ min: 0, max: SPOTS.length - 1 }), fc.boolean(), aheadAnswer)
            .map(([s, to, copies, answer]): AheadStep => ({
                type: 'paste',
                ...s,
                to: SPOTS[to] ?? 420,
                copies,
                answer,
            })),
        weight: 3,
    },
    {
        arbitrary: fc
            .tuple(fc.constantFrom(...SPOTS), fc.constantFrom('SHOP-1', 'OPS-3'), aheadAnswer)
            .map(([at, ticket, answer]): AheadStep => ({ type: 'drop', at, ticket, answer })),
        weight: 1,
    },
    {
        arbitrary: fc
            .record({
                seed: fc.constantFrom(0, 1),
                below: fc.boolean(),
                length: fc.integer({ min: 1, max: 2 }),
                by: fc.constantFrom('paste' as const, 'paste' as const, 'drop' as const),
                answer: aheadAnswer,
            })
            .map((drawn): AheadStep => ({ type: 'extend', ...drawn })),
        weight: 2,
    },
    {
        arbitrary: fc
            .tuple(fc.constantFrom(0, 1), aheadAnswer, fc.constantFrom(...SPOTS))
            .map(([seed, answer, to]): AheadStep => ({ type: 'move', seed, answer, to })),
        weight: 1,
    },
    { arbitrary: fc.constantFrom<AheadStep>({ type: 'undo' }, { type: 'redo' }), weight: 3 },
    { arbitrary: fc.constant<AheadStep>({ type: 'return' }), weight: 1 },
    { arbitrary: fc.constantFrom<AheadStep>({ type: 'hold' }, { type: 'one' }, { type: 'all' }), weight: 3 },
];

/** Et ce qui change la journée autrement : l'envoi, Jira en panne, l'objectif, un autre onglet. */
const otherSteps = [
    { arbitrary: fc.constant<AheadStep>({ type: 'send' }), weight: 1 },
    { arbitrary: fc.boolean().map((down): AheadStep => ({ type: 'jira', down })), weight: 1 },
    {
        arbitrary: fc.constantFrom(0, 450).map((minutes): AheadStep => ({ type: 'objective', minutes })),
        weight: 1,
    },
    {
        arbitrary: fc
            .tuple(fc.constantFrom(0, 1), fc.constantFrom('stop' as const, 'days' as const, 'until' as const))
            .map(([seed, then]): AheadStep => ({ type: 'elsewhere', seed, then })),
        weight: 1,
    },
];

/**
 * Une suite sur la page seule, ou mêlée du reste, une fois sur deux : seule, tout annuler doit
 * rendre la journée de départ.
 */
const aheadSteps = fc.oneof(
    fc.array(fc.oneof(...pageSteps), { minLength: 8, maxLength: 30, size: 'max' }),
    fc.array(fc.oneof(...pageSteps, ...otherSteps), { minLength: 8, maxLength: 30, size: 'max' }),
);

/**
 * Le faux serveur, qui garde ce qu'il a refusé de ce que l'écran lui envoie, et ce que
 * chaque envoi a fait partir comparé à la journée que l'écran montrait.
 */
class WatchedServer extends FakeDayServer {
    readonly refused: string[] = [];
    readonly sentOtherwise: string[] = [];
    /**
     * Les créneaux refusés à une récurrence collée ou allongée : une autre les prend. L'écran
     * ne le sait qu'en écrivant, comme dans la fenêtre — le refus se dit en bas de la grille.
     */
    readonly clashes: string[] = [];
    /**
     * Les refus faits à l'autre onglet, sur un autre jour que celui de la page : sa fenêtre
     * mènerait une récurrence coupée au-delà de son collage (FakeDayServer::assertMovedLonger).
     * Rien n'y change ; ce n'est pas un refus fait à la page.
     */
    readonly elsewhere: string[] = [];

    override changeSlots(
        date: string,
        version: number,
        changes: readonly SlotChange[],
        untils: readonly UntilRewind[] = [],
        restores = false,
        detaches: readonly string[] = [],
    ): WriteResult {
        return this.watch(super.changeSlots(date, version, changes, untils, restores, detaches));
    }

    override saveRecurrence(
        date: string,
        version: number,
        changes: readonly SlotChange[],
        rule: RecurrenceRule | null,
        replaces: SeenRecurrence | null,
        follows: string | null = null,
    ): RecurrenceResult {
        const result = super.saveRecurrence(date, version, changes, rule, replaces, follows);
        if (
            result.status === 'invalid' &&
            rule !== null &&
            result.violations.every((violation) => violation.message.startsWith('Ce créneau est déjà pris'))
        ) {
            this.clashes.push(JSON.stringify(result.violations));

            return result;
        }
        if (result.status === 'invalid' && date !== DATE) {
            this.elsewhere.push(JSON.stringify(result.violations));

            return result;
        }

        return this.watch(result);
    }

    override setObjective(date: string, version: number, objective: number): WriteResult {
        return this.watch(super.setObjective(date, version, objective));
    }

    override send(date: string, version: number): SendResult {
        const shown = this.at(date, version);
        const result = super.send(date, version);
        const sent = forJira(this.saved(date).grid);
        const seen = forJira(shown?.grid ?? this.saved(date).grid);
        if (result.status === 'done' && JSON.stringify(sent) !== JSON.stringify(seen)) {
            this.sentOtherwise.push(`envoyé ${JSON.stringify(sent)}, montré ${JSON.stringify(seen)}`);
        }

        return result;
    }

    private watch<T extends WriteResult | RecurrenceResult>(result: T): T {
        if (result.status === 'invalid') {
            this.refused.push(JSON.stringify(result.violations));
        }

        return result;
    }
}

/**
 * Ce que Jira reçoit d'une journée : ses blocs, sans le lien de leur récurrence. Arrêtée depuis
 * un autre jour, une récurrence ne montre plus son lien sur un bloc déjà écrit, sans que la
 * version change (src/Day/DayReader.php) : l'envoi fait partir les mêmes heures.
 */
function forJira(grid: Grid): Range[] {
    return rangesOf(
        Grid.of(
            Quarter.all().flatMap((quarter) => {
                const cell = grid.at(quarter);

                return cell === null ? [] : [[quarter, unlinked(cell)] as const];
            }),
        ),
    );
}

/** Le bloc d'une récurrence de départ que la veille montre encore, lié à elle : un autre onglet peut l'y changer. */
function changeableOnEve(bench: Bench, id: string): boolean {
    return bench.slow.server
        .read(EVE)
        .grid.blocks()
        .some((block) => block.content.recurrence === id);
}

/** Ce qu'annuler et rétablir ont rendu d'autre qu'un geste fait, ou rien à faire : refusés, la journée ayant changé. */
function refusalsOfRewinds(bench: Bench): string[] {
    const refusals: string[] = [];
    const { session } = bench;
    for (const method of ['undo', 'redo'] as const) {
        const rewind = session[method].bind(session);
        session[method] = () =>
            rewind().then((outcome) => {
                if (outcome.kind === 'conflict' || outcome.kind === 'stale' || outcome.kind === 'invalid') {
                    refusals.push(`${method} : ${outcome.kind}`);
                }

                return outcome;
            });
    }

    return refusals;
}

/**
 * La question qu'un geste pose sur un bloc qui revient — effacer, raccourcir, couper, allonger —,
 * une fois ouverte, ou le geste fait sans elle, la journée enregistrée ne s'y prêtant plus : la
 * réponse tirée. Comme quelqu'un devant l'écran, on attend de la voir, les réponses retenues
 * lâchées une à une. Chaque réponse ne part qu'une fois, même à Entrée répétée.
 */
async function answerAsked(bench: Bench, answer: AheadAnswer): Promise<void> {
    const shown = (): boolean => {
        const open = bench.editing.window;

        return open === null ? !bench.snapshot().busy : open.question !== undefined && !open.sending;
    };
    await bench.settle();
    while (!shown()) {
        const from = bench.slow.count > 0 ? bench.slow : bench.jira.count > 0 ? bench.jira : null;
        if (from === null) {
            throw new Error("L'écran ne montre jamais la question.");
        }
        await bench.answer(from, false);
    }
    if (bench.question() === undefined) {
        return;
    }
    if (answer === 'cancel') {
        bench.back();
    } else {
        if (answer === 'following') {
            bench.chooseScope('following');
        }
        const requests = bench.slow.requests.length;
        bench.enter();
        bench.enter();
        await bench.settle();
        expect(bench.slow.requests.length - requests).toBeLessThanOrEqual(1);
    }
    await bench.settle();
}

/** Coller ce que le presse-papier de la journée affichée tient poserait-il la question « Allonger » ? */
function pasteExtends(bench: Bench, quarters: readonly number[]): boolean {
    const clipboard = bench.session.clipboard();
    const result =
        clipboard === null || clipboard.recurrence !== undefined ? null : paste(clipboard, selectQuarters(quarters));

    return (
        result?.kind === 'paste' &&
        gestureExtension(bench.snapshot().day, result.changes, bench.today, 'paste') !== null
    );
}

/** Joue un pas ; vrai si un autre onglet a changé une récurrence, ce que l'écran ne sait qu'en relisant. */
async function playAhead(bench: Bench, seeds: readonly string[], step: AheadStep): Promise<boolean> {
    switch (step.type) {
        case 'clear': {
            const quarters = spanOf(step.from, step.length);
            bench.select(quarters);
            // L'écran en décide sur la journée qu'il montre, puis la juge sur la journée
            // enregistrée : la fenêtre attend les gestes d'avant pour s'ouvrir.
            const { day } = bench.snapshot();
            const head = bench.editing.selection.head;
            const asks =
                (selectionErase(day, quarters, bench.today, head) ?? selectionShorten(day, quarters, bench.today)) !==
                null;
            bench.press('Delete');
            if (asks) {
                await answerAsked(bench, step.answer);
            }
            break;
        }
        case 'cut': {
            const quarters = step.span ?? spanOf(step.from, step.length);
            bench.select(quarters);
            const asks =
                selectionCut(bench.snapshot().day, quarters, bench.today, bench.editing.selection.head) !== null;
            bench.press('x', { ctrlKey: true });
            if (asks) {
                await answerAsked(bench, step.answer);
            }
            if (step.then !== null) {
                await playAhead(bench, seeds, {
                    type: 'paste',
                    from: 0,
                    length: 1,
                    to: step.then,
                    copies: false,
                    answer: step.answer,
                });
            }
            break;
        }
        case 'pause':
            bench.select(spanOf(step.from, step.length));
            bench.choose('convertToPause');
            break;
        case 'paste': {
            if (step.copies) {
                bench.select(spanOf(step.from, step.length));
                bench.press('c', { ctrlKey: true });
                await bench.settle();
            }
            bench.click(step.to);
            const asks = pasteExtends(bench, [step.to]);
            bench.press('v', { ctrlKey: true });
            if (asks) {
                await answerAsked(bench, step.answer);
            }
            break;
        }
        case 'drop': {
            // Une fenêtre encore ouverte s'enregistre d'abord : le favori n'en décide qu'après, sur
            // la journée enregistrée, où la question « Allonger » peut alors s'ouvrir.
            const asks =
                bench.editing.window !== null ||
                gestureExtension(bench.snapshot().day, dropTicket(step.ticket, step.at), bench.today, 'replace') !==
                    null;
            bench.dropFavorite(step.ticket, step.at);
            if (asks) {
                await answerAsked(bench, step.answer);
            }
            break;
        }
        case 'extend': {
            const id = seeds[step.seed];
            const block = bench
                .snapshot()
                .day.grid.blocks()
                .find((candidate) => candidate.content.recurrence === id);
            if (block === undefined) {
                break;
            }
            const first = step.below ? block.end : block.start - step.length * Quarter.MINUTES;
            const quarters = Array.from({ length: step.length }, (_, index) => first + index * Quarter.MINUTES);
            if (!quarters.every((quarter) => Quarter.isQuarter(quarter))) {
                break;
            }
            if (step.by === 'drop') {
                const { content } = block;
                const ticket = content.kind === 'work' && content.comment === null ? content.ticket : 'SHOP-1';
                await playAhead(bench, seeds, { type: 'drop', at: quarters[0] ?? first, ticket, answer: step.answer });
                break;
            }
            bench.click(block.start);
            bench.press('c', { ctrlKey: true });
            await bench.settle();
            bench.select(quarters);
            const asks = pasteExtends(bench, quarters);
            bench.press('v', { ctrlKey: true });
            if (asks) {
                await answerAsked(bench, step.answer);
            }
            break;
        }
        case 'move': {
            const id = seeds[step.seed];
            const block = bench
                .snapshot()
                .day.grid.blocks()
                .find((candidate) => candidate.content.recurrence === id);
            if (block !== undefined) {
                const quarters = Quarter.between(block.start, block.end);
                await playAhead(bench, seeds, {
                    type: 'cut',
                    from: 0,
                    length: 0,
                    answer: step.answer,
                    then: step.to,
                    span: quarters,
                });
            }
            break;
        }
        case 'undo':
        case 'redo':
            bench.undo(step.type === 'redo');
            break;
        case 'return':
            bench.comeBack();
            break;
        case 'send':
            void bench.sendToJira();
            break;
        case 'jira':
            bench.slow.server.setJiraDown(step.down);
            break;
        case 'objective':
            act(() => {
                void bench.session.setObjective(step.minutes);
            });
            break;
        case 'elsewhere': {
            const id = seeds[step.seed];
            if (id === undefined || !changeableOnEve(bench, id)) {
                return false;
            }
            const record = bench.slow.server.recurrence(id);
            const weekdays = record?.weekdays ?? [];
            // D'autres jours sur un créneau qu'une autre prend encore : l'autre onglet ne le peut
            // pas, sa fenêtre le refuse avant d'enregistrer.
            if (step.then === 'days' && record !== undefined) {
                const others = [...bench.slow.server.read(EVE).ongoing.values()].filter((other) => other.id !== id);
                const candidate = {
                    rhythm: weekly([2, 4]),
                    firstDay: EVE,
                    until: null,
                    start: minutes(record.start),
                    end: minutes(record.end),
                };
                if (bruteEarliest(candidate, others, EVE) !== null) {
                    return false;
                }
            }
            // Coupée puis collée, d'autres jours la mèneraient au-delà du collage : refusé, rien ne change.
            const changed = bench.recurrenceElsewhere(
                id,
                EVE,
                step.then === 'stop' ? null : step.then === 'days' ? weeklyRule([2, 4]) : weeklyRule(weekdays, EVE),
            );
            await bench.settle();

            return changed;
        }
        case 'hold':
            bench.slow.hold();
            break;
        case 'one':
        case 'all':
            await bench.answer(bench.slow, step.type === 'all');
            break;
    }
    await bench.settle();

    return false;
}

const RUNS = Number(process.env.FC_RUNS ?? 200);

describe('des gestes tirés au hasard sur un jour à venir', () => {
    it(
        'laissent la grille telle que le serveur la montre, saisies et fois prévues, sans rien qu’il refuse ni rien en route',
        async () => {
            await fc.assert(
                fc.asyncProperty(aheadSeeds, aheadSteps, async (recurrences, drawn) => {
                    const server = new WatchedServer();
                    const bench = mountGrid({
                        recurrences,
                        crossing: true,
                        top: 480,
                        today: EVE,
                        slow: new SlowServer(server),
                    });
                    const seeds = seeded(bench);
                    // Deux récurrences de départ qui se croisent : annuler l'arrêt de l'une la
                    // ramènerait sur le créneau de l'autre, ce que le serveur refuse désormais.
                    const [first, second] = recurrences;
                    const crossing =
                        first !== undefined &&
                        second !== undefined &&
                        minutes(first.start) < minutes(second.end) &&
                        minutes(second.start) < minutes(first.end);
                    const start = bench.shown();
                    const undoRefusals = refusalsOfRewinds(bench);
                    try {
                        let foreign = false;
                        for (const step of drawn) {
                            foreign = (await playAhead(bench, seeds, step)) || foreign;
                            expectShownOnceSaved(bench);
                        }
                        await bench.drain();
                        const calm =
                            !foreign &&
                            !crossing &&
                            drawn.every((step) => step.type !== 'objective' && step.type !== 'send');

                        // Personne d'autre n'a rien changé : la grille montre déjà ce que le serveur montre.
                        if (!foreign) {
                            expect(bench.shown()).toEqual(bench.slow.ranges());
                        }
                        // La page y revient, et relit la journée.
                        bench.comeBack();
                        await bench.drain();
                        expect(bench.shown()).toEqual(bench.slow.ranges());
                        expect(server.refused).toEqual([]);
                        expect(server.sentOtherwise).toEqual([]);
                        expect(bench.editing.window).toBeNull();
                        expect(bench.snapshot().busy).toBe(false);
                        expect(bench.slow.count + bench.jira.count).toBe(0);

                        const end = bench.shown();

                        // Tout annuler, un geste après l'autre, chacun une fois le précédent arrivé.
                        let undone = 0;
                        for (; bench.snapshot().canUndo && undone < 60; undone += 1) {
                            bench.undo();
                            await bench.drain();
                            expectShownOnceSaved(bench);
                        }
                        expect(bench.shown()).toEqual(bench.slow.ranges());
                        expect(server.refused).toEqual([]);

                        // Personne d'autre n'a rien écrit, ni l'objectif ni l'envoi n'ont bougé :
                        // annuler n'a rien refusé, et tout annuler rend la journée de départ — rien
                        // d'écrit, aucune fois détachée.
                        if (calm) {
                            expect(undoRefusals).toEqual([]);
                            expect(bench.shown()).toEqual(start);
                            expect(saved(bench)).toEqual([]);
                            expect(seeds.filter((id) => server.isSkipped(id, DATE))).toEqual([]);

                            // Puis rétablir ce qui vient d'être annulé rend la journée d'avant les
                            // annulations : chaque geste se refait, aucun ne reste défait.
                            for (let redone = 0; redone < undone; redone += 1) {
                                expect(bench.snapshot().canRedo).toBe(true);
                                bench.undo(true);
                                await bench.drain();
                                expectShownOnceSaved(bench);
                            }
                            expect(undoRefusals).toEqual([]);
                            expect(bench.shown()).toEqual(end);
                            expect(bench.shown()).toEqual(bench.slow.ranges());
                        }
                    } finally {
                        unmountAll();
                    }
                }),
                { numRuns: RUNS },
            );
        },
        Math.max(30_000, RUNS * 50),
    );
});
