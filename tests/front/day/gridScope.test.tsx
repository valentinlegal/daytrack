// @vitest-environment jsdom
import { act, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SlotChange } from '../../../assets/grid/changes';
import type { RecurrenceResult, WriteResult } from '../../../assets/grid/daySession';
import type { UntilRewind } from '../../../assets/grid/history';
import type { RecurrenceRule, SeenRecurrence } from '../../../assets/grid/recurrence';
import { TICKET_NOT_FOUND } from '../../../assets/jira/lookupMessages';
import { LOOKUP_DELAY } from '../../../assets/jira/useTicketLookup';
import { FakeDayServer } from '../grid/fakeDayServer';
import { type Range, rangesOf } from '../grid/support';
import { type Bench, DATE, EVE, mountGrid, mountScreen, seedRecurrences, SlowServer, unmountAll } from './gridBench';

/**
 * La question « quelles fois » sur un bloc qui revient, sur la vraie grille et la vraie
 * fenêtre : Enregistrer, la case décochée, la corbeille ou le ticket vidé la posent à la
 * place des champs, que Retour rend ; Suppr et Effacer du menu, sur une fois entière, l'ouvrent
 * d'emblée, qu'Annuler ferme. « Cette fois seulement » est choisi d'avance ; Entrée, le bouton
 * de droite ou un clic à côté valident le choix, une seule fois. Aujourd'hui, où la fois est
 * posée, et un jour à venir, où elle n'est que prévue ; jamais d'un jour passé.
 */

/** Le Daily, de 09:00 à 09:30, né la veille, chaque jour ouvré. */
const DAILY: SlotChange = { start: '09:00', end: '09:30', kind: 'work', ticket: 'OPS-12', comment: 'Daily' };
/** La pause du déjeuner, de 12:30 à 13:30, née la veille, chaque jour ouvré. */
const LUNCH: SlotChange = { start: '12:30', end: '13:30', kind: 'pause', ticket: null, comment: null };
/** Une heure saisie à la main, l'après-midi. */
const HOUR: SlotChange = { start: '14:00', end: '15:00', kind: 'work', ticket: 'SHOP-482', comment: 'Mapping' };
const STALE = 'La journée a changé entre-temps. Vérifiez, puis enregistrez de nouveau.';
const WEDNESDAY = '2026-10-07';
const NINE = 540;

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

/** Le titre, les choix et les boutons de la question, comme le lecteur d'écran les lit. */
function questionShown(): { title: string; group: string; choices: string[]; checked: string; buttons: string[] } {
    const group = dialog().querySelector('[role="radiogroup"]');
    if (group === null) {
        throw new Error('La fenêtre ne pose pas la question.');
    }
    const radios = [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')];

    return {
        title: dialog().querySelector('h2')?.textContent ?? '',
        group: group.getAttribute('aria-label') ?? '',
        choices: radios.map((radio) => radio.closest('label')?.textContent ?? ''),
        checked: radios.find((radio) => radio.checked)?.closest('label')?.textContent ?? '',
        // Les champs, cachés sous la question, ne se lisent pas.
        buttons: [...dialog().querySelectorAll('button')]
            .filter((button) => button.closest('.hidden') === null)
            .map((button) => button.textContent.trim())
            .filter((text) => text !== ''),
    };
}

/** Le bouton radio de ce choix. */
function radio(choice: 'once' | 'following'): HTMLInputElement {
    const found = dialog().querySelector<HTMLInputElement>(`input[type="radio"][value="${choice}"]`);
    if (found === null) {
        throw new Error(`La question n'a pas le choix ${choice}.`);
    }

    return found;
}

function ticketField(): HTMLInputElement {
    const field = dialog().querySelector<HTMLInputElement>(
        'input:not([type="radio"]):not([type="checkbox"]):not([type="date"])',
    );
    if (field === null) {
        throw new Error("La fenêtre n'a pas de champ Ticket.");
    }

    return field;
}

function checkbox(): HTMLInputElement {
    const box = dialog().querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (box === null) {
        throw new Error("La fenêtre n'a pas de case « Récurrence ».");
    }

    return box;
}

function press(element: HTMLElement): void {
    act(() => {
        element.click();
    });
}

/** Les flèches de la grille, par ce que lit le lecteur d'écran. */
function arrows(): string[] {
    return [...document.querySelectorAll('svg[role="img"]')].map((svg) => svg.getAttribute('aria-label') ?? '');
}

/** Ouvre la fenêtre du créneau au double-clic, une fois la journée à jour. */
async function openAt(bench: Bench, quarter: number): Promise<void> {
    bench.doubleClick(quarter);
    await bench.drain();
    expect(bench.editing.window?.sending).toBe(false);
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

/** Le Daily du banc. */
function daily(bench: Bench): string {
    return bench.slow.server.allRecurrences()[0]?.id ?? '';
}

function dailyRange(id: string, comment = 'Daily', ticket = 'OPS-12'): Range {
    return ['09:00', '09:30', 'work', ticket, comment, id];
}

/** Ouvre le Daily, tape un autre commentaire et Entrée : la question « Modifier une récurrence ». */
async function askModify(bench: Bench, comment = 'Rétro'): Promise<void> {
    await openAt(bench, NINE);
    bench.type('OPS-12', comment);
    bench.enter();
    await bench.drain();
    expect(bench.question()?.action.question).toBe('modify');
}

describe('la question, sur la vraie fenêtre', () => {
    it('remplace les champs, se lit au lecteur d’écran, et pose le curseur sur le choix d’avance', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        const before = writes(bench);
        await askModify(bench);

        expect(questionShown()).toEqual({
            title: 'Modifier une récurrence',
            group: 'Quelles fois modifier',
            choices: ['Cette fois seulement', 'Cette fois et les suivantes'],
            checked: 'Cette fois seulement',
            buttons: ['Retour', 'Enregistrer'],
        });
        // À la largeur des champs qu'elle remplace.
        expect(dialog().classList.contains('w-pop')).toBe(true);
        expect(document.activeElement).toBe(radio('once'));
        expect(dialog().textContent).toContain('Les fois passées ne changent jamais.');
        expect(writes(bench)).toEqual(before);
    });

    it('rend à Retour les champs tels qu’on les a laissés, le curseur au ticket ; Enregistrer la repose', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        const before = writes(bench);
        await askModify(bench);
        press(radio('following'));
        expect(bench.question()?.choice).toBe('following');

        bench.back();
        await bench.drain();
        expect(bench.question()).toBeUndefined();
        expect(ticketField().value).toBe('OPS-12');
        expect(dialog().querySelector('textarea')?.value).toBe('Rétro');
        expect(checkbox().checked).toBe(true);
        expect(document.activeElement).toBe(ticketField());
        expect(writes(bench)).toEqual(before);

        bench.enter();
        await bench.drain();
        expect(questionShown().checked).toBe('Cette fois seulement');
        expect(document.activeElement).toBe(radio('once'));
    });

    it('arrête : la case décochée reste décochée après Retour, et le bouton dit « Arrêter »', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        await openAt(bench, NINE);
        press(checkbox());
        bench.enter();
        await bench.drain();
        expect(questionShown()).toMatchObject({
            title: 'Arrêter une récurrence',
            group: 'Quelles fois arrêter',
            buttons: ['Retour', 'Arrêter'],
        });

        bench.back();
        await bench.drain();
        expect(checkbox().checked).toBe(false);
        expect(document.activeElement).toBe(ticketField());
    });

    it('Échap fait comme Retour : les champs reviennent, et un second Échap ferme sans rien écrire', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        const before = writes(bench);
        await askModify(bench);

        bench.escape();
        await bench.drain();
        expect(bench.question()).toBeUndefined();
        expect(bench.editing.window?.draft).toEqual({ ticket: 'OPS-12', comment: 'Rétro' });
        bench.escape();
        await bench.drain();
        expect(bench.editing.window).toBeNull();
        expect(writes(bench)).toEqual(before);
        expect(bench.shown()).toEqual([dailyRange(daily(bench))]);
    });

    it('la corbeille et le ticket vidé demandent quelles fois effacer', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        await openAt(bench, NINE);
        bench.button('delete');
        await bench.drain();
        expect(questionShown()).toMatchObject({
            title: 'Effacer une récurrence',
            group: 'Quelles fois effacer',
            buttons: ['Retour', 'Effacer'],
        });

        bench.back();
        await bench.drain();
        bench.type('', 'Daily');
        bench.enter();
        await bench.drain();
        expect(questionShown().group).toBe('Quelles fois effacer');
    });

    it('Suppr sur une fois entière ouvre la question d’emblée, plus étroite : Annuler la ferme, sans rien écrire', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        const before = writes(bench);
        bench.select([540, 555]);
        bench.press('Delete');
        await bench.drain();

        expect(bench.question()).toMatchObject({ choice: 'once', back: false });
        expect(questionShown()).toEqual({
            title: 'Effacer une récurrence',
            group: 'Quelles fois effacer',
            choices: ['Cette fois seulement', 'Cette fois et les suivantes'],
            checked: 'Cette fois seulement',
            buttons: ['Annuler', 'Effacer'],
        });
        expect(dialog().classList.contains('w-pop-sm')).toBe(true);
        expect(document.activeElement).toBe(radio('once'));

        bench.back();
        await bench.drain();
        expect(bench.editing.window).toBeNull();
        bench.select([540, 555]);
        bench.press('Delete');
        await bench.drain();
        bench.escape();
        await bench.drain();
        expect(bench.editing.window).toBeNull();
        expect(writes(bench)).toEqual(before);
        expect(bench.shown()).toEqual([dailyRange(daily(bench))]);
    });

    it('Entrée tenue sur un choix ne valide rien : seule une touche franche le fait', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        const before = writes(bench);
        await askModify(bench);

        act(() => {
            radio('once').dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, repeat: true }),
            );
        });
        await bench.drain();
        expect(bench.question()).toBeDefined();
        expect(writes(bench)).toEqual(before);
    });
});

