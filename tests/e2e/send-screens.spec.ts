import type { Page } from '@playwright/test';

import { type Entry, startTimeAt, weekdaysFrom, writeDay } from './day';
import { expect, expectAccessible, expectScreen, test, THEMES, VIEWPORTS } from './fixtures';
import { SCENARIOS } from './scenarios';
import { clearSentDay, holdSend, rewriteSend, sendButton, sendWindow } from './send';

/**
 * Les écrans de l'envoi sur Jira : `envoi`, `envoi-cours`, `envoye`, `envoi-partiel`,
 * `envoi-en-partie`, `envoi-non-verifie`, `envoi-non-verifie-jeton`, `envoi-echec` et
 * `envoye-introuvable`,
 * sur les journées d'exemple. Chacun a sa capture de référence aux trois largeurs et
 * dans les deux thèmes, et son contrôle d'accessibilité. Les heures d'envoi sont des
 * heures d'exemple, servies à la page : aucun écran n'envoie rien. La gerbe de `fete` et
 * `fete-ferme`, tirée au hasard, n'a pas de capture : send.spec.ts vérifie qu'elle part,
 * et vers où.
 */

const BASE = SCENARIOS.find((scenario) => scenario.name === 'en-cours')?.entries ?? [];
const ATTEINT = SCENARIOS.find((scenario) => scenario.name === 'atteint')?.entries ?? [];

/** Le jour d'un écran : un jour de semaine d'octobre 2023, à l'écart des jours des autres fichiers. */
const workday = weekdaysFrom('2023-10-02');

interface Screen {
    readonly name: string;
    readonly entries: readonly Entry[];
    /** L'heure qu'il est, le jour même. */
    readonly now: string;
    /** Amène l'écran, la journée ouverte ; rend ce qui le défait une fois capturé. */
    readonly reach: (page: Page, date: string) => Promise<() => Promise<void>>;
}

const nothing = () => Promise.resolve();

const SCREENS: Screen[] = [
    {
        name: 'envoi',
        entries: BASE,
        now: '15:20',
        reach: async (page) => {
            await sendButton(page).click();
            await expect(sendWindow(page, 'Envoyer sur Jira')).toBeVisible();

            return nothing;
        },
    },
    {
        name: 'envoi-cours',
        entries: BASE,
        now: '15:20',
        reach: async (page, date) => {
            const release = await holdSend(page, date);
            await sendButton(page).click();
            await sendWindow(page, 'Envoyer sur Jira').getByRole('button', { name: 'Envoyer sur Jira' }).click();
            await expect(page.locator('.send-veil')).toBeVisible();
            await page.mouse.move(0, 0);

            return release;
        },
    },
    {
        name: 'envoye',
        entries: ATTEINT,
        now: '18:05',
        reach: async (page) => {
            await sendButton(page).click();
            await expect(sendWindow(page, 'Envoyé sur Jira')).toBeVisible();

            return nothing;
        },
    },
    {
        name: 'envoi-partiel',
        entries: BASE,
        now: '15:20',
        reach: async (page) => {
            await sendButton(page).click();
            await expect(sendWindow(page, 'Envoi partiel')).toBeVisible();

            return nothing;
        },
    },
    resultScreen('envoi-en-partie', 'Envoi partiel'),
    resultScreen('envoi-non-verifie', 'Envoi non vérifié'),
    resultScreen('envoi-echec', "Échec de l'envoi"),
];

/** Le jeton refusé : `envoi-non-verifie-jeton`, avec son bandeau. */
const REFUSED_SCREENS: Screen[] = [resultScreen('envoi-non-verifie-jeton', 'Envoi non vérifié')];

/** Un ticket retiré que Jira ne trouve plus : le détail de l'envoi le dit sous lui. */
const VANISHED_SCREENS: Screen[] = [
    {
        name: 'envoye-introuvable',
        entries: ATTEINT,
        now: '18:02',
        reach: async (page) => {
            await sendButton(page).click();
            await expect(sendWindow(page, 'Envoyé sur Jira')).toContainText('Jira ne trouve plus ce ticket.');

            return nothing;
        },
    },
];

/** Un écran qui montre la fenêtre du résultat, ouverte depuis le bouton. */
function resultScreen(name: string, title: string): Screen {
    return {
        name,
        entries: BASE,
        now: '15:20',
        reach: async (page) => {
            await sendButton(page).click();
            await expect(sendWindow(page, title)).toBeVisible();

            return nothing;
        },
    };
}

