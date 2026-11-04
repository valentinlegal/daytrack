import { describe, expect, it } from 'vitest';

import { fill } from '../../../assets/grid/changes';
import { DaySession, tabMemory } from '../../../assets/grid/daySession';
import { work } from '../../../assets/grid/grid';
import { FakeDayServer, type Request, type Transport } from './fakeDayServer';
import { memoryStorage, minutes } from './support';

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
