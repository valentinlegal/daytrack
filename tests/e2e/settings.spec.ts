import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';

import { clearDay, writeDay } from './day';
import { dragSlots, openSampleDay, slotPoint, ticketWindow } from './editing';
import { expect, test } from './fixtures';
import { SAMPLE_SETTINGS } from './settings';

/**
 * La page Réglages : l'objectif habituel, les jours travaillés, la teinte des types et le
 * thème, qui s'appliquent sans bouton ; sa barre qui reste en haut ; et les teintes
 * partout où un ticket s'affiche.
 *
 * Les réglages sont servis à la page (tests/e2e/settings.ts) : aucun parcours ne change
 * ceux de l'application de développement, où tournent les autres en même temps. Ce que
 * le serveur en fait se prouve par ses tests (tests/Api/SettingsApiTest.php).
 */

/** Le jour d'un parcours : `index` jours après le 2 septembre 2024, que les autres parcours ne prennent pas. */
function day(index: number): string {
    return new Date(Date.UTC(2024, 8, 2 + index)).toISOString().slice(0, 10);
}

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

const SUPPORT = SAMPLE_SETTINGS.issueTypes[4]?.id ?? '';

/** L'aide de l'objectif habituel, que le lecteur d'écran dit avec le champ, avant un refus. */
const HELP =
    "Temps à travailler chaque jour, hors pauses. Pour un jour précis, cliquez sur l'objectif au-dessus de la grille.";

async function openSettings(page: Page): Promise<void> {
    await page.goto('/reglages');
    await expect(page.getByRole('button', { name: 'Teinte de Story, vert' })).toBeVisible();
}

function objective(page: Page): Locator {
    return page.getByRole('textbox', { name: 'Objectif habituel' });
}

function workingDay(page: Page, name: string): Locator {
    return page.getByRole('group', { name: 'Jours travaillés' }).getByRole('button', { name, exact: true });
}

/** La ligne d'état de la section Jira. */
function connectedLine(page: Page): Locator {
    return page.getByRole('status').filter({ hasText: 'Connecté à Jira en tant que' });
}

