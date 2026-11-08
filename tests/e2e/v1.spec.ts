import type { Page } from '@playwright/test';

import { expect, expectAccessible, expectScreen, test, THEMES, VIEWPORTS } from './fixtures';

/**
 * Le passage de la v1 à la v2, vu de l'écran : le bandeau de l'ancien docker-compose.yml,
 * et celui de ce que la reprise a laissé de côté. Les deux états viennent du démarrage de
 * l'image : ils sont servis à la page, sans rien écrire.
 */
const DAY = '2024-06-17';

const LEFT_OUT = {
    entries: [
        { date: '2024-03-04', start: '06:30', end: '07:00', ticket: 'SHOP-482' },
        { date: '2024-03-05', start: '09:10', end: null, ticket: null },
    ],
    objectives: [{ date: '2024-03-06', from: 1440, to: 780 }],
    favorites: ['PROJET'],
};
const NOTHING = { entries: [], objectives: [], favorites: [] };

const DOWNLOAD = 'curl -fO https://raw.githubusercontent.com/valentinlegal/daytrack/main/docker-compose.yml';
const COMMANDS = `${DOWNLOAD} &&\ndocker compose up -d`;
const CUSTOM_COMMANDS = `cp docker-compose.yml docker-compose.v1.yml &&\n${DOWNLOAD}`;
const PROXY_LINES = '      SERVER_NAME: ":80"\n      TRUSTED_PROXIES: "private_ranges"';

interface Served {
    readonly oldCompose?: 'default' | 'custom' | 'proxy';
    readonly leftOut?: typeof LEFT_OUT;
    readonly jira?: string;
}

async function open(page: Page, { oldCompose, leftOut, jira }: Served): Promise<void> {
    await page.route(
        (url) => /^\/\d{4}-\d{2}-\d{2}$/.test(url.pathname),
        async (route) => {
            const response = await route.fetch();
            const attribute = JSON.stringify(leftOut ?? NOTHING).replaceAll('"', '&quot;');
            const body = (await response.text())
                .replace(/data-jira="[^"]*"/, `data-jira="${jira ?? 'connected'}"`)
                .replace(/data-jira-scopes="[^"]*"/, 'data-jira-scopes=""')
                .replace(/data-old-compose="[^"]*"/, `data-old-compose="${oldCompose ?? ''}"`)
                .replace(/data-v1-left-out="[^"]*"/, `data-v1-left-out="${attribute}"`);
            await route.fulfill({ response, body });
        },
    );
    await page.goto(`/${DAY}`);
}

test('sans ancien fichier ni reste de la reprise, aucun bandeau', async ({ page }) => {
    await open(page, {});

    await expect(page.getByText('Lundi 17 juin 2024')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
});

test("l'ancien fichier se signale, sans rien bloquer, et donne ses commandes", async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page, { oldCompose: 'default' });

    const banner = page.getByRole('alert');
    await expect(banner).toContainText('Votre fichier docker-compose.yml date de la v1.');
    await expect(banner).toContainText('Il ouvre DayTrack au réseau, et votre jeton Jira peut y être en clair.');

    // La journée reste utilisable en dessous.
    await expect(page.getByText('Lundi 17 juin 2024')).toBeVisible();

    const button = banner.getByRole('button', { name: 'Voir comment le remplacer' });
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await button.click();

    const window = page.getByRole('dialog', { name: 'Remplacer docker-compose.yml' });
    await expect(window.locator('pre')).toHaveText(COMMANDS);
    await expect(window).toContainText('Rechargez ensuite cette page.');
    await expect(window).toContainText('Vos journées, vos favoris et votre connexion à Jira sont déjà dans DayTrack');
    await expect(window).not.toContainText('Votre fichier avait été modifié');

    await window.getByRole('button', { name: 'Copier les commandes' }).click();
    await expect(window.getByRole('button', { name: 'Commandes copiées' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(COMMANDS);
});

test('la fenêtre du bandeau passe au-dessus du bouton Jira, qui ne reçoit pas ses clics', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 720 });
    await open(page, { oldCompose: 'custom' });
    await expect(page.getByRole('button', { name: 'Envoyer sur Jira' })).toBeVisible();

    await page.getByRole('button', { name: 'Voir comment le remplacer' }).click();
    const window = page.getByRole('dialog');
    await expect(window).toBeVisible();

    // Au centre du bouton Jira, recouvert : c'est la fenêtre qui est au premier plan.
    const button = await page.getByRole('button', { name: 'Envoyer sur Jira' }).boundingBox();
    const box = await window.boundingBox();
    expect(button).not.toBeNull();
    expect(box).not.toBeNull();
    const x = (button?.x ?? 0) + (button?.width ?? 0) / 2;
    const y = (button?.y ?? 0) + (button?.height ?? 0) / 2;
    expect(x > (box?.x ?? 0) && y > (box?.y ?? 0) && y < (box?.y ?? 0) + (box?.height ?? 0)).toBe(true);
    const onTop = await page.evaluate(
        ([px, py]) => document.elementFromPoint(px ?? 0, py ?? 0)?.closest('[role="dialog"]') !== null,
        [x, y],
    );
    expect(onTop).toBe(true);
});

