import { useEffect } from 'react';

import type { Favorite } from '../favorites/favorites';
import type { DaySession } from '../grid/daySession';
import { useTicketBook } from '../jira/TicketsContext';

/**
 * Les titres de plus d'une heure se relisent dans Jira, une fois la journée affichée, puis
 * ceux des favoris quand leur liste change : l'écran ne les attend pas.
 */
export function useTicketTitles(session: DaySession | null, favorites: readonly Favorite[] | null): void {
    const book = useTicketBook();
    useEffect(() => {
        if (session !== null) {
            void book?.refresh(session.current().day.grid.tickets());
        }
    }, [book, session]);

    const favoriteTickets = [...new Set(favorites?.map((favorite) => favorite.ticket))].sort().join(' ');
    useEffect(() => {
        if (favoriteTickets !== '') {
            void book?.refresh(favoriteTickets.split(' '));
        }
    }, [book, favoriteTickets]);
}
