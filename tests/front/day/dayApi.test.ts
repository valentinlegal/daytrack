import { describe, expect, it } from 'vitest';

import { httpDayApi } from '../../../assets/day/dayApi';
import { answering, answeringFetch } from '../fakeServer';

const DAY = {
    date: '2026-10-06',
    version: 3,
    objective: 450,
    habitualObjective: 450,
    working: true,
    declaredOff: false,
    workingDays: [1, 2, 3, 4, 5],
    blocks: [{ start: '09:00', end: '09:30', kind: 'work', ticket: 'SHOP-482', comment: 'Revue' }],
    figures: { worked: 30, remaining: 420, balance: -420, projectedEnd: '16:30' },
    send: {
        state: 'nothing',
        sentAt: null,
        attemptedAt: null,
        failure: null,
        inJira: {},
        outcomes: {},
        removed: [],
        vanished: [],
    },
};

describe('httpDayApi', () => {
    it('lit une journée', async () => {
        const { api, sent } = answering(httpDayApi, 200, DAY);

        const day = await api.read('2026-10-06');

        expect(sent[0]?.url).toBe('/api/days/2026-10-06');
        expect(day.version).toBe(3);
        expect(day.grid.workedMinutes()).toBe(30);
    });

    it('lève sur une journée qui ne se lit pas, ou mal formée', async () => {
        await expect(answering(httpDayApi, 404, { error: 'not_found' }).api.read('2026-10-06')).rejects.toThrow();
        await expect(answering(httpDayApi, 500, '').api.read('2026-10-06')).rejects.toThrow();
        await expect(answering(httpDayApi, 200, { ...DAY, blocks: null }).api.read('2026-10-06')).rejects.toThrow();
    });

    it('écrit un geste en JSON, avec la version vue', async () => {
        const { api, sent } = answering(httpDayApi, 200, { ...DAY, version: 4 });
        const changes = [{ start: '09:00', end: '09:30', kind: 'work', ticket: 'SHOP-482', comment: 'Revue' }] as const;

        const result = await api.changeSlots('2026-10-06', 3, changes);

        expect(result.status).toBe('saved');
        expect(sent[0]?.url).toBe('/api/days/2026-10-06/slots');
        expect(sent[0]?.init?.method).toBe('PATCH');
        expect(new Headers(sent[0]?.init?.headers).get('Content-Type')).toBe('application/json');
        expect(JSON.parse(sent[0]?.init?.body as string)).toEqual({ version: 3, changes });
        // Partie au moment où l'on quitte la page, l'écriture arrive quand même.
        expect(sent[0]?.init?.keepalive).toBe(true);
    });

    it('n’envoie en requête qui survit à la page que ce que le navigateur accepte : 64 Kio', async () => {
        const { api, sent } = answering(httpDayApi, 200, DAY);
        const long = Array.from({ length: 52 }, () => ({
            start: '09:00',
            end: '09:15',
            kind: 'work' as const,
            ticket: 'OPS-1',
            comment: '€'.repeat(480),
        }));

        await api.changeSlots('2026-10-06', 3, long);

        expect(sent[0]?.init?.keepalive).toBe(false);
    });

    it('rend la journée à jour quand elle avait changé ailleurs', async () => {
        const result = await answering(httpDayApi, 409, {
            error: 'stale',
            day: { ...DAY, version: 7 },
        }).api.setObjective('2026-10-06', 3, 480);

        expect(result).toMatchObject({ status: 'stale', day: { version: 7 } });
    });

    it('rend les refus champ par champ', async () => {
        const result = await answering(httpDayApi, 422, {
            error: 'invalid',
            violations: [{ field: 'objective', message: 'Un objectif se règle au quart d’heure.' }],
        }).api.setObjective('2026-10-06', 3, 451);

        expect(result).toEqual({
            status: 'invalid',
            violations: [{ field: 'objective', message: 'Un objectif se règle au quart d’heure.' }],
        });
    });

    it('lève sur une réponse qu’il ne comprend pas, plutôt que de croire ce qu’il a envoyé', async () => {
        await expect(
            answering(httpDayApi, 403, { error: 'cross_origin' }).api.setObjective('2026-10-06', 3, 480),
        ).rejects.toThrow();
        await expect(answering(httpDayApi, 500, '<html>').api.changeSlots('2026-10-06', 3, [])).rejects.toThrow();
        await expect(
            answering(httpDayApi, 422, { error: 'invalid' }).api.setObjective('2026-10-06', 3, 480),
        ).rejects.toThrow();
    });

    it('fait suivre les tickets que décrit la journée, sans gêner sa lecture', async () => {
        const learned: unknown[] = [];
        const tickets = { 'SHOP-482': { title: 'Export CSV', type: 'Story', color: 'vert' } };
        const respond = (status: number, body: unknown) => answeringFetch(status, body).fetcher;
        const learn = (described: unknown) => {
            learned.push(described);
        };

        await httpDayApi(respond(200, { ...DAY, tickets }), learn).read('2026-10-06');
        await httpDayApi(respond(200, { ...DAY, tickets: {} }), learn).changeSlots('2026-10-06', 3, []);
        await httpDayApi(respond(409, { day: { ...DAY, tickets } }), learn).setObjective('2026-10-06', 3, 450);
        // Une description de travers ne coûte qu'un titre.
        expect((await httpDayApi(respond(200, { ...DAY, tickets: 'rien' }), learn).read('2026-10-06')).version).toBe(3);

        expect(learned).toEqual([tickets, {}, tickets]);
    });

    describe('l’envoi sur Jira', () => {
        const tickets = { 'SHOP-482': { title: 'Export CSV', type: 'Story', color: 'vert' } };

        /** L'API des journées, qui note ce qu'elle apprend des tickets. */
        function sending(status: number, body: unknown) {
            const learned: unknown[] = [];
            const { fetcher, sent } = answeringFetch(status, body);
            const api = httpDayApi(fetcher, (described) => {
                learned.push(described);
            });

            return { api, sent, learned };
        }

        it('envoie la version vue, sans survivre à la page, et rend la journée envoyée', async () => {
            const { api, sent, learned } = sending(200, { ...DAY, version: 4, tickets });

            const result = await api.send('2026-10-06', 3);

            expect(result).toMatchObject({ status: 'done', day: { version: 4 } });
            expect(sent[0]?.url).toBe('/api/days/2026-10-06/send');
            expect(sent[0]?.init?.method).toBe('POST');
            expect(JSON.parse(sent[0]?.init?.body as string)).toEqual({ version: 3 });
            expect(sent[0]?.init?.keepalive).toBeUndefined();
            expect(learned).toEqual([tickets]);
        });

        it.each(['stale', 'sending', 'nothing'] as const)(
            'rend la journée à jour quand rien n’est parti : %s',
            async (error) => {
                const { api, learned } = sending(409, { error, day: { ...DAY, version: 7, tickets } });

                await expect(api.send('2026-10-06', 3)).resolves.toMatchObject({
                    status: error,
                    day: { version: 7 },
                });
                expect(learned).toEqual([tickets]);
            },
        );

        it('lève sur un refus qu’il ne connaît pas, sans rien apprendre', async () => {
            const unlinked = sending(409, { error: 'unlinked', day: { ...DAY, tickets } });
            await expect(unlinked.api.send('2026-10-06', 3)).rejects.toThrow('409');
            expect(unlinked.learned).toEqual([]);

            const refused = sending(422, { error: 'invalid', violations: [{ field: 'version', message: 'Non.' }] });
            await expect(refused.api.send('2026-10-06', 3)).rejects.toThrow('422');
            await expect(sending(500, 'Erreur').api.send('2026-10-06', 3)).rejects.toThrow('500');
        });
    });
});
