import { isRecord } from '../grid/json';
import { type Refused, refused, serverApi } from '../serverApi';
import { isTokenRefusal } from './jiraStatus';
import { readTicket, readTickets, type TicketInfo } from './ticketInfo';

/** Ce que Jira reproche au jeton enregistré. */
export type TokenRefusal = 'refused' | 'missing_scope';

/** La connexion enregistrée, sans son jeton. */
export interface JiraConnection {
    readonly site: string;
    readonly email: string;
    readonly account: string;
    readonly refusal: TokenRefusal | null;
    /** Les périmètres qui manquent au jeton, quand c'est ce que Jira lui reproche. */
    readonly missingScopes: readonly string[];
}

/** Les trois champs de la connexion ; sans jeton, c'est celui qui est enregistré qui sert. */
export interface JiraForm {
    readonly site: string;
    readonly email: string;
    readonly token: string | null;
}

export type TestResult =
    | { readonly status: 'connected'; readonly account: string }
    /** Le refus, sous le champ qu'il concerne : le jeton, ou l'adresse que Jira ne sert pas. */
    | Refused;

export type LinkResult = { readonly status: 'linked'; readonly connection: JiraConnection } | Refused;

/** Ce que la vérification du jeton enregistré a donné. */
export interface CheckResult {
    readonly status: 'connected' | TokenRefusal | 'unreachable' | 'not_linked';
    /** Le compte du jeton, quand Jira l'a accepté. */
    readonly account: string | null;
    readonly missingScopes: readonly string[];
}

/** Ce que Jira dit d'un ticket qu'on tape, ou pourquoi il ne le dit pas. */
export type LookupResult = (
    | { readonly status: 'found'; readonly ticket: TicketInfo }
    | { readonly status: 'not_found' | TokenRefusal | 'unreachable' }
) & {
    /**
     * Ce que Jira reproche au jeton enregistré, la recherche faite ; absent quand le
     * serveur n'a pas répondu. Un titre lu sans Jira ne dit pas que le jeton passe.
     */
    readonly refusal?: TokenRefusal | null;
};

export interface RefreshResult {
    readonly tickets: Readonly<Record<string, TicketInfo>>;
    readonly refusal: TokenRefusal | null;
}

export interface JiraApi {
    connection(): Promise<JiraConnection | null>;
    test(form: JiraForm): Promise<TestResult>;
    link(form: JiraForm): Promise<LinkResult>;
    check(): Promise<CheckResult>;
    lookup(ticket: string): Promise<LookupResult>;
    refresh(tickets: readonly string[]): Promise<RefreshResult>;
}

/**
 * L'API de la connexion à Jira et des tickets (src/Controller/Api/JiraController.php,
 * TicketController.php), vue de l'écran.
 *
 * Le jeton ne fait que l'aller : aucune réponse ne le rend. Une réponse inattendue —
 * panne du réseau, erreur du serveur, corps illisible — lève.
 */
export function httpJiraApi(fetcher?: typeof fetch): JiraApi {
    const server = serverApi(fetcher);
    function post<T>(target: string, body: unknown, read: (json: unknown) => T): Promise<T> {
        return server.request('POST', target, { 200: read }, { body });
    }

    // Le jeton ne part que s'il a été collé : sans lui, le serveur reprend celui qu'il garde.
    const fields = ({ site, email, token }: JiraForm) => (token === null ? { site, email } : { site, email, token });

    return {
        connection: () => server.read('/api/jira', readConnection),
        test: (form) =>
            server.request<TestResult>(
                'POST',
                '/api/jira/test',
                {
                    200: (json) => ({
                        status: 'connected',
                        account: text(isRecord(json) ? json.account : undefined, 'le compte'),
                    }),
                    422: refused,
                },
                { body: fields(form) },
            ),
        link: (form) =>
            server.request<LinkResult>(
                'PUT',
                '/api/jira',
                {
                    200: (json) => {
                        const connection = readConnection(json);
                        if (connection === null) {
                            throw new TypeError("L'API ne rend pas la connexion qu'elle vient d'enregistrer.");
                        }

                        return { status: 'linked', connection };
                    },
                    422: refused,
                },
                { body: fields(form) },
            ),
        check: () =>
            post('/api/jira/check', {}, (json): CheckResult => {
                const status = isRecord(json) ? json.status : undefined;
                if (
                    status !== 'connected' &&
                    status !== 'refused' &&
                    status !== 'missing_scope' &&
                    status !== 'unreachable' &&
                    status !== 'not_linked'
                ) {
                    throw new TypeError("L'API ne dit pas si le jeton passe.");
                }

                const account = isRecord(json) && typeof json.account === 'string' ? json.account : null;

                return { status, account, missingScopes: scopes(isRecord(json) ? json.missingScopes : undefined) };
            }),
        // Une recherche garde le titre et note un refus du jeton : elle écrit, donc POST.
        lookup: (ticket) =>
            post(`/api/tickets/${encodeURIComponent(ticket)}/lookup`, {}, (json): LookupResult => {
                const status = isRecord(json) ? json.status : undefined;
                // Ce que Jira reproche au jeton, quand le serveur le dit.
                const after = isRecord(json) && 'refusal' in json ? { refusal: refusal(json.refusal) } : {};
                if (status === 'found') {
                    const info = readTicket(isRecord(json) ? json.ticket : undefined);
                    if (info === null) {
                        throw new TypeError(`L'API trouve ${ticket} sans le décrire.`);
                    }

                    return { status, ticket: info, ...after };
                }
                if (
                    status === 'not_found' ||
                    status === 'refused' ||
                    status === 'missing_scope' ||
                    status === 'unreachable'
                ) {
                    return { status, ...after };
                }

                throw new TypeError(`L'API ne dit pas ce que Jira sait de ${ticket}.`);
            }),
        refresh: (tickets) =>
            post('/api/tickets/refresh', { tickets }, (json): RefreshResult => {
                if (!isRecord(json)) {
                    throw new TypeError("L'API ne rend pas les titres.");
                }

                return { tickets: readTickets(json.tickets), refusal: refusal(json.refusal) };
            }),
    };
}

/** La connexion rendue par GET /api/jira, ou null si DayTrack n'est pas relié. */
function readConnection(json: unknown): JiraConnection | null {
    if (!isRecord(json) || typeof json.linked !== 'boolean') {
        throw new TypeError("L'API ne dit pas si DayTrack est relié à Jira.");
    }
    if (!json.linked) {
        return null;
    }

    return {
        site: text(json.site, "l'adresse"),
        email: text(json.email, "l'e-mail"),
        account: text(json.account, 'le compte'),
        refusal: refusal(json.refusal),
        missingScopes: scopes(json.missingScopes),
    };
}

function refusal(json: unknown): TokenRefusal | null {
    return isTokenRefusal(json) ? json : null;
}

function scopes(json: unknown): string[] {
    return Array.isArray(json) ? json.filter((scope): scope is string => typeof scope === 'string') : [];
}

function text(json: unknown, what: string): string {
    if (typeof json !== 'string') {
        throw new TypeError(`L'API ne donne pas ${what}.`);
    }

    return json;
}
