// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { SlotChange } from '../../../assets/grid/changes';
import { LOOKUP_DELAY } from '../../../assets/jira/useTicketLookup';
import { FakeDayServer } from '../grid/fakeDayServer';
import { weeklyRule } from '../grid/support';
import { type Bench, DATE, EVE, mountScreen, seedRecurrences, SlowServer, unmountAll } from './gridBench';

/**
 * Les blocs qui reviennent, sur la vraie grille et la vraie fenêtre de ticket : la flèche
 * que le lecteur d'écran lit, la case « Récurrence » cochée à l'ouverture, la décocher pour
 * l'arrêter, la cocher pour en créer une, ses refus, et ce que les gestes ordinaires — effacer,
 * coller — font d'une fois qui revient ; annuler rend tout.
 */

/** Le Daily, de 09:00 à 09:30, né la veille, chaque jour ouvré. */
const DAILY: SlotChange = { start: '09:00', end: '09:30', kind: 'work', ticket: 'OPS-12', comment: 'Daily' };
/** La pause du déjeuner, de 12:30 à 13:30, née la veille, chaque jour ouvré. */
const LUNCH: SlotChange = { start: '12:30', end: '13:30', kind: 'pause', ticket: null, comment: null };
const EVERY_WORKING_DAY = 'Revient chaque semaine, du lundi au vendredi';
const STALE = 'La journée a changé entre-temps. Vérifiez, puis enregistrez de nouveau.';

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

function checkbox(): HTMLInputElement {
    const box = dialog().querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (box === null) {
        throw new Error("La fenêtre n'a pas de case « Récurrence ».");
    }

    return box;
}

/** Les jours que la fenêtre propose, et ceux qui sont choisis. */
function days(): { all: string[]; pressed: string[] } {
    const buttons = [...dialog().querySelectorAll<HTMLButtonElement>('[role="group"] button')];

    return {
        all: buttons.map((button) => button.getAttribute('aria-label') ?? ''),
        pressed: buttons
            .filter((button) => button.getAttribute('aria-pressed') === 'true')
            .map((button) => button.getAttribute('aria-label') ?? ''),
    };
}

/** Un jour de la case, par son nom. */
function dayButton(name: string): HTMLButtonElement {
    const button = [...dialog().querySelectorAll<HTMLButtonElement>('[role="group"] button')].find(
        (candidate) => candidate.getAttribute('aria-label') === name,
    );
    if (button === undefined) {
        throw new Error(`Le ${name.toLowerCase()} ne se choisit pas.`);
    }

    return button;
}

function saveButton(): HTMLElement {
    const button = [...dialog().querySelectorAll<HTMLElement>('button')].find(
        (candidate) => candidate.textContent === 'Enregistrer',
    );
    if (button === undefined) {
        throw new Error("La fenêtre n'a pas de bouton « Enregistrer ».");
    }

    return button;
}

function untilField(): HTMLInputElement {
    const field = dialog().querySelector<HTMLInputElement>('input[type="date"]');
    if (field === null) {
        throw new Error("La fenêtre n'a pas de champ « Jusqu'au ».");
    }

    return field;
}

function press(element: HTMLElement): void {
    act(() => {
        element.click();
    });
}

/**
 * Une date complète tapée dans « Jusqu'au » : le champ la donne, comme le navigateur. Elle se
 * pose comme le navigateur la pose, sous la copie que React en garde : sans quoi il ne verrait
 * rien changer.
 */
