import type { Page } from '@playwright/test';

import { freezeTime, writeDay } from './day';
import {
    blocks,
    clickSlot,
    describedWrites,
    doubleClickSlot,
    expectGridMatchesBase,
    figures,
    lane,
    message,
    objectiveButton,
    objectiveWindow,
    openAnyway,
    recordWrites,
    rereadBehindGestures,
    savedDay,
    slots,
    ticketWindow,
    tokenColor,
} from './editing';
import { expect, expectAccessible, refusedWith, test } from './fixtures';
import { cell, numberColor } from './calendar';

/**
 * Le jour mis à 0h00 dans la fenêtre Objectif du jour, en attendant les congés : vide, il
 * se ferme comme un samedi, grisé au calendrier, mais garde son objectif, qui le défait.
 *
 * Ces parcours lisent les marques et les jours mis à 0h00 de la base (`marks: 'base'`),
 * sur des jours de septembre 2021 que les autres parcours ne prennent pas.
 */
test.use({ marks: 'base' });

async function dayRead(page: Page, date: string): Promise<{ objective: number; declaredOff: boolean }> {
    const response = await page.request.get(`/api/days/${date}`);

    return (await response.json()) as { objective: number; declaredOff: boolean };
}

test('mis à 0h00, le jour se ferme et se grise sans que les flèches le sautent ; « Revenir à 7h30 » le rouvre', async ({
    page,
    request,
}) => {
    const date = '2021-09-08';
    await writeDay(request, date, []);
    await freezeTime(page, '2021-09-13', '10:00');
    await page.goto(`/${date}`);
    await expect(page.getByRole('progressbar')).toHaveCount(1);

    // La fenêtre dit ce que fera 0h00, avant qu'on l'enregistre.
    await objectiveButton(page).click();
    await objectiveWindow(page).getByLabel('Durée à travailler').fill('0h00');
    await expect(
        objectiveWindow(page).getByText('Jour non travaillé. Les autres jours gardent votre objectif habituel.'),
    ).toBeVisible();
    await objectiveWindow(page).getByRole('button', { name: 'Enregistrer' }).click();
    await expect(objectiveWindow(page)).toHaveCount(0);

    // Fermé comme un samedi, l'objectif gardé à 0h00, sans barre.
    await expect(figures(page)).toHaveText('0h00/0h00Jour non travaillé');
    await expect(objectiveButton(page)).toHaveAccessibleName('Objectif du jour, 0h00. Modifier');
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await expect(page.getByText('Aucun ticket pour ce jour', { exact: true })).toBeVisible();
    await expect(
        page.getByText("Avec un objectif à 0h00, ce jour n'est pas travaillé.", { exact: true }),
    ).toBeVisible();
    await expect(openAnyway(page)).toBeVisible();
    await expect(cell(page, date)).toHaveAccessibleName('8 septembre, jour affiché, non travaillé');
    expect(await lane(page).evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
        await page.evaluate(() => {
            const probe = document.createElement('div');
            probe.style.backgroundColor = 'var(--bg-side)';
            document.body.append(probe);

            return getComputedStyle(probe).backgroundColor;
        }),
    );
    expect(await dayRead(page, date)).toMatchObject({ objective: 0, declaredOff: true });

    // Rien ne s'y écrit par la grille, et un rechargement le retrouve fermé.
    const writes = recordWrites(page);
    await doubleClickSlot(page, '10:00');
    await expect(ticketWindow(page)).toHaveCount(0);
    await page.reload();
    await expect(openAnyway(page)).toBeVisible();
    await expect(figures(page)).toHaveText('0h00/0h00Jour non travaillé');
    expect(describedWrites(writes)).toEqual([]);
    await page.clock.resume();
    await expectAccessible(page);

    // Les flèches ne le sautent pas, et le calendrier le grise vu d'ailleurs.
    await page.getByRole('button', { name: 'Jour précédent' }).click();
    await expect(page).toHaveURL('/2021-09-07');
    await expect(cell(page, date)).toHaveAccessibleName('8 septembre, non travaillé');
    expect(await numberColor(cell(page, date))).toBe(await tokenColor(page, '--ink-3'));
    expect(await numberColor(cell(page, '2021-09-09'))).toBe(await tokenColor(page, '--ink'));
    await page.getByRole('button', { name: 'Jour suivant' }).click();
    await expect(page).toHaveURL(`/${date}`);

    // « Revenir à 7h30 » défait le congé : le jour se rouvre et redevient un jour vide.
    await objectiveButton(page).click();
    await objectiveWindow(page).getByRole('button', { name: 'Revenir à 7h30' }).click();
    await objectiveWindow(page).getByRole('button', { name: 'Enregistrer' }).click();
    await expect(openAnyway(page)).toHaveCount(0);
    await expect(figures(page)).toHaveText('0h00/7h30Solde −7h30');
    await expect(page.getByRole('progressbar')).toHaveCount(1);
    await expect(cell(page, date)).toHaveAccessibleName('8 septembre, jour affiché');
    expect(await dayRead(page, date)).toMatchObject({ objective: 450, declaredOff: false });
});

