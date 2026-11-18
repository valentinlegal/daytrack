import type { Locator, Page } from '@playwright/test';

import { freezeTime, writeDay } from './day';
import {
    blocks,
    clickSlot,
    describedWrites,
    doubleClickSlot,
    dragSlots,
    expectGridMatchesBase,
    figures,
    lane,
    message,
    objectiveButton,
    openAnyway,
    recordWrites,
    rereadBehindGestures,
    rightClickSlot,
    savedDay,
    slotPoint,
    slots,
    ticketWindow,
    tokenColor,
} from './editing';
import { expect, expectAccessible, test } from './fixtures';
import { calendar, cell, numberColor } from './calendar';

/**
 * Le calendrier du mois et les jours non travaillés : les marques que le serveur calcule,
 * un clic ou Entrée qui ouvre un jour, les mois qu'on parcourt sans changer de jour, les
 * flèches de la barre qui sautent le week-end, et le samedi fermé à la saisie.
 *
 * Ces parcours lisent les marques de la base (`marks: 'base'`), sur des jours de janvier
 * et février 2025 que les autres parcours ne prennent pas : ils tournent en même temps,
 * sur la même base. Chacun n'éprouve que les marques des jours qu'il écrit lui-même.
 */
test.use({ marks: 'base' });

/** Les tickets d'une heure, de 09:00 à 10:00. */
const ONE_HOUR = [{ start: '09:00', end: '10:00', ticket: 'SHOP-482' }];

/** Le titre du mois affiché : « Janvier 2025 ». */
function monthTitle(page: Page): Locator {
    return page.getByRole('heading', { level: 2, name: /^\S+ \d{4}$/ });
}

/**
 * L'infobulle d'un bouton, ouverte au survol. Le pointeur s'en écarte d'abord, jusqu'à
 * ce que la précédente soit effacée : un jour ouvert redessine la barre sous lui, sans
 * qu'il ait bougé. Il glisse en plusieurs pas : Radix ne ferme une infobulle qu'au
 * mouvement qui suit la sortie de son bouton, et sous charge, ces pas peuvent ne pas
 * suffire : il recommence, depuis un autre point, tant qu'elle reste. L'heure est arrêtée
 * (freezeTime) : les 400 ms du survol passent à la main.
 */
async function tooltipOf(page: Page, button: Locator): Promise<Locator> {
    const tooltip = page.getByRole('tooltip');
    let corner = 1;
    await expect(async () => {
        corner = 1 - corner;
        await page.mouse.move(corner, corner, { steps: 5 });
        await expect(tooltip).toHaveCount(0, { timeout: 250 });
    }).toPass({ timeout: 5000 });
    await button.hover();
    await page.clock.runFor(450);

    return tooltip;
}

/**
 * Une flèche éteinte n'ouvre aucune infobulle, ni au survol ni au clavier : elle
 * nommerait un jour ou un mois où l'on ne va pas. Elle garde son nom, et se dit
 * indisponible.
 */
async function expectNoTooltip(page: Page, button: Locator, name: string, before: Locator): Promise<void> {
    await expect(button).toHaveAccessibleName(name);
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    const tooltip = await tooltipOf(page, button);
    // Le temps qu'une infobulle demandée paraisse.
    await page.waitForTimeout(200);
    await expect(tooltip).toHaveCount(0);

    // Au clavier, depuis sa voisine : le bouton prend le focus, son infobulle ne s'ouvre pas.
    await page.mouse.move(0, 0, { steps: 5 });
    await before.focus();
    await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    await page.waitForTimeout(200);
    await expect(tooltip).toHaveCount(0);
    await expect(button).not.toHaveAttribute('aria-describedby');
}

function title(page: Page): Locator {
    return page.getByRole('heading', { level: 1 });
}

function favoriteCard(page: Page, ticket: string): Locator {
    return page.locator('[data-favorite]').filter({ hasText: ticket });
}

/**
 * La marque sous le chiffre d'un jour, telle qu'elle se voit : sa forme et sa couleur.
 * Elle ne tient jamais à la seule couleur.
 */
async function markOf(day: Locator): Promise<string> {
    return day
        .locator(':scope > span')
        .last()
        .evaluate((mark) => {
            const style = getComputedStyle(mark);
            if (style.rotate === '45deg' && style.borderTopLeftRadius === '0px') {
                return `losange ${style.backgroundColor}`;
            }
            if (style.borderTopWidth !== '0px') {
                return `anneau ${style.borderTopColor}`;
            }

            return style.backgroundColor === 'rgba(0, 0, 0, 0)' ? 'aucune' : `disque ${style.backgroundColor}`;
        });
}

/** Ce qui a le curseur : « button Saisir quand même », « listbox Créneaux de la journée ». */
function focused(page: Page): Promise<string> {
    return page.evaluate(() => {
        const element = document.activeElement;
        if (element === null || element === document.body) {
            return 'page';
        }

        return `${element.getAttribute('role') ?? element.tagName.toLowerCase()} ${element.getAttribute('aria-label') ?? element.textContent.trim()}`;
    });
}

