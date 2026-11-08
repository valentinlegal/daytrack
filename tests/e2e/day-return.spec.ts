import type { APIRequestContext, Page } from '@playwright/test';

import { type Entry, startTimeAt, weekdaysFrom, writeDay } from './day';
import {
    clickSlot,
    doubleClickSlot,
    expectGridMatchesBase,
    figures,
    message,
    objectiveButton,
    objectiveWindow,
    savedDay,
    ticketWindow,
} from './editing';
import { expect, test } from './fixtures';
import { clearSentDay, receivedWorklogs, rewriteSend, sendButton, sendWindow } from './send';

/**
 * La journée relue au retour sur la page — l'onglet retrouvé, ou la fenêtre qui reprend la
 * main —, comme le calendrier et les favoris : ce qu'un autre onglet y a saisi ou envoyé
 * s'affiche, sans rien perdre d'une fenêtre ouverte.
 *
 * Playwright fait croire à chaque onglet qu'il garde le focus : le retour se joue par
 * l'événement que le navigateur enverrait.
 */

/** Les jours de ce fichier : des jours de semaine de septembre 2022, que nul autre ne prend. */
const workday = weekdaysFrom('2022-09-05');

const HOUR: Entry[] = [{ start: '14:00', end: '15:00', ticket: 'SHOP-482', comment: 'Revue de code' }];

const STALE = 'La journée a changé entre-temps. Vérifiez, puis enregistrez de nouveau.';

/** Ouvre le jour d'un parcours, ses saisies posées, son objectif égal au temps saisi. */
async function open(page: Page, request: APIRequestContext, index: number, entries: readonly Entry[]) {
    const date = workday(index);
    await clearSentDay(request, date);
    await writeDay(request, date, entries, entries.length === 0 ? undefined : 60 * entries.length);
    await page.setViewportSize({ width: 1440, height: 900 });
    await startTimeAt(page, date, '18:00');
    await page.goto(`/${date}`);
    await expect(figures(page)).toBeVisible();

    return date;
}

/** Le même jour, dans un autre onglet. */
async function otherTab(page: Page, date: string): Promise<Page> {
    const other = await page.context().newPage();
    await other.setViewportSize({ width: 1440, height: 900 });
    await startTimeAt(other, date, '18:00');
    await other.goto(`/${date}`);
    await expect(figures(other)).toBeVisible();

    return other;
}

/** Le retour sur l'onglet, ou dans la fenêtre restée à côté, qui reprend la main. */
async function comeBack(page: Page, where: 'tab' | 'window' = 'tab'): Promise<void> {
    await page.evaluate((into) => {
        if (into === 'tab') {
            document.dispatchEvent(new Event('visibilitychange'));
        } else {
            window.dispatchEvent(new Event('focus'));
        }
    }, where);
}

