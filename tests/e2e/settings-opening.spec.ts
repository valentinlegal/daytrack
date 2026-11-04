import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';

/**
 * La page Réglages à son ouverture : elle paraît d'un coup, remplie, et rien n'y bouge
 * ensuite, même quand les réglages ou Jira tardent à répondre.
 *
 * Avec une barre de défilement ordinaire, comme sous Windows ou sur un Mac avec une
 * souris : Chromium la masque d'office dans les parcours, et une barre qui paraîtrait
 * après la colonne la décalerait.
 */
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

/** Un jour de parcours que les autres ne prennent pas : le 4 novembre 2024. */
const DAY = '2024-11-04';

function connectedLine(page: Page) {
    return page.getByRole('status').filter({ hasText: 'Connecté à Jira en tant que' });
}

/**
 * Retient une réponse, le temps que la page ait déjà dessiné sans elle : la lecture des
 * réglages (GET), la vérification du jeton (POST).
 */
async function slowDown(page: Page, url: string, delay: number): Promise<void> {
    await page.route(url, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        await route.fallback();
    });
}

/**
 * Note chaque image où la colonne des réglages change : la place de son titre et de ceux
 * de ses sections, et la largeur que la barre de défilement laisse à la page.
 */
async function recordLayout(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const frames: string[] = [];
        Object.assign(window, { settingsLayout: frames });
        const step = () => {
            const titles = [...document.querySelectorAll('.settings-column :is(h1, h2)')].map((title) => {
                const box = title.getBoundingClientRect();

                return `${title.textContent} ${String(box.x)},${String(box.y)}`;
            });
            const frame =
                titles.length === 0 ? '' : `${String(document.documentElement.clientWidth)} ${titles.join(' | ')}`;
            if (frame !== frames.at(-1)) {
                frames.push(frame);
            }
            requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    });
}

/**
 * Ce que la colonne a montré, image après image, depuis qu'elle a paru, une fois tout
 * arrivé : la réponse de Jira, l'objectif et les types.
 */
async function recordedLayout(page: Page, jiraAnswered: Promise<unknown>): Promise<string[]> {
    await jiraAnswered;
    await expect(page.getByRole('textbox', { name: 'Objectif habituel' })).toHaveValue('7h30');
    await expect(page.getByRole('button', { name: 'Teinte de Story, vert' })).toBeVisible();
    // Une image encore, pour qu'un dernier changement y soit noté.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const frames = await page.evaluate(() => (window as unknown as { settingsLayout: string[] }).settingsLayout);

    return frames.filter((frame) => frame !== '');
}

test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // Les réglages et Jira tardent : la page a déjà dessiné quand ils répondent.
    await slowDown(page, '**/api/settings', 300);
    await slowDown(page, '**/api/jira/check', 800);
    await recordLayout(page);
});

test('rechargée, elle paraît d’un coup, et rien ne bouge quand Jira répond', async ({ page }) => {
    const jiraAnswered = page.waitForResponse('**/api/jira/check');
    await page.goto('/reglages');

    const frames = await recordedLayout(page, jiraAnswered);
    await expect(connectedLine(page)).toBeVisible();
    expect(frames, 'La colonne ne bouge plus une fois parue.').toHaveLength(1);
    expect(frames[0]).toContain('Apparence');
    // La barre de défilement est bien là, parue avec la colonne.
    expect(await page.evaluate(() => innerWidth - document.documentElement.clientWidth)).toBeGreaterThan(0);
});

test('ouverte depuis la journée, elle paraît d’un coup, et rien ne bouge quand Jira répond', async ({ page }) => {
    await page.goto(`/${DAY}`);
    await expect(page.getByRole('region', { name: 'Grille de la journée' })).toBeVisible();

    const jiraAnswered = page.waitForResponse('**/api/jira/check');
    await page.getByRole('button', { name: 'Réglages' }).click();

    const frames = await recordedLayout(page, jiraAnswered);
    await expect(connectedLine(page)).toBeVisible();
    expect(frames, 'La colonne ne bouge plus une fois parue.').toHaveLength(1);
    expect(frames[0]).toContain('Apparence');
});

test('rien ne bouge non plus quand Jira ne répond pas', async ({ page }) => {
    await page.route('**/api/jira/check', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 800));
        await route.fulfill({ json: { status: 'unreachable', account: null, missingScopes: [] } });
    });
    const jiraAnswered = page.waitForResponse('**/api/jira/check');
    await page.goto('/reglages');

    const frames = await recordedLayout(page, jiraAnswered);
    expect(frames, 'La colonne ne bouge plus une fois parue.').toHaveLength(1);
    await expect(connectedLine(page)).toHaveCount(0);
});

test.describe('quand une lecture échoue', () => {
    test.use({ expectedErrors: [/the server responded with a status of 500/] });

    test('les réglages illisibles, la page paraît quand même, et le dit dans ses cartes', async ({ page }) => {
        await page.route('**/api/settings', (route) => route.fulfill({ status: 500, body: 'Erreur' }));
        await page.goto('/reglages');

        await expect(page.getByRole('heading', { name: 'Réglages', level: 1 })).toBeVisible();
        await expect(page.getByText('Les réglages ne se lisent pas. Rechargez la page.')).toHaveCount(2);
        await expect(page.getByLabel('Adresse de Jira')).toHaveValue('https://jira');
        await expect(connectedLine(page)).toBeVisible();
    });

    test('la connexion illisible, la page paraît quand même, et le dit dans la carte de Jira', async ({ page }) => {
        await page.route('**/api/jira', (route) =>
            route.request().method() === 'GET' ? route.fulfill({ status: 500, body: 'Erreur' }) : route.fallback(),
        );
        await page.goto('/reglages');

        await expect(page.getByRole('heading', { name: 'Réglages', level: 1 })).toBeVisible();
        await expect(page.getByRole('form', { name: 'Connexion à Jira' }).getByRole('alert')).toHaveText(
            "L'enregistrement n'a pas abouti. Réessayez.",
        );
        await expect(page.getByLabel('Adresse de Jira')).toHaveValue('');
        await expect(page.getByRole('textbox', { name: 'Objectif habituel' })).toHaveValue('7h30');
    });
});