test('la fenêtre du bandeau passe au-dessus du récapitulatif posé sur la grille', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 720 });
    await open(page, { oldCompose: 'custom' });
    await page.getByRole('button', { name: 'Afficher le récapitulatif' }).click();
    await expect(page.getByRole('button', { name: 'Masquer le récapitulatif' })).toBeVisible();

    await page.getByRole('button', { name: 'Voir comment le remplacer' }).click();
    const window = page.getByRole('button', { name: 'Copier les commandes' });
    await expect(window).toBeVisible();

    // Toute la fenêtre est au premier plan, même là où le récapitulatif passe dessous.
    const covered = await page.evaluate(() => {
        const dialog = [...document.querySelectorAll('[role="dialog"]')].find((element) =>
            element.textContent.includes('Copier les commandes'),
        );
        const box = dialog?.getBoundingClientRect();
        if (dialog === undefined || box === undefined) {
            return -1;
        }
        let points = 0;
        for (let x = box.left + 2; x < box.right; x += 12) {
            for (let y = box.top + 2; y < box.bottom; y += 12) {
                if (document.elementFromPoint(x, y)?.closest('[role="dialog"]') !== dialog) {
                    points += 1;
                }
            }
        }

        return points;
    });
    expect(covered).toBe(0);
});

test('Échap ferme la fenêtre et rend le curseur au bouton, et le bandeau reste', async ({ page }) => {
    await open(page, { oldCompose: 'default' });

    const button = page.getByRole('button', { name: 'Voir comment le remplacer' });
    await button.click();
    const window = page.getByRole('dialog');
    await expect(window.getByRole('button', { name: 'Plus tard' })).toBeFocused();

    await page.keyboard.press('Escape');

    await expect(window).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(page.getByRole('alert')).toBeVisible();
});

test('un fichier modifié garde une copie et ne relance pas DayTrack, le temps de reporter ports et volumes', async ({
    page,
    context,
}) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page, { oldCompose: 'custom' });

    await page.getByRole('button', { name: 'Voir comment le remplacer' }).click();

    const window = page.getByRole('dialog', { name: 'Remplacer docker-compose.yml' });
    await expect(window.locator('pre')).toHaveText(CUSTOM_COMMANDS);
    await expect(window).toContainText('Votre fichier avait été modifié.');
    await expect(window).toContainText(
        'les noms de volumes que vous aviez changés : sans eux, DayTrack repartirait vide.',
    );
    await expect(window).toContainText('en gardant 127.0.0.1 devant : sans lui, DayTrack');
    await expect(window).toContainText('suivie de votre port HTTPS');
    await expect(window.locator('code')).toHaveText('docker compose up -d');
    await expect(window).toContainText('Supprimez alors la copie, où votre jeton Jira peut être en clair.');
    await expect(window).not.toContainText('Rechargez ensuite cette page.');

    await window.getByRole('button', { name: 'Copier les commandes' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CUSTOM_COMMANDS);
});

