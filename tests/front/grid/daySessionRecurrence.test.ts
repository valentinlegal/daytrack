import { describe, expect, it } from 'vitest';

import { fill, type SlotChange } from '../../../assets/grid/changes';
import { type DayApi, DaySession, type TabMemory, tabMemory } from '../../../assets/grid/daySession';
import { PAUSE, unlinked, work } from '../../../assets/grid/grid';
import type { UntilRewind } from '../../../assets/grid/history';
import * as Quarter from '../../../assets/grid/quarter';
import {
    LAST_WEEK,
    monthlyDate,
    monthlyWeekday,
    type RecurrenceRule,
    type SeenRecurrence,
    weekly,
} from '../../../assets/grid/recurrence';
import { selectQuarters } from '../../../assets/grid/selection';
import { FakeDayServer, type Request, type Transport } from './fakeDayServer';
import { memoryStorage, minutes, type Range, rangesOf, weeklyRule } from './support';

/**
 * Une journée où revient le Daily : un geste ordinaire qui lui prend un quart d'heure
 * détache la fois entière, et annuler la lui rend ; la fenêtre crée, coupe ou arrête la
 * récurrence, et annuler rend les fins d'avant — le tout contre le faux serveur, aussi strict
 * que le vrai, deux onglets compris.
 */

/** Le lundi où le Daily est né, et le mardi où il revient. */
const MONDAY = '2026-10-05';
const TODAY = '2026-10-06';
const WEDNESDAY = '2026-10-07';
const WEEK = [1, 2, 3, 4, 5];
const nine = minutes('09:00');
const quarterPast = minutes('09:15');
const DAILY_QUARTERS = [nine, quarterPast];
const DAILY: SlotChange = { start: '09:00', end: '09:30', kind: 'work', ticket: 'OPS-12', comment: 'Daily' };

/** Le Daily, né lundi, chaque jour ouvré, posé ce mardi : son identifiant. */
function dailyOn(server: FakeDayServer): string {
    const created = server.saveRecurrence(MONDAY, server.read(MONDAY).version, [DAILY], weeklyRule(WEEK), null);
    if (created.status !== 'saved') {
        throw new Error(`Le Daily n'est pas né : ${JSON.stringify(created)}.`);
    }
    server.pose(TODAY);
    const id = server.allRecurrences()[0]?.id;
    if (id === undefined) {
        throw new Error("Le Daily n'existe pas.");
    }

    return id;
}

/** Ce qu'une fenêtre ouverte maintenant voit d'une récurrence du serveur : ses jours et sa fin. */
function seen(server: FakeDayServer, id: string): SeenRecurrence {
    const recurrence = server.recurrence(id);
    if (recurrence === undefined) {
        throw new Error(`La récurrence ${id} n'existe pas.`);
    }

    return { id, weekdays: recurrence.weekdays, until: recurrence.until };
}

function open(server: FakeDayServer, api: DayApi = server.api(), memory: TabMemory = tabMemory(memoryStorage())) {
    return new DaySession(server.read(TODAY), api, memory);
}

/** Une écriture de créneaux telle qu'elle part : ses créneaux, les fins qu'elle rend, et si elle annule. */
interface Sent {
    readonly changes: readonly SlotChange[];
    readonly untils: readonly UntilRewind[] | undefined;
    readonly restores: boolean | undefined;
    readonly detaches?: readonly string[] | undefined;
}

/** Les écritures de créneaux telles qu'elles partent. */
function spied(server: FakeDayServer): { api: DayApi; sent: Sent[] } {
    const api = server.api();
    const sent: Sent[] = [];

    return {
        sent,
        api: {
            ...api,
            changeSlots: (date, version, changes, untils, restores, detaches) => {
                sent.push(
                    detaches === undefined ? { changes, untils, restores } : { changes, untils, restores, detaches },
                );

                return api.changeSlots(date, version, changes, untils, restores, detaches);
            },
        },
    };
}

describe('DaySession, un geste sur un bloc qui revient', () => {
    it('montre le bloc posé par la récurrence, avec elle', () => {
        const server = new FakeDayServer();
        const id = dailyOn(server);
        const session = open(server);

        expect(rangesOf(session.current().day.grid)).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', id]]);
        expect(session.current().day.recurrences.get(id)).toMatchObject({ firstDay: MONDAY, until: null });
    });

    it('détache la fois entière en effaçant un quart d’heure, et annuler la lui rend entière', async () => {
        const server = new FakeDayServer();
        const id = dailyOn(server);
        const { api, sent } = spied(server);
        const session = open(server, api);
        const before = session.current().day.grid;

        await expect(session.apply(fill([quarterPast], null))).resolves.toMatchObject({ kind: 'saved' });
        expect(rangesOf(session.current().day.grid)).toEqual([['09:00', '09:15', 'work', 'OPS-12', 'Daily']]);
        expect(server.isSkipped(id, TODAY)).toBe(true);
        // Le navigateur l'a prévu, et l'a écrit lui-même : annuler sait quoi rendre.
        expect(sent[0]?.changes).toEqual([
            { start: '09:00', end: '09:15', kind: 'work', ticket: 'OPS-12', comment: 'Daily' },
            { start: '09:15', end: '09:30', kind: 'empty', ticket: null, comment: null },
        ]);

        await expect(session.undo()).resolves.toMatchObject({ kind: 'saved' });
        expect(session.current().day.grid.equals(before)).toBe(true);
        expect(rangesOf(server.read(TODAY).grid)).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', id]]);
        expect(server.isSkipped(id, TODAY)).toBe(false);
        // Annuler dit qu'il rend la journée d'avant ; rétablir, non.
        expect(sent[1]).toEqual({
            changes: [{ ...DAILY, recurrence: id }],
            untils: [],
            restores: true,
        });

        await expect(session.redo()).resolves.toMatchObject({ kind: 'saved' });
        expect(rangesOf(server.read(TODAY).grid)).toEqual([['09:00', '09:15', 'work', 'OPS-12', 'Daily']]);
        expect(server.isSkipped(id, TODAY)).toBe(true);
        expect(sent[2]?.restores).toBeUndefined();
    });

    it.each([
        ['coller un autre commentaire par-dessus', 'paste'],
        ['convertir en pause', 'pause'],
        ['remplacer par un autre ticket', 'replace'],
    ] as const)('détache la fois en entier pour %s, et annuler la rend', async (_, gesture) => {
        const server = new FakeDayServer();
        const id = dailyOn(server);
        const session = open(server);
        const before = session.current().day.grid;

        if (gesture === 'paste') {
            await session.copyContent(work('OPS-12', 'Point'));
            await expect(session.paste(selectQuarters([quarterPast]))).resolves.toMatchObject({
                outcome: { kind: 'saved' },
            });
        } else {
            const content = gesture === 'pause' ? PAUSE : work('SHOP-482');
            await expect(session.apply(fill([nine], content))).resolves.toMatchObject({ kind: 'saved' });
        }
        expect(
            server
                .read(TODAY)
                .grid.blocks()
                .every((block) => block.content.recurrence === null),
        ).toBe(true);
        expect(server.isSkipped(id, TODAY)).toBe(true);

        await session.undo();
        expect(session.current().day.grid.equals(before)).toBe(true);
        expect(server.read(TODAY).grid.equals(before)).toBe(true);
        expect(server.isSkipped(id, TODAY)).toBe(false);
    });

    it('garde la fois telle quelle quand on colle ou dépose exactement son contenu par-dessus', async () => {
        const server = new FakeDayServer();
        const id = dailyOn(server);
        const session = open(server);
        const before = session.current().day.grid;
        const version = server.read(TODAY).version;

        await session.copy(selectQuarters([nine]));
        await expect(session.paste(selectQuarters([quarterPast]))).resolves.toMatchObject({
            outcome: { kind: 'unchanged' },
        });
        await expect(session.drop(fill([nine], work('OPS-12', 'Daily')))).resolves.toMatchObject({
            kind: 'unchanged',
        });

        expect(server.read(TODAY).version).toBe(version);
        expect(server.read(TODAY).grid.equals(before)).toBe(true);
        expect(server.isSkipped(id, TODAY)).toBe(false);
        expect(session.current().canUndo).toBe(false);
    });

    it('ne rend jamais le lien en collant : copier ne garde pas la récurrence', async () => {
        const server = new FakeDayServer();
        dailyOn(server);
        const { api, sent } = spied(server);
        const session = open(server, api);

        await session.copy(selectQuarters(DAILY_QUARTERS));
        await session.paste(selectQuarters([minutes('14:00')]));

        expect(sent[0]?.changes.some((change) => 'recurrence' in change)).toBe(false);
        expect(rangesOf(session.current().day.grid).at(-1)).toEqual(['14:00', '14:30', 'work', 'OPS-12', 'Daily']);
    });

    it('ne détache rien quand le geste ne prend rien à la récurrence', async () => {
        const server = new FakeDayServer();
        const id = dailyOn(server);
        const session = open(server);

        await session.apply(fill([minutes('09:30')], work('OPS-12', 'Daily')));

        expect(rangesOf(server.read(TODAY).grid)).toEqual([
            ['09:00', '09:30', 'work', 'OPS-12', 'Daily', id],
            ['09:30', '09:45', 'work', 'OPS-12', 'Daily'],
        ]);
        expect(server.isSkipped(id, TODAY)).toBe(false);
    });

    it('oublie, sans le redire à chaque Ctrl+Z, un détachement dont la récurrence ne tombe plus ce jour-là', async () => {
        const server = new FakeDayServer();
        const memory = tabMemory(memoryStorage());
        // Lundi, la récurrence naît, du lundi au vendredi.
        const monday = new DaySession(server.read(MONDAY), server.api(), memory);
        await monday.saveRecurrence(fill(DAILY_QUARTERS, work('OPS-12', 'Daily')), weeklyRule(WEEK), null);
        const id = server.allRecurrences()[0]?.id ?? '';
        server.pose(TODAY);
        // Mardi, Suppr détache sa fois.
        const tuesday = new DaySession(server.read(TODAY), server.api(), memory);
        await expect(tuesday.apply(fill(DAILY_QUARTERS, null))).resolves.toMatchObject({ kind: 'saved' });
        expect(server.isSkipped(id, TODAY)).toBe(true);
        // De retour lundi, Ctrl+Z la retire.
        await expect(new DaySession(server.read(MONDAY), server.api(), memory).undo()).resolves.toMatchObject({
            kind: 'saved',
        });
        expect(server.recurrence(id)?.until).toBe('2026-10-04');
        const version = server.read(TODAY).version;

        // De retour mardi, Ctrl+Z ne peut plus lui rendre sa fois : le geste est oublié.
        const back = new DaySession(server.read(TODAY), server.api(), memory);
        expect(back.current().canUndo).toBe(true);
        await expect(back.undo()).resolves.toEqual({ kind: 'conflict' });
        expect(back.current().canUndo).toBe(false);
        await expect(back.undo()).resolves.toEqual({ kind: 'nothing' });
        expect(server.read(TODAY).version).toBe(version);
        expect(rangesOf(server.read(TODAY).grid)).toEqual([]);
    });

    it('n’annule pas un détachement qu’un autre onglet a défait ou refait', async () => {
        const server = new FakeDayServer();
        dailyOn(server);
        const session = open(server);
        await session.apply(fill([quarterPast], null));
        // Un autre onglet repose le quart d'heure à la main : la fois reste détachée.
        await open(server).apply(fill([quarterPast], work('OPS-12', 'Daily')));
        const version = server.read(TODAY).version;

        await expect(session.undo()).resolves.toEqual({ kind: 'stale' });
        await expect(session.undo()).resolves.toEqual({ kind: 'conflict' });
        expect(server.read(TODAY).version).toBe(version);
        expect(session.current().canUndo).toBe(false);
    });
});