test.describe('les réglages de la journée', () => {
    test('montrent l’objectif habituel, les jours, les types et le thème, et se lisent au clavier', async ({
        page,
    }) => {
        await openSettings(page);

        await expect(objective(page)).toHaveValue('7h30');
        await expect(objective(page), 'L’aide « hors pauses » est lue avec le champ.').toHaveAccessibleDescription(
            HELP,
        );
        for (const name of ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi']) {
            await expect(workingDay(page, name)).toHaveAttribute('aria-pressed', 'true');
        }
        for (const name of ['Samedi', 'Dimanche']) {
            await expect(workingDay(page, name)).toHaveAttribute('aria-pressed', 'false');
        }
        // « de Story », « d'Epic » : le nom de chaque bouton s'élide devant une voyelle.
        await expect(page.getByRole('button', { name: "Teinte d'Epic, violet" })).toBeVisible();
        await expect(page.getByRole('button', { name: /^Teinte d/ })).toHaveText([
            'Vert',
            'Rouge',
            'Bleu',
            'Violet',
            'Cyan',
        ]);
        await expect(page.getByRole('radio', { name: 'Système', exact: true })).toHaveAttribute('aria-checked', 'true');

        const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
        expect(results.violations).toEqual([]);
    });

    test('enregistrent l’objectif habituel à chaque − et +, sans sortir de 0h00 à 13h00', async ({
        page,
        settingsServer,
    }) => {
        await openSettings(page);

        await page.getByRole('button', { name: 'Ajouter 15 minutes' }).click();
        await expect(objective(page)).toHaveValue('7h45');
        await page.getByRole('button', { name: 'Enlever 15 minutes' }).click();
        await page.getByRole('button', { name: 'Enlever 15 minutes' }).click();
        await expect(objective(page)).toHaveValue('7h15');
        await expect.poll(() => settingsServer.settings.habitualObjective).toBe(435);

        // Au clavier, les flèches font de même.
        await objective(page).focus();
        await page.keyboard.press('ArrowUp');
        await expect(objective(page)).toHaveValue('7h30');
        await expect.poll(() => settingsServer.settings.habitualObjective).toBe(450);

        // Aux bornes, le bouton ne change rien, et rien ne part.
        await objective(page).fill('13h');
        await page.keyboard.press('Enter');
        await expect.poll(() => settingsServer.settings.habitualObjective).toBe(780);
        const sent = settingsServer.received.length;
        await page.getByRole('button', { name: 'Ajouter 15 minutes' }).click();
        await expect(objective(page)).toHaveValue('13h00');
        await objective(page).fill('0');
        await page.keyboard.press('Enter');
        await page.getByRole('button', { name: 'Enlever 15 minutes' }).click();
        await expect(objective(page)).toHaveValue('0h00');
        await expect.poll(() => settingsServer.settings.habitualObjective).toBe(0);
        expect(settingsServer.received.slice(sent)).toEqual(['PUT /api/settings/habitual-objective {"objective":0}']);
    });

    test('enregistrent une durée tapée en quittant le champ, et en refusent une de travers sous lui', async ({
        page,
        settingsServer,
    }) => {
        await openSettings(page);

        await objective(page).fill('8h');
        await page.keyboard.press('Tab');
        await expect(objective(page)).toHaveValue('8h00');
        await expect.poll(() => settingsServer.settings.habitualObjective).toBe(480);

        for (const [typed, refusal] of [
            ['8h10', "L'objectif se règle au quart d'heure."],
            ['13h15', "L'objectif va de 0h00 à 13h00."],
            ['huit', 'Indiquez une durée, comme 7h30.'],
        ] as const) {
            await objective(page).fill(typed);
            await page.keyboard.press('Enter');
            await expect(objective(page)).toHaveAttribute('aria-invalid', 'true');
            await expect(objective(page)).toHaveAccessibleDescription(`${HELP} ${refusal}`);
            await expect(objective(page), 'Rien de tapé ne se perd.').toHaveValue(typed);
        }
        expect(settingsServer.settings.habitualObjective).toBe(480);

        // Le refus tient sur une ligne, sous le contrôle : il a la largeur de la carte.
        await objective(page).fill('13h15');
        await page.keyboard.press('Enter');
        expect(
            await page.getByText("L'objectif va de 0h00 à 13h00.", { exact: false }).evaluate((node) => {
                const style = getComputedStyle(node);

                return node.getBoundingClientRect().height / Number.parseFloat(style.lineHeight);
            }),
        ).toBeLessThan(1.5);

        // Taper de nouveau efface le refus.
        await objective(page).fill('7h');
        await expect(objective(page)).not.toHaveAttribute('aria-invalid', 'true');

        // − et + partent de la durée refusée, vers le quart d'heure le plus proche.
        await objective(page).fill('8h10');
        await page.keyboard.press('Enter');
        await page.getByRole('button', { name: 'Ajouter 15 minutes' }).click();
        await expect(objective(page)).toHaveValue('8h15');
        await expect.poll(() => settingsServer.settings.habitualObjective).toBe(495);
    });

    test('réécrivent une durée acceptée sous sa forme habituelle, en quittant le champ ou par Entrée', async ({
        page,
        settingsServer,
    }) => {
        await openSettings(page);

        for (const [typed, leave, shown, minutes] of [
            ['8', 'Enter', '8h00', 480],
            ['7,5', 'Tab', '7h30', 450],
            ['6:45', 'Enter', '6h45', 405],
            ['7h', 'Tab', '7h00', 420],
        ] as const) {
            await objective(page).fill(typed);
            await page.keyboard.press(leave);
            await expect(objective(page)).toHaveValue(shown);
            await expect.poll(() => settingsServer.settings.habitualObjective).toBe(minutes);
        }

        // La même durée, autrement écrite : elle se réécrit, sans rien envoyer.
        const sent = settingsServer.received.length;
        await objective(page).fill('7');
        await page.keyboard.press('Enter');
        await expect(objective(page)).toHaveValue('7h00');
        await objective(page).fill('7:00');
        await objective(page).blur();
        await expect(objective(page)).toHaveValue('7h00');
        expect(settingsServer.received.slice(sent)).toEqual([]);
    });

    test('ne disent rien quand un réglage s’enregistre : le contrôle montre son nouvel état', async ({
        page,
        settingsServer,
    }) => {
        await openSettings(page);
        await expect(connectedLine(page)).toBeVisible();
        const main = page.getByRole('main');

        await page.getByRole('button', { name: 'Ajouter 15 minutes' }).click();
        await objective(page).fill('8h');
        await page.keyboard.press('Enter');
        await workingDay(page, 'Samedi').click();
        await page.getByRole('button', { name: 'Teinte de Story, vert' }).click();
        await page.getByRole('menu').getByRole('menuitemradio', { name: 'Olive' }).click();
        await page.getByRole('radio', { name: 'Sombre', exact: true }).click();
        await expect.poll(() => settingsServer.received.length).toBe(4);

        await expect(objective(page)).toHaveValue('8h00');
        await expect(workingDay(page, 'Samedi')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('button', { name: 'Teinte de Story, olive' })).toBeVisible();
        // Ni message, ni « Enregistré » : la seule région qui parle est la ligne d'état de Jira.
        await page.waitForTimeout(300);
        await expect(main.getByRole('alert')).toHaveCount(0);
        // Le message d'une section Jira qu'on quitte garde sa région, vide.
        await expect(main.getByRole('status').filter({ hasText: /./ })).toHaveText([/^Connecté à Jira en tant que/]);
        await expect(main).not.toContainText('Enregistré');
    });

    test('allument et éteignent chaque jour d’un clic, les sept compris', async ({ page, settingsServer }) => {
        await openSettings(page);

        await workingDay(page, 'Samedi').click();
        await expect(workingDay(page, 'Samedi')).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => settingsServer.settings.workingDays).toEqual([1, 2, 3, 4, 5, 6]);

        // Au clavier : Espace sur le bouton.
        await workingDay(page, 'Samedi').focus();
        await page.keyboard.press('Space');
        await expect(workingDay(page, 'Samedi')).toHaveAttribute('aria-pressed', 'false');

        for (const name of ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi']) {
            await workingDay(page, name).click();
        }
        await expect.poll(() => settingsServer.settings.workingDays).toEqual([]);
        expect(settingsServer.received.at(-1)).toBe('PUT /api/settings/working-days/5 {"worked":false}');
    });

    test.describe('quand l’enregistrement n’aboutit pas', () => {
        // Le serveur simulé répond 500 : le navigateur l'écrit dans la console.
        test.use({ expectedErrors: [/the server responded with a status of 500/] });

        test('remettent un jour comme il était, et le disent', async ({ page, settingsServer }) => {
            await openSettings(page);

            settingsServer.next = 'fail';
            await workingDay(page, 'Dimanche').click();

            const days = page.getByRole('region', { name: 'Journée' });
            await expect(days.getByRole('alert')).toHaveText("L'enregistrement n'a pas abouti. Réessayez.");
            await expect(workingDay(page, 'Dimanche')).toHaveAttribute('aria-pressed', 'false');

            await workingDay(page, 'Dimanche').click();
            await expect(days.getByRole('alert')).toHaveCount(0);
            await expect.poll(() => settingsServer.settings.workingDays).toEqual([1, 2, 3, 4, 5, 7]);
        });

        test('retiennent sur la page un objectif qui n’a pas pu s’enregistrer, et le réessaient en partant', async ({
            page,
            settingsServer,
        }) => {
            await openSettings(page);

            settingsServer.next = 'fail';
            await page.getByRole('button', { name: 'Ajouter 15 minutes' }).click();
            await expect(objective(page)).toHaveAccessibleDescription(
                `${HELP} L'enregistrement n'a pas abouti. Réessayez.`,
            );
            await expect(objective(page), 'Ce qu’on a choisi reste dans le champ.').toHaveValue('7h45');

            // Partir réessaie ; un nouvel échec retient sur la page, le curseur au champ.
            settingsServer.next = 'fail';
            await page.keyboard.press('Escape');
            await expect(objective(page)).toBeFocused();
            await expect(page).toHaveURL(/\/reglages$/);
            expect(settingsServer.settings.habitualObjective).toBe(450);

            await page.getByRole('link', { name: 'Retour à la journée' }).click();
            await expect(page.getByRole('region', { name: 'Grille de la journée' })).toBeVisible();
            expect(settingsServer.settings.habitualObjective).toBe(465);
        });
    });

    test('ne renvoient pas, d’un onglet resté ouvert, un objectif qu’un autre a changé depuis', async ({
        page,
        settingsServer,
    }) => {
        const other = await page.context().newPage();
        await settingsServer.serve(other);
        await openSettings(page);
        await openSettings(other);

        await page.getByRole('button', { name: 'Ajouter 15 minutes' }).click();
        await expect.poll(() => settingsServer.settings.habitualObjective).toBe(465);
        await objective(other).fill('8h');
        await other.keyboard.press('Enter');
        await expect.poll(() => settingsServer.settings.habitualObjective).toBe(480);

        // Le premier onglet reçoit les réglages à jour avec sa prochaine écriture, puis s'en va.
        await workingDay(page, 'Samedi').click();
        await expect(objective(page)).toHaveValue('8h00');
        await page.keyboard.press('Escape');
        await expect(page.getByRole('region', { name: 'Grille de la journée' })).toBeVisible();

        expect(settingsServer.settings.habitualObjective).toBe(480);
        expect(settingsServer.received.filter((write) => write.includes('habitual-objective'))).toEqual([
            'PUT /api/settings/habitual-objective {"objective":465}',
            'PUT /api/settings/habitual-objective {"objective":480}',
        ]);
        await other.close();
    });

    test('ne défont pas, d’un onglet resté ouvert, ce qu’un autre a réglé', async ({ page, settingsServer }) => {
        const other = await page.context().newPage();
        await settingsServer.serve(other);
        await openSettings(page);
        await openSettings(other);

        await workingDay(other, 'Samedi').click();
        await expect.poll(() => settingsServer.settings.workingDays).toEqual([1, 2, 3, 4, 5, 6]);
        // Le premier onglet n'a pas vu le samedi s'allumer.
        await workingDay(page, 'Lundi').click();

        await expect.poll(() => settingsServer.settings.workingDays).toEqual([2, 3, 4, 5, 6]);
        await expect(workingDay(page, 'Samedi'), 'La réponse remet l’onglet à jour.').toHaveAttribute(
            'aria-pressed',
            'true',
        );
        await other.close();
    });
});

