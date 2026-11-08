import type { Locator, Page, Request } from '@playwright/test';

import { addDays, daysFrom, freezeTime, weekday, writeDay } from './day';
import { blocks, figures, glideTo, slot } from './editing';
import { expect, expectAccessible, expectScreen, OPEN_TOOLTIP, test, THEMES, VIEWPORTS } from './fixtures';
import { type Scenario, SCENARIOS } from './scenarios';

/**
 * L'écran Journée, en lecture : la barre et ses chiffres, la grille, le récapitulatif.
 * Chaque parcours prend un jour de 2025 à lui (tests/e2e/day.ts) ; deux états de
 * l'écran, des jours de 2023 (scenarioDate).
 */

const RECAP_KEY = 'daytrack.recap-open';

/** Un quart d'heure de la grille, --h-row. */
const ROW = 28;

/**
 * Le jour d'un parcours : `index` jours après le lundi 3 mars 2025. Un samedi ou un
 * dimanche est fermé à la saisie, sans objectif : un parcours qui lit les chiffres d'une
 * journée ordinaire, ou qui y saisit, prend un jour de semaine.
 */
const day = daysFrom('2025-03-03');

async function rememberRecap(page: Page, open: boolean): Promise<void> {
    await page.addInitScript(
        ([key, value]) => {
            localStorage.setItem(key, value);
        },
        [RECAP_KEY, String(open)] as const,
    );
}

/**
 * Le jour d'un scénario, à lui seul : un jour de semaine à chacun à partir du lundi 3
 * mars 2025 ; un samedi à partir du 8 pour un jour non travaillé. Deux autres prennent
 * des jours de 2023 à eux : un vendredi à partir du 3 mars, d'où « Jour
 * suivant » mène au lundi ; un jour de semaine de juin à partir du 5, d'où le calendrier
 * passe en juillet, le dernier mois qui s'ouvre, et qui a six semaines, le plus haut des
 * calendriers. Ceux du jour mis à 0h00 prennent des jours de semaine de 2021, que
 * personne d'autre n'écrit.
 */
function scenarioDate(scenario: Scenario, s: number, variant: number): string {
    if (scenario.offDay === true) {
        return addDays(day(5), 7 * variant);
    }
    if (scenario.declared === true || scenario.gesture === 'objective-zero') {
        return weekday('2021-03-01', s * 6 + variant);
    }
    if (scenario.gesture === 'next-day-tip') {
        return addDays('2023-03-03', 7 * variant);
    }
    if (scenario.gesture === 'month-limit') {
        return weekday('2023-06-05', variant);
    }

    return weekday(day(0), s * 6 + variant);
}

test.describe('les états de l’écran', () => {
    SCENARIOS.forEach((scenario, s) => {
        VIEWPORTS.forEach((viewport, v) => {
            THEMES.forEach(({ scheme, name }, t) => {
                const date = scenarioDate(scenario, s, v * 2 + t);
                // Un jour passé se regarde quelques jours plus tard, un jour de semaine :
                // du vendredi 2 au mardi 6 octobre, du samedi 3 aussi. Un jour à venir, trois
                // jours de semaine plus tôt : du mardi 6 au vendredi 9.
                const today =
                    scenario.future === true
                        ? weekday(date, -3)
                        : scenario.now === null
                          ? weekday(addDays(date, 1), 1)
                          : date;

                test(`${scenario.name}, ${String(viewport.width)} × ${String(viewport.height)}, ${name}`, async ({
                    page,
                    request,
                }, testInfo) => {
                    await writeDay(request, date, scenario.entries, scenario.declared === true ? 0 : undefined);
                    if (scenario.declared === true) {
                        // Le calendrier ne lit aucun des jours mis à 0h00 par d'autres parcours :
                        // seul celui-ci est grisé.
                        await page.route('**/api/calendar/**', async (route) => {
                            const response = await route.fetch();
                            await route.fulfill({
                                response,
                                json: { ...((await response.json()) as object), marks: {}, daysOff: [date] },
                            });
                        });
                    }
                    await freezeTime(page, today, scenario.now ?? '10:00');
                    await rememberRecap(page, scenario.recap === 'open');
                    await page.setViewportSize(viewport);
                    await page.emulateMedia({ colorScheme: scheme });

                    await page.goto(`/${date}`);
                    await expect(figures(page)).toBeVisible();
                    if (scenario.gesture === 'month-limit') {
                        // Le calendrier passe au mois suivant, le dernier qui s'ouvre, sans
                        // changer de jour.
                        const nextMonth = page.getByRole('button', { name: 'Mois suivant' });
                        await nextMonth.click();
                        await expect(nextMonth).toHaveAttribute('aria-disabled', 'true');
                    }
                    // Sous 1280 px, le récapitulatif s'ouvre fermé, quoi qu'on ait retenu : on
                    // l'ouvre par son bouton, par-dessus la grille, et la souris s'en va.
                    if (scenario.recap === 'open' && viewport.width < 1280) {
                        await page.getByRole('button', { name: 'Afficher le récapitulatif' }).click();
                        await page.mouse.move(0, 0);
                        await expect(page.getByRole('complementary', { name: 'Récapitulatif' })).toHaveAttribute(
                            'data-state',
                            'open',
                        );
                    }
                    // L'infobulle d'une flèche, ouverte au survol : le lundi qui suit le
                    // vendredi, le mois d'avant le dernier.
                    const monday = addDays(date, 3);
                    const tips = {
                        'next-day-tip': [
                            'Jour suivant',
                            `Lundi ${String(Number(monday.slice(8)))} ${monday.slice(5, 7) === '03' ? 'mars' : 'avril'}`,
                        ],
                        'month-limit': ['Mois précédent', 'Juin 2023'],
                    } as const;
                    if (scenario.gesture === 'objective-zero') {
                        // La durée tapée, pas encore enregistrée : la fenêtre dit ce qu'elle fera.
                        await page.getByRole('button', { name: /^Objectif du jour/ }).click();
                        const window = page.getByRole('dialog', { name: 'Objectif du jour' });
                        await window.getByLabel('Durée à travailler').fill('0h00');
                        await expect(window).toContainText('Jour non travaillé. Les autres jours gardent');
                    } else if (scenario.gesture !== undefined) {
                        const [arrow, tip] = tips[scenario.gesture];
                        await page.getByRole('button', { name: arrow }).hover();
                        await page.clock.runFor(450);
                        await expect(page.getByRole('tooltip')).toHaveText(tip);
                        // Le fondu se termine avant la capture : sur une machine chargée, il
                        // démarrait parfois après qu'elle avait figé les animations, et
                        // l'infobulle s'y voyait à moitié transparente.
                        await page.locator('.tip-motion').evaluate((node) => {
                            for (const animation of node.getAnimations()) {
                                animation.finish();
                            }
                        });
                    }

                    await expectScreen(page, testInfo, `${scenario.name}-${String(viewport.width)}-${name}.png`);

                    if (viewport.width === 1440) {
                        // axe attend ses propres minuteurs : l'heure doit de nouveau tourner.
                        // L'infobulle ouverte d'une flèche se pose à la racine de la page, hors
                        // des repères, comme toute infobulle.
                        await page.clock.resume();
                        await expectAccessible(page, { exclude: [OPEN_TOOLTIP] });
                    }
                });
            });
        });
    });
});

