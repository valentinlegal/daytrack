import { describe, expect, it } from 'vitest';

import { httpFavoritesApi } from '../../../assets/favorites/favoritesApi';

const LIST = { favorites: [{ id: '0199a3c4-5b6d-7e8f-9a0b-1c2d3e4f5a6b', ticket: 'SHOP-482', name: null }] };

/** Un serveur qui répond une seule fois, et garde la requête reçue. */
function answering(status: number, body: unknown) {
    const sent: { url: string; init: RequestInit | undefined }[] = [];
    const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
        sent.push({ url: input instanceof Request ? input.url : input.toString(), init });

        return Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
    }) as typeof fetch;

    return { api: httpFavoritesApi(fetcher), sent };
}

describe("l'API des favoris", () => {
    it('envoie chaque geste en JSON, même sans rien à dire : le serveur refuse le reste (SameOriginGuard)', async () => {
        const { api, sent } = answering(200, LIST);

        await api.add('SHOP-482', null, 0);
        await api.rename('a/b', 'Export');
        await api.remove('a');
        await api.reorder(['a', 'b']);

        expect(
            sent.map(
                ({ url, init }) =>
                    `${String(init?.method)} ${url} ${typeof init?.body === 'string' ? init.body : 'null'}`,
            ),
        ).toEqual([
            'POST /api/favorites {"ticket":"SHOP-482","name":null,"position":0}',
            'PATCH /api/favorites/a%2Fb {"name":"Export"}',
            'DELETE /api/favorites/a null',
            'PUT /api/favorites/order {"ids":["a","b"]}',
        ]);
        for (const { init } of sent) {
            expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
        }
    });

    it('rend la liste écrite, ou celle à jour quand un autre onglet l’a changée', async () => {
        expect(await answering(201, LIST).api.add('SHOP-482', null, 0)).toEqual({
            status: 'saved',
            favorites: LIST.favorites,
        });
        expect(await answering(404, { error: 'not_found', ...LIST }).api.remove('a')).toEqual({
            status: 'stale',
            favorites: LIST.favorites,
        });
        expect(await answering(409, { error: 'stale', ...LIST }).api.reorder([])).toEqual({
            status: 'stale',
            favorites: LIST.favorites,
        });
    });

    it('rend les refus champ par champ', async () => {
        const violations = [{ field: 'ticket', message: 'SHOP-482 est déjà dans vos favoris.' }];

        expect(await answering(422, { error: 'invalid', violations }).api.add('SHOP-482', null, 0)).toEqual({
            status: 'invalid',
            violations,
        });
    });

    it('lève sur une réponse inattendue : la liste se relit plutôt que de croire ce qui est parti', async () => {
        await expect(answering(500, 'Erreur').api.add('SHOP-482', null, 0)).rejects.toThrow();
        await expect(answering(403, { error: 'cross_origin' }).api.remove('a')).rejects.toThrow();
        await expect(answering(200, { favorites: 'non' }).api.rename('a', null)).rejects.toThrow();
        await expect(answering(500, 'Erreur').api.read()).rejects.toThrow();
    });
});
