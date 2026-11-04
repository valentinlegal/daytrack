import type { Page, Route } from '@playwright/test';

import { clearDay, type Entry, weekday, writeDay } from './day';
import {
    clickSlot,
    doubleClickSlot,
    dragSlots,
    expectGridMatchesBase,
    menu,
    message,
    NEAR_LEFT,
    objectiveButton,
    objectiveWindow,
    rightClickSlot,
    savedDay,
    slot,
    slotPoint,
    slots,
    ticketWindow,
} from './editing';
import { expect, refusedWith, test } from './fixtures';

/**
 * Des gestes ordinaires qui ont fait autre chose que ce qu'on attend : une réponse en retard, un double-clic qui tombe à côté, Échap au milieu
 * d'un glisser, une fenêtre qui défile. Chaque parcours relit la base après son geste.
 */

/** Le jour d'un parcours : un jour de semaine du début de 2023, à l'écart des autres fichiers. */
function day(index: number): string {
    return weekday('2023-01-16', index);
}

async function open(page: Page, date: string) {
    await page.goto(`/${date}`);
    await expect(page.getByRole('group', { name: 'Chiffres du jour' })).toBeVisible();
}

function blocks(page: Page) {
    return page.getByRole('list', { name: 'Saisies du jour' }).getByRole('listitem');
}

function selected(page: Page) {
    return slots(page).getByRole('option', { selected: true });
}

/** Le rectangle d'une fenêtre, à l'écran. */
async function box(page: Page, title: string) {
    const rect = await ticketWindow(page, title).boundingBox();
    if (rect === null) {
        throw new Error(`La fenêtre ${title} n’est pas à l’écran.`);
    }

    return rect;
}

/** La grille défilée jusqu'à ce que cette heure soit en haut de la vue, ou aussi près que possible. */
async function scrollGridTo(page: Page, time: string) {
    await slot(page, time).evaluate((option) => {
        option.closest('[role="region"]')?.scrollTo({ top: 0 });
        const region = option.closest('[role="region"]');
        if (region !== null) {
            region.scrollTop = option.getBoundingClientRect().top - region.getBoundingClientRect().top;
        }
    });
}

async function arrowVisible(page: Page, title: string): Promise<boolean> {
    return ticketWindow(page, title)
        .locator('svg[viewBox="0 0 16 8"]')
        .evaluate((arrow) => getComputedStyle(arrow).visibility === 'visible');
}