test.describe('la ligne des chiffres', () => {
    const cases = [
        {
            what: 'en cours : le reste et la fin prévue',
            entries: SCENARIOS[0]?.entries ?? [],
            today: '15:20',
            text: ['5h00', '/', '7h30', 'Reste 2h30', 'Fin prévue à 17:45'],
        },
        {
            what: 'vide : tout reste à faire, sans fin prévue',
            entries: [],
            today: '08:40',
            text: ['0h00', 'Reste 7h30'],
            noEnd: true,
        },
        {
            what: 'atteint : la coche, sans reste',
            entries: SCENARIOS[4]?.entries ?? [],
            today: '17:50',
            text: ['7h30', 'Objectif atteint'],
        },
        {
            what: 'dépassé : le solde',
            entries: SCENARIOS[5]?.entries ?? [],
            today: '18:40',
            text: ['8h15', 'Solde +0h45'],
        },
        {
            what: 'jour passé : le solde négatif',
            entries: SCENARIOS[6]?.entries ?? [],
            past: true,
            text: ['6h45', 'Solde −0h45'],
        },
        { what: 'jour passé vide : tout le solde', entries: [], past: true, text: ['0h00', 'Solde −7h30'] },
        { what: 'jour à venir : le reste, sans fin prévue', entries: [], future: true, text: ['0h00', 'Reste 7h30'] },
    ];

    cases.forEach(({ what, entries, today, past, future, text, noEnd }, index) => {
        test(what, async ({ page, request }) => {
            const date = weekday(day(60), index);
            await writeDay(request, date, entries);
            const shift = past === true ? 3 : future === true ? -3 : 0;
            await freezeTime(page, weekday(date, shift), today ?? '10:00');

            await page.goto(`/${date}`);

            const line = figures(page);
            for (const fragment of text) {
                await expect(line).toContainText(fragment);
            }
            if (today === undefined || noEnd === true) {
                await expect(line).not.toContainText('Fin prévue');
            }
            if (today === undefined) {
                await expect(page.locator('.now-line')).toHaveCount(0);
            }
        });
    });
});

