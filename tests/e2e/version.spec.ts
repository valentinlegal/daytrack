import type { Page } from '@playwright/test';

import { clearDay, type Entry, startTimeAt, weekday, writeDay } from './day';
import { doubleClickSlot, savedDay, ticketWindow } from './editing';
import { expect, refusedWith, test } from './fixtures';
import { AVAILABLE, updateButton, updateWindow } from './version';

/**
 * Le numéro de version et l'avis d'une nouvelle version, au pied de la colonne : ce qu'on
 * y voit, sa fenêtre et les commandes qu'on en copie. Un avis qui ne s'écrit nulle part :
 * aucun de ces gestes n'envoie rien au serveur, ni ne change la journée.
 */

/** Les jours de ce fichier : une semaine d'avril 2023, avant tous les autres. */
const DATE = weekday('2023-04-03', 0);
/** Celui des fenêtres de ticket : il reste vide entre deux parcours. */
const TICKET_DATE = weekday('2023-04-03', 1);

const ENTRIES: Entry[] = [{ start: '09:00', end: '10:00', ticket: 'SHOP-482' }];

const COMMANDS = 'docker compose pull\ndocker compose up -d';
const FOOT = '.column-foot';

const SIMULATED_IMAGES = 'https://jira/_simulation/images';

test.describe.configure({ mode: 'default' });

test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext({
        baseURL: process.env.DAYTRACK_URL ?? 'https://localhost:8443',
        ignoreHTTPSErrors: true,
    });
    await writeDay(request, DATE, ENTRIES);
    await request.dispose();
});

test.afterAll(async ({ playwright }) => {
    const request = await playwright.request.newContext({
        baseURL: process.env.DAYTRACK_URL ?? 'https://localhost:8443',
        ignoreHTTPSErrors: true,
    });
    await clearDay(request, DATE);
    await request.dispose();
});

async function open(page: Page): Promise<void> {
    await startTimeAt(page, DATE, '15:20');
    await page.goto(`/${DATE}`);
    await expect(page.getByRole('group', { name: 'Chiffres du jour' })).toBeVisible();
}

/** Ce qui s'écrit à partir d'ici : la journée, à son ouverture, relit ses tickets et le jeton. */
async function watchWrites(page: Page): Promise<string[]> {
    await page.waitForLoadState('networkidle');
    const writes: string[] = [];
    page.on('request', (request) => {
        if (request.method() !== 'GET') {
            writes.push(request.url());
        }
    });

    return writes;
}

test.describe('sans nouvelle version', () => {
    test('le pied ne montre que le numéro', async ({ page }) => {
        await open(page);

        await expect(page.locator(FOOT).getByText(/^v\d+\.\d+\.\d+$/)).toBeVisible();
        await expect(updateButton(page)).toHaveCount(0);
    });

    test('à 224 px, le numéro reste : rien ne lui prend sa place', async ({ page }) => {
        await page.setViewportSize({ width: 1024, height: 720 });
        await open(page);

        await expect(page.locator(FOOT).getByText(/^v\d/)).toBeVisible();
    });
});

test.describe('quand le serveur ne répond pas', () => {
    test.use({ expectedErrors: [/500/] });

    test('le pied ne montre que le numéro, sans message', async ({ page }) => {
        await page.route('**/api/version', (route) => route.fulfill({ status: 500, body: '' }));
        await open(page);

        await expect(page.locator(FOOT).getByText(/^v\d/)).toBeVisible();
        await expect(updateButton(page)).toHaveCount(0);
        await expect(page.getByRole('alert')).toHaveCount(0);
    });
});

test.describe('une réponse de travers', () => {
    test('ne s’annonce pas', async ({ page }) => {
        await page.route('**/api/version', (route) => route.fulfill({ json: { available: '<img src=x>' } }));
        await open(page);

        await expect(page.locator(FOOT).getByText(/^v\d/)).toBeVisible();
        await expect(updateButton(page)).toHaveCount(0);
    });
});

