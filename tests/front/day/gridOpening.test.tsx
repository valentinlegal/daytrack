// @vitest-environment jsdom
import { act, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { SlotChange } from '../../../assets/grid/changes';
import { type Range, rangesOf } from '../grid/support';
import { type Bench, DATE, EVE, mountGrid, unmountAll } from './gridBench';

/**
 * Ce qu'on fait sur une journée pendant qu'elle s'ouvre, et une récurrence déplacée qu'on défait
 * à moitié : des gestes qui en croisent d'autres, sur le crochet des gestes, avec un serveur qui
 * tarde. Un geste fait pendant l'ouverture attend la journée, puis part, dans l'ordre ; rien ne
 * se perd sans se voir. Une récurrence coupée puis collée ailleurs ne revit jamais à ses deux
 * places : annuler ou rétablir l'une des deux moitiés à contretemps se refuse, et dit quoi faire.
 */

const REVUE: SlotChange = { start: '09:00', end: '10:00', kind: 'work', ticket: 'SHOP-482', comment: 'Revue' };
const DAILY: SlotChange = { start: '09:00', end: '09:30', kind: 'work', ticket: 'OPS-12', comment: 'Daily' };
const REVIEW: SlotChange = { start: '10:00', end: '10:30', kind: 'work', ticket: 'SHOP-519', comment: null };
const WEDNESDAY = '2026-10-07';
const THURSDAY = '2026-10-08';
const NINE = 540;
const TEN = 600;
const FIFTEEN = 900;

afterEach(() => {
    unmountAll();
});

/** Ce que dit le message de la grille. */
function said(bench: Bench): string | null {
    const content: ReactNode = bench.editing.message?.content ?? null;
    if (content === null || typeof content === 'string') {
        return content;
    }
    const { children } = (content as ReactElement<{ children: ReactNode[] }>).props;

    return children
        .map((child) =>
            typeof child === 'string' ? child : (child as ReactElement<{ children: string }>).props.children,
        )
        .join('');
}

/** Les écritures parties vers ce jour, dans l'ordre. */
function writes(bench: Bench, date: string): string[] {
    return bench.slow.requests
        .filter((request) => request.date === date && request.kind !== 'read')
        .map(({ kind }) => kind);
}

/** La revue du mardi, copiée d'un clic sur son quart d'heure de 09:15, puis le mercredi qui s'ouvre lentement. */
async function copiedThenOpening(): Promise<Bench> {
    const bench = mountGrid({ blocks: [REVUE] });
    bench.click(NINE + 15);
    bench.press('c', { ctrlKey: true });
    await bench.settle();
    expect(await bench.openSlowly(WEDNESDAY)).toBe(true);

    return bench;
}

describe('pendant que la journée s’ouvre', () => {
    it('on y sélectionne, et un collage attend qu’elle soit lue, puis se fait sur la plage', async () => {
        const bench = await copiedThenOpening();

        bench.drag(FIFTEEN + 30, FIFTEEN);
        expect(bench.editing.selection.quarters).toEqual([FIFTEEN, FIFTEEN + 15, FIFTEEN + 30]);
        expect(bench.press('v', { ctrlKey: true })).toBe(true);
        await bench.settle();
        expect(writes(bench, WEDNESDAY)).toEqual([]);

        await bench.arrive();
        expect(bench.shown()).toEqual([['15:00', '15:45', 'work', 'SHOP-482', 'Revue']]);
        expect(rangesOf(bench.slow.server.read(WEDNESDAY).grid)).toEqual(bench.shown());
        expect(bench.editing.selection.quarters).toEqual([FIFTEEN, FIFTEEN + 15, FIFTEEN + 30]);
        expect(said(bench)).toBeNull();
        expect(rangesOf(bench.slow.server.read(DATE).grid)).toEqual([['09:00', '10:00', 'work', 'SHOP-482', 'Revue']]);
    });

    it('les gestes partent dans l’ordre où on les a faits : coller puis annuler laisse la journée vide, rétablissable', async () => {
        const bench = await copiedThenOpening();
        bench.drag(FIFTEEN, FIFTEEN + 15);
        bench.press('v', { ctrlKey: true });
        bench.undo();

        await bench.arrive();
        await bench.drain();
        expect(writes(bench, WEDNESDAY)).toEqual(['changeSlots', 'changeSlots']);
        expect(bench.shown()).toEqual([]);
        expect(bench.snapshot().canRedo).toBe(true);

        bench.undo(true);
        await bench.drain();
        expect(bench.shown()).toEqual([['15:00', '15:30', 'work', 'SHOP-482', 'Revue']]);
    });

    it('le clavier y déplace le curseur ; Entrée ouvre Nouveau ticket une fois la journée lue', async () => {
        const bench = await copiedThenOpening();
        bench.drag(TEN, TEN);
        bench.press('ArrowDown', { shiftKey: true });
        expect(bench.editing.selection.quarters).toEqual([TEN, TEN + 15]);
        expect(bench.press('Enter')).toBe(true);
        expect(bench.editing.window).toBeNull();

        await bench.arrive();
        expect(bench.editing.window?.target.kind).toBe('new');
        expect(bench.editing.selection.quarters).toEqual([TEN, TEN + 15]);
    });

    it('une lettre tapée y attend aussi : elle part dans le champ Ticket de Nouveau ticket', async () => {
        const bench = await copiedThenOpening();
        bench.drag(TEN, TEN);
        expect(bench.press('S')).toBe(true);

        await bench.arrive();
        expect(bench.editing.window?.draft.ticket).toBe('S');
    });

    it('un ticket tapé en entier y attend aussi, tiret compris, et s’écrit d’un seul tenant', async () => {
        const bench = await copiedThenOpening();
        bench.drag(TEN, TEN);
        for (const key of 'shop-519') {
            expect(bench.press(key)).toBe(true);
        }

        await bench.arrive();
        expect(bench.editing.window?.draft.ticket).toBe('SHOP-519');
    });

    it('un double-clic y ouvre la fenêtre du créneau une fois la journée lue', async () => {
        const bench = await copiedThenOpening();
        bench.doubleClick(TEN);
        expect(bench.editing.window).toBeNull();

        await bench.arrive();
        expect(bench.editing.window?.target.kind).toBe('new');
    });

    it('un autre jour demandé entre-temps : ce qu’on y avait fait ne part pas, ni là, ni ailleurs', async () => {
        const bench = await copiedThenOpening();
        bench.drag(FIFTEEN, FIFTEEN + 15);
        bench.press('v', { ctrlKey: true });
        expect(await bench.openSlowly(THURSDAY)).toBe(true);

        await bench.arrive();
        await bench.drain();
        expect(bench.session.date).toBe(THURSDAY);
        expect(bench.shown()).toEqual([]);
        expect(bench.editing.selection.quarters).toEqual([]);
        expect(writes(bench, WEDNESDAY)).toEqual([]);
        expect(writes(bench, THURSDAY)).toEqual([]);
    });

    it('Retour arrière y efface la dernière lettre du ticket qui attend, pas la sélection', async () => {
        const bench = mountGrid({ blocks: [REVUE] });
        expect(await bench.openSlowly(DATE)).toBe(true);
        bench.drag(NINE, NINE);
        for (const key of 'shop-5190') {
            expect(bench.press(key)).toBe(true);
        }
        expect(bench.press('Backspace')).toBe(true);

        await bench.arrive();
        await bench.drain();
        expect(bench.editing.window?.draft.ticket).toBe('SHOP-519');
        expect(bench.shown()).toEqual([['09:00', '10:00', 'work', 'SHOP-482', 'Revue']]);
        expect(writes(bench, DATE)).toEqual([]);
    });

    it('Suppr et les flèches après un ticket tapé n’agissent pas derrière la fenêtre qui s’ouvrira avec lui', async () => {
        const bench = mountGrid({ blocks: [REVUE] });
        expect(await bench.openSlowly(DATE)).toBe(true);
        bench.drag(NINE, NINE);
        for (const key of 'shop 1') {
            bench.press(key);
        }
        expect(bench.press('Delete')).toBe(true);
        expect(bench.press('ArrowDown')).toBe(true);
        expect(bench.press('Backspace')).toBe(true);
        expect(bench.press('7')).toBe(true);
        expect(bench.editing.selection.quarters).toEqual([NINE]);

        await bench.arrive();
        await bench.drain();
        // L'espace ne compte pas : le ticket s'écrit comme dans le champ, et Retour arrière ôte le 1.
        expect(bench.editing.window?.draft.ticket).toBe('SHOP7');
        expect(bench.editing.window?.target).toEqual({ kind: 'new', quarters: [NINE] });
        expect(bench.shown()).toEqual([['09:00', '10:00', 'work', 'SHOP-482', 'Revue']]);
        expect(writes(bench, DATE)).toEqual([]);
    });

    it('Entrée après un ticket tapé n’ouvre pas une seconde fenêtre : celle du ticket s’ouvre avec lui', async () => {
        const bench = await copiedThenOpening();
        bench.drag(TEN, TEN);
        for (const key of 'shop-519') {
            expect(bench.press(key)).toBe(true);
        }
        expect(bench.press('Enter')).toBe(true);

        await bench.arrive();
        await bench.drain();
        expect(bench.editing.window?.draft.ticket).toBe('SHOP-519');
        expect(bench.editing.window?.target).toEqual({ kind: 'new', quarters: [TEN] });
        expect(writes(bench, WEDNESDAY)).toEqual([]);

        // Entrée, une fois la fenêtre ouverte, l'enregistre.
        bench.enter();
        await bench.drain();
        expect(bench.editing.window).toBeNull();
        expect(bench.shown()).toEqual([['10:00', '10:15', 'work', 'SHOP-519', null]]);
    });

    it('F2 et Maj+F10 après un ticket tapé ne font rien : la fenêtre s’ouvre avec lui, seule', async () => {
        const bench = await copiedThenOpening();
        bench.drag(TEN, TEN);
        for (const key of 'shop-519') {
            bench.press(key);
        }
        bench.press('F2');
        bench.press('F10', { shiftKey: true });
        bench.press('ContextMenu');

        await bench.arrive();
        await bench.drain();
        expect(bench.editing.window?.draft.ticket).toBe('SHOP-519');
        expect(bench.editing.window?.target).toEqual({ kind: 'new', quarters: [TEN] });
        expect(bench.windows.filter((shown) => shown !== '-')).toEqual(['new']);
        expect(bench.menus).toEqual([]);
        expect(writes(bench, WEDNESDAY)).toEqual([]);
    });

    it('Échap renonce au ticket tapé et garde la sélection : un collage fait ensuite ailleurs part seul', async () => {
        const bench = await copiedThenOpening();
        bench.drag(FIFTEEN, FIFTEEN + 15);
        for (const key of 'shop-519') {
            bench.press(key);
        }
        expect(bench.press('Escape')).toBe(true);
        expect(bench.editing.selection.quarters).toEqual([FIFTEEN, FIFTEEN + 15]);
        bench.drag(TEN, TEN);
        bench.press('v', { ctrlKey: true });

        await bench.arrive();
        await bench.drain();
        expect(bench.editing.window).toBeNull();
        expect(bench.windows.filter((shown) => shown !== '-')).toEqual([]);
        expect(bench.shown()).toEqual([['10:00', '10:15', 'work', 'SHOP-482', 'Revue']]);
        expect(rangesOf(bench.slow.server.read(WEDNESDAY).grid)).toEqual(bench.shown());
    });

    it('un raccourci après un ticket tapé ne fait rien derrière lui : ni collage, ni coupe, ni annulation', async () => {
        const bench = mountGrid({ blocks: [REVUE] });
        bench.select([NINE]);
        bench.press('c', { ctrlKey: true });
        bench.press('Delete');
        await bench.drain();
        const revue: Range = ['09:15', '10:00', 'work', 'SHOP-482', 'Revue'];
        expect(bench.shown()).toEqual([revue]);
        expect(await bench.switchDay(WEDNESDAY)).toBe(true);
        expect(await bench.openSlowly(DATE)).toBe(true);

        bench.drag(TEN, TEN);
        for (const key of 'shop-519') {
            bench.press(key);
        }
        bench.press('v', { ctrlKey: true });
        bench.press('x', { ctrlKey: true });
        bench.press('Delete', { ctrlKey: true });
        bench.undo();
        bench.undo(true);
        bench.press('y', { ctrlKey: true });

        await bench.arrive();
        await bench.drain();
        expect(bench.editing.window?.draft.ticket).toBe('SHOP-519');
        expect(bench.editing.window?.target).toEqual({ kind: 'new', quarters: [TEN] });
        expect(bench.shown()).toEqual([revue]);
        expect(writes(bench, DATE)).toEqual(['changeSlots']);
        expect(bench.snapshot().canUndo).toBe(true);
    });

    it('une lecture qui échoue y renonce : revenir sur le jour ne rejoue rien', async () => {
        const bench = await copiedThenOpening();
        bench.drag(FIFTEEN, FIFTEEN + 15);
        bench.press('v', { ctrlKey: true });
        await bench.arrive(true);
        expect(bench.editing.selection.quarters).toEqual([]);

        expect(await bench.openSlowly(WEDNESDAY)).toBe(true);
        await bench.arrive();
        await bench.drain();
        expect(bench.shown()).toEqual([]);
        expect(writes(bench, WEDNESDAY)).toEqual([]);
    });
});

/**
 * Un jour vidé, mis à 0h00 puis quitté, est fermé au retour : Ctrl/⌘+Z et Ctrl/⌘+Maj+Z n'y font
 * rien, tapés pendant qu'il s'ouvre ou une fois lu. L'effacement reste à annuler une fois le jour
 * rouvert. (Fermé sous le curseur pendant qu'on y est, il les garde : gridAhead.test.tsx.)
 */
describe('un jour refermé', () => {
    const HOUR: SlotChange = { start: '14:00', end: '15:00', kind: 'work', ticket: 'SHOP-519', comment: null };
    const hour: Range = ['14:00', '15:00', 'work', 'SHOP-519', null];

    /**
     * Le mardi vidé de son heure, mis à 0h00, puis quitté pour le mercredi. L'écran l'aurait
     * gardé ouvert tant qu'on y était (staysOpen) ; ici, il se ferme sur place, ce qui ne change
     * rien au retour.
     */
    async function emptiedClosedLeft(): Promise<Bench> {
        const bench = mountGrid({ blocks: [HOUR], closes: true });
        bench.select([FIFTEEN - 60, FIFTEEN - 15]);
        bench.press('Delete');
        await bench.drain();
        await act(async () => {
            await bench.session.setObjective(0);
        });
        expect(await bench.switchDay(WEDNESDAY)).toBe(true);

        return bench;
    }

    /** Rien n'a bougé : le jour est vide et fermé, à l'écran comme dans la base. */
    function expectStillClosed(bench: Bench): void {
        expect(bench.shown()).toEqual([]);
        expect(rangesOf(bench.slow.server.read(DATE).grid)).toEqual([]);
        expect(bench.editing.closed).toBe(true);
        expect(writes(bench, DATE)).toEqual(['changeSlots', 'setObjective']);
    }

    it('Ctrl/⌘+Z tapé pendant qu’il s’ouvre n’y fait rien, comme une fois lu', async () => {
        const bench = await emptiedClosedLeft();
        expect(await bench.openSlowly(DATE)).toBe(true);
        bench.undo();
        bench.undo(true);

        await bench.arrive();
        await bench.drain();
        expectStillClosed(bench);

        bench.undo();
        await bench.drain();
        bench.undo(true);
        await bench.drain();
        expectStillClosed(bench);
        expect(said(bench)).toBeNull();
    });

    it('rouvert, Ctrl/⌘+Z y rend la saisie effacée : elle restait à annuler', async () => {
        const bench = await emptiedClosedLeft();
        expect(await bench.openSlowly(DATE)).toBe(true);
        bench.undo();
        await bench.arrive();
        await bench.drain();
        expectStillClosed(bench);

        await act(async () => {
            await bench.session.setObjective(bench.snapshot().day.habitualObjective);
        });
        expect(bench.editing.closed).toBe(false);
        bench.undo();
        await bench.drain();
        expect(bench.shown()).toEqual([hour]);
        expect(rangesOf(bench.slow.server.read(DATE).grid)).toEqual([hour]);
    });
});

describe('un geste dont la réponse arrive sur un autre jour', () => {
    it('dit son refus en bas de la journée affichée, le jour du geste devant, sans rien y changer', async () => {
        const bench = mountGrid({ blocks: [REVUE] });
        // Un autre onglet a changé le mardi : l'effacement qui part sera refusé.
        bench.elsewhere(REVIEW);
        bench.slow.hold();
        bench.select([NINE]);
        bench.press('Delete');
        await bench.settle();
        expect(await bench.switchDay(WEDNESDAY)).toBe(true);

        bench.slow.release();
        await bench.drain();
        expect(said(bench)).toBe("Mardi 6 octobre\u{a0}: la journée a changé entre-temps. Rien n'a été modifié.");
        expect(bench.editing.message?.action).toBeUndefined();
        expect(bench.session.date).toBe(WEDNESDAY);
        expect(bench.shown()).toEqual([]);
        expect(writes(bench, WEDNESDAY)).toEqual([]);
    });

    it('garde le refus revenu pendant que l’autre jour s’ouvre, quand il arrive', async () => {
        const bench = mountGrid({ blocks: [REVUE] });
        bench.elsewhere(REVIEW);
        bench.slow.hold();
        bench.select([NINE]);
        bench.press('Delete');
        await bench.settle();
        expect(await bench.openSlowly(WEDNESDAY)).toBe(true);

        bench.slow.release();
        await bench.drain();
        const refusal = "Mardi 6 octobre\u{a0}: la journée a changé entre-temps. Rien n'a été modifié.";
        expect(said(bench)).toBe(refusal);
        await bench.arrive();
        expect(bench.session.date).toBe(WEDNESDAY);
        expect(said(bench)).toBe(refusal);
    });

    it('revenu pendant que son propre jour se rouvre, le dit comme sur lui, sans le jour, et le garde', async () => {
        const bench = mountGrid({ blocks: [REVUE] });
        bench.elsewhere(REVIEW);
        bench.slow.hold();
        bench.select([NINE]);
        bench.press('Delete');
        await bench.settle();
        expect(await bench.openSlowly(DATE)).toBe(true);

        bench.slow.release();
        await bench.drain();
        const refusal = "La journée a changé entre-temps. Rien n'a été modifié.";
        expect(said(bench)).toBe(refusal);
        await bench.arrive();
        expect(said(bench)).toBe(refusal);
        expect(bench.shown()).toEqual([
            ['09:00', '10:00', 'work', 'SHOP-482', 'Revue'],
            ['10:00', '10:30', 'work', 'SHOP-519', null],
        ]);
    });

    it('ne dit plus ce qu’il a fait quand il est passé', async () => {
        const bench = mountGrid({ blocks: [REVUE] });
        bench.slow.hold();
        bench.select([NINE]);
        bench.press('Delete');
        await bench.settle();
        expect(await bench.switchDay(WEDNESDAY)).toBe(true);

        bench.slow.release();
        await bench.drain();
        expect(said(bench)).toBeNull();
        expect(rangesOf(bench.slow.server.read(DATE).grid)).toEqual([['09:15', '10:00', 'work', 'SHOP-482', 'Revue']]);
    });
});

/**
 * Le Daily, chaque jour ouvré : coupé avec les suivantes le mardi, puis collé le mercredi à
 * 10:00 — ses jours restent, ses heures changent. La grille montre le mercredi.
 */
async function movedDaily(recurrences: readonly SlotChange[] = [DAILY]): Promise<{ bench: Bench; daily: string }> {
    const bench = mountGrid({ recurrences, top: NINE });
    const daily = bench.slow.server.allRecurrences().find((recurrence) => recurrence.start === '09:00')?.id ?? '';
    bench.select([NINE, NINE + 15]);
    bench.press('x', { ctrlKey: true });
    await bench.drain();
    bench.chooseScope('following');
    bench.enter();
    await bench.drain();
    expect(bench.slow.server.recurrence(daily)?.until).toBe(EVE);
    expect(await bench.switchDay(WEDNESDAY)).toBe(true);

    return { bench, daily };
}

/** Les récurrences qui posent un bloc ce jour-là. */
function seriesOn(bench: Bench, date: string): string[] {
    return rangesOf(bench.slow.server.read(date).grid).flatMap((range) => (range[5] === undefined ? [] : [range[5]]));
}

describe('une récurrence déplacée, défaite à moitié', () => {
    it('rétablir le collage après avoir annulé la coupe se refuse, et dit de rétablir la coupe d’abord', async () => {
        const { bench, daily } = await movedDaily();
        bench.click(TEN);
        bench.press('v', { ctrlKey: true });
        await bench.drain();
        const moved = bench.shown()[0]?.[5];
        expect(moved).toBeDefined();
        bench.undo();
        await bench.drain();
        expect(await bench.switchDay(DATE)).toBe(true);
        bench.undo();
        await bench.drain();
        expect(bench.slow.server.recurrence(daily)?.until).toBeNull();
        expect(await bench.switchDay(WEDNESDAY)).toBe(true);

        bench.undo(true);
        await bench.drain();
        expect(said(bench)).toBe("Rétablissez d'abord la coupe du mardi 6 octobre.");
        // Le Daily, revenu à sa place, s'y prévoit à 09:00 ; rien à 10:00.
        expect(bench.shown()).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', daily]]);
        expect(seriesOn(bench, THURSDAY)).toEqual([daily]);
        expect(bench.snapshot().canRedo).toBe(true);

        // La coupe rétablie sur son jour, le collage se rétablit.
        expect(await bench.switchDay(DATE)).toBe(true);
        bench.undo(true);
        await bench.drain();
        expect(await bench.switchDay(WEDNESDAY)).toBe(true);
        bench.undo(true);
        await bench.drain();
        expect(said(bench)).toBeNull();
        expect(seriesOn(bench, THURSDAY)).toEqual([moved]);
    });

    it('annuler la coupe pendant que son collage est encore là se refuse, et dit d’annuler le collage d’abord', async () => {
        const { bench, daily } = await movedDaily();
        bench.click(TEN);
        bench.press('v', { ctrlKey: true });
        await bench.drain();
        const moved = bench.shown()[0]?.[5];
        expect(await bench.switchDay(DATE)).toBe(true);

        bench.undo();
        await bench.drain();
        expect(said(bench)).toBe("Annulez d'abord le collage du mercredi 7 octobre.");
        expect(bench.shown()).toEqual([]);
        expect(bench.slow.server.recurrence(daily)?.until).toBe(EVE);
        expect(seriesOn(bench, THURSDAY)).toEqual([moved]);
        expect(bench.snapshot().canUndo).toBe(true);
    });

    it('annuler la coupe pendant qu’un collage refusé attend sa réponse : il ne la rend pas, et le collage suivant pose le bloc seul', async () => {
        const { bench, daily } = await movedDaily([DAILY, REVIEW]);
        // Collé à 10:00, sur la revue qui revient chaque jour : refusé, mais la réponse tarde.
        bench.slow.hold();
        bench.click(TEN);
        bench.press('v', { ctrlKey: true });
        await bench.settle();
        expect(await bench.switchDay(DATE)).toBe(true);
        bench.undo();
        await bench.settle();

        await bench.drain();
        expect(bench.slow.server.recurrence(daily)?.until).toBeNull();
        expect(bench.memory.clipboard.read()?.recurrence).toBeUndefined();

        expect(await bench.switchDay(THURSDAY)).toBe(true);
        bench.click(FIFTEEN);
        bench.press('v', { ctrlKey: true });
        await bench.drain();
        expect(bench.shown()).toEqual([
            ['09:00', '09:30', 'work', 'OPS-12', 'Daily', daily],
            ['10:00', '10:30', 'work', 'SHOP-519', null, expect.any(String)],
            ['15:00', '15:30', 'work', 'OPS-12', 'Daily'],
        ]);
        expect(seriesOn(bench, '2026-10-09')).toEqual([daily, expect.any(String)]);
        expect(bench.slow.server.allRecurrences()).toHaveLength(2);
    });
});
