import { describe, expect, it } from 'vitest';

import { fill } from '../../../assets/grid/changes';
import { DaySession, tabMemory } from '../../../assets/grid/daySession';
import { work } from '../../../assets/grid/grid';
import { FakeDayServer, type Request, type Transport } from './fakeDayServer';
import { memoryStorage, minutes, rangesOf, weeklyRule } from './support';

const TODAY = '2026-10-06';

function open(server: FakeDayServer, transport?: Transport) {
    return new DaySession(server.read(TODAY), server.api(transport), tabMemory(memoryStorage()));
}

describe('DaySession, l’envoi sur Jira', () => {
    it('envoie la journée une fois les gestes d’avant enregistrés : celle qu’on voit', async () => {
        const server = new FakeDayServer();
        const session = open(server);

        const gesture = session.apply(fill([minutes('09:00')], work('SHOP-482')));
        const sent = session.sendToJira();

        await expect(gesture).resolves.toMatchObject({ kind: 'saved' });
        await expect(sent).resolves.toEqual({ kind: 'done' });
        expect(server.writes.map((request) => request.kind)).toEqual(['changeSlots', 'send']);
        expect(session.current().day.send.state).toBe('sent');
    });

    it('ne part pas d’une journée qu’un autre onglet a changée, et se remet dessus', async () => {
        const server = new FakeDayServer();
        const late = open(server);
        await open(server).apply(fill([minutes('09:00')], work('SHOP-482')));

        await expect(late.sendToJira()).resolves.toEqual({ kind: 'stale' });
        expect(late.current().day.version).toBe(1);
        expect(server.writes.map((request) => request.kind)).toEqual(['changeSlots']);
    });

    it('n’envoie rien d’une journée sans ticket', async () => {
        const server = new FakeDayServer();

        await expect(open(server).sendToJira()).resolves.toEqual({ kind: 'nothing' });
    });

    it('relit la journée quand le serveur ne répond pas : l’envoi a pu partir', async () => {
        const server = new FakeDayServer();
        await open(server).apply(fill([minutes('09:00')], work('SHOP-482')));
        const lost: Transport = <T>(request: Request, handle: () => T): Promise<T> => {
            const result = handle();

            return request.kind === 'send' ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(result);
        };
        const session = open(server, lost);

        await expect(session.sendToJira()).resolves.toEqual({ kind: 'failed' });
        expect(session.current().day.send.state).toBe('sent');
    });

    it('écrit d’un jour à venir ses fois prévues, liées, avant de l’envoyer : la journée envoyée est celle qu’on voyait', async () => {
        // Lundi, le Daily naît, chaque jour ouvré : mardi, à venir, le prévoit.
        const monday = '2026-10-05';
        const server = new FakeDayServer(monday);
        server.saveRecurrence(
            monday,
            0,
            [{ start: '09:00', end: '09:30', kind: 'work', ticket: 'OPS-12', comment: 'Daily' }],
            weeklyRule([1, 2, 3, 4, 5]),
            null,
        );
        const id = server.allRecurrences()[0]?.id;
        const session = open(server);
        await session.apply(fill([minutes('14:00')], work('SHOP-482')));
        const shown = rangesOf(session.current().day.grid);
        expect(shown).toEqual([
            ['09:00', '09:30', 'work', 'OPS-12', 'Daily', id],
            ['14:00', '14:15', 'work', 'SHOP-482', null],
        ]);
        expect(rangesOf(server.saved(TODAY).grid)).toEqual([['14:00', '14:15', 'work', 'SHOP-482', null]]);

        await expect(session.sendToJira()).resolves.toEqual({ kind: 'done' });
        expect(rangesOf(server.saved(TODAY).grid)).toEqual(shown);
        expect(rangesOf(session.current().day.grid)).toEqual(shown);
        expect(session.current().day.send.state).toBe('sent');
        expect(server.writes.filter((request) => request.date === TODAY).map((request) => request.kind)).toEqual([
            'changeSlots',
            'pose',
            'send',
        ]);
    });

    it('ne part pas d’un jour à venir dont un autre onglet a arrêté la récurrence', async () => {
        const monday = '2026-10-05';
        const server = new FakeDayServer(monday);
        const daily = { start: '09:00', end: '09:30', kind: 'work', ticket: 'OPS-12', comment: 'Daily' } as const;
        server.saveRecurrence(monday, 0, [daily], weeklyRule([1, 2, 3, 4, 5]), null);
        const id = server.allRecurrences()[0]?.id ?? '';
        const session = open(server);
        server.saveRecurrence(monday, server.read(monday).version, [daily], null, {
            id,
            weekdays: [1, 2, 3, 4, 5],
            until: null,
        });

        await expect(session.sendToJira()).resolves.toEqual({ kind: 'stale' });
        expect(rangesOf(session.current().day.grid)).toEqual([]);
        expect(server.writes.filter((request) => request.date === TODAY)).toEqual([]);
    });

    it('relit la journée qu’un autre onglet envoie', async () => {
        const server = new FakeDayServer();
        const shown = open(server);
        await shown.apply(fill([minutes('09:00')], work('SHOP-482')));
        await open(server).sendToJira();

        expect(shown.current().day.send.state).toBe('unsent');
        await shown.refresh();
        expect(shown.current().day.send.state).toBe('sent');
    });
});