test.describe('les infobulles', () => {
    test('disent où mènent les flèches au survol après 400 ms, en fondu, sous elles, sans « title »', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        // L'heure ne passe qu'à la main : celle qui s'écoulerait entre deux lignes compterait dans les 400 ms.
        await freezeTime(page, day(165), '10:00');
        // Le lundi 11 août 2025 : « Jour précédent » mène au vendredi, par-dessus le week-end.
        await page.goto(`/${day(161)}`);
        const tooltip = page.getByRole('tooltip');
        const bubble = page.locator('[data-side][data-state$="-open"]');
        const previous = page.getByRole('button', { name: 'Jour précédent' });
        await expect(previous).toBeVisible();
        expect(await page.locator('[title]').count()).toBe(0);

        await previous.hover();
        await page.clock.runFor(350);
        await expect(tooltip).toHaveCount(0);
        await page.clock.runFor(100);
        await expect(tooltip).toHaveText('Vendredi 8 août');
        // Le nom du bouton ne change pas : l'infobulle s'ajoute à sa description.
        await expect(previous).toHaveAccessibleName('Jour précédent');
        await expect(previous).toHaveAccessibleDescription('Vendredi 8 août');
        const button = await previous.boundingBox();
        const box = await bubble.boundingBox();
        expect((box?.y ?? 0) > (button?.y ?? 0) + (button?.height ?? 0)).toBe(true);
        await expect(bubble).toHaveCSS('animation-name', 'tip-in');
        await expect(bubble).toHaveCSS('animation-duration', '0.12s');
    });

    test('passent d’un bouton à son voisin d’un coup, s’ouvrent au clavier, pas après un clic', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        // Le jeudi 14 août 2025.
        await page.goto(`/${day(164)}`);
        const tooltip = page.getByRole('tooltip');
        const previous = page.getByRole('button', { name: 'Jour précédent' });

        await previous.hover();
        await expect(tooltip).toHaveText('Mercredi 13 août');
        // Vers la voisine : tout de suite, sans transition ; celle d'avant s'efface.
        await glideTo(
            page,
            page.getByRole('button', { name: 'Jour suivant' }),
            tooltip.filter({ hasText: 'Vendredi 15 août' }),
        );
        const next = page.locator('[data-side][data-state="instant-open"]');
        await expect(next).toHaveText('Vendredi 15 août');
        await expect(next).toHaveCSS('animation-name', 'none');
        await page.mouse.move(700, 700, { steps: 5 });
        await expect(tooltip).toHaveCount(0);

        // Au clavier, dès le focus ; Échap la ferme.
        await page.getByRole('button', { name: "Aujourd'hui", exact: true }).focus();
        await page.keyboard.press('Tab');
        await expect(previous).toBeFocused();
        await expect(tooltip).toHaveText('Mercredi 13 août');
        await page.keyboard.press('Escape');
        await expect(tooltip).toHaveCount(0);

        // Un clic qui rend le focus à un bouton n'ouvre rien.
        await page.getByRole('button', { name: 'Masquer le récapitulatif' }).click();
        await expect(page.getByRole('button', { name: 'Afficher le récapitulatif' })).toBeFocused();
        await page.waitForTimeout(600);
        await expect(tooltip).toHaveCount(0);
    });

    test('dit qu’on modifie l’objectif, et se tait tant que sa fenêtre est ouverte', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.clock.install();
        await page.goto(`/${day(162)}`);
        const objective = page.getByRole('button', { name: /^Objectif du jour/ });
        const objectiveWindow = page.getByRole('dialog', { name: 'Objectif du jour' });
        const tooltip = page.getByRole('tooltip');

        await objective.hover();
        await page.clock.runFor(450);
        await expect(tooltip).toHaveText("Modifier l'objectif du jour");
        await objective.click();
        await expect(objectiveWindow).toBeVisible();
        await page.clock.runFor(1000);
        await expect(tooltip).toHaveCount(0);

        // Survolé de nouveau pendant ce temps, il ne garde rien pour après : la fenêtre
        // fermée par « Annuler », aucune infobulle ne s'ouvre d'elle-même.
        await page.mouse.move(0, 0, { steps: 5 });
        await objective.hover();
        await page.clock.runFor(450);
        await expect(tooltip).toHaveCount(0);
        await objectiveWindow.getByRole('button', { name: 'Annuler' }).click();
        await expect(objectiveWindow).toHaveCount(0);
        await page.clock.runFor(450);
        await page.waitForTimeout(200);
        await expect(tooltip).toHaveCount(0);
    });

    test('apparaît sans transition quand le système demande moins de mouvement', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.clock.install();
        await page.goto(`/${day(163)}`);

        await page.getByRole('button', { name: 'Jour précédent' }).hover();
        await page.clock.runFor(450);
        await expect(page.getByRole('tooltip')).toHaveText('Mardi 12 août');
        await expect(page.locator('[data-side][data-state$="-open"]')).toHaveCSS('animation-duration', '0s');
    });
});

