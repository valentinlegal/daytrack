import { describe, expect, it } from 'vitest';

import { httpDayApi } from '../../../assets/day/dayApi';
import { LAST_WEEK, monthlyDate, monthlyWeekday, weekly } from '../../../assets/grid/recurrence';
import { answering, answeringFetch } from '../fakeServer';
import { minutes, weeklyRule } from '../grid/support';

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

    describe('les récurrences', () => {
        const ID = '01900000-0000-7000-8000-000000000001';
        /** Ce qu'une fenêtre en a vu. */
        const SEEN = { id: ID, weekdays: [1, 2, 3, 4, 5], until: null };
        const LINKED = {
            ...DAY,
            blocks: [
                { start: '09:00', end: '09:30', kind: 'work', ticket: 'OPS-12', comment: 'Daily', recurrence: ID },
                { start: '12:30', end: '13:00', kind: 'pause', ticket: null, comment: null, recurrence: null },
            ],
            recurrences: {
                [ID]: {
                    start: '09:00',
                    end: '09:30',
                    kind: 'weekly',
                    weekdays: [1, 2, 3, 4, 5],
                    everyWeeks: 1,
                    monthWeek: null,
                    monthDay: null,
                    firstDay: '2026-10-05',
                    until: null,
                    slot: { kind: 'work', ticket: 'OPS-12', comment: 'Daily' },
                },
            },
            recurrencesHeld: false,
        };
        const RETRO = '01900000-0000-7000-8000-000000000002';
        /** Une autre, un jeudi sur deux, qu'on ne voit pas ce jour-là mais qui va encore jusqu'à lui. */
        const ONGOING = {
            ...LINKED,
            ongoing: {
                [ID]: LINKED.recurrences[ID],
                [RETRO]: {
                    start: '14:00',
                    end: '15:00',
                    kind: 'weekly',
                    weekdays: [4],
                    everyWeeks: 2,
                    monthWeek: null,
                    monthDay: null,
                    firstDay: '2026-10-15',
                    until: null,
                    slot: { kind: 'work', ticket: 'OPS-7', comment: 'Rétrospective' },
                },
                pause: {
                    ...LINKED.recurrences[ID],
                    kind: 'monthly_date',
                    weekdays: [],
                    monthDay: 16,
                    slot: { kind: 'pause', ticket: null, comment: null },
                },
            },
        };
        const changes = [
            { start: '09:00', end: '09:30', kind: 'work', ticket: 'OPS-12', comment: 'Daily', recurrence: ID },
        ] as const;

        it('lit le lien de chaque bloc et les récurrences de la journée', async () => {
            const day = await answering(httpDayApi, 200, LINKED).api.read('2026-10-06');

            expect(day.grid.blocks().map((block) => block.content.recurrence)).toEqual([ID, null]);
            expect(day.recurrences.get(ID)?.rhythm.weekdays).toEqual([1, 2, 3, 4, 5]);
            expect(day.recurrencesHeld).toBe(false);
        });

        it('lit ce que pose chaque récurrence, et toutes celles qui vont encore jusqu’à ce jour', async () => {
            const day = await answering(httpDayApi, 200, ONGOING).api.read('2026-10-06');

            expect(day.recurrences.get(ID)?.content).toEqual({ kind: 'work', ticket: 'OPS-12', comment: 'Daily' });
            expect([...day.ongoing.keys()]).toEqual([ID, RETRO, 'pause']);
            expect(day.ongoing.get(RETRO)).toMatchObject({
                start: minutes('14:00'),
                end: minutes('15:00'),
                rhythm: weekly([4], 2),
                firstDay: '2026-10-15',
                content: { kind: 'work', ticket: 'OPS-7', comment: 'Rétrospective' },
            });
            expect(day.ongoing.get('pause')).toMatchObject({ rhythm: monthlyDate(16), content: { kind: 'pause' } });
            // Une journée d'avant ce champ n'en a aucune.
            expect((await answering(httpDayApi, 200, LINKED).api.read('2026-10-06')).ongoing.size).toBe(0);
        });

        it('lit une journée d’avant les récurrences, sans lien ni récurrence', async () => {
            const day = await answering(httpDayApi, 200, DAY).api.read('2026-10-06');

            expect(day.recurrences.size).toBe(0);
            expect(day.grid.blocks()[0]?.content.recurrence).toBeNull();
        });

        it('lève sur un lien ou une récurrence de travers', async () => {
            const block = LINKED.blocks[0];
            for (const json of [
                { ...LINKED, blocks: [{ ...block, recurrence: 7 }] },
                { ...LINKED, recurrences: [] },
                { ...LINKED, recurrences: { [ID]: { ...LINKED.recurrences[ID], kind: 'daily' } } },
                // Une récurrence ne se nomme pas sans ce qu'elle pose.
                { ...LINKED, recurrences: { [ID]: { ...LINKED.recurrences[ID], slot: undefined } } },
                { ...LINKED, recurrences: { [ID]: { ...LINKED.recurrences[ID], slot: { kind: 'empty' } } } },
                {
                    ...LINKED,
                    recurrences: {
                        [ID]: { ...LINKED.recurrences[ID], slot: { kind: 'work', ticket: null, comment: null } },
                    },
                },
                { ...ONGOING, ongoing: [] },
                { ...ONGOING, ongoing: { [RETRO]: { ...ONGOING.ongoing[RETRO], everyWeeks: '2' } } },
            ]) {
                await expect(answering(httpDayApi, 200, json).api.read('2026-10-06')).rejects.toThrow(TypeError);
            }
        });

        it('n’envoie les fins à rendre qu’avec annuler et rétablir', async () => {
            const { api, sent } = answering(httpDayApi, 200, LINKED);
            const untils = [{ recurrence: ID, from: null, to: '2026-10-05' }];

            await api.changeSlots('2026-10-06', 3, changes);
            await api.changeSlots('2026-10-06', 3, changes, []);
            await api.changeSlots('2026-10-06', 3, changes, untils);

            expect(sent.map((request) => JSON.parse(request.init?.body as string) as unknown)).toEqual([
                { version: 3, changes },
                { version: 3, changes },
                { version: 3, changes, recurrences: untils },
            ]);
        });

        it('ne dit qu’il rend la journée d’avant que quand c’est vrai : annuler', async () => {
            const { api, sent } = answering(httpDayApi, 200, LINKED);
            const untils = [{ recurrence: ID, from: null, to: '2026-10-05' }];

            await api.changeSlots('2026-10-06', 3, changes);
            await api.changeSlots('2026-10-06', 3, changes, [], false);
            await api.changeSlots('2026-10-06', 3, changes, [], true);
            await api.changeSlots('2026-10-06', 3, changes, untils, true);

            expect(sent.map((request) => JSON.parse(request.init?.body as string) as unknown)).toEqual([
                { version: 3, changes },
                { version: 3, changes },
                { version: 3, changes, restores: true },
                { version: 3, changes, recurrences: untils, restores: true },
            ]);
        });

        it('enregistre la récurrence de la fenêtre, et rend la journée et les fins d’avant et d’après', async () => {
            const untils = [{ recurrence: ID, before: '2026-10-05', after: null }];
            const { api, sent } = answering(httpDayApi, 200, { ...LINKED, version: 4, untils });
            const written = [
                { start: '09:00', end: '09:30', kind: 'work', ticket: 'OPS-12', comment: 'Daily' },
            ] as const;

            const result = await api.saveRecurrence('2026-10-06', 3, written, weeklyRule([1, 2, 3, 4, 5]), null);

            expect(result).toMatchObject({ status: 'saved', day: { version: 4 }, untils });
            expect(sent[0]?.url).toBe('/api/days/2026-10-06/recurrence');
            expect(sent[0]?.init?.method).toBe('PUT');
            expect(sent[0]?.init?.keepalive).toBe(true);
            expect(JSON.parse(sent[0]?.init?.body as string)).toEqual({
                version: 3,
                changes: written,
                recurrence: {
                    kind: 'weekly',
                    weekdays: [1, 2, 3, 4, 5],
                    everyWeeks: 1,
                    monthWeek: null,
                    monthDay: null,
                    until: null,
                },
                replaces: null,
            });
        });

        it('envoie le rythme entier d’une règle au mois', async () => {
            const { api, sent } = answering(httpDayApi, 200, { ...LINKED, version: 4, untils: [] });

            await api.saveRecurrence('2026-10-16', 3, [], { ...monthlyWeekday(5, 3), until: '2027-06-30' }, null);
            await api.saveRecurrence('2026-10-30', 3, [], { ...monthlyWeekday(5, LAST_WEEK), until: null }, null);
            await api.saveRecurrence('2026-10-16', 3, [], { ...monthlyDate(16), until: null }, null);

            expect(
                sent.map((request) => (JSON.parse(request.init?.body as string) as { recurrence: unknown }).recurrence),
            ).toEqual([
                {
                    kind: 'monthly_weekday',
                    weekdays: [5],
                    everyWeeks: 1,
                    monthWeek: 3,
                    monthDay: null,
                    until: '2027-06-30',
                },
                { kind: 'monthly_weekday', weekdays: [5], everyWeeks: 1, monthWeek: -1, monthDay: null, until: null },
                { kind: 'monthly_date', weekdays: [], everyWeeks: 1, monthWeek: null, monthDay: 16, until: null },
            ]);
        });

        it('nomme la récurrence coupée dont vient celle qu’on colle, et seulement alors', async () => {
            const { api, sent } = answering(httpDayApi, 200, { ...LINKED, version: 4, untils: [] });

            await api.saveRecurrence('2026-10-07', 3, [], weeklyRule([1, 2, 3, 4, 5]), null, ID);
            await api.saveRecurrence('2026-10-07', 3, [], weeklyRule([1, 2, 3, 4, 5]), null, null);

            expect(
                sent.map((request) => (JSON.parse(request.init?.body as string) as { follows?: string }).follows),
            ).toEqual([ID, undefined]);
        });

        it('dit ce que la fenêtre a vu de la récurrence qu’elle remplace', async () => {
            const { api, sent } = answering(httpDayApi, 200, { ...LINKED, version: 4, untils: [] });
            const seen = { id: ID, weekdays: [1, 2, 3, 4, 5], until: '2026-11-04' };

            await api.saveRecurrence('2026-10-06', 3, [], null, seen);

            expect(JSON.parse(sent[0]?.init?.body as string)).toEqual({
                version: 3,
                changes: [],
                recurrence: null,
                replaces: seen,
            });
        });

        it('rend la journée à jour, ou les refus sous leurs champs', async () => {
            const stale = await answering(httpDayApi, 409, {
                error: 'stale',
                day: { ...LINKED, version: 7 },
            }).api.saveRecurrence('2026-10-06', 3, [], null, SEEN);
            const refused = await answering(httpDayApi, 422, {
                error: 'invalid',
                violations: [
                    { field: 'recurrence.weekdays', message: "Le jeudi n'est plus travaillé. Rechargez la page." },
                ],
            }).api.saveRecurrence('2026-10-06', 3, [], weeklyRule([4]), null);
            const taken = await answering(httpDayApi, 422, {
                error: 'invalid',
                violations: [
                    {
                        field: 'recurrence.rhythm',
                        message: 'Ce créneau est déjà pris par la récurrence «\u{a0}Rétrospective\u{a0}».',
                    },
                ],
            }).api.saveRecurrence('2026-10-06', 3, [], weeklyRule([4]), null);

            expect(stale).toMatchObject({ status: 'stale', day: { version: 7 } });
            expect(refused).toEqual({
                status: 'invalid',
                violations: [
                    { field: 'recurrence.weekdays', message: "Le jeudi n'est plus travaillé. Rechargez la page." },
                ],
            });
            expect(taken).toEqual({
                status: 'invalid',
                violations: [
                    {
                        field: 'recurrence.rhythm',
                        message: 'Ce créneau est déjà pris par la récurrence «\u{a0}Rétrospective\u{a0}».',
                    },
                ],
            });
        });

        it('lève sur des fins qu’il ne comprend pas, plutôt que de ranger un geste qu’annuler raterait', async () => {
            for (const untils of [null, 'rien', [{ recurrence: ID, before: 'hier', after: null }]]) {
                await expect(
                    answering(httpDayApi, 200, { ...LINKED, untils }).api.saveRecurrence(
                        '2026-10-06',
                        3,
                        [],
                        null,
                        SEEN,
                    ),
                ).rejects.toThrow();
            }
        });
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
