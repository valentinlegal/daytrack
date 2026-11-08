import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { type Entry, startTimeAt, weekdaysFrom, writeDay } from './day';
import { message } from './editing';
import { expect, expectAccessible, refusedWith, test } from './fixtures';
import { clearSentDay, receivedWorklogs, rewriteSend, sendButton, sendWindow } from './send';

/**
 * L'envoi sur Jira, de bout en bout : la confirmation, l'écran bloqué le temps de
 * l'envoi, ce que le Jira simulé a reçu, l'état gardé au rechargement, le renvoi qui ne
 * change que ce qui a changé, l'envoi partiel et l'échec ticket par ticket. Rien ne part
 * vers un vrai Jira.
 */

/** Le jour d'un parcours : un jour de semaine de l'été 2023, que nul autre parcours ne prend. */
const workday = weekdaysFrom('2023-07-03');

const DAY: Entry[] = [
    { start: '09:00', end: '10:30', ticket: 'SHOP-482', comment: 'Revue de code' },
    { start: '10:30', end: '11:00', ticket: 'OPS-12' },
    { start: '12:00', end: '13:00' },
    { start: '13:00', end: '14:00', ticket: 'SHOP-482', comment: 'Revue de code' },
];

/**
 * Ouvre le jour d'un parcours, ses saisies posées, le récapitulatif ouvert. Son objectif
 * est le temps saisi : un jour passé sous son objectif porterait « Incomplet », qui
 * l'emporte sur la marque de son envoi.
 */
async function open(
    page: Page,
    request: APIRequestContext,
    index: number,
    entries: readonly Entry[] = DAY,
): Promise<string> {
    const date = workday(index);
    await clearSentDay(request, date);
    await writeDay(request, date, entries, workedIn(entries));
    await page.setViewportSize({ width: 1440, height: 900 });
    await startTimeAt(page, date, '18:00');
    await page.goto(`/${date}`);
    await expect(page.getByRole('group', { name: 'Chiffres du jour' })).toBeVisible();

    return date;
}

function workedIn(entries: readonly Entry[]): number {
    const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

    return entries.reduce(
        (sum, entry) => sum + (entry.ticket === undefined ? 0 : minutes(entry.end) - minutes(entry.start)),
        0,
    );
}

async function confirmSend(page: Page): Promise<void> {
    await sendButton(page).click();
    await sendWindow(page, 'Envoyer sur Jira').getByRole('button', { name: 'Envoyer sur Jira' }).click();
}