/**
 * Sert à la page des jours travaillés que la base n'a pas, comme si on les avait cochés
 * dans les réglages : la page les reçoit au chargement, puis chaque journée lue les redit.
 * Ceux de l'application de développement ne changent pas : toutes les captures de la
 * journée les montrent, dans le calendrier, et ses parcours tournent en même temps.
 */
async function serveWorkingDays(page: Page, workingDays: readonly number[]): Promise<void> {
    await page.route(
        (url) => /^\/\d{4}-\d{2}-\d{2}$/.test(url.pathname),
        async (route) => {
            const response = await route.fetch();
            // La page vient du serveur, sans passer par le Jira simulé des parcours
            // (tests/e2e/jira.ts) : elle se dit reliée, comme il la servirait.
            const body = (await response.text())
                .replace(/data-working-days="[^"]*"/, `data-working-days="${workingDays.join(' ')}"`)
                .replace(/data-jira="[^"]*"/, 'data-jira="connected"')
                .replace(/data-jira-scopes="[^"]*"/, 'data-jira-scopes=""');
            await route.fulfill({ response, body });
        },
    );
    await page.route(/\/api\/days\/\d{4}-\d{2}-\d{2}$/, async (route) => {
        const response = await route.fetch();
        const view = (await response.json()) as {
            date: string;
            objective: number;
            habitualObjective: number;
            working: boolean;
        };
        const weekday = new Date(`${view.date}T00:00:00Z`).getUTCDay() || 7;
        const working = workingDays.includes(weekday);
        await route.fulfill({
            response,
            json: {
                ...view,
                working,
                workingDays,
                // Un jour qui devient travaillé reprend l'objectif habituel.
                objective: working && !view.working ? view.habitualObjective : view.objective,
            },
        });
    });
    // Le calendrier redit les jours travaillés qui ont décidé de ses marques.
    await page.route('**/api/calendar/**', async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, json: { ...((await response.json()) as object), workingDays } });
    });
}