test.describe('la navigation entre les jours', () => {
    test('les flèches changent de jour et l’écrivent dans l’adresse, le navigateur y ramène', async ({
        page,
        request,
    }) => {
        const date = day(80);
        await writeDay(request, date, [{ start: '09:00', end: '10:00', ticket: 'SHOP-482', comment: 'Revue' }]);
        await freezeTime(page, day(82), '10:00');
        await page.goto(`/${date}`);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(80));
        await expect(blocks(page)).toHaveCount(1);

        await page.getByRole('button', { name: 'Jour suivant' }).click();
        await expect(page).toHaveURL(`/${day(81)}`);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(81));
        await expect(figures(page)).toContainText('Solde −7h30');
        await expect(blocks(page)).toHaveCount(0);

        await page.getByRole('button', { name: 'Jour précédent' }).click();
        await page.getByRole('button', { name: 'Jour précédent' }).click();
        await expect(page).toHaveURL(`/${day(79)}`);

        await page.goBack();
        await expect(page).toHaveURL(`/${date}`);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(80));
        await expect(blocks(page)).toHaveCount(1);

        await page.getByRole('button', { name: "Aujourd'hui", exact: true }).click();
        await expect(page).toHaveURL(`/${day(82)}`);
        await expect(page.locator('.now-line')).toHaveCount(1);
    });

    test('Précédent et Suivant du navigateur repassent par les jours visités, l’adresse avec l’écran', async ({
        page,
    }) => {
        // Du lundi 18 au mercredi 20 août 2025.
        await freezeTime(page, day(170), '10:00');
        await page.goto(`/${day(168)}`);
        const title = page.getByRole('heading', { level: 1 });
        await expect(figures(page)).toBeVisible();
        for (const index of [169, 170]) {
            await page.getByRole('button', { name: 'Jour suivant' }).click();
            await expect(title).toHaveText(titleOf(index));
        }

        for (const index of [169, 168]) {
            await page.goBack();
            await expect(page).toHaveURL(`/${day(index)}`);
            await expect(title).toHaveText(titleOf(index));
            await expect(figures(page)).toBeVisible();
        }
        for (const index of [169, 170]) {
            await page.goForward();
            await expect(page).toHaveURL(`/${day(index)}`);
            await expect(title).toHaveText(titleOf(index));
            await expect(figures(page)).toBeVisible();
        }
        await expect(page.getByRole('button', { name: /, jour affiché/ })).toHaveAccessibleName(
            /^20 août, .*jour affiché/,
        );
    });

    test('une adresse tapée ouvre son jour, et une date impossible ramène à aujourd’hui', async ({ page }) => {
        await freezeTime(page, day(170), '10:00');
        await page.goto(`/${day(169)}`);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(169));

        // Aujourd'hui est celui du serveur : l'heure de la page est arrêtée en 2025.
        for (const typed of ['/2025-02-30', '/2025-8-19', '/2025-08-19x']) {
            await page.goto(typed);
            await expect(page).toHaveURL(/\/\d{4}-\d{2}-\d{2}$/);
            const today = new URL(page.url()).pathname.slice(1);
            expect(today).not.toBe(typed.slice(1));
            await expect(page.locator('#app')).toHaveAttribute('data-date', today);
            await expect(page.getByRole('group', { name: 'Chiffres du jour' })).toBeVisible();
        }
    });

    test('une date impossible retrouvée par Précédent recharge la page, que le serveur ramène à aujourd’hui', async ({
        page,
    }) => {
        await freezeTime(page, day(170), '10:00');
        await page.goto(`/${day(168)}`);
        await expect(figures(page)).toBeVisible();
        await page.evaluate((shown) => {
            history.pushState(null, '', '/2025-02-30');
            history.pushState(null, '', `/${shown}`);
        }, day(168));

        const reloaded = page.waitForEvent('load');
        await page.goBack();
        await reloaded;
        await expect(page).toHaveURL(/\/\d{4}-\d{2}-\d{2}$/);
        expect(page.url()).not.toContain('2025-02-30');
        await expect(page.locator('#app')).toHaveAttribute('data-date', new URL(page.url()).pathname.slice(1));
        await expect(figures(page)).toBeVisible();
    });

    test('une ancre ajoutée à l’adresse ne change pas de jour, et laisse la journée affichée', async ({ page }) => {
        // L'heure tourne : la page attend un instant après l'ancre.
        await page.goto(`/${day(169)}`);
        await expect(figures(page)).toBeVisible();

        await page.evaluate(
            () =>
                new Promise<void>((resolve) => {
                    window.addEventListener(
                        'popstate',
                        () => {
                            window.setTimeout(resolve, 100);
                        },
                        { once: true },
                    );
                    window.location.hash = 'ailleurs';
                }),
        );

        await expect(page).toHaveURL(`/${day(169)}#ailleurs`);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(169));
        await expect(figures(page)).toBeVisible();
        await page.getByRole('button', { name: 'Jour suivant' }).click();
        await expect(page).toHaveURL(`/${day(170)}`);
        await expect(figures(page)).toBeVisible();
    });

    test('au clavier aussi', async ({ page }) => {
        await freezeTime(page, day(85), '10:00');
        await page.goto(`/${day(85)}`);
        await expect(figures(page)).toBeVisible();

        await page.getByRole('button', { name: "Aujourd'hui", exact: true }).focus();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(`/${day(84)}`);
        await page.keyboard.press('Tab');
        await page.keyboard.press('Space');
        await expect(page).toHaveURL(`/${day(85)}`);
    });

    test('on ne va pas plus loin que trente jours devant', async ({ page }) => {
        await freezeTime(page, day(90), '10:00');
        await page.goto(`/${day(119)}`);
        await expect(figures(page)).toContainText('Reste 7h30');

        const next = page.getByRole('button', { name: 'Jour suivant' });
        await next.click();
        await expect(page).toHaveURL(`/${day(120)}`);
        await expect(next).toHaveAttribute('aria-disabled', 'true');

        // « force » : Playwright refuse de cliquer un bouton indisponible.
        await next.click({ force: true });
        await next.press('Enter');
        await expect(page).toHaveURL(`/${day(120)}`);
        await expect(next).toBeFocused();
    });

    test('parcourir des jours n’écrit rien', async ({ page }) => {
        const writes: Request[] = [];
        page.on('request', (sent) => {
            // La vérification du jeton et la relecture des titres demandent à Jira ce
            // qu'il sait : elles ne touchent à aucune journée.
            const jira = /\/api\/(jira\/check|tickets\/refresh)$/.test(new URL(sent.url()).pathname);
            if (sent.method() !== 'GET' && !jira) {
                writes.push(sent);
            }
        });
        await freezeTime(page, day(95), '10:00');
        await page.goto(`/${day(95)}`);

        for (const name of ['Jour précédent', 'Jour précédent', 'Jour suivant', 'Jour suivant', 'Jour suivant']) {
            await page.getByRole('button', { name }).click();
            await expect(figures(page)).toBeVisible();
        }
        await page.getByRole('button', { name: "Aujourd'hui", exact: true }).click();
        await expect(page).toHaveURL(`/${day(95)}`);

        expect(writes.map((sent) => `${sent.method()} ${sent.url()}`)).toEqual([]);
    });

    test('une réponse arrivée après un changement de jour ne s’affiche pas', async ({ page, request }) => {
        const slow = day(100);
        const shown = day(101);
        await writeDay(request, slow, [{ start: '09:00', end: '12:00', ticket: 'SHOP-519', comment: 'Lente' }]);
        await writeDay(request, shown, [{ start: '14:00', end: '15:00', ticket: 'OPS-12', comment: 'Affichée' }]);
        await freezeTime(page, shown, '10:00');

        let release: () => void = () => undefined;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        await page.route(`**/api/days/${slow}`, async (route) => {
            await held;
            await route.continue();
        });

        await page.goto(`/${slow}`);
        await page.getByRole('button', { name: 'Jour suivant' }).click();
        await expect(blocks(page)).toHaveText([/OPS-12.*Affichée/]);
        release();
        await page.waitForTimeout(200);

        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(101));
        await expect(blocks(page)).toHaveText([/OPS-12.*Affichée/]);
    });

    test('revenir sur un jour avant que l’autre soit lu ne remontre pas l’ancienne journée', async ({
        page,
        request,
    }) => {
        const first = day(98);
        const second = day(99);
        await writeDay(request, first, [{ start: '09:00', end: '10:00', ticket: 'SHOP-482', comment: 'Premier' }]);
        await freezeTime(page, second, '10:00');

        // La première lecture de chaque jour passe ; les suivantes attendent.
        let release: () => void = () => undefined;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const reads = new Map<string, number>();
        await page.route(/\/api\/days\/\d{4}-\d{2}-\d{2}$/, async (route) => {
            const date = route.request().url().slice(-10);
            reads.set(date, (reads.get(date) ?? 0) + 1);
            if (date === second || (reads.get(date) ?? 0) > 1) {
                await held;
            }
            await route.continue();
        });

        await page.goto(`/${first}`);
        await expect(blocks(page)).toHaveCount(1);
        await page.getByRole('button', { name: 'Jour suivant' }).click();
        await page.getByRole('button', { name: 'Jour précédent' }).click();

        // La journée d'avant s'est fermée en partant : on attend sa relecture.
        const grid = page.getByRole('region', { name: 'Grille de la journée' });
        await expect(grid).toHaveAttribute('aria-busy', 'true');
        await expect(blocks(page)).toHaveCount(0);

        release();
        await expect(grid).toHaveAttribute('aria-busy', 'false');
        await expect(blocks(page)).toHaveText([/SHOP-482.*Premier/]);
    });

    test('une journée qui ne se lit pas le dit, sans rien afficher d’autre', async ({ page }) => {
        await freezeTime(page, day(105), '10:00');
        await page.route(`**/api/days/${day(105)}`, (route) => route.fulfill({ status: 500, body: '' }));
        page.removeAllListeners('console');

        await page.goto(`/${day(105)}`);

        const alert = page.getByRole('alert');
        await expect(alert).toHaveText('Cette journée ne se lit pas. Rechargez la page.');
        await expect(figures(page)).toHaveCount(0);
        await expect(blocks(page)).toHaveCount(0);
        await expect(page.getByRole('region', { name: 'Grille de la journée' })).toHaveAttribute('aria-busy', 'false');
        // Comme partout, une erreur passe son texte en rouge, avec son icône.
        expect(await alert.evaluate((element) => getComputedStyle(element).color)).toBe(
            await page.evaluate(() => {
                const probe = document.createElement('i');
                probe.style.color = 'var(--inc)';
                document.body.append(probe);

                return getComputedStyle(probe).color;
            }),
        );
        await expect(alert.locator('svg')).toBeVisible();
    });
});