/**
 * Une récurrence née lundi, du lundi au vendredi, sur un serveur dont aujourd'hui est lundi :
 * le mardi, à venir, la prévoit sans l'écrire. Son identifiant.
 */
function plannedOn(server: FakeDayServer, change: SlotChange): string {
    const created = server.saveRecurrence(MONDAY, server.read(MONDAY).version, [change], weeklyRule(WEEK), null);
    const id = server.allRecurrences().at(-1)?.id;
    if (created.status !== 'saved' || id === undefined) {
        throw new Error(`La récurrence de ${change.start} n'est pas née : ${JSON.stringify(created)}.`);
    }

    return id;
}

/** Les écritures que le mardi a reçues. */
function writesOfToday(server: FakeDayServer): Request['kind'][] {
    return server.writes.filter((request) => request.date === TODAY).map((request) => request.kind);
}

describe('DaySession, un jour à venir et ses fois prévues', () => {
    it('montre la fois prévue liée à sa récurrence, comptée dans la journée, sans rien écrire', () => {
        const server = new FakeDayServer(MONDAY);
        const id = plannedOn(server, DAILY);
        const session = open(server);

        expect(rangesOf(session.current().day.grid)).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', id]]);
        expect(session.current().day.recurrences.get(id)).toMatchObject({ firstDay: MONDAY, until: null });
        expect(session.current().day.grid.workedMinutes()).toBe(30);
        expect(session.current().day.send.state).toBe('unsent');
        expect(rangesOf(server.saved(TODAY).grid)).toEqual([]);
        expect(writesOfToday(server)).toEqual([]);
    });

    it('efface la fois prévue entière par un seul geste, sans rien écrire, et annuler la rend prévue', async () => {
        const server = new FakeDayServer(MONDAY);
        const id = plannedOn(server, DAILY);
        const { api, sent } = spied(server);
        const session = open(server, api);
        const before = session.current().day;

        await expect(session.apply(fill(DAILY_QUARTERS, null))).resolves.toMatchObject({ kind: 'saved' });
        expect(sent).toEqual([
            {
                changes: [{ start: '09:00', end: '09:30', kind: 'empty', ticket: null, comment: null }],
                untils: undefined,
            },
        ]);
        expect(rangesOf(session.current().day.grid)).toEqual([]);
        expect(session.current().day.grid.workedMinutes()).toBe(0);
        expect(session.current().day.version).not.toBe(before.version);
        expect(server.isSkipped(id, TODAY)).toBe(true);
        // Rien n'a été saisi : la journée ne naît pas.
        expect(server.saved(TODAY).version).toBe(0);

        await expect(session.undo()).resolves.toMatchObject({ kind: 'saved' });
        expect(sent[1]).toEqual({ changes: [{ ...DAILY, recurrence: id }], untils: [], restores: true });
        expect(session.current().day.grid.equals(before.grid)).toBe(true);
        expect(session.current().day.version).toBe(before.version);
        expect(server.isSkipped(id, TODAY)).toBe(false);
        expect(rangesOf(server.saved(TODAY).grid)).toEqual([]);

        await expect(session.redo()).resolves.toMatchObject({ kind: 'saved' });
        expect(rangesOf(server.read(TODAY).grid)).toEqual([]);
        expect(server.isSkipped(id, TODAY)).toBe(true);
    });

    it('détache la fois prévue entière quand on colle sur une partie, et annuler la rend prévue', async () => {
        const server = new FakeDayServer(MONDAY);
        const id = plannedOn(server, { ...DAILY, end: '10:00' });
        const session = open(server);
        const before = session.current().day.grid;

        await session.copyContent(work('OPS-7'));
        await expect(session.paste(selectQuarters([quarterPast]))).resolves.toMatchObject({
            outcome: { kind: 'saved' },
        });
        const detached = [
            ['09:00', '09:15', 'work', 'OPS-12', 'Daily'],
            ['09:15', '09:30', 'work', 'OPS-7', null],
            ['09:30', '10:00', 'work', 'OPS-12', 'Daily'],
        ];
        expect(rangesOf(session.current().day.grid)).toEqual(detached);
        // Ce qui reste de la fois est écrit pour de bon, sans son lien : ni prévu, ni en double.
        expect(rangesOf(server.saved(TODAY).grid)).toEqual(detached);
        expect(server.isSkipped(id, TODAY)).toBe(true);

        await expect(session.undo()).resolves.toMatchObject({ kind: 'saved' });
        expect(session.current().day.grid.equals(before)).toBe(true);
        expect(rangesOf(server.saved(TODAY).grid)).toEqual([]);
        expect(server.isSkipped(id, TODAY)).toBe(false);

        await expect(session.redo()).resolves.toMatchObject({ kind: 'saved' });
        expect(rangesOf(server.read(TODAY).grid)).toEqual(detached);
    });

    it('n’écrit qu’une fois le même geste envoyé deux fois sur la fois prévue', async () => {
        const server = new FakeDayServer(MONDAY);
        plannedOn(server, DAILY);
        const session = open(server);
        const gesture = fill([quarterPast], PAUSE);

        await expect(Promise.all([session.apply(gesture), session.apply(gesture)])).resolves.toMatchObject([
            { kind: 'saved' },
            { kind: 'unchanged' },
        ]);
        expect(writesOfToday(server)).toEqual(['changeSlots']);
        expect(rangesOf(server.read(TODAY).grid)).toEqual([
            ['09:00', '09:15', 'work', 'OPS-12', 'Daily'],
            ['09:15', '09:30', 'pause', null, null],
        ]);
    });

    it('détache et rend les fois prévues aux bornes de la journée, de 07:00 à 07:15 et de 19:45 à 20:00', async () => {
        const server = new FakeDayServer(MONDAY);
        const early = plannedOn(server, { start: '07:00', end: '07:15', kind: 'pause', ticket: null, comment: null });
        const late = plannedOn(server, { ...DAILY, start: '19:45', end: '20:00' });
        const session = open(server);
        const before = session.current().day.grid;
        expect(rangesOf(before)).toEqual([
            ['07:00', '07:15', 'pause', null, null, early],
            ['19:45', '20:00', 'work', 'OPS-12', 'Daily', late],
        ]);

        await expect(session.apply(fill([Quarter.FIRST], work('OPS-7')))).resolves.toMatchObject({ kind: 'saved' });
        await expect(session.apply(fill([Quarter.DAY_END - Quarter.MINUTES], null))).resolves.toMatchObject({
            kind: 'saved',
        });
        expect(rangesOf(server.read(TODAY).grid)).toEqual([['07:00', '07:15', 'work', 'OPS-7', null]]);
        expect([server.isSkipped(early, TODAY), server.isSkipped(late, TODAY)]).toEqual([true, true]);
        // Un quart d'heure de trop ne part pas : 20:00 n'est pas dans la journée.
        expect(() => session.apply(fill([Quarter.DAY_END], PAUSE))).toThrow(RangeError);

        await session.undo();
        await session.undo();
        expect(session.current().day.grid.equals(before)).toBe(true);
        expect(rangesOf(server.saved(TODAY).grid)).toEqual([]);
        expect([server.isSkipped(early, TODAY), server.isSkipped(late, TODAY)]).toEqual([false, false]);
    });

    it('ne prévoit plus rien mis à 0h00, et prévoit de nouveau revenu à son objectif', async () => {
        const server = new FakeDayServer(MONDAY);
        const id = plannedOn(server, DAILY);
        const session = open(server);
        await session.apply(fill([minutes('14:00')], work('SHOP-482')));

        await expect(session.setObjective(0)).resolves.toEqual({ kind: 'saved', step: null });
        expect(session.current().day.declaredOff).toBe(true);
        expect(rangesOf(session.current().day.grid)).toEqual([['14:00', '14:15', 'work', 'SHOP-482', null]]);

        await expect(session.setObjective(session.current().day.habitualObjective)).resolves.toEqual({
            kind: 'saved',
            step: null,
        });
        expect(session.current().day.declaredOff).toBe(false);
        expect(rangesOf(session.current().day.grid)).toEqual([
            ['09:00', '09:30', 'work', 'OPS-12', 'Daily', id],
            ['14:00', '14:15', 'work', 'SHOP-482', null],
        ]);
        // Prévue de nouveau, pas écrite.
        expect(rangesOf(server.saved(TODAY).grid)).toEqual([['14:00', '14:15', 'work', 'SHOP-482', null]]);
    });

    it('annulé sur un jour mis à 0h00, rend la fois effacée à sa récurrence, qui la retient jusqu’au retour à l’objectif', async () => {
        const server = new FakeDayServer(MONDAY);
        const id = plannedOn(server, DAILY);
        const session = open(server);
        await session.apply(fill([minutes('14:00')], work('SHOP-482')));
        await expect(session.apply(fill(DAILY_QUARTERS, null))).resolves.toMatchObject({ kind: 'saved' });
        await session.setObjective(0);
        const typed: Range = ['14:00', '14:15', 'work', 'SHOP-482', null];

        // Ctrl+Z : le congé reste, rien ne s'écrit, et le Daily retient sa fois.
        await expect(session.undo()).resolves.toEqual({ kind: 'saved', step: null });
        expect(rangesOf(session.current().day.grid)).toEqual([typed]);
        expect(rangesOf(server.saved(TODAY).grid)).toEqual([typed]);
        expect(server.isHeld(id, TODAY)).toBe(true);

        // Ctrl+Maj+Z refait l'effacement : la fois est de nouveau effacée, et l'objectif ne la
        // rendra pas. Annuler encore la retient de nouveau.
        await expect(session.redo()).resolves.toEqual({ kind: 'saved', step: null });
        expect(server.isSkipped(id, TODAY) && !server.isHeld(id, TODAY)).toBe(true);
        await expect(session.undo()).resolves.toEqual({ kind: 'saved', step: null });
        expect(server.isHeld(id, TODAY)).toBe(true);

        await session.setObjective(session.current().day.habitualObjective);
        expect(rangesOf(session.current().day.grid)).toEqual([
            ['09:00', '09:30', 'work', 'OPS-12', 'Daily', id],
            typed,
        ]);
        expect(rangesOf(server.saved(TODAY).grid)).toEqual([typed]);
        expect(server.isSkipped(id, TODAY)).toBe(false);
    });

    it('rétabli sur un jour mis à 0h00, refait l’effacement que l’annulation avait rendu à sa série : l’objectif ne le ramène pas', async () => {
        const server = new FakeDayServer(MONDAY);
        const id = plannedOn(server, DAILY);
        const { api, sent } = spied(server);
        const session = open(server, api);
        await session.apply(fill([minutes('14:00')], work('SHOP-482')));
        await session.apply(fill(DAILY_QUARTERS, null));
        await session.setObjective(0);
        await session.undo();

        await expect(session.redo()).resolves.toEqual({ kind: 'saved', step: null });
        expect(sent.at(-1)?.detaches).toEqual([id]);

        await session.setObjective(session.current().day.habitualObjective);
        expect(rangesOf(session.current().day.grid)).toEqual([['14:00', '14:15', 'work', 'SHOP-482', null]]);
        expect(server.isSkipped(id, TODAY) && !server.isHeld(id, TODAY)).toBe(true);
    });

    it('retire mis à 0h00 la fois que l’envoi avait écrite, et la repose revenu à son objectif, comme un jour venu', async () => {
        const server = new FakeDayServer(MONDAY);
        const id = plannedOn(server, DAILY);
        const session = open(server);
        await expect(session.sendToJira()).resolves.toEqual({ kind: 'done' });
        expect(rangesOf(server.saved(TODAY).grid)).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', id]]);

        await session.setObjective(0);
        expect(rangesOf(server.read(TODAY).grid)).toEqual([]);
        expect(server.isSkipped(id, TODAY)).toBe(true);

        await session.setObjective(session.current().day.habitualObjective);
        expect(rangesOf(session.current().day.grid)).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', id]]);
        // Envoyé, le jour a reçu ses récurrences pour de bon : il n'en prévoit plus.
        expect(rangesOf(server.saved(TODAY).grid)).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', id]]);
        expect(server.isSkipped(id, TODAY)).toBe(false);
    });

    it('retrouve posée, revenu à son objectif une fois le jour venu, la fois prévue qu’un 0h00 posé d’avance avait retirée', async () => {
        const server = new FakeDayServer(MONDAY);
        const id = plannedOn(server, DAILY);
        const lunch = plannedOn(server, { start: '12:30', end: '13:30', kind: 'pause', ticket: null, comment: null });
        const memory = tabMemory(memoryStorage());
        const ahead = open(server, server.api(), memory);
        await ahead.apply(fill([minutes('12:30')], work('SHOP-482')));
        // La pause, détachée avant le 0h00, ne lui doit rien.
        expect(server.isSkipped(lunch, TODAY)).toBe(true);

        await expect(ahead.setObjective(0)).resolves.toEqual({ kind: 'saved', step: null });
        expect(rangesOf(ahead.current().day.grid)).toEqual([
            ['12:30', '12:45', 'work', 'SHOP-482', null],
            ['12:45', '13:30', 'pause', null, null],
        ]);
        expect(server.isSkipped(id, TODAY)).toBe(true);

        // Le mardi vient : il ne prévoit plus rien, et le 0h00 le garde vide de Daily.
        server.setToday(TODAY);
        const come = open(server, server.api(), memory);
        expect(rangesOf(come.current().day.grid)).toEqual(rangesOf(ahead.current().day.grid));

        await expect(come.setObjective(come.current().day.habitualObjective)).resolves.toEqual({
            kind: 'saved',
            step: null,
        });
        // Le Daily revient, posé pour de bon ; la pause détachée avant ne revient pas.
        const back = [
            ['09:00', '09:30', 'work', 'OPS-12', 'Daily', id],
            ['12:30', '12:45', 'work', 'SHOP-482', null],
            ['12:45', '13:30', 'pause', null, null],
        ];
        expect(rangesOf(come.current().day.grid)).toEqual(back);
        expect(rangesOf(server.saved(TODAY).grid)).toEqual(back);
        expect(server.isSkipped(id, TODAY)).toBe(false);
        expect(server.isSkipped(lunch, TODAY)).toBe(true);
    });

    it('refuse le geste d’un onglet qui n’a pas vu la récurrence arrêtée depuis la veille, et se remet sur la journée relue', async () => {
        const server = new FakeDayServer(MONDAY);
        const id = plannedOn(server, DAILY);
        const session = open(server);
        // Un autre onglet, lundi, décoche la case du Daily : il ne tombe plus mardi.
        const stopped = server.saveRecurrence(MONDAY, server.read(MONDAY).version, [DAILY], null, seen(server, id));
        expect(stopped.status).toBe('saved');
        const writes = server.writes.length;

        await expect(session.apply(fill([quarterPast], PAUSE))).resolves.toEqual({ kind: 'stale' });
        expect(server.writes).toHaveLength(writes);
        expect(rangesOf(session.current().day.grid)).toEqual([]);
        expect(session.current().day.version).toBe(server.read(TODAY).version);

        await expect(session.apply(fill([quarterPast], PAUSE))).resolves.toMatchObject({ kind: 'saved' });
        expect(rangesOf(server.read(TODAY).grid)).toEqual([['09:15', '09:30', 'pause', null, null]]);
    });
});

