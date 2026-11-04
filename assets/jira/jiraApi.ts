import { bodyOf, readViolations } from '../day/dayApi';
import type { Violation } from '../grid/daySession';
import { isRecord } from '../grid/json';
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
    | { readonly status: 'invalid'; readonly violations: readonly Violation[] };

export type LinkResult =
    | { readonly status: 'linked'; readonly connection: JiraConnection }
    | { readonly status: 'invalid'; readonly violations: readonly Violation[] };

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
export function httpJiraApi(fetcher: typeof fetch = (input, init) => fetch(input, init)): JiraApi {
    async function send(method: 'GET' | 'POST' | 'PUT', target: string, body?: unknown): Promise<Response> {
        return fetcher(target, {
            method,
            headers:
                body === undefined
                    ? { Accept: 'application/json' }
                    : { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: body === undefined ? null : JSON.stringify(body),
        });
    }

    async function okBody(response: Response, what: string): Promise<unknown> {
        if (response.status !== 200) {
            throw new Error(`L'API a répondu ${String(response.status)} pour ${what}.`);
        }

        return bodyOf(response);
    }

    async function formResult<T>(response: Response, success: (json: unknown) => T): Promise<T | Invalid> {
        const json = await bodyOf(response);
        if (response.status === 200) {
            return success(json);
        }
        if (response.status === 422 && isRecord(json)) {
            return { status: 'invalid', violations: readViolations(json.violations) };
        }

        throw new Error(`L'API a répondu ${String(response.status)} à la connexion à Jira.`);
    }

    // Le jeton ne part que s'il a été collé : sans lui, le serveur reprend celui qu'il garde.
    const fields = ({ site, email, token }: JiraForm) => (token === null ? { site, email } : { site, email, token });

    return {
        async connection() {
            return readConnection(await okBody(await send('GET', '/api/jira'), 'la connexion à Jira'));
        },
        async test(form) {
            return formResult(await send('POST', '/api/jira/test', fields(form)), (json) => ({
                status: 'connected' as const,
                account: text(isRecord(json) ? json.account : undefined, 'le compte'),
            }));
        },
        async link(form) {
            return formResult(await send('PUT', '/api/jira', fields(form)), (json) => {
                const connection = readConnection(json);
                if (connection === null) {
                    throw new TypeError("L'API ne rend pas la connexion qu'elle vient d'enregistrer.");
                }

                return { status: 'linked' as const, connection };
            });
        },
        async check() {
            const json = await okBody(await send('POST', '/api/jira/check', {}), 'la vérification du jeton');
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
        },
        async lookup(ticket) {
            // Une recherche garde le titre et note un refus du jeton : elle écrit, donc POST.
            const json = await okBody(
                await send('POST', `/api/tickets/${encodeURIComponent(ticket)}/lookup`, {}),
                ticket,
            );
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
        },
        async refresh(tickets) {
            const json = await okBody(await send('POST', '/api/tickets/refresh', { tickets }), 'les titres');
            if (!isRecord(json)) {
                throw new TypeError("L'API ne rend pas les titres.");
            }

            return { tickets: readTickets(json.tickets), refusal: refusal(json.refusal) };
        },
    };
}

interface Invalid {
    readonly status: 'invalid';
    readonly violations: readonly Violation[];
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
    return json === 'refused' || json === 'missing_scope' ? json : null;
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