test.describe('le mois', () => {
    test('montre le mois du jour affiché, ses marques et ses jours non travaillés', async ({ page, request }) => {
        // Le mercredi 15 janvier 2025, aujourd'hui. Un jour commencé et sous son objectif,
        // une pause comprise, est incomplet ; un ticket à l'objectif atteint n'est que non
        // envoyé ; un samedi n'est jamais incomplet ; un jour sans ticket n'a rien à envoyer.
        await writeDay(request, '2025-01-06', ONE_HOUR);
        await writeDay(request, '2025-01-07', [{ start: '12:00', end: '13:00' }]);
        await writeDay(request, '2025-01-08', ONE_HOUR, 60);
        await writeDay(request, '2025-01-09', []);
        await writeDay(request, '2025-01-11', [{ start: '09:00', end: '10:00', ticket: 'OPS-7' }]);
        await writeDay(request, '2025-01-12', [{ start: '12:00', end: '13:00' }]);
        await writeDay(request, '2025-01-15', []);
        await writeDay(request, '2025-01-16', []);
        await freezeTime(page, '2025-01-15', '10:00');
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto('/2025-01-15');

        await expect(monthTitle(page)).toHaveText('Janvier 2025');
        await expect(calendar(page)).toHaveAccessibleName('Janvier 2025');
        await expect(calendar(page).getByRole('columnheader')).toHaveText(['L', 'M', 'M', 'J', 'V', 'S', 'D']);
        // Les semaines du mois, du lundi 30 décembre au dimanche 2 février : cinq.
        await expect(calendar(page).getByRole('row')).toHaveCount(6);
        await expect(calendar(page).getByRole('button')).toHaveCount(35);
        await expect(calendar(page).getByRole('button').first()).toHaveAccessibleName(/^30 décembre(,|$)/);
        await expect(calendar(page).getByRole('button').last()).toHaveAccessibleName('2 février, non travaillé');

        const today = cell(page, '2025-01-15');
        await expect(today).toHaveAccessibleName("15 janvier, aujourd'hui, jour affiché");
        await expect(today).toHaveAttribute('aria-current', 'date');
        await expect(cell(page, '2025-01-06')).toHaveAccessibleName('6 janvier, incomplet');
        await expect(cell(page, '2025-01-07')).toHaveAccessibleName('7 janvier, incomplet');
        await expect(cell(page, '2025-01-08')).toHaveAccessibleName('8 janvier, non envoyé');
        await expect(cell(page, '2025-01-09')).toHaveAccessibleName('9 janvier');
        await expect(cell(page, '2025-01-11')).toHaveAccessibleName('11 janvier, non travaillé, non envoyé');
        await expect(cell(page, '2025-01-12')).toHaveAccessibleName('12 janvier, non travaillé');
        await expect(cell(page, '2025-01-16')).toHaveAccessibleName('16 janvier');

        // Chaque marque a sa forme : losange pour « incomplet », anneau pour « non envoyé ».
        expect(await markOf(cell(page, '2025-01-06'))).toBe(`losange ${await tokenColor(page, '--inc')}`);
        expect(await markOf(cell(page, '2025-01-08'))).toBe(`anneau ${await tokenColor(page, '--warn')}`);
        expect(await markOf(cell(page, '2025-01-11'))).toBe(`anneau ${await tokenColor(page, '--warn')}`);
        expect(await markOf(cell(page, '2025-01-09'))).toBe('aucune');
        expect(await markOf(cell(page, '2025-01-12'))).toBe('aucune');
        expect(await markOf(cell(page, '2025-01-16'))).toBe('aucune');

        // Les jours non travaillés et ceux d'à côté sont grisés ; le jour affiché, plein.
        const ink3 = await tokenColor(page, '--ink-3');
        expect(await numberColor(cell(page, '2025-01-18'))).toBe(ink3);
        expect(await numberColor(cell(page, '2025-01-19'))).toBe(ink3);
        expect(await numberColor(cell(page, '2025-02-02'))).toBe(ink3);
        expect(await numberColor(calendar(page).getByRole('button').first())).toBe(ink3);
        expect(await numberColor(cell(page, '2025-01-17'))).toBe(await tokenColor(page, '--ink'));
        expect(await numberColor(today)).toBe(await tokenColor(page, '--on-btn'));

        await expect(page.getByRole('region', { name: 'Janvier 2025' }).getByRole('listitem')).toHaveText([
            'Envoyé',
            'Non envoyé',
            'Modifié',
            'Incomplet',
        ]);

        await page.clock.resume();
        await expectAccessible(page);
    });

    test('un clic ouvre le jour, du mois ou d’à côté ; ses flèches parcourent les mois sans changer de jour', async ({
        page,
    }) => {
        // Aujourd'hui le mercredi 15 janvier : jusqu'au vendredi 14 février, les jours s'ouvrent.
        await freezeTime(page, '2025-01-15', '10:00');
        await page.goto('/2025-01-15');
        await expect(monthTitle(page)).toHaveText('Janvier 2025');

        await cell(page, '2025-01-21').click();
        await expect(page).toHaveURL('/2025-01-21');
        await expect(title(page)).toHaveText('Mardi 21 janvier 2025');
        await expect(cell(page, '2025-01-21')).toHaveAccessibleName(/^21 janvier, jour affiché/);
        await expect(cell(page, '2025-01-15')).toHaveAccessibleName(/^15 janvier, aujourd'hui/);
        await expect(cell(page, '2025-01-15')).not.toHaveAccessibleName(/jour affiché/);

        // Un jour du mois d'après, dans la dernière semaine : il s'ouvre, et le calendrier
        // passe à son mois.
        await cell(page, '2025-02-02').click();
        await expect(page).toHaveURL('/2025-02-02');
        await expect(monthTitle(page)).toHaveText('Février 2025');
        await expect(cell(page, '2025-02-02')).toHaveAccessibleName(/^2 février, jour affiché, non travaillé/);

        // Les flèches du mois ne changent pas de jour. Leur infobulle nomme le mois visé.
        const previousMonth = page.getByRole('button', { name: 'Mois précédent' });
        await expect(await tooltipOf(page, previousMonth)).toHaveText('Janvier 2025');
        await expect(previousMonth).toHaveAccessibleDescription('Janvier 2025');
        await previousMonth.click();
        await expect(monthTitle(page)).toHaveText('Janvier 2025');
        await expect(await tooltipOf(page, previousMonth)).toHaveText('Décembre 2024');
        await page.getByRole('button', { name: 'Mois précédent' }).click();
        await expect(monthTitle(page)).toHaveText('Décembre 2024');
        await expect(page).toHaveURL('/2025-02-02');
        await expect(title(page)).toHaveText('Dimanche 2 février 2025');

        // Changer de jour par la barre ramène le calendrier au mois du jour affiché.
        await page.getByRole('button', { name: 'Jour précédent' }).click();
        await expect(page).toHaveURL('/2025-01-31');
        await expect(monthTitle(page)).toHaveText('Janvier 2025');

        // Tout mars est au-delà des trente jours qui s'ouvrent : « Mois suivant » s'éteint
        // en février, et un jour au-delà du 14 ne s'ouvre pas.
        const nextMonth = page.getByRole('button', { name: 'Mois suivant' });
        await expect(await tooltipOf(page, nextMonth)).toHaveText('Février 2025');
        await nextMonth.click();
        await expect(monthTitle(page)).toHaveText('Février 2025');
        await expect(nextMonth).toHaveAttribute('aria-disabled', 'true');
        await expectNoTooltip(page, nextMonth, 'Mois suivant', previousMonth);
        // « force » : Playwright refuse de cliquer un bouton indisponible.
        await nextMonth.click({ force: true });
        await expect(monthTitle(page)).toHaveText('Février 2025');
        await expect(cell(page, '2025-02-14')).not.toHaveAttribute('aria-disabled');
        await expect(cell(page, '2025-02-15')).toHaveAttribute('aria-disabled', 'true');
        await cell(page, '2025-02-15').click({ force: true });
        await expect(page).toHaveURL('/2025-01-31');
        await cell(page, '2025-02-14').click();
        await expect(page).toHaveURL('/2025-02-14');
        await expect(title(page)).toHaveText('Vendredi 14 février 2025');

        await page.getByRole('button', { name: "Aujourd'hui", exact: true }).click();
        await expect(page).toHaveURL('/2025-01-15');
        await expect(monthTitle(page)).toHaveText('Janvier 2025');
    });

    test('au clavier, une seule étape de tabulation, les flèches de jour en jour et Entrée qui ouvre', async ({
        page,
    }) => {
        await freezeTime(page, '2025-01-15', '10:00');
        await page.goto('/2025-01-22');
        await expect(monthTitle(page)).toHaveText('Janvier 2025');

        // On entre sur le jour affiché ; Tab en sort, Maj+Tab y revient.
        await page.getByRole('button', { name: 'Mois suivant' }).focus();
        await page.keyboard.press('Tab');
        await expect(cell(page, '2025-01-22')).toBeFocused();
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => document.activeElement?.closest('[role="grid"]') === null)).toBe(true);
        await page.keyboard.press('Shift+Tab');
        await expect(cell(page, '2025-01-22')).toBeFocused();

        for (const [key, date] of [
            ['ArrowLeft', '2025-01-21'],
            ['ArrowUp', '2025-01-14'],
            ['ArrowDown', '2025-01-21'],
            ['ArrowDown', '2025-01-28'],
            ['Home', '2025-01-27'],
            // La fin de la semaine est déjà en février, sur la dernière ligne du mois.
            ['End', '2025-02-02'],
        ] as const) {
            await page.keyboard.press(key);
            await expect(cell(page, date), key).toBeFocused();
        }
        await expect(monthTitle(page)).toHaveText('Janvier 2025');

        // Un jour hors des semaines affichées change de mois.
        await page.keyboard.press('ArrowRight');
        await expect(monthTitle(page)).toHaveText('Février 2025');
        await expect(cell(page, '2025-02-03')).toBeFocused();
        await page.keyboard.press('PageUp');
        await expect(monthTitle(page)).toHaveText('Janvier 2025');
        await expect(cell(page, '2025-01-03')).toBeFocused();
        await page.keyboard.press('PageDown');
        await expect(monthTitle(page)).toHaveText('Février 2025');
        await expect(cell(page, '2025-02-03')).toBeFocused();
        // Rien ne s'est ouvert en chemin.
        await expect(page).toHaveURL('/2025-01-22');

        // Le curseur s'arrête au dernier jour qui s'ouvre, le 14 février, comme « Mois suivant ».
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await expect(cell(page, '2025-02-14')).toBeFocused();
        await page.keyboard.press('PageDown');
        await expect(monthTitle(page)).toHaveText('Février 2025');
        await expect(cell(page, '2025-02-14')).toBeFocused();
        await expect(page).toHaveURL('/2025-01-22');

        await page.keyboard.press('Home');
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL('/2025-02-10');
        await expect(title(page)).toHaveText('Lundi 10 février 2025');
        await expect(cell(page, '2025-02-10')).toHaveAccessibleName(/^10 février, jour affiché/);
        await expect(cell(page, '2025-02-10')).toBeFocused();
    });

    test('Page suivante et précédente changent toujours de mois, même vers un jour visible à côté', async ({
        page,
    }) => {
        await freezeTime(page, '2025-01-15', '10:00');
        await page.goto('/2025-01-13');
        await expect(figures(page)).toBeVisible();

        // Le 1er février est déjà sur la dernière ligne de janvier, et le 31 décembre sur sa
        // première : le mois change quand même.
        await cell(page, '2025-01-01').focus();
        await page.keyboard.press('PageDown');
        await expect(monthTitle(page)).toHaveText('Février 2025');
        await expect(cell(page, '2025-02-01')).toBeFocused();
        await page.keyboard.press('PageUp');
        await expect(monthTitle(page)).toHaveText('Janvier 2025');
        await expect(cell(page, '2025-01-01')).toBeFocused();
        await page.keyboard.press('PageUp');
        await expect(monthTitle(page)).toHaveText('Décembre 2024');
        await expect(cell(page, '2024-12-01')).toBeFocused();
        await expect(page).toHaveURL('/2025-01-13');
    });

    test('seul le jour sous le pointeur prend le survol', async ({ page }) => {
        await freezeTime(page, '2025-01-15', '10:00');
        await page.goto('/2025-01-13');
        await expect(figures(page)).toBeVisible();
        const background = (date: string) =>
            cell(page, date)
                .locator(':scope > span')
                .first()
                .evaluate((number) => getComputedStyle(number).backgroundColor);
        const hover = await tokenColor(page, '--bg-hover');

        await lane(page).hover();
        expect(await background('2025-01-20')).toBe('rgba(0, 0, 0, 0)');
        await cell(page, '2025-01-20').hover();
        expect(await background('2025-01-20')).toBe(hover);
        expect(await background('2025-01-21')).toBe('rgba(0, 0, 0, 0)');
    });

    test('la marque suit les gestes de la grille et l’objectif du jour', async ({ page, request }) => {
        const date = '2025-01-27';
        await writeDay(request, date, []);
        await freezeTime(page, '2025-01-29', '10:00');
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`/${date}`);
        const shown = cell(page, date);
        await expect(shown).toHaveAccessibleName('27 janvier, jour affiché');

        // Un ticket posé sur un jour passé, sous son objectif : incomplet.
        await doubleClickSlot(page, '10:00');
        await ticketWindow(page).getByLabel('Ticket').fill('SHOP-482');
        await ticketWindow(page).getByLabel('Ticket').press('Enter');
        await expect(blocks(page)).toHaveCount(1);
        await expect(shown).toHaveAccessibleName('27 janvier, jour affiché, incomplet');

        // L'objectif atteint, il n'est plus que non envoyé.
        await objectiveButton(page).click();
        const field = page.getByRole('dialog', { name: 'Objectif du jour' }).getByLabel('Durée à travailler');
        await field.fill('0h15');
        await field.press('Enter');
        await expect(page.getByRole('dialog', { name: 'Objectif du jour' })).toHaveCount(0);
        await expect(shown).toHaveAccessibleName('27 janvier, jour affiché, non envoyé');

        // Effacé au clavier, plus rien à faire ni à envoyer : plus de marque.
        await clickSlot(page, '10:00');
        await page.keyboard.press('Delete');
        await expect(blocks(page)).toHaveCount(0);
        await expect(shown).toHaveAccessibleName('27 janvier, jour affiché');
        await expectGridMatchesBase(page, request, date);
    });

    test('se relit au retour sur l’onglet, qu’un autre a pu changer', async ({ page, request }) => {
        const date = '2025-01-10';
        await writeDay(request, date, []);
        await freezeTime(page, '2025-01-15', '10:00');
        await page.goto('/2025-01-15');
        await expect(cell(page, date)).toHaveAccessibleName('10 janvier');

        // Un autre onglet y pose un ticket ; on revient sur celui-ci.
        await writeDay(request, date, ONE_HOUR);
        await page.evaluate(() => {
            window.dispatchEvent(new Event('focus'));
        });
        await expect(cell(page, date)).toHaveAccessibleName('10 janvier, incomplet');
    });

    test('une réponse arrivée après un autre mois ne s’affiche pas', async ({ page }) => {
        await freezeTime(page, '2025-01-15', '10:00');
        // La lecture de décembre attend qu'on soit revenu en janvier, et marque à tort le
        // 2 janvier, visible dans les deux mois.
        let releaseDecember: () => void = () => undefined;
        const december = new Promise<void>((resolve) => {
            releaseDecember = resolve;
        });
        await page.route('**/api/calendar/2024-11-25/**', async (route) => {
            await december;
            await route.fulfill({
                json: { marks: { '2025-01-02': 'incomplete' }, daysOff: [], workingDays: [1, 2, 3, 4, 5] },
            });
        });
        await page.goto('/2025-01-13');
        await expect(figures(page)).toBeVisible();

        await page.getByRole('button', { name: 'Mois précédent' }).click();
        await expect(monthTitle(page)).toHaveText('Décembre 2024');
        await page.getByRole('button', { name: 'Mois suivant' }).click();
        await expect(monthTitle(page)).toHaveText('Janvier 2025');
        const answered = page.waitForResponse('**/api/calendar/2024-11-25/**');
        releaseDecember();
        await answered;

        await expect(cell(page, '2025-01-02')).toHaveAccessibleName('2 janvier');
        expect(await markOf(cell(page, '2025-01-02'))).toBe('aucune');
    });

    test('« Aujourd’hui » ramène le calendrier au mois d’aujourd’hui, même sans changer de jour', async ({ page }) => {
        await freezeTime(page, '2025-01-15', '10:00');
        await page.goto('/2025-01-15');
        await expect(figures(page)).toBeVisible();
        for (let month = 0; month < 3; month += 1) {
            await page.getByRole('button', { name: 'Mois précédent' }).click();
        }
        await expect(monthTitle(page)).toHaveText('Octobre 2024');

        await page.getByRole('button', { name: "Aujourd'hui", exact: true }).click();
        await expect(monthTitle(page)).toHaveText('Janvier 2025');
        await expect(page).toHaveURL('/2025-01-15');
    });

    test('une flèche éteinte survolée ne garde pas d’infobulle pour quand elle se rallume', async ({ page }) => {
        // Février est le dernier mois qui s'ouvre : « Mois suivant » y est éteint.
        await freezeTime(page, '2025-01-15', '10:00');
        await page.goto('/2025-02-03');
        const previousMonth = page.getByRole('button', { name: 'Mois précédent' });
        const nextMonth = page.getByRole('button', { name: 'Mois suivant' });
        await expect(nextMonth).toHaveAttribute('aria-disabled', 'true');

        // Survolée plus longtemps que le délai, puis quittée pour « Mois précédent »,
        // qu'on clique : elle se rallume sans s'ouvrir.
        await tooltipOf(page, nextMonth);
        // Muette, elle n'a pas compté pour ouverte : la suivante, ailleurs, attend son délai.
        const settings = page.getByRole('button', { name: 'Réglages' });
        await page.mouse.move(0, 0, { steps: 5 });
        await settings.hover();
        await page.clock.runFor(100);
        await page.waitForTimeout(200);
        await expect(page.getByRole('tooltip')).toHaveCount(0);
        await page.clock.runFor(350);
        await expect(page.getByRole('tooltip')).toHaveText('Réglages');

        const tooltip = await tooltipOf(page, previousMonth);
        await expect(tooltip).toHaveText('Janvier 2025');
        await previousMonth.click();
        await expect(monthTitle(page)).toHaveText('Janvier 2025');
        await expect(nextMonth).not.toHaveAttribute('aria-disabled', 'true');
        await page.clock.runFor(450);
        await page.waitForTimeout(200);
        await expect(tooltip).toHaveCount(0);

        // Survolée de nouveau, elle s'ouvre, sur le mois qu'elle vise.
        await expect(await tooltipOf(page, nextMonth)).toHaveText('Février 2025');
    });

    test('parcourir le calendrier n’écrit rien', async ({ page }) => {
        const writes = recordWrites(page);
        await freezeTime(page, '2025-01-15', '10:00');
        await page.goto('/2025-01-13');
        await expect(figures(page)).toBeVisible();

        // Le 2 février passe le calendrier en février ; le 27 janvier, sur sa première ligne,
        // le ramène en janvier.
        for (const date of ['2025-01-14', '2025-01-18', '2025-01-31', '2025-02-02', '2025-01-27', '2025-01-13']) {
            await cell(page, date).click();
            await expect(page).toHaveURL(`/${date}`);
            await expect(figures(page)).toBeVisible();
        }
        for (const name of ['Mois précédent', 'Mois précédent', 'Mois suivant', 'Mois suivant', 'Mois suivant']) {
            await page.getByRole('button', { name }).click();
        }
        await expect(monthTitle(page)).toHaveText('Février 2025');
        await page.getByRole('button', { name: 'Mois précédent' }).click();
        await cell(page, '2025-01-13').focus();
        // Page suivante s'arrête au 14 février, le dernier jour qui s'ouvre ; Page précédente
        // revient au 14 janvier.
        for (const key of ['ArrowRight', 'ArrowDown', 'PageDown', 'PageUp', 'Enter']) {
            await page.keyboard.press(key);
        }
        await expect(page).toHaveURL('/2025-01-14');
        await expect(figures(page)).toBeVisible();

        expect(describedWrites(writes)).toEqual([]);
    });
});

