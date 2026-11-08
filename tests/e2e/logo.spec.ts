import type { Locator } from '@playwright/test';

import { clearDay, startTimeAt } from './day';
import { dragSlots, savedDay, ticketWindow } from './editing';
import { expect, refusedWith, test } from './fixtures';

const DATE = '2026-10-05';

/** Le logo se lit « DayTrack », à sa hauteur, dans la couleur du texte de son thème. */
async function expectLogo(logo: Locator, height: number) {
    await expect(logo).toBeVisible();
    expect((await logo.boundingBox())?.height).toBe(height);
    const [color, ink] = await logo.evaluate((node) => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--ink)';
        document.body.append(probe);
        const expected = getComputedStyle(probe).color;
        probe.remove();

        return [getComputedStyle(node).color, expected];
    });
    expect(color).toBe(ink);
}

for (const scheme of ['light', 'dark'] as const) {
    test.describe(`le logo, en thème ${scheme === 'light' ? 'clair' : 'sombre'}`, () => {
        test.use({ colorScheme: scheme });

        test('dans la barre de la journée', async ({ page }) => {
            await page.goto(`/${DATE}`);
            await expectLogo(page.getByRole('banner').getByRole('img', { name: 'DayTrack' }), 28);
        });

        test('dans la barre des réglages', async ({ page }) => {
            await page.goto('/reglages');
            await expectLogo(page.getByRole('banner').getByRole('img', { name: 'DayTrack' }), 28);
        });
    });
}

test.describe('le logo de la bienvenue', () => {
    test.use({ jira: { state: 'unlinked' } });

    test('sur deux lignes, au-dessus du titre', async ({ page }) => {
        await page.goto(`/${DATE}`);
        const logo = page.getByRole('img', { name: 'DayTrack' });
        await expectLogo(logo, 64);
        const title = await page.getByRole('heading', { name: 'Bienvenue dans DayTrack' }).boundingBox();
        expect((await logo.boundingBox())?.y).toBeLessThan(title?.y ?? 0);
    });
});

test.describe('les icônes de la page', () => {
    for (const [href, type] of [
        ['/favicon.svg', 'image/svg+xml'],
        ['/favicon-32.png', 'image/png'],
        ['/apple-touch-icon.png', 'image/png'],
    ] as const) {
        test(`${href} est annoncée et servie`, async ({ page, request }) => {
            await page.goto(`/${DATE}`);
            await expect(page.locator(`head link[href="${href}"]`)).toHaveCount(1);
            const response = await request.get(href);
            expect(response.status()).toBe(200);
            expect(response.headers()['content-type']).toContain(type);
        });
    }
});

test.describe("le logo mène à aujourd'hui", () => {
    const TODAY = '2026-10-07';

    test.beforeEach(async ({ page }) => {
        await startTimeAt(page, TODAY, '10:00');
    });

    test('depuis un autre jour, sans recharger la page', async ({ page }) => {
        await page.goto(`/${DATE}`);
        await page.evaluate(() => {
            (window as unknown as { sameDocument: boolean }).sameDocument = true;
        });
        await page.getByRole('banner').getByRole('link', { name: "DayTrack, aller à aujourd'hui" }).click();
        await expect(page).toHaveURL(`/${TODAY}`);
        expect(await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument)).toBe(true);
    });

    test('au clavier', async ({ page }) => {
        await page.goto(`/${DATE}`);
        await page
            .getByRole('banner')
            .getByRole('link', { name: /^DayTrack/ })
            .focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(`/${TODAY}`);
    });

    // La page se recharge : c'est le serveur qui dit quel jour on est, sans l'horloge du parcours.
    test("depuis les réglages, et pas vers le jour d'où l'on venait", async ({ page, request }) => {
        await page.goto(`/${DATE}`);
        await page.getByRole('button', { name: 'Réglages' }).click();
        await expect(page).toHaveURL('/reglages');
        await page
            .getByRole('banner')
            .getByRole('link', { name: /^DayTrack/ })
            .click();
        const today = (await request.get('/', { maxRedirects: 0 })).headers().location;
        expect(today).not.toContain(DATE);
        await expect(page).toHaveURL(today ?? '');
    });

    test('un objectif valide tapé dans les réglages part avant la page, sans demande de confirmation', async ({
        page,
        request,
    }) => {
        await page.goto('/reglages');
        page.on('dialog', () => {
            throw new Error('Une demande de confirmation est apparue.');
        });
        const saved = page.waitForRequest(
            (sent) => sent.url().endsWith('/habitual-objective') && sent.method() !== 'GET',
        );
        await page.getByRole('textbox', { name: 'Objectif habituel' }).fill('7h45');
        await page
            .getByRole('banner')
            .getByRole('link', { name: /^DayTrack/ })
            .click();
        await saved;
        const today = (await request.get('/', { maxRedirects: 0 })).headers().location;
        await expect(page).toHaveURL(today ?? '');
    });

    test('un objectif refusé dans les réglages retient le clic, comme le retour à la journée', async ({ page }) => {
        await page.goto('/reglages');
        const objective = page.getByRole('textbox', { name: 'Objectif habituel' });
        await objective.fill('99:99');
        await page
            .getByRole('banner')
            .getByRole('link', { name: /^DayTrack/ })
            .click();
        await expect(page).toHaveURL('/reglages');
    });
});

test.describe('le logo, une fenêtre ouverte', () => {
    test.use({ expectedErrors: [refusedWith(422)] });
    const TODAY = '2026-10-07';

    test.beforeEach(async ({ page }) => {
        await startTimeAt(page, TODAY, '10:00');
    });

    test("une fenêtre remplie s'enregistre avant de partir, et une fenêtre refusée retient", async ({
        page,
        request,
    }) => {
        const date = '2024-03-11';
        await clearDay(request, date);
        await page.goto(`/${date}`);
        const logo = page.getByRole('banner').getByRole('link', { name: /^DayTrack/ });

        await dragSlots(page, '09:00', '09:30');
        await page.keyboard.press('Enter');
        await ticketWindow(page).getByLabel('Ticket').fill('OPS-12');
        await logo.click();
        await expect(page).toHaveURL(`/${TODAY}`);
        expect((await savedDay(request, date)).map((block) => block.ticket)).toEqual(['OPS-12']);

        await page.goto(`/${date}`);
        await dragSlots(page, '10:00', '10:30');
        await page.keyboard.press('Enter');
        await ticketWindow(page).getByLabel('Ticket').fill('INCONNU-1');
        await logo.click();
        await expect(ticketWindow(page)).toBeVisible();
        await expect(page).toHaveURL(`/${date}`);
    });
});

test("l'icône de l'onglet se recharge quand le système change de thème", async ({ page, request }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(`/${DATE}`);
    const icon = page.locator('head link[rel="icon"][type="image/svg+xml"]');
    await expect(icon).toHaveAttribute('href', '/favicon.svg');

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(icon).toHaveAttribute('href', '/favicon.svg?theme=dark');
    expect((await request.get('/favicon.svg?theme=dark')).status()).toBe(200);

    await page.emulateMedia({ colorScheme: 'light' });
    await expect(icon).toHaveAttribute('href', '/favicon.svg?theme=light');
});
