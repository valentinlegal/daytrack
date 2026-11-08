import { describe, expect, it } from 'vitest';

import { httpDayApi } from '../../assets/day/dayApi';
import { fill } from '../../assets/grid/changes';
import { tabMemory } from '../../assets/grid/daySession';
import { DaySessions } from '../../assets/grid/daySessions';
import { work } from '../../assets/grid/grid';
import { firstRefusal, refused, serverApi, UNSAVED } from '../../assets/serverApi';
import { memoryStorage, minutes } from './grid/support';

interface Exchange {
    readonly url: string;
    readonly init: RequestInit | undefined;
    /** Rend la réponse : le serveur répond quand le test le décide. */
    readonly answer: (status: number, body?: unknown) => void;
}

/** Un serveur qui garde chaque requête et n'y répond que quand on le lui dit. */
function held() {
    const exchanges: Exchange[] = [];
    const fetcher = ((input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
            exchanges.push({
                url: input instanceof Request ? input.url : input.toString(),
                init,
                answer: (status, body) => {
                    resolve(
                        new Response(
                            body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body),
                            { status },
                        ),
                    );
                },
            });
        })) as typeof fetch;

    return { fetcher, exchanges };
}

/** Un serveur qui répond aussitôt, toujours la même chose. */
function answering(status: number, body?: unknown) {
    const { fetcher, exchanges } = held();
    const answered = ((input: RequestInfo | URL, init?: RequestInit) => {
        const response = fetcher(input, init);
        exchanges.at(-1)?.answer(status, body);

        return response;
    }) as typeof fetch;

    return { server: serverApi(answered), exchanges };
}

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('le client du serveur', () => {
    it('lit une réponse acceptée par le lecteur de son statut', async () => {
        const { server, exchanges } = answering(201, { id: 'a' });

        const read = await server.request('POST', '/api/favorites', { 200: () => 'lu', 201: (body) => body });

        expect(read).toEqual({ id: 'a' });
        expect(exchanges[0]?.init?.method).toBe('POST');
    });

    it('demande du JSON, et écrit en JSON même sans rien à envoyer : le serveur refuse le reste', async () => {
        const { server, exchanges } = answering(200, {});

        await server.read('/api/settings', (body) => body);
        await server.request('DELETE', '/api/favorites/a', { 200: () => null });
        await server.request('PUT', '/api/settings/working-days/3', { 200: () => null }, { body: { worked: true } });

        expect(exchanges.map(({ init }) => init?.headers)).toEqual([
            { Accept: 'application/json' },
            { Accept: 'application/json', 'Content-Type': 'application/json' },
            { Accept: 'application/json', 'Content-Type': 'application/json' },
        ]);
        expect(exchanges.map(({ init }) => init?.body)).toEqual([undefined, undefined, '{"worked":true}']);
    });

    it('transforme un refus en motifs champ par champ', async () => {
        const violations = [
            { field: 'ticket', message: 'Indiquez un ticket.' },
            { field: 'comment', message: 'Un commentaire tient en 500 caractères.' },
        ];
        const { server } = answering(422, { error: 'invalid', violations });

        await expect(server.request('POST', '/api/favorites', { 200: () => null, 422: refused })).resolves.toEqual({
            status: 'invalid',
            violations,
        });
    });

    it('lève sur un refus qui ne dit pas pourquoi', () => {
        expect(() => refused({ error: 'invalid' })).toThrow(TypeError);
        expect(() => refused(null)).toThrow(TypeError);
        expect(() => refused({ violations: [{ field: 'ticket' }] })).toThrow(TypeError);
        expect(() => refused({ violations: [{ field: 'ticket', message: 3 }] })).toThrow(TypeError);
    });

    it('lève sur un statut qu’il n’attend pas, en disant lequel', async () => {
        await expect(
            answering(403, { error: 'cross_origin' }).server.read('/api/days/2026-10-06', String),
        ).rejects.toThrow("L'API a répondu 403 à GET /api/days/2026-10-06.");
        await expect(
            answering(500, '<html>').server.request<unknown>('PATCH', '/api/days/2026-10-06/slots', {
                200: String,
                422: refused,
            }),
        ).rejects.toThrow('500');
        // Un refus n'est lu que là où un refus est prévu.
        await expect(
            answering(422, { violations: [] }).server.request('POST', '/api/days/2026-10-06/send', { 200: String }),
        ).rejects.toThrow('422');
    });

    it('lève sur un corps illisible, sauf celui d’un 204, qui n’en a pas', async () => {
        const readers = { 200: (body: unknown) => body, 204: (body: unknown) => body };

        await expect(answering(200, '<html>').server.request('GET', '/api/version', readers)).rejects.toThrow(
            "L'API a répondu 200 à GET /api/version sans JSON lisible.",
        );
        await expect(answering(200).server.request('GET', '/api/version', readers)).rejects.toThrow(TypeError);
        await expect(answering(200, 'null').server.request('GET', '/api/version', readers)).resolves.toBeNull();
        await expect(answering(204).server.request('POST', '/api/v1-import/seen', readers)).resolves.toBeNull();
    });

    it('lève sur une panne du réseau', async () => {
        const server = serverApi(() => Promise.reject(new TypeError('Failed to fetch')));

        await expect(server.read('/api/version', String)).rejects.toThrow('Failed to fetch');
    });

    it('fait survivre à la page ce que le navigateur accepte : 64 Kio', async () => {
        const { server, exchanges } = answering(200, {});
        const readers = { 200: () => null };

        await server.request('PATCH', '/api/days/2026-10-06/slots', readers, { body: { a: 'x' }, keepalive: true });
        await server.request('PATCH', '/api/days/2026-10-06/slots', readers, {
            body: { a: '€'.repeat(22_000) },
            keepalive: true,
        });
        await server.request('PUT', '/api/settings/habitual-objective', readers, { body: { objective: 450 } });

        expect(exchanges.map(({ init }) => init?.keepalive)).toEqual([true, false, undefined]);
    });

    it('dit sous le champ le premier motif du serveur, ou l’échec quand il n’en donne aucun', () => {
        expect(firstRefusal([{ field: 'objective', message: 'Un objectif se règle au quart d’heure.' }])).toBe(
            'Un objectif se règle au quart d’heure.',
        );
        expect(firstRefusal([])).toBe(UNSAVED);
        expect(UNSAVED).toBe("L'enregistrement n'a pas abouti. Réessayez.");
    });
});

