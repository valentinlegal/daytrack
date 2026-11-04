import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page, Request } from '@playwright/test';

import { clearDay, freezeTime, writeDay } from './day';
import {
    clickSlot,
    doubleClickSlot,
    expectGridMatchesBase,
    message,
    objectiveButton,
    objectiveWindow,
    savedDay,
    slots,
    ticketWindow,
} from './editing';
import { expect, refusedWith, test } from './fixtures';

/**
 * Le jour mis à 0h00 dans la fenêtre Objectif du jour, en attendant les congés : vide, il
 * se ferme comme un samedi, grisé au calendrier, mais garde son objectif, qui le défait.
 *
 * Ces parcours lisent les marques et les jours mis à 0h00 de la base (`marks: 'base'`),
 * sur des jours de septembre 2021 que les autres parcours ne prennent pas.
 */
test.use({ marks: 'base' });

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre'];

/** Un jour du calendrier, par le début de son libellé : « 8 septembre ». */
function cell(page: Page, date: string): Locator {
    const label = `${String(Number(date.slice(8)))} ${MONTHS[Number(date.slice(5, 7)) - 1] ?? ''}`;

    return page.getByRole('grid').getByRole('button', { name: new RegExp(`^${label}(,|$)`) });
}

function figures(page: Page): Locator {
    return page.getByRole('group', { name: 'Chiffres du jour' });
}

function openAnyway(page: Page): Locator {
    return page.getByRole('button', { name: 'Saisir quand même' });
}

function blocks(page: Page): Locator {
    return page.getByRole('list', { name: 'Saisies du jour' }).getByRole('listitem');
}

/** La colonne des blocs, que la grille fermée grise. */
function lane(page: Page): Locator {
    return page.getByRole('list', { name: 'Saisies du jour' }).locator('..');
}

/** La valeur qu'une couleur de tokens.css prend dans la page. */
async function tokenColor(page: Page, token: `--${string}`): Promise<string> {
    return page.evaluate((name) => {
        const probe = document.createElement('div');
        probe.style.color = `var(${name})`;
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();

        return color;
    }, token);
}

/** La couleur du chiffre d'un jour du calendrier. */
async function numberColor(day: Locator): Promise<string> {
    return day
        .locator(':scope > span')
        .first()
        .evaluate((number) => getComputedStyle(number).color);
}

/** Les écritures que la page envoie, hors ce qu'elle demande à Jira. */
function recordWrites(page: Page): Request[] {
    const writes: Request[] = [];
    page.on('request', (sent) => {
        const jira = /\/api\/(jira\/check|tickets\/refresh)$/.test(new URL(sent.url()).pathname);
        if (sent.method() !== 'GET' && !jira) {
            writes.push(sent);
        }
    });

    return writes;
}

function described(writes: readonly Request[]): string[] {
    return writes.map((sent) => `${sent.method()} ${new URL(sent.url()).pathname}`);
}

async function dayRead(page: Page, date: string): Promise<{ objective: number; declaredOff: boolean }> {
    const response = await page.request.get(`/api/days/${date}`);

    return (await response.json()) as { objective: number; declaredOff: boolean };
}

async function expectAccessible(page: Page): Promise<void> {
    // axe attend ses propres minuteurs : l'heure doit de nouveau tourner.
    await page.clock.resume();
    const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
        .analyze();
    expect(results.violations).toEqual([]);
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
    expect(described(writes)).toEqual([]);
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

    await clearDay(request, date);
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
    expect(described(writes)).toEqual([]);

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

    await clearDay(request, date);
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

    await clearDay(request, date);
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

    await clearDay(request, date);
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

        await clearDay(request, date);
    });
});