describe.each(DAYS)('les réponses, $name', ({ today }) => {
    const ahead = today === EVE;

    it('modifier : cette fois seulement détache la fois, la récurrence continue ; avec les suivantes, elle se coupe', async () => {
        for (const choice of ['once', 'following'] as const) {
            unmountAll();
            const bench = mountScreen({ recurrences: [DAILY], top: 540, today });
            const id = daily(bench);
            await askModify(bench);
            if (choice === 'following') {
                bench.chooseScope('following');
            }
            bench.confirm();
            await bench.drain();

            expect(bench.editing.window).toBeNull();
            const born = bench.slow.server.allRecurrences().find((recurrence) => recurrence.id !== id)?.id;
            expect(bench.shown()).toEqual([
                choice === 'once' ? ['09:00', '09:30', 'work', 'OPS-12', 'Rétro'] : dailyRange(born ?? '', 'Rétro'),
            ]);
            expect(bench.shown()).toEqual(bench.slow.ranges());
            expect(bench.slow.server.recurrence(id)?.until).toBe(choice === 'once' ? null : EVE);
            expect(writes(bench).at(-1)).toBe(choice === 'once' ? 'changeSlots' : 'saveRecurrence');
            // Modifier ne fait rien disparaître : aucun message.
            expect(bench.editing.message).toBeNull();
            expect(arrows()).toHaveLength(choice === 'once' ? 0 : 1);
            // Le mercredi suit la réponse.
            expect(bench.slow.server.read(WEDNESDAY).grid.blocks()[0]?.content).toMatchObject(
                choice === 'once' ? { comment: 'Daily', recurrence: id } : { comment: 'Rétro', recurrence: born },
            );
        }
    });

    it('arrêter : le bloc reste sans flèche ; avec les suivantes, la récurrence finit la veille', async () => {
        for (const choice of ['once', 'following'] as const) {
            unmountAll();
            const bench = mountScreen({ recurrences: [DAILY], top: 540, today });
            const id = daily(bench);
            await openAt(bench, NINE);
            press(checkbox());
            bench.enter();
            await bench.drain();
            if (choice === 'following') {
                press(radio('following'));
            }
            bench.enter();
            await bench.drain();

            expect(bench.shown()).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily']]);
            expect(bench.shown()).toEqual(bench.slow.ranges());
            expect(arrows()).toEqual([]);
            expect(bench.slow.server.recurrence(id)?.until).toBe(choice === 'once' ? null : EVE);
            expect(bench.slow.server.isSkipped(id, DATE)).toBe(choice === 'once');
            expect(bench.editing.message).toBeNull();
        }
    });

    it('la corbeille : la fois effacée, « … effacé » ; avec les suivantes, la récurrence finit la veille', async () => {
        for (const choice of ['once', 'following'] as const) {
            unmountAll();
            const bench = mountScreen({ recurrences: [DAILY], top: 540, today });
            const id = daily(bench);
            await openAt(bench, NINE);
            bench.button('delete');
            await bench.drain();
            if (choice === 'following') {
                bench.chooseScope('following');
            }
            bench.click(840);
            await bench.drain();

            expect(bench.editing.window).toBeNull();
            expect(bench.shown()).toEqual([]);
            expect(bench.slow.ranges()).toEqual([]);
            expect(bench.slow.server.recurrence(id)?.until).toBe(choice === 'once' ? null : EVE);
            expect(said(bench)).toBe('OPS-12 effacé');
            // Un jour à venir où rien ne reste saisi ne naît pas.
            expect(bench.slow.server.saved(DATE).version === 0).toBe(ahead);
        }
    });

    it('Suppr : la fois effacée, « … effacé » ; Ctrl+Z la rend avec sa flèche', async () => {
        for (const choice of ['once', 'following'] as const) {
            unmountAll();
            const bench = mountScreen({ recurrences: [DAILY], top: 540, today });
            const id = daily(bench);
            bench.select([540, 555]);
            bench.press('Delete');
            await bench.drain();
            expect(bench.question()).toMatchObject({ action: { question: 'erase' }, back: false });
            if (choice === 'following') {
                bench.chooseScope('following');
            }
            bench.enter();
            await bench.drain();

            expect(bench.shown()).toEqual([]);
            expect(said(bench)).toBe('OPS-12 effacé');
            expect(bench.slow.server.recurrence(id)?.until).toBe(choice === 'once' ? null : EVE);

            bench.undo();
            await bench.drain();
            expect(bench.shown()).toEqual([dailyRange(id)]);
            expect(bench.slow.server.recurrence(id)?.until).toBeNull();
            expect(bench.slow.server.isSkipped(id, DATE)).toBe(false);
        }
    });

    it('pas de question au milieu d’une fois, sur deux blocs qui reviennent, ou sur un bloc qui revient avec un autre', async () => {
        for (const [quarters, by] of [
            // Le milieu de la pause : effacé, il la couperait en deux, ce qui ne raccourcit rien.
            [[765], 'key'],
            [[540, 555, 750], 'menu'],
            [[540, 555, 840], 'key'],
        ] as const) {
            unmountAll();
            const bench = mountScreen({ recurrences: [DAILY, LUNCH], blocks: [HOUR], top: 540, today });
            const [id = '', lunch = ''] = bench.slow.server.allRecurrences().map((recurrence) => recurrence.id);
            for (const [index, quarter] of quarters.entries()) {
                bench.click(quarter, index === 0 ? {} : { ctrlKey: true });
            }
            if (by === 'key') {
                bench.press('Delete');
            } else {
                bench.choose('clear');
            }
            await bench.drain();

            expect(bench.editing.window).toBeNull();
            expect(bench.shown()).toEqual(bench.slow.ranges());
            const chosen: readonly number[] = quarters;
            const daily: Range[] = chosen.includes(540) ? [] : [dailyRange(id)];
            const lunchBlock: Range[] = chosen.includes(765)
                ? [
                      ['12:30', '12:45', 'pause', null, null],
                      ['13:00', '13:30', 'pause', null, null],
                  ]
                : chosen.includes(750)
                  ? [['12:45', '13:30', 'pause', null, null]]
                  : [['12:30', '13:30', 'pause', null, null, lunch]];
            const hour: Range[] = chosen.includes(840)
                ? [['14:15', '15:00', 'work', 'SHOP-482', 'Mapping']]
                : [['14:00', '15:00', 'work', 'SHOP-482', 'Mapping']];
            expect(bench.shown()).toEqual([...daily, ...lunchBlock, ...hour]);
        }
    });

    it('changer seulement ses jours ou sa fin ne demande rien', async () => {
        for (const draft of [
            { weekdays: [2, 4], until: '' },
            { weekdays: [1, 2, 3, 4, 5], until: '2026-11-04' },
        ]) {
            unmountAll();
            const bench = mountScreen({ recurrences: [DAILY], top: 540, today });
            const id = daily(bench);
            await openAt(bench, NINE);
            bench.adjustRecurrence(draft);
            bench.enter();
            await bench.drain();

            expect(bench.editing.window).toBeNull();
            expect(writes(bench).at(-1)).toBe('saveRecurrence');
            const until = bench.slow.server.recurrence(id)?.until;
            expect(until).toBe(draft.until === '' ? EVE : '2026-11-04');
        }
    });
});