function typeUntil(value: string): void {
    const field = untilField();
    act(() => {
        Reflect.set(HTMLInputElement.prototype, 'value', value, field);
        field.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

/** La teinte des prochaines fois, et leur nature : « pause », ou la teinte du ticket. */
function timesTint(): string | null {
    const times = dialog().querySelector('ol');
    if (times === null) {
        throw new Error('La fenêtre ne montre pas de prochaines fois.');
    }

    return times.classList.contains('is-pause') ? 'pause' : times.getAttribute('data-color');
}

/** Ce que la journée dit de son ticket, comme le serveur le fait en la rendant : un ticket vert. */
function knowDaily(bench: Bench): void {
    act(() => {
        bench.jira.book.learn({ 'OPS-12': { title: 'Daily', type: 'Story', color: 'vert' } });
    });
}

/** Ce que le lecteur d'écran dit du créneau de cette heure. */
function option(time: string): string {
    const label = [...document.querySelectorAll('[role="option"]')]
        .map((candidate) => candidate.textContent)
        .find((text) => text.startsWith(`${time},`));
    if (label === undefined) {
        throw new Error(`Aucun créneau à ${time}.`);
    }

    return label;
}

/** Jira a cherché le ticket tapé, passé le délai de la frappe, et répondu. */
async function lookedUp(bench: Bench): Promise<void> {
    await act(() => new Promise((resolve) => setTimeout(resolve, LOOKUP_DELAY + 50)));
    await bench.drain();
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

describe('un bloc qui revient, sur la vraie grille', () => {
    it('porte une flèche que le lecteur d’écran lit, et sa fenêtre a la case cochée, à son rythme', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        await bench.settle();

        expect(arrows()).toEqual([EVERY_WORKING_DAY]);
        await openAt(bench, 540);
        expect(checkbox().checked).toBe(true);
        expect(days()).toEqual({
            all: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'],
            pressed: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'],
        });
        // Les prochaines fois partent du lendemain ; le départ ne se dit plus.
        const times = [...dialog().querySelectorAll('ol li')].map((tile) => tile.getAttribute('aria-label'));
        expect(times).toEqual([
            'Mercredi 7 octobre',
            'Jeudi 8 octobre',
            'Vendredi 9 octobre',
            'Lundi 12 octobre',
            'Mardi 13 octobre',
        ]);
        expect(dialog().textContent).toContain('Chaque semaine, du lundi au vendredi, de\u{a0}09:00 à\u{a0}09:30.');
    });

    it('n’annonce pas dans ses prochaines fois un jour à venir déjà envoyé, où elle ne se posera pas', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540, today: EVE });
        const { server } = bench.slow;
        const thursday = '2026-10-08';
        expect(server.send(thursday, server.read(thursday).version).status).toBe('done');
        bench.comeBack();
        await bench.drain();

        await openAt(bench, 540);
        const times = [...dialog().querySelectorAll('ol li')].map((tile) => tile.getAttribute('aria-label'));
        expect(times).toEqual([
            'Mercredi 7 octobre',
            'Vendredi 9 octobre',
            'Lundi 12 octobre',
            'Mardi 13 octobre',
            'Mercredi 14 octobre',
        ]);
    });

    it('dit dans sa phrase la plage de la récurrence, même posée en deux morceaux', async () => {
        // Le Daily de 09:00 à 10:00 n'a trouvé libres que 09:00 et 09:30 à 10:00.
        const server = new FakeDayServer();
        server.changeSlots(DATE, 0, [
            { start: '09:15', end: '09:30', kind: 'work', ticket: 'SHOP-482', comment: null },
        ]);
        seedRecurrences(server, [{ ...DAILY, end: '10:00' }]);
        const bench = mountScreen({ slow: new SlowServer(server), top: 540 });
        expect(arrows()).toEqual([EVERY_WORKING_DAY, EVERY_WORKING_DAY]);
        await openAt(bench, 570);

        expect(dialog().textContent).toContain('Chaque semaine, du lundi au vendredi, de\u{a0}09:00 à\u{a0}10:00.');
    });

    it('prend la teinte du ticket tapé pour ses prochaines fois : elles changent avec lui', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        knowDaily(bench);
        bench.jira.colors.set('OPS-13', 'rouge');
        await openAt(bench, 540);
        await bench.drain();
        expect(timesTint()).toBe('vert');

        bench.type('OPS-13', 'Daily');
        await lookedUp(bench);

        expect(timesTint()).toBe('rouge');
    });

    it('dit son rythme au lecteur d’écran sur chacun de ses créneaux, comme sa flèche', async () => {
        await mountScreen({ recurrences: [DAILY, LUNCH], top: 540 }).settle();

        expect(option('09:15')).toBe('09:15, OPS-12, Daily, revient chaque semaine, du lundi au vendredi');
        expect(option('12:30')).toBe('12:30, pause, revient chaque semaine, du lundi au vendredi');
        expect(option('10:00')).toBe('10:00, vide');
    });

    it('n’a plus de flèche ni de rythme quand sa récurrence a fini avant ce jour', async () => {
        // Retirée depuis le jour où elle est née, après s'être posée ici.
        const server = new FakeDayServer();
        seedRecurrences(server, [DAILY]);
        const [daily] = server.allRecurrences();
        if (daily === undefined) {
            throw new Error("Le Daily n'est pas né.");
        }
        const stopped = server.saveRecurrence(EVE, server.read(EVE).version, [DAILY], null, {
            id: daily.id,
            weekdays: daily.weekdays,
            until: daily.until,
        });
        expect(stopped.status).toBe('saved');
        const bench = mountScreen({ slow: new SlowServer(server), top: 540 });
        await bench.settle();

        // Lue sans son lien, qui reste en base : annuler et rétablir le lui rendraient avec sa fin.
        expect(bench.shown()).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily']]);
        expect([...server.links(DATE).values()]).toEqual([daily.id, daily.id]);
        expect(arrows()).toEqual([]);
        expect(document.querySelector('li [data-state]')).toBeNull();
        expect(option('09:15')).toBe('09:15, OPS-12, Daily');
    });

    it('ferme sa fenêtre sans rien écrire quand rien n’a changé', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        await openAt(bench, 540);
        const writes = bench.slow.server.writes.length;

        bench.enter();
        await bench.drain();

        expect(bench.editing.window).toBeNull();
        expect(bench.slow.server.writes).toHaveLength(writes);
        expect(arrows()).toEqual([EVERY_WORKING_DAY]);
    });

    it('demande quelles fois arrêter, la case décochée : avec les suivantes, le bloc reste, sans flèche, et annuler la relance', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        const [daily] = bench.slow.server.allRecurrences();
        await openAt(bench, 540);

        press(checkbox());
        expect(checkbox().checked).toBe(false);
        expect(dialog().querySelector('[role="group"]')).toBeNull();
        bench.enter();
        await bench.drain();
        expect(bench.question()).toMatchObject({ action: { question: 'stop' }, choice: 'once', back: true });
        expect(bench.slow.server.recurrence(daily?.id ?? '')?.until).toBeNull();

        bench.chooseScope('following');
        bench.enter();
        await bench.drain();

        expect(bench.editing.window).toBeNull();
        expect(bench.shown()).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily']]);
        expect(arrows()).toEqual([]);
        expect(bench.slow.server.recurrence(daily?.id ?? '')?.until).toBe(EVE);

        bench.undo();
        await bench.drain();
        expect(bench.shown()).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', daily?.id]]);
        expect(arrows()).toEqual([EVERY_WORKING_DAY]);
        expect(bench.slow.server.recurrence(daily?.id ?? '')?.until).toBeNull();
    });

    it('perd sa flèche sur toute la fois quand on en efface un quart d’heure cette fois seulement, et Ctrl+Z la rend', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        const id = bench.slow.server.allRecurrences()[0]?.id;
        bench.click(555);
        bench.press('Delete');
        await bench.drain();
        // Le bas du bloc : la question « Raccourcir une récurrence », cette fois seulement choisi d'avance.
        expect(bench.question()?.action.question).toBe('shorten');
        bench.enter();
        await bench.drain();

        expect(bench.shown()).toEqual([['09:00', '09:15', 'work', 'OPS-12', 'Daily']]);
        expect(arrows()).toEqual([]);

        bench.undo();
        await bench.drain();
        expect(bench.shown()).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', id]]);
        expect(arrows()).toEqual([EVERY_WORKING_DAY]);
    });

    it('collé ailleurs, ne revient pas : copier ne garde pas la récurrence', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        const id = bench.slow.server.allRecurrences()[0]?.id;
        bench.select([540, 555]);
        bench.press('c', { ctrlKey: true });
        await bench.drain();
        bench.click(600);
        bench.press('v', { ctrlKey: true });
        await bench.drain();

        expect(bench.shown()).toEqual([
            ['09:00', '09:30', 'work', 'OPS-12', 'Daily', id],
            ['10:00', '10:30', 'work', 'OPS-12', 'Daily'],
        ]);
        expect(arrows()).toEqual([EVERY_WORKING_DAY]);
    });
});

