import type { Page } from '@playwright/test';

import { daysFrom, weekday, writeDay } from './day';
import { doubleClickSlot, openSampleDay, ticketWindow } from './editing';
import { expect, expectAccessible, expectScreen, OPEN_TOOLTIP, refusedWith, test, THEMES, VIEWPORTS } from './fixtures';
import { SAMPLE_ACCOUNT, type JiraSetup, serveSampleConnection } from './jira';
import { SCENARIOS } from './scenarios';
import { pinFooter } from './settings';

/**
 * Les écrans de Jira relié : la bienvenue — `premier`, `premier-erreur`, `premier-aide`,
 * `premier-perimetre` —, la fenêtre Nouveau ticket sur un ticket introuvable ou au jeton
 * refusé — `introuvable`, `ajout-jeton` —, le bandeau — `jeton`, `jeton-perimetre`, et
 * `jeton-1024` à 1024 px —, et les réglages — `reglages-aide`, `reglages-erreur`,
 * `reglages-perimetre`. Chacun a sa capture de référence aux trois largeurs et dans les
 * deux thèmes, et son contrôle d'accessibilité.
 *
 * Les comptes d'exemple, Camille Martin et exemple.atlassian.net, sont servis à la
 * page : rien ne part vers un vrai Jira.
 */
const ENTRIES = SCENARIOS[0]?.entries ?? [];

const SAMPLE_FORM = { ...SAMPLE_ACCOUNT, token: 'xxxxxxxxxxxxxxxxxxxxxxxx' };

const REFUSED = 'Jira refuse cette adresse e-mail ou ce jeton. Vérifiez-les, ou créez un nouveau jeton.';
const MISSING_SCOPE =
    'Il manque à ce jeton un périmètre dont DayTrack a besoin. Créez-en un nouveau avec read:jira-work, write:jira-work et read:jira-user.';

/**
 * Le jour d'un parcours : `index` jours après le 1er avril 2024, à l'écart des autres
 * parcours (jira.spec.ts prend mars 2024, favorites.spec.ts juillet).
 */
const day = daysFrom('2024-04-01');

/**
 * Le jour d'un écran qui montre une journée : un jour de semaine — un samedi serait fermé
 * à la saisie —, six par écran à partir du 16 avril 2024, à l'écart des jours des autres
 * fichiers. Les autres écrans ne font que lire le leur.
 */
function workingDayOf(screen: number, index: number): string {
    return weekday('2024-04-16', screen * 6 + index);
}

/** La bienvenue servie avec le compte d'exemple : « Tester la connexion » répond avec lui. */
async function serveSampleTest(page: Page, answer: { account: string } | { token: string }): Promise<void> {
    await page.route('**/api/jira/test', (route) =>
        'account' in answer
            ? route.fulfill({ json: answer })
            : route.fulfill({ status: 422, json: { violations: [{ field: 'token', message: answer.token }] } }),
    );
}

async function fillSampleForm(page: Page, token: string): Promise<void> {
    await page.getByLabel('Adresse de Jira').fill(SAMPLE_FORM.site);
    await page.getByLabel('Adresse e-mail').fill(SAMPLE_FORM.email);
    await page.getByLabel("Jeton d'API").fill(token);
}

async function openHelp(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Comment créer un jeton' }).click();
    await expect(page.getByRole('button', { name: 'Comment créer un jeton' })).toHaveAttribute('aria-expanded', 'true');
}

