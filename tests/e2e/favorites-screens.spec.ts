import type { Page } from '@playwright/test';

import { freezeTime, weekdaysFrom, writeDay } from './day';
import { clickSlot, slotPoint } from './editing';
import {
    expect,
    expectAccessible,
    expectScreen,
    SAMPLE_FAVORITES,
    serveFavorites,
    type ShownFavorite,
    shownFavorites,
    test,
    THEMES,
    VIEWPORTS,
} from './fixtures';
import { SCENARIOS } from './scenarios';

/**
 * Les écrans des favoris : `favori`, le formulaire d'ajout en tête de
 * liste ; `glisser`, un favori en cours de glisser au-dessus de 15:30 ; `favoris-vides`,
 * la liste vide qui explique les gestes ; `favori-menu`, le menu de SHOP-482 ouvert au
 * clavier ; `favori-nom`, SHOP-482 qu'on renomme ; `favori-retire`, le message de
 * SHOP-482 retiré ; `selection-ticket`, le menu de la grille sur SHOP-482, « Ajouter aux
 * favoris » actif ; `bloc-favori`, un bloc de SHOP-482 soulevé vers la liste ;
 * `bloc-favori-deja`, le même quand SHOP-482 est déjà en favori ; `favori-ajoute`, son
 * message ; `colonne`, la colonne élargie au plus. Sur la journée d'exemple « en cours »,
 * à 15:20, aux trois largeurs et dans les deux thèmes. Les favoris sont servis
 * à la page, sans toucher la base.
 */
const BASE = SCENARIOS[0]?.entries ?? [];

/**
 * Le jour d'un parcours : le `index`-ième jour de semaine à partir du 1er octobre 2024 —
 * un samedi serait fermé à la saisie. Six jours par écran, que les autres parcours ne
 * prennent pas : ils tournent en même temps, sur la même base (settings.spec.ts finit en
 * septembre, calendar.spec.ts commence en janvier 2025).
 */
const workday = weekdaysFrom('2024-10-01');

function favoriteCard(page: Page, ticket: string) {
    return page.locator('[data-favorite]').filter({ hasText: ticket });
}

/** Les favoris d'exemple sans SHOP-482, que la grille porte : il n'est pas encore en favori. */
const WITHOUT_SHOP_482 = SAMPLE_FAVORITES.filter((favorite) => favorite.ticket !== 'SHOP-482');