describe('DaySession, la récurrence enregistrée depuis la fenêtre', () => {
    it('crée une récurrence, qu’annuler retire et que rétablir rend', async () => {
        const server = new FakeDayServer();
        const session = open(server);

        await expect(
            session.saveRecurrence(fill(DAILY_QUARTERS, work('ops-12', 'Daily')), weeklyRule(WEEK), null),
        ).resolves.toEqual({
            kind: 'saved',
            step: expect.objectContaining({ quarters: DAILY_QUARTERS, before: [null, null] }) as unknown,
        });
        const [created] = server.allRecurrences();
        if (created === undefined) {
            throw new Error("La récurrence n'est pas née.");
        }
        expect(created).toMatchObject({ start: '09:00', end: '09:30', firstDay: TODAY, until: null });
        expect(rangesOf(session.current().day.grid)).toEqual([
            ['09:00', '09:30', 'work', 'OPS-12', 'Daily', created.id],
        ]);
        expect(session.current().canUndo).toBe(true);

        await expect(session.undo()).resolves.toMatchObject({ kind: 'saved' });
        // Retirée : elle finit la veille de son premier jour, et ne tombe plus jamais.
        expect(server.recurrence(created.id)?.until).toBe(MONDAY);
        expect(rangesOf(server.read(TODAY).grid)).toEqual([]);
        server.pose(WEDNESDAY);
        expect(rangesOf(server.read(WEDNESDAY).grid)).toEqual([]);

        await expect(session.redo()).resolves.toMatchObject({ kind: 'saved' });
        expect(server.recurrence(created.id)?.until).toBeNull();
        expect(rangesOf(server.read(TODAY).grid)).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', created.id]]);
    });

    it('rend en annulant ce que la récurrence avait recouvert, et la fois qu’elle avait détachée', async () => {
        const server = new FakeDayServer();
        const daily = dailyOn(server);
        server.setToday(TODAY);
        const session = open(server);
        const before = session.current().day.grid;

        // Nouveau ticket par-dessus le Daily, la case cochée : une autre récurrence naît, jusqu'à
        // aujourd'hui — au-delà, elle prendrait le créneau du Daily, ce que le serveur refuse.
        await session.saveRecurrence(fill([quarterPast, minutes('09:30')], PAUSE), weeklyRule([2], TODAY), null);
        expect(server.isSkipped(daily, TODAY)).toBe(true);
        expect(rangesOf(server.read(TODAY).grid)[0]).toEqual(['09:00', '09:15', 'work', 'OPS-12', 'Daily']);

        await session.undo();
        expect(server.read(TODAY).grid.equals(before)).toBe(true);
        expect(server.recurrence(daily)?.until).toBeNull();
    });

    it('coupe la récurrence à partir de cette fois quand le ticket change, et annuler la recoud', async () => {
        const server = new FakeDayServer();
        const daily = dailyOn(server);
        const session = open(server);
        const before = session.current().day.grid;

        await session.saveRecurrence(
            fill(DAILY_QUARTERS, work('OPS-13', 'Daily')),
            weeklyRule(WEEK),
            seen(server, daily),
        );
        const cut = server.allRecurrences().find((recurrence) => recurrence.id !== daily);
        if (cut === undefined) {
            throw new Error("La nouvelle récurrence n'est pas née.");
        }
        // L'ancienne finit la veille, et garde ce qu'elle a posé ; la nouvelle part de ce jour.
        expect(server.recurrence(daily)?.until).toBe(MONDAY);
        expect(cut).toMatchObject({ start: '09:00', end: '09:30', firstDay: TODAY, until: null });
        expect(rangesOf(server.read(MONDAY).grid)).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', daily]]);
        expect(rangesOf(session.current().day.grid)).toEqual([['09:00', '09:30', 'work', 'OPS-13', 'Daily', cut.id]]);

        await session.undo();
        expect(server.read(TODAY).grid.equals(before)).toBe(true);
        expect(server.recurrence(daily)?.until).toBeNull();
        expect(server.recurrence(cut.id)?.until).toBe(MONDAY);

        await session.redo();
        expect(server.recurrence(daily)?.until).toBe(MONDAY);
        expect(server.recurrence(cut.id)?.until).toBeNull();
        expect(rangesOf(server.read(TODAY).grid)).toEqual([['09:00', '09:30', 'work', 'OPS-13', 'Daily', cut.id]]);
    });

    it('l’arrête à partir de cette fois, le bloc gardé sans lien, et annuler la relance', async () => {
        const server = new FakeDayServer();
        const daily = dailyOn(server);
        const session = open(server);
        const before = session.current().day.grid;

        await session.saveRecurrence(
            fill(DAILY_QUARTERS, unlinked(work('OPS-12', 'Daily'))),
            null,
            seen(server, daily),
        );
        expect(server.recurrence(daily)?.until).toBe(MONDAY);
        expect(rangesOf(session.current().day.grid)).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily']]);
        server.pose(WEDNESDAY);
        expect(rangesOf(server.read(WEDNESDAY).grid)).toEqual([]);

        await session.undo();
        expect(server.read(TODAY).grid.equals(before)).toBe(true);
        expect(server.recurrence(daily)?.until).toBeNull();
    });

    it('arrête dès son premier jour une récurrence née ce jour-là : elle est retirée', async () => {
        const server = new FakeDayServer();
        const session = open(server);
        await session.saveRecurrence(fill(DAILY_QUARTERS, work('OPS-12', 'Daily')), weeklyRule(WEEK), null);
        const id = server.allRecurrences()[0]?.id ?? '';

        await session.saveRecurrence(fill(DAILY_QUARTERS, work('OPS-12', 'Daily')), null, seen(server, id));

        expect(server.recurrence(id)?.until).toBe(MONDAY);
        // Deux gestes : annuler l'arrêt, puis la création.
        await session.undo();
        expect(server.recurrence(id)?.until).toBeNull();
        await session.undo();
        expect(server.recurrence(id)?.until).toBe(MONDAY);
        expect(rangesOf(server.read(TODAY).grid)).toEqual([]);
    });

    it('change seulement sa fin, et annuler la lui rend', async () => {
        const server = new FakeDayServer();
        const daily = dailyOn(server);
        const session = open(server);

        await expect(
            session.saveRecurrence(
                fill(DAILY_QUARTERS, work('OPS-12', 'Daily')),
                weeklyRule(WEEK, '2026-11-04'),
                seen(server, daily),
            ),
        ).resolves.toEqual({ kind: 'saved', step: null });
        expect(server.recurrence(daily)?.until).toBe('2026-11-04');
        expect(session.current().canUndo).toBe(true);

        await expect(session.undo()).resolves.toMatchObject({ kind: 'saved' });
        expect(server.recurrence(daily)?.until).toBeNull();
        expect(session.current().canRedo).toBe(true);

        await expect(session.redo()).resolves.toMatchObject({ kind: 'saved' });
        expect(server.recurrence(daily)?.until).toBe('2026-11-04');
    });

    it('refuse sous son champ un jour qui n’est plus travaillé, sans rien écrire ni ranger', async () => {
        const server = new FakeDayServer();
        const session = open(server);

        await expect(
            session.saveRecurrence(fill(DAILY_QUARTERS, work('OPS-12', 'Daily')), weeklyRule([2, 6]), null),
        ).resolves.toEqual({
            kind: 'invalid',
            violations: [
                { field: 'recurrence.weekdays', message: "Le samedi n'est plus travaillé. Rechargez la page." },
            ],
        });
        await expect(
            session.saveRecurrence(fill(DAILY_QUARTERS, work('OPS-12', 'Daily')), weeklyRule([2], MONDAY), null),
        ).resolves.toEqual({
            kind: 'invalid',
            violations: [{ field: 'recurrence.until', message: 'Choisissez un jour à partir du mardi 6 octobre.' }],
        });
        expect(server.writes).toHaveLength(0);
        expect(server.allRecurrences()).toEqual([]);
        expect(session.current().canUndo).toBe(false);
    });

    it('change encore une récurrence dont un jour a été décoché depuis, sans en ajouter un', async () => {
        const server = new FakeDayServer();
        const daily = dailyOn(server);
        // Le mercredi décoché dans les réglages, depuis un autre onglet.
        server.setWorkingDays([1, 2, 4, 5]);
        const session = open(server);

        await expect(
            session.saveRecurrence(
                fill(DAILY_QUARTERS, work('OPS-12', 'Daily')),
                weeklyRule(WEEK, '2026-11-04'),
                seen(server, daily),
            ),
        ).resolves.toEqual({ kind: 'saved', step: null });
        expect(server.recurrence(daily)).toMatchObject({ weekdays: WEEK, until: '2026-11-04' });

        await expect(
            session.saveRecurrence(
                fill(DAILY_QUARTERS, work('OPS-12', 'Daily')),
                weeklyRule([...WEEK, 6], '2026-11-04'),
                seen(server, daily),
            ),
        ).resolves.toEqual({
            kind: 'invalid',
            violations: [
                { field: 'recurrence.weekdays', message: "Le samedi n'est plus travaillé. Rechargez la page." },
            ],
        });
        await expect(
            session.saveRecurrence(fill([minutes('14:00')], work('OPS-7')), weeklyRule([1, 3]), null),
        ).resolves.toEqual({
            kind: 'invalid',
            violations: [
                { field: 'recurrence.weekdays', message: "Le mercredi n'est plus travaillé. Rechargez la page." },
            ],
        });
        // Le mercredi venu, rien ne s'y pose.
        server.pose(WEDNESDAY);
        expect(rangesOf(server.read(WEDNESDAY).grid)).toEqual([]);
    });

    it('refuse de remplacer une récurrence changée ailleurs depuis que la fenêtre l’a vue', async () => {
        const server = new FakeDayServer();
        const daily = dailyOn(server);
        server.pose(WEDNESDAY);
        // La fenêtre du Daily de mardi s'ouvre ; un autre onglet lui donne une fin depuis mercredi.
        const tuesday = open(server);
        const seenTuesday = seen(server, daily);
        await new DaySession(server.read(WEDNESDAY), server.api(), tabMemory(memoryStorage())).saveRecurrence(
            fill(DAILY_QUARTERS, work('OPS-12', 'Daily')),
            weeklyRule(WEEK, '2026-11-04'),
            seen(server, daily),
        );
        const version = server.read(TODAY).version;

        await expect(
            tuesday.saveRecurrence(
                fill(DAILY_QUARTERS, work('OPS-12', 'Daily')),
                weeklyRule(WEEK, '2026-12-31'),
                seenTuesday,
            ),
        ).resolves.toEqual({ kind: 'stale' });
        expect(server.recurrence(daily)?.until).toBe('2026-11-04');
        expect(server.read(TODAY).version).toBe(version);
        expect(tuesday.current().day.recurrences.get(daily)?.until).toBe('2026-11-04');
        expect(tuesday.current().canUndo).toBe(false);

        // Revue à jour, elle enregistre.
        await expect(
            tuesday.saveRecurrence(
                fill(DAILY_QUARTERS, work('OPS-12', 'Daily')),
                weeklyRule(WEEK, '2026-12-31'),
                seen(server, daily),
            ),
        ).resolves.toEqual({ kind: 'saved', step: null });
        expect(server.recurrence(daily)?.until).toBe('2026-12-31');
    });

    it('refuse une récurrence sur deux plages, ou sur un créneau effacé', async () => {
        const server = new FakeDayServer();
        const session = open(server);

        await expect(
            session.saveRecurrence(fill([nine, minutes('10:00')], work('OPS-12')), weeklyRule(WEEK), null),
        ).resolves.toMatchObject({ kind: 'invalid', violations: [{ field: 'changes' }] });
        expect(server.allRecurrences()).toEqual([]);
        expect(server.writes).toHaveLength(0);
    });

    it('refuse, comme un onglet en retard, de changer une récurrence qu’un autre onglet a arrêtée', async () => {
        const server = new FakeDayServer();
        const daily = dailyOn(server);
        const late = open(server);
        const seenLate = seen(server, daily);
        await open(server).saveRecurrence(fill(DAILY_QUARTERS, work('OPS-12', 'Daily')), null, seen(server, daily));
        const version = server.read(TODAY).version;

        await expect(
            late.saveRecurrence(fill(DAILY_QUARTERS, work('OPS-13', 'Daily')), weeklyRule(WEEK), seenLate),
        ).resolves.toEqual({ kind: 'stale' });
        expect(server.read(TODAY).version).toBe(version);
        expect(server.allRecurrences()).toHaveLength(1);
        // À jour, il voit le bloc sans lien : la fenêtre n'a plus de récurrence à changer.
        expect(rangesOf(late.current().day.grid)).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily']]);
    });

    it('n’annule pas la création d’une récurrence qu’un autre onglet a arrêtée depuis', async () => {
        const server = new FakeDayServer();
        const session = open(server);
        await session.saveRecurrence(fill(DAILY_QUARTERS, work('OPS-12', 'Daily')), weeklyRule(WEEK), null);
        const id = server.allRecurrences()[0]?.id ?? '';
        await open(server).saveRecurrence(fill(DAILY_QUARTERS, work('OPS-12', 'Daily')), null, seen(server, id));
        const after = server.read(TODAY);

        await expect(session.undo()).resolves.toEqual({ kind: 'stale' });
        await expect(session.undo()).resolves.toEqual({ kind: 'conflict' });
        expect(server.read(TODAY).version).toBe(after.version);
        expect(server.recurrence(id)?.until).toBe(MONDAY);
    });

    it('ne rend jamais une fin qu’un autre onglet a changée depuis', async () => {
        const server = new FakeDayServer();
        const session = open(server);
        await session.saveRecurrence(fill(DAILY_QUARTERS, work('OPS-12', 'Daily')), weeklyRule(WEEK), null);
        const id = server.allRecurrences()[0]?.id ?? '';
        // Un autre onglet ne change que sa fin : les quarts d'heure sont restés ceux d'après.
        await open(server).saveRecurrence(
            fill(DAILY_QUARTERS, work('OPS-12', 'Daily')),
            weeklyRule(WEEK, '2026-11-04'),
            seen(server, id),
        );

        const version = server.read(TODAY).version;

        await expect(session.undo()).resolves.toEqual({ kind: 'stale' });
        await session.undo();
        expect(server.recurrence(id)?.until).toBe('2026-11-04');
        expect(rangesOf(server.read(TODAY).grid)).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', id]]);
        expect(server.read(TODAY).version).toBe(version);
    });

    it('n’offre plus d’annuler une fois refusé de rendre une fin changée ailleurs', async () => {
        const server = new FakeDayServer();
        const session = open(server);
        await session.saveRecurrence(fill(DAILY_QUARTERS, work('OPS-12', 'Daily')), weeklyRule(WEEK), null);
        const id = server.allRecurrences()[0]?.id ?? '';
        await open(server).saveRecurrence(
            fill(DAILY_QUARTERS, work('OPS-12', 'Daily')),
            weeklyRule(WEEK, '2026-11-04'),
            seen(server, id),
        );
        await session.undo();

        // La journée est à jour : ce refus-là ne vient plus d'un onglet en retard, et Ctrl+Z ne
        // doit pas le redire à l'infini.
        await expect(session.undo()).resolves.toEqual({ kind: 'conflict' });
        expect(session.current().canUndo).toBe(false);
    });

    it('oublie l’historique quand la réponse s’est perdue après l’écriture', async () => {
        const server = new FakeDayServer();
        const lost: Transport = <T>(request: Request, handle: () => T): Promise<T> => {
            const result = handle();

            return request.kind === 'saveRecurrence'
                ? Promise.reject(new TypeError('Failed to fetch'))
                : Promise.resolve(result);
        };
        const session = open(server, server.api(lost));
        await session.apply(fill([minutes('14:00')], work('SHOP-482')));

        await expect(
            session.saveRecurrence(fill(DAILY_QUARTERS, work('OPS-12', 'Daily')), weeklyRule(WEEK), null),
        ).resolves.toEqual({ kind: 'failed' });
        expect(rangesOf(session.current().day.grid)[0]?.[5]).toBe(server.allRecurrences()[0]?.id);
        expect(session.current().canUndo).toBe(false);
    });

    it('n’a de lien qu’au quart d’heure : la journée entière d’un seul tenant, jusqu’à 20:00', async () => {
        const server = new FakeDayServer();
        const session = open(server);

        await session.saveRecurrence(fill(Quarter.all(), PAUSE), weeklyRule(WEEK, TODAY), null);
        const id = server.allRecurrences()[0]?.id ?? '';

        expect(server.recurrence(id)).toMatchObject({ start: '07:00', end: '20:00', until: TODAY });
        expect(rangesOf(session.current().day.grid)).toEqual([['07:00', '20:00', 'pause', null, null, id]]);
        expect(session.current().day.grid.workedMinutes()).toBe(0);
    });
});