test.describe('les blocs', () => {
    test('un long commentaire revient à la ligne dans un bloc de plusieurs lignes, et se coupe sur une ligne', async ({
        page,
        request,
    }) => {
        const date = day(160);
        const long = 'Revue de code du module de facturation et des exports des commandes filtrées. '.repeat(5).trim();
        // ESSAI-1 et ESSAI-2, que Jira ne décrit pas : le commentaire prend la place du titre.
        await writeDay(request, date, [
            { start: '09:00', end: '09:45', ticket: 'ESSAI-1', comment: long },
            { start: '10:00', end: '10:15', ticket: 'ESSAI-2', comment: long },
            { start: '11:00', end: '11:45', ticket: 'SHOP-482', comment: long },
            { start: '12:00', end: '12:15', ticket: 'SHOP-519', comment: long },
        ]);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`/${date}`);
        const block = (ticket: string) => blocks(page).filter({ hasText: ticket });
        const comment = (ticket: string) => block(ticket).getByText(long, { exact: true });
        const clipped = (locator: Locator) =>
            locator.evaluate((node) => node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth);

        // Trois quarts d'heure, trois lignes d'un quart d'heure chacune, alignées sur le
        // début du commentaire, à droite de l'identifiant ; le reste se coupe.
        const wrapped = comment('ESSAI-1');
        const box = await wrapped.boundingBox();
        const id = await block('ESSAI-1').getByText('ESSAI-1', { exact: true }).boundingBox();
        expect(box?.height).toBe(3 * ROW);
        expect((box?.x ?? 0) >= (id?.x ?? 0) + (id?.width ?? 0)).toBe(true);
        await expect(wrapped).toHaveCSS('-webkit-line-clamp', '3');
        expect(await clipped(wrapped)).toBe(true);

        // Un quart d'heure : une ligne, et des points de suspension.
        const single = comment('ESSAI-2');
        await expect(single).toHaveCSS('white-space', 'nowrap');
        await expect(single).toHaveCSS('text-overflow', 'ellipsis');
        expect(await clipped(single)).toBe(true);

        // Avec le titre venu de Jira : il prend la première ligne, le commentaire les
        // suivantes, une par quart d'heure.
        const title = block('SHOP-482').getByText('Export CSV des commandes filtrées par période et par statut', {
            exact: true,
        });
        const titled = comment('SHOP-482');
        const titleBox = await title.boundingBox();
        const titledBox = await titled.boundingBox();
        expect(titledBox?.height).toBe(2 * ROW);
        expect((titledBox?.y ?? 0) >= (titleBox?.y ?? 0) + (titleBox?.height ?? 0)).toBe(true);
        expect(titledBox?.x).toBe(titleBox?.x);
        await expect(titled).toHaveCSS('-webkit-line-clamp', '2');

        // Sur une ligne, le commentaire suit le titre, en --ink-3, et se coupe le premier.
        const after = comment('SHOP-519');
        await expect(after).toHaveCSS('text-overflow', 'ellipsis');
        expect(await clipped(after)).toBe(true);
        await expect(block('SHOP-519').getByText(/^Le total du panier/)).toBeVisible();

        // Chaque ligne est centrée sur son quart d'heure, au pixel près : sans titre, le
        // commentaire dès le premier ; avec, le titre, puis le commentaire.
        const middleOf = async (time: string) => {
            const quarter = await slot(page, time).boundingBox();

            return (quarter?.y ?? 0) + (quarter?.height ?? 0) / 2;
        };
        const lineMiddles = (locator: Locator) =>
            locator.evaluate((node) => {
                const range = document.createRange();
                range.selectNodeContents(node);

                return [...range.getClientRects()].map((rect) => rect.y + rect.height / 2);
            });
        const expectCentered = async (locator: Locator, times: readonly string[]) => {
            const middles = await lineMiddles(locator);
            for (const [line, time] of times.entries()) {
                expect(Math.abs((middles[line] ?? Infinity) - (await middleOf(time)))).toBeLessThanOrEqual(1);
            }
        };
        await expectCentered(wrapped, ['09:00', '09:15', '09:30']);
        await expectCentered(title, ['11:00']);
        await expectCentered(titled, ['11:15', '11:30']);
    });
});

