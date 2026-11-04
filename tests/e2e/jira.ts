import type { BrowserContext, Page, Route } from '@playwright/test';

/** La teinte de départ des types du Jira simulé (src/Settings/Tint.php). */
const STARTING_TINTS: Readonly<Record<string, string>> = { Story: 'vert', Bug: 'rouge', Tâche: 'bleu', Epic: 'violet' };

/**
 * Les tickets du Jira simulé (dev/jira/src/Catalog.php), tels que l'écran les reçoit :
 * ceux des exemples, avec leur titre et leur type.
 */
export const JIRA_TICKETS: Readonly<Record<string, { readonly title: string; readonly type: string }>> = {
    'OPS-12': { type: 'Tâche', title: "Cérémonies d'équipe" },
    'OPS-7': { type: 'Tâche', title: 'Support applicatif niveau 2' },
    'OPS-21': { type: 'Tâche', title: 'Revue des alertes de production' },
    'SHOP-377': { type: 'Epic', title: 'Refonte du tunnel de commande' },
    'SHOP-482': { type: 'Story', title: 'Export CSV des commandes filtrées par période et par statut' },
    'SHOP-498': { type: 'Story', title: 'Filtre par marque dans la recherche produits' },
    'SHOP-501': { type: 'Story', title: 'Relance automatique des paniers abandonnés' },
    'SHOP-512': { type: 'Tâche', title: 'Mise à jour des dépendances du front' },
    'SHOP-519': { type: 'Bug', title: 'Le total du panier ignore la remise quand le code est saisi en minuscules' },
    'SHOP-530': { type: 'Bug', title: 'Le bouton Payer reste désactivé après une erreur de validation' },
    'SHOP-531': { type: 'Bug', title: 'Reproduire le blocage du bouton Payer' },
};

/** Le compte du Jira simulé : son adresse, son e-mail, son jeton sans périmètre et son nom. */
export const JIRA_ACCOUNT = {
    site: 'https://jira',
    email: 'dev@daytrack.test',
    token: 'jeton-de-developpement',
    name: 'Compte de développement',
} as const;

/**
 * Ce que l'écran voit de Jira, servi à la page sans toucher la connexion de
 * l'application de développement : les parcours tournent en même temps, et la
 * bienvenue, le jeton refusé ou le périmètre manquant y sont des états de toute
 * l'application.
 */
export interface JiraSetup {
    /** Où en est la connexion, comme la page le dit. */
    readonly state: 'unlinked' | 'connected' | 'refused' | 'missing_scope';
    readonly missingScopes?: readonly string[];
    /** Ce que Jira répond d'un ticket qu'on tape : le catalogue, ou rien. */
    readonly lookup?: 'catalog' | 'unreachable' | 'refused';
    /**
     * Ce qu'il répond d'un ticket hors du catalogue. Les parcours de la grille tapent
     * ESSAI-1, OPS-1… : Jira ne les connaît pas, et sans réponse de sa part, ils
     * s'enregistrent comme avant qu'il soit relié, sans titre.
     */
    readonly unknown?: 'not_found' | 'unreachable';
    /** Le temps que met la recherche d'un ticket, en millisecondes. */
    readonly lookupDelay?: number;
}

export const CONNECTED: JiraSetup = { state: 'connected' };

const REFUSAL = (setup: JiraSetup) =>
    setup.state === 'refused' || setup.state === 'missing_scope' ? setup.state : null;

/**
 * Ce que le serveur dit de ces tickets quand Jira les a décrits : ceux du catalogue,
 * dans la teinte de départ de leur type.
 */
export function describedTickets(
    tickets: readonly string[],
): Record<string, { title: string; type: string; color: string | null }> {
    return Object.fromEntries(
        tickets.flatMap((ticket) => {
            const known = JIRA_TICKETS[ticket];

            return known === undefined ? [] : [[ticket, described(known)]];
        }),
    );
}

/** Un ticket du catalogue, tel que le serveur le décrit : avec la teinte de son type. */
export function described(ticket: { readonly title: string; readonly type: string }) {
    return { ...ticket, color: STARTING_TINTS[ticket.type] ?? null };
}

/**
 * Sert à chaque onglet cet état de Jira : la page elle-même, l'API de la connexion et des
 * tickets, et les titres que porte chaque journée, comme quand Jira les a déjà décrits.
 * Un parcours qui sert sa propre réponse à un onglet passe devant.
 */