/** Ce que le serveur dit d'un créneau déjà pris (RecurrenceRefused::taken). */
function takenBy(name: string | null): unknown {
    return {
        kind: 'invalid',
        violations: [
            {
                field: 'recurrence.rhythm',
                message:
                    name === null
                        ? 'Ce créneau est déjà pris par la pause.'
                        : `Ce créneau est déjà pris par la récurrence «\u{a0}${name}\u{a0}».`,
            },
        ],
    };
}

/** Un autre onglet crée, ce jour-là, une récurrence sur ce créneau : son identifiant. */
function elsewhere(server: FakeDayServer, date: string, change: SlotChange, rule: RecurrenceRule): string {
    const result = server.saveRecurrence(date, server.read(date).version, [change], rule, null);
    const id = server.allRecurrences().at(-1)?.id;
    if (result.status !== 'saved' || id === undefined) {
        throw new Error(`L'autre onglet n'a rien créé : ${JSON.stringify(result)}.`);
    }

    return id;
}

const TWO: SlotChange = { start: '14:00', end: '15:00', kind: 'work', ticket: 'OPS-7', comment: 'Rétrospective' };
const TWO_QUARTERS = Quarter.between(minutes('14:00'), minutes('15:00'));
const RETRO = work('OPS-7', 'Rétrospective');