describe('un bloc prévu d’un jour à venir, sur la vraie grille', () => {
    // Aujourd'hui est la veille : la journée du banc est à venir, et le Daily y est prévu, pas posé.

    it('porte sa flèche et se lit comme un bloc qui revient, sans être écrit', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540, today: EVE });
        await bench.settle();
        const id = bench.slow.server.allRecurrences()[0]?.id;

        expect(bench.shown()).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', id]]);
        expect(arrows()).toEqual([EVERY_WORKING_DAY]);
        expect(option('09:15')).toBe('09:15, OPS-12, Daily, revient chaque semaine, du lundi au vendredi');
        expect(bench.slow.server.saved(DATE).grid.blocks()).toEqual([]);
    });

    it('s’efface en entier par Suppr, cette fois seulement, sans rien écrire, et Ctrl+Z rend le bloc avec sa flèche', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540, today: EVE });
        const id = bench.slow.server.allRecurrences()[0]?.id ?? '';
        const writes = bench.slow.server.writes.length;
        bench.select([540, 555]);
        bench.press('Delete');
        await bench.drain();
        // La fois entière : la question, « Cette fois seulement » choisi d'avance.
        expect(bench.question()).toMatchObject({ action: { question: 'erase' }, choice: 'once', back: false });
        expect(bench.slow.server.writes).toHaveLength(writes);
        bench.enter();
        await bench.drain();

        expect(bench.slow.server.writes).toHaveLength(writes + 1);
        expect(bench.shown()).toEqual([]);
        expect(bench.slow.ranges()).toEqual([]);
        expect(arrows()).toEqual([]);
        expect(bench.slow.server.isSkipped(id, DATE)).toBe(true);

        bench.undo();
        await bench.drain();
        expect(bench.shown()).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', id]]);
        expect(arrows()).toEqual([EVERY_WORKING_DAY]);
        expect(bench.slow.server.saved(DATE).grid.blocks()).toEqual([]);
        expect(bench.slow.server.isSkipped(id, DATE)).toBe(false);
    });

    it('perd sa flèche sur toute la fois quand on colle sur une partie, et Ctrl+Z la rend', async () => {
        const bench = mountScreen({
            recurrences: [{ ...DAILY, end: '10:00' }],
            blocks: [{ start: '14:00', end: '14:15', kind: 'work', ticket: 'SHOP-482', comment: null }],
            top: 540,
            today: EVE,
        });
        const id = bench.slow.server.allRecurrences()[0]?.id ?? '';
        bench.click(840);
        bench.press('c', { ctrlKey: true });
        await bench.drain();
        bench.click(570);
        bench.press('v', { ctrlKey: true });
        await bench.drain();

        expect(bench.shown()).toEqual([
            ['09:00', '09:30', 'work', 'OPS-12', 'Daily'],
            ['09:30', '09:45', 'work', 'SHOP-482', null],
            ['09:45', '10:00', 'work', 'OPS-12', 'Daily'],
            ['14:00', '14:15', 'work', 'SHOP-482', null],
        ]);
        expect(bench.shown()).toEqual(bench.slow.ranges());
        expect(arrows()).toEqual([]);

        bench.undo();
        await bench.drain();
        expect(bench.shown()).toEqual([
            ['09:00', '10:00', 'work', 'OPS-12', 'Daily', id],
            ['14:00', '14:15', 'work', 'SHOP-482', null],
        ]);
        expect(arrows()).toEqual([EVERY_WORKING_DAY]);
        expect(bench.slow.server.isSkipped(id, DATE)).toBe(false);
    });
});

describe('une saisie d’avant la récurrence, sur un jour à venir', () => {
    it('effacée puis rendue par Ctrl+Z : la fois prévue lui cède, et garde sa flèche', async () => {
        // 09:00 est saisi à la main avant que le Daily ne naisse : il n'y prévoit que 09:15.
        const server = new FakeDayServer();
        server.changeSlots(DATE, 0, [
            { start: '09:00', end: '09:15', kind: 'work', ticket: 'SHOP-482', comment: null },
        ]);
        seedRecurrences(server, [DAILY], null);
        const bench = mountScreen({ slow: new SlowServer(server), top: 540, today: EVE });
        const id = server.allRecurrences()[0]?.id ?? '';
        const start = [
            ['09:00', '09:15', 'work', 'SHOP-482', null],
            ['09:15', '09:30', 'work', 'OPS-12', 'Daily', id],
        ];
        await bench.settle();
        expect(bench.shown()).toEqual(start);
        expect(arrows()).toEqual([EVERY_WORKING_DAY]);

        // Effacée, son quart d'heure revient au Daily, prévu en entier.
        bench.click(540);
        bench.press('Delete');
        await bench.drain();
        expect(bench.shown()).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', id]]);

        bench.undo();
        await bench.drain();
        expect(bench.shown()).toEqual(start);
        expect(bench.shown()).toEqual(bench.slow.ranges());
        expect(arrows()).toEqual([EVERY_WORKING_DAY]);
        expect(server.saved(DATE).grid.blocks()).toHaveLength(1);
        expect(server.isSkipped(id, DATE)).toBe(false);

        // Rétablir l'efface de nouveau : le Daily reprend 09:00.
        bench.undo(true);
        await bench.drain();
        expect(bench.shown()).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', id]]);
        expect(server.isSkipped(id, DATE)).toBe(false);
    });
});

