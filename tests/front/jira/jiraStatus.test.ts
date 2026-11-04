import { describe, expect, it, vi } from 'vitest';

import type { CheckResult, JiraApi, JiraConnection } from '../../../assets/jira/jiraApi';
import { JiraStatus, readJiraStatus } from '../../../assets/jira/jiraStatus';
import { refusalSentence } from '../../../assets/jira/TokenBanner';

const CONNECTION: JiraConnection = {
    site: 'https://jira',
    email: 'dev@daytrack.test',
    account: 'Compte de développement',
    refusal: null,
    missingScopes: [],
};

function fakeApi(overrides: Partial<JiraApi> = {}): JiraApi {
    return {
        connection: () => Promise.resolve(CONNECTION),
        test: () => Promise.reject(new Error('non')),
        link: () => Promise.reject(new Error('non')),
        check: () => Promise.resolve({ status: 'connected', account: CONNECTION.account, missingScopes: [] }),
        lookup: () => Promise.reject(new Error('non')),
        refresh: () => Promise.reject(new Error('non')),
        ...overrides,
    };
}

describe("l'état de la connexion à Jira", () => {
    it('part de ce que la page dit, une valeur inconnue se lisant « pas relié »', () => {
        expect(readJiraStatus('connected', '')).toEqual({ state: 'connected', missingScopes: [] });
        expect(readJiraStatus('missing_scope', 'write:jira-work read:jira-user')).toEqual({
            state: 'missing_scope',
            missingScopes: ['write:jira-work', 'read:jira-user'],
        });
        expect(readJiraStatus('refused', 'read:jira-user')).toEqual({ state: 'refused', missingScopes: [] });
        expect(readJiraStatus('autre', undefined)).toEqual({ state: 'unlinked', missingScopes: [] });
        expect(readJiraStatus(undefined, undefined)).toEqual({ state: 'unlinked', missingScopes: [] });
    });

    it('suit la vérification à l’ouverture ; un Jira muet ne dit rien du jeton', async () => {
        let answer: CheckResult = { status: 'refused', account: null, missingScopes: [] };
        const status = new JiraStatus(fakeApi({ check: () => Promise.resolve(answer) }), {
            state: 'connected',
            missingScopes: [],
        });
        const listener = vi.fn();
        status.subscribe(listener);

        await status.check();
        expect(status.current()).toEqual({ state: 'refused', missingScopes: [] });

        answer = { status: 'unreachable', account: null, missingScopes: [] };
        await status.check();
        expect(status.current().state).toBe('refused');

        answer = { status: 'missing_scope', account: null, missingScopes: ['read:jira-user'] };
        await status.check();
        expect(status.current()).toEqual({ state: 'missing_scope', missingScopes: ['read:jira-user'] });
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('ne vérifie rien tant que DayTrack n’est pas relié', async () => {
        const check = vi.fn(() =>
            Promise.resolve<CheckResult>({ status: 'refused', account: null, missingScopes: [] }),
        );
        const status = new JiraStatus(fakeApi({ check }), { state: 'unlinked', missingScopes: [] });

        await status.check();
        status.learn('refused');

        expect(check).not.toHaveBeenCalled();
        expect(status.current().state).toBe('unlinked');
    });

    it('relit chez le serveur les périmètres qui manquent, qu’il a éprouvés', async () => {
        const connection = vi.fn(() =>
            Promise.resolve<JiraConnection>({
                ...CONNECTION,
                refusal: 'missing_scope',
                missingScopes: ['write:jira-work'],
            }),
        );
        const status = new JiraStatus(fakeApi({ connection }), { state: 'connected', missingScopes: [] });

        status.learn('missing_scope');
        expect(status.current()).toEqual({ state: 'missing_scope', missingScopes: [] });
        await vi.waitFor(() => {
            expect(status.current().missingScopes).toEqual(['write:jira-work']);
        });

        // Le même refus ne se relit pas deux fois ; une réponse de Jira l'efface.
        status.learn('missing_scope');
        expect(connection).toHaveBeenCalledTimes(1);
        status.learn(null);
        expect(status.current()).toEqual({ state: 'connected', missingScopes: [] });
    });

    it('repart d’une connexion tout juste enregistrée', () => {
        const status = new JiraStatus(fakeApi(), { state: 'refused', missingScopes: [] });

        status.linked(CONNECTION);

        expect(status.current()).toEqual({ state: 'connected', missingScopes: [] });
    });
});

describe('le bandeau du jeton refusé', () => {
    it('dit pourquoi Jira refuse le jeton, et nomme ce qui lui manque', () => {
        expect(refusalSentence({ state: 'refused', missingScopes: [] })).toBe(
            'Jira refuse le jeton enregistré, il a sans doute expiré.',
        );
        expect(refusalSentence({ state: 'missing_scope', missingScopes: ['read:jira-user'] })).toBe(
            'Jira refuse le jeton enregistré, il lui manque le périmètre read:jira-user.',
        );
        expect(refusalSentence({ state: 'missing_scope', missingScopes: ['read:jira-user', 'write:jira-work'] })).toBe(
            'Jira refuse le jeton enregistré, il lui manque les périmètres read:jira-user et write:jira-work.',
        );
        expect(
            refusalSentence({
                state: 'missing_scope',
                missingScopes: ['read:jira-work', 'write:jira-work', 'read:jira-user'],
            }),
        ).toBe(
            'Jira refuse le jeton enregistré, il lui manque les périmètres read:jira-work, write:jira-work et read:jira-user.',
        );
        expect(refusalSentence({ state: 'missing_scope', missingScopes: [] })).toBe(
            'Jira refuse le jeton enregistré, il lui manque un périmètre.',
        );
    });
});