const SCREENS: {
    name: string;
    favorites: 'sample' | 'none';
    /** D'autres favoris que ceux d'exemple, servis à la page. */
    served?: readonly ShownFavorite[];
    /** Ce qui amène l'écran, une fois la journée affichée. */
    reach: (page: Page) => Promise<void>;
}[] = [
    {
        name: 'favori',
        favorites: 'sample',
        reach: async (page) => {
            await page
                .getByRole('complementary', { name: 'Favoris et calendrier' })
                .getByRole('button', { name: 'Ajouter un favori' })
                .click();
            await page.getByRole('textbox', { name: 'Nouveau favori' }).fill('SHOP-498');
        },
    },
    {
        name: 'glisser',
        favorites: 'sample',
        reach: async (page) => {
            const from = page.locator('[data-favorite]').filter({ hasText: 'SHOP-501' });
            const box = await from.boundingBox();
            if (box === null) {
                throw new Error('SHOP-501 n’est pas à l’écran.');
            }
            const to = await slotPoint(page, '15:30');
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            await page.mouse.move(to.x, to.y, { steps: 8 });
            await expect(page.getByText('15:30 à 15:45', { exact: true })).toBeVisible();
        },
    },
    {
        name: 'favoris-vides',
        favorites: 'none',
        reach: async (page) => {
            await expect(page.getByText('Aucun favori', { exact: true })).toBeVisible();
        },
    },
    {
        name: 'favori-menu',
        favorites: 'sample',
        reach: async (page) => {
            await favoriteCard(page, 'SHOP-482').focus();
            await page.keyboard.press('Shift+F10');
            await expect(page.getByRole('menuitem', { name: 'Renommer…' })).toBeFocused();
        },
    },
    {
        name: 'selection-ticket',
        favorites: 'sample',
        served: WITHOUT_SHOP_482,
        reach: async (page) => {
            await clickSlot(page, '10:00');
            await clickSlot(page, '10:30', ['Shift']);
            await page.keyboard.press('Shift+F10');
            await expect(page.getByRole('menuitem', { name: 'Nouveau ticket…' })).toBeFocused();
            const add = page.getByRole('menuitem', { name: 'Ajouter aux favoris' });
            await expect(add).not.toHaveAttribute('aria-disabled', 'true');
            // Au clavier, du premier choix jusqu'à lui, par « Modifier la sélection… », actif sur
            // un seul ticket ; Coller, grisé, est sauté. Radix déplace le curseur au tour
            // suivant : l'horloge figée doit avancer.
            await expect(page.getByRole('menuitem', { name: 'Modifier la sélection…' })).not.toHaveAttribute(
                'aria-disabled',
                'true',
            );
            for (let step = 0; step < 5; step += 1) {
                await page.keyboard.press('ArrowDown');
                await page.clock.runFor(1);
            }
            await expect(add).toBeFocused();
        },
    },
    {
        name: 'bloc-favori',
        favorites: 'sample',
        served: WITHOUT_SHOP_482,
        reach: async (page) => {
            const from = await slotPoint(page, '10:00');
            const card = await favoriteCard(page, 'SHOP-501').boundingBox();
            if (card === null) {
                throw new Error('SHOP-501 n’est pas à l’écran.');
            }
            await page.mouse.move(from.x, from.y);
            await page.mouse.down();
            await page.mouse.move(from.x, (await slotPoint(page, '10:30')).y, { steps: 4 });
            // Sous le milieu de SHOP-501 : sa place s'ouvre entre lui et OPS-12.
            await page.mouse.move(card.x + card.width / 4, card.y + card.height, { steps: 10 });
            await expect(page.locator('.favorite-drag')).toContainText('SHOP-482');
        },
    },
    {
        name: 'bloc-favori-deja',
        favorites: 'sample',
        reach: async (page) => {
            const from = await slotPoint(page, '10:00');
            const card = await favoriteCard(page, 'OPS-12').boundingBox();
            if (card === null) {
                throw new Error('OPS-12 n’est pas à l’écran.');
            }
            await page.mouse.move(from.x, from.y);
            await page.mouse.down();
            await page.mouse.move(from.x, (await slotPoint(page, '10:30')).y, { steps: 4 });
            // Sur la liste, SHOP-482 quitte la première place et OPS-12 remonte : son bas se
            // mesure là où il est passé, quel que soit le côté d'où arrive le pointeur.
            await page.mouse.move(card.x + card.width / 4, card.y + card.height / 2, { steps: 10 });
            await expect(page.locator('.favorite-drag')).toContainText('SHOP-482');
            const moved = await favoriteCard(page, 'OPS-12').boundingBox();
            if (moved === null) {
                throw new Error('OPS-12 n’est plus à l’écran.');
            }
            // Au bas d'OPS-12 : SHOP-482, déjà en favori, passe de la première à la troisième place.
            await page.mouse.move(moved.x + moved.width / 4, moved.y + moved.height - 4, { steps: 4 });
            await expect(page.locator('[data-favorite]').nth(2)).toContainText('SHOP-482');
        },
    },
    {
        name: 'favori-ajoute',
        favorites: 'sample',
        served: WITHOUT_SHOP_482,
        reach: async (page) => {
            // Le serveur rend la liste avec SHOP-482 en tête, sans que la base soit touchée.
            await page.route('**/api/favorites', (route) =>
                route.request().method() === 'POST'
                    ? route.fulfill({ status: 201, json: { favorites: shownFavorites(SAMPLE_FAVORITES) } })
                    : route.fallback(),
            );
            await clickSlot(page, '10:00');
            await clickSlot(page, '10:30', ['Shift']);
            await page.keyboard.press('Shift+F10');
            await page.getByRole('menuitem', { name: 'Ajouter aux favoris' }).click();
            await page.mouse.move(0, 0);
            await expect(page.getByRole('status')).toContainText('SHOP-482 ajouté aux favoris');
        },
    },
    {
        name: 'favori-nom',
        favorites: 'sample',
        reach: async (page) => {
            // Au clavier : le premier clic d'un double-clic copierait, et son message
            // s'afficherait sous la grille.
            await favoriteCard(page, 'SHOP-482').focus();
            await page.keyboard.press('F2');
            await page.getByRole('textbox', { name: 'Nom' }).fill('Export CSV');
        },
    },
    {
        name: 'favori-retire',
        favorites: 'sample',
        reach: async (page) => {
            // Le serveur rend la liste sans SHOP-482, sans que la base soit touchée.
            await page.route('**/api/favorites/*', (route) =>
                route.request().method() === 'DELETE'
                    ? route.fulfill({ json: { favorites: shownFavorites(SAMPLE_FAVORITES.slice(1), 1) } })
                    : route.fallback(),
            );
            // À la souris, par le menu : au clavier, le curseur passé au favori suivant y
            // ouvrirait son infobulle, qui n'a rien à faire sur cette capture.
            await favoriteCard(page, 'SHOP-482').click({ button: 'right' });
            await page.getByRole('menuitem', { name: 'Retirer des favoris' }).click();
            await page.mouse.move(0, 0);
            await expect(page.getByRole('status').getByRole('button', { name: 'Annuler' })).toBeVisible();
        },
    },
    {
        name: 'colonne',
        favorites: 'sample',
        reach: async (page) => {
            // Sous 1280 px, la colonne reste étroite et son bord ne se règle pas.
            const edge = page.getByRole('separator', { name: 'Largeur des favoris' });
            if (await edge.isVisible()) {
                await edge.focus();
                await page.keyboard.press('End');
                await expect(edge).toHaveAttribute('aria-valuenow', '360');
            }
        },
    },
];

