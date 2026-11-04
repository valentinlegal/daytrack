import { createContext, type ReactNode, use, useCallback, useSyncExternalStore } from 'react';

import type { JiraState } from './jiraStatus';
import type { TicketBook } from './ticketBook';
import type { TicketInfo } from './ticketInfo';

const BookContext = createContext<TicketBook | null>(null);
const StateContext = createContext<JiraState>('unlinked');

const NOTHING: ReadonlyMap<string, TicketInfo> = new Map();

/**
 * Les tickets que l'écran connaît, pour tout ce qui affiche un titre venu de Jira, et où
 * en est la connexion.
 */
export function TicketsProvider({
    book,
    state,
    children,
}: {
    book: TicketBook;
    state: JiraState;
    children: ReactNode;
}) {
    return (
        <BookContext value={book}>
            <StateContext value={state}>{children}</StateContext>
        </BookContext>
    );
}

/** Où en est la connexion à Jira : relié, jeton refusé, périmètre manquant. */
export function useJiraState(): JiraState {
    return use(StateContext);
}

/** Le carnet des tickets ; null hors d'un écran relié à Jira. */
export function useTicketBook(): TicketBook | null {
    return use(BookContext);
}

/** Les tickets connus, relus à chaque nouveauté. */
export function useTickets(): ReadonlyMap<string, TicketInfo> {
    const book = useTicketBook();
    const subscribe = useCallback((listener: () => void) => book?.subscribe(listener) ?? (() => undefined), [book]);

    return useSyncExternalStore(subscribe, () => book?.current() ?? NOTHING);
}