test.describe('les teintes des types', () => {
    test('se choisissent dans la grille des douze, à la souris comme au clavier', async ({ page, settingsServer }) => {
        await openSettings(page);
        const button = page.getByRole('button', { name: 'Teinte de Support client, cyan' });

        await button.click();
        const menu = page.getByRole('menu', { name: 'Teinte de Support client' });
        await expect(menu.getByRole('menuitemradio')).toHaveCount(12);
        await expect(menu.getByRole('menuitemradio', { name: 'Cyan' })).toHaveAttribute('aria-checked', 'true');
        await menu.getByRole('menuitemradio', { name: 'Magenta' }).click();

        await expect(page.getByRole('button', { name: 'Teinte de Support client, magenta' })).toBeFocused();
        await expect
            .poll(() => settingsServer.received)
            .toEqual([`PUT /api/settings/issue-types/${SUPPORT} {"color":"magenta"}`]);

        // Au clavier : les flèches vont dans les deux sens de la grille, Entrée choisit.
        await page.keyboard.press('Enter');
        await expect(menu.getByRole('menuitemradio', { name: 'Magenta' })).toBeFocused();
        await page.keyboard.press('ArrowUp');
        await expect(menu.getByRole('menuitemradio', { name: 'Sarcelle' })).toBeFocused();
        await page.keyboard.press('ArrowRight');
        await expect(menu.getByRole('menuitemradio', { name: 'Cyan' })).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await expect(menu.getByRole('menuitemradio', { name: 'Rose' })).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(
            menu.getByRole('menuitemradio', { name: 'Rose' }),
            'La grille ne s’ouvre pas par le bas.',
        ).toBeFocused();
        await page.keyboard.press('Enter');

        await expect(page.getByRole('button', { name: 'Teinte de Support client, rose' })).toBeVisible();
        await expect.poll(() => settingsServer.settings.issueTypes[4]?.color).toBe('rose');
    });

    test('se ferment par Échap sans quitter la page', async ({ page }) => {
        await openSettings(page);

        await page.getByRole('button', { name: 'Teinte de Bug, rouge' }).click();
        await page.keyboard.press('Escape');

        await expect(page.getByRole('menu')).toHaveCount(0);
        await expect(page).toHaveURL(/\/reglages$/);
        await expect(page.getByRole('button', { name: 'Teinte de Bug, rouge' })).toBeFocused();
    });

    test('s’affichent sur les blocs, le récapitulatif, les favoris et l’aperçu de la fenêtre', async ({
        page,
        request,
    }) => {
        const date = day(0);
        await writeDay(request, date, [
            { start: '09:00', end: '10:00', ticket: 'SHOP-482' },
            { start: '10:00', end: '10:30', ticket: 'SHOP-519' },
            { start: '10:30', end: '11:00', ticket: 'OPS-12' },
        ]);
        await openSampleDay(page, date);

        const grid = page.getByRole('region', { name: 'Grille de la journée' });
        await expect(grid.locator('li[data-color]')).toHaveCount(3);
        expect(
            await grid.locator('li[data-color]').evaluateAll((items) => items.map((item) => item.dataset.color)),
        ).toEqual(['vert', 'rouge', 'bleu']);
        const recap = page.getByRole('complementary', { name: 'Récapitulatif' });
        await expect(recap.locator('li[data-color="vert"]')).toContainText('SHOP-482');
        const favorites = page.getByRole('complementary', { name: 'Favoris et calendrier' });
        await expect(favorites.locator('[data-color="violet"]')).toContainText('SHOP-377');

        // Un favori qu'on glisse : la zone de dépôt prend sa teinte. Le calendrier, sous la
        // liste, ne lui laisse pas la place de tous les montrer : celui-ci défile à la vue.
        await favorites.getByText('SHOP-377').scrollIntoViewIfNeeded();
        const card = await favorites.getByText('SHOP-377').boundingBox();
        if (card === null) {
            throw new Error('Le favori n’est pas à l’écran.');
        }
        await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
        await page.mouse.down();
        const target = await slotPoint(page, '14:00');
        await page.mouse.move(target.x, target.y, { steps: 8 });
        await expect(page.getByText('14:00 à 14:15', { exact: true })).toHaveAttribute('data-color', 'violet');
        await page.keyboard.press('Escape');
        await page.mouse.up();

        // Nouveau ticket : l'aperçu, à la teinte du type.
        await dragSlots(page, '15:00', '15:15');
        await page.keyboard.press('Enter');
        await ticketWindow(page).getByLabel('Ticket').fill('SHOP-498');
        await expect(ticketWindow(page).locator('.ticket-preview')).toHaveAttribute('data-color', 'vert');
        await page.keyboard.press('Escape');

        await clearDay(request, date);
    });
});