describe('la case « Récurrence » de Nouveau ticket', () => {
    it('est décochée à l’ouverture, le jour du bloc choisi : cochée, le bloc revient', async () => {
        const bench = mountScreen({ top: 540 });
        await openAt(bench, 600);
        expect(checkbox().checked).toBe(false);
        expect(dialog().querySelector('[role="group"]')).toBeNull();

        bench.type('OPS-12', 'Daily');
        press(checkbox());
        expect(days().pressed).toEqual(['Mardi']);
        expect(dialog().textContent).toContain("Chaque mardi, de\u{a0}10:00 à\u{a0}10:15, à partir d'aujourd'hui.");
        bench.enter();
        await bench.drain();

        const [created] = bench.slow.server.allRecurrences();
        expect(created).toMatchObject({ start: '10:00', end: '10:15', weekdays: [2], firstDay: DATE, until: null });
        expect(bench.shown()).toEqual([['10:00', '10:15', 'work', 'OPS-12', 'Daily', created?.id]]);
        expect(arrows()).toEqual(['Revient chaque mardi']);

        // Annuler la retire : elle finit la veille de son premier jour.
        bench.undo();
        await bench.drain();
        expect(bench.shown()).toEqual([]);
        expect(bench.slow.server.recurrence(created?.id ?? '')?.until).toBe(EVE);
    });

    it('pose une pause qui revient par « Pause »', async () => {
        const bench = mountScreen({ top: 540 });
        await openAt(bench, 750);
        press(checkbox());
        const pause = [...dialog().querySelectorAll('button')].find((button) => button.textContent === 'Pause');
        if (pause === undefined) {
            throw new Error('Nouveau ticket n’a pas de bouton « Pause ».');
        }
        press(pause);
        await bench.drain();

        const id = bench.slow.server.allRecurrences()[0]?.id;
        expect(bench.shown()).toEqual([['12:30', '12:45', 'pause', null, null, id]]);
        expect(arrows()).toEqual(['Revient chaque mardi']);
    });

    it('refuse sous « Jours » une case sans jour, sans rien envoyer ni perdre ce qui est tapé', async () => {
        const bench = mountScreen({ top: 540 });
        await openAt(bench, 600);
        bench.type('OPS-12', 'Daily');
        press(checkbox());
        press(dayButton('Mardi'));
        expect(days().pressed).toEqual([]);
        const writes = bench.slow.server.writes.length;

        // « Enregistrer » est grisé, et Entrée ne fait rien, comme lui.
        expect(saveButton().getAttribute('aria-disabled')).toBe('true');
        bench.enter();
        await bench.drain();
        expect(bench.slow.server.writes).toHaveLength(writes);
        expect(bench.editing.window?.errors.weekdays).toBeNull();

        // Le clic à côté, qui enregistre d'habitude, dit pourquoi la fenêtre reste ouverte.
        bench.click(900);
        await bench.drain();
        expect(bench.slow.server.writes).toHaveLength(writes);
        expect(bench.editing.window?.draft).toEqual({ ticket: 'OPS-12', comment: 'Daily' });
        expect(bench.editing.window?.errors.weekdays).toBe('Choisissez au moins un jour.');
        expect(dialog().textContent).toContain('Choisissez au moins un jour.');
    });

    it('ne s’enregistre pas sur une pause sans ticket à laquelle on tape un commentaire, case cochée ou non', async () => {
        const bench = mountScreen({
            blocks: [{ start: '11:00', end: '11:30', kind: 'pause', ticket: null, comment: null }],
            top: 540,
        });
        await openAt(bench, 660);
        const writes = bench.slow.server.writes.length;

        bench.type('', 'Revue');
        expect(saveButton().getAttribute('aria-disabled')).toBe('true');
        press(checkbox());
        expect(checkbox().checked).toBe(true);
        expect(saveButton().getAttribute('aria-disabled')).toBe('true');
        bench.enter();
        await bench.drain();
        expect(bench.slow.server.writes).toHaveLength(writes);
        expect(bench.editing.window?.errors.ticket).toBeNull();

        // Sans commentaire, sa case cochée s'enregistre : la pause revient.
        bench.type('', '');
        expect(saveButton().getAttribute('aria-disabled')).toBeNull();
        bench.enter();
        await bench.drain();
        const id = bench.slow.server.allRecurrences()[0]?.id;
        expect(bench.shown()).toEqual([['11:00', '11:30', 'pause', null, null, id]]);
    });

    it('refuse sous « Jusqu’au » une date commencée, jamais lue comme « sans fin »', async () => {
        const bench = mountScreen({ top: 540 });
        await openAt(bench, 600);
        bench.type('OPS-12', 'Daily');
        press(checkbox());
        bench.adjustRecurrence({ on: true, weekdays: [2], until: '', incomplete: true });
        const writes = bench.slow.server.writes.length;

        bench.enter();
        await bench.drain();

        expect(bench.slow.server.writes).toHaveLength(writes);
        expect(bench.editing.window?.errors.until).toBe('Complétez la date.');
        expect(untilField().getAttribute('type')).toBe('date');
        expect(untilField().getAttribute('min')).toBe(DATE);

        // Vidé, le champ n'a plus rien à compléter : le refus part, et la fenêtre s'enregistre
        // sans fin.
        bench.adjustRecurrence({ until: '', incomplete: false });
        expect(bench.editing.window?.errors.until).toBeNull();
        bench.enter();
        await bench.drain();
        expect(bench.editing.window).toBeNull();
        expect(bench.slow.server.allRecurrences()[0]?.until).toBeNull();
    });
});

