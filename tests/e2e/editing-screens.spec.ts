import { writeDay } from './day';
import { EDITING_SCREENS, editingDay, openSampleDay } from './editing';
import { expectAccessible, expectScreen, test, THEMES, VIEWPORTS } from './fixtures';
import { SCENARIOS } from './scenarios';

/**
 * Les écrans de la saisie : `ajout`, `ajout-defile`, `edition`, `edition-pause`,
 * `edition-clavier`, `menu-nouveau`, `modifier-selection`, `selection`,
 * `selection-vide`, `annulation`, `objectif`, `remplacer` et `remplace`, amenés par leurs
 * gestes sur la journée d'exemple « en-cours », à 15:20. Chacun a sa capture de
 * référence aux trois largeurs et dans les deux thèmes, et son contrôle d'accessibilité.
 */

const ENTRIES = SCENARIOS[0]?.entries ?? [];

test.describe('les écrans de la saisie', () => {
    EDITING_SCREENS.forEach((screen, s) => {
        VIEWPORTS.forEach((viewport, v) => {
            THEMES.forEach(({ scheme, name }, t) => {
                const date = editingDay(s * 6 + v * 2 + t);

                test(`${screen.name}, ${String(viewport.width)} × ${String(viewport.height)}, ${name}`, async ({
                    page,
                    request,
                }, testInfo) => {
                    await writeDay(request, date, ENTRIES);
                    await page.setViewportSize(viewport);
                    await page.emulateMedia({ colorScheme: scheme });
                    await openSampleDay(page, date);

                    await screen.reach(page);
                    await expectScreen(page, testInfo, `${screen.name}-${String(viewport.width)}-${name}.png`);

                    if (viewport.width === 1440) {
                        await expectAccessible(page);
                    }
                });
            });
        });
    });
});
