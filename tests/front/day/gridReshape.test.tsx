// @vitest-environment jsdom
import { act, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { SlotChange } from '../../../assets/grid/changes';
import { FakeDayServer } from '../grid/fakeDayServer';
import { type Range, rangesOf, weeklyRule } from '../grid/support';
import { type Bench, DATE, EVE, mountGrid, mountScreen, seedRecurrences, SlowServer, unmountAll } from './gridBench';

/**
 * Couper, allonger et raccourcir un bloc qui revient, sur la vraie grille et la vraie fenêtre :
 * Ctrl+X ou Couper du menu sur une fois entière, Ctrl+V ou Coller du menu au bord d'un bloc qui
 * revient, du même contenu, un favori déposé à son bord, Nouveau ticket à son bord à son rythme,
 * Suppr ou Effacer du menu sur son haut ou son bas posent la question ; Annuler ou Échap y
 * renoncent, Retour rend les champs de la fenêtre. Chaque réponse, annuler et rétablir ; jamais
 * sur un jour passé ; un refus se dit en bas de la grille. Puis les gestes qui se croisent : un
 * changement de jour, un serveur lent, une réponse répétée, un onglet en retard, les bornes de la
 * journée.
 */

/** Le Daily, de\u00a009:00\u00a0à\u00a009:30, né la veille, chaque jour ouvré. */
const DAILY: SlotChange = { start: '09:00', end: '09:30', kind: 'work', ticket: 'OPS-12', comment: 'Daily' };
/** La revue, de\u00a010:00\u00a0à\u00a010:30, sans commentaire : un favori de son ticket l'allonge. */
const REVIEW: SlotChange = { start: '10:00', end: '10:30', kind: 'work', ticket: 'SHOP-519', comment: null };
/** Une heure saisie à la main, l'après-midi. */
const HOUR: SlotChange = { start: '14:00', end: '15:00', kind: 'work', ticket: 'SHOP-482', comment: 'Mapping' };
const HOUR_RANGE: Range = ['14:00', '15:00', 'work', 'SHOP-482', 'Mapping'];
const NINE = 540;
const WEDNESDAY = '2026-10-07';
const THURSDAY = '2026-10-08';
const CUT_NOTE = 'Les fois suivantes se déplacent là où vous collez. Les fois passées ne changent jamais.';
const STALE = "La journée a changé entre-temps. Rien n'a été modifié.";

/** Aujourd'hui, où la fois est posée ; la veille, qui rend la journée du banc à venir, où elle n'est que prévue. */
const DAYS = [
    { name: 'aujourd’hui', today: DATE },
    { name: 'un jour à venir', today: EVE },
] as const;

afterEach(() => {
    unmountAll();
});

function dialog(): HTMLElement {
    const shown = document.querySelector<HTMLElement>('[role="dialog"]');
    if (shown === null) {
        throw new Error("Aucune fenêtre n'est ouverte.");
    }

    return shown;
}

/** Le titre, le sous-titre, les choix et les boutons de la question, comme le lecteur d'écran les lit. */
function questionShown(): {
    title: string;
    subtitle: string;
    group: string;
    choices: string[];
    checked: string;
    buttons: string[];
} {
    const group = dialog().querySelector('[role="radiogroup"]');
    if (group === null) {
        throw new Error('La fenêtre ne pose pas la question.');
    }
    const radios = [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    const described = dialog().getAttribute('aria-describedby');

    return {
        title: dialog().querySelector('h2')?.textContent ?? '',
        subtitle: described === null ? '' : (document.getElementById(described)?.textContent ?? ''),
        group: group.getAttribute('aria-label') ?? '',
        choices: radios.map((radio) => radio.closest('label')?.textContent ?? ''),
        checked: radios.find((radio) => radio.checked)?.closest('label')?.textContent ?? '',
        buttons: [...dialog().querySelectorAll('button')]
            .filter((button) => button.closest('.hidden') === null)
            .map((button) => button.textContent.trim())
            .filter((text) => text !== ''),
    };
}

function radio(choice: 'once' | 'following'): HTMLInputElement {
    const found = dialog().querySelector<HTMLInputElement>(`input[type="radio"][value="${choice}"]`);
    if (found === null) {
        throw new Error(`La question n'a pas le choix ${choice}.`);
    }

    return found;
}

function press(element: HTMLElement): void {
    act(() => {
        element.click();
    });
}

/** Un bouton du pied de la fenêtre, par son libellé. */
function footerButton(label: string): HTMLButtonElement {
    const found = [...dialog().querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.closest('.hidden') === null && button.textContent.trim() === label,
    );
    if (found === undefined) {
        throw new Error(`La fenêtre n'a pas de bouton « ${label} ».`);
    }

    return found;
}

function checkbox(): HTMLInputElement {
    const box = dialog().querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (box === null) {
        throw new Error("La fenêtre n'a pas de case « Récurrence ».");
    }

    return box;
}

/** Les flèches de la grille, par ce que lit le lecteur d'écran. */
function arrows(): string[] {
    return [...document.querySelectorAll('svg[role="img"]')].map((svg) => svg.getAttribute('aria-label') ?? '');
}

/** Ce que dit le message de la grille : le ticket qu'il nomme, puis ce qui s'est passé. */
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

/** Les écritures de la journée du banc, dans l'ordre. */
function writes(bench: Bench): string[] {
    return bench.slow.server.writes.filter((request) => request.date === DATE).map((request) => request.kind);
}

/** Les récurrences du banc, dans l'ordre où elles sont nées. */
function ids(bench: Bench): string[] {
    return bench.slow.server.allRecurrences().map((recurrence) => recurrence.id);
}

/** La récurrence née en route, la dernière. */
function born(bench: Bench, seeds: readonly string[]): string | undefined {
    return ids(bench).find((id) => !seeds.includes(id));
}

function rangesOn(bench: Bench, date: string): Range[] {
    return rangesOf(bench.slow.server.read(date).grid);
}

/** Retirée : elle finit avant son premier jour, et ne tombe jamais. */
function withdrawn(bench: Bench, id: string): boolean {
    const record = bench.slow.server.recurrence(id);

    return record !== undefined && record.until !== null && record.until < record.firstDay;
}

/** Le menu ouvert d'un clic droit sur ce quart d'heure, et ce choix cliqué. */
async function menu(bench: Bench, quarter: number, label: string): Promise<void> {
    bench.rightClick(quarter);
    await bench.settle();
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((candidate) =>
        candidate.textContent.includes(label),
    );
    if (item === undefined) {
        throw new Error(`Le menu n'a pas de choix « ${label} ».`);
    }
    act(() => {
        item.click();
    });
    await bench.drain();
}

/** Copie le premier quart d'heure du Daily, puis le colle sur ce quart d'heure : au-dessous, la question « Allonger ». */
async function pasteBelow(bench: Bench, quarter = NINE + 30): Promise<void> {
    bench.click(NINE);
    bench.press('c', { ctrlKey: true });
    await bench.drain();
    bench.click(quarter);
    bench.press('v', { ctrlKey: true });
    await bench.drain();
}

/** Nouveau ticket au-dessous du Daily : le même ticket, le même commentaire, sa case cochée à son rythme, et Entrée. */
async function windowBelow(bench: Bench): Promise<void> {
    bench.doubleClick(NINE + 30);
    await bench.drain();
    bench.type('OPS-12', 'Daily');
    press(checkbox());
    bench.adjustRecurrence({ on: true, pace: 'week', weekdays: [1, 2, 3, 4, 5], until: '' });
    bench.enter();
    await bench.drain();
}

describe('les questions, sur la vraie fenêtre', () => {
    it('Ctrl+X sur une fois entière : « Couper une récurrence », sa phrase ; Annuler et Échap ne coupent rien', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        const before = writes(bench);
        bench.select([540, 555]);
        bench.press('x', { ctrlKey: true });
        await bench.drain();

        expect(questionShown()).toEqual({
            title: 'Couper une récurrence',
            subtitle: 'Daily, mardi 6 octobre',
            group: 'Quelles fois couper',
            choices: ['Cette fois seulement', 'Cette fois et les suivantes'],
            checked: 'Cette fois seulement',
            buttons: ['Annuler', 'Couper'],
        });
        expect(dialog().textContent).toContain(CUT_NOTE);
        expect(document.activeElement).toBe(radio('once'));

        press(footerButton('Annuler'));
        await bench.drain();
        expect(bench.editing.window).toBeNull();
        bench.select([540, 555]);
        bench.press('x', { ctrlKey: true });
        await bench.drain();
        bench.escape();
        await bench.drain();
        expect(bench.editing.window).toBeNull();
        expect(writes(bench)).toEqual(before);
        expect(bench.session.clipboard()).toBeNull();
        expect(bench.shown()).toEqual(bench.slow.ranges());
        expect(arrows()).toHaveLength(1);
    });

    it('Couper du menu : la question garde le curseur, et la souris y répond', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        const [daily = ''] = ids(bench);
        bench.select([540, 555]);
        await menu(bench, 555, 'Couper');

        expect(bench.question()).toMatchObject({ action: { question: 'cut' }, back: false });
        expect(document.activeElement).toBe(radio('once'));
        press(radio('following'));
        press(footerButton('Couper'));
        await bench.drain();

        expect(bench.editing.window).toBeNull();
        expect(bench.shown()).toEqual([]);
        expect(said(bench)).toBe('OPS-12 coupé');
        expect(bench.slow.server.recurrence(daily)?.until).toBe(EVE);
    });

    it('Suppr sur le bas : « Raccourcir une récurrence », et ses heures après le geste', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        bench.click(555);
        bench.press('Delete');
        await bench.drain();

        expect(questionShown()).toEqual({
            title: 'Raccourcir une récurrence',
            subtitle: 'Daily, mardi 6 octobre, de\u00a009:00\u00a0à\u00a009:15',
            group: 'Quelles fois raccourcir',
            choices: ['Cette fois seulement', 'Cette fois et les suivantes'],
            checked: 'Cette fois seulement',
            buttons: ['Annuler', 'Raccourcir'],
        });
        expect(dialog().textContent).toContain('Les fois passées ne changent jamais.');
        expect(dialog().textContent).not.toContain(CUT_NOTE);
        expect(document.activeElement).toBe(radio('once'));
    });

    it('Effacer du menu sur le haut : la même question', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        const before = writes(bench);
        bench.click(540);
        await menu(bench, 540, 'Effacer');

        expect(bench.question()).toMatchObject({ action: { question: 'shorten' }, back: false });
        expect(questionShown().subtitle).toBe('Daily, mardi 6 octobre, de\u00a009:15\u00a0à\u00a009:30');
        expect(writes(bench)).toEqual(before);
    });

    it('Ctrl+V au bord, ou Coller du menu : « Allonger une récurrence », ses heures après le geste', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        const before = writes(bench);
        await pasteBelow(bench);

        expect(questionShown()).toEqual({
            title: 'Allonger une récurrence',
            subtitle: 'Daily, mardi 6 octobre, de\u00a009:00\u00a0à\u00a009:45',
            group: 'Quelles fois allonger',
            choices: ['Cette fois seulement', 'Cette fois et les suivantes'],
            checked: 'Cette fois seulement',
            buttons: ['Annuler', 'Allonger'],
        });
        expect(document.activeElement).toBe(radio('once'));
        bench.escape();
        await bench.drain();
        expect(bench.editing.window).toBeNull();

        // Au-dessus, sur deux quarts d'heure, par le menu.
        bench.select([510, 525]);
        await menu(bench, 525, 'Coller');
        expect(questionShown().subtitle).toBe('Daily, mardi 6 octobre, de\u00a008:30\u00a0à\u00a009:30');
        expect(document.activeElement).toBe(radio('once'));
        bench.back();
        await bench.drain();
        expect(bench.editing.window).toBeNull();
        expect(writes(bench)).toEqual(before);
    });

    it('un favori glissé au bord d’un bloc qui revient de son ticket : la même question', async () => {
        const bench = mountScreen({ recurrences: [REVIEW], top: 540, favorites: ['SHOP-519'] });
        await bench.settle();
        const before = writes(bench);
        bench.holdFavorite('SHOP-519');
        bench.moveTo(630);
        await bench.settle();
        bench.release(630);
        await bench.drain();

        expect(questionShown()).toMatchObject({
            title: 'Allonger une récurrence',
            subtitle: 'SHOP-519, mardi 6 octobre, de\u00a010:00\u00a0à\u00a010:45',
            buttons: ['Annuler', 'Allonger'],
        });
        bench.back();
        await bench.drain();
        expect(writes(bench)).toEqual(before);
    });

    it('Nouveau ticket au bord, à son rythme : la question prend la place des champs, que Retour rend', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        const before = writes(bench);
        await windowBelow(bench);

        expect(bench.question()).toMatchObject({ action: { question: 'extend' }, back: true });
        expect(questionShown()).toMatchObject({
            title: 'Allonger une récurrence',
            subtitle: 'Daily, mardi 6 octobre, de\u00a009:00\u00a0à\u00a009:45',
            buttons: ['Retour', 'Allonger'],
        });
        expect(document.activeElement).toBe(radio('once'));

        bench.back();
        await bench.drain();
        expect(bench.question()).toBeUndefined();
        expect(bench.editing.window?.draft).toEqual({ ticket: 'OPS-12', comment: 'Daily' });
        expect(checkbox().checked).toBe(true);
        expect(writes(bench)).toEqual(before);

        // Un autre jour de la semaine : une récurrence à part, sans question.
        bench.adjustRecurrence({ weekdays: [2, 4] });
        bench.enter();
        await bench.drain();
        expect(bench.editing.window).toBeNull();
        expect(writes(bench).at(-1)).toBe('saveRecurrence');
        expect(arrows()).toHaveLength(2);
    });
});