describe('un bloc qui revient d’un jour passé', () => {
    /** Le lendemain : la journée du banc est passée, et sa récurrence change à partir de demain. */
    const tomorrow = '2026-10-07';

    it('garde sa case, cochée à son rythme, et sa flèche quand on enregistre sans rien changer', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540, today: tomorrow });
        await openAt(bench, 540);
        expect(checkbox().checked).toBe(true);
        expect(days().pressed).toEqual(['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi']);
        const writes = bench.slow.server.writes.length;

        bench.enter();
        await bench.drain();

        expect(bench.editing.window).toBeNull();
        expect(bench.slow.server.writes).toHaveLength(writes);
        expect(arrows()).toEqual([EVERY_WORKING_DAY]);
    });

    it('ne change que cette fois quand on en change le ticket : la récurrence continue', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540, today: tomorrow });
        const id = bench.slow.server.allRecurrences()[0]?.id ?? '';
        await openAt(bench, 540);

        bench.type('OPS-13', 'Daily');
        bench.enter();
        await bench.drain();

        expect(bench.shown()).toEqual([['09:00', '09:30', 'work', 'OPS-13', 'Daily']]);
        expect(bench.slow.server.recurrence(id)?.until).toBeNull();
        expect(bench.slow.server.isSkipped(id, DATE)).toBe(true);
    });

    it('garde à ses prochaines fois la teinte de la récurrence quand on en change le ticket', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540, today: tomorrow });
        knowDaily(bench);
        bench.jira.colors.set('OPS-13', 'rouge');
        await openAt(bench, 540);
        await bench.drain();
        expect(timesTint()).toBe('vert');

        // Seule cette fois change de ticket : les suivantes restent le Daily.
        bench.type('OPS-13', 'Daily');
        await lookedUp(bench);
        expect(bench.jira.book.current().get('OPS-13')?.color).toBe('rouge');
        expect(timesTint()).toBe('vert');
    });

    it('garde à une pause qui revient la teinte de la pause quand on y tape un ticket', async () => {
        const bench = mountScreen({ recurrences: [LUNCH], top: 690, today: tomorrow });
        await openAt(bench, 750);
        expect(timesTint()).toBe('pause');

        bench.type('OPS-13');
        await lookedUp(bench);
        expect(timesTint()).toBe('pause');
    });

    it('change son rythme à partir de demain : la fois passée reste la sienne, et Ctrl+Z défait tout', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540, today: tomorrow });
        const id = bench.slow.server.allRecurrences()[0]?.id ?? '';
        await openAt(bench, 540);
        expect(dialog().textContent).not.toContain('à partir de demain');
        bench.adjustRecurrence({ on: true, weekdays: [1], until: '' });
        expect(dialog().textContent).toContain('Chaque lundi, de\u{a0}09:00 à\u{a0}09:30, à partir de demain.');
        expect(untilField().getAttribute('min')).toBe('2026-10-08');

        bench.enter();
        await bench.drain();

        expect(bench.editing.window).toBeNull();
        expect(bench.shown()).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', id]]);
        expect(arrows()).toEqual([EVERY_WORKING_DAY]);
        expect(bench.slow.server.recurrence(id)?.until).toBe(tomorrow);
        const created = bench.slow.server.allRecurrences().find((recurrence) => recurrence.id !== id);
        expect(created).toMatchObject({ firstDay: '2026-10-08', until: null });

        bench.undo();
        await bench.drain();
        expect(bench.slow.server.recurrence(id)?.until).toBeNull();
        expect(bench.slow.server.recurrence(created?.id ?? '')?.until).toBe('2026-10-07');
    });

    it('s’arrête après aujourd’hui, la case décochée : le bloc reste, sans flèche', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540, today: tomorrow });
        const id = bench.slow.server.allRecurrences()[0]?.id ?? '';
        await openAt(bench, 540);

        press(checkbox());
        bench.enter();
        await bench.drain();

        expect(bench.shown()).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily']]);
        expect(arrows()).toEqual([]);
        expect(bench.slow.server.recurrence(id)?.until).toBe(tomorrow);

        bench.undo();
        await bench.drain();
        expect(arrows()).toEqual([EVERY_WORKING_DAY]);
        expect(bench.slow.server.recurrence(id)?.until).toBeNull();
    });
});

describe('deux fenêtres sur une même récurrence', () => {
    it('refusée parce qu’elle a changé ailleurs, reprend la fin posée ailleurs, et l’enregistrement suivant la garde', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: 540 });
        const { server } = bench.slow;
        const daily = server.allRecurrences()[0];
        if (daily === undefined) {
            throw new Error("Le Daily n'est pas né.");
        }
        await openAt(bench, 540);
        press(dayButton('Vendredi'));
        expect(days().pressed).toEqual(['Lundi', 'Mardi', 'Mercredi', 'Jeudi']);
        expect(untilField().value).toBe('');

        // Un autre onglet, depuis la fois de la veille, donne une fin au Daily.
        const elsewhere = server.saveRecurrence(
            EVE,
            server.read(EVE).version,
            [DAILY],
            weeklyRule([1, 2, 3, 4, 5], '2026-11-04'),
            { id: daily.id, weekdays: daily.weekdays, until: null },
        );
        expect(elsewhere.status).toBe('saved');
        const writes = server.writes.length;

        bench.enter();
        await bench.drain();
        expect(server.writes).toHaveLength(writes);
        expect(bench.editing.window?.errors.general).toBe(STALE);
        // Ce qu'on n'a pas touché suit la récurrence à jour ; le vendredi relâché reste relâché.
        expect(untilField().value).toBe('2026-11-04');
        expect(days().pressed).toEqual(['Lundi', 'Mardi', 'Mercredi', 'Jeudi']);
        expect(dialog().textContent).toContain(
            "Chaque semaine, du lundi au jeudi, de\u{a0}09:00 à\u{a0}09:30, jusqu'au mercredi 4 novembre.",
        );

        bench.enter();
        await bench.drain();
        expect(bench.editing.window).toBeNull();
        expect(server.recurrence(daily.id)?.until).toBe(EVE);
        const created = server.allRecurrences().find((recurrence) => recurrence.id !== daily.id);
        expect(created).toMatchObject({ weekdays: [1, 2, 3, 4], firstDay: DATE, until: '2026-11-04' });
        expect(bench.shown()).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', created?.id]]);

        // Annuler rend le Daily tel que l'autre onglet l'a laissé.
        bench.undo();
        await bench.drain();
        expect(server.recurrence(daily.id)?.until).toBe('2026-11-04');
    });
});

describe('un bloc qui revient dont un jour a été décoché depuis dans les réglages', () => {
    /** Le Daily, du lundi au vendredi ; le mercredi décoché ensuite, depuis un autre onglet. */
    function mountWithoutWednesday(): Bench {
        const server = new FakeDayServer();
        seedRecurrences(server, [DAILY]);
        server.setWorkingDays([1, 2, 4, 5]);

        return mountScreen({ slow: new SlowServer(server), top: 540 });
    }

    it('ne montre pas le mercredi, et le garde à la récurrence tant qu’on ne touche pas aux jours', async () => {
        const bench = mountWithoutWednesday();
        const id = bench.slow.server.allRecurrences()[0]?.id ?? '';
        await openAt(bench, 540);
        expect(days()).toEqual({
            all: ['Lundi', 'Mardi', 'Jeudi', 'Vendredi'],
            pressed: ['Lundi', 'Mardi', 'Jeudi', 'Vendredi'],
        });

        typeUntil('2026-11-04');
        bench.enter();
        await bench.drain();

        expect(bench.editing.window).toBeNull();
        expect(bench.slow.server.recurrence(id)).toMatchObject({ weekdays: [1, 2, 3, 4, 5], until: '2026-11-04' });
        expect(bench.slow.server.allRecurrences()).toHaveLength(1);
    });

    it('grise « Enregistrer » quand on relâche les jours montrés : le mercredi caché ne suffit pas', async () => {
        const bench = mountWithoutWednesday();
        await openAt(bench, 540);
        for (const name of ['Lundi', 'Mardi', 'Jeudi', 'Vendredi']) {
            press(dayButton(name));
        }
        expect(days().pressed).toEqual([]);
        expect(dialog().textContent).toContain('Ne revient plus.');
        // Aucune phrase du rythme, « Chaque semaine, …, de 09:00 à 09:30. » : rien ne revient.
        expect(dialog().textContent).not.toMatch(/09:30[.,]/);
        const writes = bench.slow.server.writes.length;

        expect(saveButton().getAttribute('aria-disabled')).toBe('true');
        bench.enter();
        await bench.drain();
        expect(bench.slow.server.writes).toHaveLength(writes);

        bench.click(900);
        await bench.drain();
        expect(bench.slow.server.writes).toHaveLength(writes);
        expect(bench.editing.window?.errors.weekdays).toBe('Choisissez au moins un jour.');
        expect(dialog().textContent).toContain('Choisissez au moins un jour.');
    });

    it('enregistre le mardi seul quand on ne garde que lui : le mercredi caché sort au premier jour relâché', async () => {
        const bench = mountWithoutWednesday();
        const id = bench.slow.server.allRecurrences()[0]?.id ?? '';
        await openAt(bench, 540);
        for (const name of ['Lundi', 'Jeudi', 'Vendredi']) {
            press(dayButton(name));
        }
        expect(days().pressed).toEqual(['Mardi']);
        expect(dialog().textContent).toContain('Chaque mardi, de\u{a0}09:00 à\u{a0}09:30.');

        bench.enter();
        await bench.drain();

        expect(bench.editing.window).toBeNull();
        expect(bench.slow.server.recurrence(id)?.until).toBe(EVE);
        const created = bench.slow.server.allRecurrences().find((recurrence) => recurrence.id !== id);
        expect(created).toMatchObject({ weekdays: [2], firstDay: DATE, until: null });
        expect(arrows()).toEqual(['Revient chaque mardi']);
    });
});