test.describe('l’envoi sur Jira', () => {
    test('confirme, envoie, puis dit la journée envoyée, même rechargée', async ({ page, request }) => {
        const date = await open(page, request, 0);

        await expect(sendButton(page)).toHaveAccessibleName('Envoyer sur Jira, journée non envoyée');
        await sendButton(page).click();

        const confirm = sendWindow(page, 'Envoyer sur Jira');
        await expect(confirm).toBeVisible();
        // Le jour, sous le titre, se lit aussi au lecteur d'écran.
        await expect(confirm).toHaveAccessibleDescription(/^[A-Z]\S+ \d{1,2} \S+$/);
        await expect(confirm).toContainText(
            'Les heures déjà déclarées dans Jira pour ce jour seront remplacées par celles-ci.',
        );
        await expect(confirm.getByRole('listitem')).toHaveText([/SHOP-482.*2h30/, /OPS-12.*0h30/, /Total.*3h00/]);
        await expect(confirm).toContainText("La pause n'est pas envoyée.");
        await expectTable(confirm, 'OPS-12', 'SHOP-482');

        await confirm.getByRole('button', { name: 'Envoyer sur Jira' }).click();

        await expect(sendButton(page)).toHaveText(/^Envoyé à \d{2}:\d{2}$/);
        await expect(confirm).toBeHidden();
        expect(await receivedWorklogs(request, date)).toEqual([
            { id: expect.any(String), ticket: 'SHOP-482', time: '09:00', seconds: 9000, comment: 'Revue de code' },
            { id: expect.any(String), ticket: 'OPS-12', time: '10:30', seconds: 1800, comment: null },
        ]);

        await page.reload();
        await expect(sendButton(page)).toHaveText(/^Envoyé à \d{2}:\d{2}$/);
        await sendButton(page).click();
        const detail = sendWindow(page, 'Envoyé sur Jira');
        await expect(detail).toContainText('Ces heures sont dans Jira pour ce jour.');
        await expect(detail).toHaveAccessibleDescription(/^[A-Z]\S+ \d{1,2} \S+ à \d{2}:\d{2}$/);
        await expect(detail.getByRole('listitem')).toHaveText([
            /Envoyé.*SHOP-482.*2h30/,
            /Envoyé.*OPS-12.*0h30/,
            /Total.*3h00/,
        ]);
        await expectTable(detail, 'OPS-12', 'SHOP-482');
        await expect(detail).not.toContainText('Renvoyer sur Jira');
        await expect(sendButton(page)).toHaveAttribute('data-state', 'open');
        await page.keyboard.press('Escape');
        await expect(detail).toBeHidden();
        await expect(sendButton(page)).toBeFocused();
    });

    test('renvoie seulement ce qui a changé, et retire de Jira un ticket retiré de la journée', async ({
        page,
        request,
    }) => {
        const date = await open(page, request, 1);
        await confirmSend(page);
        await expect(sendButton(page)).toHaveText(/^Envoyé à/);
        const [first] = await receivedWorklogs(request, date);

        await writeDay(request, date, [
            { start: '09:00', end: '10:45', ticket: 'SHOP-482', comment: 'Revue de code' },
            { start: '12:00', end: '13:00' },
        ]);
        await page.reload();
        await expect(sendButton(page)).toHaveAccessibleName("Renvoyer sur Jira, modifié depuis l'envoi");
        await sendButton(page).click();
        const confirm = sendWindow(page, 'Envoyer sur Jira');
        await expect(confirm.getByRole('listitem')).toHaveText([/SHOP-482.*1h45/, /OPS-12.*0h00/, /Total.*1h45/]);
        await confirm.getByRole('button', { name: 'Envoyer sur Jira' }).click();

        await expect(sendButton(page)).toHaveText(/^Envoyé à/);
        expect(await receivedWorklogs(request, date)).toEqual([
            { id: first?.id, ticket: 'SHOP-482', time: '09:00', seconds: 6300, comment: 'Revue de code' },
        ]);
    });

    test('bloque l’écran le temps de l’envoi, souris et clavier', async ({ page, request }) => {
        const date = await open(page, request, 2);
        let release: () => void = () => undefined;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        await page.route(`**/api/days/${date}/send`, async (route) => {
            await held;
            await route.fallback();
        });

        await confirmSend(page);

        await expect(sendButton(page)).toHaveText('Envoi en cours');
        await expect(sendButton(page)).toHaveAttribute('aria-busy', 'true');
        await expect(page.locator('.day-screen')).toHaveAttribute('aria-busy', 'true');
        await expect(page.locator('.send-veil')).toBeVisible();
        await expect(page.locator('[aria-live="polite"]').filter({ hasText: 'Envoi sur Jira en cours' })).toHaveCount(
            1,
        );
        // Ni Échap, ni annuler, ni changer de jour : la journée envoyée est celle qu'on voit.
        await page.keyboard.press('Escape');
        await page.keyboard.press('ControlOrMeta+z');
        await expect(page.getByRole('navigation', { name: 'Changer de jour' })).toHaveAttribute('inert', '');
        await expect(
            page
                .getByRole('banner')
                .getByRole('link', { name: /^DayTrack/ })
                .locator('..'),
        ).toHaveAttribute('inert', '');
        await page.locator('.send-veil').click({ position: { x: 200, y: 200 } });
        await expect(page.getByRole('listbox')).not.toBeFocused();
        await sendButton(page).click();

        release();
        await expect(sendButton(page)).toHaveText(/^Envoyé à/);
        await expect(page.locator('.send-veil')).toHaveCount(0);
        await expect(page.getByRole('navigation', { name: 'Changer de jour' })).not.toHaveAttribute('inert', '');
        expect(await receivedWorklogs(request, date)).toHaveLength(2);
    });

    test('les flèches du navigateur ne quittent pas la journée avant l’issue de l’envoi', async ({ page, request }) => {
        const date = await open(page, request, 45);
        const title = page.getByRole('heading', { level: 1 });
        const shown = await title.textContent();
        // Avant le jour envoyé, l'historique a un autre jour, puis les réglages.
        await page.evaluate(
            ([other, date]) => {
                history.pushState(null, '', `/${other}`);
                history.pushState(null, '', '/reglages');
                history.pushState(null, '', `/${date}`);
                (window as { notReloaded?: boolean }).notReloaded = true;
            },
            [workday(46), date] as const,
        );
        let release: () => void = () => undefined;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        await page.route(`**/api/days/${date}/send`, async (route) => {
            await held;
            await route.fallback();
        });
        await confirmSend(page);
        await expect(page.locator('.send-veil')).toBeVisible();

        // Vers les réglages : la page ne se recharge pas. Vers un autre jour : il ne s'ouvre pas.
        await page.goBack();
        await page.evaluate(
            () =>
                new Promise<void>((resolve) => {
                    window.addEventListener(
                        'popstate',
                        () => {
                            resolve();
                        },
                        { once: true },
                    );
                    history.go(-2);
                }),
        );
        await expect(page).toHaveURL(`/${date}`);
        await expect(title).toHaveText(shown ?? '');
        await expect(page.locator('.send-veil')).toBeVisible();
        expect(await page.evaluate(() => (window as { notReloaded?: boolean }).notReloaded)).toBe(true);

        release();
        await expect(sendButton(page)).toHaveText(/^Envoyé à/);
        await expect(page.locator('.send-veil')).toHaveCount(0);
        await expect(page).toHaveURL(`/${date}`);
        expect(await receivedWorklogs(request, date)).toHaveLength(2);
    });

    test('se fait au clavier, et une Entrée répétée n’envoie rien sans confirmation', async ({ page, request }) => {
        const date = await open(page, request, 3);
        await sendButton(page).focus();

        // Le curseur entre dans la fenêtre, sur « Annuler » : une seconde Entrée la ferme.
        await page.keyboard.press('Enter');
        const confirm = sendWindow(page, 'Envoyer sur Jira');
        await expect(confirm.getByRole('button', { name: 'Annuler' })).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(confirm).toBeHidden();
        await expect(sendButton(page)).toBeFocused();
        await page.keyboard.press('Enter');
        await page.keyboard.press('Escape');
        await expect(confirm).toBeHidden();
        await expect(sendButton(page)).toBeFocused();
        expect(await receivedWorklogs(request, date)).toEqual([]);

        await page.keyboard.press('Enter');
        await page.keyboard.press('Tab');
        await expect(confirm.getByRole('button', { name: 'Envoyer sur Jira' })).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(sendButton(page)).toHaveText(/^Envoyé à/);
        await expect(sendButton(page)).toBeFocused();

        await page.keyboard.press('Enter');
        await expect(sendWindow(page, 'Envoyé sur Jira').getByRole('button', { name: 'Fermer' }).last()).toBeFocused();
    });

    test('dit un envoi partiel ticket par ticket, et le relance depuis sa fenêtre', async ({ page, request }) => {
        const date = await open(page, request, 4, [
            { start: '09:00', end: '10:00', ticket: 'SHOP-482' },
            { start: '10:00', end: '10:30', ticket: 'FERME-1' },
        ]);
        await confirmSend(page);

        const result = sendWindow(page, 'Envoi partiel');
        await expect(result).toBeVisible();
        await expect(result).toContainText("1 ticket sur 2 est dans Jira. FERME-1 n'a pas été envoyé.");
        await expect(result.getByRole('listitem')).toHaveText([
            /Envoyé.*SHOP-482.*1h00/,
            /Non envoyé.*FERME-1.*0h30.*Jira refuse les heures de ce ticket fermé\./,
        ]);
        await expect(sendButton(page)).toHaveAccessibleName("Réessayer l'envoi, envoi partiel");
        const recap = page.getByRole('complementary', { name: 'Récapitulatif' });
        await expect(recap.getByRole('listitem').filter({ hasText: 'SHOP-482' })).toContainText('Envoyé');
        await expect(recap.getByRole('listitem').filter({ hasText: 'FERME-1' })).toContainText('Non envoyé');

        await result.getByRole('button', { name: 'Fermer' }).last().click();
        await expect(result).toBeHidden();
        await sendButton(page).hover();
        await expect(page.getByRole('tooltip')).toHaveText('Envoi partiel. Cliquez pour voir le détail.');

        await sendButton(page).click();
        await result.getByRole('button', { name: "Réessayer l'envoi" }).click();
        await expect(result).toBeVisible();
        await expect(result).toContainText('Jira refuse les heures de ce ticket fermé.');

        // Modifiée, la journée repart de la confirmation : le résultat parlerait d'autres tickets.
        await result.getByRole('button', { name: 'Fermer' }).last().click();
        await writeDay(request, date, [
            { start: '09:00', end: '10:00', ticket: 'SHOP-482' },
            { start: '10:00', end: '10:30', ticket: 'OPS-7' },
        ]);
        await page.reload();
        await expect(sendButton(page)).toHaveAccessibleName('Envoyer sur Jira, journée non envoyée');
        await confirmSend(page);
        await expect(sendButton(page)).toHaveText(/^Envoyé à/);
        expect((await receivedWorklogs(request, date)).map((worklog) => worklog.ticket)).toEqual(['SHOP-482', 'OPS-7']);
    });

    test('dit un envoi non vérifié, et l’essai suivant ne laisse aucun double', async ({ page, request }) => {
        const date = await open(page, request, 40, [
            { start: '09:00', end: '10:00', ticket: 'MUET-1' },
            { start: '10:00', end: '10:30', ticket: 'SHOP-482' },
        ]);

        await sendButton(page).click();
        await sendWindow(page, 'Envoyer sur Jira').getByRole('button', { name: 'Envoyer sur Jira' }).click();

        const result = sendWindow(page, 'Envoi non vérifié');
        await expect(result).toBeVisible();
        await expect(
            result.getByText(
                "1 ticket sur 2 est dans Jira. Jira a accepté les heures de MUET-1, puis n'a plus répondu : DayTrack n'a pas pu vérifier qu'elles y sont.",
            ),
        ).toBeVisible();
        await expect(
            result.getByText("Réessayer l'envoi vérifie ces heures, sans rien envoyer en double."),
        ).toBeVisible();
        await expect(result.getByRole('listitem').filter({ hasText: 'MUET-1' })).toContainText('Non vérifié');
        await expect(result.getByRole('listitem').filter({ hasText: 'SHOP-482' })).toContainText('Envoyé');

        // Jira a bien ces heures : l'écran ne dit pas le contraire.
        const received = (await receivedWorklogs(request, date)).filter((worklog) => worklog.ticket !== 'OPS-12');
        expect(received).toHaveLength(2);

        const recap = page.getByRole('complementary', { name: 'Récapitulatif' });
        await expect(recap.getByRole('listitem').filter({ hasText: 'MUET-1' })).toContainText('Non vérifié');
        await expect(recap.getByRole('listitem').filter({ hasText: 'SHOP-482' })).toContainText('Envoyé');

        await page.keyboard.press('Escape');
        await page.reload();
        await expect(page.getByRole('button', { name: "Réessayer l'envoi, envoi non vérifié" })).toBeVisible();

        await sendButton(page).click();
        await sendWindow(page, 'Envoi non vérifié').getByRole('button', { name: "Réessayer l'envoi" }).click();
        await expect(page.getByRole('button', { name: /^Envoyé à/ })).toBeVisible();
        expect((await receivedWorklogs(request, date)).filter((worklog) => worklog.ticket !== 'OPS-12')).toHaveLength(
            2,
        );
    });

    test('dit ce que Jira a gardé d’un ticket envoyé en partie', async ({ page, request }) => {
        await open(page, request, 41, [
            { start: '09:00', end: '09:30', ticket: 'MOITIE-7', comment: 'Revue' },
            { start: '09:30', end: '10:00', ticket: 'MOITIE-7', comment: 'Tests' },
            { start: '10:00', end: '10:30', ticket: 'SHOP-482' },
        ]);

        await sendButton(page).click();
        await sendWindow(page, 'Envoyer sur Jira').getByRole('button', { name: 'Envoyer sur Jira' }).click();

        const result = sendWindow(page, 'Envoi partiel');
        await expect(result.getByText("1 ticket sur 2 est dans Jira. MOITIE-7 n'y est qu'en partie.")).toBeVisible();
        await expect(result.getByText("Jira a 0h30 sur 1h00, et n'a pas répondu pour le reste.")).toBeVisible();

        const recap = page.getByRole('complementary', { name: 'Récapitulatif' });
        await expect(recap.getByRole('listitem').filter({ hasText: 'MOITIE-7' })).toContainText('Envoyé en partie');
        await expect(recap.getByRole('listitem').filter({ hasText: 'SHOP-482' })).toContainText('Envoyé');
    });

    test('montre un ticket retiré de la journée, en dernier et hors du compte', async ({ page, request }) => {
        const date = await open(page, request, 42, [
            { start: '09:00', end: '10:00', ticket: 'SHOP-482' },
            { start: '10:00', end: '10:30', ticket: 'OPS-7' },
        ]);

        await sendButton(page).click();
        await sendWindow(page, 'Envoyer sur Jira').getByRole('button', { name: 'Envoyer sur Jira' }).click();
        await expect(page.getByRole('button', { name: /^Envoyé à/ })).toBeVisible();

        // OPS-7 sort de la journée, FERME-5 y entre à sa place.
        await writeDay(request, date, [
            { start: '09:00', end: '10:00', ticket: 'SHOP-482' },
            { start: '10:00', end: '10:30', ticket: 'FERME-5' },
        ]);
        await page.reload();

        await sendButton(page).click();
        const confirm = sendWindow(page, 'Envoyer sur Jira');
        await expect(confirm.getByRole('listitem').filter({ hasText: 'OPS-7' })).toContainText(
            'Ses heures seront retirées de Jira.',
        );
        await expectUnderChip(confirm, 'OPS-7', 'Ses heures seront retirées de Jira.');
        await confirm.getByRole('button', { name: 'Envoyer sur Jira' }).click();

        const result = sendWindow(page, 'Envoi partiel');
        await expect(result.getByText("1 ticket sur 2 est dans Jira. FERME-5 n'a pas été envoyé.")).toBeVisible();
        await expect(result.getByRole('listitem').filter({ hasText: 'OPS-7' })).toContainText(
            'Retiré de la journée et de Jira.',
        );
        await expectUnderChip(result, 'OPS-7', 'Retiré de la journée et de Jira.');
        await expectUnderChip(result, 'FERME-5', 'Jira refuse les heures de ce ticket fermé.');
        await expect(
            page
                .getByRole('complementary', { name: 'Récapitulatif' })
                .getByRole('listitem')
                .filter({ hasText: 'OPS-7' }),
        ).toHaveCount(0);
    });

    test('dit sous un ticket retiré que Jira ne trouve plus qu’il faut y retirer ses heures, sans bloquer la journée', async ({
        page,
        request,
    }) => {
        // Un numéro neuf à chaque passage : le Jira simulé ne montre plus un ticket de DISPARU
        // dès qu'il a relu ses heures, et le garde caché. Neuf chiffres au plus : l'identifiant
        // tient entier dans sa pastille.
        const gone = `DISPARU-${String((Date.now() % 999_999_999) + 1)}`;
        const date = await open(page, request, 43, [
            { start: '09:00', end: '10:00', ticket: 'SHOP-482' },
            { start: '10:00', end: '10:30', ticket: gone },
        ]);
        await confirmSend(page);
        await expect(sendButton(page)).toHaveText(/^Envoyé à/);

        // Le compte ne le voit plus, et on le retire de la journée.
        await writeDay(request, date, [{ start: '09:00', end: '10:00', ticket: 'SHOP-482' }], 60);
        await page.reload();
        await confirmSend(page);

        // La journée est envoyée ; le détail s'ouvre de lui-même, à la place des confettis.
        await expect(sendButton(page)).toHaveText(/^Envoyé à/);
        const detail = sendWindow(page, 'Envoyé sur Jira');
        await expect(detail).toBeVisible();
        const line = "Jira ne trouve plus ce ticket. S'il a encore des heures de ce jour, retirez-les dans Jira.";
        const row = detail.getByRole('listitem').filter({ hasText: gone });
        await expect(row).toContainText('Introuvable dans Jira');
        await expect(row).toContainText('0h00');
        await expect(row.getByText(line)).toBeVisible();
        await expectUnderChip(detail, gone, line);
        await expect(detail.getByRole('listitem')).toHaveText([
            /Envoyé.*SHOP-482.*1h00/,
            new RegExp(`Introuvable dans Jira.*${gone}.*0h00`),
            /Total.*1h00/,
        ]);
        await page.waitForTimeout(200);
        expect(await confettiSpan(page)).toBeNull();
        // Ses heures sont restées dans Jira : DayTrack ne les voit plus, et l'a dit. Celles des
        // passages d'avant aussi, sous d'autres numéros.
        const tickets = (await receivedWorklogs(request, date)).map((worklog) => worklog.ticket);
        expect(tickets).toContain(gone);
        expect(tickets.filter((ticket) => !ticket.startsWith('DISPARU-'))).toEqual(['SHOP-482']);

        await page.keyboard.press('Escape');
        await expect(detail).toBeHidden();
        await expect(sendButton(page)).toBeFocused();

        await page.reload();
        await sendButton(page).click();
        await expect(sendWindow(page, 'Envoyé sur Jira').getByText(line)).toBeVisible();
    });

    test('redit au clic sur « Envoyé à » le ticket introuvable d’une journée vidée', async ({ page, request }) => {
        const gone = `DISPARU-${String((Date.now() % 999_999_999) + 1)}`;
        const date = await open(page, request, 44, [{ start: '09:00', end: '09:30', ticket: gone }]);
        await confirmSend(page);
        await expect(sendButton(page)).toHaveText(/^Envoyé à/);

        await writeDay(request, date, [], 60);
        await page.reload();
        await confirmSend(page);

        const detail = sendWindow(page, 'Envoyé sur Jira');
        const line = "Jira ne trouve plus ce ticket. S'il a encore des heures de ce jour, retirez-les dans Jira.";
        await expect(detail.getByText(line)).toBeVisible();
        // Plus aucune heure de ce jour dans Jira : la fenêtre ne dit pas le contraire.
        await expect(detail).not.toContainText('Ces heures sont dans Jira pour ce jour.');
        await expect(detail.getByRole('listitem')).toHaveText([
            new RegExp(`Introuvable dans Jira.*${gone}.*0h00`),
            /Total.*0h00/,
        ]);

        await page.keyboard.press('Escape');
        await page.reload();
        await expect(sendButton(page)).toHaveText(/^Envoyé à/);
        await sendButton(page).click();
        await expect(sendWindow(page, 'Envoyé sur Jira').getByText(line)).toBeVisible();
    });

    test('dit un échec quand Jira ne répond pas, sans rien perdre de la journée', async ({ page, request }) => {
        await open(page, request, 5, [{ start: '09:00', end: '10:00', ticket: 'PANNE-1' }]);
        await confirmSend(page);

        const result = sendWindow(page, "Échec de l'envoi");
        await expect(result).toContainText(
            "L'envoi a échoué. Jira ne répond pas, rien n'a été envoyé. Vos saisies restent dans DayTrack.",
        );
        await expect(sendButton(page)).toHaveAccessibleName("Réessayer l'envoi, échec");
        // Une seule raison, dite au-dessus : la ligne du ticket n'en contredit pas une autre.
        await expect(result.getByRole('listitem')).toHaveText([/Non envoyé.*PANNE-1.*1h00$/]);
        await expect(page.getByRole('listbox')).toContainText('PANNE-1');

        // Le curseur est entré dans la fenêtre ouverte d'elle-même : on réessaie au clavier.
        await expect(result.getByRole('button', { name: 'Fermer' }).last()).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(result.getByRole('button', { name: "Réessayer l'envoi" })).toBeFocused();
    });

    test('dit un jeton refusé, et mène à sa mise à jour', async ({ page, request }) => {
        await open(page, request, 6);
        // Le jeton ne se refuse qu'au Jira simulé tout entier, que d'autres parcours
        // utilisent en même temps : la réponse est celle que le serveur rend alors.
        await rewriteSend(page, (send, url) =>
            url.pathname.endsWith('/send')
                ? {
                      ...send,
                      state: 'failed',
                      sentAt: null,
                      attemptedAt: { date: workday(6), time: '18:00' },
                      failure: 'refused',
                      outcomes: {},
                  }
                : send,
        );
        await confirmSend(page);

        const result = sendWindow(page, "Échec de l'envoi");
        await expect(result).toContainText(
            "L'envoi a échoué. Jira refuse le jeton enregistré, il a sans doute expiré.",
        );
        await expect(page.getByRole('alert')).toContainText('Jira refuse le jeton enregistré');
        await result.getByRole('button', { name: 'Mettre à jour le jeton' }).click();
        await expect(page).toHaveURL(/\/reglages$/);
    });

    test('propose de réessayer une fois le jeton remplacé', async ({ page, request }) => {
        // L'essai a échoué sur le jeton ; il a été remplacé depuis, et Jira l'accepte.
        await rewriteSend(page, (send) => ({
            ...send,
            state: 'failed',
            sentAt: null,
            attemptedAt: { date: workday(12), time: '18:00' },
            failure: 'refused',
            outcomes: {},
        }));
        await open(page, request, 12);

        await sendButton(page).click();
        const result = sendWindow(page, "Échec de l'envoi");
        await expect(result).toContainText("L'envoi a échoué. Jira refuse le jeton enregistré");
        await expect(result.getByRole('button', { name: "Réessayer l'envoi" })).toBeVisible();
        await expect(result.getByRole('button', { name: 'Mettre à jour le jeton' })).toHaveCount(0);
    });

    test('ne propose rien pour une journée sans ticket', async ({ page, request }) => {
        await open(page, request, 7, [{ start: '12:00', end: '13:00' }]);

        await expect(sendButton(page)).toHaveAttribute('aria-disabled', 'true');
        await sendButton(page).hover();
        await expect(page.getByRole('tooltip')).toHaveText('Rien à envoyer pour ce jour');
        await sendButton(page).click({ force: true });
        await expect(page.getByRole('dialog')).toHaveCount(0);
    });

    test.describe('dans un onglet en retard', () => {
        test.use({ expectedErrors: [refusedWith(409)] });

        test('n’envoie rien d’une journée changée ailleurs', async ({ page, request }) => {
            const date = await open(page, request, 8);
            await writeDay(request, date, [{ start: '09:00', end: '09:30', ticket: 'OPS-7' }]);

            await confirmSend(page);

            await expect(message(page)).toContainText("La journée a changé entre-temps. Rien n'a été envoyé.");
            await expect(page.getByRole('listbox')).toContainText('OPS-7');
            expect(await receivedWorklogs(request, date)).toEqual([]);
        });
    });

    test('lance la gerbe vers le haut, la fait retomber, et rien quand le système demande moins de mouvement', async ({
        page,
        request,
    }) => {
        await open(page, request, 9);
        await confirmSend(page);
        await expect(sendButton(page)).toHaveText(/^Envoyé à/);
        const button = await sendButton(page).boundingBox();
        expect(button).not.toBeNull();
        const { y: top, height } = button ?? { y: 0, height: 0 };

        // Elle monte : des confettis au-dessus du bouton, plus haut que ne l'agiteraient leurs
        // seules oscillations autour de son centre…
        await expect
            .poll(async () => (await confettiSpan(page))?.top ?? Infinity, { timeout: 10_000, intervals: [30] })
            .toBeLessThan(top - 4);
        // … puis elle retombe, bien en dessous de lui.
        await expect
            .poll(async () => (await confettiSpan(page))?.bottom ?? -Infinity, { timeout: 10_000, intervals: [30] })
            .toBeGreaterThan(top + height + 80);

        await page.emulateMedia({ reducedMotion: 'reduce' });
        await writeDay(request, workday(9), [{ start: '09:00', end: '09:30', ticket: 'OPS-7' }]);
        await page.reload();
        await confirmSend(page);
        await expect(sendButton(page)).toHaveText(/^Envoyé à/);
        await page.waitForTimeout(150);
        expect(await confettiSpan(page)).toBeNull();
    });

    test.describe('avec les marques de la base', () => {
        test.use({ marks: 'base' });

        test('marque le jour envoyé dans le calendrier', async ({ page, request }) => {
            const date = await open(page, request, 10);
            await confirmSend(page);
            await expect(sendButton(page)).toHaveText(/^Envoyé à/);

            await expect(calendarDay(page, date)).toHaveAccessibleName(/, envoyé$/);
        });
    });

    test('ses fenêtres passent le contrôle d’accessibilité', async ({ page, request }) => {
        await open(page, request, 11, [
            { start: '09:00', end: '10:00', ticket: 'SHOP-482' },
            { start: '10:00', end: '10:30', ticket: 'FERME-1' },
        ]);
        await sendButton(page).click();
        await expect(sendWindow(page, 'Envoyer sur Jira')).toBeVisible();
        await expectAccessible(page);

        await sendWindow(page, 'Envoyer sur Jira').getByRole('button', { name: 'Envoyer sur Jira' }).click();
        await expect(sendWindow(page, 'Envoi partiel')).toBeVisible();
        await expectAccessible(page);
    });
});

