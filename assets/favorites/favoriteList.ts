import type { Violation } from '../grid/daySession';
import { normalizeComment, normalizeTicket } from '../grid/grid';
import { type Favorite, moved } from './favorites';
import type { FavoritesApi, FavoritesResult } from './favoritesApi';

/** Ce qu'est devenu un geste sur la liste, pour que l'écran le dise. */
export type FavoriteOutcome =
    | { readonly kind: 'saved' }
    /** Le geste ne change rien : rien ne part. */
    | { readonly kind: 'unchanged' }
    /** La liste avait changé ailleurs : rien n'est écrit, et l'écran est remis à jour. */
    | { readonly kind: 'stale' }
    | { readonly kind: 'invalid'; readonly violations: readonly Violation[] }
    /** Le serveur n'a pas répondu : la liste est relue, pour montrer ce que la base contient. */
    | { readonly kind: 'failed' };

/** Un favori retiré, et la place qu'il avait : de quoi le remettre. */
export interface Removed {
    readonly favorite: Favorite;
    readonly index: number;
}

export interface FavoritesSnapshot {
    /** La liste, de haut en bas ; null tant qu'elle n'est pas lue. */
    readonly favorites: readonly Favorite[] | null;
    /** La liste ne se lit pas. */
    readonly failed: boolean;
    /** Un geste attend sa réponse. */
    readonly busy: boolean;
}

const SAVED: FavoriteOutcome = { kind: 'saved' };
const UNCHANGED: FavoriteOutcome = { kind: 'unchanged' };
const STALE: FavoriteOutcome = { kind: 'stale' };
const FAILED: FavoriteOutcome = { kind: 'failed' };

/**
 * La liste des favoris, et tout ce qui l'écrit : ajouter, renommer, retirer, déplacer.
 *
 * Comme une journée (assets/grid/daySession.ts), elle n'affiche que ce que le serveur a
 * enregistré. Les gestes passent un à un, et chacun se calcule sur la liste laissée par
 * le précédent : un double clic sur « Ajouter » n'ajoute qu'une fois, et un déplacement
 * part de la liste telle qu'elle est.
 */
export class FavoriteList {
    private readonly api: FavoritesApi;
    private readonly listeners = new Set<() => void>();
    private favorites: readonly Favorite[] | null = null;
    private failed = false;
    private pending = 0;
    private queue: Promise<unknown> = Promise.resolve();
    private snapshot: FavoritesSnapshot;

    constructor(api: FavoritesApi) {
        this.api = api;
        this.snapshot = this.take();
    }

    current(): FavoritesSnapshot {
        return this.snapshot;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);

