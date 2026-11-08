import type { Page } from '@playwright/test';

import { freezeTime, startTimeAt, weekdaysFrom, writeDay } from './day';
import { expect, expectAccessible, expectScreen, test, THEMES, VIEWPORTS } from './fixtures';
import { SCENARIOS } from './scenarios';
import { AVAILABLE, updateButton, updateWindow } from './version';

/**
 * Les écrans `maj`, `maj-copie` et `maj-refus` : le bouton du pied de colonne et sa
 * fenêtre, sur la journée d'exemple. Chacun a sa capture de référence aux trois
 * largeurs et dans les deux thèmes, et son contrôle d'accessibilité. L'heure ne s'arrête
 * que pour `maj-copie` : « Commandes copiées » ne part pas avant la capture. Arrêtée,
 * elle retiendrait aussi la fenêtre, qui ne se replacerait plus quand un message la
 * grandit.
 */
const BASE = SCENARIOS.find((scenario) => scenario.name === 'en-cours')?.entries ?? [];

/** Le jour d'un écran : un jour de semaine de mai 2023, avant ceux des autres fichiers. */
const workday = weekdaysFrom('2023-05-01');

interface Screen {
    readonly name: string;
    /** L'heure s'arrête. */
    readonly frozen?: boolean;
    /** Le navigateur refuse la copie. */
    readonly refused?: boolean;
    /** Ce qui l'amène, la fenêtre ouverte. */
    readonly reach: (page: Page) => Promise<void>;
}

const copy = (page: Page) => updateWindow(page).getByRole('button', { name: 'Copier les commandes' }).click();

const SCREENS: Screen[] = [
    { name: 'maj', reach: () => Promise.resolve() },
    {
        name: 'maj-copie',
        frozen: true,
        reach: async (page) => {
            await copy(page);
            await expect(updateWindow(page).getByRole('button', { name: 'Commandes copiées' })).toBeVisible();
        },
    },
    {
        name: 'maj-refus',
        refused: true,
        reach: async (page) => {
            await copy(page);
            await expect(updateWindow(page).getByText('Copie impossible')).toBeVisible();
        },
    },
];

test.use({ available: AVAILABLE, permissions: ['clipboard-read', 'clipboard-write'] });

test.describe('les écrans de la nouvelle version', () => {
    SCREENS.forEach((screen, s) => {
        VIEWPORTS.forEach((viewport, v) => {
            THEMES.forEach(({ scheme, name }, t) => {
                const date = workday(s * 6 + v * 2 + t);

                test(`${screen.name}, ${String(viewport.width)} × ${String(viewport.height)}, ${name}`, async ({
                    page,
                    request,
                }, testInfo) => {
                    await writeDay(request, date, BASE);
                    await page.setViewportSize(viewport);
                    await page.emulateMedia({ colorScheme: scheme });
                    await (screen.frozen === true ? freezeTime : startTimeAt)(page, date, '15:20');
                    await page.addInitScript((refused) => {
                        localStorage.setItem('daytrack.recap-open', 'true');
                        if (refused) {
                            navigator.clipboard.writeText = () => Promise.reject(new Error('Refusé'));
                        }
                    }, screen.refused === true);
                    await page.goto(`/${date}`);
                    await expect(page.getByRole('group', { name: 'Chiffres du jour' })).toBeVisible();
                    await updateButton(page).click();
                    await expect(updateWindow(page)).toBeVisible();
                    await screen.reach(page);
                    await page.mouse.move(0, 0);

                    await expectScreen(page, testInfo, `${screen.name}-${String(viewport.width)}-${name}.png`);

                    if (viewport.width === 1440) {
                        // Le contrôle a besoin que l'heure tourne.
                        if (screen.frozen === true) {
                            await page.clock.resume();
                        }
                        await expectAccessible(page);
                    }
                });
            });
        });
    });
});