test.describe('la journée vide', () => {
    /** La position d'une heure dans la page : le trait de la grille où elle commence. */
    const lineOf = async (page: Page, hour: string) => {
        const label = await page.getByText(hour, { exact: true }).boundingBox();

        return (label?.y ?? 0) + (label?.height ?? 0) / 2;
    };
    const hint = (page: Page) => page.getByText('Aucun ticket pour ce jour', { exact: true });
    const hintTop = async (page: Page) => (await hint(page).boundingBox())?.y ?? 0;

    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
    });

    test('un autre jour, le message commence à 08:15, sous l’heure d’ouverture de la grille', async ({ page }) => {
        await freezeTime(page, day(152), '16:00');
        await page.goto(`/${day(151)}`);
        await expect(hint(page)).toBeVisible();

        expect(await hintTop(page)).toBeCloseTo((await lineOf(page, '08:00')) + ROW, 0);
    });

    test('en fin de journée, il est en haut de ce qu’on voit, pas sous la ligne de l’heure', async ({ page }) => {
        await freezeTime(page, day(150), '18:20');
        await page.goto(`/${day(150)}`);
        await expect(hint(page)).toBeVisible();

        // La grille s'ouvre sur 12:00 (une heure au moins après « maintenant ») : le
        // message prend 12:15, loin au-dessus de la ligne de 18:20.
        expect(await hintTop(page)).toBeCloseTo((await lineOf(page, '13:00')) - 3 * ROW, 0);
    });

    test('si la ligne de l’heure passe dans le message, il descend au quart d’heure qui la suit', async ({ page }) => {
        await freezeTime(page, day(154), '07:20');
        await page.goto(`/${day(154)}`);
        await expect(hint(page)).toBeVisible();

        // Vue ouverte sur 07:00 : 07:15 sans la ligne, 07:30 avec elle.
        expect(await hintTop(page)).toBeCloseTo((await lineOf(page, '08:00')) - 2 * ROW, 0);

        await page.clock.runFor(15 * 60_000);
        expect(await hintTop(page)).toBeCloseTo((await lineOf(page, '08:00')) - ROW, 0);
    });

    test('il défile avec la grille, et se replace en changeant de jour', async ({ page }) => {
        await freezeTime(page, day(157), '16:00');
        await page.goto(`/${day(155)}`);
        await expect(hint(page)).toBeVisible();
        const scroller = page.getByRole('region', { name: 'Grille de la journée' });

        await scroller.evaluate((element) => {
            element.scrollTop = 348;
        });
        // Toujours à 08:15 dans la grille : sa place ne suit pas le défilement.
        await expect.poll(async () => (await hintTop(page)) - (await lineOf(page, '08:00'))).toBeCloseTo(ROW, 0);

        await page.getByRole('button', { name: 'Jour suivant' }).click();
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(156));
        // 348 px de défilement, la marge et trois heures : la vue commence pile à 10:00, le
        // message prend 10:15.
        await expect.poll(async () => (await hintTop(page)) - (await lineOf(page, '10:00'))).toBeCloseTo(ROW, 0);
    });
});