test.describe('un favori refusé, encore à l’écran', () => {
    test.use({ favorites: 'none', expectedErrors: [refusedWith(422)] });

    const TYPED = 'ESSAI-404';
    const REFUSAL = 'Ce favori est refusé.';
    /** Le favori tapé est refusé, le temps que la réponse arrive après le geste. */
    const refuseFavorite = async (page: Page, delay = 300) => {
        await page.route('**/api/favorites', async (route: Route) => {
            if (route.request().method() !== 'POST') {
                await route.fallback();

                return;
            }
            await new Promise((resolve) => setTimeout(resolve, delay));
            await route.fulfill({
                status: 422,
                json: { violations: [{ field: 'ticket', message: REFUSAL }] },
            });
        });
    };
    const typeFavorite = async (page: Page) => {
        await page.getByRole('button', { name: 'Ajouter un favori' }).first().click();
        const field = page.getByRole('textbox', { name: 'Nouveau favori' });
        await field.fill(TYPED);

        return field;
    };

    test('n’enregistre rien tout seul quand le refus arrive après un double-clic', async ({ page, request }) => {
        const date = day(0);
        await writeDay(request, date, []);
        await open(page, date);
        await refuseFavorite(page);
        const field = await typeFavorite(page);

        await doubleClickSlot(page, '10:00');

        await expect(field).toHaveAccessibleDescription(REFUSAL);
        await expect(field).toBeFocused();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await page.waitForTimeout(400);
        expect(await savedDay(request, date)).toEqual([]);
        await clearDay(request, date);
    });

    test('garde le formulaire et n’ouvre rien au clavier non plus', async ({ page, request }) => {
        const date = day(1);
        await writeDay(request, date, []);
        await open(page, date);
        await refuseFavorite(page, 0);
        const field = await typeFavorite(page);
        await field.press('Enter');
        await expect(field).toHaveAccessibleDescription(REFUSAL);

        await slots(page).focus();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');

        await expect(field).toBeFocused();
        await expect(field).toHaveValue(TYPED);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect(await savedDay(request, date)).toEqual([]);

        // Une lettre tapée sur la grille n'écrit rien non plus.
        await slots(page).focus();
        await page.keyboard.press('s');
        await expect(field).toBeFocused();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await clearDay(request, date);
    });

    test('garde l’objectif fermé et n’écrit rien', async ({ page, request }) => {
        const date = day(2);
        await writeDay(request, date, []);
        await open(page, date);
        await refuseFavorite(page);
        const field = await typeFavorite(page);

        await objectiveButton(page).click();

        await expect(field).toHaveAccessibleDescription(REFUSAL);
        await expect(field).toBeFocused();
        await expect(objectiveWindow(page)).toHaveCount(0);
        await clearDay(request, date);
    });

    test('ne change pas de jour, et le dit sous son champ', async ({ page, request }) => {
        const date = day(3);
        await writeDay(request, date, []);
        await open(page, date);
        await refuseFavorite(page);
        const field = await typeFavorite(page);

        await page.getByRole('button', { name: /^Jour suivant/ }).focus();
        await page.keyboard.press('Enter');

        await expect(field).toHaveAccessibleDescription(REFUSAL);
        expect(new URL(page.url()).pathname).toBe(`/${date}`);
        await clearDay(request, date);
    });

    test('garde la fenêtre d’envoi fermée', async ({ page, request }) => {
        const date = day(24);
        await writeDay(request, date, [{ start: '09:00', end: '09:15', ticket: 'SHOP-482' }]);
        await open(page, date);
        await refuseFavorite(page);
        const field = await typeFavorite(page);

        await page.locator('.send-button').click();

        await expect(field).toHaveAccessibleDescription(REFUSAL);
        await expect(field).toBeFocused();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await clearDay(request, date);
    });

    test('un formulaire encore vide laisse s’ouvrir la fenêtre', async ({ page, request }) => {
        const date = day(4);
        await writeDay(request, date, []);
        await open(page, date);
        await page.getByRole('button', { name: 'Ajouter un favori' }).first().click();

        await doubleClickSlot(page, '10:00');

        await expect(ticketWindow(page).getByLabel('Ticket')).toBeFocused();
        await expect(page.getByRole('textbox', { name: 'Nouveau favori' })).toHaveCount(0);
        await clearDay(request, date);
    });
});

test.describe('une fenêtre refusée, encore à l’écran', () => {
    test.use({ favorites: 'none', expectedErrors: [refusedWith(422)] });

    test('n’ouvre pas le formulaire d’un favori à côté d’elle', async ({ page, request }) => {
        const date = day(25);
        await writeDay(request, date, []);
        await open(page, date);

        await doubleClickSlot(page, '10:00');
        await ticketWindow(page).getByLabel('Commentaire').fill('Sans ticket');
        await page.getByRole('button', { name: 'Ajouter un favori' }).first().click();

        await expect(ticketWindow(page).getByLabel('Ticket')).toHaveAttribute('aria-invalid', 'true');
        await expect(ticketWindow(page).getByLabel('Ticket')).toBeFocused();
        await expect(page.getByRole('textbox', { name: 'Nouveau favori' })).toHaveCount(0);
        await clearDay(request, date);
    });
});

test.describe('un bloc qu’on vide', () => {
    test('se supprime même s’il a un commentaire, et Ctrl+Z rend les deux', async ({ page, request }) => {
        const date = day(5);
        const entries: Entry[] = [{ start: '09:00', end: '10:00', ticket: 'SHOP-482', comment: 'Mapping' }];
        await writeDay(request, date, entries);
        await open(page, date);

        await doubleClickSlot(page, '09:15');
        const window = ticketWindow(page, 'Modifier le ticket');
        await window.getByLabel('Ticket').fill('');
        await window.getByLabel('Ticket').press('Enter');

        await expect(window).toHaveCount(0);
        await expect(blocks(page)).toHaveCount(0);
        await expect(message(page)).toHaveText(/SHOP-482 supprimé/);
        await expectGridMatchesBase(page, request, date);

        await slots(page).focus();
        await page.keyboard.press('ControlOrMeta+Z');
        await expect(blocks(page)).toHaveText([/SHOP-482.*Mapping/]);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });
});