/**
 * La liste d'une fenêtre est un tableau : les pastilles partent du même bord, chacune à la
 * largeur de son identifiant — jamais étirée à celle du plus long —, et les titres
 * s'alignent quelle que soit la longueur de l'identifiant.
 */
async function expectTable(window: Locator, short: string, long: string): Promise<void> {
    const chip = (ticket: string) =>
        window
            .getByRole('listitem')
            .getByText(ticket, { exact: true })
            .evaluate((node) => {
                const box = node.getBoundingClientRect();

                return { left: Math.round(box.left), width: Math.round(box.width) };
            });
    const [shortChip, longChip] = [await chip(short), await chip(long)];
    expect(shortChip.left).toBe(longChip.left);
    expect(shortChip.width).toBeLessThan(longChip.width);

    const titles = await window
        .getByRole('listitem')
        .locator('.truncate')
        .evaluateAll((spans) => spans.map((span) => Math.round(span.getBoundingClientRect().left)));
    expect(new Set(titles.slice(0, 2)).size).toBe(1);
}

/** Ce qui se dit sous un ticket commence sous sa pastille, que la ligne porte une marque ou non. */
async function expectUnderChip(window: Locator, ticket: string, line: string): Promise<void> {
    const row = window.getByRole('listitem').filter({ hasText: ticket });
    const left = (locator: Locator) => locator.evaluate((node) => Math.round(node.getBoundingClientRect().left));

    expect(await left(row.getByText(line, { exact: true }))).toBe(await left(row.getByText(ticket, { exact: true })));
}

/**
 * Où sont les confettis sur la toile, en pixels de la page : le plus haut et le plus bas.
 * Aucun confetti dessiné : null.
 */
async function confettiSpan(page: Page): Promise<{ top: number; bottom: number } | null> {
    return page.locator('.send-confetti').evaluate((canvas: HTMLCanvasElement) => {
        const context = canvas.getContext('2d');
        if (context === null || canvas.width === 0 || canvas.height === 0) {
            return null;
        }
        const box = canvas.getBoundingClientRect();
        const ratio = box.height / canvas.height;
        const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
        let top = -1;
        let bottom = -1;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if ((data[(y * width + x) * 4 + 3] ?? 0) > 0) {
                    if (top < 0) {
                        top = y;
                    }
                    bottom = y;
                    break;
                }
            }
        }

        return top < 0 ? null : { top: box.top + top * ratio, bottom: box.top + bottom * ratio };
    });
}

function calendarDay(page: Page, date: string): Locator {
    return page.getByRole('grid').locator(`[data-date="${date}"]`);
}