        return () => {
            this.listeners.delete(listener);
        };
    }

    /** Lit la liste, à son tour dans la file : après les gestes déjà partis. */
    load(): Promise<void> {
        return this.enqueue(() => this.reload());
    }

    /** @param position sa place, 0 en haut, où s'ouvre le formulaire d'ajout */
    add(ticket: string, position = 0, name: string | null = null): Promise<FavoriteOutcome> {
        return this.enqueue(() =>
            this.send(() => this.api.add(normalizeTicket(ticket) ?? '', normalizeComment(name), Math.max(position, 0))),
        );
    }

    /** Un nom vide rend au favori le titre venu de Jira. */
    rename(id: string, name: string): Promise<FavoriteOutcome> {
        return this.enqueue(() => {
            const favorite = this.favorites?.find((known) => known.id === id);
            const wanted = normalizeComment(name);
            if (favorite?.name === wanted) {
                return Promise.resolve(UNCHANGED);
            }

            return this.send(() => this.api.rename(id, wanted));
        });
    }

    /** Retire le favori ; rend aussi de quoi le remettre à sa place. */
    remove(id: string): Promise<{ readonly outcome: FavoriteOutcome; readonly removed: Removed | null }> {
        return this.enqueue(async () => {
            const list = this.favorites ?? [];
            const index = list.findIndex((favorite) => favorite.id === id);
            const favorite = list[index];
            const outcome = await this.send(() => this.api.remove(id));

            return {
                outcome,
                removed: outcome.kind === 'saved' && favorite !== undefined ? { favorite, index } : null,
            };
        });
    }

    /**
     * Un ticket de la grille posé à cette place, comptée dans la liste sans lui : ajouté,
     * ou, déjà en favori, déplacé là. Un ticket n'y est jamais deux fois, et le choix se
     * fait sur la liste telle que ce tour la voit. Un autre onglet l'avait ajouté sans que
     * cette liste le sache : le serveur refuse le doublon, la liste est relue, et le
     * favori déplacé.
     *
     * @return ce qu'il est devenu, et le favori ajouté, s'il l'a été
     */
    place(
        ticket: string,
        index: number,
    ): Promise<{ readonly outcome: FavoriteOutcome; readonly added: Favorite | null }> {
        const wanted = normalizeTicket(ticket) ?? '';
        const known = () => this.favorites?.find((favorite) => favorite.ticket === wanted);

        return this.enqueue(async () => {
            let favorite = known();
            if (favorite === undefined) {
                const outcome = await this.send(() => this.api.add(wanted, null, Math.max(index, 0)));
                if (outcome.kind !== 'invalid') {
                    return { outcome, added: outcome.kind === 'saved' ? (known() ?? null) : null };
                }
                await this.reload();
                favorite = known();
                if (favorite === undefined) {
                    return { outcome, added: null };
                }
            }
            const order = moved(this.favorites ?? [], favorite.id, index);

            return {
                outcome: order === null ? UNCHANGED : await this.send(() => this.api.reorder(order.map((it) => it.id))),
                added: null,
            };
        });
    }

    /** Remet un favori retiré, à la place qu'il avait, avec son nom. */
    restore(removed: Removed): Promise<FavoriteOutcome> {
        return this.add(removed.favorite.ticket, removed.index, removed.favorite.name);
    }

    /**
     * Déplace le favori à cette place, comptée dans la liste sans lui. L'ordre part de la
     * liste telle que ce tour la voit.
     */
    move(id: string, index: number): Promise<FavoriteOutcome> {
        return this.enqueue(() => {
            const order = moved(this.favorites ?? [], id, index);
            if (order === null) {
                return Promise.resolve(UNCHANGED);
            }

            return this.send(() => this.api.reorder(order.map((favorite) => favorite.id)));
        });
    }

    /**
     * Monte ou descend le favori d'une place, comptée sur la liste telle que ce tour la
     * voit : deux décalages rapides en font deux. En bout de liste, il ne bouge pas.
     */
    shift(id: string, delta: -1 | 1): Promise<FavoriteOutcome> {
        return this.enqueue(() => {
            const index = (this.favorites ?? []).findIndex((favorite) => favorite.id === id);
            const order = index < 0 || index + delta < 0 ? null : moved(this.favorites ?? [], id, index + delta);
            if (order === null) {
                return Promise.resolve(UNCHANGED);
            }

            return this.send(() => this.api.reorder(order.map((favorite) => favorite.id)));
        });
    }

    private async send(request: () => Promise<FavoritesResult>): Promise<FavoriteOutcome> {
        let result: FavoritesResult;
        try {
            result = await request();
        } catch {
            await this.reload();

            return FAILED;
        }
        switch (result.status) {
            case 'saved':
                this.show(result.favorites);

                return SAVED;
            case 'stale':
                this.show(result.favorites);

                return STALE;
            case 'invalid':
                return { kind: 'invalid', violations: result.violations };
        }
    }

    private async reload(): Promise<void> {
        try {
            this.show(await this.api.read());
        } catch {
            // Une liste déjà lue reste affichée : le prochain geste la remettra à jour.
            this.failed = this.favorites === null;
        }
    }

    private show(favorites: readonly Favorite[]): void {
        this.favorites = favorites;
        this.failed = false;
    }

    private enqueue<T>(task: () => Promise<T>): Promise<T> {
        this.pending += 1;
        this.publish();
        const run = this.queue.then(task).finally(() => {
            this.pending -= 1;
            this.publish();
        });
        // Un geste qui lève est un bug : il le dit à son appelant, sans bloquer les suivants.
        this.queue = run.catch(() => undefined);

        return run;
    }

    private publish(): void {
        this.snapshot = this.take();
        this.listeners.forEach((listener) => {
            listener();
        });
    }

    private take(): FavoritesSnapshot {
        return { favorites: this.favorites, failed: this.failed, busy: this.pending > 0 };
    }
}