test.describe('une fenêtre quand la grille défile', () => {
    test.use({ viewport: { width: 1440, height: 720 } });

    test('Nouveau ticket suit son créneau, s’arrête au bord sans flèche, et n’a rien perdu', async ({
        page,
        request,
    }) => {
        const date = day(6);
        await writeDay(request, date, []);
        await open(page, date);
        await scrollGridTo(page, '12:00');

        await doubleClickSlot(page, '17:00');
        const window = ticketWindow(page);
        const ticket = window.getByLabel('Ticket');
        await ticket.fill('SHOP-501');
        const opened = await box(page, 'Nouveau ticket');
        expect(await arrowVisible(page, 'Nouveau ticket')).toBe(true);
        const slotTop = await slot(page, '17:00').evaluate((node) => node.getBoundingClientRect().top);

        // Elle suit le créneau, du même écart.
        await page.evaluate(() => {
            document.querySelector('[role="region"]')?.scrollBy({ top: -48 });
        });
        await expect.poll(async () => (await box(page, 'Nouveau ticket')).y).toBe(opened.y + 48);
        expect(await arrowVisible(page, 'Nouveau ticket')).toBe(true);

        // Le créneau sort par le bas : elle reste entière en bas de l'écran, sans flèche.
        await page.evaluate(() => {
            document.querySelector('[role="region"]')?.scrollTo({ top: 0 });
        });
        await expect.poll(() => arrowVisible(page, 'Nouveau ticket')).toBe(false);
        const stopped = await box(page, 'Nouveau ticket');
        expect(Math.abs(stopped.y + stopped.height - (720 - 8))).toBeLessThanOrEqual(1);
        await expect(ticket).toBeFocused();
        await expect(ticket).toHaveValue('SHOP-501');
        await expect(window.getByText('de 17:00 à 17:15')).toBeVisible();

        // Revenu dans la vue, le créneau la reprend, flèche comprise.
        await page.evaluate((top) => {
            const region = document.querySelector('[role="region"]');
            region?.scrollBy({ top: top - (region.getBoundingClientRect().bottom - 8) });
        }, slotTop);
        await scrollGridTo(page, '12:00');
        await expect.poll(() => arrowVisible(page, 'Nouveau ticket')).toBe(true);
        await expect.poll(async () => (await box(page, 'Nouveau ticket')).y).toBe(opened.y);

        // L'enregistrement reste juste, Entrée ou clic à côté.
        await page.evaluate(() => {
            document.querySelector('[role="region"]')?.scrollTo({ top: 0 });
        });
        await ticket.press('Enter');
        await expect(window).toHaveCount(0);
        await expect
            .poll(() => savedDay(request, date))
            .toEqual([{ start: '17:00', end: '17:15', kind: 'work', ticket: 'SHOP-501', comment: null }]);
        await clearDay(request, date);
    });

    test('Nouveau ticket ne change pas de côté, et s’arrête sous la barre', async ({ page, request }) => {
        const date = day(7);
        await writeDay(request, date, []);
        await open(page, date);
        await scrollGridTo(page, '08:00');

        await doubleClickSlot(page, '12:00');
        const opened = await box(page, 'Nouveau ticket');
        const slotBox = await slot(page, '12:00').boundingBox();
        expect(opened.y + opened.height).toBeLessThan(slotBox?.y ?? 0);

        await page.evaluate(() => {
            document.querySelector('[role="region"]')?.scrollBy({ top: 2000 });
        });
        await expect.poll(() => arrowVisible(page, 'Nouveau ticket')).toBe(false);
        const stopped = await box(page, 'Nouveau ticket');
        const bar = await page.getByRole('banner').boundingBox();
        expect(stopped.y).toBeLessThan(opened.y);
        expect(Math.abs(stopped.y - ((bar?.y ?? 0) + (bar?.height ?? 0) + 8))).toBeLessThanOrEqual(1);
        await page.keyboard.press('Escape');
        await expect(ticketWindow(page)).toHaveCount(0);
        await clearDay(request, date);
    });

    test('aux bornes de la journée, 07:00 puis 19:45, reste entière et enregistre au bon endroit', async ({
        page,
        request,
    }) => {
        const date = day(27);
        await writeDay(request, date, []);
        await open(page, date);

        for (const [time, top] of [
            ['07:00', 2000],
            ['19:45', 0],
        ] as const) {
            await doubleClickSlot(page, time);
            const ticket = ticketWindow(page).getByLabel('Ticket');
            await ticket.fill('SHOP-501');
            await page.evaluate((to) => {
                document.querySelector('[role="region"]')?.scrollTo({ top: to });
            }, top);
            await expect.poll(() => arrowVisible(page, 'Nouveau ticket')).toBe(false);
            const stopped = await box(page, 'Nouveau ticket');
            expect(stopped.y).toBeGreaterThanOrEqual(64);
            expect(stopped.y + stopped.height).toBeLessThanOrEqual(720);
            await ticket.press('Enter');
            await expect(ticketWindow(page)).toHaveCount(0);
        }
        await expect
            .poll(async () => (await savedDay(request, date)).map((block) => block.start))
            .toEqual(['07:00', '19:45']);
        await clearDay(request, date);
    });

    test('Modifier le ticket s’arrête en bas quand son bloc sort par le bas', async ({ page, request }) => {
        const date = day(28);
        await writeDay(request, date, [{ start: '18:00', end: '18:30', ticket: 'SHOP-482', comment: 'Mapping' }]);
        await open(page, date);

        await doubleClickSlot(page, '18:00');
        const title = 'Modifier le ticket';
        await page.evaluate(() => {
            document.querySelector('[role="region"]')?.scrollTo({ top: 0 });
        });
        await expect.poll(() => arrowVisible(page, title)).toBe(false);
        const stopped = await box(page, title);
        expect(Math.abs(stopped.y + stopped.height - (720 - 8))).toBeLessThanOrEqual(1);
        await page.keyboard.press('Escape');
        await clearDay(request, date);
    });

    test('Modifier le ticket suit son bloc et s’arrête au bord', async ({ page, request }) => {
        const date = day(8);
        await writeDay(request, date, [{ start: '10:00', end: '11:00', ticket: 'SHOP-482', comment: 'Mapping' }]);
        await open(page, date);
        await scrollGridTo(page, '09:00');

        await doubleClickSlot(page, '10:00');
        const title = 'Modifier le ticket';
        const opened = await box(page, title);
        expect(await arrowVisible(page, title)).toBe(true);

        await page.evaluate(() => {
            document.querySelector('[role="region"]')?.scrollBy({ top: 48 });
        });
        await expect.poll(async () => (await box(page, title)).y).toBe(opened.y - 48);

        await page.evaluate(() => {
            document.querySelector('[role="region"]')?.scrollBy({ top: 2000 });
        });
        await expect.poll(() => arrowVisible(page, title)).toBe(false);
        const bar = await page.getByRole('banner').boundingBox();
        expect(Math.abs((await box(page, title)).y - ((bar?.y ?? 0) + (bar?.height ?? 0) + 8))).toBeLessThanOrEqual(1);

        const window = ticketWindow(page, title);
        await window.getByLabel('Commentaire').fill('Relu');
        await window.getByLabel('Commentaire').press('Enter');
        await expect(window).toHaveCount(0);
        await expect
            .poll(() => savedDay(request, date))
            .toEqual([{ start: '10:00', end: '11:00', kind: 'work', ticket: 'SHOP-482', comment: 'Relu' }]);
        await clearDay(request, date);
    });
});

