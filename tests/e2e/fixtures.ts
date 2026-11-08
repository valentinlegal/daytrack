import { readFileSync } from 'node:fs';

import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, test as base, expect, type Page, type Request, type TestInfo } from '@playwright/test';

import { claimDay, collectDays, releaseDays, stopCollecting } from './day';
import { CONNECTED, describedTickets, type JiraSetup, serveJira } from './jira';
import { clearSentDay } from './send';
import { SAMPLE_SETTINGS, type ServedSettings, SettingsServer } from './settings';

/** Un favori servi à la page sans passer par la base : son ticket, et le nom qui tient lieu de titre. */
export interface ShownFavorite {
    readonly ticket: string;
    readonly name: string | null;
}

/**
 * Les favoris d'exemple : sans nom, la carte montre le titre venu de Jira.
 */
export const SAMPLE_FAVORITES: readonly ShownFavorite[] = [
    { ticket: 'SHOP-482', name: null },
    { ticket: 'SHOP-501', name: null },
    { ticket: 'OPS-12', name: null },
    { ticket: 'OPS-7', name: null },
    { ticket: 'SHOP-377', name: null },
];

/**
 * Les jours qu'un parcours écrit sont à lui : ceux qu'il pose par l'API (writeDay), et ceux
 * que sa page écrit, le geste à peine parti. Ils se vident quand il s'arrête, qu'il
 * réussisse ou non, et s'il en a envoyé un sur Jira, ses heures en sont retirées
 * (clearSentDay). Aucun parcours ne les vide lui-même en dernière ligne : un échec
 * l'arrêterait avant, et laisserait ses blocs dans l'application de développement.
 *
 * Chaque parcours échoue sur une erreur de la page ou de sa console : un écran qui
 * s'affiche peut cacher un script en panne.
 *
 * Un parcours qui provoque exprès un refus du serveur — une journée changée ailleurs
 * (409), une saisie refusée (422) — le déclare par `expectedErrors` : le navigateur
 * écrit ce refus dans la console, et c'est la seule erreur qu'il y laisse passer.
 *
 * Les favoris ne tiennent à aucun jour : un parcours qui en écrit se verrait dans les
 * captures de tous les autres, qui tournent en même temps. La page reçoit donc ceux
 * d'exemple (`favorites: 'sample'`), ou aucun (`'none'`), sans que la base soit lue, et
 * une écriture n'y part pas : elle échoue, et le parcours avec. Seuls les parcours des
 * favoris eux-mêmes lisent et écrivent la base (`'base'`), l'un après l'autre
 * (tests/e2e/favorites.spec.ts).
 *
 * Les réglages sont servis de même (tests/e2e/settings.ts) : ceux d'exemple, ou ceux
 * qu'un parcours demande (`settings`), et `settingsServer` dit ce qu'il a reçu. Aucun
 * parcours ne change ceux de l'application de développement.
 *
 * Le calendrier marque chaque jour de son mois, que d'autres parcours remplissent et
 * vident pendant ce temps : une capture n'y aurait jamais les mêmes marques. La page n'en
 * reçoit donc aucune (`marks: 'none'`), ni aucun jour mis à 0h00, et la légende garde
 * leurs formes. Seuls les
 * parcours du calendrier lisent celles de la base (`'base'`), sur des jours à eux
 * (tests/e2e/calendar.spec.ts).
 *
 * La version à installer est servie de même (`available`) : aucune par défaut, pour qu'un
 * parcours qui en publie une ne se voie pas dans les captures des autres. Seul celui qui
 * passe par le serveur la lit là (`'server'`), dans tests/e2e/version.spec.ts.
 */
