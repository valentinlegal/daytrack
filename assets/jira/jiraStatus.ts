import type { CheckResult, JiraApi, JiraConnection, TokenRefusal } from './jiraApi';

/** Où en est la connexion à Jira, telle que la page le dit (data-jira). */
export type JiraState = 'unlinked' | 'connected' | TokenRefusal;

/**
 * Jira refuse-t-il le jeton : expiré, révoqué, ou un périmètre qui manque ? Le seul endroit
 * qui le dit, pour l'état de la page, un envoi ou une vérification.
 */
export function isTokenRefusal(value: unknown): value is TokenRefusal {
    return value === 'refused' || value === 'missing_scope';
}

/** Ce que dit tout l'écran d'un jeton qui ne passe plus, quand Jira ne nomme pas de périmètre. */
export const TOKEN_EXPIRED = 'Jira refuse le jeton enregistré, il a sans doute expiré.';

export interface JiraStatusSnapshot {
    readonly state: JiraState;
    /** Les périmètres qui manquent au jeton, quand c'est ce que Jira lui reproche. */
    readonly missingScopes: readonly string[];
}

/**
 * L'état de la connexion à Jira, que le bandeau du jeton refusé suit.
 *
 * Il part de ce que la page dit à son ouverture, puis suit ce que les réponses
 * apprennent du jeton : la vérification à l'ouverture, la recherche d'un ticket, la
 * relecture des titres. Le serveur l'a déjà enregistré ; seuls les périmètres qui
 * manquent se relisent chez lui, qui les a éprouvés.
 */
export class JiraStatus {
    private readonly api: JiraApi;
    private readonly listeners = new Set<() => void>();
    private snapshot: JiraStatusSnapshot;

    constructor(api: JiraApi, initial: JiraStatusSnapshot) {
        this.api = api;
        this.snapshot = initial;
    }

    current(): JiraStatusSnapshot {
        return this.snapshot;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);

        return () => {
            this.listeners.delete(listener);
        };
    }

    /** L'écran s'ouvre : le jeton enregistré passe-t-il toujours ? */
    async check(): Promise<void> {
        if (this.snapshot.state === 'unlinked') {
            return;
        }
        try {
            this.checked(await this.api.check());
        } catch {
            // Sans réponse, rien n'est appris du jeton.
        }
    }

    /** Ce qu'une vérification du jeton enregistré a donné. Un Jira muet ne dit rien. */
    checked({ status, missingScopes }: CheckResult): void {
        if (status === 'connected') {
            this.set({ state: 'connected', missingScopes: [] });
        } else if (isTokenRefusal(status)) {
            this.set({ state: status, missingScopes: status === 'missing_scope' ? missingScopes : [] });
        }
    }

    /** Ce qu'une réponse dit du jeton enregistré : refusé, ou de nouveau accepté (null). */
    learn(refusal: TokenRefusal | null): void {
        if (
            this.snapshot.state === 'unlinked' ||
            refusal === (this.snapshot.state === 'connected' ? null : this.snapshot.state)
        ) {
            return;
        }
        if (refusal === null) {
            this.set({ state: 'connected', missingScopes: [] });

            return;
        }
        this.set({ state: refusal, missingScopes: [] });
        // Le serveur a éprouvé les périmètres en enregistrant le refus : le bandeau les nomme.
        if (refusal === 'missing_scope') {
            void this.api.connection().then(
                (connection) => {
                    if (connection?.refusal === 'missing_scope' && this.snapshot.state === 'missing_scope') {
                        this.set({ state: 'missing_scope', missingScopes: connection.missingScopes });
                    }
                },
                () => undefined,
            );
        }
    }

    /** Une connexion vient d'être enregistrée : elle a été testée, le jeton passe. */
    linked(connection: JiraConnection): void {
        this.set({
            state: connection.refusal ?? 'connected',
            missingScopes: connection.refusal === 'missing_scope' ? connection.missingScopes : [],
        });
    }

    private set(snapshot: JiraStatusSnapshot): void {
        if (
            snapshot.state === this.snapshot.state &&
            snapshot.missingScopes.join(' ') === this.snapshot.missingScopes.join(' ')
        ) {
            return;
        }
        this.snapshot = snapshot;
        for (const listener of this.listeners) {
            listener();
        }
    }
}

/** L'état que la page porte (templates/app.html.twig) ; une valeur inconnue se lit « pas relié ». */
export function readJiraStatus(state: string | undefined, scopes: string | undefined): JiraStatusSnapshot {
    const known: JiraState = state === 'connected' || isTokenRefusal(state) ? state : 'unlinked';

    return {
        state: known,
        missingScopes: known === 'missing_scope' ? (scopes ?? '').split(' ').filter((scope) => scope !== '') : [],
    };
}