test.describe('un bloc sans titre, Jira muet', () => {
    test('n’attend pas Jira pour changer son commentaire', async ({ page, request }) => {
        const date = day(26);
        await writeDay(request, date, [{ start: '09:00', end: '09:30', ticket: 'ESSAI-77' }]);
        await open(page, date);
        let asked = 0;
        await page.route('**/api/tickets/*/lookup', (route) => {
            asked += 1;

            return route.fulfill({ json: { status: 'unreachable', ticket: null, refusal: null } });
        });

        await doubleClickSlot(page, '09:00');
        const window = ticketWindow(page, 'Modifier le ticket');
        await expect(window.getByLabel('Ticket')).toHaveAccessibleDescription(/Jira ne répond pas/);
        const before = asked;
        await window.getByLabel('Commentaire').fill('Relu');
        await window.getByLabel('Commentaire').press('Enter');

        await expect(window).toHaveCount(0);
        expect(asked).toBe(before);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });
});

test.describe('une fenêtre refusée, un clic à côté', () => {
    test.use({ jira: { state: 'connected', unknown: 'not_found' }, expectedErrors: [refusedWith(422)] });

    test('un clic droit ailleurs n’ouvre aucun menu qui viserait un autre créneau', async ({ page, request }) => {
        const date = day(23);
        await writeDay(request, date, [{ start: '15:00', end: '15:15', ticket: 'SHOP-482' }]);
        await open(page, date);

        await doubleClickSlot(page, '10:00');
        const ticket = ticketWindow(page).getByLabel('Ticket');
        await ticket.fill('SHOP-999');
        await expect(ticket).toHaveAttribute('aria-invalid', 'true');

        await rightClickSlot(page, '15:00');

        await expect(menu(page)).toHaveCount(0);
        await expect(selected(page)).toHaveText(/10:00/);
        await expect(ticketWindow(page)).toBeVisible();
        await clearDay(request, date);
    });

    test('garde la sélection sur son créneau quand le ticket est introuvable', async ({ page, request }) => {
        const date = day(9);
        await writeDay(request, date, []);
        await open(page, date);

        await doubleClickSlot(page, '10:00');
        const ticket = ticketWindow(page).getByLabel('Ticket');
        await ticket.fill('SHOP-999');
        await expect(ticket).toHaveAttribute('aria-invalid', 'true');

        await clickSlot(page, '15:00');
        await expect(ticketWindow(page)).toBeVisible();
        await expect(selected(page)).toHaveCount(1);
        await expect(selected(page)).toHaveText(/10:00/);

        // Annulée, elle laisse la sélection là où elle était.
        await page.keyboard.press('Escape');
        await expect(selected(page)).toHaveText(/10:00/);
        expect(await savedDay(request, date)).toEqual([]);
        await clearDay(request, date);
    });

    test('garde la sélection sur son créneau quand le serveur la refuse', async ({ page, request }) => {
        const date = day(10);
        await writeDay(request, date, []);
        await open(page, date);

        await doubleClickSlot(page, '10:00');
        await ticketWindow(page).getByLabel('Commentaire').fill('Sans ticket');
        await clickSlot(page, '15:00');

        await expect(ticketWindow(page).getByLabel('Ticket')).toHaveAttribute('aria-invalid', 'true');
        await expect(selected(page)).toHaveCount(1);
        await expect(selected(page)).toHaveText(/10:00/);
        await clearDay(request, date);
    });

    test('n’enregistre pas un ticket introuvable en ouvrant une autre fenêtre', async ({ page, request }) => {
        const date = day(11);
        await writeDay(request, date, []);
        await open(page, date);

        await doubleClickSlot(page, '10:00');
        const ticket = ticketWindow(page).getByLabel('Ticket');
        await ticket.fill('SHOP-999');
        await expect(ticket).toHaveAttribute('aria-invalid', 'true');

        await doubleClickSlot(page, '15:00', NEAR_LEFT);

        await expect(ticket).toBeFocused();
        await expect(ticketWindow(page).getByText('de 10:00 à 10:15')).toBeVisible();
        expect(await savedDay(request, date)).toEqual([]);
        await clearDay(request, date);
    });

    test('ne bouge ni le jour ni le calendrier sur « Aujourd’hui » ou le logo', async ({ page, request }) => {
        const date = day(12);
        await writeDay(request, date, []);
        await open(page, date);
        const calendar = page.getByRole('grid', { name: 'Février 2023' });
        await expect(calendar).toBeVisible();

        await doubleClickSlot(page, '10:00');
        const ticket = ticketWindow(page).getByLabel('Ticket');
        await ticket.fill('SHOP-999');
        await expect(ticket).toHaveAttribute('aria-invalid', 'true');

        await page.getByRole('button', { name: "Aujourd'hui" }).click();
        await expect(calendar).toBeVisible();
        await page.getByRole('link', { name: /^DayTrack/ }).click();
        await page.waitForTimeout(200);
        await expect(calendar).toBeVisible();
        expect(new URL(page.url()).pathname).toBe(`/${date}`);
        await expect(ticketWindow(page)).toBeVisible();

        // La fenêtre fermée, le même bouton mène à aujourd'hui.
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: "Aujourd'hui" }).click();
        await expect.poll(() => new URL(page.url()).pathname).not.toBe(`/${date}`);
        await clearDay(request, date);
    });
});

