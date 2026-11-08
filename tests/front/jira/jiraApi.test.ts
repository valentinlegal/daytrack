import { describe, expect, it } from 'vitest';

import { httpJiraApi } from '../../../assets/jira/jiraApi';
import { describedTicket, readTickets } from '../../../assets/jira/ticketInfo';
import { answering, type SentRequest } from '../fakeServer';

const CONNECTION = {
    linked: true,
    site: 'https://exemple.atlassian.net',
    email: 'camille.martin@exemple.fr',
    account: 'Camille Martin',
    refusal: null,
    missingScopes: [],
};

const request = ({ url, init }: SentRequest) =>
    `${String(init?.method)} ${url} ${typeof init?.body === 'string' ? init.body : 'null'}`;

describe("l'API de Jira", () => {
    it('envoie le jeton dans le corps, jamais dans l’adresse, et seulement s’il a été collé', async () => {
        const { api, sent } = answering(httpJiraApi, 200, CONNECTION);
        const form = { site: 'https://jira', email: 'dev@daytrack.test' };

        await api.link({ ...form, token: 'jeton-colle' });
        await api.link({ ...form, token: null });

        expect(sent.map(request)).toEqual([
            'PUT /api/jira {"site":"https://jira","email":"dev@daytrack.test","token":"jeton-colle"}',
            'PUT /api/jira {"site":"https://jira","email":"dev@daytrack.test"}',
        ]);
        for (const { init } of sent) {
            expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
        }
    });

    it('rend le compte d’un essai réussi, ou les refus champ par champ', async () => {
        const form = { site: 'https://jira', email: 'dev@daytrack.test', token: 'x' };
        const violations = [{ field: 'token', message: 'Jira refuse cette adresse e-mail ou ce jeton.' }];

        expect(await answering(httpJiraApi, 200, { account: 'Camille Martin' }).api.test(form)).toEqual({
            status: 'connected',
            account: 'Camille Martin',
        });
        expect(await answering(httpJiraApi, 422, { violations }).api.test(form)).toEqual({
            status: 'invalid',
            violations,
        });
        expect(await answering(httpJiraApi, 422, { violations }).api.link(form)).toEqual({
            status: 'invalid',
            violations,
        });
        await expect(answering(httpJiraApi, 500, {}).api.link(form)).rejects.toThrow();
    });

    it('lit la connexion enregistrée, ou son absence', async () => {
        expect(await answering(httpJiraApi, 200, { linked: false }).api.connection()).toBeNull();
        expect(
            await answering(httpJiraApi, 200, {
                ...CONNECTION,
                refusal: 'missing_scope',
                missingScopes: ['read:jira-user'],
            }).api.connection(),
        ).toEqual({
            site: CONNECTION.site,
            email: CONNECTION.email,
            account: 'Camille Martin',
            refusal: 'missing_scope',
            missingScopes: ['read:jira-user'],
        });
        await expect(answering(httpJiraApi, 200, { site: 'https://jira' }).api.connection()).rejects.toThrow();
    });

    it('dit ce que la vérification a donné, et le périmètre qui manque', async () => {
        expect(
            await answering(httpJiraApi, 200, {
                status: 'missing_scope',
                account: null,
                missingScopes: ['read:jira-user'],
            }).api.check(),
        ).toEqual({ status: 'missing_scope', account: null, missingScopes: ['read:jira-user'] });
        expect(
            await answering(httpJiraApi, 200, { status: 'connected', account: 'Camille Martin' }).api.check(),
        ).toEqual({
            status: 'connected',
            account: 'Camille Martin',
            missingScopes: [],
        });
        await expect(answering(httpJiraApi, 200, { status: 'autre chose' }).api.check()).rejects.toThrow();
    });

    it('cherche un ticket par son identifiant, codé dans l’adresse', async () => {
        const { api, sent } = answering(httpJiraApi, 200, {
            status: 'found',
            ticket: { title: 'Export CSV', type: 'Story', color: 'vert' },
            refusal: null,
        });

        expect(await api.lookup('SHOP-482')).toEqual({
            status: 'found',
            ticket: { title: 'Export CSV', type: 'Story', color: 'vert' },
            refusal: null,
        });
        expect(sent.map(request)).toEqual(['POST /api/tickets/SHOP-482/lookup {}']);

        // Sans l'état du jeton, rien n'en est dit.
        expect(await answering(httpJiraApi, 200, { status: 'not_found', ticket: null }).api.lookup('SHOP-999')).toEqual(
            {
                status: 'not_found',
            },
        );
        for (const status of ['not_found', 'refused', 'missing_scope', 'unreachable'] as const) {
            expect(
                await answering(httpJiraApi, 200, { status, ticket: null, refusal: 'refused' }).api.lookup('SHOP-482'),
            ).toEqual({
                status,
                refusal: 'refused',
            });
        }
        await expect(
            answering(httpJiraApi, 200, { status: 'found', ticket: null }).api.lookup('SHOP-482'),
        ).rejects.toThrow();
    });

    it('fait relire les titres, et rend ce que Jira reproche au jeton', async () => {
        const { api, sent } = answering(httpJiraApi, 200, {
            tickets: { 'SHOP-482': { title: 'Export CSV', type: 'Story', color: 'vert' } },
            refusal: 'refused',
        });

        expect(await api.refresh(['SHOP-482', 'OPS-12'])).toEqual({
            tickets: { 'SHOP-482': { title: 'Export CSV', type: 'Story', color: 'vert' } },
            refusal: 'refused',
        });
        expect(sent.map(request)).toEqual(['POST /api/tickets/refresh {"tickets":["SHOP-482","OPS-12"]}']);
    });
});

describe('les tickets décrits par une réponse', () => {
    it('se lisent dans un objet, même vide, et laissent de côté ce qui n’en a pas la forme', () => {
        expect(readTickets({})).toEqual({});
        expect(() => readTickets([])).toThrow(TypeError);
        expect(
            readTickets({
                'SHOP-482': { title: 'Export CSV', type: 'Story', color: 'vert' },
                'OPS-12': { title: null, type: null, color: null },
                'SHOP-1': { title: 12 },
                // Une teinte inconnue ne coûte pas le titre.
                'SHOP-2': { title: 'Revue', type: 'Incident', color: 'turquoise' },
            }),
        ).toEqual({
            'SHOP-482': { title: 'Export CSV', type: 'Story', color: 'vert' },
            'OPS-12': { title: null, type: null, color: null },
            'SHOP-2': { title: 'Revue', type: 'Incident', color: null },
        });
        expect(() => readTickets('rien')).toThrow();
    });

    it('se disent dans l’infobulle par leur type et leur titre', () => {
        expect(describedTicket({ title: 'Export CSV', type: 'Story', color: 'vert' })).toBe('Story, Export CSV');
        expect(describedTicket({ title: 'Export CSV', type: null, color: null })).toBe('Export CSV');
        expect(describedTicket({ title: null, type: 'Story', color: 'vert' })).toBeNull();
        expect(describedTicket(undefined)).toBeNull();
    });
});