describe('Effacer du menu', () => {
    // Le menu, qui rend le curseur à la grille en se fermant, le laisse à la question : sinon elle
    // le perdrait, et se validerait seule, « Cette fois seulement », sans avoir été vue.
    it('sur une fois entière, pose la question au lieu de l’effacer aussitôt', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        const before = writes(bench);
        bench.select([540, 555]);
        bench.rightClick(555);
        await bench.settle();
        const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((candidate) =>
            candidate.textContent.includes('Effacer'),
        );
        expect(item).toBeDefined();
        act(() => {
            item?.click();
        });
        await bench.drain();

        expect(bench.question()).toMatchObject({ action: { question: 'erase' }, back: false });
        expect(writes(bench)).toEqual(before);
        expect(bench.shown()).toEqual([dailyRange(daily(bench))]);
    });
});

describe('un jour passé', () => {
    const tomorrow = WEDNESDAY;

    it('ne demande jamais : la fenêtre, la corbeille et Suppr ne changent que cette fois', async () => {
        for (const gesture of ['modify', 'trash', 'delete'] as const) {
            unmountAll();
            const bench = mountScreen({ recurrences: [DAILY], top: 540, today: tomorrow });
            const id = daily(bench);
            if (gesture === 'delete') {
                bench.select([540, 555]);
                bench.press('Delete');
            } else {
                await openAt(bench, NINE);
                if (gesture === 'trash') {
                    bench.button('delete');
                } else {
                    bench.type('OPS-12', 'Rétro');
                    bench.enter();
                }
            }
            await bench.drain();

            expect(bench.editing.window).toBeNull();
            expect(bench.shown()).toEqual(gesture === 'modify' ? [['09:00', '09:30', 'work', 'OPS-12', 'Rétro']] : []);
            expect(bench.slow.server.recurrence(id)?.until).toBeNull();
            expect(bench.slow.server.isSkipped(id, DATE)).toBe(true);
        }
    });
});