test.describe('un double-clic qui ne visait pas la grille', () => {
    test('« Annuler » du message annule une fois, sans ouvrir de fenêtre', async ({ page, request }) => {
        const date = day(13);
        await writeDay(request, date, [{ start: '09:00', end: '10:00', ticket: 'SHOP-482' }]);
        await open(page, date);
        await clickSlot(page, '09:00');
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.press('Delete');
        await expect(message(page)).toHaveText(/SHOP-482 effacé/);

        const undo = message(page).getByRole('button', { name: 'Annuler' });
        const rect = await undo.boundingBox();
        await page.mouse.dblclick((rect?.x ?? 0) + 8, (rect?.y ?? 0) + 8);

        await expect(page.getByRole('dialog')).toHaveCount(0);
        await page.waitForTimeout(200);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(blocks(page)).toHaveCount(1);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('« Effacer » du menu efface sans déplacer la sélection', async ({ page, request }) => {
        const date = day(14);
        await writeDay(request, date, [{ start: '09:00', end: '09:15', ticket: 'SHOP-482' }]);
        await open(page, date);

        await rightClickSlot(page, '09:00');
        const item = menu(page).getByRole('menuitem', { name: 'Effacer' });
        const rect = await item.boundingBox();
        await page.mouse.dblclick((rect?.x ?? 0) + 16, (rect?.y ?? 0) + 8);

        await expect(blocks(page)).toHaveCount(0);
        await expect(selected(page)).toHaveCount(1);
        await expect(selected(page)).toHaveText(/09:00/);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await clearDay(request, date);
    });

    test('un vrai double-clic sur la grille ouvre toujours sa fenêtre', async ({ page, request }) => {
        const date = day(15);
        await writeDay(request, date, []);
        await open(page, date);

        await doubleClickSlot(page, '09:00');

        await expect(ticketWindow(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await clearDay(request, date);
    });
});

test.describe('Échap pendant un glisser', () => {
    test('abandonne le glisser : au relâcher, seul son créneau de départ reste sélectionné', async ({
        page,
        request,
    }) => {
        const date = day(16);
        await writeDay(request, date, []);
        await open(page, date);

        const from = await slotPoint(page, '09:00');
        const to = await slotPoint(page, '10:00');
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 4 });
        await page.keyboard.press('Escape');
        await expect(selected(page)).toHaveCount(1);
        await page.mouse.move(to.x, to.y + 48, { steps: 2 });
        await page.mouse.up();

        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(selected(page)).toHaveCount(1);
        await expect(selected(page)).toHaveText(/09:00/);
        expect(await savedDay(request, date)).toEqual([]);
        await clearDay(request, date);
    });

    test('un glisser mené au bout sélectionne toujours toute sa plage, sans rien ouvrir', async ({ page, request }) => {
        const date = day(17);
        await writeDay(request, date, []);
        await open(page, date);

        await dragSlots(page, '09:00', '09:45');

        await expect(selected(page)).toHaveText([/^09:00/, /^09:15/, /^09:30/, /^09:45/]);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await page.keyboard.press('Enter');
        await expect(ticketWindow(page).getByText('de 09:00 à 10:00')).toBeVisible();
        await page.keyboard.press('Escape');
        await clearDay(request, date);
    });
});

test.describe('un glisser près du bord de la grille', () => {
    function region(page: Page) {
        return page.getByRole('region', { name: 'Grille de la journée' });
    }

    function scrollTop(page: Page): Promise<number> {
        return region(page).evaluate((element) => element.scrollTop);
    }

    /** Le milieu d'un créneau, là où il est : la grille ne défile pas pour le montrer. */
    async function middle(page: Page, time: string) {
        const rect = await slot(page, time).boundingBox();
        if (rect === null) {
            throw new Error(`Le créneau de ${time} n’est pas à l’écran.`);
        }

        return { x: rect.x + 24, y: rect.y + rect.height / 2 };
    }

    /** Du milieu d'un créneau à celui d'un autre, en s'attardant comme une main. */
    async function slowDrag(page: Page, from: string, to: string) {
        const start = await middle(page, from);
        const end = await middle(page, to);
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        for (let step = 1; step <= 10; step++) {
            await page.mouse.move(start.x, start.y + ((end.y - start.y) * step) / 10);
            await page.waitForTimeout(30);
        }
    }

    test('ne fait défiler la grille que du côté où il va', async ({ page, request }) => {
        const date = day(29);
        await writeDay(request, date, []);
        await open(page, date);

        // Parti de la dernière ligne visible, il remonte : la grille ne bouge pas, et la
        // sélection est celle qu'on a glissée.
        await slot(page, '15:30').evaluate((option) => {
            const grid = option.closest('[role="region"]');
            if (grid !== null) {
                grid.scrollTop += option.getBoundingClientRect().bottom - grid.getBoundingClientRect().bottom;
            }
        });
        const atBottom = await scrollTop(page);
        await slowDrag(page, '15:30', '15:00');
        expect(await scrollTop(page)).toBe(atBottom);
        await page.mouse.up();
        await expect(selected(page)).toHaveText([/^15:00/, /^15:15/, /^15:30/]);
        expect(await scrollTop(page)).toBe(atBottom);

        // Parti de la première ligne visible, il descend : la grille ne bouge pas non plus.
        await scrollGridTo(page, '09:00');
        const atTop = await scrollTop(page);
        await slowDrag(page, '09:00', '09:30');
        expect(await scrollTop(page)).toBe(atTop);
        await page.mouse.up();
        await expect(selected(page)).toHaveText([/^09:00/, /^09:15/, /^09:30/]);

        // Mené jusqu'au bas de la vue, il la fait défiler, et la sélection suit au-delà.
        const start = await middle(page, '09:00');
        const view = await region(page).boundingBox();
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x, (view?.y ?? 0) + (view?.height ?? 0) - 4, { steps: 8 });
        await expect.poll(() => scrollTop(page)).toBeGreaterThan(atTop + 100);
        await page.mouse.up();
        const reached = await selected(page).allTextContents();
        expect(reached[0]).toMatch(/^09:00/);
        expect(reached.length).toBeGreaterThan(12);

        // Mené jusqu'en haut de la vue, il la fait défiler vers le haut, et la sélection suit.
        await slot(page, '13:00').evaluate((option) => {
            option.scrollIntoView({ block: 'center' });
        });
        const centered = await scrollTop(page);
        const from = await middle(page, '13:00');
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x, (view?.y ?? 0) + 4, { steps: 8 });
        await expect.poll(() => scrollTop(page)).toBeLessThan(centered - 100);
        await page.mouse.up();
        const climbed = await selected(page).allTextContents();
        expect(climbed.at(-1)).toMatch(/^13:00/);
        expect(climbed.length).toBeGreaterThan(12);

        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect(await savedDay(request, date)).toEqual([]);
        await clearDay(request, date);
    });
});