test.describe('un type au nom long', () => {
    const LONG = 'Demande de changement soumise au comité d’architecture et à la direction technique du groupe';
    const UNBROKEN = 'x'.repeat(70);

    test.use({
        settings: {
            ...SAMPLE_SETTINGS,
            issueTypes: [
                { id: '0199a3c4-0000-7000-8000-000000000011', name: LONG, color: 'ambre' },
                { id: '0199a3c4-0000-7000-8000-000000000012', name: UNBROKEN, color: 'cyan' },
                ...SAMPLE_SETTINGS.issueTypes,
            ],
        },
    });

    for (const [name, label] of [
        [LONG, `Teinte de ${LONG}, ambre`],
        [UNBROKEN, `Teinte de ${UNBROKEN}, cyan`],
    ] as const) {
        test(`reste dans son cadre : ${name.slice(0, 12)}…`, async ({ page }) => {
            await openSettings(page);
            const preview = page.getByText(name, { exact: true });
            const button = page.getByRole('button', { name: label });
            const row = preview.locator('..');
            const [previewBox, buttonBox, rowBox, shortBox] = await Promise.all([
                preview.boundingBox(),
                button.boundingBox(),
                row.boundingBox(),
                page.getByText('Story', { exact: true }).boundingBox(),
            ]);
            if (previewBox === null || buttonBox === null || rowBox === null || shortBox === null) {
                throw new Error('La ligne du type ne se mesure pas.');
            }

            // À la ligne, la ligne grandit : ni coupé, ni sur le bouton, ni sur les voisines.
            expect(previewBox.height).toBeGreaterThan(shortBox.height);
            expect(previewBox.x + previewBox.width).toBeLessThanOrEqual(buttonBox.x);
            expect(previewBox.y).toBeGreaterThanOrEqual(rowBox.y);
            expect(previewBox.y + previewBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height);
            expect(await preview.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
            // Le bouton reste centré sur la ligne.
            expect(Math.abs(buttonBox.y + buttonBox.height / 2 - (rowBox.y + rowBox.height / 2))).toBeLessThanOrEqual(
                1,
            );
        });
    }
});

test.describe('le thème', () => {
    test('se pose dès le choix, se garde au rechargement, et suit le système quand on le lui demande', async ({
        page,
    }) => {
        await page.emulateMedia({ colorScheme: 'light' });
        await openSettings(page);
        const html = page.locator('html');

        await page.getByRole('radio', { name: 'Sombre' }).click();
        await expect(html).toHaveAttribute('data-theme', 'dark');

        await page.reload();
        await expect(html).toHaveAttribute('data-theme', 'dark');
        await expect(page.getByRole('radio', { name: 'Sombre' })).toHaveAttribute('aria-checked', 'true');

        // Les flèches parcourent le choix, comme dans tout groupe de boutons radio.
        await page.getByRole('radio', { name: 'Sombre' }).focus();
        await page.keyboard.press('ArrowRight');
        await expect(page.getByRole('radio', { name: 'Système', exact: true })).toHaveAttribute('aria-checked', 'true');
        await expect(html).toHaveAttribute('data-theme', 'light');
        await page.emulateMedia({ colorScheme: 'dark' });
        await expect(html).toHaveAttribute('data-theme', 'dark');

        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('ArrowLeft');
        await expect(page.getByRole('radio', { name: 'Clair' })).toHaveAttribute('aria-checked', 'true');
        await expect(html).toHaveAttribute('data-theme', 'light');
    });

    test('changé dans les réglages, se voit dans un autre onglet', async ({ page, settingsServer }) => {
        await page.emulateMedia({ colorScheme: 'light' });
        await page.goto(`/${day(1)}`);
        const settings = await page.context().newPage();
        await settingsServer.serve(settings);
        await openSettings(settings);

        await settings.getByRole('radio', { name: 'Sombre' }).click();

        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        await settings.close();
    });
});

test.describe('l’objectif habituel dans la journée', () => {
    test.use({ settings: { ...SAMPLE_SETTINGS, habitualObjective: 405 } });

    test('se relit à l’ouverture de la fenêtre Objectif du jour, changé dans un autre onglet', async ({
        page,
        request,
    }) => {
        const date = day(4);
        await writeDay(request, date, [{ start: '09:00', end: '10:00', ticket: 'SHOP-482' }]);
        await openSampleDay(page, date);

        // La journée s'est lue avec l'habituel du serveur ; les réglages, entre-temps, disent 6h45.
        await page.getByRole('button', { name: /^Objectif du jour, / }).click();

        await expect(page.getByRole('button', { name: 'Revenir à 6h45' })).toBeVisible();
        await clearDay(request, date);
    });
});

test.describe('la page Réglages', () => {
    test('garde sa barre en haut quand elle défile, et ramène au jour par elle', async ({ page }) => {
        const date = day(2);
        await page.setViewportSize({ width: 1024, height: 720 });
        await page.goto(`/${date}`);
        await page.getByRole('button', { name: 'Réglages' }).click();
        await expect(page.getByRole('button', { name: 'Teinte de Story, vert' })).toBeVisible();

        await page.locator('footer').scrollIntoViewIfNeeded();

        const bar = page.getByRole('banner');
        expect((await bar.boundingBox())?.y).toBe(0);
        // Les sections passent dessous.
        await page.getByRole('link', { name: 'Retour à la journée' }).click();
        await expect(page).toHaveURL(new RegExp(`/${date}$`));
    });

    test('enregistre ce qui part encore avant de rouvrir la journée, qui le lit ensuite', async ({
        page,
        settingsServer,
    }) => {
        const date = day(3);
        await page.goto(`/${date}`);
        await page.getByRole('button', { name: 'Réglages' }).click();
        await expect(objective(page)).toHaveValue('7h30');
        settingsServer.delay = 800;
        const order: string[] = [];
        page.on('response', (response) => {
            const path = new URL(response.url()).pathname;
            if (path.startsWith('/api/settings/') || path === `/api/days/${date}`) {
                order.push(path);
            }
        });

        // Une durée tapée, pas encore partie : Échap l'enregistre, puis ramène au jour.
        await objective(page).fill('8h');
        await page.keyboard.press('Escape');

        await expect(page.getByRole('region', { name: 'Grille de la journée' })).toBeVisible();
        await expect.poll(() => order).toEqual(['/api/settings/habitual-objective', `/api/days/${date}`]);
        expect(settingsServer.settings.habitualObjective).toBe(480);
    });

    test('retient sur la page une durée refusée, son message sous le champ', async ({ page, settingsServer }) => {
        await openSettings(page);

        await objective(page).fill('8h10');
        await page.keyboard.press('Escape');

        await expect(page).toHaveURL(/\/reglages$/);
        await expect(objective(page)).toBeFocused();
        await expect(objective(page)).toHaveAccessibleDescription(`${HELP} L'objectif se règle au quart d'heure.`);
        expect(settingsServer.received).toEqual([]);
    });

    test('porte la version installée et le lien vers le dépôt, dans un nouvel onglet', async ({ page }) => {
        await openSettings(page);
        const footer = page.locator('footer');

        await expect(footer.getByText(/^DayTrack \d+\.\d+\.\d+$/)).toBeVisible();
        await expect(footer.getByText(/^© 2026(-\d{4})? Valentin Le Gal$/)).toBeVisible();
        const github = footer.getByRole('link', { name: 'GitHub, dans un nouvel onglet' });
        await expect(github).toHaveAttribute('href', 'https://github.com/valentinlegal/daytrack');
        await expect(github).toHaveAttribute('target', '_blank');
        await expect(github).toHaveAttribute('rel', 'noopener');
    });
});