test.describe('avec une nouvelle version', () => {
    test.use({ available: AVAILABLE });

    test('le bouton la dit, à côté du numéro', async ({ page }) => {
        await open(page);

        await expect(updateButton(page)).toHaveText('Nouvelle version');
        await expect(updateButton(page)).toHaveAccessibleName(`Nouvelle version disponible, ${AVAILABLE}`);
        await expect(updateButton(page)).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator(FOOT).getByText(/^v\d/)).toBeVisible();
    });

    test('sa fenêtre dit quoi lancer, et mène aux nouveautés', async ({ page }) => {
        await open(page);
        await updateButton(page).click();

        const window = updateWindow(page);
        await expect(window).toBeVisible();
        await expect(updateButton(page)).toHaveAttribute('aria-expanded', 'true');
        await expect(window).toContainText(
            "Pour mettre à jour, lancez ces deux commandes dans le dossier de DayTrack, sur la machine qui l'héberge. Rechargez ensuite cette page.",
        );
        expect(await window.locator('pre').innerText()).toBe(COMMANDS);

        const notes = window.getByRole('link', {
            name: `Voir les nouveautés de la ${AVAILABLE}, dans un nouvel onglet`,
        });
        await expect(notes).toHaveAttribute(
            'href',
            `https://github.com/valentinlegal/daytrack/releases/tag/v${AVAILABLE}`,
        );
        await expect(notes).toHaveAttribute('target', '_blank');
        await expect(notes).toHaveAttribute('rel', 'noopener');

        // Le curseur entre dans la fenêtre.
        await expect(window.getByRole('button', { name: 'Plus tard' })).toBeFocused();
    });

    test('elle se pose au-dessus du bouton, sa flèche vers lui', async ({ page }) => {
        await open(page);
        await updateButton(page).click();

        const window = await updateWindow(page).boundingBox();
        const button = await updateButton(page).boundingBox();
        expect(window).not.toBeNull();
        expect(button).not.toBeNull();
        if (window !== null && button !== null) {
            expect(window.y + window.height).toBeLessThanOrEqual(button.y);
            expect(Math.round(window.x)).toBe(Math.round(button.x));
        }
    });

    test('« Plus tard » ferme, rend le curseur et laisse le bouton', async ({ page }) => {
        await open(page);
        await updateButton(page).click();
        await updateWindow(page).getByRole('button', { name: 'Plus tard' }).click();

        await expect(updateWindow(page)).toHaveCount(0);
        await expect(updateButton(page)).toBeVisible();
        await expect(updateButton(page)).toBeFocused();
        await expect(updateButton(page)).toHaveAttribute('aria-expanded', 'false');
    });

    test('la croix ferme', async ({ page }) => {
        await open(page);
        await updateButton(page).click();
        await updateWindow(page).getByRole('button', { name: 'Fermer' }).click();

        await expect(updateWindow(page)).toHaveCount(0);
        await expect(updateButton(page)).toBeFocused();
    });

    test('Échap ferme et rend le curseur', async ({ page }) => {
        await open(page);
        await updateButton(page).click();
        await page.keyboard.press('Escape');

        await expect(updateWindow(page)).toHaveCount(0);
        await expect(updateButton(page)).toBeFocused();
    });

    test('un clic à côté ferme sans rien faire', async ({ page }) => {
        await open(page);
        const writes = await watchWrites(page);
        await updateButton(page).click();

        await page.getByRole('heading', { level: 1 }).click();

        await expect(updateWindow(page)).toHaveCount(0);
        expect(writes).toEqual([]);
    });

    test('un clic sur le bouton referme la fenêtre, sans la rouvrir', async ({ page }) => {
        await open(page);
        await updateButton(page).click();
        await expect(updateWindow(page)).toBeVisible();

        await updateButton(page).click();

        await expect(updateWindow(page)).toHaveCount(0);
        await expect(updateButton(page)).toHaveAttribute('aria-expanded', 'false');

        await updateButton(page).click();
        await expect(updateWindow(page)).toBeVisible();
    });

    test('se manie au clavier', async ({ page }) => {
        await open(page);
        await updateButton(page).focus();
        await page.keyboard.press('Enter');

        const window = updateWindow(page);
        await expect(window.getByRole('button', { name: 'Plus tard' })).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(window.getByRole('button', { name: 'Copier les commandes' })).toBeFocused();

        await page.keyboard.press('Escape');
        await expect(window).toHaveCount(0);
        await expect(updateButton(page)).toBeFocused();

        // Un appui du pointeur relâché ailleurs n'empêche pas de la rouvrir au clavier.
        await updateButton(page).click();
        await expect(window).toBeVisible();
        const box = await updateButton(page).boundingBox();
        if (box !== null) {
            await page.mouse.move(box.x + 4, box.y + 4);
            await page.mouse.down();
            await page.mouse.move(500, 300);
            await page.mouse.up();
        }
        await expect(window).toHaveCount(0);
        await updateButton(page).focus();
        await page.keyboard.press('Enter');
        await expect(window).toBeVisible();
    });

    test('ouvrir et fermer la fenêtre n’écrit rien, et la journée ne bouge pas', async ({ page }) => {
        await open(page);
        const writes = await watchWrites(page);
        const figures = await page.getByRole('group', { name: 'Chiffres du jour' }).textContent();

        await updateButton(page).click();
        await page.keyboard.press('Escape');
        await updateButton(page).click();
        await updateWindow(page).getByRole('button', { name: 'Plus tard' }).click();

        expect(writes).toEqual([]);
        await expect(page.getByRole('group', { name: 'Chiffres du jour' })).toHaveText(figures ?? '');
    });

    test('une fenêtre de ticket ouverte s’enregistre d’abord, une seule fois', async ({ page, request }) => {
        await writeDay(request, TICKET_DATE, []);
        await startTimeAt(page, TICKET_DATE, '15:20');
        await page.goto(`/${TICKET_DATE}`);
        await doubleClickSlot(page, '10:00');
        await ticketWindow(page).getByLabel('Ticket').fill('SHOP-482');

        await updateButton(page).click();

        await expect(updateWindow(page)).toBeVisible();
        await expect(ticketWindow(page)).toHaveCount(0);
        expect(await savedDay(request, TICKET_DATE)).toHaveLength(1);
    });

    test.describe('à côté d’un ticket refusé', () => {
        test.use({ expectedErrors: [refusedWith(422)] });

        test('la fenêtre ne s’ouvre pas', async ({ page, request }) => {
            await writeDay(request, TICKET_DATE, []);
            await startTimeAt(page, TICKET_DATE, '15:20');
            await page.goto(`/${TICKET_DATE}`);
            await doubleClickSlot(page, '10:00');
            await ticketWindow(page).getByLabel('Ticket').fill('SHOP-9099');

            await updateButton(page).click();

            await expect(ticketWindow(page).getByText('Ticket introuvable dans Jira.')).toBeVisible();
            await expect(ticketWindow(page).getByLabel('Ticket')).toHaveValue('SHOP-9099');
            await expect(updateWindow(page)).toHaveCount(0);
            await expect(updateButton(page)).toHaveAttribute('aria-expanded', 'false');
            expect(await savedDay(request, TICKET_DATE)).toEqual([]);
        });
    });

    test.describe('à 224 px', () => {
        test.use({ viewport: { width: 1024, height: 720 } });

        test('ouvrir la fenêtre referme le récapitulatif posé sur la grille', async ({ page }) => {
            await open(page);
            await page.getByRole('button', { name: 'Afficher le récapitulatif' }).click();
            await expect(page.getByRole('button', { name: 'Masquer le récapitulatif' })).toBeVisible();

            await updateButton(page).click();

            await expect(updateWindow(page)).toBeVisible();
            await expect(page.getByRole('button', { name: 'Afficher le récapitulatif' })).toBeVisible();
        });

        test('le numéro s’efface : le bouton garde son texte, et tout tient dans la colonne', async ({ page }) => {
            await open(page);

            await expect(updateButton(page)).toHaveText('Nouvelle version');
            await expect(page.locator(FOOT).getByText(/^v\d/)).toBeHidden();

            const settings = page.locator(FOOT).getByRole('button', { name: 'Réglages' });
            const foot = await page.locator(FOOT).boundingBox();
            const gear = await settings.boundingBox();
            // La colonne, sans son trait.
            expect(foot?.width).toBe(223);
            if (foot !== null && gear !== null) {
                expect(gear.x + gear.width).toBeLessThanOrEqual(foot.x + foot.width);
            }
        });

        test('la fenêtre reste entière dans l’écran', async ({ page }) => {
            await open(page);
            await updateButton(page).click();

            const box = await updateWindow(page).boundingBox();
            expect(box).not.toBeNull();
            if (box !== null) {
                expect(box.x).toBeGreaterThanOrEqual(0);
                expect(box.y).toBeGreaterThanOrEqual(0);
                expect(box.x + box.width).toBeLessThanOrEqual(1024);
            }
        });
    });

    test('à la largeur par défaut, le numéro, le bouton et l’engrenage tiennent ensemble', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await open(page);

        await expect(page.locator(FOOT).getByText(/^v\d/)).toBeVisible();
        const foot = await page.locator(FOOT).evaluate((node) => [node.clientWidth, node.scrollWidth]);
        expect(foot[0]).toBe(255);
        expect(foot[1]).toBe(foot[0]);
        const number = page.locator(FOOT).getByText(/^v\d/);
        expect(await number.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    });

    test('élargie, la colonne rend le numéro', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await open(page);
        const number = page.locator(FOOT).getByText(/^v\d/);

        const edge = page.getByRole('separator', { name: 'Largeur des favoris' });
        await edge.focus();
        await page.keyboard.press('Home');
        await expect(number).toBeHidden();

        await page.keyboard.press('End');
        await expect(number).toBeVisible();

        await edge.dblclick();
        await expect(number).toBeVisible();
    });
});

