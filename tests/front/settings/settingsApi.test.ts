import { describe, expect, it } from 'vitest';

import { httpSettingsApi, readSettings } from '../../../assets/settings/settingsApi';

const SETTINGS = {
    habitualObjective: 450,
    workingDays: [1, 2, 3, 4, 5],
    issueTypes: [{ id: '0199a3c4-5b6d-7e8f-9a0b-1c2d3e4f5a6b', name: 'Story', color: 'vert' }],
};

/** Un serveur qui répond toujours la même chose, et garde les requêtes reçues. */
function answering(status: number, body: unknown) {
    const sent: { url: string; init: RequestInit | undefined }[] = [];
    const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
        sent.push({ url: input instanceof Request ? input.url : input.toString(), init });

        return Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
    }) as typeof fetch;

    return { api: httpSettingsApi(fetcher), sent };
}

describe("l'API des réglages", () => {
    it('envoie chaque réglage en JSON, à son adresse', async () => {
        const { api, sent } = answering(200, SETTINGS);

        await api.setHabitualObjective(480);
        await api.setWorkingDay(6, true);
        await api.recolor('a/b', 'cyan');

        expect(
            sent.map(
                ({ url, init }) => `${String(init?.method)} ${url} ${typeof init?.body === 'string' ? init.body : ''}`,
            ),
        ).toEqual([
            'PUT /api/settings/habitual-objective {"objective":480}',
            'PUT /api/settings/working-days/6 {"worked":true}',
            'PUT /api/settings/issue-types/a%2Fb {"color":"cyan"}',
        ]);
        for (const { init } of sent) {
            expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
        }
    });

    it('rend les réglages à jour, même pour un type disparu entre-temps', async () => {
        expect(await answering(200, SETTINGS).api.setWorkingDay(6, true)).toEqual({
            status: 'saved',
            settings: SETTINGS,
        });
        expect(await answering(404, { error: 'not_found', ...SETTINGS }).api.recolor('x', 'cyan')).toEqual({
            status: 'saved',
            settings: SETTINGS,
        });
    });

    it('rend le refus du serveur, champ par champ', async () => {
        const refusal = {
            error: 'invalid',
            violations: [{ field: 'objective', message: "L'objectif va de 0h00 à 13h00." }],
        };

        expect(await answering(422, refusal).api.setHabitualObjective(795)).toEqual({
            status: 'invalid',
            violations: refusal.violations,
        });
    });

    it('lève sur une panne, ou une réponse qui ne décrit pas les réglages', async () => {
        await expect(answering(500, 'Erreur').api.setWorkingDay(1, false)).rejects.toThrow();
        await expect(answering(403, { error: 'cross_origin' }).api.setWorkingDay(1, false)).rejects.toThrow();
        await expect(answering(200, { habitualObjective: '7h30' }).api.read()).rejects.toThrow();
        await expect(answering(500, '').api.read()).rejects.toThrow();
    });

    it('refuse une teinte que la page ne sait pas montrer', () => {
        expect(() =>
            readSettings({ ...SETTINGS, issueTypes: [{ id: 'x', name: 'Story', color: 'turquoise' }] }),
        ).toThrow();
        expect(readSettings(SETTINGS)).toEqual(SETTINGS);
    });
});