const SCREENS: {
    name: string;
    jira: JiraSetup;
    /** Ce que la page écrit dans la console, voulu. */
    expectedErrors?: RegExp[];
    /** Une journée d'exemple « en-cours » sous l'écran, plutôt que rien. */
    day?: boolean;
    reach: (page: Page, date: string) => Promise<void>;
}[] = [
    {
        name: 'premier',
        jira: { state: 'unlinked' },
        reach: async (page, date) => {
            await serveSampleTest(page, { account: 'Camille Martin' });
            await page.goto(`/${date}`);
            await fillSampleForm(page, SAMPLE_FORM.token);
            await page.getByRole('button', { name: 'Tester la connexion' }).click();
            await expect(page.getByText('Connecté à Jira en tant que Camille Martin.')).toBeVisible();
            await page.mouse.move(0, 0);
        },
    },
    {
        name: 'premier-erreur',
        jira: { state: 'unlinked' },
        expectedErrors: [refusedWith(422)],
        reach: async (page, date) => {
            await serveSampleTest(page, { token: REFUSED });
            await page.goto(`/${date}`);
            await fillSampleForm(page, SAMPLE_FORM.token);
            await page.getByRole('button', { name: 'Tester la connexion' }).click();
            await expect(page.getByLabel("Jeton d'API")).toHaveAccessibleDescription(REFUSED);
            await page.mouse.move(0, 0);
        },
    },
    {
        name: 'premier-aide',
        jira: { state: 'unlinked' },
        reach: async (page, date) => {
            await page.goto(`/${date}`);
            await page.getByLabel('Adresse de Jira').fill(SAMPLE_FORM.site);
            await page.getByLabel('Adresse e-mail').fill(SAMPLE_FORM.email);
            await openHelp(page);
            await page.getByRole('button', { name: 'Copier write:jira-work' }).click();
            await expect(page.getByRole('tooltip')).toHaveText('Copié');
        },
    },
    {
        name: 'premier-perimetre',
        jira: { state: 'unlinked' },
        expectedErrors: [refusedWith(422)],
        reach: async (page, date) => {
            await serveSampleTest(page, { token: MISSING_SCOPE });
            await page.goto(`/${date}`);
            await fillSampleForm(page, SAMPLE_FORM.token);
            await page.getByRole('button', { name: 'Tester la connexion' }).click();
            await expect(page.getByLabel("Jeton d'API")).toHaveAccessibleDescription(MISSING_SCOPE);
            await page.mouse.move(0, 0);
        },
    },
    {
        name: 'introuvable',
        jira: { state: 'connected', unknown: 'not_found' },
        day: true,
        reach: async (page) => {
            // Près du récapitulatif : la fenêtre s'arrête contre lui, sa flèche au pointeur.
            await doubleClickSlot(page, '15:15', 680);
            const ticket = ticketWindow(page).getByLabel('Ticket');
            await ticket.fill('SHOP-999');
            await expect(ticket).toHaveAccessibleDescription("Ticket introuvable dans Jira. Vérifiez l'identifiant.");
        },
    },
    {
        name: 'jeton',
        jira: { state: 'refused' },
        day: true,
        reach: async (page) => {
            await expect(page.getByRole('alert')).toContainText('il a sans doute expiré.');
        },
    },
    {
        name: 'jeton-perimetre',
        jira: { state: 'missing_scope', missingScopes: ['read:jira-user'] },
        day: true,
        reach: async (page) => {
            await expect(page.getByRole('alert')).toContainText('il lui manque le périmètre read:jira-user.');
        },
    },
    {
        name: 'ajout-jeton',
        jira: { state: 'refused' },
        day: true,
        reach: async (page) => {
            // SHOP-501 : l'écran le connaît par sa journée, mais rien
            // ne se vérifie tant que Jira refuse le jeton.
            await doubleClickSlot(page, '15:15', 'middle');
            const ticket = ticketWindow(page).getByLabel('Ticket');
            await ticket.fill('SHOP-501');
            await expect(ticket).toHaveAccessibleDescription(
                'Impossible de vérifier ce ticket, Jira refuse le jeton enregistré.',
            );
        },
    },
    {
        name: 'reglages-aide',
        jira: { state: 'connected' },
        reach: async (page) => {
            await serveSampleConnection(page, { state: 'connected' });
            await page.goto('/reglages');
            await expect(page.getByText('Connecté à Jira en tant que Camille Martin.')).toBeVisible();
            await page.getByRole('button', { name: 'Comment créer un jeton' }).click();
            await page.mouse.move(0, 0);
        },
    },
    {
        name: 'reglages-erreur',
        jira: { state: 'refused' },
        reach: async (page) => {
            await serveSampleConnection(page, { state: 'refused' });
            await page.goto('/reglages');
            await expect(page.getByLabel("Jeton d'API")).toHaveAttribute('aria-invalid', 'true');
        },
    },
    {
        name: 'reglages-perimetre',
        jira: { state: 'missing_scope' },
        reach: async (page) => {
            await serveSampleConnection(page, { state: 'missing_scope' });
            await page.goto('/reglages');
            await expect(page.getByLabel("Jeton d'API")).toHaveAccessibleDescription(MISSING_SCOPE);
        },
    },
];

test.describe('les écrans de Jira relié', () => {
    // « Copier write:jira-work » écrit dans le presse-papier (premier-aide).
    test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

    SCREENS.forEach((screen, s) => {
        test.describe(screen.name, () => {
            test.use({ jira: screen.jira, expectedErrors: screen.expectedErrors ?? [] });

            VIEWPORTS.forEach((viewport, v) => {
                THEMES.forEach(({ scheme, name }, t) => {
                    const shown = SCREENS.filter((other) => other.day === true).indexOf(screen);
                    const date = shown === -1 ? day(s * 6 + v * 2 + t) : workingDayOf(shown, v * 2 + t);

                    test(`${screen.name}, ${String(viewport.width)} × ${String(viewport.height)}, ${name}`, async ({
                        page,
                        request,
                    }, testInfo) => {
                        await page.setViewportSize(viewport);
                        await page.emulateMedia({ colorScheme: scheme });
                        if (screen.day === true) {
                            await writeDay(request, date, ENTRIES);
                            await openSampleDay(page, date);
                        }

                        await screen.reach(page, date);
                        if (screen.name.startsWith('reglages')) {
                            await pinFooter(page);
                        }
                        await expectScreen(page, testInfo, `${screen.name}-${String(viewport.width)}-${name}.png`);

                        if (viewport.width === 1440) {
                            // L'infobulle ouverte — « Copié » — se pose à la racine de la page,
                            // hors des repères, comme toute infobulle.
                            await expectAccessible(page, { exclude: [OPEN_TOOLTIP] });
                        }
                    });
                });
            });
        });
    });
});