describe.each(DAYS)('les réponses, $name', ({ today }) => {
    it.each(['once', 'following'] as const)(
        'couper (%s) : « OPS-12 coupé » ; coller fait repartir la récurrence avec les suivantes, une seule fois',
        async (choice) => {
            const bench = mountScreen({ recurrences: [DAILY], top: 540, today });
            const seeds = ids(bench);
            const [daily = ''] = seeds;
            bench.select([540, 555]);
            bench.press('x', { ctrlKey: true });
            await bench.drain();
            if (choice === 'following') {
                bench.chooseScope('following');
            }
            bench.enter();
            await bench.drain();

            expect(bench.shown()).toEqual([]);
            expect(said(bench)).toBe('OPS-12 coupé');
            expect(bench.slow.server.recurrence(daily)?.until).toBe(choice === 'once' ? null : EVE);
            expect(bench.session.clipboard()?.recurrence === undefined).toBe(choice === 'once');

            // Collé à 15:00, sans rien demander.
            bench.click(900);
            bench.press('v', { ctrlKey: true });
            await bench.drain();
            expect(bench.editing.window).toBeNull();
            const moved = born(bench, seeds);
            expect(moved === undefined).toBe(choice === 'once');
            expect(bench.shown()).toEqual([
                choice === 'once'
                    ? ['15:00', '15:30', 'work', 'OPS-12', 'Daily']
                    : ['15:00', '15:30', 'work', 'OPS-12', 'Daily', moved],
            ]);
            expect(bench.shown()).toEqual(bench.slow.ranges());
            expect(bench.session.clipboard()?.recurrence).toBeUndefined();
            // Le collage suivant colle le bloc seul.
            bench.click(960);
            bench.press('v', { ctrlKey: true });
            await bench.drain();
            expect(bench.shown().at(-1)).toEqual(['16:00', '16:30', 'work', 'OPS-12', 'Daily']);
            expect(ids(bench)).toHaveLength(seeds.length + (choice === 'once' ? 0 : 1));

            // Annuler les deux collages retire la récurrence collée ; annuler la coupe rend le Daily.
            for (let step = 0; step < 3; step += 1) {
                bench.undo();
                await bench.drain();
                expect(bench.shown()).toEqual(bench.slow.ranges());
            }
            expect(bench.shown()).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', daily]]);
            expect(bench.slow.server.recurrence(daily)?.until).toBeNull();
            if (moved !== undefined) {
                expect(withdrawn(bench, moved)).toBe(true);
            }
            for (let step = 0; step < 3; step += 1) {
                bench.undo(true);
                await bench.drain();
            }
            expect(bench.shown()).toEqual([
                choice === 'once'
                    ? ['15:00', '15:30', 'work', 'OPS-12', 'Daily']
                    : ['15:00', '15:30', 'work', 'OPS-12', 'Daily', moved],
                ['16:00', '16:30', 'work', 'OPS-12', 'Daily'],
            ]);
            expect(bench.shown()).toEqual(bench.slow.ranges());
        },
    );

    it.each(['once', 'following'] as const)(
        'raccourcir (%s) : « OPS-12 effacé », la récurrence garde ses nouvelles heures avec les suivantes ; Ctrl+Z la rend',
        async (choice) => {
            const bench = mountScreen({ recurrences: [DAILY], top: 540, today });
            const seeds = ids(bench);
            const [daily = ''] = seeds;
            bench.click(555);
            bench.press('Delete');
            await bench.drain();
            if (choice === 'following') {
                bench.chooseScope('following');
            }
            bench.confirm();
            await bench.drain();

            const shorter = born(bench, seeds);
            expect(bench.shown()).toEqual([
                choice === 'once'
                    ? ['09:00', '09:15', 'work', 'OPS-12', 'Daily']
                    : ['09:00', '09:15', 'work', 'OPS-12', 'Daily', shorter],
            ]);
            expect(said(bench)).toBe('OPS-12 effacé');
            expect(arrows()).toHaveLength(choice === 'once' ? 0 : 1);
            expect(bench.slow.server.recurrence(daily)?.until).toBe(choice === 'once' ? null : EVE);
            // La sélection reste sur ce qu'on a effacé.
            expect(bench.editing.selection.quarters).toEqual([555]);
            expect(rangesOn(bench, WEDNESDAY)).toEqual([
                choice === 'once'
                    ? ['09:00', '09:30', 'work', 'OPS-12', 'Daily', daily]
                    : ['09:00', '09:15', 'work', 'OPS-12', 'Daily', shorter],
            ]);

            bench.undo();
            await bench.drain();
            expect(bench.shown()).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', daily]]);
            expect(bench.slow.server.recurrence(daily)?.until).toBeNull();
            bench.undo(true);
            await bench.drain();
            expect(bench.shown()[0]?.[1]).toBe('09:15');
            expect(bench.shown()).toEqual(bench.slow.ranges());
        },
    );

    it.each(['once', 'following'] as const)(
        'allonger en collant (%s) : un seul bloc, sans rien dire ; avec les suivantes, à ses nouvelles heures ; Ctrl+Z la rend',
        async (choice) => {
            const bench = mountScreen({ recurrences: [DAILY], top: 540, today });
            const seeds = ids(bench);
            const [daily = ''] = seeds;
            await pasteBelow(bench);
            if (choice === 'following') {
                bench.chooseScope('following');
            }
            bench.enter();
            await bench.drain();

            const longer = born(bench, seeds);
            expect(bench.shown()).toEqual([
                choice === 'once'
                    ? ['09:00', '09:45', 'work', 'OPS-12', 'Daily']
                    : ['09:00', '09:45', 'work', 'OPS-12', 'Daily', longer],
            ]);
            expect(bench.editing.message).toBeNull();
            expect(bench.slow.server.recurrence(daily)?.until).toBe(choice === 'once' ? null : EVE);
            expect(rangesOn(bench, WEDNESDAY)[0]?.[1]).toBe(choice === 'once' ? '09:30' : '09:45');

            bench.undo();
            await bench.drain();
            expect(bench.shown()).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', daily]]);
            if (longer !== undefined) {
                expect(withdrawn(bench, longer)).toBe(true);
            }
        },
    );

    it('allonger en collant par-dessus une saisie : seul ce qu’il remplace se dit', async () => {
        const bench = mountScreen({
            recurrences: [DAILY],
            blocks: [{ start: '09:30', end: '09:45', kind: 'work', ticket: 'SHOP-482', comment: null }],
            top: 540,
            today,
        });
        await pasteBelow(bench);
        expect(bench.question()?.action.question).toBe('extend');
        bench.enter();
        await bench.drain();

        expect(bench.shown()).toEqual([['09:00', '09:45', 'work', 'OPS-12', 'Daily']]);
        expect(said(bench)).toBe('SHOP-482 remplacé');
    });

    it.each(['once', 'following'] as const)('un favori déposé au bord (%s)', async (choice) => {
        const bench = mountScreen({ recurrences: [REVIEW], top: 540, today, favorites: ['SHOP-519'] });
        await bench.settle();
        const seeds = ids(bench);
        bench.dropFavorite('SHOP-519', 585);
        await bench.drain();
        expect(questionShown().subtitle).toBe('SHOP-519, mardi 6 octobre, de\u00a009:45\u00a0à\u00a010:30');
        if (choice === 'following') {
            bench.chooseScope('following');
        }
        bench.enter();
        await bench.drain();

        const longer = born(bench, seeds);
        expect(bench.shown()).toEqual([
            choice === 'once'
                ? ['09:45', '10:30', 'work', 'SHOP-519', null]
                : ['09:45', '10:30', 'work', 'SHOP-519', null, longer],
        ]);
        expect(bench.shown()).toEqual(bench.slow.ranges());
    });

    it.each(['once', 'following'] as const)(
        'Nouveau ticket au bord (%s) : cette fois seulement sans récurrence nouvelle, avec les suivantes ses nouvelles heures',
        async (choice) => {
            const bench = mountScreen({ recurrences: [DAILY], top: 540, today });
            const seeds = ids(bench);
            const [daily = ''] = seeds;
            await windowBelow(bench);
            if (choice === 'following') {
                bench.chooseScope('following');
            }
            press(footerButton('Allonger'));
            await bench.drain();

            const longer = born(bench, seeds);
            expect(longer === undefined).toBe(choice === 'once');
            expect(bench.editing.window).toBeNull();
            expect(bench.shown()).toEqual([
                choice === 'once'
                    ? ['09:00', '09:45', 'work', 'OPS-12', 'Daily']
                    : ['09:00', '09:45', 'work', 'OPS-12', 'Daily', longer],
            ]);
            expect(bench.slow.server.recurrence(daily)?.until).toBe(choice === 'once' ? null : EVE);
            bench.undo();
            await bench.drain();
            expect(bench.shown()).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', daily]]);
        },
    );
});