describe('une réponse qui part une seule fois', () => {
    it('Entrée répétée, puis un double clic sur le bouton de droite : un seul envoi', async () => {
        for (const how of ['enter', 'button'] as const) {
            unmountAll();
            const bench = mountScreen({ recurrences: [DAILY], top: 540 });
            await askModify(bench);
            bench.chooseScope('following');
            const before = writes(bench).length;
            bench.slow.hold();
            for (let press = 0; press < 3; press += 1) {
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
            expect(bench.editing.window).toBeNull();
        }
    });

    it('le serveur lent : Entrée, Échap et un clic à côté pendant l’envoi n’y changent rien', async () => {
        const bench = mountGrid({ recurrences: [DAILY], top: 540 });
        const id = daily(bench);
        bench.select([540, 555]);
        bench.press('Delete');
        await bench.drain();
        bench.chooseScope('following');
        bench.slow.hold();
        bench.enter();
        await bench.settle();
        const before = writes(bench);

        bench.enter();
        bench.escape();
        bench.click(840);
        await bench.settle();
        expect(bench.editing.window?.sending).toBe(true);
        expect(bench.question()?.choice).toBe('following');
        expect(writes(bench)).toEqual(before);

        await bench.drain();
        expect(bench.editing.window).toBeNull();
        expect(writes(bench)).toEqual(before);
        expect(bench.shown()).toEqual([]);
        expect(bench.slow.server.recurrence(id)?.until).toBe(EVE);
    });
});

describe('un onglet en retard', () => {
    it.each(['once', 'following'] as const)(
        'la question des champs (%s) rend les champs avec le refus, sans rien écrire',
        async (choice) => {
            const bench = mountScreen({ recurrences: [DAILY], top: 540 });
            const id = daily(bench);
            await askModify(bench);
            // Un autre onglet écrit l'après-midi : la journée a changé.
            bench.elsewhere(HOUR);
            const before = bench.slow.server.writes.length;
            if (choice === 'following') {
                bench.chooseScope('following');
            }
            bench.enter();
            await bench.drain();

            expect(bench.slow.server.writes).toHaveLength(before);
            expect(bench.question()).toBeUndefined();
            expect(bench.editing.window?.errors.general).toBe(STALE);
            expect(bench.editing.window?.draft).toEqual({ ticket: 'OPS-12', comment: 'Rétro' });
            expect(bench.slow.server.recurrence(id)?.until).toBeNull();

            // Relue, elle s'enregistre.
            bench.enter();
            await bench.drain();
            expect(bench.question()?.action.question).toBe('modify');
        },
    );

    it.each(['once', 'following'] as const)(
        'la question de Suppr (%s) se ferme, et le refus se dit en message',
        async (choice) => {
            const bench = mountScreen({ recurrences: [DAILY], top: 540 });
            const id = daily(bench);
            bench.select([540, 555]);
            bench.press('Delete');
            await bench.drain();
            bench.elsewhere(HOUR);
            const before = bench.slow.server.writes.length;
            if (choice === 'following') {
                bench.chooseScope('following');
            }
            bench.enter();
            await bench.drain();

            expect(bench.slow.server.writes).toHaveLength(before);
            expect(bench.editing.window).toBeNull();
            expect(said(bench)).toBe("La journée a changé entre-temps. Rien n'a été modifié.");
            expect(bench.slow.server.recurrence(id)?.until).toBeNull();
            expect(bench.shown()).toEqual(bench.slow.ranges());
        },
    );
});

describe.each(DAYS)('annuler et rétablir cinquante pas après chaque réponse, $name', ({ today }) => {
    it.each([
        ['modify', 'once'],
        ['modify', 'following'],
        ['stop', 'once'],
        ['stop', 'following'],
        ['erase', 'once'],
        ['erase', 'following'],
    ] as const)('%s, %s', async (question, choice) => {
        const bench = mountGrid({ recurrences: [DAILY], top: 540, today });
        const id = daily(bench);
        const start = bench.shown();
        if (question === 'erase') {
            bench.select([540, 555]);
            bench.press('Delete');
        } else {
            bench.doubleClick(NINE);
            await bench.drain();
            if (question === 'stop') {
                bench.adjustRecurrence({ on: false, weekdays: [1, 2, 3, 4, 5], until: '' });
            } else {
                bench.type('OPS-12', 'Rétro');
            }
            bench.enter();
        }
        await bench.drain();
        expect(bench.question()?.action.question).toBe(question);
        if (choice === 'following') {
            bench.chooseScope('following');
        }
        bench.enter();
        await bench.drain();
        const answered = bench.shown();
        const until = bench.slow.server.recurrence(id)?.until;

        // Quarante-neuf favoris déposés l'après-midi, l'un sur l'autre : cinquante pas en tout.
        for (let step = 0; step < 49; step += 1) {
            bench.dropFavorite(step % 2 === 0 ? 'SHOP-1' : 'OPS-3', 840);
            await bench.settle();
        }
        await bench.drain();
        const end = bench.shown();
        for (let step = 0; step < 50; step += 1) {
            expect(bench.snapshot().canUndo).toBe(true);
            bench.undo();
            await bench.drain();
            expect(bench.shown()).toEqual(bench.slow.ranges());
            if (step === 48) {
                expect(bench.shown()).toEqual(answered);
            }
        }
        expect(bench.snapshot().canUndo).toBe(false);
        expect(bench.shown()).toEqual(start);
        expect(bench.slow.server.recurrence(id)?.until).toBeNull();
        expect(bench.slow.server.isSkipped(id, DATE)).toBe(false);

        for (let step = 0; step < 50; step += 1) {
            bench.undo(true);
            await bench.drain();
            expect(bench.shown()).toEqual(bench.slow.ranges());
            if (step === 0) {
                expect(bench.shown()).toEqual(answered);
                expect(bench.slow.server.recurrence(id)?.until).toBe(until);
            }
        }
        expect(bench.snapshot().canRedo).toBe(false);
        expect(bench.shown()).toEqual(end);
    });
});

describe('un changement de jour pendant la question', () => {
    it('valide le choix, attend sa réponse, puis montre l’autre jour, sans rien de l’ancien', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        const id = daily(bench);
        await askModify(bench);
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
        expect(bench.editing.window?.sending).toBe(true);

        await bench.drain();
        expect(switched).toBe(true);
        expect(bench.session.date).toBe(WEDNESDAY);
        const born = bench.slow.server.allRecurrences().find((recurrence) => recurrence.id !== id)?.id ?? '';
        expect(bench.slow.server.recurrence(id)?.until).toBe(EVE);
        expect(bench.shown()).toEqual([dailyRange(born, 'Rétro')]);
        expect(bench.editing.window).toBeNull();
        expect(bench.editing.message).toBeNull();
        expect(bench.snapshot().canUndo).toBe(false);
        expect(rangesOfDay(bench, DATE)).toEqual([dailyRange(born, 'Rétro')]);
    });

    it('posée par Suppr, valide « Cette fois seulement », choisi d’avance', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        const id = daily(bench);
        bench.select([540, 555]);
        bench.press('Delete');
        await bench.drain();
        expect(bench.question()?.back).toBe(false);

        const switching = bench.switchDay(WEDNESDAY);
        await bench.drain();
        await expect(switching).resolves.toBe(true);
        expect(rangesOfDay(bench, DATE)).toEqual([]);
        expect(bench.slow.server.recurrence(id)?.until).toBeNull();
        expect(bench.shown()).toEqual([dailyRange(id)]);
        expect(bench.editing.window).toBeNull();
        expect(bench.editing.message).toBeNull();
    });

    it('les champs qui la poseraient : elle se pose, et on reste sur le jour', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        const before = writes(bench);
        await openAt(bench, NINE);
        bench.type('OPS-12', 'Rétro');

        const switching = bench.switchDay(WEDNESDAY);
        await bench.drain();
        await expect(switching).resolves.toBe(false);
        expect(bench.session.date).toBe(DATE);
        expect(bench.question()?.action.question).toBe('modify');
        expect(writes(bench)).toEqual(before);
    });

    it('rien ne la suit sur l’autre jour : son retour y laisse la journée, sans fenêtre ni message', async () => {
        // Le Daily de 09:00 à 10:00, posé en deux morceaux autour d'un quart d'heure saisi avant lui.
        const server = new FakeDayServer();
        server.changeSlots(DATE, 0, [
            { start: '09:15', end: '09:30', kind: 'work', ticket: 'SHOP-482', comment: null },
        ]);
        seedRecurrences(server, [{ ...DAILY, end: '10:00' }]);
        const bench = mountScreen({ slow: new SlowServer(server), top: 540 });
        // Ses deux morceaux, sans le quart d'heure saisi entre eux.
        bench.click(540);
        bench.click(570, { ctrlKey: true });
        bench.click(585, { ctrlKey: true });
        bench.press('Delete');
        await bench.drain();
        expect(bench.question()?.action.question).toBe('erase');

        bench.chooseScope('following');
        bench.slow.hold();
        const switching = bench.switchDay(WEDNESDAY);
        await bench.drain();
        await expect(switching).resolves.toBe(true);
        expect(bench.shown()).toEqual([]);
        expect(rangesOfDay(bench, DATE)).toEqual([['09:15', '09:30', 'work', 'SHOP-482', null]]);
        expect(bench.editing.window).toBeNull();
        expect(bench.editing.message).toBeNull();
    });
});

