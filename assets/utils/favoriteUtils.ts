import { EntryType } from '@/types/api';
import type { FavoriteTicket } from '@/types/api';

/** Déplace un élément d'un tableau (immuable). */
export function arrayMove<T>(arr: T[], from: number, to: number): T[] {
    const result = [...arr];
    const [item] = result.splice(from, 1);
    result.splice(to, 0, item);
    return result;
}

/** Écrit un favori dans le presse-papier interne de la timeline. */
export function writeToTimelineClipboard(fav: FavoriteTicket): void {
    const clipboardData = {
        cells: [{
            offset: 0,
            ticketKey: fav.ticketKey,
            ticketSummary: fav.ticketSummary,
            ticketType: fav.ticketType,
            comment: null,
            type: EntryType.WORK,
            isEmpty: false,
        }],
    };
    sessionStorage.setItem('daytrack_clipboard', JSON.stringify(clipboardData));
    window.dispatchEvent(new CustomEvent('daytrack:clipboard-changed'));
}