describe('une réponse qui arrive après un changement de jour', () => {
    const nine = minutes('09:00');

    function dayOf(date: string, version: number, blocks: readonly unknown[] = []) {
        return {
            date,
            version,
            objective: 450,
            habitualObjective: 450,
            working: true,
            declaredOff: false,
            workingDays: [1, 2, 3, 4, 5],
            blocks,
            figures: { worked: 0, remaining: 450, balance: -450, projectedEnd: null },
            send: {
                state: 'nothing',
                sentAt: null,
                attemptedAt: null,
                failure: null,
                outcomes: {},
                removed: [],
                inJira: {},
                vanished: [],
            },
            tickets: {},
        };
    }

    it('n’ouvre pas la journée qu’on a quittée avant qu’elle se lise', async () => {
        const { fetcher, exchanges } = held();
        const sessions = new DaySessions(httpDayApi(fetcher), tabMemory(memoryStorage()));

        const monday = sessions.open('2026-10-05');
        const tuesday = sessions.open('2026-10-06');
        await nextTick();
        const read = (date: string) => exchanges.find(({ url }) => url === `/api/days/${date}`);
        read('2026-10-06')?.answer(200, dayOf('2026-10-06', 1));
        read('2026-10-05')?.answer(200, dayOf('2026-10-05', 4));

        await expect(monday).resolves.toBeNull();
        expect((await tuesday)?.current().day.date).toBe('2026-10-06');
    });

    it('n’écrit pas dans la journée affichée le geste parti de celle d’avant', async () => {
        const { fetcher, exchanges } = held();
        const sessions = new DaySessions(httpDayApi(fetcher), tabMemory(memoryStorage()));
        const opening = sessions.open('2026-10-05');
        await nextTick();
        exchanges[0]?.answer(200, dayOf('2026-10-05', 1));
        const monday = await opening;
        if (monday === null) {
            throw new Error('Le lundi ne s’est pas ouvert.');
        }

        const gesture = monday.apply(fill([nine], work('SHOP-482', null)));
        await nextTick();
        const tuesdayOpening = sessions.open('2026-10-06');
        await nextTick();
        expect(exchanges.map(({ url }) => url)).toEqual([
            '/api/days/2026-10-05',
            '/api/days/2026-10-05/slots',
            '/api/days/2026-10-06',
        ]);
        exchanges[2]?.answer(200, dayOf('2026-10-06', 3));
        const tuesday = await tuesdayOpening;
        exchanges[1]?.answer(
            200,
            dayOf('2026-10-05', 2, [{ start: '09:00', end: '09:15', kind: 'work', ticket: 'SHOP-482', comment: null }]),
        );

        await expect(gesture).resolves.toMatchObject({ kind: 'saved' });
        expect(tuesday?.current().day.date).toBe('2026-10-06');
        expect(tuesday?.current().day.grid.at(nine)).toBeNull();
        expect(monday.current().day.grid.at(nine)).toEqual(work('SHOP-482', null));
    });
});
