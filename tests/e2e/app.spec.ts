import { expect, test, THEMES } from './fixtures';

test.describe('la page de l’application', () => {
    test('se sert en HTTPS, en français, ouverte sur aujourd’hui', async ({ page }) => {
        const response = await page.goto('/');

        expect(response?.status()).toBe(200);
        expect(page.url()).toMatch(/^https:\/\/[^/]+\/\d{4}-\d{2}-\d{2}$/);
        await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    });

    test('renvoie vers le HTTPS une adresse tapée sans « https:// »', async ({ page }) => {
        await page.goto('http://localhost:8443/2025-03-03');

        expect(page.url()).toBe('https://localhost:8443/2025-03-03');
        // La page qui suit la redirection est celle du serveur, que Jira y soit relié ou non.
        await expect(page.locator('#app')).toHaveAttribute('data-date', '2025-03-03');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    });

    for (const { scheme } of THEMES) {
        test(`suit le système en ${scheme === 'light' ? 'clair' : 'sombre'}`, async ({ page }) => {
            await page.emulateMedia({ colorScheme: scheme });
            await page.goto('/');

            await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
        });
    }

    test('suit le système qui change en cours de journée', async ({ page }) => {
        await page.emulateMedia({ colorScheme: 'light' });
        await page.goto('/');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

        await page.emulateMedia({ colorScheme: 'dark' });

        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    });

    test('pose le thème choisi avant le premier affichage, sans attendre le script', async ({ page }) => {
        await page.emulateMedia({ colorScheme: 'light' });
        await page.addInitScript(() => {
            localStorage.setItem('daytrack.theme', 'dark');
        });
        // Sans aucun script compilé — versionnés dans l'intégration continue, « app.3f2a….js » —,
        // seul celui du gabarit a pu poser le thème.
        await page.route(/\/build\/.*\.js$/, (route) => route.abort());
        page.removeAllListeners('console');

        await page.goto('/');

        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    });
});
