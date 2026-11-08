import type { Page } from '@playwright/test';

import { weekdaysFrom, writeDay } from './day';
import { doubleClickSlot, figures, savedDay, ticketWindow } from './editing';
import { expect, refusedWith, test } from './fixtures';
import { holdSend, sendButton, sendWindow } from './send';

/**
 * Les flèches Précédent et Suivant du navigateur, quand elles ne quittent pas l'écran tout
 * de suite : vers les réglages, elles font comme le bouton Réglages, sans recharger la page ;
 * refusées — une fenêtre refusée, un envoi en cours, des réglages refusés —, elles laissent
 * l'historique tel qu'il était.
 */

/** Les jours de ce fichier : des jours de semaine de novembre 2022, que nul autre ne prend. */
const workday = weekdaysFrom('2022-11-07');

const SHAPE_REFUSAL = "Un identifiant de ticket s'écrit comme SHOP-482.";

test.use({ expectedErrors: [refusedWith(422)] });

/**
 * Retient la page : un rechargement emporterait la marque, et la boîte « Quitter le site ? »
 * ferait échouer le parcours.
 */
async function watchReloads(page: Page): Promise<() => Promise<boolean>> {
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
        dialogs.push(dialog.type());
        void dialog.dismiss();
    });
    await page.evaluate(() => {
        (window as { kept?: boolean }).kept = true;
    });

    return async () => {
        expect(dialogs).toEqual([]);

        return page.evaluate(() => (window as { kept?: boolean }).kept === true);
    };
}

function title(page: Page) {
    return page.getByRole('heading', { level: 1 });
}

function settingsTitle(page: Page) {
    return page.getByRole('heading', { name: 'Réglages', level: 1 });
}