test.describe('la journée relue au retour sur la page', () => {
    for (const where of ['tab', 'window'] as const) {
        test(`montre « Envoyé » quand un autre onglet l’a envoyée, au retour ${where === 'tab' ? 'sur l’onglet' : 'dans la fenêtre'}`, async ({
            page,
            request,
        }) => {
            const date = await open(page, request, where === 'tab' ? 0 : 1, HOUR);
            await expect(sendButton(page)).toHaveAccessibleName('Envoyer sur Jira, journée non envoyée');

            const other = await otherTab(page, date);
            await sendButton(other).click();
            await sendWindow(other, 'Envoyer sur Jira').getByRole('button', { name: 'Envoyer sur Jira' }).click();
            await expect(sendButton(other)).toHaveText(/^Envoyé à \d{2}:\d{2}$/);
            await other.close();
            expect(await receivedWorklogs(request, date)).toHaveLength(1);

            // Rien ne bouge ici avant le retour.
            await expect(sendButton(page)).toHaveAccessibleName('Envoyer sur Jira, journée non envoyée');
            await comeBack(page, where);
            await expect(sendButton(page)).toHaveText(/^Envoyé à \d{2}:\d{2}$/);
        });
    }

    test('montre ce qu’un autre onglet y a saisi : le bloc, les chiffres et l’envoi à refaire', async ({
        page,
        request,
    }) => {
        const date = await open(page, request, 2, []);
        await expect(page.getByText('Aucun ticket pour ce jour')).toBeVisible();

        const other = await otherTab(page, date);
        await doubleClickSlot(other, '09:00');
        const field = ticketWindow(other).getByLabel('Ticket');
        await field.fill('SHOP-482');
        await field.press('Enter');
        await expect(ticketWindow(other)).toHaveCount(0);
        await expect.poll(() => savedDay(request, date)).toMatchObject([{ start: '09:00', ticket: 'SHOP-482' }]);
        await other.close();

        await expect(page.getByText('Aucun ticket pour ce jour')).toBeVisible();
        await comeBack(page);
        await expect(page.getByText('Aucun ticket pour ce jour')).toHaveCount(0);
        await expectGridMatchesBase(page, request, date);
        await expect(figures(page)).toContainText('0h15');
        await expect(sendButton(page)).toHaveAccessibleName('Envoyer sur Jira, journée non envoyée');
    });

    test('montre « Envoi en cours » d’un envoi lancé ailleurs, puis son résultat', async ({ page, request }) => {
        const date = await open(page, request, 3, HOUR);
        // Ce que le serveur dit d'une journée qu'un autre onglet envoie, jusqu'à ce qu'il ait fini.
        let elsewhere = true;
        await rewriteSend(page, (send) => (elsewhere ? { ...send, state: 'sending' } : send));

        await comeBack(page);
        await expect(sendButton(page)).toHaveText('Envoi en cours');
        await expect(sendButton(page)).toHaveAttribute('aria-busy', 'true');

        const other = await otherTab(page, date);
        await sendButton(other).click();
        await sendWindow(other, 'Envoyer sur Jira').getByRole('button', { name: 'Envoyer sur Jira' }).click();
        await expect(sendButton(other)).toHaveText(/^Envoyé à \d{2}:\d{2}$/);
        await other.close();
        elsewhere = false;

        // La journée se relit tant que l'envoi n'a pas fini, sans attendre un autre retour.
        await expect(sendButton(page)).toHaveText(/^Envoyé à \d{2}:\d{2}$/);
        await expect(sendButton(page)).not.toHaveAttribute('aria-busy', 'true');
    });

    test('n’envoie pas une journée changée ailleurs depuis l’ouverture de la confirmation', async ({
        page,
        request,
    }) => {
        const date = await open(page, request, 9, HOUR);
        await sendButton(page).click();
        const confirm = sendWindow(page, 'Envoyer sur Jira');
        await expect(confirm.getByRole('listitem')).toHaveText([/SHOP-482.*1h00/, /Total.*1h00/]);

        // Ailleurs, un ticket s'ajoute ; au retour, la confirmation le montre.
        await writeDay(request, date, [...HOUR, { start: '09:00', end: '09:30', ticket: 'OPS-7' }], 90);
        await comeBack(page);
        await expect(confirm.getByRole('listitem')).toHaveText([/SHOP-482.*1h00/, /OPS-7.*0h30/, /Total.*1h30/]);

        // Elle s'était ouverte sur une autre journée : rien ne part.
        await confirm.getByRole('button', { name: 'Envoyer sur Jira' }).click();
        await expect(message(page)).toContainText("La journée a changé entre-temps. Rien n'a été envoyé.");
        expect(await receivedWorklogs(request, date)).toEqual([]);

        // Rouverte, elle envoie ce qu'elle montre.
        await sendButton(page).click();
        await sendWindow(page, 'Envoyer sur Jira').getByRole('button', { name: 'Envoyer sur Jira' }).click();
        await expect(sendButton(page)).toHaveText(/^Envoyé à \d{2}:\d{2}$/);
        expect((await receivedWorklogs(request, date)).map((worklog) => worklog.ticket)).toEqual(['OPS-7', 'SHOP-482']);
    });

    test('ouvre la confirmation sur la journée relue quand la relecture est encore en route, et l’envoie', async ({
        page,
        request,
    }) => {
        const date = await open(page, request, 11, HOUR);
        await writeDay(request, date, [...HOUR, { start: '09:00', end: '09:30', ticket: 'OPS-7' }], 90);
        // La relecture du retour attend qu'on la lâche : le bouton Jira est cliqué avant.
        let release: () => void = () => undefined;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        await page.route(`**/api/days/${date}`, async (route) => {
            await held;
            await route.fallback();
        });
        await comeBack(page);
        await sendButton(page).click();
        release();

        const confirm = sendWindow(page, 'Envoyer sur Jira');
        await expect(confirm.getByRole('listitem')).toHaveText([/SHOP-482.*1h00/, /OPS-7.*0h30/, /Total.*1h30/]);
        await confirm.getByRole('button', { name: 'Envoyer sur Jira' }).click();
        await expect(sendButton(page)).toHaveText(/^Envoyé à \d{2}:\d{2}$/);
        expect((await receivedWorklogs(request, date)).map((worklog) => worklog.ticket)).toEqual(['OPS-7', 'SHOP-482']);
    });

    test('ne remontre pas une confirmation quittée par les flèches du navigateur ; rouverte, elle envoie la journée relue', async ({
        page,
        request,
    }) => {
        const before = workday(12);
        await writeDay(request, before, []);
        const date = await open(page, request, 13, HOUR);
        await page.getByRole('button', { name: 'Jour précédent' }).click();
        await expect(page).toHaveURL(new RegExp(`/${before}$`));
        await page.goBack();
        await expect(page).toHaveURL(new RegExp(`/${date}$`));
        await expect(figures(page)).toBeVisible();
        await sendButton(page).click();
        const confirm = sendWindow(page, 'Envoyer sur Jira');
        await expect(confirm.getByRole('listitem')).toHaveText([/SHOP-482.*1h00/, /Total.*1h00/]);

        // Suivant puis Précédent : la journée se relit à neuf, sans sa confirmation.
        await page.goForward();
        await expect(page).toHaveURL(new RegExp(`/${before}$`));
        await page.goBack();
        await expect(page).toHaveURL(new RegExp(`/${date}$`));
        await expect(figures(page)).toBeVisible();
        await expect(confirm).toHaveCount(0);

        // Changée ailleurs, relue au retour : rouverte, elle montre ce qui partira, et l'envoie.
        await writeDay(request, date, [...HOUR, { start: '09:00', end: '09:30', ticket: 'OPS-7' }], 90);
        await comeBack(page);
        await expect(confirm).toHaveCount(0);
        await expect(page.getByRole('list', { name: 'Saisies du jour' })).toContainText('OPS-7');
        await sendButton(page).click();
        await expect(confirm.getByRole('listitem')).toHaveText([/SHOP-482.*1h00/, /OPS-7.*0h30/, /Total.*1h30/]);
        await confirm.getByRole('button', { name: 'Envoyer sur Jira' }).click();
        await expect(sendButton(page)).toHaveText(/^Envoyé à \d{2}:\d{2}$/);
        expect((await receivedWorklogs(request, date)).map((worklog) => worklog.ticket)).toEqual(['OPS-7', 'SHOP-482']);
    });

    for (const how of ['Escape', 'grid'] as const) {
        test(`renonce à la confirmation demandée pendant une relecture, par ${how === 'Escape' ? 'Échap' : 'un clic sur la grille'}`, async ({
            page,
            request,
        }) => {
            const date = await open(page, request, how === 'Escape' ? 14 : 15, HOUR);
            let release: () => void = () => undefined;
            const held = new Promise<void>((resolve) => {
                release = resolve;
            });
            await page.route(`**/api/days/${date}`, async (route) => {
                await held;
                await route.fallback();
            });
            await comeBack(page);
            await sendButton(page).click();
            if (how === 'Escape') {
                await page.keyboard.press('Escape');
            } else {
                await clickSlot(page, '10:00');
            }
            const read = page.waitForResponse(`**/api/days/${date}`);
            release();
            await read;

            // La journée relue est à l'écran : la confirmation ne s'ouvre pas pour autant.
            await expect(page.getByRole('list', { name: 'Saisies du jour' })).toContainText('SHOP-482');
            await expect(page.getByRole('listbox', { name: 'Créneaux de la journée' })).toHaveAttribute(
                'aria-busy',
                'false',
            );
            await expect(sendWindow(page, 'Envoyer sur Jira')).toHaveCount(0);
            await sendButton(page).click();
            await expect(sendWindow(page, 'Envoyer sur Jira')).toBeVisible();
        });
    }

    test('ferme le résultat d’un envoi partiel quand la journée a changé ailleurs, et repart de la confirmation', async ({
        page,
        request,
    }) => {
        const date = await open(page, request, 10, [
            { start: '09:00', end: '10:00', ticket: 'SHOP-482' },
            { start: '10:00', end: '10:30', ticket: 'FERME-1' },
        ]);
        await sendButton(page).click();
        await sendWindow(page, 'Envoyer sur Jira').getByRole('button', { name: 'Envoyer sur Jira' }).click();
        const result = sendWindow(page, 'Envoi partiel');
        await expect(result).toContainText("1 ticket sur 2 est dans Jira. FERME-1 n'a pas été envoyé.");

        await writeDay(
            request,
            date,
            [
                { start: '09:00', end: '10:00', ticket: 'SHOP-482' },
                { start: '10:00', end: '10:30', ticket: 'OPS-7' },
            ],
            90,
        );
        await comeBack(page);
        await expect(page.getByRole('list', { name: 'Saisies du jour' })).toContainText('OPS-7');
        await expect(result).toHaveCount(0);
        await expect(sendButton(page)).toBeFocused();
        expect((await receivedWorklogs(request, date)).map((worklog) => worklog.ticket)).toEqual(['SHOP-482']);

        // Le bouton mène à la confirmation de la journée telle qu'elle partira.
        await sendButton(page).click();
        const confirm = sendWindow(page, 'Envoyer sur Jira');
        await expect(confirm.getByRole('listitem')).toContainText([/SHOP-482.*1h00/, /OPS-7.*0h30/]);
    });

    test('ferme le détail d’un envoi quand la journée a changé ailleurs : il dirait envoyé ce qui ne l’est pas', async ({
        page,
        request,
    }) => {
        const date = await open(page, request, 16, HOUR);
        await sendButton(page).click();
        await sendWindow(page, 'Envoyer sur Jira').getByRole('button', { name: 'Envoyer sur Jira' }).click();
        await expect(sendButton(page)).toHaveText(/^Envoyé à \d{2}:\d{2}$/);
        await sendButton(page).click();
        const detail = sendWindow(page, 'Envoyé sur Jira');
        await expect(detail.getByRole('listitem')).toHaveText([/Envoyé.*SHOP-482.*1h00/, /Total.*1h00/]);

        await writeDay(request, date, [...HOUR, { start: '09:00', end: '09:30', ticket: 'OPS-7' }], 90);
        await comeBack(page);
        await expect(detail).toHaveCount(0);
        await expect(sendButton(page)).toHaveAccessibleName("Renvoyer sur Jira, modifié depuis l'envoi");
        await expect(sendButton(page)).toBeFocused();
        expect((await receivedWorklogs(request, date)).map((worklog) => worklog.ticket)).toEqual(['SHOP-482']);
    });

    test('garde ouverte la fenêtre de ticket et ce qu’on y a tapé, et dit ce qu’elle remplacera', async ({
        page,
        request,
    }) => {
        const date = await open(page, request, 4, HOUR);
        await doubleClickSlot(page, '14:00');
        const window = ticketWindow(page, 'Modifier le ticket');
        await window.getByLabel('Ticket').fill('OPS-12');
        await window.getByLabel('Commentaire').fill('Daily');

        // Ailleurs, le même bloc change de ticket.
        await writeDay(request, date, [{ start: '14:00', end: '15:00', ticket: 'OPS-7' }], 60);
        await comeBack(page);

        const replaced = ticketWindow(page);
        await expect(replaced).toContainText(STALE);
        await expect(replaced).toContainText('Remplace OPS-7 sur ces 60 minutes.');
        await expect(replaced.getByLabel('Ticket')).toHaveValue('OPS-12');
        await expect(replaced.getByLabel('Commentaire')).toHaveValue('Daily');
        await expect(replaced.getByLabel('Commentaire')).toBeFocused();
        await expect(page.getByRole('list', { name: 'Saisies du jour' })).toContainText('OPS-7');

        // Enregistrée, elle écrit ce qu'on a tapé, une seule fois.
        await replaced.getByLabel('Commentaire').press('Enter');
        await expect(replaced).toHaveCount(0);
        expect(await savedDay(request, date)).toMatchObject([
            { start: '14:00', end: '15:00', ticket: 'OPS-12', comment: 'Daily' },
        ]);
        await expectGridMatchesBase(page, request, date);
    });

    test('ne touche pas la fenêtre de ticket quand rien n’a changé sous elle', async ({ page, request }) => {
        const date = await open(page, request, 5, HOUR);
        await doubleClickSlot(page, '14:00');
        const window = ticketWindow(page, 'Modifier le ticket');
        await window.getByLabel('Commentaire').fill('Revue et tests');

        await writeDay(request, date, [...HOUR, { start: '09:00', end: '09:30', ticket: 'OPS-7' }], 90);
        await comeBack(page);

        await expect(page.getByRole('list', { name: 'Saisies du jour' })).toContainText('OPS-7');
        await expect(window).toBeVisible();
        await expect(window).not.toContainText(STALE);
        await expect(window.getByLabel('Commentaire')).toHaveValue('Revue et tests');
        await window.getByLabel('Commentaire').press('Enter');
        await expect(window).toHaveCount(0);
        expect(await savedDay(request, date)).toMatchObject([
            { start: '09:00', ticket: 'OPS-7' },
            { start: '14:00', ticket: 'SHOP-482', comment: 'Revue et tests' },
        ]);
    });

    test('garde la fenêtre Objectif ouverte : elle suit l’objectif changé ailleurs, ou garde ce qu’on a tapé', async ({
        page,
        request,
    }) => {
        const date = await open(page, request, 6, HOUR);
        await objectiveButton(page).click();
        const field = objectiveWindow(page).getByLabel('Durée à travailler');
        await expect(field).toHaveValue('1h00');

        // Rien de tapé : elle montre l'objectif choisi ailleurs, et un clic à côté n'écrit rien.
        await writeDay(request, date, HOUR, 120);
        await comeBack(page);
        await expect(field).toHaveValue('2h00');
        await expect(objectiveWindow(page)).toContainText(STALE);
        await page.keyboard.press('Escape');
        await expect(objectiveWindow(page)).toHaveCount(0);
        await expect(objectiveButton(page)).toContainText('2h00');

        // Tapé : elle le garde, et l'enregistre.
        await objectiveButton(page).click();
        await field.fill('3h00');
        await writeDay(request, date, HOUR, 240);
        // Un second retour sur l'onglet : la fenêtre qui reprend la main dans la seconde qui
        // suit serait le même retour (useReturns).
        await comeBack(page);
        await expect(objectiveButton(page)).toContainText('4h00');
        await expect(objectiveWindow(page)).toContainText(STALE);
        await expect(field).toHaveValue('3h00');
        await objectiveWindow(page).getByRole('button', { name: 'Enregistrer' }).click();
        await expect(objectiveWindow(page)).toHaveCount(0);
        await expect(objectiveButton(page)).toContainText('3h00');
    });

    test('n’applique pas au jour affiché une relecture arrivée après un changement de jour', async ({
        page,
        request,
    }) => {
        const first = await open(page, request, 7, HOUR);
        const second = workday(8);
        await writeDay(request, second, [{ start: '09:00', end: '09:30', ticket: 'OPS-7' }], 30);

        // La relecture du premier jour attend qu'on soit passé au suivant.
        let release: () => void = () => undefined;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        await page.route(`**/api/days/${first}`, async (route) => {
            await held;
            await route.fallback();
        });
        await writeDay(request, first, [{ start: '14:00', end: '15:00', ticket: 'OPS-12' }], 60);
        await comeBack(page);
        await page.getByRole('button', { name: 'Jour suivant' }).click();
        await expect(page).toHaveURL(new RegExp(`/${second}$`));
        await expectGridMatchesBase(page, request, second);

        const answered = page.waitForResponse(`**/api/days/${first}`);
        release();
        await answered;
        await expectGridMatchesBase(page, request, second);
        await expect(page.getByRole('list', { name: 'Saisies du jour' })).not.toContainText('OPS-12');

        await page.unroute(`**/api/days/${first}`);
        await page.getByRole('button', { name: 'Jour précédent' }).click();
        await expect(page).toHaveURL(new RegExp(`/${first}$`));
        await expectGridMatchesBase(page, request, first);
    });
});