function rangesOfDay(bench: Bench, date: string): Range[] {
    return rangesOf(bench.slow.server.read(date).grid);
}

/** Le champ Commentaire de la fenêtre. */
function commentField(): HTMLTextAreaElement {
    const area = dialog().querySelector('textarea');
    if (area === null) {
        throw new Error("La fenêtre n'a pas de champ Commentaire.");
    }

    return area;
}

/**
 * Tape dans le champ qui a le curseur, comme le navigateur : la valeur posée sous la copie que
 * React en garde, puis l'événement de frappe.
 */
function typeInto(field: HTMLTextAreaElement | HTMLInputElement, value: string): void {
    act(() => {
        Reflect.set(Object.getPrototypeOf(field) as object, 'value', value, field);
        field.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

/** Une touche sur ce qui a le curseur. */
function key(name: string): void {
    act(() => {
        (document.activeElement ?? document.body).dispatchEvent(
            new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
        );
    });
}

/** Un bouton du pied de la fenêtre, par son libellé, cliqué. */
function footerButton(label: string): HTMLButtonElement {
    const found = [...dialog().querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.closest('.hidden') === null && button.textContent.trim() === label,
    );
    if (found === undefined) {
        throw new Error(`La fenêtre n'a pas de bouton « ${label} ».`);
    }

    return found;
}

/** Le temps que la frappe s'arrête : Jira est interrogé sur le ticket tapé. */
async function pauseTyping(bench: Bench): Promise<void> {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, LOOKUP_DELAY + 10));
    });
    await bench.settle();
}