test.describe('copier les commandes', () => {
    test.use({ available: AVAILABLE, permissions: ['clipboard-read', 'clipboard-write'] });

    test('les met dans le presse-papier, et le bouton le dit un instant', async ({ page }) => {
        await open(page);
        await updateButton(page).click();
        const window = updateWindow(page);
        const button = window.getByRole('button', { name: 'Copier les commandes' });
        const width = (await button.boundingBox())?.width;

        await button.click();

        const copied = window.getByRole('button', { name: 'Commandes copiées' });
        await expect(copied).toBeVisible();
        expect((await copied.boundingBox())?.width).toBe(width);
        await expect(window.locator('[aria-live="polite"]')).toHaveText('Commandes copiées');

        // La coche prend la couleur du texte du bouton, et reste contre lui.
        const check = copied.locator('span:not(.invisible) > svg');
        const [checkColor, buttonColor] = await Promise.all([
            check.evaluate((node) => getComputedStyle(node).color),
            copied.evaluate((node) => getComputedStyle(node).color),
        ]);
        expect(checkColor).toBe(buttonColor);
        const gap = await check.evaluate((node) => {
            const label = document.createRange();
            label.selectNode(node.nextSibling as Text);

            return label.getBoundingClientRect().left - node.getBoundingClientRect().right;
        });
        expect(gap).toBe(8);

        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(COMMANDS);

        await expect(window.getByRole('button', { name: 'Copier les commandes' })).toBeVisible({ timeout: 4000 });
        await expect(window.locator('[aria-live="polite"]')).toHaveText('');
    });

    test('copier ne ferme pas la fenêtre, et deux clics ne cassent rien', async ({ page }) => {
        await open(page);
        await updateButton(page).click();
        const window = updateWindow(page);

        await window.getByRole('button', { name: 'Copier les commandes' }).dblclick();

        await expect(window).toBeVisible();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(COMMANDS);
    });
});

