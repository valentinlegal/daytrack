import { bodyOf, readViolations } from '../day/dayApi';
import type { Violation } from '../grid/daySession';
import { isRecord } from '../grid/json';
import { type TicketInfo, ticketsOf } from '../jira/ticketInfo';
import { type Favorite, readFavorites } from './favorites';

export type FavoritesResult =
    | { readonly status: 'saved'; readonly favorites: Favorite[] }
    /**
     * Le geste visait une liste qui n'est plus la bonne — un favori retiré dans un autre
     * onglet (404), un ordre qui ne la nomme plus (409) : rien n'est écrit, voici la liste
     * à jour.
     */
    | { readonly status: 'stale'; readonly favorites: Favorite[] }
    /** Une règle refuse le geste : rien n'est écrit (422). */
    | { readonly status: 'invalid'; readonly violations: readonly Violation[] };

/** L'API des favoris, vue de la liste. Une panne — réseau, erreur du serveur — lève. */
export interface FavoritesApi {
    read(): Promise<Favorite[]>;
    add(ticket: string, name: string | null, position: number): Promise<FavoritesResult>;
    rename(id: string, name: string | null): Promise<FavoritesResult>;
    remove(id: string): Promise<FavoritesResult>;
    reorder(ids: readonly string[]): Promise<FavoritesResult>;
}

/**
 * L'API des favoris (src/Controller/Api/FavoriteController.php). La liste décrit aussi
 * ses tickets, dont le titre tient lieu de nom : ils vont à qui les affiche (onTickets).
 */
export function httpFavoritesApi(
    fetcher: typeof fetch = (input, init) => fetch(input, init),
    onTickets: (tickets: Record<string, TicketInfo>) => void = () => undefined,
): FavoritesApi {
    const BASE = '/api/favorites';

    async function write(
        method: 'POST' | 'PATCH' | 'DELETE' | 'PUT',
        target: string,
        body: unknown,
    ): Promise<FavoritesResult> {
        const response = await fetcher(target, {
            method,
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: body === undefined ? null : JSON.stringify(body),
        });
        const json = await bodyOf(response);
        if (response.status === 200 || response.status === 201) {
            ticketsOf(json, onTickets);

            return { status: 'saved', favorites: readFavorites(json) };
        }
        if (response.status === 404 || response.status === 409) {
            ticketsOf(json, onTickets);

            return { status: 'stale', favorites: readFavorites(json) };
        }
        if (response.status === 422 && isRecord(json)) {
            return { status: 'invalid', violations: readViolations(json.violations) };
        }

        throw new Error(`L'API a répondu ${String(response.status)} à ${method} ${target}.`);
    }

    const one = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

    return {
        async read() {
            const response = await fetcher(BASE, { headers: { Accept: 'application/json' } });
            if (response.status !== 200) {
                throw new Error(`L'API a répondu ${String(response.status)} pour les favoris.`);
            }

            const json = await bodyOf(response);
            ticketsOf(json, onTickets);

            return readFavorites(json);
        },
        add: (ticket, name, position) => write('POST', BASE, { ticket, name, position }),
        rename: (id, name) => write('PATCH', one(id), { name }),
        remove: (id) => write('DELETE', one(id), undefined),
        reorder: (ids) => write('PUT', `${BASE}/order`, { ids }),
    };
}