test('derrière un proxy, le fichier se garde et ses lignes se copient', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page, { oldCompose: 'proxy' });

    const banner = page.getByRole('alert');
    await expect(banner).toContainText('Votre fichier docker-compose.yml date de la v1.');
    // Un port lié à 127.0.0.1, ou un proxy joint par un réseau Docker, n'ouvrent pas DayTrack.
    await expect(banner).toContainText('Il peut contenir votre jeton Jira en clair, et ouvrir DayTrack au réseau.');
    await expect(banner.getByRole('button', { name: 'Voir comment le remplacer' })).toHaveCount(0);

    const button = banner.getByRole('button', { name: "Voir comment l'adapter" });
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');

    const window = page.getByRole('dialog', { name: 'Adapter docker-compose.yml' });
    await expect(window).toContainText('Votre fichier sert DayTrack derrière un proxy : gardez-le.');
    // Collées par-dessus le seul texte de la ligne, la première doublerait son indentation.
    await expect(window).toContainText(
        'remplacez toute la ligne SERVER_NAME, espaces du début compris, par ces deux lignes.',
    );
    await expect(window.locator('pre')).toHaveText(PROXY_LINES);
    // Rien ne remplace le fichier, et rien ne le relance avant qu'il soit changé.
    await expect(window.locator('pre')).not.toContainText('curl');
    await expect(window).toContainText('votre connexion à Jira est déjà dans DayTrack');
    await expect(window).toContainText('mettez 127.0.0.1 devant');
    await expect(window).toContainText("quiconque l'atteint agit en votre nom, jusque dans Jira.");
    await expect(window).toContainText("puis rechargez cette page. L'adresse ne change pas.");
    await expect(window.locator('code')).toHaveText(['environment:', 'SERVER_NAME', 'JIRA_…', 'docker compose up -d']);
    await expect(window).not.toContainText('Votre fichier avait été modifié');

    await expect(window.getByRole('button', { name: 'Copier les commandes' })).toHaveCount(0);
    await window.getByRole('button', { name: 'Copier les lignes' }).click();
    await expect(window.getByRole('button', { name: 'Lignes copiées' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(PROXY_LINES);

    // Fermée puis rouverte, la fenêtre a oublié la copie.
    await window.getByRole('button', { name: 'Plus tard' }).click();
    await expect(window).toHaveCount(0);
    await expect(button).toBeFocused();
    await button.click();
    await expect(window.getByRole('button', { name: 'Copier les lignes' })).toBeVisible();
});

test('recopier pendant « Lignes copiées » relance ses deux secondes', async ({ page }) => {
    // Un presse-papier qui répond tout de suite, et compte : le temps ne s'avance qu'une
    // fois la copie faite, sinon le test jouerait la course qu'il vérifie.
    await page.addInitScript(() => {
        const copies: string[] = [];
        Object.defineProperty(window, 'copies', { value: copies });
        Object.defineProperty(navigator, 'clipboard', {
            value: {
                writeText: (text: string) => {
                    copies.push(text);

                    return Promise.resolve();
                },
            },
        });
    });
    const copies = () => page.evaluate(() => (window as unknown as { copies: string[] }).copies.length);
    await page.clock.install();
    await open(page, { oldCompose: 'proxy' });
    await page.getByRole('button', { name: "Voir comment l'adapter" }).click();

    const window = page.getByRole('dialog', { name: 'Adapter docker-compose.yml' });
    await window.getByRole('button', { name: 'Copier les lignes' }).click();
    await expect(window.getByRole('button', { name: 'Lignes copiées' })).toBeVisible();

    await page.clock.runFor(1500);
    await window.getByRole('button', { name: 'Lignes copiées' }).click();
    await expect.poll(copies).toBe(2);
    await page.clock.runFor(1000);
    await expect(window.getByRole('button', { name: 'Lignes copiées' })).toBeVisible();

    await page.clock.runFor(1100);
    await expect(window.getByRole('button', { name: 'Copier les lignes' })).toBeVisible();
});

test('derrière un proxy, une copie refusée le dit sous les lignes, qui restent à sélectionner', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText: () => Promise.reject(new Error('refusé')) },
        });
    });
    await open(page, { oldCompose: 'proxy' });
    await page.getByRole('button', { name: "Voir comment l'adapter" }).click();

    const window = page.getByRole('dialog', { name: 'Adapter docker-compose.yml' });
    await window.getByRole('button', { name: 'Copier les lignes' }).click();
    await expect(window).toContainText('Copie impossible : sélectionnez les lignes à la main.');
    await expect(window.locator('pre')).toHaveText(PROXY_LINES);
});