test.describe('quand le navigateur refuse la copie', () => {
    test.use({ available: AVAILABLE });

    test('la fenêtre le dit, et les commandes restent à sélectionner', async ({ page }) => {
        await page.addInitScript(() => {
            navigator.clipboard.writeText = () => Promise.reject(new Error('Refusé'));
        });
        await open(page);
        await updateButton(page).click();
        const window = updateWindow(page);

        await window.getByRole('button', { name: 'Copier les commandes' }).click();

        await expect(window.getByText('Copie impossible : sélectionnez les commandes à la main.')).toBeVisible();
        await expect(window.getByRole('button', { name: 'Copier les commandes' })).toBeVisible();
        expect(await window.locator('pre').evaluate((node) => getComputedStyle(node).userSelect)).toBe('all');

        // Plus haute d'une ligne, elle reste au-dessus du bouton, sans le couvrir.
        const box = await window.boundingBox();
        const button = await updateButton(page).boundingBox();
        if (box !== null && button !== null) {
            expect(box.y + box.height).toBeLessThanOrEqual(button.y);
        }
    });

    test('la fenêtre rouverte a oublié le refus', async ({ page }) => {
        await page.addInitScript(() => {
            navigator.clipboard.writeText = () => Promise.reject(new Error('Refusé'));
        });
        await open(page);
        await updateButton(page).click();
        await updateWindow(page).getByRole('button', { name: 'Copier les commandes' }).click();
        await page.keyboard.press('Escape');
        await updateButton(page).click();

        await expect(updateWindow(page).getByText('Copie impossible')).toHaveCount(0);
    });

    test('hors HTTPS, sans presse-papier du tout, de même', async ({ page }) => {
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'clipboard', { value: undefined });
        });
        await open(page);
        await updateButton(page).click();

        await updateWindow(page).getByRole('button', { name: 'Copier les commandes' }).click();

        await expect(updateWindow(page).getByText('Copie impossible')).toBeVisible();
    });
});

