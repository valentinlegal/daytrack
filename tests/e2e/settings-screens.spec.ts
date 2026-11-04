import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { expect, expectScreen, test, THEMES, VIEWPORTS } from './fixtures';
import { serveSampleConnection } from './jira';
import { pinFooter, SAMPLE_SETTINGS } from './settings';

/**
 * Les écrans des réglages : la page entière — `reglages` —, la grille des teintes ouverte
 * sur « Support client » — `reglages-couleur` — et la page défilée, sa barre restée en
 * haut — `reglages-defile` —, et la section Jira modifiée qu'on quitte —
 * `reglages-jira-modifiee`. Chacun a sa capture de référence aux trois largeurs et dans
 * les deux thèmes, et son contrôle d'accessibilité. Le compte et les réglages
 * d'exemple sont servis à la page.
 */
const SCREENS: { name: string; reach: (page: Page) => Promise<void> }[] = [
    { name: 'reglages', reach: () => Promise.resolve() },
    {
        name: 'reglages-couleur',
        reach: async (page) => {
            await page.getByRole('button', { name: 'Teinte de Support client, cyan' }).click();
            await expect(page.getByRole('menuitemradio', { name: 'Cyan' })).toBeFocused();
        },
    },
    {
        name: 'reglages-jira-modifiee',
        reach: async (page) => {
            await page.getByLabel("Jeton d'API").focus();
            await page.keyboard.type('nouveau-jeton');
            await page.keyboard.press('Escape');
            await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeFocused();
        },
    },
    {
        name: 'reglages-defile',
        reach: async (page) => {
            // À mi-hauteur : la colonne remonte de 400 px.
            await page.evaluate(() => {
                window.scrollTo(0, 400);
            });
            await page.mouse.move(0, 0);
        },
    },
];

test.describe('reglages-type-long', () => {
    // Un nom sur trois lignes, parmi les types d'exemple.
    test.use({
        settings: {
            ...SAMPLE_SETTINGS,
            issueTypes: [
                {
                    id: '0199a3c4-0000-7000-8000-000000000011',
                    name: 'Demande de changement soumise au comité d’architecture',
                    color: 'ambre',
                },
                ...SAMPLE_SETTINGS.issueTypes,
            ],
        },
    });

    for (const viewport of VIEWPORTS) {
        for (const { scheme, name } of THEMES) {
            test(`reglages-type-long, ${String(viewport.width)} × ${String(viewport.height)}, ${name}`, async ({
                page,
            }, testInfo) => {
                await page.setViewportSize(viewport);
                await page.emulateMedia({ colorScheme: scheme });
                await serveSampleConnection(page, { state: 'connected' });
                await page.goto('/reglages');
                await expect(page.getByText('Connecté à Jira en tant que Camille Martin.')).toBeVisible();
                await pinFooter(page);
                await page.evaluate(() => {
                    window.scrollTo(0, 400);
                });
                await page.mouse.move(0, 0);

                await expectScreen(page, testInfo, `reglages-type-long-${String(viewport.width)}-${name}.png`, false);
            });
        }
    }
});

test.describe('les écrans des réglages', () => {
    for (const screen of SCREENS) {
        test.describe(screen.name, () => {
            for (const viewport of VIEWPORTS) {
                for (const { scheme, name } of THEMES) {
                    test(`${screen.name}, ${String(viewport.width)} × ${String(viewport.height)}, ${name}`, async ({
                        page,
                    }, testInfo) => {
                        await page.setViewportSize(viewport);
                        await page.emulateMedia({ colorScheme: scheme });
                        await serveSampleConnection(page, { state: 'connected' });
                        await page.goto('/reglages');
                        await expect(page.getByText('Connecté à Jira en tant que Camille Martin.')).toBeVisible();
                        await pinFooter(page);

                        await screen.reach(page);
                        // Une page défilée — à mi-hauteur, ou jusqu'à la grille des teintes
                        // qu'on ouvre — se capture telle qu'on la voit, sa barre en haut.
                        await expectScreen(
                            page,
                            testInfo,
                            `${screen.name}-${String(viewport.width)}-${name}.png`,
                            screen.name === 'reglages',
                        );

                        if (viewport.width === 1440) {
                            const results = await new AxeBuilder({ page })
                                .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
                                .analyze();
                            expect(results.violations).toEqual([]);
                        }
                    });
                }
            }
        });
    }
});