describe('un créneau qu’une autre récurrence prend déjà', () => {
    /** Les guillemets tenus à leur nom. */
    const quoted = (name: string) => `«\u{a0}${name}\u{a0}»`;
    const RETRO: SlotChange = { start: '14:00', end: '15:00', kind: 'work', ticket: 'OPS-7', comment: 'Rétrospective' };
    const RIVAL: SlotChange = { ...RETRO, comment: 'Rival' };

    /** Un autre onglet crée, ce jour-là, une récurrence sur le créneau de 14:00. */
    function createdElsewhere(server: FakeDayServer, date: string, change: SlotChange, everyWeeks = 1): string {
        const result = server.saveRecurrence(
            date,
            server.read(date).version,
            [change],
            weeklyRule([2], null, everyWeeks),
            null,
        );
        const id = server.allRecurrences().at(-1)?.id;
        if (result.status !== 'saved' || id === undefined) {
            throw new Error(`L'autre onglet n'a rien créé : ${JSON.stringify(result)}.`);
        }

        return id;
    }

    /** Les prochaines fois, telles que le lecteur d'écran les lit, et ce que chaque tuile écrit. */
    function tiles(): { label: string | null; shown: string }[] {
        return [...dialog().querySelectorAll('ol li')].map((tile) => ({
            label: tile.getAttribute('aria-label'),
            shown: tile.textContent,
        }));
    }

    function alert(): string | null {
        return dialog().querySelector('[role="alert"]')?.textContent ?? null;
    }

    function alternateButton(): HTMLButtonElement | undefined {
        return [...dialog().querySelectorAll<HTMLButtonElement>('button')].find((button) =>
            button.textContent.startsWith('Alterner avec'),
        );
    }

    /**
     * Nouveau ticket sur 14:00, la démo tapée, la case cochée : chaque mardi de 14:00 à 14:15, à
     * partir d'aujourd'hui.
     */
    async function demoAt(bench: Bench): Promise<void> {
        await openAt(bench, 840);
        bench.type('OPS-9', 'Démo');
        press(checkbox());
        await bench.settle();
    }

    it('lit une fin d’avant le premier jour accepté telle qu’elle est tapée : aucune prochaine fois, rien de pris', async () => {
        const server = new FakeDayServer();
        createdElsewhere(server, '2026-10-13', RETRO);
        const bench = mountScreen({ slow: new SlowServer(server), top: 780 });
        await demoAt(bench);
        expect(tiles()[0]?.shown).toBe('13\u{a0}oct.Pris');

        // La veille du bloc : la phrase, les prochaines fois et le créneau pris lisent la même
        // date — aucune fois, donc rien ne se montre « sans fin » sur le créneau de l'autre.
        typeUntil('2026-10-05');
        await bench.settle();
        expect(dialog().querySelector('ol')).toBeNull();
        expect(dialog().textContent).toContain('Ne revient plus.');
        expect(alert()).toBeNull();
        expect(dialog().textContent).toContain(
            "Chaque mardi, de\u{a0}14:00 à\u{a0}14:15, d'aujourd'hui au lundi 5 octobre.",
        );

        // Enregistrer le refuse sous le champ, et rien ne part.
        const writes = bench.slow.server.writes.length;
        bench.enter();
        await bench.drain();
        expect(bench.slow.server.writes).toHaveLength(writes);
        expect(bench.editing.window?.errors.until).toBe('Choisissez un jour à partir du mardi 6 octobre.');
    });

    it('une date commencée garde « Pris », mais Enregistrer dit d’abord « Complétez la date. »', async () => {
        const server = new FakeDayServer();
        createdElsewhere(server, '2026-10-13', RETRO);
        const bench = mountScreen({ slow: new SlowServer(server), top: 780 });
        await demoAt(bench);
        expect(saveButton().getAttribute('aria-disabled')).toBe('true');

        bench.adjustRecurrence({ until: '', incomplete: true });
        await bench.settle();
        expect(tiles()[0]?.shown).toBe('13\u{a0}oct.Pris');
        expect(saveButton().getAttribute('aria-disabled')).toBeNull();
        const writes = bench.slow.server.writes.length;
        bench.enter();
        await bench.drain();
        expect(bench.slow.server.writes).toHaveLength(writes);
        expect(bench.editing.window?.errors.until).toBe('Complétez la date.');
    });

    it('le dit sous les prochaines fois, marque « Pris » chacune, grise Enregistrer, et n’enregistre rien, ni à Entrée répétée ni au clic à côté', async () => {
        const server = new FakeDayServer();
        createdElsewhere(server, '2026-10-13', RETRO, 2);
        const bench = mountScreen({ slow: new SlowServer(server), top: 780 });
        await demoAt(bench);

        expect(alert()).toBe(
            `Un mardi sur deux, ce créneau est déjà pris par la récurrence ${quoted('Rétrospective')}.Alterner avec ${quoted('Rétrospective')}`,
        );
        // Le rythme, qui le lève, désigne le refus.
        const rhythm = dialog().querySelector('[role="radiogroup"][aria-label="Rythme"]');
        expect(document.getElementById(rhythm?.getAttribute('aria-describedby') ?? '')?.textContent).toBe(alert());
        expect(tiles().slice(0, 3)).toEqual([
            { label: 'Mardi 13 octobre, déjà pris par Rétrospective', shown: '13\u{a0}oct.Pris' },
            { label: 'Mardi 20 octobre', shown: '20\u{a0}oct.mar.' },
            { label: 'Mardi 27 octobre, déjà pris par Rétrospective', shown: '27\u{a0}oct.Pris' },
        ]);
        const requests = bench.slow.requests.length;

        bench.enter();
        await bench.drain();
        bench.enter();
        await bench.drain();

        // « Enregistrer » est grisé : Entrée ne fait rien, comme sans jour choisi.
        expect(bench.slow.requests).toHaveLength(requests);
        expect(bench.editing.window?.draft).toEqual({ ticket: 'OPS-9', comment: 'Démo' });
        expect(dialog().querySelector('button[aria-disabled="true"]')?.textContent).toBe('Enregistrer');

        // Le clic à côté garde la fenêtre, et pose le curseur sur le lien qui libère le créneau.
        bench.click(900);
        await bench.drain();

        expect(bench.slow.requests).toHaveLength(requests);
        expect(bench.editing.window?.errors.rhythm).toBe(
            `Un mardi sur deux, ce créneau est déjà pris par la récurrence ${quoted('Rétrospective')}.`,
        );
        expect(document.activeElement).toBe(alternateButton());
        expect(server.allRecurrences()).toHaveLength(1);
    });

    it('tait un jour envoyé, même qu’une autre y prendrait, sans le compter pris, et garde la semaine sans d’un jour envoyé', async () => {
        const server = new FakeDayServer();
        server.setToday(EVE);
        createdElsewhere(server, '2026-10-13', RETRO, 2);
        // Envoyés d'avance : le 13, où la rétrospective tombe, et le 20, une semaine sans elle.
        for (const sent of ['2026-10-13', '2026-10-20']) {
            const hour: SlotChange = { start: '09:00', end: '09:15', kind: 'work', ticket: 'SHOP-482', comment: null };
            server.changeSlots(sent, server.read(sent).version, [hour]);
            expect(server.send(sent, server.read(sent).version).status).toBe('done');
        }
        const bench = mountScreen({ slow: new SlowServer(server), top: 780, today: EVE });
        await demoAt(bench);

        expect(
            tiles()
                .slice(0, 3)
                .map((tile) => tile.label),
        ).toEqual([
            'Mardi 27 octobre, déjà pris par Rétrospective',
            'Mardi 3 novembre',
            'Mardi 10 novembre, déjà pris par Rétrospective',
        ]);

        // Une semaine sur deux, depuis celle du bloc : le 13 est une semaine sans, et le 20,
        // envoyé, ne la recevra pas.
        press(alternateButton() ?? dialog());
        expect(
            tiles()
                .slice(0, 3)
                .map((tile) => tile.label),
        ).toEqual(['Mardi 13 octobre, rien ce jour-là', 'Mardi 27 octobre, rien ce jour-là', 'Mardi 3 novembre']);
    });

    it('enregistre une récurrence dont la seule fois en commun avec une autre tombe sur un jour envoyé', async () => {
        const server = new FakeDayServer();
        server.setToday(EVE);
        // La rétrospective du mardi 13 seulement, envoyé d'avance : elle n'y prend plus rien.
        expect(
            server.saveRecurrence(
                '2026-10-13',
                server.read('2026-10-13').version,
                [RETRO],
                weeklyRule([2], '2026-10-13'),
                null,
            ).status,
        ).toBe('saved');
        expect(server.send('2026-10-13', server.read('2026-10-13').version).status).toBe('done');
        const bench = mountScreen({ slow: new SlowServer(server), top: 780, today: EVE });
        await demoAt(bench);

        expect(alert()).toBeNull();
        expect(saveButton().getAttribute('aria-disabled')).toBeNull();
        expect(tiles()[0]?.label).toBe('Mardi 20 octobre');
        bench.enter();
        await bench.drain();

        expect(bench.editing.window).toBeNull();
        const demo = server.allRecurrences().at(-1)?.id;
        expect(server.allRecurrences()).toHaveLength(2);
        expect(bench.slow.ranges()).toEqual([['14:00', '14:15', 'work', 'OPS-9', 'Démo', demo]]);
    });

    it('alterne avec l’autre : une semaine sur deux, les semaines libres, et la fenêtre le dit', async () => {
        const server = new FakeDayServer();
        const retro = createdElsewhere(server, '2026-10-13', RETRO, 2);
        const bench = mountScreen({ slow: new SlowServer(server), top: 780 });
        await demoAt(bench);

        const link = alternateButton();
        expect(link).toBeDefined();
        press(link ?? dialog());

        expect(bench.editing.windowRecurrence).toMatchObject({ on: true, pace: 'every', everyWeeks: 2, weekdays: [2] });
        expect(alert()).toBeNull();
        // Le lien parti avec le refus, le curseur passe à la carte qu'il a choisie.
        const card = document.activeElement;
        expect(card instanceof HTMLInputElement && card.type === 'radio' && card.checked).toBe(true);
        expect(card?.closest('label')?.textContent).toBe('Une semaine sur 2');
        expect(dialog().textContent).toContain(
            `Un mardi sur deux, de\u{a0}14:00 à\u{a0}14:15, à partir d'aujourd'hui.`,
        );
        expect(dialog().textContent).toContain(
            `En alternance avec ${quoted('Rétrospective')}, qui revient les autres mardis.`,
        );
        expect(tiles().slice(0, 2)).toEqual([
            { label: 'Mardi 13 octobre, rien ce jour-là', shown: '13\u{a0}oct.mar.' },
            { label: 'Mardi 20 octobre', shown: '20\u{a0}oct.mar.' },
        ]);

        bench.enter();
        await bench.drain();

        expect(bench.editing.window).toBeNull();
        const demo = server.allRecurrences().find((recurrence) => recurrence.id !== retro);
        expect(demo).toMatchObject({ weekdays: [2], everyWeeks: 2, firstDay: DATE, until: null });
        expect(bench.shown()).toEqual([['14:00', '14:15', 'work', 'OPS-9', 'Démo', demo?.id]]);
        expect(arrows()).toEqual(['Revient un mardi sur deux']);

        // La fenêtre de l'une dit aussi l'alternance avec l'autre.
        await openAt(bench, 840);
        expect(dialog().textContent).toContain(
            `En alternance avec ${quoted('Rétrospective')}, qui revient les autres mardis.`,
        );
        bench.escape();
        await bench.drain();

        // Annuler défait l'alternance : la démo est retirée.
        bench.undo();
        await bench.drain();
        expect(server.recurrence(demo?.id ?? '')?.until).toBe(EVE);
        expect(bench.shown()).toEqual([]);
    });

    it('refusé par le serveur — l’autre est née ailleurs, fenêtre ouverte —, garde la fenêtre, sa saisie et le refus, et relit la journée', async () => {
        const server = new FakeDayServer();
        const bench = mountScreen({ slow: new SlowServer(server), top: 780 });
        await demoAt(bench);
        expect(alert()).toBeNull();
        const draft = bench.editing.windowRecurrence;
        // Un autre onglet, mardi prochain, prend le créneau de chaque mardi.
        const rival = createdElsewhere(server, '2026-10-13', RIVAL);
        const requests = bench.slow.requests.length;

        bench.enter();
        await bench.drain();

        // Une seule écriture partie, refusée, et la journée relue.
        expect(bench.slow.requests.slice(requests).map((request) => request.kind)).toEqual(['saveRecurrence', 'read']);
        expect(bench.editing.window).not.toBeNull();
        expect(bench.editing.window?.draft).toEqual({ ticket: 'OPS-9', comment: 'Démo' });
        expect(bench.editing.windowRecurrence).toEqual(draft);
        expect(bench.editing.window?.errors.rhythm).toBe(
            'Ce créneau est déjà pris par la récurrence «\u{a0}Rival\u{a0}».',
        );
        expect(bench.snapshot().day.ongoing.has(rival)).toBe(true);
        // La fenêtre la connaît désormais : elle dit le refus avec son rythme, ses fois prises, sans lien.
        expect(alert()).toBe(`Chaque mardi, ce créneau est déjà pris par la récurrence ${quoted('Rival')}.`);
        expect(tiles()[0]).toEqual({ label: 'Mardi 13 octobre, déjà pris par Rival', shown: '13\u{a0}oct.Pris' });
        expect(alternateButton()).toBeUndefined();

        // Entrée répétée : rien ne part.
        bench.enter();
        await bench.drain();
        bench.enter();
        await bench.drain();
        expect(bench.slow.requests.slice(requests).map((request) => request.kind)).toEqual(['saveRecurrence', 'read']);

        // Échap la ferme sans rien écrire.
        bench.escape();
        await bench.drain();
        expect(bench.editing.window).toBeNull();
        expect(bench.shown()).toEqual([]);
        expect(server.allRecurrences().map((recurrence) => recurrence.id)).toEqual([rival]);
    });

    it('un jour à venir, refusé par le serveur de même, sans rien poser ni rien laisser à annuler', async () => {
        const server = new FakeDayServer();
        const bench = mountScreen({ slow: new SlowServer(server), top: 780, today: EVE });
        await demoAt(bench);
        createdElsewhere(server, '2026-10-13', RIVAL);

        bench.enter();
        await bench.drain();

        expect(bench.editing.window?.errors.rhythm).toBe(
            'Ce créneau est déjà pris par la récurrence «\u{a0}Rival\u{a0}».',
        );
        bench.escape();
        await bench.drain();
        expect(bench.shown()).toEqual([]);
        expect(bench.snapshot().canUndo).toBe(false);
    });

    it('n’annule pas un arrêt qui ramènerait la récurrence sur un créneau pris depuis ailleurs', async () => {
        const server = new FakeDayServer();
        const bench = mountScreen({ slow: new SlowServer(server), top: 780 });
        await demoAt(bench);
        bench.enter();
        await bench.drain();
        const demo = server.allRecurrences()[0]?.id ?? '';

        // Décochée, avec les suivantes : née aujourd'hui, elle est retirée, le bloc gardé sans elle.
        await openAt(bench, 840);
        press(checkbox());
        bench.enter();
        await bench.drain();
        expect(bench.question()?.action.question).toBe('stop');
        bench.chooseScope('following');
        bench.confirm();
        await bench.drain();
        expect(server.recurrence(demo)?.until).toBe(EVE);
        expect(bench.shown()).toEqual([['14:00', '14:15', 'work', 'OPS-9', 'Démo']]);
        // Un autre onglet prend son créneau, mardi prochain.
        createdElsewhere(server, '2026-10-13', RIVAL);

        bench.undo();
        await bench.drain();
        expect(bench.editing.message?.content).toBe("Ces créneaux ont changé entre-temps. Rien n'est annulé.");
        expect(server.recurrence(demo)?.until).toBe(EVE);
        expect(bench.shown()).toEqual([['14:00', '14:15', 'work', 'OPS-9', 'Démo']]);
        expect(bench.snapshot().canUndo).toBe(false);
    });

    it('ne rétablit pas une création qui ramènerait la récurrence sur un créneau pris depuis ailleurs', async () => {
        const server = new FakeDayServer();
        const bench = mountScreen({ slow: new SlowServer(server), top: 780 });
        await demoAt(bench);
        bench.enter();
        await bench.drain();
        const demo = server.allRecurrences()[0]?.id ?? '';
        expect(bench.shown()).toEqual([['14:00', '14:15', 'work', 'OPS-9', 'Démo', demo]]);

        // Annulée, elle est retirée ; un autre onglet prend son créneau.
        bench.undo();
        await bench.drain();
        expect(server.recurrence(demo)?.until).toBe(EVE);
        createdElsewhere(server, '2026-10-13', RIVAL);

        bench.undo(true);
        await bench.drain();
        expect(bench.editing.message?.content).toBe("Ces créneaux ont changé entre-temps. Rien n'est rétabli.");
        expect(server.recurrence(demo)?.until).toBe(EVE);
        expect(bench.shown()).toEqual([]);
        expect(bench.snapshot().canRedo).toBe(false);
    });
});