export const test = base.extend<{
    ownDays: undefined;
    pageErrors: string[];
    expectedErrors: readonly RegExp[];
    favorites: 'sample' | 'none' | 'base';
    favoritesServed: undefined;
    marks: 'none' | 'base';
    marksServed: undefined;
    jira: JiraSetup;
    jiraServed: undefined;
    settings: ServedSettings;
    settingsServer: SettingsServer;
    available: string | null;
    availableServed: undefined;
}>({
    ownDays: [
        async ({ context, request }, use) => {
            collectDays();
            const refused: unknown[] = [];
            const pending = new Set<Request>();
            const claim = (sent: Request) => {
                const date = writtenDay(sent);
                if (date !== null) {
                    pending.add(sent);
                    try {
                        claimDay(date);
                    } catch (error) {
                        refused.push(error);
                    }
                }
            };
            const settle = (sent: Request) => {
                pending.delete(sent);
            };
            context.on('request', claim);
            context.on('requestfinished', settle);
            context.on('requestfailed', settle);
            await use(undefined);
            context.off('request', claim);
            // Une écriture encore en route arriverait après le ménage : elle passe d'abord,
            // sauf si le parcours la retient lui-même.
            for (const deadline = Date.now() + 5000; pending.size > 0 && Date.now() < deadline;) {
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            context.off('requestfinished', settle);
            context.off('requestfailed', settle);
            await emptyDays(request);
            if (refused.length > 0) {
                throw refused[0];
            }
        },
        { auto: true },
    ],
    expectedErrors: [[], { option: true }],
    favorites: ['sample', { option: true }],
    // Jira relié, et qui connaît les tickets d'exemple : servi à la page, sans
    // toucher la connexion de l'application de développement (tests/e2e/jira.ts).
    jira: [CONNECTED, { option: true }],
    jiraServed: [
        async ({ page, jira }, use) => {
            await serveJira(page.context(), jira);
            await use(undefined);
            // Une lecture encore en route à la fin du parcours — la journée qu'un dernier
            // clic ouvre — n'a plus de page où répondre : elle se tait, au lieu d'emporter
            // le parcours suivant.
            await page.context().unrouteAll({ behavior: 'ignoreErrors' });
        },
        { auto: true },
    ],
    settings: [SAMPLE_SETTINGS, { option: true }],
    settingsServer: [
        async ({ page, settings }, use) => {
            const server = new SettingsServer(settings);
            await server.serve(page);
            await use(server);
        },
        { auto: true },
    ],
    favoritesServed: [
        async ({ page, favorites }, use) => {
            if (favorites !== 'base') {
                await serveFavorites(page, favorites === 'sample' ? SAMPLE_FAVORITES : []);
            }
            await use(undefined);
        },
        { auto: true },
    ],
    available: [null, { option: true }],
    availableServed: [
        async ({ page, available }, use) => {
            if (available !== 'server') {
                await page.route('**/api/version', (route) => route.fulfill({ json: { available } }));
            }
            await use(undefined);
        },
        { auto: true },
    ],
    marks: ['none', { option: true }],
    marksServed: [
        async ({ page, marks }, use) => {
            if (marks === 'none') {
                await page.route('**/api/calendar/**', async (route) => {
                    const response = await route.fetch();
                    await route.fulfill({
                        response,
                        json: { ...((await response.json()) as object), marks: {}, daysOff: [] },
                    });
                });
            }
            await use(undefined);
            // Une lecture du calendrier encore en route à la fin du parcours n'a plus de page
            // où répondre : elle se tait.
            await page.unrouteAll({ behavior: 'ignoreErrors' });
        },
        { auto: true },
    ],
    pageErrors: [
        async ({ page, expectedErrors }, use) => {
            const errors: string[] = [];
            page.on('pageerror', (error) => errors.push(error.message));
            page.on('console', (message) => {
                if (message.type() === 'error') {
                    errors.push(message.text());
                }
            });

            await use(errors);

            expect(
                errors.filter((error) => !expectedErrors.some((expected) => expected.test(error))),
                'Erreurs de la page ou de sa console',
            ).toEqual([]);
        },
        { auto: true },
    ],
});

/** Le jour qu'écrit cette requête de la page, s'il y en a un. */
function writtenDay(request: Request): string | null {
    if (request.method() === 'GET' || request.method() === 'HEAD') {
        return null;
    }

    return /\/api\/days\/(\d{4}-\d{2}-\d{2})(?:[/?]|$)/.exec(new URL(request.url()).pathname)?.[1] ?? null;
}

/** Vide les jours que le parcours a pris, et les retire de Jira s'ils y sont partis. */
async function emptyDays(request: APIRequestContext): Promise<void> {
    const failures: unknown[] = [];
    for (const date of releaseDays()) {
        try {
            await clearSentDay(request, date);
        } catch (error) {
            failures.push(error);
        }
    }
    stopCollecting();
    if (failures.length > 0) {
        throw failures[0];
    }
}

/**
 * Sert ces favoris à la page, à la place de ceux de la base, avec ce que Jira dit de leurs
 * tickets ; une écriture n'y part pas.
 */
export async function serveFavorites(page: Page, favorites: readonly ShownFavorite[]): Promise<void> {
    await page.route('**/api/favorites**', (route) =>
        route.request().method() === 'GET'
            ? route.fulfill({
                  json: {
                      favorites: shownFavorites(favorites),
                      tickets: describedTickets(favorites.map(({ ticket }) => ticket)),
                  },
              })
            : route.abort(),
    );
}

/**
 * Les favoris tels que l'API les rend, chacun avec son identifiant ; `first` est la place
 * du premier dans la liste servie, pour qu'une liste raccourcie garde les mêmes.
 */
export function shownFavorites(favorites: readonly ShownFavorite[], first = 0) {
    return favorites.map((favorite, index) => ({
        id: `0199a3c4-5b6d-7e8f-9a0b-${String(first + index).padStart(12, '0')}`,
        ...favorite,
    }));
}

/**
 * Le refus que le navigateur écrit dans la console pour une réponse de ce statut : sans
 * texte quand elle vient du serveur, avec le sien quand le parcours la sert lui-même.
 */
export function refusedWith(status: 409 | 422): RegExp {
    return new RegExp(
        `^Failed to load resource: the server responded with a status of ${String(status)} \\((Conflict|Unprocessable Entity)?\\)$`,
    );
}

export { expect };

/** Les normes que chaque écran respecte : le WCAG 2.2, niveau AA, et les bonnes pratiques d'axe. */
const ACCESSIBILITY_STANDARDS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/**
 * Une infobulle ouverte : Radix la pose à la racine de la page, hors des repères, comme
 * toute infobulle. Un parcours qui la laisse ouverte l'exclut du contrôle, en le disant.
 */
export const OPEN_TOOLTIP = '[data-radix-popper-content-wrapper]:has([role="tooltip"])';

/**
 * La page respecte les normes d'accessibilité, partout les mêmes, hors de ce qu'un parcours
 * exclut en le nommant. Une page dont l'heure est arrêtée la fait d'abord tourner
 * (`page.clock.resume()`) : axe attend ses propres minuteurs.
 */
export async function expectAccessible(
    page: Page,
    { exclude = [] }: { exclude?: readonly string[] } = {},
): Promise<void> {
    const builder = new AxeBuilder({ page }).withTags(ACCESSIBILITY_STANDARDS);
    for (const selector of exclude) {
        builder.exclude(selector);
    }
    expect((await builder.analyze()).violations).toEqual([]);
}

/** Les largeurs auxquelles chaque écran se vérifie. */
export const VIEWPORTS = [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 1024, height: 720 },
] as const;