describe('un jour passé', () => {
    it('ne demande jamais : couper, raccourcir, coller ou déposer au bord ne changent que cette fois', async () => {
        for (const gesture of ['cut', 'shorten', 'paste', 'drop'] as const) {
            unmountAll();
            const bench = mountScreen({ recurrences: [DAILY], top: 540, today: WEDNESDAY, favorites: ['OPS-12'] });
            await bench.settle();
            const [daily = ''] = ids(bench);
            switch (gesture) {
                case 'cut':
                    bench.select([540, 555]);
                    bench.press('x', { ctrlKey: true });
                    break;
                case 'shorten':
                    bench.click(555);
                    bench.press('Delete');
                    break;
                case 'paste':
                    await pasteBelow(bench);
                    break;
                case 'drop':
                    bench.dropFavorite('OPS-12', 570);
                    break;
            }
            await bench.drain();

            expect(bench.editing.window).toBeNull();
            expect(bench.shown()).toEqual(bench.slow.ranges());
            expect(bench.slow.server.recurrence(daily)?.until).toBeNull();
            expect(ids(bench)).toEqual([daily]);
            expect(bench.session.clipboard()?.recurrence).toBeUndefined();
            if (gesture === 'cut' || gesture === 'shorten') {
                // Cette fois seulement : elle se détache.
                expect(bench.slow.server.isSkipped(daily, DATE)).toBe(true);
                expect(arrows()).toEqual([]);
            } else {
                // Posé à côté, le bloc reste à part : le Daily garde sa flèche.
                expect(bench.shown()).toEqual([
                    ['09:00', '09:30', 'work', 'OPS-12', 'Daily', daily],
                    ['09:30', '09:45', 'work', 'OPS-12', gesture === 'paste' ? 'Daily' : null],
                ]);
            }
        }
    });
});