describe('Retour rend le curseur au champ qu’on venait de quitter', () => {
    it('au clavier : Entrée dans le commentaire, Échap, et le curseur y revient, le texte gardé', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        const before = writes(bench);
        await openAt(bench, NINE);
        const window = dialog();
        expect(document.activeElement).toBe(ticketField());
        // Tab jusqu'au commentaire.
        const comment = commentField();
        act(() => {
            comment.focus();
        });
        typeInto(comment, 'Rétro');
        key('Enter');
        await bench.drain();
        expect(bench.question()?.action.question).toBe('modify');
        expect(document.activeElement).toBe(radio('once'));
        // La même fenêtre : ses champs, cachés, n'ont pas bougé.
        expect(dialog()).toBe(window);
        expect(comment.isConnected).toBe(true);

        key('Escape');
        await bench.drain();
        expect(bench.question()).toBeUndefined();
        expect(document.activeElement).toBe(comment);
        expect(comment.value).toBe('Rétro');
        expect(writes(bench)).toEqual(before);
    });

    it('à la souris : Enregistrer puis Retour, de même', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        const before = writes(bench);
        await openAt(bench, NINE);
        const comment = commentField();
        act(() => {
            comment.focus();
        });
        typeInto(comment, 'Rétro');
        press(footerButton('Enregistrer'));
        await bench.drain();
        expect(questionShown().buttons).toEqual(['Retour', 'Enregistrer']);
        expect(document.activeElement).toBe(radio('once'));

        press(footerButton('Retour'));
        await bench.drain();
        expect(bench.question()).toBeUndefined();
        expect(document.activeElement).toBe(comment);
        expect(comment.value).toBe('Rétro');
        expect(writes(bench)).toEqual(before);
    });

    it('la case décochée puis Enregistrer : Retour rend le curseur à la case', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        await openAt(bench, NINE);
        const box = checkbox();
        act(() => {
            box.focus();
        });
        press(box);
        press(footerButton('Enregistrer'));
        await bench.drain();
        expect(questionShown().title).toBe('Arrêter une récurrence');

        press(footerButton('Retour'));
        await bench.drain();
        expect(document.activeElement).toBe(box);
        expect(box.checked).toBe(false);
    });
});

describe('un bloc qui revient dont Jira ne connaît plus le ticket', () => {
    /** Le Daily, sur un ticket que Jira ne connaît plus. */
    const LOST: SlotChange = { ...DAILY, ticket: 'SHOP-999' };

    it.each([
        ['Suppr', 'once'],
        ['Suppr', 'following'],
        ['la corbeille', 'once'],
        ['la corbeille', 'following'],
        ['Effacer du menu', 'once'],
        ['Effacer du menu', 'following'],
    ] as const)('s’efface par %s, %s, sans attendre Jira, et Ctrl+Z le rend', async (gesture, choice) => {
        const bench = mountScreen({ recurrences: [LOST], top: 540 });
        const id = daily(bench);
        if (gesture === 'la corbeille') {
            await openAt(bench, NINE);
            await pauseTyping(bench);
            await bench.drain();
            // Le champ le dit, et Enregistrer reste grisé ; la corbeille, elle, efface.
            expect(dialog().textContent).toContain(TICKET_NOT_FOUND);
            press(dialog().querySelector<HTMLButtonElement>('button[aria-label="Effacer"]') ?? document.body);
        } else {
            bench.select([540, 555]);
            if (gesture === 'Suppr') {
                bench.press('Delete');
            } else {
                bench.choose('clear');
            }
        }
        await bench.drain();
        expect(bench.question()?.action.question).toBe('erase');
        // Jira a dit qu'il ne le connaît pas : la question n'en dépend pas.
        await pauseTyping(bench);
        await bench.drain();
        if (choice === 'following') {
            bench.chooseScope('following');
        }
        bench.confirm();
        await bench.drain();

        expect(bench.editing.window).toBeNull();
        expect(bench.shown()).toEqual([]);
        expect(bench.slow.ranges()).toEqual([]);
        expect(said(bench)).toBe('SHOP-999 effacé');
        expect(bench.slow.server.recurrence(id)?.until).toBe(choice === 'once' ? null : EVE);

        bench.undo();
        await bench.drain();
        expect(bench.shown()).toEqual([dailyRange(id, 'Daily', 'SHOP-999')]);
        expect(bench.shown()).toEqual(bench.slow.ranges());
        expect(bench.slow.server.recurrence(id)?.until).toBeNull();
    });

    it.each(['once', 'following'] as const)(
        's’arrête sans changer de ticket, même si Jira dit ne plus le connaître la question ouverte (%s)',
        async (choice) => {
            const bench = mountScreen({ recurrences: [LOST], top: 540 });
            const id = daily(bench);
            await openAt(bench, NINE);
            // La case décochée et Enregistrer, avant que Jira ait répondu.
            press(checkbox());
            press(footerButton('Enregistrer'));
            await bench.settle();
            expect(bench.question()?.action.question).toBe('stop');
            await pauseTyping(bench);
            await bench.drain();
            expect(bench.question()?.action.question).toBe('stop');
            if (choice === 'following') {
                bench.chooseScope('following');
            }
            bench.confirm();
            await bench.drain();

            expect(bench.editing.window).toBeNull();
            expect(bench.shown()).toEqual([['09:00', '09:30', 'work', 'SHOP-999', 'Daily']]);
            expect(bench.shown()).toEqual(bench.slow.ranges());
            expect(bench.slow.server.recurrence(id)?.until).toBe(choice === 'once' ? null : EVE);
            expect(bench.slow.server.isSkipped(id, DATE)).toBe(choice === 'once');
        },
    );
});

describe('un autre ticket, que Jira ne connaît pas, tapé dans un bloc qui revient', () => {
    it.each(['once', 'following'] as const)(
        'Entrée avant sa réponse : la question, puis Entrée rend les champs avec le refus, rien d’écrit (%s)',
        async (choice) => {
            const bench = mountScreen({ recurrences: [DAILY], top: 540 });
            const id = daily(bench);
            const before = writes(bench);
            await openAt(bench, NINE);
            bench.jira.missing.add('SHOP-998');
            bench.jira.hold();
            bench.type('SHOP-998');
            bench.enter();
            await bench.settle();
            expect(bench.question()?.action.question).toBe('modify');

            if (choice === 'following') {
                bench.chooseScope('following');
            }
            bench.enter();
            await bench.settle();
            // La réponse attend Jira.
            expect(bench.editing.window?.sending).toBe(true);
            await bench.drain();

            expect(bench.question()).toBeUndefined();
            expect(bench.editing.window?.errors.ticket).toBe(TICKET_NOT_FOUND);
            expect(dialog().textContent).toContain(TICKET_NOT_FOUND);
            expect(ticketField().value).toBe('SHOP-998');
            expect(document.activeElement).toBe(ticketField());
            expect(writes(bench)).toEqual(before);
            expect(bench.shown()).toEqual([dailyRange(id)]);
            expect(bench.slow.server.recurrence(id)?.until).toBeNull();
        },
    );

    it('sa réponse arrivée la question ouverte : Entrée rend les champs avec le refus, rien d’écrit', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        const id = daily(bench);
        const before = writes(bench);
        await openAt(bench, NINE);
        bench.jira.missing.add('SHOP-998');
        bench.jira.hold();
        bench.type('SHOP-998');
        bench.enter();
        await bench.settle();
        expect(bench.question()?.action.question).toBe('modify');
        await pauseTyping(bench);
        await bench.answer(bench.jira);
        expect(bench.question()).toBeDefined();

        bench.enter();
        await bench.drain();
        expect(bench.question()).toBeUndefined();
        expect(dialog().textContent).toContain(TICKET_NOT_FOUND);
        expect(document.activeElement).toBe(ticketField());
        expect(writes(bench)).toEqual(before);
        expect(bench.shown()).toEqual([dailyRange(id)]);
    });
});