test.describe('l’heure qui tourne', () => {
    test('la ligne « maintenant » et la fin prévue suivent l’heure', async ({ page, request }) => {
        const date = day(109);
        await writeDay(request, date, SCENARIOS[0]?.entries ?? []);
        // 2h30 à faire depuis le début du créneau en cours : 17:45 jusqu'à 15:29, puis
        // 18:00 à 15:30, le créneau 15:15 resté vide passé.
        await freezeTime(page, date, '15:29');
        await page.goto(`/${date}`);
        await expect(figures(page)).toContainText('Fin prévue à 17:45');
        const line = page.locator('.now-line');
        const before = await line.boundingBox();

        await page.clock.runFor(60_000);

        await expect(figures(page)).toContainText('Fin prévue à 18:00');
        const after = await line.boundingBox();
        expect((after?.y ?? 0) - (before?.y ?? 0)).toBeCloseTo(ROW / 15, 1);
    });

    test('à minuit, la journée devient un jour passé', async ({ page }) => {
        const date = day(112);
        await freezeTime(page, date, '23:58');
        await page.goto(`/${date}`);
        await expect(figures(page)).toContainText('Reste 7h30');

        await page.clock.runFor(3 * 60_000);

        await expect(figures(page)).toContainText('Solde −7h30');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(112));
        await page.getByRole('button', { name: "Aujourd'hui", exact: true }).click();
        await expect(page).toHaveURL(`/${day(113)}`);
    });
});

test.describe('le récapitulatif', () => {
    test('un ticket par carte, du plus long au plus court, avec ses commentaires', async ({ page, request }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const date = day(130);
        await writeDay(request, date, SCENARIOS[0]?.entries ?? []);
        await freezeTime(page, date, '15:20');
        await page.goto(`/${date}`);

        const cards = page.getByRole('complementary', { name: 'Récapitulatif' }).getByRole('listitem');
        await expect(cards).toHaveText([
            /^SHOP-482.*2h30.*Mapping des colonnes.*1h45.*Tests.*0h45$/,
            /^SHOP-501.*1h15Relance automatique des paniers abandonnés$/,
            /^OPS-12.*0h45.*Daily.*0h15.*Poker planning.*0h30$/,
            /^SHOP-519.*0h30.*Reproduction.*0h30$/,
        ]);
    });

    test('ouvert à partir de 1440 px, fermé en dessous, puis retenu d’un onglet à l’autre', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await freezeTime(page, day(132), '10:00');
        const recap = page.getByRole('complementary', { name: 'Récapitulatif', includeHidden: true });

        await page.goto(`/${day(132)}`);
        await expect(recap).toHaveAttribute('data-state', 'open');

        await page.getByRole('button', { name: 'Masquer le récapitulatif' }).click();
        await expect(recap).toHaveAttribute('data-state', 'closed');
        await expect(page.getByRole('button', { name: 'Afficher le récapitulatif' })).toBeFocused();
        await expectFullWidth(page, 1440);
        await page.reload();
        await expect(recap).toHaveAttribute('data-state', 'closed');
        await expectFullWidth(page, 1440);
        // Un nouvel onglet le retrouve fermé : c'est une préférence, comme la largeur des
        // favoris, pas un état de l'onglet.
        const other = await page.context().newPage();
        await freezeTime(other, day(132), '10:00');
        await other.goto(`/${day(132)}`);
        await expect(other.getByRole('complementary', { name: 'Récapitulatif', includeHidden: true })).toHaveAttribute(
            'data-state',
            'closed',
        );
        await other.close();

        await page.getByRole('button', { name: 'Afficher le récapitulatif' }).click();
        await expect(recap).toHaveAttribute('data-state', 'open');
        await expect(page.getByRole('button', { name: 'Masquer le récapitulatif' })).toBeFocused();
        // Rouvert comme à l'ouverture : le focus posé pendant qu'il s'élargit ne décale
        // pas son contenu, dont le bord gauche reste dans le cadre.
        const left = async (locator: Locator) => (await locator.boundingBox())?.x;
        await expect.poll(() => left(recap)).toBe(1440 - 328);
        expect(await left(recap.locator(':scope > div'))).toBe(1440 - 328);
    });

    test('sous 1280 px, il part fermé, et l’y ouvrir ne change pas la préférence', async ({ page }) => {
        await page.setViewportSize({ width: 1024, height: 720 });
        await freezeTime(page, day(133), '10:00');
        const recap = page.getByRole('complementary', { name: 'Récapitulatif', includeHidden: true });
        await page.goto(`/${day(133)}`);
        await page.evaluate((key) => {
            localStorage.setItem(key, 'true');
        }, RECAP_KEY);

        await page.reload();
        await expect(recap).toHaveAttribute('data-state', 'closed');
        await page.getByRole('button', { name: 'Afficher le récapitulatif' }).click();
        await expect(recap).toHaveAttribute('data-state', 'open');
        await page.keyboard.press('Escape');
        await expect(recap).toHaveAttribute('data-state', 'closed');
        expect(await page.evaluate((key) => localStorage.getItem(key), RECAP_KEY)).toBe('true');

        await page.setViewportSize({ width: 1440, height: 900 });
        await page.reload();
        await expect(recap).toHaveAttribute('data-state', 'open');
    });

    test('fermé par défaut sous 1440 px, « Reste » s’efface quand la place manque', async ({ page, request }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await writeDay(request, day(134), [{ start: '09:00', end: '09:30', ticket: 'SHOP-482' }]);
        await freezeTime(page, day(134), '10:00');
        await page.goto(`/${day(134)}`);
        const recap = page.getByRole('complementary', { name: 'Récapitulatif', includeHidden: true });
        const rest = figures(page).getByText('Reste');

        await expect(recap).toHaveAttribute('data-state', 'closed');
        await expect(rest).toBeVisible();
        await expectFullWidth(page, 1280);

        await page.getByRole('button', { name: 'Afficher le récapitulatif' }).click();
        await expect(rest).toBeHidden();
        await expect(figures(page)).toContainText('Fin prévue à 17:00');

        await page.setViewportSize({ width: 1024, height: 720 });
        await page.getByRole('button', { name: 'Masquer le récapitulatif' }).click();
        await expect(rest).toBeHidden();
    });

    test('sous 1280 px, il s’ouvre par-dessus la grille, et la croix comme Échap le ferment', async ({ page }) => {
        await page.setViewportSize({ width: 1024, height: 720 });
        // Sans mouvement, le panneau est en place dès qu'il s'ouvre.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await freezeTime(page, day(136), '10:00');
        await page.goto(`/${day(136)}`);
        const recap = page.getByRole('complementary', { name: 'Récapitulatif', includeHidden: true });
        const toggle = page.getByRole('button', { name: /le récapitulatif$/ }).first();

        await page.getByRole('button', { name: 'Afficher le récapitulatif' }).click();
        await expect(recap).toHaveAttribute('data-state', 'open');
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(toggle).toBeFocused();
        const grid = await page.getByRole('main').boundingBox();
        const panel = await recap.boundingBox();
        expect((panel?.x ?? 0) + (panel?.width ?? 0)).toBeCloseTo((grid?.x ?? 0) + (grid?.width ?? 0), 0);

        await page.keyboard.press('Escape');
        await expect(recap).toHaveAttribute('data-state', 'closed');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');

        await toggle.click();
        await page.getByRole('button', { name: 'Fermer le récapitulatif' }).click();
        await expect(recap).toHaveAttribute('data-state', 'closed');
        await expect(page.getByRole('button', { name: 'Afficher le récapitulatif' })).toBeFocused();
    });
});

