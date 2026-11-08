import { useCallback, useEffect, useRef, useState } from 'react';

import { hasTicketShape } from '../grid/entry';
import { normalizeTicket } from '../grid/grid';
import type { LookupResult } from './jiraApi';
import { isTokenRefusal } from './jiraStatus';
import type { TicketInfo } from './ticketInfo';
import { useJiraState, useTicketBook, useTickets } from './TicketsContext';

/** Le temps sans frappe après lequel DayTrack interroge Jira sur ce qu'on a tapé. */
export const LOOKUP_DELAY = 300;

/** Ce que l'écran sait d'un ticket qu'on tape. */
export type Lookup =
    /** Rien encore qui ait la forme d'un ticket : rien à côté du champ. */
    | { readonly status: 'idle' }
    /** Forme valide, Jira n'a pas encore répondu : « Recherche dans Jira… ». */
    | { readonly status: 'searching'; readonly ticket: string }
    | { readonly status: 'found'; readonly ticket: string; readonly info: TicketInfo }
    | { readonly status: 'not_found'; readonly ticket: string }
    /** Jira ne répond pas, ou refuse le jeton : le ticket ne peut pas être vérifié. */
    | { readonly status: 'unreachable' | 'refused' | 'missing_scope'; readonly ticket: string };

const IDLE: Lookup = { status: 'idle' };

/** Ce qu'enregistrer doit savoir du ticket tapé. */
export interface TicketCheck {
    /** Jira ne le connaît pas : rien ne s'enregistre, quel que soit le geste. */
    readonly refused: boolean;
    /** La réponse de Jira, à attendre avant d'enregistrer ; rien quand il a déjà répondu. */
    readonly known: () => Promise<boolean> | undefined;
}

export const NO_CHECK: TicketCheck = { refused: false, known: () => undefined };

/**
 * Ce que Jira dit du ticket tapé, dès que la frappe s'arrête. Un ticket que l'écran
 * connaît déjà, avec son titre, se montre sans attendre. Hors d'un écran relié à Jira,
 * rien ne se cherche.
 *
 * settled() rend la réponse attendue : « Enregistrer » pendant la recherche attend
 * qu'elle arrive, et la fait partir sans attendre la fin de la frappe. Un ticket que Jira
 * n'a pas pu vérifier se redemande : Jira a pu revenir depuis qu'on l'a tapé.
 */
export function useTicketLookup(typed: string): {
    readonly lookup: Lookup;
    readonly settled: () => Promise<Lookup>;
    readonly check: TicketCheck;
} {
    const book = useTicketBook();
    const tickets = useTickets();
    const state = useJiraState();
    // Jira refuse le jeton : rien de ce qu'on tape ne se vérifie, même un ticket connu.
    // La recherche part quand même : une réponse de Jira dirait que le jeton passe de
    // nouveau.
    const refusal = isTokenRefusal(state) ? state : null;
    const ticket = book === null ? null : shapedTicket(typed);
    const known = ticket === null || refusal !== null ? undefined : tickets.get(ticket);
    // La réponse ne vaut que pour le ticket encore tapé : une fenêtre rouverte plus tard, le
    // même ticket tapé de nouveau, Jira revenu entre-temps, redemande à Jira.
    const [answer, setAnswer] = useState<Lookup>(IDLE);
    if (answer.status !== 'idle' && answer.ticket !== ticket) {
        setAnswer(IDLE);
    }
    const pendingRef = useRef<{ ticket: string; run: () => Promise<Lookup> } | null>(null);

    const answered: Lookup =
        ticket === null
            ? IDLE
            : known !== undefined && known.title !== null
              ? { status: 'found', ticket, info: known }
              : answer.status !== 'idle' && answer.ticket === ticket
                ? answer
                : { status: 'searching', ticket };
    const lookup: Lookup =
        refusal !== null && answered.status === 'found' ? { status: refusal, ticket: answered.ticket } : answered;

    // La recherche part quand la frappe s'arrête ; une autre frappe l'abandonne.
    const searching = lookup.status === 'searching' ? lookup.ticket : null;
    useEffect(() => {
        if (searching === null || book === null) {
            pendingRef.current = null;

            return;
        }
        let current = true;
        let started: Promise<Lookup> | null = null;
        const run = () => {
            started ??= book.lookup(searching).then((result) => {
                const found = lookupOf(searching, result);
                if (current) {
                    setAnswer(found);
                }

                return found;
            });

            return started;
        };
        pendingRef.current = { ticket: searching, run };
        const timer = window.setTimeout(() => {
            void run();
        }, LOOKUP_DELAY);

        return () => {
            current = false;
            window.clearTimeout(timer);
        };
    }, [book, searching]);

    const lookupRef = useRef(lookup);
    useEffect(() => {
        lookupRef.current = lookup;
    });

    const settled = useCallback((): Promise<Lookup> => {
        const shown = lookupRef.current;
        if (shown.status === 'idle' || shown.status === 'found' || shown.status === 'not_found') {
            return Promise.resolve(shown);
        }
        if (shown.status !== 'searching') {
            return book === null
                ? Promise.resolve(shown)
                : book.lookup(shown.ticket).then((result) => {
                      const found = lookupOf(shown.ticket, result);
                      setAnswer(found);

                      return found;
                  });
        }
        const pending = pendingRef.current;
        if (pending?.ticket === shown.ticket) {
            return pending.run();
        }

        return book === null
            ? Promise.resolve(IDLE)
            : book.lookup(shown.ticket).then((result) => lookupOf(shown.ticket, result));
    }, [book]);

    const check: TicketCheck = {
        refused: lookup.status === 'not_found',
        known: () =>
            lookup.status === 'idle' || lookup.status === 'found' || lookup.status === 'not_found'
                ? undefined
                : settled().then((answer) => answer.status !== 'not_found'),
    };

    return { lookup, settled, check };
}

function lookupOf(ticket: string, result: LookupResult): Lookup {
    return result.status === 'found'
        ? { status: 'found', ticket, info: result.ticket }
        : { status: result.status, ticket };
}

/** Le ticket qu'on a tapé, s'il en a la forme ; null sinon, ou si rien n'est tapé. */
function shapedTicket(typed: string): string | null {
    const ticket = normalizeTicket(typed);

    return ticket !== null && hasTicketShape(ticket) ? ticket : null;
}