test('« Saisir quand même » laisse 0h00 : tout compte en plus, le jour reste grisé et se referme vide', async ({
    page,
    request,
}) => {
    const date = '2021-09-15';
    await writeDay(request, date, [], 0);
    const writes = recordWrites(page);
    await freezeTime(page, '2021-09-20', '10:00');
    await page.goto(`/${date}`);

    await openAnyway(page).click();
    await expect(slots(page)).toBeFocused();
    await expect(
        page.getByText('Double-cliquez sur un créneau, ou glissez un favori sur la grille.', { exact: true }),
    ).toBeVisible();
    await expect(figures(page)).toHaveText('0h00/0h00Jour non travaillé');
    expect(describedWrites(writes)).toEqual([]);

    // Une heure et demie d'astreinte, au clavier.
    await clickSlot(page, '09:00');
    await clickSlot(page, '10:15', ['Shift']);
    await page.keyboard.type('OPS-7');
    await page.keyboard.press('Enter');
    await expect(blocks(page)).toHaveCount(1);
    expect(await savedDay(request, date)).toEqual([
        { start: '09:00', end: '10:30', kind: 'work', ticket: 'OPS-7', comment: null },
    ]);
    await expect(figures(page)).toHaveText('1h30/0h00Solde +1h30');
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await expect(cell(page, date)).toHaveAccessibleName('15 septembre, jour affiché, non travaillé, non envoyé');
    expect(await dayRead(page, date)).toMatchObject({ objective: 0, declaredOff: true });
    await expectGridMatchesBase(page, request, date);

    // Sa saisie effacée, il reste ouvert tant qu'on y est ; quitté puis revenu, il est fermé.
    await clickSlot(page, '09:00');
    await clickSlot(page, '10:15', ['Shift']);
    await page.keyboard.press('Delete');
    await expect(blocks(page)).toHaveCount(0);
    await expect(openAnyway(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Jour suivant' }).click();
    await expect(page).toHaveURL('/2021-09-16');
    await cell(page, date).click();
    await expect(openAnyway(page)).toBeVisible();
    await expect(cell(page, date)).toHaveAccessibleName('15 septembre, jour affiché, non travaillé');
    expect(await savedDay(request, date)).toEqual([]);

    // Fermé, il ne prend ni Ctrl+Z ni Ctrl+Maj+Z, une fois lu comme tapés pendant qu'il s'ouvre.
    const before = describedWrites(writes).length;
    await openAnyway(page).focus();
    await page.keyboard.press('ControlOrMeta+z');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await rereadBehindGestures(page, date);
    await page.getByRole('button', { name: 'Jour suivant' }).click();
    await expect(page).toHaveURL('/2021-09-16');
    await expect(figures(page)).toHaveCount(1);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    await page.route(`**/api/days/${date}`, async (route) => {
        await held;
        await route.continue();
    });
    await cell(page, date).click();
    await expect(page).toHaveURL(`/${date}`);
    await expect(figures(page)).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+z');
    release();
    await expect(openAnyway(page)).toBeVisible();
    await rereadBehindGestures(page, date);
    await expect(openAnyway(page)).toBeVisible();
    await expect(blocks(page)).toHaveCount(0);
    expect(describedWrites(writes)).toHaveLength(before);
    expect(await savedDay(request, date)).toEqual([]);

    // « Saisir quand même » le rouvre : la saisie effacée y reste à annuler.
    await openAnyway(page).click();
    await expect(slots(page)).toBeFocused();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(blocks(page)).toHaveCount(1);
    await expectGridMatchesBase(page, request, date);
});

test('pendant sa lecture, un jour que le calendrier sait mis à 0h00 se montre déjà fermé', async ({
    page,
    request,
}) => {
    const date = '2021-09-29';
    await writeDay(request, date, [], 0);
    await freezeTime(page, '2021-10-04', '10:00');
    await page.goto('/2021-09-28');
    await expect(cell(page, date)).toHaveAccessibleName('29 septembre, non travaillé');

    // La journée tarde : la grille ne passe pas par le blanc avant le gris.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    await page.route(`**/api/days/${date}`, async (route) => {
        await held;
        await route.continue();
    });
    const sideColor = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.backgroundColor = 'var(--bg-side)';
        document.body.append(probe);

        return getComputedStyle(probe).backgroundColor;
    });
    await cell(page, date).click();
    await expect(page).toHaveURL(`/${date}`);
    // La journée n'est pas lue : ses chiffres non plus.
    await expect(figures(page)).toHaveCount(0);
    expect(await lane(page).evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(sideColor);
    release();
    await expect(figures(page)).toHaveText('0h00/0h00Jour non travaillé');
    await expect(openAnyway(page)).toBeVisible();
});

