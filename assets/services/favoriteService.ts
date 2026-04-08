import type { FavoriteTicket } from '../types/api';

const BASE = '/api/favorites';

/** Retourne la liste des favoris triés par position. */
export async function listFavorites(): Promise<FavoriteTicket[]> {
    const res = await fetch(BASE);
    if (!res.ok) throw new Error('Impossible de charger les favoris');
    return res.json() as Promise<FavoriteTicket[]>;
}

/**
 * Ajoute un ticket en favori.
 * Si Jira est configuré côté serveur, vérifie l'existence du ticket.
 * Lève une Error avec le message serveur en cas d'échec.
 */
export async function createFavorite(ticketKey: string): Promise<FavoriteTicket> {
    const res = await fetch(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketKey }),
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
        throw new Error((body as { error?: string }).error ?? 'Impossible d\'ajouter le favori');
    }

    return body as FavoriteTicket;
}

/** Met à jour le nom personnalisé d'un favori. */
export async function renameFavorite(id: string, customName: string): Promise<FavoriteTicket> {
    const res = await fetch(`${BASE}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customName }),
    });

    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? 'Impossible de renommer le favori');
    }

    return res.json() as Promise<FavoriteTicket>;
}

/** Supprime un favori. */
export async function deleteFavorite(id: string): Promise<void> {
    const res = await fetch(`${BASE}/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
        throw new Error('Impossible de supprimer le favori');
    }
}

/**
 * Met à jour l'ordre des favoris.
 * ids doit contenir tous les IDs dans le nouvel ordre.
 */
export async function reorderFavorites(ids: string[]): Promise<FavoriteTicket[]> {
    const res = await fetch(`${BASE}/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
    });

    if (!res.ok) throw new Error('Impossible de réordonner les favoris');

    return res.json() as Promise<FavoriteTicket[]>;
}
