import { useState, useRef, useEffect, type RefObject } from 'react';
import type { FavoriteTicket } from '@/types/api';
import * as favoriteService from '@/services/favoriteService';

interface UseFavoriteRenameResult {
    renamingId: string | null;
    renameValue: string;
    setRenamingId: (id: string | null) => void;
    onRenameChange: (v: string) => void;
    startRename: (fav: FavoriteTicket) => void;
    commitRename: (id: string) => Promise<void>;
}

/**
 * Gère le flux de renommage inline d'un favori.
 * Reçoit containerRef pour détecter les clics extérieurs au panneau
 * sans re-enregistrer le listener à chaque changement d'état.
 */
export function useFavoriteRename(
    favorites: FavoriteTicket[],
    onChange: (favorites: FavoriteTicket[]) => void,
    containerRef: RefObject<HTMLElement | null>,
): UseFavoriteRenameResult {
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');

    // Ref stable pour éviter de re-enregistrer le listener mousedown à chaque render.
    // Le callback est mis à jour à chaque render mais le listener reste unique.
    const renameCallbackRef = useRef<(() => void) | null>(null);
    renameCallbackRef.current = renamingId
        ? () => {
            const trimmed = renameValue.trim();
            const id = renamingId;
            setRenamingId(null);
            if (trimmed) {
                void favoriteService.renameFavorite(id, trimmed)
                    .then((updated) => onChange(favorites.map((f) => (f.id === id ? updated : f))))
                    .catch(() => null);
            }
        }
        : null;

    useEffect(() => {
        function handleOutside(e: MouseEvent) {
            if (containerRef.current?.contains(e.target as Node)) return;
            renameCallbackRef.current?.();
        }
        document.addEventListener('mousedown', handleOutside);
        return () => document.removeEventListener('mousedown', handleOutside);
    }, [containerRef]);

    function startRename(fav: FavoriteTicket) {
        setRenamingId(fav.id);
        setRenameValue(fav.customName ?? fav.ticketSummary ?? fav.ticketKey);
    }

    async function commitRename(id: string) {
        const trimmed = renameValue.trim();
        setRenamingId(null);
        if (!trimmed) return;
        try {
            const updated = await favoriteService.renameFavorite(id, trimmed);
            onChange(favorites.map((f) => (f.id === id ? updated : f)));
        } catch { /* revert silencieux */ }
    }

    return {
        renamingId,
        renameValue,
        setRenamingId,
        onRenameChange: setRenameValue,
        startRename,
        commitRename,
    };
}