describe('la journée relue pendant que la question est ouverte', () => {
    /** Un autre onglet a remplacé le Daily par un autre ticket, sur son second quart d'heure. */
    const OVER: SlotChange = { start: '09:15', end: '09:30', kind: 'work', ticket: 'SHOP-1', comment: null };

    it.each(['modify', 'stop'] as const)(
        'posée par les champs (%s) : ils reviennent, devenus Nouveau ticket, avec le refus, sans rien écrire par-dessus',
        async (question) => {
            const bench = mountScreen({ recurrences: [DAILY], top: 540 });
            const id = daily(bench);
            await openAt(bench, NINE);
            if (question === 'stop') {
                press(checkbox());
            } else {
                bench.type('OPS-12', 'Rétro');
            }
            bench.enter();
            await bench.drain();
            expect(bench.question()?.action.question).toBe(question);

            bench.elsewhere(OVER);
            const theirs = bench.slow.ranges();
            const before = bench.slow.server.writes.length;
            bench.comeBack();
            await bench.drain();

            expect(bench.question()).toBeUndefined();
            expect(bench.editing.window?.errors.general).toBe(STALE);
            expect(dialog().querySelector('h2')?.textContent).toBe('Nouveau ticket');
            expect(dialog().textContent).toContain('Remplace 2 tickets sur ces 30 minutes.');
            expect(bench.editing.window?.draft).toEqual({
                ticket: 'OPS-12',
                comment: question === 'stop' ? 'Daily' : 'Rétro',
            });
            expect(document.activeElement).toBe(ticketField());
            expect(bench.slow.server.writes).toHaveLength(before);
            expect(bench.slow.ranges()).toEqual(theirs);
            expect(theirs).toContainEqual(['09:15', '09:30', 'work', 'SHOP-1', null]);
            expect(bench.shown()).toEqual(theirs);
            expect(bench.slow.server.recurrence(id)?.until).toBeNull();
        },
    );

    it.each(['once', 'following'] as const)(
        'posée par Suppr (%s) : elle se ferme, le refus dit en message, sans rien écrire par-dessus',
        async (choice) => {
            const bench = mountScreen({ recurrences: [DAILY], top: 540 });
            const id = daily(bench);
            bench.select([540, 555]);
            bench.press('Delete');
            await bench.drain();
            if (choice === 'following') {
                bench.chooseScope('following');
            }

            bench.elsewhere(OVER);
            const theirs = bench.slow.ranges();
            const before = bench.slow.server.writes.length;
            bench.comeBack();
            await bench.drain();

            expect(bench.editing.window).toBeNull();
            expect(said(bench)).toBe("La journée a changé entre-temps. Rien n'a été modifié.");
            expect(bench.slow.server.writes).toHaveLength(before);
            expect(bench.slow.server.recurrence(id)?.until).toBeNull();
            expect(bench.slow.ranges()).toEqual(theirs);
            expect(theirs).toContainEqual(['09:15', '09:30', 'work', 'SHOP-1', null]);
            expect(bench.shown()).toEqual(theirs);
        },
    );

    it('posée par Suppr sur une fois en deux morceaux, l’autre morceau changé ailleurs : elle se ferme aussi', async () => {
        // Le Daily de 09:00 à 10:00, posé en deux morceaux autour d'un quart d'heure saisi avant lui.
        const server = new FakeDayServer();
        server.changeSlots(DATE, 0, [
            { start: '09:15', end: '09:30', kind: 'work', ticket: 'SHOP-482', comment: null },
        ]);
        seedRecurrences(server, [{ ...DAILY, end: '10:00' }]);
        const bench = mountScreen({ slow: new SlowServer(server), top: 540 });
        // Ses deux morceaux ; la question vise le second, où la sélection s'arrête.
        bench.click(540);
        bench.click(570, { ctrlKey: true });
        bench.click(585, { ctrlKey: true });
        bench.press('Delete');
        await bench.drain();
        expect(bench.question()?.action.question).toBe('erase');

        // Un autre onglet change le premier morceau.
        bench.elsewhere({ start: '09:00', end: '09:15', kind: 'work', ticket: 'SHOP-1', comment: null });
        const theirs = bench.slow.ranges();
        const before = bench.slow.server.writes.length;
        bench.comeBack();
        await bench.drain();

        expect(bench.editing.window).toBeNull();
        expect(said(bench)).toBe("La journée a changé entre-temps. Rien n'a été modifié.");
        expect(bench.slow.server.writes).toHaveLength(before);
        expect(bench.slow.ranges()).toEqual(theirs);
        expect(theirs[0]).toEqual(['09:00', '09:15', 'work', 'SHOP-1', null]);
        expect(bench.shown()).toEqual(theirs);
    });

    it('posée par Suppr sur un quart d’heure vide et la fois, celui-là écrit ailleurs : elle se ferme, sa saisie reste', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 525 });
        // 08:45, vide, puis le Daily en entier : la question efface aussi 08:45.
        bench.select([525, 555]);
        bench.press('Delete');
        await bench.drain();
        expect(bench.question()?.action.question).toBe('erase');

        // Un autre onglet saisit 08:45, hors du bloc que vise la question.
        bench.elsewhere({ start: '08:45', end: '09:00', kind: 'work', ticket: 'SHOP-1', comment: 'Revue' });
        const theirs = bench.slow.ranges();
        const before = bench.slow.server.writes.length;
        bench.comeBack();
        await bench.drain();

        expect(bench.editing.window).toBeNull();
        expect(said(bench)).toBe("La journée a changé entre-temps. Rien n'a été modifié.");
        expect(bench.slow.server.writes).toHaveLength(before);
        expect(bench.slow.ranges()).toEqual(theirs);
        expect(theirs[0]).toEqual(['08:45', '09:00', 'work', 'SHOP-1', 'Revue']);
        expect(bench.shown()).toEqual(theirs);
    });

    it('changée ailleurs que là où elle écrit : elle reste, et sa réponse garde ce que l’autre onglet a posé', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        await askModify(bench);
        bench.elsewhere(HOUR);
        bench.comeBack();
        await bench.drain();
        expect(bench.question()?.action.question).toBe('modify');

        bench.enter();
        await bench.drain();
        expect(bench.editing.window).toBeNull();
        expect(bench.slow.ranges()).toEqual([
            ['09:00', '09:30', 'work', 'OPS-12', 'Rétro'],
            ['14:00', '15:00', 'work', 'SHOP-482', 'Mapping'],
        ]);
        expect(bench.shown()).toEqual(bench.slow.ranges());
    });
});

