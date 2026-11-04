import { describe, expect, it } from 'vitest';

import { FavoriteList } from '../../../assets/favorites/favoriteList';
import { FakeFavoritesServer } from './fakeFavoritesServer';

async function opened(...tickets: string[]) {
    const server = new FakeFavoritesServer();
    server.seed(...tickets);
    const list = new FavoriteList(server.api());
    await list.load();
    server.requests = [];

    return { server, list, tickets: () => list.current().favorites?.map((favorite) => favorite.ticket) };
}

describe('la liste des favoris', () => {
    it("ne montre rien tant qu'elle n'est pas lue, puis ce que le serveur tient", async () => {
        const server = new FakeFavoritesServer();
        server.seed('SHOP-482', 'OPS-12');
        const list = new FavoriteList(server.api());

        expect(list.current().favorites).toBeNull();
        await list.load();

        expect(list.current()).toEqual({ favorites: server.list, failed: false, busy: false });
    });

    it('dit quand elle ne se lit pas, sans rien inventer', async () => {
        const server = new FakeFavoritesServer();
        server.readsFail = true;
        const list = new FavoriteList(server.api());

        await list.load();

        expect(list.current()).toEqual({ favorites: null, failed: true, busy: false });
    });

    it('ajoute en tête, le ticket réécrit comme le serveur le garde', async () => {
        const { list, server, tickets } = await opened('SHOP-482');

        expect(await list.add(' ops-12 ')).toEqual({ kind: 'saved' });

        expect(tickets()).toEqual(['OPS-12', 'SHOP-482']);
        expect(server.requests).toEqual(['POST OPS-12']);
    });

    it("n'ajoute qu'une fois sur un double clic : le second ajout part de la liste laissée par le premier", async () => {
        const { list, server, tickets } = await opened();
        server.hold();

        const first = list.add('SHOP-482');
        const second = list.add('SHOP-482');
        expect(list.current().busy).toBe(true);
        await server.sent();
        server.release();

        expect(await first).toEqual({ kind: 'saved' });
        expect(await second).toEqual({
            kind: 'invalid',
            violations: [{ field: 'ticket', message: 'SHOP-482 est déjà dans vos favoris.' }],
        });
        expect(tickets()).toEqual(['SHOP-482']);
        expect(list.current().busy).toBe(false);
    });

    it("ne renvoie pas un nom qui n'a pas changé, une fois réécrit", async () => {
        const { list, server } = await opened('SHOP-482');
        const id = server.list[0]?.id ?? '';

        expect(await list.rename(id, '  Export  CSV ')).toEqual({ kind: 'saved' });
        expect(await list.rename(id, 'Export CSV')).toEqual({ kind: 'unchanged' });
        expect(list.current().favorites?.[0]?.name).toBe('Export CSV');

        expect(await list.rename(id, '   ')).toEqual({ kind: 'saved' });
        expect(list.current().favorites?.[0]?.name).toBeNull();
        expect(server.requests).toEqual([`PATCH ${id}`, `PATCH ${id}`]);
    });

    it('retire un favori, puis le remet à sa place avec son nom', async () => {
        const { list, server, tickets } = await opened('SHOP-482', 'OPS-12', 'SHOP-519');
        const middle = server.list[1]?.id ?? '';
        await list.rename(middle, 'Daily');

        const { outcome, removed } = await list.remove(middle);
        expect(outcome).toEqual({ kind: 'saved' });
        expect(tickets()).toEqual(['SHOP-482', 'SHOP-519']);
        expect(removed).toEqual({ favorite: { id: middle, ticket: 'OPS-12', name: 'Daily' }, index: 1 });

        expect(await list.restore(removed ?? { favorite: { id: '', ticket: '', name: null }, index: 0 })).toEqual({
            kind: 'saved',
        });
        expect(tickets()).toEqual(['SHOP-482', 'OPS-12', 'SHOP-519']);
        expect(list.current().favorites?.[1]?.name).toBe('Daily');
    });

    it('déplace un favori à sa nouvelle place, et ne dit rien quand il y est déjà', async () => {
        const { list, server, tickets } = await opened('SHOP-482', 'OPS-12', 'SHOP-519');
        const first = server.list[0]?.id ?? '';

        expect(await list.move(first, 2)).toEqual({ kind: 'saved' });
        expect(tickets()).toEqual(['OPS-12', 'SHOP-519', 'SHOP-482']);

        expect(await list.move(first, 2)).toEqual({ kind: 'unchanged' });
        expect(await list.move(first, 9)).toEqual({ kind: 'unchanged' });
        expect(server.requests).toHaveLength(1);
    });

    it("se remet sur la liste du serveur quand un autre onglet l'a changée", async () => {
        const { list, server, tickets } = await opened('SHOP-482', 'OPS-12');
        const [first, second] = server.list;
        // Un autre onglet ajoute un favori, puis en retire un.
        await new FavoriteList(server.api()).add('SHOP-519');
        server.list = server.list.filter((favorite) => favorite.id !== second?.id);

        expect(await list.move(first?.id ?? '', 1)).toEqual({ kind: 'stale' });
        expect(tickets()).toEqual(['SHOP-519', 'SHOP-482']);

        expect(await list.rename(second?.id ?? '', 'Daily')).toEqual({ kind: 'stale' });
        expect((await list.remove(second?.id ?? '')).removed).toBeNull();
        expect(tickets()).toEqual(['SHOP-519', 'SHOP-482']);
    });

    it("relit la liste quand le serveur ne répond pas : l'écriture est peut-être passée", async () => {
        const { list, server, tickets } = await opened('SHOP-482');
        server.broken = 'after';

        expect(await list.add('OPS-12')).toEqual({ kind: 'failed' });

        expect(tickets()).toEqual(['OPS-12', 'SHOP-482']);
        expect(server.requests).toEqual(['POST OPS-12', 'GET']);
    });

    it('garde la liste affichée quand ni l’écriture ni la relecture ne passent', async () => {
        const { list, server, tickets } = await opened('SHOP-482');
        server.broken = 'before';
        server.readsFail = true;

        expect(await list.add('OPS-12')).toEqual({ kind: 'failed' });

        expect(tickets()).toEqual(['SHOP-482']);
        expect(list.current().failed).toBe(false);
    });
});