test('vu avec une saisie, vidé puis mis à 0h00, il reste ouvert tant qu’on y est : Ctrl+Z rend la saisie', async ({
    page,
    request,
}) => {
    const date = '2021-10-13';
    await writeDay(request, date, [{ start: '09:00', end: '09:45', ticket: 'OPS-7' }]);
    await freezeTime(page, '2021-10-18', '10:00');
    await page.goto(`/${date}`);
    await expect(blocks(page)).toHaveCount(1);

    await clickSlot(page, '09:00');
    await clickSlot(page, '09:30', ['Shift']);
    await page.keyboard.press('Delete');
    await expect(blocks(page)).toHaveCount(0);
    await objectiveButton(page).click();
    await objectiveWindow(page).getByLabel('Durée à travailler').fill('0h00');
    await objectiveWindow(page).getByRole('button', { name: 'Enregistrer' }).click();
    await expect(figures(page)).toHaveText('0h00/0h00Jour non travaillé');
    await expect(openAnyway(page)).toHaveCount(0);

    // Ctrl+Z rend la saisie effacée, comme « Annuler » du message : la grille est restée ouverte.
    await clickSlot(page, '12:00');
    await page.keyboard.press('ControlOrMeta+Z');
    await expect(blocks(page)).toHaveCount(1);
    expect(await savedDay(request, date)).toEqual([
        { start: '09:00', end: '09:45', kind: 'work', ticket: 'OPS-7', comment: null },
    ]);
    await expect(figures(page)).toHaveText('0h45/0h00Solde +0h45');
    await expectGridMatchesBase(page, request, date);

    // Vidé de nouveau puis quitté, il est fermé au retour.
    await clickSlot(page, '09:00');
    await clickSlot(page, '09:30', ['Shift']);
    await page.keyboard.press('Delete');
    await expect(blocks(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Jour suivant' }).click();
    await expect(page).toHaveURL('/2021-10-14');
    await cell(page, date).click();
    await expect(openAnyway(page)).toBeVisible();
});

test.describe('un onglet resté ouvert pendant qu’on mettait le jour à 0h00 ailleurs', () => {
    test.use({ expectedErrors: [refusedWith(409)] });

    test('n’y écrit rien, le dit, et montre le jour fermé', async ({ page, request }) => {
        const date = '2021-09-22';
        await writeDay(request, date, []);
        await freezeTime(page, '2021-09-27', '10:00');
        await page.goto(`/${date}`);
        await expect(openAnyway(page)).toHaveCount(0);

        // Ailleurs, le jour passe à 0h00 ; ici, une heure tapée sur la grille restée ouverte.
        await writeDay(request, date, [], 0);
        await clickSlot(page, '09:00');
        await clickSlot(page, '09:45', ['Shift']);
        await page.keyboard.type('OPS-7');
        await page.keyboard.press('Enter');

        await expect(ticketWindow(page)).toContainText('La journée a changé entre-temps.');
        await expect(ticketWindow(page).getByLabel('Ticket')).toHaveValue('OPS-7');
        // La grille s'est fermée derrière la fenêtre : « Saisir quand même » attend qu'elle parte.
        await expect(openAnyway(page)).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(ticketWindow(page)).toHaveCount(0);
        await expect(openAnyway(page)).toBeVisible();
        // La grille fermée ne prend pas le curseur : il va à « Saisir quand même ». La fenêtre le
        // rend par un minuteur, et l'heure est arrêtée.
        await page.clock.runFor(100);
        await expect(openAnyway(page)).toBeFocused();
        // Rien ne le recouvre : la sélection d'avant ne se dessine plus sur la grille fermée.
        const button = await openAnyway(page).boundingBox();
        const onTop = await page.evaluate(
            ([x, y]) => document.elementFromPoint(x ?? 0, y ?? 0)?.closest('button')?.textContent ?? null,
            [(button?.x ?? 0) + (button?.width ?? 0) / 2, (button?.y ?? 0) + (button?.height ?? 0) / 2],
        );
        expect(onTop).toBe('Saisir quand même');
        await expect(page.locator('.bg-sel-fill')).toHaveCount(0);
        await expect(figures(page)).toHaveText('0h00/0h00Jour non travaillé');
        await expect(blocks(page)).toHaveCount(0);
        await expect(message(page)).toHaveCount(0);
        expect(await savedDay(request, date)).toEqual([]);
    });
});