export const THEMES = [
    { scheme: 'light', name: 'clair' },
    { scheme: 'dark', name: 'sombre' },
] as const;

/**
 * Comparer des captures n'a de sens que sur une même architecture, celle que nomme
 * tests/e2e/references-arch. Ailleurs, le rendu du texte diffère au pixel près : la capture
 * s'y prend pour être regardée (test-results/), sans être comparée.
 */
export const CANONICAL_ARCH =
    process.arch === readFileSync(new URL('./references-arch', import.meta.url), 'utf8').trim();

/**
 * @param fullPage toute la page, ou ce qu'on en voit : une page défilée garde sa barre en haut
 */
export async function expectScreen(page: Page, testInfo: TestInfo, name: string, fullPage = true): Promise<void> {
    // La version installée, remise à une version d'exemple : une capture ne change pas à
    // chaque version.
    for (const version of await page.locator('.column-version').all()) {
        await version.evaluate((node) => {
            node.textContent = 'v2.4.0';
        });
    }

    if (CANONICAL_ARCH) {
        await expect(page).toHaveScreenshot(name, { fullPage });

        return;
    }

    await page.screenshot({ path: testInfo.outputPath(name), fullPage, animations: 'disabled' });
    testInfo.annotations.push({
        type: 'capture',
        description: `${name} prise, comparée seulement sur l'architecture de ses références`,
    });
}
