import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';

import { clearDay, startTimeAt, weekday, writeDay } from './day';
import { expect, expectScreen, serveFavorites, test, THEMES, VIEWPORTS } from './fixtures';
import { SCENARIOS } from './scenarios';

/**
 * Le scénario `identifiant-long` : la journée « en-cours », où ESSAI-12345678 prend la
 * place de SHOP-501 et MIGRATIONDESDONNEESDELANCIENCRM-12345 celle d'OPS-12. La colonne des
 * blocs se règle sur le plus long du jour, jusqu'à deux fois --w-id ; au-delà, la clé se
 * coupe et le numéro reste entier, partout.
 *
 * Le simulateur de Jira ne connaît pas une clé aussi longue : c'est la journée lue qui les
 * échange, sans que rien de tel ne s'écrive.
 */

const LONG = 'MIGRATIONDESDONNEESDELANCIENCRM-12345';
const MEDIUM = 'ESSAI-12345678';
const RENAMED: Readonly<Record<string, string>> = { 'SHOP-501': MEDIUM, 'OPS-12': LONG };

const ENTRIES = SCENARIOS.find((scenario) => scenario.name === 'en-cours')?.entries ?? [];

function day(index: number): string {
    return weekday('2022-03-07', index);
}

async function openLongIds(page: Page, date: string): Promise<void> {
    await serveFavorites(page, [
        { ticket: 'SHOP-482', name: null },
        { ticket: LONG, name: null },
    ]);
    await page.route(`**/api/days/${date}`, async (route) => {
        const response = await route.fetch();
        const json = (await response.json()) as { blocks: { ticket?: string | null }[] };
        for (const block of json.blocks) {
            block.ticket = RENAMED[block.ticket ?? ''] ?? block.ticket ?? null;
        }
        await route.fulfill({ response, json });
    });
    await startTimeAt(page, date, '15:20');
    await page.addInitScript(() => {
        localStorage.setItem('daytrack.recap-open', 'true');
    });
    await page.goto(`/${date}`);
    await expect(page.getByRole('group', { name: 'Chiffres du jour' })).toBeVisible();
}

function block(page: Page, ticket: string): Locator {
    return page
        .getByRole('list', { name: 'Saisies du jour' })
        .getByRole('listitem')
        .filter({ hasText: ticket })
        .first();
}

function idColumn(page: Page, ticket: string): Locator {
    return block(page, ticket).locator('.id-column').first();
}

/** La colonne de l'identifiant tient dans la hauteur du bloc d'une ligne. */
async function expectIdInside(page: Page, ticket: string): Promise<void> {
    const line = block(page, ticket);
    const column = await line.locator('.id-column').boundingBox();
    const shown = await line.boundingBox();
    expect(column?.y).toBeGreaterThanOrEqual(shown?.y ?? 0);
    expect((column?.y ?? 0) + (column?.height ?? 0)).toBeLessThanOrEqual((shown?.y ?? 0) + (shown?.height ?? 0));
}

test.describe('un identifiant long', () => {
    test('reste visible dans un bloc d’une ligne', async ({ page, request }) => {
        const date = day(26);
        await writeDay(request, date, ENTRIES);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`/${date}`);
        await expect(page.getByRole('group', { name: 'Chiffres du jour' })).toBeVisible();

        await expectIdInside(page, 'OPS-12');
        await clearDay(request, date);

        const longDate = day(27);
        await writeDay(request, longDate, ENTRIES);
        await openLongIds(page, longDate);
        await expectIdInside(page, LONG);
        await clearDay(request, longDate);
    });

    test('élargit la colonne de tous les blocs, jusqu’à deux fois --w-id', async ({ page, request }) => {
        const date = day(0);
        await writeDay(request, date, ENTRIES);
        await page.setViewportSize({ width: 1440, height: 900 });
        await openLongIds(page, date);

        const widths = await page
            .locator('.id-column')
            .evaluateAll((columns) => columns.map((column) => column.getBoundingClientRect().width));
        expect(new Set(widths).size).toBe(1);
        expect(widths[0]).toBe(160);
        await clearDay(request, date);
    });

    test('garde la colonne à --w-id quand aucun ne le demande', async ({ page, request }) => {
        const date = day(1);
        await writeDay(request, date, ENTRIES);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`/${date}`);
        await expect(page.getByRole('group', { name: 'Chiffres du jour' })).toBeVisible();

        expect((await idColumn(page, 'SHOP-482').boundingBox())?.width).toBe(80);
        await clearDay(request, date);
    });

    test('coupe la clé et garde le numéro entier, sans mordre sur le titre', async ({ page, request }) => {
        const date = day(2);
        await writeDay(request, date, ENTRIES);
        await page.setViewportSize({ width: 1440, height: 900 });
        await openLongIds(page, date);

        const number = block(page, LONG).getByText('-12345', { exact: true });
        await expect(number).toBeVisible();
        const key = block(page, LONG).getByText('MIGRATIONDESDONNEESDELANCIENCRM', { exact: true });
        expect(await key.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
        const column = await idColumn(page, LONG).boundingBox();
        const shown = await number.boundingBox();
        expect((shown?.x ?? 0) + (shown?.width ?? 0)).toBeLessThanOrEqual((column?.x ?? 0) + (column?.width ?? 0));
        // Entier pour le lecteur d'écran.
        await expect(block(page, LONG)).toContainText(LONG);
        await clearDay(request, date);
    });

    test('dans le récapitulatif, garde la durée dans le panneau et donne l’infobulle de l’identifiant', async ({
        page,
        request,
    }) => {
        const date = day(3);
        await writeDay(request, date, ENTRIES);
        await page.setViewportSize({ width: 1440, height: 900 });
        await openLongIds(page, date);

        const recap = page.getByRole('complementary', { name: 'Récapitulatif' });
        const panel = await recap.boundingBox();
        const card = recap.getByRole('listitem').filter({ hasText: LONG });
        const duration = card.locator('.tabular-nums').first();
        const right = await duration.boundingBox();
        expect((right?.x ?? 0) + (right?.width ?? 0)).toBeLessThanOrEqual((panel?.x ?? 0) + (panel?.width ?? 0));

        await card.getByText('-12345', { exact: true }).hover();
        await expect(page.getByRole('tooltip')).toHaveText(LONG);

        // Une pastille entière n'a pas d'infobulle.
        await page.mouse.move(0, 0);
        await page.mouse.move(2, 2);
        await expect(page.getByRole('tooltip')).toHaveCount(0);
        await recap.getByRole('listitem').filter({ hasText: MEDIUM }).getByText(MEDIUM, { exact: true }).hover();
        await page.waitForTimeout(600);
        await expect(page.getByRole('tooltip')).toHaveCount(0);
        await clearDay(request, date);
    });
});

test.describe('l’écran identifiant-long', () => {
    VIEWPORTS.forEach((viewport, v) => {
        THEMES.forEach(({ scheme, name }, t) => {
            test(`${String(viewport.width)} × ${String(viewport.height)}, ${name}`, async ({
                page,
                request,
            }, testInfo) => {
                const date = day(6 + v * 2 + t);
                await writeDay(request, date, ENTRIES);
                await page.setViewportSize(viewport);
                await page.emulateMedia({ colorScheme: scheme });
                await openLongIds(page, date);

                await expectScreen(page, testInfo, `identifiant-long-${String(viewport.width)}-${name}.png`);

                if (viewport.width === 1440) {
                    const results = await new AxeBuilder({ page })
                        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
                        .analyze();
                    expect(results.violations).toEqual([]);
                }
                await clearDay(request, date);
            });
        });
    });
});