describe('DaySession, les rythmes contre le faux serveur', () => {
    it('garde et rend le rythme entier, et le pose les seuls jours où il tombe', async () => {
        const server = new FakeDayServer();
        const session = open(server);

        await session.saveRecurrence(fill([minutes('14:00')], work('OPS-7', 'Poker')), weeklyRule([2], null, 2), null);
        await session.saveRecurrence(
            fill([minutes('15:00')], work('OPS-8', 'Démo')),
            { ...monthlyWeekday(2, 1), until: null },
            null,
        );
        await session.saveRecurrence(
            fill([minutes('16:00')], work('OPS-9', 'Paie')),
            { ...monthlyDate(6), until: null },
            null,
        );
        const [poker, demo, pay] = server.allRecurrences();

        expect(poker).toMatchObject({ kind: 'weekly', weekdays: [2], everyWeeks: 2, monthWeek: null, monthDay: null });
        expect(demo).toMatchObject({ kind: 'monthly_weekday', weekdays: [2], everyWeeks: 1, monthWeek: 1 });
        expect(pay).toMatchObject({ kind: 'monthly_date', weekdays: [], monthDay: 6 });
        // La journée rend chaque rythme, lu par le moteur.
        const day = server.read(TODAY);
        expect(day.recurrences.get(poker?.id ?? '')?.rhythm).toEqual(weekly([2], 2));
        expect(day.ongoing.get(demo?.id ?? '')?.rhythm).toEqual(monthlyWeekday(2, 1));
        expect(day.ongoing.get(pay?.id ?? '')?.content).toEqual({ kind: 'work', ticket: 'OPS-9', comment: 'Paie' });

        server.pose('2026-11-06');
        const posed = (date: string) => rangesOf(server.read(date).grid).map(([start]) => start);
        expect(posed('2026-10-13')).toEqual([]);
        expect(posed('2026-10-20')).toEqual(['14:00']);
        expect(posed('2026-10-27')).toEqual([]);
        expect(posed('2026-11-03')).toEqual(['14:00', '15:00']);
        expect(posed('2026-11-06')).toEqual(['16:00']);
    });

    it('refuse un rythme mensuel que le jour du bloc ne permet pas, sans rien écrire', async () => {
        const server = new FakeDayServer();
        const session = open(server);
        const refused = {
            kind: 'invalid',
            violations: [
                { field: 'recurrence.rhythm', message: 'Ce rythme ne tombe pas le jour du bloc. Rechargez la page.' },
            ],
        };

        // Le mardi 6 octobre est le 1er du mois, pas le dernier ; ni un mercredi, ni le 7.
        for (const rhythm of [
            monthlyWeekday(2, LAST_WEEK),
            monthlyWeekday(2, 2),
            monthlyWeekday(3, 1),
            monthlyDate(7),
        ]) {
            await expect(
                session.saveRecurrence(fill([minutes('14:00')], RETRO), { ...rhythm, until: null }, null),
            ).resolves.toEqual(refused);
        }
        expect(server.writes).toHaveLength(0);
        expect(server.allRecurrences()).toEqual([]);
    });

    it.each<[string, Record<string, unknown>, string, string]>([
        [
            'une semaine avec un jour du mois',
            { monthDay: 6 },
            'recurrence.kind',
            "Chaque semaine n'a pas de jour du mois.",
        ],
        [
            'une semaine sur cinq',
            { everyWeeks: 5 },
            'recurrence.everyWeeks',
            'Une récurrence revient chaque semaine, ou une semaine sur 2, 3 ou 4.',
        ],
        [
            'une semaine sur zéro',
            { everyWeeks: 0 },
            'recurrence.everyWeeks',
            'Une récurrence revient chaque semaine, ou une semaine sur 2, 3 ou 4.',
        ],
        ['un rythme inconnu', { kind: 'daily' }, 'recurrence.kind', 'Rythme inconnu.'],
        [
            'un 5e jour du mois',
            { ...monthlyWeekday(2, 5) },
            'recurrence.monthWeek',
            'Un jour du mois se nomme du 1er au 4e, ou le dernier.',
        ],
        [
            'un rang sans jour',
            { ...monthlyWeekday(2, 1), weekdays: [] },
            'recurrence.kind',
            'Le n-ième jour du mois a un seul jour de la semaine et son rang.',
        ],
        [
            'un rang de deux jours',
            { ...monthlyWeekday(2, 1), weekdays: [2, 4] },
            'recurrence.kind',
            'Le n-ième jour du mois a un seul jour de la semaine et son rang.',
        ],
        [
            'un rang une semaine sur deux',
            { ...monthlyWeekday(2, 1), everyWeeks: 2 },
            'recurrence.kind',
            'Le n-ième jour du mois a un seul jour de la semaine et son rang.',
        ],
        ['un 32', { ...monthlyDate(32) }, 'recurrence.monthDay', 'Une date du mois va du 1er au 31.'],
        [
            'une date avec des jours',
            { ...monthlyDate(6), weekdays: [2] },
            'recurrence.kind',
            "Une date du mois n'a que sa date.",
        ],
        [
            'une date sans date',
            { ...monthlyDate(6), monthDay: null },
            'recurrence.kind',
            "Une date du mois n'a que sa date.",
        ],
        ['un champ inconnu', { daily: true }, 'recurrence.daily', 'Champ inconnu.'],
    ])('refuse sous son champ %s, comme RecurrenceRuleInput', (_, change, field, message) => {
        const server = new FakeDayServer();
        // Ce qui arrive du navigateur n'a pas encore de type : le serveur le lit tel quel.
        const rule: RecurrenceRule = Object.assign({}, weeklyRule([2]), change);
        const result = server.saveRecurrence(TODAY, 0, [TWO], rule, null);

        expect(result).toMatchObject({ status: 'invalid' });
        expect(result.status === 'invalid' ? result.violations : []).toContainEqual({ field, message });
        expect(server.allRecurrences()).toEqual([]);
    });

    it('rend celles qui vont encore après aujourd’hui, sans les retirées ni celles qui finissent aujourd’hui', async () => {
        const server = new FakeDayServer(TODAY);
        const daily = dailyOn(server);
        const ending = elsewhere(server, TODAY, TWO, weeklyRule([2], TODAY));
        const later = elsewhere(server, '2026-10-20', { ...TWO, start: '16:00', end: '17:00' }, weeklyRule([2]));
        const withdrawn = elsewhere(server, '2026-10-13', { ...TWO, start: '17:00', end: '18:00' }, weeklyRule([2]));
        server.saveRecurrence(
            '2026-10-13',
            server.read('2026-10-13').version,
            [{ start: '17:00', end: '18:00', kind: 'empty', ticket: null, comment: null }],
            null,
            seen(server, withdrawn),
        );
        await open(server).refresh();

        expect(server.recurrence(withdrawn)?.until).toBe('2026-10-12');
        expect([...server.read(TODAY).ongoing.keys()]).toEqual([daily, later]);
        expect(server.read(TODAY).recurrences.has(ending)).toBe(true);
    });
});