test.describe('avec un jeton refusé', () => {
    test.use({ jira: { state: 'refused' } });

    test('un seul bandeau : le jeton passe avant le reste', async ({ page }) => {
        await open(page, { oldCompose: 'default', leftOut: LEFT_OUT, jira: 'refused' });

        await expect(page.getByRole('alert')).toHaveCount(1);
        await expect(page.getByRole('button', { name: 'Mettre à jour le jeton' })).toBeVisible();
    });
});

test('un seul bandeau : la liste passe avant l’ancien fichier, qui prend sa place une fois lue', async ({ page }) => {
    await page.route('**/api/v1-import/seen', (route) => route.fulfill({ status: 204 }));
    await open(page, { oldCompose: 'default', leftOut: LEFT_OUT });

    await expect(page.getByRole('alert')).toHaveCount(1);
    await page.getByRole('button', { name: 'Voir la liste' }).click();
    await page.getByRole('dialog').getByRole('button', { name: "Ne plus l'afficher" }).click();

    await expect(page.getByRole('alert')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Voir comment le remplacer' })).toBeVisible();
    await expect(page.getByRole('listbox', { name: 'Créneaux de la journée' })).toBeFocused();
});

test('ce qui n’a pas été repris se liste, puis ne s’affiche plus', async ({ page }) => {
    let seen = 0;
    await page.route('**/api/v1-import/seen', (route) => {
        seen += 1;

        return route.fulfill({ status: 204 });
    });
    await open(page, { leftOut: LEFT_OUT });

    const banner = page.getByRole('alert');
    await expect(banner).toContainText("Une partie de vos données de la v1 n'a pas été reprise telle quelle.");
    await expect(banner).toContainText("L'ancienne base reste intacte.");
    await banner.getByRole('button', { name: 'Voir la liste' }).click();

    const window = page.getByRole('dialog', { name: "Ce qui n'a pas été repris tel quel" });
    await expect(window.getByRole('listitem')).toHaveText([
        'Lundi 4 mars 2024 de 06:30 à 07:00, SHOP-482',
        'Mardi 5 mars 2024 à 09:10, sans heure de fin',
        'Mercredi 6 mars 2024, objectif de\u00a024h00 ramené à\u00a013h00',
        "Le favori PROJET, qui n'est pas un identifiant de ticket",
    ]);
    await expect(window).toContainText('En v2, une saisie commence et finit au quart d');
    await expect(window).toContainText('Ces saisies restent dans la base de la v1.');

    // Fermer ne vaut pas lecture : le bandeau reste, et la liste aussi.
    await window.getByRole('button', { name: 'Plus tard' }).click();
    await expect(banner).toBeVisible();
    expect(seen).toBe(0);

    await banner.getByRole('button', { name: 'Voir la liste' }).click();
    await window.getByRole('button', { name: "Ne plus l'afficher" }).click();

    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(seen).toBe(1);
    await expect(page.getByRole('listbox', { name: 'Créneaux de la journée' })).toBeFocused();

    // Un aller-retour par les réglages, sans recharger : elle ne revient pas.
    await page.getByRole('button', { name: 'Réglages' }).click();
    await expect(page.getByRole('heading', { name: 'Réglages' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('listbox', { name: 'Créneaux de la journée' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
});

test.describe('quand le serveur ne répond pas', () => {
    test.use({ expectedErrors: [/500/] });

    test('la liste reste, avec ce qui ne va pas', async ({ page }) => {
        await page.route('**/api/v1-import/seen', (route) => route.fulfill({ status: 500 }));
        await open(page, { leftOut: LEFT_OUT });

        await page.getByRole('button', { name: 'Voir la liste' }).click();
        const window = page.getByRole('dialog');
        await window.getByRole('button', { name: "Ne plus l'afficher" }).click();

        await expect(window).toContainText('Le serveur ne répond pas.');
        // Dit au lecteur d'écran : la région était là avant le message.
        await expect(window.locator('[aria-live="polite"]')).toHaveText(
            'Le serveur ne répond pas. Réessayez dans un instant.',
        );
        await expect(window.getByRole('listitem')).toHaveCount(4);
        await expect(page.getByRole('alert')).toBeVisible();
    });
});

for (const { width, height } of VIEWPORTS) {
    for (const theme of THEMES) {
        test.describe(`à ${String(width)} px, thème ${theme.name}`, () => {
            test.use({ viewport: { width, height }, colorScheme: theme.scheme });

            for (const { kind, name, action } of [
                { kind: 'default', name: 'v1-fichier', action: 'Voir comment le remplacer' },
                { kind: 'custom', name: 'v1-modifie', action: 'Voir comment le remplacer' },
                { kind: 'proxy', name: 'v1-proxy', action: "Voir comment l'adapter" },
            ] as const) {
                test(`l’ancien fichier, ${name}`, async ({ page }, testInfo) => {
                    await open(page, { oldCompose: kind });
                    await page.getByRole('button', { name: action }).click();
                    await expect(page.getByRole('dialog')).toBeVisible();

                    await expectAccessible(page);
                    await expectScreen(page, testInfo, `${name}-${String(width)}-${theme.name}.png`);
                });
            }

            test('ce qui n’a pas été repris', async ({ page }, testInfo) => {
                await open(page, { leftOut: LEFT_OUT });
                await page.getByRole('button', { name: 'Voir la liste' }).click();
                await expect(page.getByRole('dialog')).toBeVisible();

                await expectAccessible(page);
                await expectScreen(page, testInfo, `v1-liste-${String(width)}-${theme.name}.png`);
            });

            test.describe('quand le serveur ne répond pas', () => {
                test.use({ expectedErrors: [/500/] });

                test('la liste le dit', async ({ page }, testInfo) => {
                    await page.route('**/api/v1-import/seen', (route) => route.fulfill({ status: 500 }));
                    await open(page, { leftOut: LEFT_OUT });
                    await page.getByRole('button', { name: 'Voir la liste' }).click();
                    await page.getByRole('dialog').getByRole('button', { name: "Ne plus l'afficher" }).click();
                    await expect(page.getByRole('dialog')).toContainText('Le serveur ne répond pas.');

                    await expectScreen(page, testInfo, `v1-liste-erreur-${String(width)}-${theme.name}.png`);
                });
            });

            if (width === 1024) {
                test('la liste, au-dessus du récapitulatif posé sur la grille', async ({ page }, testInfo) => {
                    await open(page, { oldCompose: 'custom', leftOut: LEFT_OUT });
                    await page.getByRole('button', { name: 'Afficher le récapitulatif' }).click();
                    await page.getByRole('button', { name: 'Voir la liste' }).click();
                    await expect(
                        page.getByRole('dialog', { name: "Ce qui n'a pas été repris tel quel" }),
                    ).toBeVisible();

                    await expectScreen(page, testInfo, `v1-1024-${theme.name}.png`);
                });
            }
        });
    }
}