/** Ce que le serveur dirait de l'envoi de chaque écran, aux heures d'exemple. */
function served(screen: string, date: string): ((send: Record<string, unknown>) => Record<string, unknown>) | null {
    switch (screen) {
        case 'envoye':
            return (send) => ({ ...send, state: 'sent', sentAt: { date, time: '18:02' }, removed: [] });
        case 'envoye-introuvable':
            return (send) => ({
                ...send,
                state: 'sent',
                sentAt: { date, time: '18:02' },
                removed: ['OPS-7'],
                vanished: ['OPS-7'],
            });
        case 'envoi-partiel':
            return (send) => ({
                ...send,
                state: 'partial',
                attemptedAt: { date, time: '15:20' },
                outcomes: { 'SHOP-482': null, 'SHOP-501': null, 'OPS-12': null, 'SHOP-519': 'closed' },
                removed: [],
            });
        case 'envoi-en-partie':
            return (send) => ({
                ...send,
                state: 'partial',
                attemptedAt: { date, time: '15:20' },
                outcomes: {
                    'SHOP-482': 'unreachable',
                    'SHOP-501': null,
                    'OPS-12': null,
                    'SHOP-519': null,
                    'SHOP-377': null,
                },
                inJira: { 'SHOP-482': 105 },
                removed: ['SHOP-377'],
            });
        case 'envoi-non-verifie':
            return (send) => ({
                ...send,
                state: 'unverified',
                attemptedAt: { date, time: '15:20' },
                outcomes: {
                    'SHOP-482': 'unverified',
                    'SHOP-501': 'unverified',
                    'OPS-12': 'unverified',
                    'SHOP-519': 'closed',
                },
                removed: [],
            });
        case 'envoi-non-verifie-jeton':
            return (send) => ({
                ...send,
                state: 'unverified',
                attemptedAt: { date, time: '15:20' },
                failure: 'refused',
                outcomes: {
                    'SHOP-482': 'unverified',
                    'SHOP-501': 'unverified',
                    'OPS-12': 'unverified',
                    'SHOP-519': 'unverified',
                },
                removed: [],
            });
        case 'envoi-echec':
            return (send) => ({
                ...send,
                state: 'failed',
                attemptedAt: { date, time: '15:20' },
                failure: 'unreachable',
                removed: [],
            });
        default:
            return null;
    }
}

async function openAt(page: Page, date: string, now: string): Promise<void> {
    await startTimeAt(page, date, now);
    await page.addInitScript(() => {
        localStorage.setItem('daytrack.recap-open', 'true');
    });
    await page.goto(`/${date}`);
    await expect(page.getByRole('group', { name: 'Chiffres du jour' })).toBeVisible();
    // Sous 1280 px, le récapitulatif s'ouvre fermé : on l'ouvre par son bouton,
    // par-dessus la grille.
    if ((page.viewportSize()?.width ?? 1440) < 1280) {
        await page.getByRole('button', { name: 'Afficher le récapitulatif' }).click();
        await page.mouse.move(0, 0);
    }
}

function capture(screens: readonly Screen[], offset: number): void {
    screens.forEach((screen, s) => {
        VIEWPORTS.forEach((viewport, v) => {
            THEMES.forEach(({ scheme, name }, t) => {
                const date = workday(offset + s * 6 + v * 2 + t);

                test(`${screen.name}, ${String(viewport.width)} × ${String(viewport.height)}, ${name}`, async ({
                    page,
                    request,
                }, testInfo) => {
                    await clearSentDay(request, date);
                    await writeDay(request, date, screen.entries);
                    const rewrite = served(screen.name, date);
                    if (rewrite !== null) {
                        await rewriteSend(page, rewrite);
                    }
                    await page.setViewportSize(viewport);
                    await page.emulateMedia({ colorScheme: scheme });
                    await openAt(page, date, screen.now);

                    const undo = await screen.reach(page, date);
                    await expectScreen(page, testInfo, `${screen.name}-${String(viewport.width)}-${name}.png`);

                    if (viewport.width === 1440) {
                        await expectAccessible(page);
                    }

                    await undo();
                });
            });
        });
    });
}

test.describe('les écrans de l’envoi sur Jira', () => {
    capture(SCREENS, 0);
});

test.describe('les écrans de l’envoi sur Jira, le jeton refusé', () => {
    test.use({ jira: { state: 'refused' } });

    capture(REFUSED_SCREENS, SCREENS.length * 6);
});

test.describe('les écrans de l’envoi sur Jira, un ticket retiré introuvable', () => {
    capture(VANISHED_SCREENS, (SCREENS.length + REFUSED_SCREENS.length) * 6);
});