/**
 * Le Daily, et la rétrospective, chaque mercredi de\u00a009:30\u00a0à\u00a010:00 à partir du 7 : elle prend
 * le créneau où l'on allonge le Daily, ou bien où on le colle, mais pas ce mardi.
 */
function withRetro(today: string = DATE): Bench {
    const server = new FakeDayServer();
    seedRecurrences(server, [DAILY], null);
    const retro: SlotChange = { start: '09:30', end: '10:00', kind: 'work', ticket: 'OPS-3', comment: 'Rétrospective' };
    const created = server.saveRecurrence(WEDNESDAY, server.read(WEDNESDAY).version, [retro], weeklyRule([3]), null);
    if (created.status !== 'saved') {
        throw new Error(`La rétrospective n'est pas née : ${JSON.stringify(created)}.`);
    }

    return mountScreen({ slow: new SlowServer(server), top: 540, today });
}

const TAKEN = 'Ce créneau est déjà pris par la récurrence «\u{a0}Rétrospective\u{a0}».';

describe('un créneau qu’une autre récurrence prend', () => {
    it('allonger avec les suivantes : rien ne s’allonge, et le refus se dit en bas de la grille', async () => {
        const bench = withRetro();
        const seeds = ids(bench);
        const start = bench.shown();
        await pasteBelow(bench);
        bench.chooseScope('following');
        bench.enter();
        await bench.drain();

        expect(bench.editing.window).toBeNull();
        expect(said(bench)).toBe(TAKEN);
        expect(bench.shown()).toEqual(start);
        expect(bench.shown()).toEqual(bench.slow.ranges());
        expect(ids(bench)).toEqual(seeds);
    });

    it('Nouveau ticket allongé avec les suivantes, le créneau pris ailleurs la question ouverte : la fenêtre rend ses champs, le refus dessous', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        const start = bench.shown();
        await windowBelow(bench);
        expect(bench.question()?.action.question).toBe('extend');
        // Un autre onglet crée la rétrospective pendant que la question est ouverte : l'écran
        // ne la connaît pas, le serveur la refuse.
        const { server } = bench.slow;
        const retro: SlotChange = {
            start: '09:30',
            end: '10:00',
            kind: 'work',
            ticket: 'OPS-3',
            comment: 'Rétrospective',
        };
        expect(
            server.saveRecurrence(WEDNESDAY, server.read(WEDNESDAY).version, [retro], weeklyRule([3]), null).status,
        ).toBe('saved');
        bench.chooseScope('following');
        bench.enter();
        await bench.drain();

        expect(bench.question()).toBeUndefined();
        expect(bench.editing.window?.errors.rhythm).toBe(TAKEN);
        expect(bench.editing.window?.draft).toEqual({ ticket: 'OPS-12', comment: 'Daily' });
        expect(checkbox().checked).toBe(true);
        expect(bench.shown()).toEqual(start);
        expect(bench.shown()).toEqual(bench.slow.ranges());
    });

    it('Nouveau ticket au bord, le créneau déjà pris : la fenêtre le dit sous la récurrence, sans rien demander', async () => {
        const bench = withRetro();
        const before = writes(bench);
        await windowBelow(bench);

        expect(bench.question()).toBeUndefined();
        expect(dialog().textContent).toContain('Rétrospective');
        expect(writes(bench)).toEqual(before);
    });

    it('coller une récurrence coupée : rien n’est collé, le refus se dit, et elle reste dans le presse-papier', async () => {
        const bench = withRetro();
        const seeds = ids(bench);
        bench.select([540, 555]);
        bench.press('x', { ctrlKey: true });
        await bench.drain();
        bench.chooseScope('following');
        bench.enter();
        await bench.drain();

        bench.click(570);
        bench.press('v', { ctrlKey: true });
        await bench.drain();
        expect(said(bench)).toBe(TAKEN);
        expect(bench.shown()).toEqual([]);
        expect(ids(bench)).toEqual(seeds);
        expect(bench.session.clipboard()?.recurrence).toBeDefined();

        // Ailleurs, elle repart.
        bench.click(900);
        bench.press('v', { ctrlKey: true });
        await bench.drain();
        expect(bench.shown()).toEqual([['15:00', '15:30', 'work', 'OPS-12', 'Daily', born(bench, seeds)]]);
    });
});