test.describe('les écrans des favoris', () => {
    SCREENS.forEach((screen, s) => {
        test.describe(screen.name, () => {
            test.use({ favorites: screen.favorites });

            VIEWPORTS.forEach((viewport, v) => {
                THEMES.forEach(({ scheme, name }, t) => {
                    const date = workday(s * 6 + v * 2 + t);

                    test(`${screen.name}, ${String(viewport.width)} × ${String(viewport.height)}, ${name}`, async ({
                        page,
                        request,
                    }, testInfo) => {
                        await writeDay(request, date, BASE);
                        await freezeTime(page, date, '15:20');
                        await page.setViewportSize(viewport);
                        await page.emulateMedia({ colorScheme: scheme });
                        if (screen.served !== undefined) {
                            await serveFavorites(page, screen.served);
                        }

                        await page.goto(`/${date}`);
                        await expect(page.getByRole('group', { name: 'Chiffres du jour' })).toBeVisible();
                        await expect(page.locator('[data-favorite]')).toHaveCount(
                            screen.served?.length ?? (screen.favorites === 'sample' ? SAMPLE_FAVORITES.length : 0),
                        );
                        await screen.reach(page);

                        await expectScreen(page, testInfo, `${screen.name}-${String(viewport.width)}-${name}.png`);

                        if (viewport.width === 1440) {
                            await page.clock.resume();
                            // La place en pointillé d'un bloc soulevé est un décor, à l'opacité d'un
                            // contrôle inactif, comme le favori qu'on glisse : WCAG ne lui demande
                            // pas de contraste.
                            await expectAccessible(page, { exclude: ['[data-favorite-placeholder]'] });
                        }

                        // Échap lâche le favori sans le poser.
                        await page.keyboard.press('Escape');
                        await page.mouse.up();
                    });
                });
            });
        });
    });
});