test.describe('les flèches de la barre', () => {
    test('sautent le week-end dans les deux sens, aussi depuis un samedi ouvert par le calendrier', async ({
        page,
    }) => {
        // Aujourd'hui le jeudi 16 janvier : le samedi 15 février est le dernier jour qui s'ouvre.
        await freezeTime(page, '2025-01-16', '10:00');
        await page.goto('/2025-02-07');
        const next = page.getByRole('button', { name: 'Jour suivant' });
        const previous = page.getByRole('button', { name: 'Jour précédent' });

        // Leur infobulle dit où elles mènent : le lundi, par-dessus le week-end.
        await expect(await tooltipOf(page, next)).toHaveText('Lundi 10 février');
        await expect(next).toHaveAccessibleName('Jour suivant');
        await expect(next).toHaveAccessibleDescription('Lundi 10 février');
        await next.click();
        await expect(page).toHaveURL('/2025-02-10');
        await expect(title(page)).toHaveText('Lundi 10 février 2025');
        await previous.click();
        await expect(page).toHaveURL('/2025-02-07');
        await expect(await tooltipOf(page, previous)).toHaveText('Jeudi 6 février');

        // Au clavier.
        await next.focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL('/2025-02-10');
        await previous.focus();
        await page.keyboard.press('Space');
        await expect(page).toHaveURL('/2025-02-07');

        // Un samedi, un dimanche ouverts par le calendrier : les flèches en repartent vers
        // le jour travaillé le plus proche.
        await cell(page, '2025-02-08').click();
        await expect(title(page)).toHaveText('Samedi 8 février 2025');
        await next.click();
        await expect(page).toHaveURL('/2025-02-10');
        await cell(page, '2025-02-09').click();
        await expect(title(page)).toHaveText('Dimanche 9 février 2025');
        await previous.click();
        await expect(page).toHaveURL('/2025-02-07');

        // Le vendredi 14, le jour travaillé suivant est au-delà des trente jours : « Jour
        // suivant » s'éteint, même si le samedi s'ouvre encore par le calendrier.
        await cell(page, '2025-02-14').click();
        await expect(page).toHaveURL('/2025-02-14');
        await expect(next).toHaveAttribute('aria-disabled', 'true');
        await expectNoTooltip(page, next, 'Jour suivant', previous);
        await expect(await tooltipOf(page, previous)).toHaveText('Jeudi 13 février');
        await next.click({ force: true });
        await expect(page).toHaveURL('/2025-02-14');
        await cell(page, '2025-02-15').click();
        await expect(page).toHaveURL('/2025-02-15');
    });

    test('ne sautent plus un samedi coché dans les réglages, qui ne se ferme plus', async ({ page, request }) => {
        await writeDay(request, '2025-02-01', []);
        await serveWorkingDays(page, [1, 2, 3, 4, 5, 6]);
        await freezeTime(page, '2025-01-15', '10:00');
        await page.goto('/2025-01-31');
        await expect(cell(page, '2025-02-01')).toHaveAccessibleName('1 février');

        await page.getByRole('button', { name: 'Jour suivant' }).click();
        await expect(page).toHaveURL('/2025-02-01');
        await expect(title(page)).toHaveText('Samedi 1er février 2025');
        await expect(figures(page)).toContainText('Reste 7h30');
        await expect(objectiveButton(page)).toBeVisible();
        await expect(openAnyway(page)).toHaveCount(0);
        await expect(
            page.getByText('Double-cliquez sur un créneau, ou glissez un favori sur la grille.'),
        ).toBeVisible();
        await expect(cell(page, '2025-02-01')).toHaveAccessibleName('1 février, jour affiché');
        // Le dimanche, lui, reste sauté et grisé.
        await expect(cell(page, '2025-02-02')).toHaveAccessibleName('2 février, non travaillé');

        await page.getByRole('button', { name: 'Jour suivant' }).click();
        await expect(page).toHaveURL('/2025-02-03');
        await page.getByRole('button', { name: 'Jour précédent' }).click();
        await expect(page).toHaveURL('/2025-02-01');
    });
});