test.describe('au retour sur l’onglet', () => {
    async function comeBack(page: Page): Promise<void> {
        await page.evaluate(() => {
            document.dispatchEvent(new Event('visibilitychange'));
        });
    }

    test('une version publiée entre-temps s’annonce, sans recharger', async ({ page }) => {
        await open(page);
        await expect(updateButton(page)).toHaveCount(0);

        await page.route('**/api/version', (route) => route.fulfill({ json: { available: AVAILABLE } }));
        await comeBack(page);

        await expect(updateButton(page)).toBeVisible();
    });

    test.describe('un registre devenu muet', () => {
        test.use({ expectedErrors: [/ERR_FAILED/] });

        test('ne retire pas l’avis', async ({ page }) => {
            await page.route('**/api/version', (route) => route.fulfill({ json: { available: AVAILABLE } }));
            await open(page);
            await expect(updateButton(page)).toBeVisible();

            const refused = page.waitForEvent('requestfailed');
            await page.route('**/api/version', (route) => route.abort());
            await comeBack(page);
            await refused;

            await expect(updateButton(page)).toBeVisible();
        });
    });

    test('une fenêtre partie avec son bouton ne revient pas toute seule, ni ne vole une saisie', async ({
        page,
        request,
    }) => {
        await writeDay(request, TICKET_DATE, []);
        await page.route('**/api/version', (route) => route.fulfill({ json: { available: AVAILABLE } }));
        await startTimeAt(page, TICKET_DATE, '15:20');
        await page.goto(`/${TICKET_DATE}`);
        await updateButton(page).click();
        await expect(updateWindow(page)).toBeVisible();

        // La version disparaît, fenêtre ouverte : un registre en panne au retour sur l'onglet.
        await page.route('**/api/version', (route) => route.fulfill({ json: { available: null } }));
        await comeBack(page);
        await expect(updateWindow(page)).toHaveCount(0);

        await doubleClickSlot(page, '10:00');
        const ticket = ticketWindow(page);
        await ticket.getByLabel('Ticket').fill('SHOP-482');
        await ticket.getByLabel('Commentaire').pressSequentially('en cours');

        // Elle revient, en pleine frappe.
        await page.route('**/api/version', (route) => route.fulfill({ json: { available: AVAILABLE } }));
        await comeBack(page);
        await expect(updateButton(page)).toBeVisible();

        await expect(updateWindow(page)).toHaveCount(0);
        await expect(updateButton(page)).toHaveAttribute('aria-expanded', 'false');
        await expect(ticket).toBeVisible();
        await expect(ticket.getByLabel('Commentaire')).toBeFocused();
        expect(await savedDay(request, TICKET_DATE)).toEqual([]);

        // Le premier clic sur le bouton ouvre, il ne ferme pas.
        await ticket.getByRole('button', { name: 'Annuler' }).click();
        await updateButton(page).click();
        await expect(updateWindow(page)).toBeVisible();
    });

    test('la mise à jour faite ailleurs retire le bouton et sa fenêtre', async ({ page }) => {
        await page.route('**/api/version', (route) => route.fulfill({ json: { available: AVAILABLE } }));
        await open(page);
        await updateButton(page).click();
        await expect(updateWindow(page)).toBeVisible();

        await page.route('**/api/version', (route) => route.fulfill({ json: { available: null } }));
        await comeBack(page);

        await expect(updateButton(page)).toHaveCount(0);
        await expect(updateWindow(page)).toHaveCount(0);
        // Le curseur qui y était ne se perd pas avec elle.
        await expect(page.locator(FOOT).getByRole('button', { name: 'Réglages' })).toBeFocused();
    });
});

test.describe('par le serveur', () => {
    test.use({ available: 'server' });
    test.describe.configure({ mode: 'serial' });

    test.afterEach(async ({ playwright }) => {
        const request = await playwright.request.newContext({ ignoreHTTPSErrors: true });
        await request.post(SIMULATED_IMAGES, { data: { tags: ['1.1.0', '1.1', '1', 'latest', 'develop'] } });
        await request.dispose();
    });

    test('rien de publié : pas d’avis', async ({ page }) => {
        await open(page);

        await expect(page.locator(FOOT).getByText(/^v\d/)).toBeVisible();
        await expect(updateButton(page)).toHaveCount(0);
    });

    test('une version publiée sur le registre s’annonce jusque dans la fenêtre', async ({ page, playwright }) => {
        const request = await playwright.request.newContext({ ignoreHTTPSErrors: true });
        await request.post(SIMULATED_IMAGES, { data: { tags: ['1.1.0', '99.1.2', 'latest'] } });
        await request.dispose();

        await open(page);
        await updateButton(page).click();

        await expect(page.getByRole('dialog', { name: 'DayTrack 99.1.2 est disponible' })).toBeVisible();
    });
});
