import { defineConfig, devices } from '@playwright/test';

/** Un contrôle, sur un commit, pas un parcours qu'on écrit. */
const CHECK = Boolean(process.env.CI);

/**
 * Les parcours dans un vrai navigateur, et les captures de référence.
 *
 * Ils tournent toujours dans le conteneur Linux de Playwright (compose.yaml,
 * service « playwright ») : une capture prise ailleurs ne se compare à rien.
 */
export default defineConfig({
    testDir: 'tests/e2e',
    globalSetup: './tests/e2e/global-setup.ts',
    snapshotPathTemplate: '{testDir}/{testFileName}-snapshots/{arg}{ext}',
    fullyParallel: true,
    forbidOnly: CHECK,
    // Une trace enregistrée sur chaque parcours coûte un quart de leur temps : un contrôle
    // ne l'enregistre qu'au rejeu d'un parcours en échec. Il reste rouge s'il passe alors :
    // un intermittent ne se cache pas. Et une régression massive ne se rejoue pas en entier.
    retries: CHECK ? 1 : 0,
    failOnFlakyTests: CHECK,
    maxFailures: CHECK ? 30 : 0,
    reporter: 'list',
    use: {
        baseURL: process.env.DAYTRACK_URL ?? 'https://localhost:8443',
        // Le certificat local de DayTrack : le navigateur du conteneur ne connaît pas
        // l'autorité qui l'a signé, et n'a pas à la connaître.
        ignoreHTTPSErrors: true,
        locale: 'fr-FR',
        timezoneId: 'Europe/Paris',
        trace: CHECK ? 'on-first-retry' : 'retain-on-failure',
    },
    expect: {
        toHaveScreenshot: {
            animations: 'disabled',
            caret: 'hide',
            // L'écart de couleur toléré par pixel. Celui de Playwright, 0,2, laissait passer
            // un texte passé de --ink-3 à --ink-2, dans les deux thèmes : un mot changé de
            // gris touche une centaine de pixels. Les coins arrondis d'un cadre ou d'une
            // ombre varient, eux, de quelques pixels d'une prise à l'autre.
            threshold: 0.05,
            maxDiffPixels: 30,
        },
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