export async function serveJira(context: BrowserContext, setup: JiraSetup): Promise<void> {
    const scopes = setup.state === 'missing_scope' ? (setup.missingScopes ?? ['read:jira-user']) : [];

    await context.route(
        // Seule la page servie en HTTPS : une adresse en http:// doit garder sa redirection.
        (url) => url.protocol === 'https:' && /^\/(\d{4}-\d{2}-\d{2}|reglages)$/.test(url.pathname),
        async (route) => {
            if (route.request().resourceType() !== 'document') {
                await route.fallback();

                return;
            }
            const response = await route.fetch();
            const body = (await response.text())
                .replace(/data-jira="[^"]*"/, `data-jira="${setup.state}"`)
                .replace(/data-jira-scopes="[^"]*"/, `data-jira-scopes="${scopes.join(' ')}"`);
            await route.fulfill({ response, body });
        },
    );

    // Une journée, lue ou écrite, porte les titres de ses tickets, ceux de ce Jira-ci :
    // jamais ceux du serveur de développement, relié ou non, pour que chaque parcours
    // voie la même chose ici et dans l'intégration continue.
    if (setup.state !== 'unlinked') {
        await context.route('**/api/days/**', async (route) => {
            const response = await route.fetch();
            const json: unknown = await response.json().catch(() => null);
            if (typeof json !== 'object' || json === null) {
                await route.fulfill({ response });

                return;
            }
            const day = 'day' in json && typeof json.day === 'object' && json.day !== null ? json.day : json;
            if ('blocks' in day && Array.isArray(day.blocks)) {
                Object.assign(day, {
                    tickets: describedTickets(day.blocks.map((block: { ticket?: string }) => block.ticket ?? '')),
                });
            }
            await route.fulfill({ response, json });
        });

        // Les favoris lus dans la base de même : leurs titres sont ceux de ce Jira-ci.
        await context.route('**/api/favorites**', async (route) => {
            const response = await route.fetch();
            const json: unknown = await response.json().catch(() => null);
            if (typeof json !== 'object' || json === null || !('favorites' in json) || !Array.isArray(json.favorites)) {
                await route.fulfill({ response });

                return;
            }
            Object.assign(json, {
                tickets: describedTickets(json.favorites.map((favorite: { ticket?: string }) => favorite.ticket ?? '')),
            });
            await route.fulfill({ response, json });
        });
    }

    await context.route(
        (url) =>
            url.pathname === '/api/jira' ||
            url.pathname === '/api/jira/check' ||
            url.pathname.startsWith('/api/tickets/'),
        async (route) => {
            const request = route.request();
            const path = new URL(request.url()).pathname;

            if (path === '/api/jira/check') {
                await route.fulfill({
                    json: {
                        status: setup.state === 'unlinked' ? 'not_linked' : setup.state,
                        account: setup.state === 'connected' ? JIRA_ACCOUNT.name : null,
                        missingScopes: scopes,
                    },
                });
            } else if (path === '/api/jira' && request.method() === 'GET') {
                await route.fulfill({ json: connection(setup, scopes) });
            } else if (path === '/api/tickets/refresh') {
                await refresh(route, setup);
            } else if (path.endsWith('/lookup')) {
                await lookup(route, setup, decodeURIComponent(path.slice('/api/tickets/'.length, -'/lookup'.length)));
            } else {
                // Tester, relier : le vrai serveur, contre le Jira simulé. Un refus n'y garde
                // rien ; un parcours qui relie pour de bon sert sa propre réponse.
                await route.fallback();
            }
        },
    );
}

/** La connexion telle que GET /api/jira la rend. */
export function connection(setup: JiraSetup, scopes: readonly string[] = []) {
    return setup.state === 'unlinked'
        ? { linked: false }
        : {
              linked: true,
              site: JIRA_ACCOUNT.site,
              email: JIRA_ACCOUNT.email,
              account: JIRA_ACCOUNT.name,
              refusal: REFUSAL(setup),
              missingScopes: scopes,
          };
}

async function refresh(route: Route, setup: JiraSetup): Promise<void> {
    const body = route.request().postDataJSON() as { tickets?: string[] } | null;
    await route.fulfill({ json: { tickets: describedTickets(body?.tickets ?? []), refusal: REFUSAL(setup) } });
}

async function lookup(route: Route, setup: JiraSetup, ticket: string): Promise<void> {
    if (setup.lookupDelay !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, setup.lookupDelay));
    }
    const known = JIRA_TICKETS[ticket];
    const mode = setup.lookup ?? (REFUSAL(setup) === null ? 'catalog' : 'refused');
    const status =
        mode === 'unreachable'
            ? 'unreachable'
            : mode === 'refused'
              ? (REFUSAL(setup) ?? 'refused')
              : known === undefined
                ? (setup.unknown ?? 'unreachable')
                : 'found';

    await route.fulfill({
        json: {
            status,
            ticket: status === 'found' && known !== undefined ? described(known) : null,
            refusal: REFUSAL(setup),
        },
    });
}

/** Le compte d'exemple : Camille Martin, sur exemple.atlassian.net. */
export const SAMPLE_ACCOUNT = {
    site: 'https://exemple.atlassian.net',
    email: 'camille.martin@exemple.fr',
    name: 'Camille Martin',
} as const;

/** La connexion d'exemple, servie à cet onglet : ce que lisent les réglages. */
export async function serveSampleConnection(page: Page, setup: JiraSetup): Promise<void> {
    const scopes = setup.state === 'missing_scope' ? ['read:jira-user'] : [];
    await page.route('**/api/jira', (route) =>
        route.request().method() === 'GET'
            ? route.fulfill({
                  json: {
                      ...connection(setup, scopes),
                      site: SAMPLE_ACCOUNT.site,
                      email: SAMPLE_ACCOUNT.email,
                      account: SAMPLE_ACCOUNT.name,
                  },
              })
            : route.fallback(),
    );
    await page.route('**/api/jira/check', (route) =>
        route.fulfill({
            json: {
                status: setup.state,
                account: setup.state === 'connected' ? SAMPLE_ACCOUNT.name : null,
                missingScopes: scopes,
            },
        }),
    );
}