/** Le faux serveur, qui refuse la prochaine écriture comme le vrai refuse une plage brisée. */
class RefusingServer extends FakeDayServer {
    refuseNext = false;

    override changeSlots(
        date: string,
        version: number,
        changes: readonly SlotChange[],
        untils: readonly UntilRewind[] = [],
        restores = false,
        detaches: readonly string[] = [],
    ): WriteResult {
        return this.refused() ?? super.changeSlots(date, version, changes, untils, restores, detaches);
    }

    override saveRecurrence(
        date: string,
        version: number,
        changes: readonly SlotChange[],
        rule: RecurrenceRule | null,
        replaces: SeenRecurrence | null,
        follows: string | null = null,
    ): RecurrenceResult {
        return this.refused() ?? super.saveRecurrence(date, version, changes, rule, replaces, follows);
    }

    private refused(): {
        readonly status: 'invalid';
        readonly violations: { field: string; message: string }[];
    } | null {
        if (!this.refuseNext) {
            return null;
        }
        this.refuseNext = false;

        return { status: 'invalid', violations: [{ field: 'changes', message: NOT_ONE_RANGE }] };
    }
}

/** Le refus du serveur qui ne tient à aucun champ (src/Recurrence/RecurrenceRefused.php). */
const NOT_ONE_RANGE = "Une récurrence couvre une seule plage, d'un seul ticket.";

describe('un refus du serveur sur la question posée par les champs', () => {
    it.each(['once', 'following'] as const)(
        'rend les champs, le refus dessous, le curseur au champ quitté, sans rien écrire (%s)',
        async (choice) => {
            const server = new RefusingServer();
            const bench = mountScreen({ recurrences: [DAILY], top: 540, slow: new SlowServer(server) });
            const id = daily(bench);
            await openAt(bench, NINE);
            const comment = commentField();
            act(() => {
                comment.focus();
            });
            typeInto(comment, 'Rétro');
            key('Enter');
            await bench.drain();
            expect(bench.question()?.action.question).toBe('modify');

            server.refuseNext = true;
            if (choice === 'following') {
                bench.chooseScope('following');
            }
            bench.enter();
            await bench.drain();

            expect(bench.question()).toBeUndefined();
            expect(bench.editing.window?.errors.general).toBe(NOT_ONE_RANGE);
            expect(dialog().textContent).toContain(NOT_ONE_RANGE);
            // Le curseur ne s'est pas perdu avec la question : il est au champ qu'on avait quitté.
            expect(document.activeElement).toBe(comment);
            expect(comment.value).toBe('Rétro');
            expect(bench.slow.ranges()).toEqual([dailyRange(id)]);
            expect(bench.slow.server.recurrence(id)?.until).toBeNull();
        },
    );
});

describe('la place de la question', () => {
    // jsdom ne lit ni les tokens ni la largeur de la colonne : chaque montage les pose.
    const TOKENS = { '--w-pop': '400px', '--w-pop-sm': '320px', '--s-2': '8px', '--s-3': '12px', '--s-4': '16px' };

    afterEach(() => {
        Object.keys(TOKENS).forEach((name) => {
            document.documentElement.style.removeProperty(name);
        });
        vi.restoreAllMocks();
    });

    /** Monte la grille, ses tokens posés, sa colonne large de 600 px, la fenêtre haute de 180 px. */
    function mountMeasured(): Bench {
        Object.entries(TOKENS).forEach(([name, value]) => {
            document.documentElement.style.setProperty(name, value);
        });
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            return this.getAttribute('role') === 'dialog' ? new DOMRect(0, 0, 320, 180) : new DOMRect();
        });
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        Object.defineProperty(bench.lane, 'clientWidth', { value: 600, configurable: true });

        return bench;
    }

    it('posée par Suppr, plus étroite : elle se centre sur le milieu de la colonne, mesurée entière', async () => {
        const bench = mountMeasured();
        bench.select([540, 555]);
        bench.press('Delete');
        await bench.drain();
        expect(dialog().classList.contains('w-pop-sm')).toBe(true);
        expect(bench.placements.length).toBeGreaterThan(0);
        const { height, rect } = bench.placements.at(-1) ?? { height: 0, rect: new DOMRect() };

        // Sans champ, la question se mesure quand même : la fenêtre entière.
        expect(height).toBe(180);
        // 320 px centrés sur le milieu de la colonne, à 300 px : la flèche y tombe.
        expect([rect.left, rect.width]).toEqual([140, 320]);
    });

    it('posée par les champs, à leur largeur : elle reste où ils étaient', async () => {
        const bench = mountMeasured();
        bench.press('ArrowDown');
        bench.press('Enter');
        await bench.drain();
        bench.type('OPS-12', 'Rétro');
        bench.enter();
        await bench.drain();
        expect(bench.question()?.back).toBe(true);
        expect(dialog().classList.contains('w-pop')).toBe(true);
        const { height, rect } = bench.placements.at(-1) ?? { height: 0, rect: new DOMRect() };

        expect(height).toBe(180);
        expect([rect.left, rect.width]).toEqual([100, 400]);
    });
});