test.describe('la position de la grille', () => {
    const top = async (page: Page) =>
        page
            .getByRole('list', { name: 'Saisies du jour' })
            .evaluate((list) => list.closest('.overflow-auto')?.scrollTop);

    test('aujourd’hui, une heure au moins après « maintenant », le haut sur une heure pleine', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await freezeTime(page, day(140), '15:20');
        await page.goto(`/${day(140)}`);
        await expect(figures(page)).toBeVisible();

        // 09:00, huit quarts d'heure sous 07:00.
        expect(await top(page)).toBe(8 * ROW);
    });

    test('un rechargement plus tard dans la journée recalcule la position, tant qu’on n’a rien fait défiler', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await freezeTime(page, day(144), '15:20');
        await page.goto(`/${day(144)}`);
        await expect(figures(page)).toBeVisible();
        expect(await top(page)).toBe(8 * ROW);
        await page.clock.runFor(100);

        await page.clock.pauseAt(new Date((await page.evaluate(() => Date.now())) + 3 * 3_600_000));
        await page.reload();
        await expect(figures(page)).toBeVisible();

        // 18:20 : la grille commence à 12:00.
        expect(await top(page)).toBe(20 * ROW);
    });

    test('en fin d’après-midi, la grille descend', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await freezeTime(page, day(141), '17:50');
        await page.goto(`/${day(141)}`);
        await expect(figures(page)).toBeVisible();

        // 12:00.
        expect(await top(page)).toBe(20 * ROW);
    });

    test('un autre jour s’ouvre sur 08:00, et changer de jour garde la position', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await freezeTime(page, day(143), '17:50');
        await page.goto(`/${day(142)}`);
        await expect(figures(page)).toBeVisible();
        expect(await top(page)).toBe(4 * ROW);

        await page.getByRole('list', { name: 'Saisies du jour' }).evaluate((list) => {
            const scroller = list.closest('.overflow-auto');
            if (scroller !== null) {
                scroller.scrollTop = 350;
            }
        });
        // 350 px sous 07:00 : 10:07:30, retenu par l'onglet à l'image suivante.
        await expect
            .poll(async () => {
                await page.clock.runFor(20);

                return page.evaluate(() => sessionStorage.getItem('daytrack.screen.grid-top'));
            })
            .toBe('607.5');
        await page.getByRole('button', { name: 'Jour suivant' }).click();
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(143));
        expect(await top(page)).toBe(350);

        await page.reload();
        await expect(figures(page)).toBeVisible();
        expect(await top(page)).toBe(350);
    });
});

/**
 * Le récapitulatif fermé ne garde pas sa place : la grille et la barre vont jusqu'au
 * bord, et l'icône qui le rouvre prend la place de celle de son en-tête.
 */
async function expectFullWidth(page: Page, width: number): Promise<void> {
    const right = async (locator: Locator) => {
        const box = await locator.boundingBox();

        return (box?.x ?? 0) + (box?.width ?? 0);
    };

    // Le panneau glisse en --dur-panel : on attend la fin du mouvement.
    await expect.poll(() => right(page.getByRole('main'))).toBe(width);
    expect(await right(page.getByRole('banner'))).toBe(width);
    // 12 px de marge à droite, comme l'icône dans l'en-tête du panneau ouvert.
    expect(await right(page.getByRole('button', { name: 'Afficher le récapitulatif' }))).toBe(width - 12);
}

/** « Lundi 3 mars 2025 » : le titre du jour d'un parcours. */
function titleOf(index: number): string {
    const date = new Date(Date.UTC(2025, 2, 3 + index));
    const weekday = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', timeZone: 'UTC' }).format(date);
    const month = new Intl.DateTimeFormat('fr-FR', { month: 'long', timeZone: 'UTC' }).format(date);
    const number = date.getUTCDate();

    return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${number === 1 ? '1er' : String(number)} ${month} 2025`;
}
