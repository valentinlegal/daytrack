import { describe, expect, it, vi } from 'vitest';

import type { JiraApi, LookupResult, RefreshResult } from '../../../assets/jira/jiraApi';
import { JiraStatus } from '../../../assets/jira/jiraStatus';
import { TicketBook } from '../../../assets/jira/ticketBook';

const EXPORT = {
    title: 'Export CSV des commandes filtrées par période et par statut',
    type: 'Story',
    color: 'vert',
} as const;

function bookWith(overrides: Partial<JiraApi>) {
    const api: JiraApi = {
        connection: () => Promise.resolve(null),
        test: () => Promise.reject(new Error('non')),
        link: () => Promise.reject(new Error('non')),
        check: () => Promise.reject(new Error('non')),
        lookup: () => Promise.reject(new Error('non')),
        refresh: () => Promise.reject(new Error('non')),
        ...overrides,
    };
    const status = new JiraStatus(api, { state: 'connected', missingScopes: [] });

    return { book: new TicketBook(api, status), status };
}

describe('le carnet des tickets', () => {
    it('apprend des réponses, et ne prévient que de ce qui change', () => {
        const { book } = bookWith({});
        const listener = vi.fn();
        book.subscribe(listener);
        const before = book.current();

        book.learn({ 'SHOP-482': EXPORT });
        book.learn({ 'SHOP-482': { ...EXPORT } });

        expect(listener).toHaveBeenCalledTimes(1);
        expect(book.current()).not.toBe(before);
        expect(book.current().get('SHOP-482')).toEqual(EXPORT);

        // Une teinte changée dans les réglages se voit au retour sur la journée.
        book.learn({ 'SHOP-482': { ...EXPORT, color: 'cyan' } });
        expect(listener).toHaveBeenCalledTimes(2);
        expect(book.current().get('SHOP-482')?.color).toBe('cyan');
    });

    it('fait relire chaque ticket une fois, et règle le bandeau sur la réponse', async () => {
        const refresh = vi.fn((tickets: readonly string[]) =>
            Promise.resolve<RefreshResult>({ tickets: { [tickets[0] ?? '']: EXPORT }, refusal: 'refused' }),
        );
        const { book, status } = bookWith({ refresh });

        await book.refresh(['SHOP-482', 'SHOP-482', 'OPS-12']);
        await book.refresh([]);

        expect(refresh).toHaveBeenCalledTimes(1);
        expect(refresh).toHaveBeenCalledWith(['SHOP-482', 'OPS-12']);
        expect(book.current().get('SHOP-482')).toEqual(EXPORT);
        expect(status.current().state).toBe('refused');
    });

    it('garde ses titres quand la relecture n’aboutit pas', async () => {
        const { book, status } = bookWith({ refresh: () => Promise.reject(new Error('réseau')) });
        book.learn({ 'SHOP-482': EXPORT });

        await book.refresh(['SHOP-482']);

        expect(book.current().get('SHOP-482')).toEqual(EXPORT);
        expect(status.current().state).toBe('connected');
    });

    it('retient un ticket trouvé, et ce que le serveur dit du jeton après l’avoir cherché', async () => {
        let answer: LookupResult = { status: 'refused', refusal: 'refused' };
        const { book, status } = bookWith({ lookup: () => Promise.resolve(answer) });

        expect(await book.lookup('SHOP-482')).toEqual(answer);
        expect(status.current().state).toBe('refused');

        // Trouvé sans Jira, dans ce que le serveur gardait : le jeton reste refusé.
        answer = { status: 'found', ticket: EXPORT, refusal: 'refused' };
        expect(await book.lookup('SHOP-482')).toEqual(answer);
        expect(book.current().get('SHOP-482')).toEqual(EXPORT);
        expect(status.current().state).toBe('refused');

        answer = { status: 'found', ticket: EXPORT, refusal: null };
        await book.lookup('SHOP-482');
        expect(status.current().state).toBe('connected');
    });

    it('dit Jira injoignable quand le serveur ne répond pas', async () => {
        const { book } = bookWith({ lookup: () => Promise.reject(new Error('réseau')) });

        expect(await book.lookup('SHOP-482')).toEqual({ status: 'unreachable' });
    });
});
