import { useState } from 'react';
import type { FavoriteTicket } from '@/types/api';
import { writeToTimelineClipboard } from '@/utils/favoriteUtils';

interface UseFavoriteCopyResult {
    copiedId: string | null;
    handleCopy: (fav: FavoriteTicket) => void;
}

/** Gère la copie d'un favori dans le presse-papier de la timeline. */
export function useFavoriteCopy(): UseFavoriteCopyResult {
    const [copiedId, setCopiedId] = useState<string | null>(null);

    function handleCopy(fav: FavoriteTicket) {
        writeToTimelineClipboard(fav);
        setCopiedId(fav.id);
        setTimeout(() => setCopiedId((prev) => (prev === fav.id ? null : prev)), 1500);
    }

    return { copiedId, handleCopy };
}
