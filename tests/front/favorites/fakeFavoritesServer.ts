import type { Favorite } from '../../../assets/favorites/favorites';
import type { FavoritesApi, FavoritesResult } from '../../../assets/favorites/favoritesApi';

/**
 * Un serveur des favoris en mémoire, qui suit les règles de src/Favorite/FavoriteWriter.php :
 * un ticket une fois, un favori retiré qui n'existe plus, un ordre qui nomme toute la
 * liste. Chaque requête peut être retenue, ou tomber en panne.
 */
export class FakeFavoritesServer {
    list: Favorite[] = [];
    requests: string[] = [];
    /** Les écritures échouent, avant d'atteindre la liste ou une fois écrites. */
    broken: 'before' | 'after' | null = null;
    readsFail = false;
    private next = 1;
    private held: (() => void)[] | null = null;

    seed(...tickets: string[]): Favorite[] {
        this.list = tickets.map((ticket) => this.create(ticket, null));

        return this.list;
    }

    /** Les réponses attendent release() ; les requêtes, elles, arrivent aussitôt. */
    hold(): void {
        this.held = [];
    }

    async sent(count = 1): Promise<void> {
        while ((this.held?.length ?? 0) < count) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }

    release(): void {
        const waiting = this.held ?? [];
        this.held = null;
        waiting.forEach((resolve) => {
            resolve();
        });
    }

    api(): FavoritesApi {
        return {
            read: () => {
                this.requests.push('GET');

                return this.readsFail
                    ? Promise.reject(new TypeError('Failed to fetch'))
                    : Promise.resolve([...this.list]);
            },
            add: (ticket, name, position) =>
                this.write(`POST ${ticket}`, () => {
                    if (this.list.some((favorite) => favorite.ticket === ticket)) {
                        return {
                            status: 'invalid',
                            violations: [{ field: 'ticket', message: `${ticket} est déjà dans vos favoris.` }],
                        };
                    }
                    this.list.splice(Math.min(position, this.list.length), 0, this.create(ticket, name));

                    return this.saved();
                }),
            rename: (id, name) =>
                this.write(`PATCH ${id}`, () => {
                    const index = this.list.findIndex((favorite) => favorite.id === id);
                    const favorite = this.list[index];
                    if (favorite === undefined) {
                        return { status: 'stale', favorites: [...this.list] };
                    }
                    this.list[index] = { ...favorite, name };

                    return this.saved();
                }),
            remove: (id) =>
                this.write(`DELETE ${id}`, () => {
                    if (!this.list.some((favorite) => favorite.id === id)) {
                        return { status: 'stale', favorites: [...this.list] };
                    }
                    this.list = this.list.filter((favorite) => favorite.id !== id);

                    return this.saved();
                }),
            reorder: (ids) =>
                this.write(`PUT ${ids.join(',')}`, () => {
                    const order = ids.map((id) => this.list.find((favorite) => favorite.id === id));
                    if (
                        ids.length !== this.list.length ||
                        new Set(ids).size !== ids.length ||
                        order.some((favorite) => favorite === undefined)
                    ) {
                        return { status: 'stale', favorites: [...this.list] };
                    }
                    this.list = order.filter((favorite) => favorite !== undefined);

                    return this.saved();
                }),
        };
    }

    private async write(request: string, handle: () => FavoritesResult): Promise<FavoritesResult> {
        this.requests.push(request);
        if (this.broken === 'before') {
            throw new TypeError('Failed to fetch');
        }
        const result = handle();
        if (this.held !== null) {
            await new Promise<void>((resolve) => this.held?.push(resolve));
        }
        if (this.broken === 'after') {
            throw new TypeError('Failed to fetch');
        }

        return result;
    }

    private saved(): FavoritesResult {
        return { status: 'saved', favorites: [...this.list] };
    }

    private create(ticket: string, name: string | null): Favorite {
        const id = `favori-${String(this.next)}`;
        this.next += 1;

        return { id, ticket, name };
    }
}