test.describe('le jour non travaillé', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
    });

    test('vide, il est fermé : aucun geste de la grille n’y écrit', async ({ page, request }) => {
        const date = '2025-01-18';
        await writeDay(request, date, []);
        const writes = recordWrites(page);
        await freezeTime(page, '2025-01-22', '10:00');
        await page.goto(`/${date}`);

        await expect(figures(page)).toHaveText('Jour non travaillé');
        await expect(objectiveButton(page)).toHaveCount(0);
        await expect(page.getByRole('progressbar')).toHaveCount(0);
        await expect(page.getByText('Aucun ticket pour ce jour', { exact: true })).toBeVisible();
        await expect(page.getByText("Samedi n'est pas un jour travaillé.", { exact: true })).toBeVisible();
        await expect(openAnyway(page)).toBeVisible();
        await expect(cell(page, date)).toHaveAccessibleName('18 janvier, jour affiché, non travaillé');
        expect(await lane(page).evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
            await page.evaluate(() => {
                const probe = document.createElement('div');
                probe.style.backgroundColor = 'var(--bg-side)';
                document.body.append(probe);

                return getComputedStyle(probe).backgroundColor;
            }),
        );
        await page.clock.resume();
        await expectAccessible(page);

        // À la souris : ni sélection, ni fenêtre, ni menu.
        await clickSlot(page, '10:00');
        await dragSlots(page, '10:00', '11:00');
        await doubleClickSlot(page, '10:00');
        await rightClickSlot(page, '10:30');
        await expect(slots(page).getByRole('option', { selected: true })).toHaveCount(0);
        await expect(ticketWindow(page)).toHaveCount(0);
        await expect(page.getByRole('menu')).toHaveCount(0);
        await expect(slots(page)).not.toBeFocused();

        // Un favori se copie toujours ; collé, il ne pose rien, et le curseur reste sur lui.
        await favoriteCard(page, 'SHOP-482').click();
        await expect(message(page)).toContainText('SHOP-482 copié');
        await page.keyboard.press('ControlOrMeta+V');
        await expect(favoriteCard(page, 'SHOP-482')).toBeFocused();

        // Glissé sur la grille, il n'y trouve pas de place, et lâché, il ne pose rien.
        const card = await favoriteCard(page, 'SHOP-482').boundingBox();
        const target = await slotPoint(page, '12:00');
        await page.mouse.move((card?.x ?? 0) + 40, (card?.y ?? 0) + 20);
        await page.mouse.down();
        await page.mouse.move(target.x, target.y, { steps: 8 });
        await expect(page.locator('.favorite-drag')).toBeVisible();
        await expect(page.getByText('12:00 à 12:15', { exact: true })).toHaveCount(0);
        await page.mouse.up();
        await expect(page.locator('.favorite-drag')).toHaveCount(0);

        // Au clavier : la liste des créneaux n'est plus sur le chemin de Tab, et annuler ou
        // rétablir ne font rien.
        await page.getByRole('button', { name: "Aujourd'hui", exact: true }).focus();
        const reached = new Set<string>();
        for (let step = 0; step < 40; step += 1) {
            await page.keyboard.press('Tab');
            reached.add(await focused(page));
        }
        expect(reached).toContain('button Saisir quand même');
        expect(reached).not.toContain('listbox Créneaux de la journée');
        await page.keyboard.press('ControlOrMeta+Z');
        await page.keyboard.press('ControlOrMeta+Y');

        await expect(openAnyway(page)).toBeVisible();
        await expect(blocks(page)).toHaveCount(0);
        expect(await savedDay(request, date)).toEqual([]);
        expect(describedWrites(writes)).toEqual([]);
    });

    test('« Saisir quand même » l’ouvre pour ce jour-là, sans rien écrire ; il se referme vide', async ({
        page,
        request,
    }) => {
        const date = '2025-01-25';
        await writeDay(request, date, []);
        const writes = recordWrites(page);
        await freezeTime(page, '2025-01-29', '10:00');
        await page.goto(`/${date}`);

        // Au clavier : le bouton disparaît, le curseur va à la grille, et rien ne part.
        await openAnyway(page).focus();
        await page.keyboard.press('Enter');
        await expect(openAnyway(page)).toHaveCount(0);
        await expect(slots(page)).toBeFocused();
        await expect(
            page.getByText('Double-cliquez sur un créneau, ou glissez un favori sur la grille.', { exact: true }),
        ).toBeVisible();
        await expect(figures(page)).toHaveText('Jour non travaillé');
        expect(describedWrites(writes)).toEqual([]);

        // Reparti et revenu sans saisie : il est de nouveau fermé.
        await page.getByRole('button', { name: 'Jour suivant' }).click();
        await expect(page).toHaveURL('/2025-01-27');
        await cell(page, date).click();
        await expect(openAnyway(page)).toBeVisible();

        // À la souris, cette fois, et une heure saisie au clavier.
        await openAnyway(page).click();
        await expect(slots(page)).toBeFocused();
        await clickSlot(page, '10:00');
        await clickSlot(page, '10:45', ['Shift']);
        await page.keyboard.type('SHOP-482');
        await page.keyboard.press('Enter');
        await expect(blocks(page)).toHaveCount(1);
        expect(await savedDay(request, date)).toEqual([
            { start: '10:00', end: '11:00', kind: 'work', ticket: 'SHOP-482', comment: null },
        ]);
        // Tout compte en plus, sans objectif ni barre ; le jour a un ticket à envoyer.
        await expect(figures(page)).toHaveText('1h00Solde +1h00');
        await expect(objectiveButton(page)).toHaveCount(0);
        await expect(page.getByRole('progressbar')).toHaveCount(0);
        await expect(cell(page, date)).toHaveAccessibleName('25 janvier, jour affiché, non travaillé, non envoyé');
        await expectGridMatchesBase(page, request, date);

        // Avec une saisie, il reste ouvert d'une visite à l'autre.
        await page.getByRole('button', { name: 'Jour précédent' }).click();
        await expect(page).toHaveURL('/2025-01-24');
        await cell(page, date).click();
        await expect(blocks(page)).toHaveCount(1);
        await expect(openAnyway(page)).toHaveCount(0);

        // Sa dernière saisie effacée, il reste ouvert tant qu'on y est : Ctrl+Z la rend.
        await clickSlot(page, '10:00');
        await clickSlot(page, '10:45', ['Shift']);
        await page.keyboard.press('Delete');
        await expect(blocks(page)).toHaveCount(0);
        await expect(openAnyway(page)).toHaveCount(0);
        await page.keyboard.press('ControlOrMeta+Z');
        await expect(blocks(page)).toHaveCount(1);
        await expectGridMatchesBase(page, request, date);

        // Vidé puis quitté, il se referme ; et l'annulation n'y passe plus.
        await clickSlot(page, '10:00');
        await clickSlot(page, '10:45', ['Shift']);
        await page.keyboard.press('Delete');
        await expect(blocks(page)).toHaveCount(0);
        await page.getByRole('button', { name: 'Jour suivant' }).click();
        await expect(page).toHaveURL('/2025-01-27');
        await cell(page, date).click();
        await expect(openAnyway(page)).toBeVisible();
        await page.keyboard.press('ControlOrMeta+Z');
        // Ce que Ctrl+Z aurait envoyé est parti avant la relecture : la base se lit après lui.
        await rereadBehindGestures(page, date);
        await expect(openAnyway(page)).toBeVisible();
        await expect(blocks(page)).toHaveCount(0);
        expect(await savedDay(request, date)).toEqual([]);
    });
});
