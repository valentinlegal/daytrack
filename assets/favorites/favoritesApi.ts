import { type TicketInfo, ticketsOf } from '../jira/ticketInfo';
import { type Refused, refused, serverApi } from '../serverApi';
import { type Favorite, readFavorites } from './favorites';

export type FavoritesResult =
    | { readonly status: 'saved'; readonly favorites: Favorite[] }
    /**
     * Le geste visait une liste qui n'est plus la bonne — un favori retiré dans un autre
     * onglet (404), un ordre qui ne la nomme plus (409) : rien n'est écrit, voici la liste
     * à jour.
     */
    | { readonly status: 'stale'; readonly favorites: Favorite[] }
    | Refused;

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
    fetcher?: typeof fetch,
    onTickets: (tickets: Record<string, TicketInfo>) => void = () => undefined,
): FavoritesApi {
    const BASE = '/api/favorites';
    const server = serverApi(fetcher);

    const list = (json: unknown): Favorite[] => {
        ticketsOf(json, onTickets);

        return readFavorites(json);
    };
    const saved = (json: unknown) => ({ status: 'saved', favorites: list(json) }) as const;
    const stale = (json: unknown) => ({ status: 'stale', favorites: list(json) }) as const;

    const write = (method: 'POST' | 'PATCH' | 'DELETE' | 'PUT', target: string, body?: unknown) =>
        server.request<FavoritesResult>(
            method,
            target,
            { 200: saved, 201: saved, 404: stale, 409: stale, 422: refused },
            { body },
        );

    const one = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

    return {
        read: () => server.read(BASE, list),
        add: (ticket, name, position) => write('POST', BASE, { ticket, name, position }),
        rename: (id, name) => write('PATCH', one(id), { name }),
        remove: (id) => write('DELETE', one(id)),
        reorder: (ids) => write('PUT', `${BASE}/order`, { ids }),
    };
}