/** Ouvre ce jour, puis les réglages et « Retour à la journée » : Précédent mène aux réglages. */
async function settingsBehind(page: Page, date: string): Promise<void> {
    await page.goto(`/${date}`);
    await expect(figures(page)).toBeVisible();
    await page.getByRole('button', { name: 'Réglages' }).click();
    await expect(settingsTitle(page)).toBeVisible();
    await page.getByRole('link', { name: 'Retour à la journée' }).click();
    await expect(figures(page)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/${date}$`));
}

/** Trois jours visités l'un après l'autre par « Jour suivant », puis Précédent : on est sur le deuxième. */
async function middleOfThree(page: Page, first: string): Promise<void> {
    await page.goto(`/${first}`);
    await expect(figures(page)).toBeVisible();
    for (let index = 0; index < 2; index += 1) {
        await page.getByRole('button', { name: 'Jour suivant' }).click();
        await expect(figures(page)).toBeVisible();
    }
    await page.goBack();
    await expect(figures(page)).toBeVisible();
}

test.describe('la flèche du navigateur vers les réglages, un ticket en cours de saisie', () => {
    test('enregistre la fenêtre, puis ouvre les réglages sans recharger la page', async ({ page, request }) => {
        const date = workday(0);
        await writeDay(request, date, []);
        await settingsBehind(page, date);
        const kept = await watchReloads(page);

        await doubleClickSlot(page, '09:00');
        await ticketWindow(page).getByLabel('Ticket').fill('SHOP-482');
        await page.goBack();

        await expect(settingsTitle(page)).toBeVisible();
        await expect(page).toHaveURL(/\/reglages$/);
        expect(await kept()).toBe(true);
        expect(await savedDay(request, date)).toMatchObject([{ start: '09:00', end: '09:15', ticket: 'SHOP-482' }]);

        // « Retour à la journée » ramène au jour qu'on a quitté.
        await page.getByRole('link', { name: 'Retour à la journée' }).click();
        await expect(page).toHaveURL(new RegExp(`/${date}$`));
        await expect(page.getByRole('list', { name: 'Saisies du jour' })).toContainText('SHOP-482');
    });

    test('refusée, la fenêtre reste ouverte avec son message, l’adresse dit la journée, et l’historique ne bouge pas', async ({
        page,
        request,
    }) => {
        const date = workday(1);
        await writeDay(request, date, []);
        await settingsBehind(page, date);
        const kept = await watchReloads(page);
        const steps = await page.evaluate(() => history.length);

        await doubleClickSlot(page, '09:00');
        const ticket = ticketWindow(page).getByLabel('Ticket');
        await ticket.fill('pas un ticket');
        await page.goBack();

        await expect(ticket).toHaveAccessibleDescription(SHAPE_REFUSAL);
        await expect(page).toHaveURL(new RegExp(`/${date}$`));
        await expect(settingsTitle(page)).toHaveCount(0);
        expect(await kept()).toBe(true);
        expect(await page.evaluate(() => history.length)).toBe(steps);

        // Corrigée, Précédent mène toujours aux réglages, puis Suivant au jour.
        await ticket.fill('SHOP-482');
        await page.goBack();
        await expect(settingsTitle(page)).toBeVisible();
        await page.goForward();
        await expect(page).toHaveURL(new RegExp(`/${date}$`));
        await expect(page.getByRole('list', { name: 'Saisies du jour' })).toContainText('SHOP-482');
        expect(await kept()).toBe(true);
    });

    test('pendant un envoi, rien ne s’ouvre et l’historique ne bouge pas', async ({ page, request }) => {
        const date = workday(2);
        await writeDay(request, date, [{ start: '09:00', end: '10:00', ticket: 'SHOP-482' }], 60);
        await settingsBehind(page, date);
        const release = await holdSend(page, date);
        await sendButton(page).click();
        await sendWindow(page, 'Envoyer sur Jira').getByRole('button', { name: 'Envoyer sur Jira' }).click();
        await expect(sendButton(page)).toHaveText('Envoi en cours');

        await page.goBack();
        await expect(page).toHaveURL(new RegExp(`/${date}$`));
        await expect(settingsTitle(page)).toHaveCount(0);

        await release();
        await expect(sendButton(page)).not.toHaveText('Envoi en cours');
        await page.goBack();
        await expect(settingsTitle(page)).toBeVisible();
    });
});

test.describe('Suivant du navigateur refusé, puis Précédent', () => {
    test('par une fenêtre refusée : Précédent mène au jour d’où l’on venait', async ({ page, request }) => {
        const [first, second, third] = [workday(3), workday(4), workday(5)];
        for (const date of [first, second, third]) {
            await writeDay(request, date, []);
        }
        await middleOfThree(page, first);
        await expect(page).toHaveURL(new RegExp(`/${second}$`));

        await doubleClickSlot(page, '09:00');
        const ticket = ticketWindow(page).getByLabel('Ticket');
        await ticket.fill('pas un ticket');
        await page.goForward();
        await expect(ticket).toHaveAccessibleDescription(SHAPE_REFUSAL);
        await expect(page).toHaveURL(new RegExp(`/${second}$`));
        await page.keyboard.press('Escape');
        await expect(ticketWindow(page)).toHaveCount(0);

        await page.goBack();
        await expect(page).toHaveURL(new RegExp(`/${first}$`));
        await expect(title(page)).toContainText(String(Number(first.slice(-2))));
        await page.goForward();
        await expect(page).toHaveURL(new RegExp(`/${second}$`));
        await page.goForward();
        await expect(page).toHaveURL(new RegExp(`/${third}$`));
        await expect(title(page)).toContainText(String(Number(third.slice(-2))));
    });

    test('par un envoi en cours : Précédent mène au jour d’où l’on venait', async ({ page, request }) => {
        const [first, second, third] = [workday(6), workday(7), workday(8)];
        for (const date of [first, third]) {
            await writeDay(request, date, []);
        }
        await writeDay(request, second, [{ start: '09:00', end: '10:00', ticket: 'SHOP-482' }], 60);
        await middleOfThree(page, first);
        await expect(page).toHaveURL(new RegExp(`/${second}$`));
        const release = await holdSend(page, second);
        await sendButton(page).click();
        await sendWindow(page, 'Envoyer sur Jira').getByRole('button', { name: 'Envoyer sur Jira' }).click();
        await expect(sendButton(page)).toHaveText('Envoi en cours');

        await page.goForward();
        await expect(page).toHaveURL(new RegExp(`/${second}$`));
        await release();
        await expect(sendButton(page)).not.toHaveText('Envoi en cours');

        await page.goBack();
        await expect(page).toHaveURL(new RegExp(`/${first}$`));
        await page.goForward();
        await page.goForward();
        await expect(page).toHaveURL(new RegExp(`/${third}$`));
    });
});

test.describe('depuis les réglages, une flèche refusée', () => {
    test('les garde ouverts, et Précédent mène ensuite où il menait', async ({ page, request }) => {
        const date = workday(9);
        await writeDay(request, date, []);
        await settingsBehind(page, date);
        await page.goBack();
        await expect(settingsTitle(page)).toBeVisible();
        const steps = await page.evaluate(() => history.length);

        // Suivant, vers la journée, refusé par un objectif qui ne tombe pas sur un quart d'heure.
        const objective = page.getByRole('textbox', { name: 'Objectif habituel' });
        await objective.fill('8h10');
        await page.goForward();
        await expect(objective).toHaveAttribute('aria-invalid', 'true');
        await expect(page).toHaveURL(/\/reglages$/);
        expect(await page.evaluate(() => history.length)).toBe(steps);

        // Corrigé, Précédent mène au jour d'avant les réglages, et Suivant deux fois au dernier.
        await objective.fill('8h00');
        await page.goBack();
        await expect(page).toHaveURL(new RegExp(`/${date}$`));
        await expect(figures(page)).toBeVisible();
        await page.goForward();
        await expect(settingsTitle(page)).toBeVisible();
        await page.goForward();
        await expect(page).toHaveURL(new RegExp(`/${date}$`));
        await expect(figures(page)).toBeVisible();
    });
});