describe('le décalage d’un favori', () => {
    it('se compte sur la liste laissée par le geste d’avant : deux décalages rapides en font deux', async () => {
        const { list, server, tickets } = await opened('SHOP-482', 'OPS-12', 'SHOP-519');
        const first = server.list[0]?.id ?? '';
        server.hold();

        const one = list.shift(first, 1);
        const two = list.shift(first, 1);
        await server.sent();
        server.release();
        await one;
        server.hold();
        await server.sent();
        server.release();

        expect(await two).toEqual({ kind: 'saved' });
        expect(tickets()).toEqual(['OPS-12', 'SHOP-519', 'SHOP-482']);
    });

    it('ne bouge pas en bout de liste', async () => {
        const { list, server } = await opened('SHOP-482', 'OPS-12');

        expect(await list.shift(server.list[0]?.id ?? '', -1)).toEqual({ kind: 'unchanged' });
        expect(await list.shift(server.list[1]?.id ?? '', 1)).toEqual({ kind: 'unchanged' });
        expect(server.requests).toEqual([]);
    });

    it('pose un ticket nouveau à la place visée, et rend le favori ajouté', async () => {
        const { list, server, tickets } = await opened('SHOP-482', 'OPS-12');

        const { outcome, added } = await list.place('ops-7', 1);

        expect(outcome).toEqual({ kind: 'saved' });
        expect(added?.ticket).toBe('OPS-7');
        expect(tickets()).toEqual(['SHOP-482', 'OPS-7', 'OPS-12']);
        expect(server.requests).toEqual(['POST OPS-7']);
    });

    it("pose un ticket déjà en favori en le déplaçant, sans l'ajouter deux fois", async () => {
        const { list, server, tickets } = await opened('SHOP-482', 'OPS-12', 'OPS-7');

        const { outcome, added } = await list.place('SHOP-482', 2);

        expect(outcome).toEqual({ kind: 'saved' });
        expect(added).toBeNull();
        expect(tickets()).toEqual(['OPS-12', 'OPS-7', 'SHOP-482']);
        expect(server.requests.some((request) => request.startsWith('POST'))).toBe(false);
    });

    it('déplace le second de deux blocs du même ticket posés coup sur coup', async () => {
        const { list, server, tickets } = await opened('SHOP-482');
        server.hold();

        const first = list.place('OPS-12', 0);
        const second = list.place('OPS-12', 1);
        await server.sent();
        server.release();

        expect((await first).added?.ticket).toBe('OPS-12');
        expect((await second).added).toBeNull();
        expect(tickets()).toEqual(['SHOP-482', 'OPS-12']);
    });

    it("relit la liste et déplace le favori qu'un autre onglet avait déjà ajouté", async () => {
        const { list, server, tickets } = await opened('SHOP-482', 'OPS-12');
        server.list.push(
            ...new FakeFavoritesServer().seed('OPS-7').map((favorite) => ({ ...favorite, id: 'ailleurs' })),
        );

        const { outcome, added } = await list.place('OPS-7', 0);

        expect(outcome).toEqual({ kind: 'saved' });
        expect(added).toBeNull();
        expect(tickets()).toEqual(['OPS-7', 'SHOP-482', 'OPS-12']);
        expect(server.requests).toEqual([
            'POST OPS-7',
            'GET',
            'PUT ailleurs,' +
                server.list
                    .slice(1)
                    .map((favorite) => favorite.id)
                    .join(','),
        ]);
    });
});