describe('DaySession, un créneau déjà pris', () => {
    it('refuse à la création une récurrence sur le créneau d’une autre, sans rien écrire ni ranger', async () => {
        const server = new FakeDayServer(TODAY);
        dailyOn(server);
        const session = open(server);
        const writes = server.writes.length;

        // Le jeudi de 09:15 à 09:45 : le Daily y revient de 09:00 à 09:30.
        await expect(
            session.saveRecurrence(
                fill([quarterPast, minutes('09:30')], work('OPS-7', 'Revue')),
                weeklyRule([4]),
                null,
            ),
        ).resolves.toEqual(takenBy('Daily'));
        expect(server.writes).toHaveLength(writes);
        expect(server.allRecurrences()).toHaveLength(1);
        expect(session.current().canUndo).toBe(false);
        expect(rangesOf(session.current().day.grid)).toEqual(rangesOf(server.read(TODAY).grid));
    });

    it('nomme une pause, ou une récurrence sans commentaire par son ticket', async () => {
        const server = new FakeDayServer(TODAY);
        elsewhere(
            server,
            MONDAY,
            { start: '12:30', end: '13:30', kind: 'pause', ticket: null, comment: null },
            weeklyRule(WEEK),
        );
        elsewhere(server, MONDAY, { ...TWO, comment: null }, weeklyRule([1, 3]));
        const session = open(server);

        await expect(
            session.saveRecurrence(fill([minutes('13:15')], work('OPS-9')), { ...monthlyDate(6), until: null }, null),
        ).resolves.toEqual(takenBy(null));
        await expect(
            session.saveRecurrence(fill([minutes('14:45')], work('OPS-9')), weeklyRule([3], null, 2), null),
        ).resolves.toEqual(takenBy('OPS-7'));
    });

    it('ne compte pas un conflit qui ne tomberait qu’aujourd’hui : la fois d’aujourd’hui est celle qu’on écrit', async () => {
        const server = new FakeDayServer(TODAY);
        dailyOn(server);
        const session = open(server);

        await expect(
            session.saveRecurrence(fill(DAILY_QUARTERS, work('OPS-7', 'Revue')), weeklyRule(WEEK, TODAY), null),
        ).resolves.toMatchObject({ kind: 'saved' });
        await expect(
            session.saveRecurrence(fill([minutes('11:00')], work('OPS-7', 'Revue')), weeklyRule(WEEK, WEDNESDAY), null),
        ).resolves.toMatchObject({ kind: 'saved' });
    });

    it('accepte une semaine sur deux les semaines où l’autre ne revient pas : l’alternance', async () => {
        const server = new FakeDayServer(TODAY);
        // La rétrospective, un mardi sur deux à partir du 13.
        elsewhere(server, '2026-10-13', TWO, weeklyRule([2], null, 2));
        const session = open(server);

        await expect(
            session.saveRecurrence(fill(TWO_QUARTERS, work('OPS-8', 'Démo')), weeklyRule([2]), null),
        ).resolves.toEqual(takenBy('Rétrospective'));
        await expect(
            session.saveRecurrence(fill(TWO_QUARTERS, work('OPS-8', 'Démo')), weeklyRule([2], null, 2), null),
        ).resolves.toMatchObject({ kind: 'saved' });
        // Trois semaines plus tard, chacune s'est posée ses semaines.
        server.setToday('2026-10-27');
        server.pose('2026-10-27');
        const posed = (date: string) => rangesOf(server.read(date).grid).map((range) => range.slice(0, 4));
        expect(posed('2026-10-13')).toEqual([['14:00', '15:00', 'work', 'OPS-7']]);
        expect(posed('2026-10-20')).toEqual([['14:00', '15:00', 'work', 'OPS-8']]);
        expect(posed('2026-10-27')).toEqual([['14:00', '15:00', 'work', 'OPS-7']]);
    });

    it('refuse un rythme changé qui prendrait le créneau d’une autre, et la laisse telle quelle', async () => {
        const server = new FakeDayServer(TODAY);
        const session = open(server);
        await session.saveRecurrence(fill(TWO_QUARTERS, RETRO), weeklyRule([2]), null);
        const tuesday = server.allRecurrences()[0]?.id ?? '';
        const thursday = elsewhere(server, '2026-10-08', { ...TWO, comment: 'Jeudi' }, weeklyRule([4]));

        await expect(
            session.saveRecurrence(fill(TWO_QUARTERS, RETRO), weeklyRule([2, 4]), seen(server, tuesday)),
        ).resolves.toEqual(takenBy('Jeudi'));
        // Un autre commentaire avec les suivantes, au même rythme : rien n'est pris de plus.
        await expect(
            session.saveRecurrence(fill(TWO_QUARTERS, work('OPS-7', 'Rétro')), weeklyRule([2]), seen(server, tuesday)),
        ).resolves.toMatchObject({ kind: 'saved' });
        expect(server.recurrence(thursday)?.until).toBeNull();
        expect(server.allRecurrences()).toHaveLength(3);
    });

    it('refuse d’un jour passé un rythme changé qui prendrait le créneau d’une autre à partir de demain', async () => {
        const server = new FakeDayServer();
        const created = server.saveRecurrence(TODAY, 0, [TWO], weeklyRule([2]), null);
        expect(created.status).toBe('saved');
        const tuesday = server.allRecurrences()[0]?.id ?? '';
        server.setToday(WEDNESDAY);
        const thursday = elsewhere(server, '2026-10-08', { ...TWO, comment: 'Jeudi' }, weeklyRule([4]));
        const session = open(server);

        await expect(
            session.saveRecurrence(fill(TWO_QUARTERS, RETRO), weeklyRule([2, 4]), seen(server, tuesday)),
        ).resolves.toEqual(takenBy('Jeudi'));
        expect(server.recurrence(tuesday)?.until).toBeNull();
        expect(server.recurrence(thursday)?.until).toBeNull();
        // Ses fois du mardi seulement, chaque mois : le 1er mardi de novembre n'est pas un jeudi.
        await expect(
            session.saveRecurrence(
                fill(TWO_QUARTERS, RETRO),
                { ...monthlyDate(6), until: null },
                seen(server, tuesday),
            ),
        ).resolves.toEqual(takenBy('Jeudi'));
        await expect(
            session.saveRecurrence(fill(TWO_QUARTERS, RETRO), weeklyRule([1, 2]), seen(server, tuesday)),
        ).resolves.toMatchObject({ kind: 'saved' });
    });

    it('refuse une fin repoussée sur le créneau d’une autre, et laisse une fin avancer', async () => {
        const server = new FakeDayServer(TODAY);
        const session = open(server);
        await session.saveRecurrence(fill(TWO_QUARTERS, RETRO), weeklyRule([2], '2026-10-13'), null);
        const tuesday = server.allRecurrences()[0]?.id ?? '';
        elsewhere(server, '2026-10-20', { ...TWO, comment: 'Suite' }, weeklyRule([2]));

        await expect(
            session.saveRecurrence(fill(TWO_QUARTERS, RETRO), weeklyRule([2]), seen(server, tuesday)),
        ).resolves.toEqual(takenBy('Suite'));
        await expect(
            session.saveRecurrence(fill(TWO_QUARTERS, RETRO), weeklyRule([2], '2026-10-20'), seen(server, tuesday)),
        ).resolves.toEqual(takenBy('Suite'));
        expect(server.recurrence(tuesday)?.until).toBe('2026-10-13');
        await expect(
            session.saveRecurrence(fill(TWO_QUARTERS, RETRO), weeklyRule([2], '2026-10-19'), seen(server, tuesday)),
        ).resolves.toMatchObject({ kind: 'saved' });
        await expect(
            session.saveRecurrence(fill(TWO_QUARTERS, RETRO), weeklyRule([2], TODAY), seen(server, tuesday)),
        ).resolves.toMatchObject({ kind: 'saved' });
        expect(server.recurrence(tuesday)?.until).toBe(TODAY);
    });

    it('refuse d’un jour passé une fin repoussée sur le créneau d’une autre', async () => {
        const server = new FakeDayServer();
        server.saveRecurrence(TODAY, 0, [TWO], weeklyRule([2], '2026-10-13'), null);
        const tuesday = server.allRecurrences()[0]?.id ?? '';
        server.setToday(WEDNESDAY);
        elsewhere(server, '2026-10-20', { ...TWO, comment: 'Suite' }, weeklyRule([2]));

        await expect(
            open(server).saveRecurrence(fill(TWO_QUARTERS, RETRO), weeklyRule([2]), seen(server, tuesday)),
        ).resolves.toEqual(takenBy('Suite'));
        expect(server.recurrence(tuesday)?.until).toBe('2026-10-13');
    });

    it('n’annule pas un arrêt qui ramènerait la récurrence sur un créneau pris depuis ailleurs', async () => {
        const server = new FakeDayServer(TODAY);
        const session = open(server);
        await session.saveRecurrence(fill(TWO_QUARTERS, RETRO), weeklyRule([2]), null);
        const tuesday = server.allRecurrences()[0]?.id ?? '';
        // Arrêtée avec les suivantes : née aujourd'hui, elle est retirée.
        await session.saveRecurrence(fill(TWO_QUARTERS, RETRO), null, seen(server, tuesday));
        expect(server.recurrence(tuesday)?.until).toBe(MONDAY);
        // Un autre onglet prend son créneau le mardi suivant.
        elsewhere(server, '2026-10-13', { ...TWO, comment: 'Suite' }, weeklyRule([2]));
        const version = server.read(TODAY).version;

        await expect(session.undo()).resolves.toEqual({ kind: 'conflict' });
        expect(server.recurrence(tuesday)?.until).toBe(MONDAY);
        expect(server.read(TODAY).version).toBe(version);
        // Le geste ne se défera plus : il est oublié, plutôt que de redire le refus à chaque fois.
        expect(session.current().canUndo).toBe(false);
    });

    it('ne rétablit pas une création sur un créneau pris depuis ailleurs', async () => {
        const server = new FakeDayServer(TODAY);
        const session = open(server);
        await session.saveRecurrence(fill(TWO_QUARTERS, RETRO), weeklyRule([2]), null);
        const tuesday = server.allRecurrences()[0]?.id ?? '';
        await session.undo();
        expect(server.recurrence(tuesday)?.until).toBe(MONDAY);
        elsewhere(server, '2026-10-13', { ...TWO, comment: 'Suite' }, weeklyRule([2]));

        await expect(session.redo()).resolves.toEqual({ kind: 'conflict' });
        expect(server.recurrence(tuesday)?.until).toBe(MONDAY);
        expect(rangesOf(server.read(TODAY).grid)).toEqual([]);
    });

    it('n’annule pas l’effacement d’une fois dont une autre a pris le créneau depuis', () => {
        const server = new FakeDayServer(TODAY);
        // La rétrospective, un mardi sur deux du 13 au 27 ; sa fois du 27 effacée, cette fois
        // seulement. La démo, chaque mardi depuis le 20, passe grâce à ce saut.
        const retro = elsewhere(server, '2026-10-13', TWO, weeklyRule([2], '2026-10-27', 2));
        const date = '2026-10-27';
        const erase: SlotChange = { start: '14:00', end: '15:00', kind: 'empty', ticket: null, comment: null };
        expect(server.changeSlots(date, server.read(date).version, [erase]).status).toBe('saved');
        const demo = elsewhere(server, '2026-10-20', { ...TWO, ticket: 'OPS-8', comment: 'Démo' }, weeklyRule([2]));
        const undo: SlotChange = { ...TWO, recurrence: retro };
        const writes = server.writes.length;

        expect(server.changeSlots(date, server.read(date).version, [undo], [], true).status).toBe('stale');
        expect(server.writes).toHaveLength(writes);
        expect(rangesOf(server.read(date).grid)).toEqual([['14:00', '15:00', 'work', 'OPS-8', 'Démo', demo]]);

        // La fois de la démo effacée à son tour : le créneau est libre, annuler passe.
        expect(server.changeSlots(date, server.read(date).version, [erase]).status).toBe('saved');
        expect(server.changeSlots(date, server.read(date).version, [undo], [], true).status).toBe('saved');
        expect(rangesOf(server.read(date).grid)).toEqual([['14:00', '15:00', 'work', 'OPS-7', 'Rétrospective', retro]]);
        expect(server.allSkips()).toEqual([`${demo} ${date}`]);
    });

    it('annule encore l’effacement d’une fois que croisait déjà une récurrence d’avant le refus', () => {
        const server = new FakeDayServer(TODAY);
        let daily = '';
        server.beforeClashRule(() => {
            daily = elsewhere(server, TODAY, DAILY, weeklyRule(WEEK));
            elsewhere(server, TODAY, { ...TWO, start: '09:15', end: '10:00' }, weeklyRule(WEEK));
        });
        const erase: SlotChange = { start: '09:00', end: '09:30', kind: 'empty', ticket: null, comment: null };
        expect(server.changeSlots(WEDNESDAY, server.read(WEDNESDAY).version, [erase]).status).toBe('saved');

        expect(
            server.changeSlots(WEDNESDAY, server.read(WEDNESDAY).version, [{ ...DAILY, recurrence: daily }], [], true)
                .status,
        ).toBe('saved');
        expect(rangesOf(server.read(WEDNESDAY).grid).map((range) => range.slice(0, 2))).toEqual([
            ['09:00', '09:30'],
            ['09:30', '10:00'],
        ]);
    });

    it('coupe au même rythme sans croiser la récurrence posée sur une fois effacée', () => {
        const server = new FakeDayServer(TODAY);
        // La démo, chaque mardi depuis le 13, sa fois du 27 effacée ; la rétrospective, ce seul
        // mardi 27, à sa place.
        const demo = elsewhere(server, '2026-10-13', { ...TWO, ticket: 'OPS-8', comment: 'Démo' }, weeklyRule([2]));
        const erase: SlotChange = { start: '14:00', end: '15:00', kind: 'empty', ticket: null, comment: null };
        expect(server.changeSlots('2026-10-27', server.read('2026-10-27').version, [erase]).status).toBe('saved');
        const retro = elsewhere(server, '2026-10-27', TWO, weeklyRule([2], '2026-10-27'));

        // Le 20, un autre commentaire avec les suivantes : la fenêtre n'annonce rien, le serveur
        // non plus.
        const cut = server.saveRecurrence(
            '2026-10-20',
            server.read('2026-10-20').version,
            [{ ...TWO, ticket: 'OPS-8', comment: 'Démo de sprint' }],
            weeklyRule([2]),
            seen(server, demo),
        );

        expect(cut.status).toBe('saved');
        expect(server.allRecurrences().at(-1)).toMatchObject({
            content: { kind: 'work', ticket: 'OPS-8', comment: 'Démo de sprint' },
            skipped: ['2026-10-27'],
        });
        expect(rangesOf(server.read('2026-10-27').grid)).toEqual([
            ['14:00', '15:00', 'work', 'OPS-7', 'Rétrospective', retro],
        ]);
    });

    it('coupe au même rythme sans ramener une fois effacée, et annuler puis rétablir la gardent effacée', async () => {
        const server = new FakeDayServer(TODAY);
        const demo = elsewhere(server, '2026-10-13', { ...TWO, ticket: 'OPS-8', comment: 'Démo' }, weeklyRule([2]));
        const erase: SlotChange = { start: '14:00', end: '15:00', kind: 'empty', ticket: null, comment: null };
        expect(server.changeSlots('2026-10-27', server.read('2026-10-27').version, [erase]).status).toBe('saved');
        const session = new DaySession(server.read('2026-10-20'), server.api(), tabMemory(memoryStorage()));

        await expect(
            session.saveRecurrence(
                fill(TWO_QUARTERS, work('OPS-8', 'Démo de sprint')),
                weeklyRule([2]),
                seen(server, demo),
            ),
        ).resolves.toMatchObject({ kind: 'saved' });
        const cut = server.allRecurrences().at(-1)?.id ?? '';
        expect(server.recurrence(cut)?.skipped).toEqual(['2026-10-27']);
        expect(rangesOf(server.read('2026-10-27').grid)).toEqual([]);
        expect(rangesOf(server.read('2026-11-03').grid)).toEqual([
            ['14:00', '15:00', 'work', 'OPS-8', 'Démo de sprint', cut],
        ]);

        await expect(session.undo()).resolves.toMatchObject({ kind: 'saved' });
        expect(server.recurrence(demo)?.skipped).toEqual(['2026-10-27']);
        expect(rangesOf(server.read('2026-10-27').grid)).toEqual([]);
        expect(rangesOf(server.read('2026-11-03').grid)).toEqual([['14:00', '15:00', 'work', 'OPS-8', 'Démo', demo]]);

        await expect(session.redo()).resolves.toMatchObject({ kind: 'saved' });
        expect(rangesOf(server.read('2026-10-27').grid)).toEqual([]);
        expect(rangesOf(server.read('2026-11-03').grid)).toEqual([
            ['14:00', '15:00', 'work', 'OPS-8', 'Démo de sprint', cut],
        ]);
    });

    it('annule et rétablit sans refus ce qui ne prend rien de plus', async () => {
        const server = new FakeDayServer(TODAY);
        const session = open(server);
        await session.saveRecurrence(fill(TWO_QUARTERS, RETRO), weeklyRule([2], '2026-10-13'), null);
        const tuesday = server.allRecurrences()[0]?.id ?? '';
        await session.saveRecurrence(fill(TWO_QUARTERS, RETRO), weeklyRule([2], TODAY), seen(server, tuesday));
        // Ailleurs, une autre prend le créneau à partir du 20 : la fin du 13 n'y va pas.
        elsewhere(server, '2026-10-20', { ...TWO, comment: 'Suite' }, weeklyRule([2]));

        await expect(session.undo()).resolves.toMatchObject({ kind: 'saved' });
        expect(server.recurrence(tuesday)?.until).toBe('2026-10-13');
        await expect(session.redo()).resolves.toMatchObject({ kind: 'saved' });
        expect(server.recurrence(tuesday)?.until).toBe(TODAY);
    });
});