test.describe('coller un groupe qui a un trou', () => {
    test('se colle sur 19:45 quand seul le créneau vide dépasserait 20:00', async ({ page, request }) => {
        const date = day(18);
        await writeDay(request, date, [{ start: '09:00', end: '09:15', ticket: 'SHOP-482' }]);
        await open(page, date);

        await clickSlot(page, '09:00');
        await clickSlot(page, '09:15', ['Shift']);
        await page.keyboard.press('ControlOrMeta+C');
        await clickSlot(page, '19:45');
        await page.keyboard.press('ControlOrMeta+V');

        await expect(blocks(page)).toHaveCount(2);
        await expect(message(page)).toHaveCount(0);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('efface ce que le trou recouvre, le dit, et Ctrl+Z le rend', async ({ page, request }) => {
        const date = day(19);
        await writeDay(request, date, [
            { start: '09:00', end: '09:15', ticket: 'SHOP-482' },
            { start: '09:30', end: '09:45', ticket: 'SHOP-519' },
            { start: '14:15', end: '14:30', ticket: 'OPS-12' },
        ]);
        await open(page, date);

        await clickSlot(page, '09:00');
        await clickSlot(page, '09:30', ['Shift']);
        await page.keyboard.press('ControlOrMeta+C');
        await clickSlot(page, '14:00');
        await page.keyboard.press('ControlOrMeta+V');

        await expect(message(page)).toHaveText(/OPS-12 remplacé/);
        await expect(blocks(page).filter({ hasText: 'OPS-12' })).toHaveCount(0);
        await expectGridMatchesBase(page, request, date);

        await message(page).getByRole('button', { name: 'Annuler' }).click();
        await expect(blocks(page).filter({ hasText: 'OPS-12' })).toHaveCount(1);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });
});

test.describe('un ticket tapé pendant que Jira refuse le jeton', () => {
    test.use({ favorites: 'none', expectedErrors: [refusedWith(422)] });

    const serveLookup = async (page: Page) => {
        const answer = { value: 'refused' };
        await page.route('**/api/tickets/*/lookup', (route) =>
            route.fulfill({
                json:
                    answer.value === 'refused'
                        ? { status: 'refused', ticket: null, refusal: 'refused' }
                        : { status: 'not_found', ticket: null, refusal: null },
            }),
        );

        return answer;
    };

    test('ne s’enregistre pas, Jira revenu, sans avoir été retapé', async ({ page, request }) => {
        const date = day(21);
        await writeDay(request, date, []);
        await open(page, date);
        const answer = await serveLookup(page);

        await doubleClickSlot(page, '10:00');
        const ticket = ticketWindow(page).getByLabel('Ticket');
        await ticket.fill('SHOP-999');
        await expect(ticket).toHaveAccessibleDescription(/Impossible de vérifier/);
        answer.value = 'not_found';

        await ticketWindow(page).getByRole('button', { name: 'Enregistrer' }).click();

        await expect(ticket).toHaveAccessibleDescription(/Ticket introuvable dans Jira/);
        await expect(ticket).toBeFocused();
        expect(await savedDay(request, date)).toEqual([]);

        // De même par une autre fenêtre qu'on ouvre, le refus retapé.
        await page.keyboard.press('Escape');
        answer.value = 'refused';
        await doubleClickSlot(page, '10:00');
        const again = ticketWindow(page).getByLabel('Ticket');
        await again.fill('SHOP-998');
        await expect(again).toHaveAccessibleDescription(/Impossible de vérifier/);
        answer.value = 'not_found';
        await doubleClickSlot(page, '15:00', NEAR_LEFT);
        await expect(again).toHaveAccessibleDescription(/Ticket introuvable dans Jira/);
        await expect(ticketWindow(page).getByText('de 10:00 à 10:15')).toBeVisible();
        expect(await savedDay(request, date)).toEqual([]);
        await clearDay(request, date);
    });

    test('un favori refusé à l’écran ne s’ajoute pas, quel que soit le geste', async ({ page, request }) => {
        const date = day(22);
        await writeDay(request, date, []);
        await open(page, date);
        await serveLookup(page).then((answer) => {
            answer.value = 'not_found';
        });
        const posted: string[] = [];
        await page.route('**/api/favorites', async (route) => {
            if (route.request().method() === 'POST') {
                posted.push(route.request().url());
            }
            await route.fallback();
        });

        await page.getByRole('button', { name: 'Ajouter un favori' }).first().click();
        const field = page.getByRole('textbox', { name: 'Nouveau favori' });
        await field.fill('SHOP-999');
        await expect(field).toHaveAccessibleDescription(/Ticket introuvable dans Jira/);

        await page.getByRole('group', { name: 'Nouveau favori' }).getByRole('button', { name: 'Ajouter' }).click();
        await expect(field).toBeFocused();
        await doubleClickSlot(page, '10:00');
        await expect(field).toBeFocused();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await page.getByRole('button', { name: "Aujourd'hui" }).click();
        await expect(field).toBeFocused();
        expect(new URL(page.url()).pathname).toBe(`/${date}`);

        expect(posted).toEqual([]);
        await clearDay(request, date);
    });
});

test.describe('un ticket retapé une fois Jira revenu', () => {
    test('n’est plus accepté sur la foi de la réponse d’avant', async ({ page, request }) => {
        const date = day(20);
        await writeDay(request, date, []);
        await open(page, date);
        const answer = { value: 'refused' };
        await page.route('**/api/tickets/*/lookup', (route) =>
            route.fulfill({
                json:
                    answer.value === 'refused'
                        ? { status: 'refused', ticket: null, refusal: 'refused' }
                        : { status: 'not_found', ticket: null, refusal: null },
            }),
        );

        await doubleClickSlot(page, '10:00');
        const ticket = ticketWindow(page).getByLabel('Ticket');
        await ticket.fill('SHOP-999');
        await expect(ticket).toHaveAccessibleDescription(/Impossible de vérifier/);
        await page.keyboard.press('Escape');
        await expect(ticketWindow(page)).toHaveCount(0);

        answer.value = 'not_found';
        await doubleClickSlot(page, '10:00');
        const again = ticketWindow(page).getByLabel('Ticket');
        await again.fill('SHOP-999');

        await expect(again).toHaveAttribute('aria-invalid', 'true');
        await expect(again).toHaveAccessibleDescription(/Ticket introuvable dans Jira/);
        await page.keyboard.press('Escape');
        await clearDay(request, date);
    });
});
