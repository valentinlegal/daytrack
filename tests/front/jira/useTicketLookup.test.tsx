// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JiraApi, LookupResult } from '../../../assets/jira/jiraApi';
import { type JiraState, JiraStatus } from '../../../assets/jira/jiraStatus';
import { TicketBook } from '../../../assets/jira/ticketBook';
import { TicketsProvider } from '../../../assets/jira/TicketsContext';
import { LOOKUP_DELAY, type Lookup, type TicketCheck, useTicketLookup } from '../../../assets/jira/useTicketLookup';

// React vérifie que ses rendus de test passent par act().
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EXPORT = {
    title: 'Export CSV des commandes filtrées par période et par statut',
    type: 'Story',
    color: 'vert',
} as const;

/** Ce que le crochet rend, relu après chaque rendu. */
interface Seen {
    lookup: Lookup;
    settled: () => Promise<Lookup>;
    check: TicketCheck;
}

function Probe({ typed, onRender }: { typed: string; onRender: (seen: Seen) => void }) {
    onRender(useTicketLookup(typed));

    return null;
}

describe('la recherche du ticket tapé', () => {
    let root: Root;
    let lookup: ReturnType<typeof vi.fn<(ticket: string) => Promise<LookupResult>>>;
    let book: TicketBook;
    const seen: { current: Seen | null } = { current: null };

    const type = (typed: string, state: JiraState = 'connected') => {
        act(() => {
            root.render(
                <TicketsProvider book={book} state={state}>
                    <Probe
                        typed={typed}
                        onRender={(rendered) => {
                            seen.current = rendered;
                        }}
                    />
                </TicketsProvider>,
            );
        });
    };
    const current = (): Lookup => seen.current?.lookup ?? { status: 'idle' };

    beforeEach(() => {
        vi.useFakeTimers();
        lookup = vi.fn((ticket: string) =>
            Promise.resolve<LookupResult>(
                ticket === 'SHOP-999' ? { status: 'not_found' } : { status: 'found', ticket: EXPORT },
            ),
        );
        const api = {
            lookup,
            connection: () => Promise.resolve(null),
        } as unknown as JiraApi;
        book = new TicketBook(api, new JiraStatus(api, { state: 'connected', missingScopes: [] }));
        const container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        vi.useRealTimers();
    });

    it('ne cherche rien tant que ce qui est tapé n’a pas la forme d’un ticket', () => {
        type('');
        expect(current()).toEqual({ status: 'idle' });
        type('SHOP');
        expect(current()).toEqual({ status: 'idle' });
        act(() => {
            vi.advanceTimersByTime(LOOKUP_DELAY * 2);
        });
        expect(lookup).not.toHaveBeenCalled();
    });

    it('cherche dans Jira quand la frappe s’arrête, une seule fois', async () => {
        type('SHOP-4');
        type('SHOP-48');
        type('shop-482');
        expect(current()).toEqual({ status: 'searching', ticket: 'SHOP-482' });

        await act(async () => {
            await vi.advanceTimersByTimeAsync(LOOKUP_DELAY);
        });

        expect(lookup).toHaveBeenCalledTimes(1);
        expect(lookup).toHaveBeenCalledWith('SHOP-482');
        expect(current()).toEqual({ status: 'found', ticket: 'SHOP-482', info: EXPORT });
    });

    it('montre sans attendre un ticket déjà connu', () => {
        book.learn({ 'SHOP-482': EXPORT });

        type('SHOP-482');

        expect(current()).toEqual({ status: 'found', ticket: 'SHOP-482', info: EXPORT });
        expect(lookup).not.toHaveBeenCalled();
    });

    it('fait partir la recherche tout de suite quand on enregistre, et en rend la réponse', async () => {
        type('SHOP-999');

        let answer: Lookup | null = null;
        await act(async () => {
            answer = await (seen.current?.settled() ?? Promise.reject(new Error('Aucun rendu.')));
        });

        expect(answer).toEqual({ status: 'not_found', ticket: 'SHOP-999' });
        expect(lookup).toHaveBeenCalledTimes(1);
        expect(current()).toEqual({ status: 'not_found', ticket: 'SHOP-999' });

        // La frappe reprise efface la réponse : le ticket se cherche de nouveau.
        type('SHOP-9990');
        expect(current()).toEqual({ status: 'searching', ticket: 'SHOP-9990' });
    });

    it('redemande à Jira un ticket retapé, Jira revenu : sa réponse d’avant ne vaut plus', async () => {
        lookup.mockResolvedValueOnce({ status: 'refused', refusal: 'refused' });
        type('SHOP-999');
        await act(async () => {
            await vi.advanceTimersByTimeAsync(LOOKUP_DELAY);
        });
        expect(current()).toEqual({ status: 'refused', ticket: 'SHOP-999' });

        // La fenêtre se ferme, puis une autre s'ouvre, où l'on retape le même ticket.
        type('');
        type('SHOP-999');
        expect(current()).toEqual({ status: 'searching', ticket: 'SHOP-999' });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(LOOKUP_DELAY);
        });

        expect(current()).toEqual({ status: 'not_found', ticket: 'SHOP-999' });
    });

    it('redemande à Jira, en enregistrant, un ticket qu’il n’a pas pu vérifier', async () => {
        lookup.mockResolvedValueOnce({ status: 'refused', refusal: 'refused' });
        type('SHOP-999');
        await act(async () => {
            await vi.advanceTimersByTimeAsync(LOOKUP_DELAY);
        });
        expect(current()).toEqual({ status: 'refused', ticket: 'SHOP-999' });

        // Le refus levé ailleurs : sans rien retaper, enregistrer lui redemande.
        let known: boolean | undefined;
        await act(async () => {
            known = await seen.current?.check.known();
        });

        expect(known).toBe(false);
        expect(current()).toEqual({ status: 'not_found', ticket: 'SHOP-999' });
    });

    it('ne redemande rien pour un ticket que Jira a trouvé ou refusé', async () => {
        type('SHOP-999');
        await act(async () => {
            await vi.advanceTimersByTimeAsync(LOOKUP_DELAY);
        });

        expect(seen.current?.check.refused).toBe(true);
        expect(seen.current?.check.known()).toBeUndefined();
        expect(lookup).toHaveBeenCalledTimes(1);
    });

    it('ne montre rien d’un ticket, même connu, quand Jira refuse le jeton : il le dit', async () => {
        book.learn({ 'SHOP-482': EXPORT });

        type('SHOP-482', 'refused');
        expect(current()).toEqual({ status: 'searching', ticket: 'SHOP-482' });

        await act(async () => {
            await vi.advanceTimersByTimeAsync(LOOKUP_DELAY);
        });
        // Le serveur le décrit sans Jira : le jeton n'en passe pas pour autant.
        expect(current()).toEqual({ status: 'refused', ticket: 'SHOP-482' });
    });
});