describe('des gestes qui se croisent, serveur lent ou onglet en retard', () => {
    it('couper avec les suivantes puis changer de jour avant de coller : la coupe arrive, puis la récurrence repart de l’autre jour', async () => {
        const bench = mountGrid({ recurrences: [DAILY], top: 540 });
        const seeds = ids(bench);
        const [daily = ''] = seeds;
        bench.select([540, 555]);
        bench.press('x', { ctrlKey: true });
        await bench.drain();
        bench.chooseScope('following');
        bench.slow.hold();

        let switched: boolean | null = null;
        void bench.switchDay(WEDNESDAY).then((done) => {
            switched = done;
        });
        await bench.settle();
        // La réponse est en route : on reste sur le mardi tant qu'elle n'est pas arrivée.
        expect(switched).toBeNull();
        expect(bench.session.date).toBe(DATE);

        await bench.drain();
        expect(switched).toBe(true);
        expect(bench.session.date).toBe(WEDNESDAY);
        expect(bench.slow.server.recurrence(daily)?.until).toBe(EVE);
        // Le mercredi, le Daily ne vient plus.
        expect(bench.shown()).toEqual([]);

        bench.click(600);
        bench.press('v', { ctrlKey: true });
        await bench.drain();
        const moved = born(bench, seeds);
        expect(bench.slow.server.recurrence(moved ?? '')).toMatchObject({
            firstDay: WEDNESDAY,
            start: '10:00',
            end: '10:30',
            weekdays: [1, 2, 3, 4, 5],
        });
        expect(bench.shown()).toEqual([['10:00', '10:30', 'work', 'OPS-12', 'Daily', moved]]);
        expect(rangesOn(bench, DATE)).toEqual([]);
    });

    it('un collage en route, puis un autre jour et un autre collage avant sa réponse : une seule récurrence repart', async () => {
        const bench = mountGrid({ recurrences: [DAILY], top: 540 });
        const seeds = ids(bench);
        bench.select([540, 555]);
        bench.press('x', { ctrlKey: true });
        await bench.drain();
        bench.chooseScope('following');
        bench.enter();
        await bench.drain();
        expect(await bench.switchDay(WEDNESDAY)).toBe(true);

        // Collé le mercredi à 10:00, la réponse retenue ; l'écran passe au jeudi, où l'on colle à 11:00.
        bench.slow.hold();
        bench.click(600);
        bench.press('v', { ctrlKey: true });
        await bench.settle();
        expect(bench.slow.count).toBe(1);
        expect(await bench.switchDay(THURSDAY)).toBe(true);
        bench.click(660);
        bench.press('v', { ctrlKey: true });
        await bench.drain();

        expect(ids(bench)).toHaveLength(seeds.length + 1);
        const moved = born(bench, seeds);
        expect(bench.slow.server.recurrence(moved ?? '')).toMatchObject({ firstDay: WEDNESDAY, start: '10:00' });
        // Le jeudi, la récurrence collée mercredi revient, et le bloc collé ce jour-là est seul.
        expect(bench.shown()).toEqual([
            ['10:00', '10:30', 'work', 'OPS-12', 'Daily', moved],
            ['11:00', '11:30', 'work', 'OPS-12', 'Daily'],
        ]);
        expect(bench.shown()).toEqual(rangesOn(bench, THURSDAY));
        expect(bench.session.clipboard()?.recurrence).toBeUndefined();
    });

    it('un collage refusé — une journée changée ailleurs — lui rend la récurrence ; un collage perdu en route, non', async () => {
        const bench = mountGrid({ recurrences: [DAILY], top: 540 });
        const seeds = ids(bench);
        bench.select([540, 555]);
        bench.press('x', { ctrlKey: true });
        await bench.drain();
        bench.chooseScope('following');
        bench.enter();
        await bench.drain();
        const cut = bench.session.clipboard();

        bench.elsewhere(HOUR);
        bench.click(900);
        bench.press('v', { ctrlKey: true });
        await bench.drain();
        expect(said(bench)).toBe(STALE);
        expect(ids(bench)).toEqual(seeds);
        expect(bench.session.clipboard()).toEqual(cut);

        // Perdu en route : l'écriture a pu passer, la récurrence ne revient pas.
        bench.slow.lose();
        bench.click(900);
        bench.press('v', { ctrlKey: true });
        await bench.drain();
        expect(ids(bench)).toEqual(seeds);
        expect(bench.session.clipboard()).toEqual({ cells: cut?.cells });
        bench.click(900);
        bench.press('v', { ctrlKey: true });
        await bench.drain();
        expect(ids(bench)).toEqual(seeds);
        expect(bench.shown()).toEqual([HOUR_RANGE, ['15:00', '15:30', 'work', 'OPS-12', 'Daily']]);
    });

    it('une copie faite sur un autre jour pendant qu’un collage attend son refus reste dans le presse-papier', async () => {
        const bench = withRetro();
        bench.select([540, 555]);
        bench.press('x', { ctrlKey: true });
        await bench.drain();
        bench.chooseScope('following');
        bench.enter();
        await bench.drain();

        // Collé à 09:30, sur le créneau de la rétrospective, la réponse retenue.
        bench.slow.hold();
        bench.click(570);
        bench.press('v', { ctrlKey: true });
        await bench.settle();
        expect(await bench.switchDay(WEDNESDAY)).toBe(true);
        bench.click(570);
        bench.press('c', { ctrlKey: true });
        await bench.drain();

        expect(bench.session.clipboard()).toEqual({
            cells: [
                { offset: 0, content: { kind: 'work', ticket: 'OPS-3', comment: 'Rétrospective', recurrence: null } },
            ],
        });
    });

    it('annuler la coupe retire la récurrence du presse-papier ; rétablir ne la remet pas', async () => {
        const bench = mountGrid({ recurrences: [DAILY], top: 540 });
        const seeds = ids(bench);
        bench.select([540, 555]);
        bench.press('x', { ctrlKey: true });
        await bench.drain();
        bench.chooseScope('following');
        bench.enter();
        await bench.drain();

        bench.undo();
        await bench.drain();
        expect(bench.shown()).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', seeds[0]]]);
        expect(bench.session.clipboard()?.recurrence).toBeUndefined();
        bench.undo(true);
        await bench.drain();
        expect(bench.session.clipboard()?.recurrence).toBeUndefined();

        bench.click(900);
        bench.press('v', { ctrlKey: true });
        await bench.drain();
        expect(ids(bench)).toEqual(seeds);
        expect(bench.shown()).toEqual([['15:00', '15:30', 'work', 'OPS-12', 'Daily']]);
    });

    it('un collage fait pendant que la coupe attend le serveur colle ce qu’elle a coupé, une fois arrivée', async () => {
        const bench = mountGrid({ recurrences: [DAILY], top: 540 });
        const seeds = ids(bench);
        bench.select([540, 555]);
        bench.press('x', { ctrlKey: true });
        await bench.drain();
        bench.chooseScope('following');
        bench.slow.hold();
        bench.enter();
        await bench.settle();

        bench.click(900);
        bench.press('v', { ctrlKey: true });
        await bench.settle();
        expect(bench.slow.count).toBe(1);
        await bench.drain();

        const moved = born(bench, seeds);
        expect(moved).toBeDefined();
        expect(bench.shown()).toEqual([['15:00', '15:30', 'work', 'OPS-12', 'Daily', moved]]);
        expect(bench.shown()).toEqual(bench.slow.ranges());
        expect(bench.session.clipboard()?.recurrence).toBeUndefined();
    });

    it.each(['cut', 'shorten', 'extend'] as const)(
        'la réponse (%s) part une seule fois : Entrée répétée, puis un double clic sur le bouton',
        async (question) => {
            for (const how of ['enter', 'button'] as const) {
                unmountAll();
                const bench = mountScreen({ recurrences: [DAILY], top: 540 });
                if (question === 'cut') {
                    bench.select([540, 555]);
                    bench.press('x', { ctrlKey: true });
                } else if (question === 'shorten') {
                    bench.click(555);
                    bench.press('Delete');
                } else {
                    await pasteBelow(bench);
                }
                await bench.drain();
                expect(bench.question()?.action.question).toBe(question);
                bench.chooseScope('following');
                const before = writes(bench).length;
                bench.slow.hold();
                for (let count = 0; count < 3; count += 1) {
                    if (how === 'enter') {
                        bench.enter();
                    } else {
                        bench.confirm();
                    }
                }
                await bench.settle();
                expect(bench.editing.window?.sending).toBe(true);
                await bench.drain();

                expect(writes(bench).slice(before)).toEqual(['saveRecurrence']);
                expect(ids(bench)).toHaveLength(question === 'cut' ? 1 : 2);
                expect(bench.editing.window).toBeNull();
                expect(bench.shown()).toEqual(bench.slow.ranges());
            }
        },
    );

    it.each(['cut', 'shorten', 'extend'] as const)(
        'un onglet resté ouvert pendant qu’un autre changeait la journée (%s) : refusé, rien d’écrit, rien dans le presse-papier',
        async (question) => {
            const bench = mountGrid({ recurrences: [DAILY], top: 540 });
            const [daily = ''] = ids(bench);
            if (question === 'extend') {
                await pasteBelow(bench);
            } else if (question === 'cut') {
                bench.select([540, 555]);
                bench.press('x', { ctrlKey: true });
            } else {
                bench.click(555);
                bench.press('Delete');
            }
            await bench.drain();
            const clipboard = bench.session.clipboard();
            bench.elsewhere(HOUR);
            const before = bench.slow.server.writes.length;
            bench.chooseScope('following');
            bench.enter();
            await bench.drain();

            expect(bench.slow.server.writes).toHaveLength(before);
            expect(bench.editing.window).toBeNull();
            expect(said(bench)).toBe(STALE);
            expect(bench.slow.server.recurrence(daily)?.until).toBeNull();
            expect(bench.session.clipboard()).toEqual(clipboard);
            expect(bench.shown()).toEqual(bench.slow.ranges());
        },
    );

    it('les bornes de la journée : allonger jusqu’à 20:00 ou depuis 07:00, et coller une récurrence coupée jusqu’à 20:00 pile', async () => {
        const early: SlotChange = { start: '07:00', end: '07:15', kind: 'pause', ticket: null, comment: null };
        const late: SlotChange = { start: '19:30', end: '19:45', kind: 'work', ticket: 'OPS-7', comment: 'Soir' };
        const bench = mountGrid({ recurrences: [early, late], top: 420 });
        const seeds = ids(bench);

        // Le soir, allongé jusqu'à 20:00 avec les suivantes.
        bench.click(1170);
        bench.press('c', { ctrlKey: true });
        await bench.drain();
        bench.click(1185);
        bench.press('v', { ctrlKey: true });
        await bench.drain();
        expect(bench.question()?.action.reshapes).toMatchObject({ start: 1170, end: 1200 });
        bench.chooseScope('following');
        bench.enter();
        await bench.drain();
        const evening = born(bench, seeds);
        expect(bench.slow.server.recurrence(evening ?? '')).toMatchObject({ start: '19:30', end: '20:00' });

        // La pause de 07:00, allongée au-dessous, puis coupée avec les suivantes et collée à 19:15.
        bench.click(420);
        bench.press('c', { ctrlKey: true });
        await bench.drain();
        bench.click(435);
        bench.press('v', { ctrlKey: true });
        await bench.drain();
        bench.chooseScope('following');
        bench.enter();
        await bench.drain();
        const morning = born(bench, [...seeds, evening ?? '']);
        expect(bench.slow.server.recurrence(morning ?? '')).toMatchObject({ start: '07:00', end: '07:30' });

        bench.select([420, 435]);
        bench.press('x', { ctrlKey: true });
        await bench.drain();
        expect(bench.question()?.action.question).toBe('cut');
        bench.chooseScope('following');
        bench.enter();
        await bench.drain();

        // À 19:45, il déborderait : rien n'est collé, et elle reste dans le presse-papier.
        bench.click(1185);
        bench.press('v', { ctrlKey: true });
        await bench.drain();
        expect(said(bench)).toBe("Rien n'est collé, le groupe dépasserait 20:00.");
        expect(bench.session.clipboard()?.recurrence).toBeDefined();

        // Le soir, raccourci à 19:30 cette fois seulement, libère 19:45 : la pause n'y tient toujours pas.
        bench.click(1185);
        bench.press('Delete');
        await bench.drain();
        expect(bench.question()?.action.question).toBe('shorten');
        bench.enter();
        await bench.drain();

        // À 19:00, juste au-dessus du soir : elle repart de\u00a019:00\u00a0à\u00a019:30.
        bench.click(1140);
        bench.press('v', { ctrlKey: true });
        await bench.drain();
        const moved = born(bench, [...seeds, evening ?? '', morning ?? '']);
        expect(bench.slow.server.recurrence(moved ?? '')).toMatchObject({
            start: '19:00',
            end: '19:30',
            firstDay: DATE,
        });
        expect(bench.shown()).toEqual(bench.slow.ranges());
        expect(bench.shown()).toEqual([
            ['19:00', '19:30', 'pause', null, null, moved],
            ['19:30', '19:45', 'work', 'OPS-7', 'Soir'],
        ]);
    });
});
