import type { Locator, Page } from '@playwright/test';

import { addDays, claimDay, startTimeAt, weekdaysFrom, writeDay } from './day';
import { doubleClickSlot, openDay, scrollGridTo, slot, ticketWindow } from './editing';
import { expect, refusedWith, test } from './fixtures';
import { isoWeekday, postRecurrence, recurrenceBox, serveOngoing } from './recurrence';

/**
 * Une fenêtre plus haute que la place en prend toute la hauteur : l'en-tête et le pied
 * restent, le contenu défile entre les deux (Popover.tsx). Sur un écran très bas, la
 * fenêtre d'un ticket l'est déjà ; celle d'un ticket qui revient l'est sur un portable
 * (tests/e2e/recurrences.spec.ts). Une fenêtre qui grandit — sa case « Récurrence » cochée, un
 * refus — le fait vers le bas, sans bouger ; seul un navigateur qu'on réduit la replace quand
 * elle ne tient plus entière nulle part.
 */

const day = weekdaysFrom('2018-01-08');

/** Assez bas pour que Nouveau ticket n'y tienne entier ni au-dessus ni dessous de son créneau. */
const SHORT = { width: 1440, height: 400 };

function scrollingBody(window: Locator): Locator {
    return window.locator('.popover-body');
}

async function box(locator: Locator) {
    const found = await locator.boundingBox();
    if (found === null) {
        throw new Error('L’élément n’est pas affiché.');
    }

    return found;
}

/** Chaque parcours a son jour : ils tournent en même temps. */
async function openShortWindow(page: Page, index: number, time: string): Promise<Locator> {
    const date = claimDay(day(index));
    await page.setViewportSize(SHORT);
    await startTimeAt(page, date, '18:00');
    await openDay(page, date);
    await scrollGridTo(page, '14:00');
    await doubleClickSlot(page, time);
    const window = ticketWindow(page);
    await expect(window).toBeVisible();

    return window;
}

/** Fait défiler la grille pour que ce créneau soit en bas de l'écran, à ce nombre de quarts d'heure du bord. */
async function lowOnScreen(page: Page, time: string, quarters = 2): Promise<void> {
    await slot(page, time).evaluate((option, rows) => {
        const region = option.closest('[role="region"]');
        if (region !== null) {
            const quarter = option.getBoundingClientRect();
            const bottom = Math.min(region.getBoundingClientRect().bottom, window.innerHeight);
            region.scrollTop += quarter.bottom - (bottom - rows * quarter.height);
        }
    }, quarters);
}

/** Fait défiler la grille pour que le haut de ce créneau soit à cette hauteur de l'écran. */
async function slotAt(page: Page, time: string, y: number): Promise<void> {
    await slot(page, time).evaluate((option, top) => {
        const region = option.closest('[role="region"]');
        if (region !== null) {
            region.scrollTop += option.getBoundingClientRect().top - top;
        }
    }, y);
}

/**
 * La fenêtre est entière à l'écran, titre et boutons compris, et ne recouvre pas le créneau
 * qu'elle désigne : elle est au-dessus ou dessous.
 */
async function expectBesideSlot(page: Page, window: Locator, title: string, time: string): Promise<void> {
    const height = page.viewportSize()?.height ?? 0;
    await expect(async () => {
        const shown = await box(window);
        const quarter = await box(slot(page, time));
        expect(shown.y).toBeGreaterThanOrEqual(0);
        expect(shown.y + shown.height).toBeLessThanOrEqual(height);
        expect(shown.y + shown.height <= quarter.y + 1 || shown.y >= quarter.y + quarter.height - 1).toBe(true);
    }).toPass();
    await expect(window.getByRole('heading', { name: title })).toBeInViewport({ ratio: 1 });
    await expect(window.getByRole('button', { name: 'Enregistrer' })).toBeInViewport({ ratio: 1 });
}

/**
 * La case « Récurrence » cochée dans une fenêtre posée au-dessus de son créneau : la case reste
 * sous la souris, la fenêtre garde son bord haut, entière à l'écran, titre et boutons compris,
 * et fait défiler son contenu s'il le faut.
 */
async function expectGrowsInPlace(page: Page, window: Locator, title: string): Promise<void> {
    const height = page.viewportSize()?.height ?? 0;
    const label = window.getByText('Récurrence', { exact: true });
    const closed = await box(window);
    const before = await box(label);

    await label.click();

    await expect(window.getByRole('group', { name: 'Jours' })).toBeAttached();
    await expect(async () => {
        const shown = await box(window);
        expect(Math.abs(shown.y - closed.y)).toBeLessThanOrEqual(1);
        expect(Math.abs((await box(label)).y - before.y)).toBeLessThanOrEqual(1);
        expect(shown.y + shown.height).toBeLessThanOrEqual(height);
    }).toPass();
    await expect(window.getByRole('heading', { name: title })).toBeInViewport({ ratio: 1 });
    await expect(window.getByRole('button', { name: 'Enregistrer' })).toBeInViewport({ ratio: 1 });
}

/** Cet élément est à l'écran, entier dans le contenu de la fenêtre qui défile, au pixel près. */
async function expectWithinBody(window: Locator, shown: Locator): Promise<void> {
    await expect(shown).toBeInViewport();
    await expect(async () => {
        const inner = await box(shown);
        const body = await box(scrollingBody(window));
        expect(inner.y).toBeGreaterThanOrEqual(body.y - 1);
        expect(inner.y + inner.height).toBeLessThanOrEqual(body.y + body.height + 1);
    }).toPass();
}

/** --s-2 : la marge d'une fenêtre avec le bord de l'écran. */
const MARGIN = 8;

/**
 * La fenêtre a grandi vers le bas sans bouger : son bord haut et la case qu'on vient de
 * cliquer sont restés où ils étaient, et elle s'allonge jusqu'à sa marge du bas de l'écran,
 * son contenu défilant au-delà — ou elle tient entière. Son pied reste à l'écran.
 */
async function expectGrownDown(
    page: Page,
    window: Locator,
    closed: { readonly y: number },
    clicked: { readonly label: Locator; readonly before: { readonly y: number } } | null = null,
): Promise<void> {
    const height = page.viewportSize()?.height ?? 0;
    await expect(async () => {
        const shown = await box(window);
        expect(Math.abs(shown.y - closed.y)).toBeLessThanOrEqual(1);
        if (clicked !== null) {
            expect(Math.abs((await box(clicked.label)).y - clicked.before.y)).toBeLessThanOrEqual(1);
        }
        expect(shown.y + shown.height).toBeLessThanOrEqual(height);
        const { scrollHeight, clientHeight } = await scrollingBody(window).evaluate((node) => ({
            scrollHeight: node.scrollHeight,
            clientHeight: node.clientHeight,
        }));
        if (scrollHeight > clientHeight + 1) {
            expect(shown.y + shown.height).toBeGreaterThanOrEqual(height - MARGIN - 1);
        }
    }).toPass();
    await expect(window.getByRole('button', { name: 'Enregistrer' })).toBeInViewport({ ratio: 1 });
}

test.describe('une fenêtre plus haute que la place', () => {
    for (const [index, time] of [
        [1, '14:15'],
        [2, '16:15'],
    ] as const) {
        test(`tient dans l’écran, son titre et ses boutons visibles, ouverte sur ${time}`, async ({ page }) => {
            const window = await openShortWindow(page, index, time);

            const shown = await box(window);
            expect(shown.y).toBeGreaterThanOrEqual(0);
            expect(shown.y + shown.height).toBeLessThanOrEqual(SHORT.height);
            await expect(window.getByRole('heading', { name: 'Nouveau ticket' })).toBeInViewport({ ratio: 1 });
            await expect(window.getByRole('button', { name: 'Enregistrer' })).toBeInViewport({ ratio: 1 });
            // Le contenu, lui, ne tient pas : il défile.
            const body = scrollingBody(window);
            const { scrollHeight, clientHeight } = await body.evaluate((node) => ({
                scrollHeight: node.scrollHeight,
                clientHeight: node.clientHeight,
            }));
            expect(scrollHeight).toBeGreaterThan(clientHeight);
        });
    }

    test('la molette fait défiler son contenu, jamais la grille dessous', async ({ page }) => {
        const window = await openShortWindow(page, 3, '14:15');
        const gridScroll = () => slot(page, '14:00').evaluate((option) => option.closest('[role="region"]')?.scrollTop);
        const gridTop = await gridScroll();
        expect(gridTop).toBeGreaterThan(0);
        const body = scrollingBody(window);

        const { x, y, width, height } = await box(body);
        await page.mouse.move(x + width / 2, y + height / 2);
        // Bien au-delà du bout du contenu : ce qui reste ne passe pas à la grille.
        await page.mouse.wheel(0, 2000);

        await expect.poll(() => body.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
        expect(await body.evaluate((node) => node.scrollTop + node.clientHeight)).toBeGreaterThanOrEqual(
            await body.evaluate((node) => node.scrollHeight - 1),
        );
        expect(await gridScroll()).toBe(gridTop);
    });

    test('Tab amène à l’écran le champ caché qu’il atteint', async ({ page }) => {
        const window = await openShortWindow(page, 4, '14:15');
        const comment = window.getByLabel('Commentaire');
        await expect(window.getByLabel('Ticket')).toBeFocused();

        await page.keyboard.press('Tab');

        await expect(comment).toBeFocused();
        await expect(comment).toBeInViewport();
        const field = await box(comment);
        const shown = await box(scrollingBody(window));
        expect(field.y).toBeGreaterThanOrEqual(shown.y);
        expect(field.y + field.height).toBeLessThanOrEqual(shown.y + shown.height + 1);
    });
});

test.describe('une fenêtre qui grandit', () => {
    for (const [index, width, height, time] of [
        [5, 1440, 640, '12:00'],
        [6, 1024, 720, '19:00'],
        [7, 1024, 600, '19:00'],
        [8, 1440, 560, '19:45'],
    ] as const) {
        test(`garde son bord haut et la case sous la souris, sa case « Récurrence » cochée, en ${String(width)} × ${String(height)} sur ${time}`, async ({
            page,
        }) => {
            const date = claimDay(day(index));
            await page.setViewportSize({ width, height });
            await startTimeAt(page, date, '08:00');
            await openDay(page, date);
            await lowOnScreen(page, time);
            await doubleClickSlot(page, time);
            const window = ticketWindow(page);
            await window.getByLabel('Ticket').fill('OPS-12');
            await expectBesideSlot(page, window, 'Nouveau ticket', time);

            await expectGrowsInPlace(page, window, 'Nouveau ticket');
            await page.keyboard.press('Escape');
            await expect(window).toBeHidden();
        });
    }

    test('garde son bord haut dans Modifier le ticket, la case cochée sur un bloc bas', async ({ page, request }) => {
        const date = claimDay(day(9));
        await writeDay(request, date, [{ start: '19:00', end: '19:15', ticket: 'OPS-12', comment: 'Astreinte' }]);
        await page.setViewportSize({ width: 1024, height: 600 });
        await startTimeAt(page, date, '08:00');
        await openDay(page, date);
        await lowOnScreen(page, '19:00');
        await doubleClickSlot(page, '19:00');
        const window = ticketWindow(page, 'Modifier le ticket');
        await expectBesideSlot(page, window, 'Modifier le ticket', '19:00');

        await expectGrowsInPlace(page, window, 'Modifier le ticket');
        await page.keyboard.press('Escape');
        await expect(window).toBeHidden();
    });

    for (const [index, width, height, time, y] of [
        [10, 1440, 900, '17:00', 240],
        [12, 1280, 800, '16:00', 560],
    ] as const) {
        test(`au-dessus de son créneau, grandit vers le bas : la case reste sous la souris, la flèche disparaît, en ${String(width)} × ${String(height)}`, async ({
            page,
        }) => {
            const date = claimDay(day(index));
            await page.setViewportSize({ width, height });
            await startTimeAt(page, date, '08:00');
            await openDay(page, date);
            // Assez bas pour qu'elle s'ouvre au-dessus ; sur l'écran plus court, dépliée, elle
            // atteint le bas de l'écran.
            await slotAt(page, time, y);
            await doubleClickSlot(page, time);
            const window = ticketWindow(page);
            await window.getByLabel('Ticket').fill('OPS-12');
            await expectBesideSlot(page, window, 'Nouveau ticket', time);
            const closed = await box(window);
            const label = window.getByText('Récurrence', { exact: true });
            const before = await box(label);
            await expect(window.locator('svg').last()).toBeVisible();

            await label.click();

            await expect(window.getByRole('group', { name: 'Jours' })).toBeVisible();
            // Son bord haut et la case n'ont pas bougé ; elle passe sur son créneau, sans sa flèche.
            await expect(async () => {
                expect(Math.abs((await box(window)).y - closed.y)).toBeLessThanOrEqual(1);
                expect(Math.abs((await box(label)).y - before.y)).toBeLessThanOrEqual(1);
            }).toPass();
            const quarter = await box(slot(page, time));
            const opened = await box(window);
            expect(opened.y + opened.height).toBeGreaterThan(quarter.y + quarter.height);
            expect(opened.y + opened.height).toBeLessThanOrEqual(height);
            await expect(page.locator('[data-radix-popper-content-wrapper] svg.invisible')).toHaveCount(1);
            await expect(window.getByRole('button', { name: 'Enregistrer' })).toBeInViewport({ ratio: 1 });
            if (height === 800) {
                // Arrêtée au bas de l'écran : son contenu défile, jusqu'aux prochaines fois.
                const body = scrollingBody(window);
                const { scrollHeight, clientHeight } = await body.evaluate((node) => ({
                    scrollHeight: node.scrollHeight,
                    clientHeight: node.clientHeight,
                }));
                expect(scrollHeight).toBeGreaterThan(clientHeight);
            }
            await page.keyboard.press('Escape');
            await expect(window).toBeHidden();
        });
    }

    test('ouverte dépliée sur un bloc bas qui revient : décochée, elle se recolle ; recochée, la case reste sous la souris', async ({
        page,
        request,
    }) => {
        const date = claimDay(day(13));
        const range = { start: '17:15', end: '17:30', ticket: 'SHOP-519' };
        await writeDay(request, date, []);
        // Une fin passée, comme toute récurrence des parcours : rien ne se pose sur un jour à venir du poste.
        await postRecurrence(request, date, range, [new Date(`${date}T12:00:00Z`).getUTCDay()], date);
        await page.setViewportSize({ width: 1440, height: 900 });
        await startTimeAt(page, date, '08:00');
        await openDay(page, date);
        await lowOnScreen(page, '17:15');
        await doubleClickSlot(page, '17:15');
        const window = ticketWindow(page, 'Modifier le ticket');
        const box17 = window.getByRole('checkbox', { name: 'Récurrence' });
        await expect(box17).toBeChecked();
        const label = window.getByText('Récurrence', { exact: true });

        await label.click();
        await expect(box17).not.toBeChecked();
        await expect(window.getByRole('group', { name: 'Jours' })).toBeHidden();
        await expectBesideSlot(page, window, 'Modifier le ticket', '17:15');
        const before = await box(label);
        const closed = await box(window);

        await label.click();

        await expect(window.getByRole('group', { name: 'Jours' })).toBeVisible();
        await expect(async () => {
            expect(Math.abs((await box(label)).y - before.y)).toBeLessThanOrEqual(1);
            expect(Math.abs((await box(window)).y - closed.y)).toBeLessThanOrEqual(1);
        }).toPass();
        const shown = await box(window);
        expect(shown.y + shown.height).toBeLessThanOrEqual(900);
        await expect(window.getByRole('button', { name: 'Enregistrer' })).toBeInViewport({ ratio: 1 });
        await page.keyboard.press('Escape');
        await expect(window).toBeHidden();
    });

    for (const [index, width, height] of [
        [14, 1440, 900],
        [15, 1280, 800],
        [16, 1024, 720],
    ] as const) {
        test(`au milieu de l’écran, descend jusqu’au bas de l’écran sans bouger quand elle grandit encore, en ${String(width)} × ${String(height)}`, async ({
            page,
        }) => {
            const date = claimDay(day(index));
            await page.setViewportSize({ width, height });
            await startTimeAt(page, date, '08:00');
            await openDay(page, date);
            await slotAt(page, '16:00', Math.round(height / 2) - 14);
            await doubleClickSlot(page, '16:00');
            const window = ticketWindow(page);
            await window.getByLabel('Ticket').fill('OPS-21');
            const label = window.getByText('Récurrence', { exact: true });
            // Sous le pied d'une fenêtre qui défile déjà, la case s'amène d'abord à l'écran.
            await label.scrollIntoViewIfNeeded();
            const closed = await box(window);
            const before = await box(label);

            await label.click();
            await expect(window.getByRole('group', { name: 'Jours' })).toBeVisible();
            await expectGrownDown(page, window, closed, { label, before });

            // Une semaine sur 2 l'allonge encore, ses prochaines fois montrant les semaines sans :
            // la carte cliquée s'amène à l'écran, la fenêtre ne bouge pas.
            await window
                .getByRole('radiogroup', { name: 'Rythme' })
                .getByRole('radio', { name: 'Une semaine sur 2' })
                .click();
            await expect(window.getByRole('group', { name: 'Une semaine sur' })).toBeVisible();
            await expectGrownDown(page, window, closed);
            await page.keyboard.press('Escape');
            await expect(window).toBeHidden();
        });

        test(`ouverte dépliée sur un bloc qui revient au milieu de l’écran : décochée, elle se recolle ; recochée, elle grandit sans bouger, en ${String(width)} × ${String(height)}`, async ({
            page,
            request,
        }) => {
            const date = claimDay(day(index + 4));
            const range = { start: '13:00', end: '13:15', ticket: 'OPS-21', comment: 'Point' };
            await writeDay(request, date, []);
            // Une fin passée, comme toute récurrence des parcours : rien ne se pose sur un jour à venir du poste.
            await postRecurrence(request, date, range, [new Date(`${date}T12:00:00Z`).getUTCDay()], date);
            await page.setViewportSize({ width, height });
            await startTimeAt(page, date, '08:00');
            await openDay(page, date);
            await slotAt(page, '13:00', width === 1024 ? 500 : Math.round(height / 2));
            await doubleClickSlot(page, '13:00');
            const window = ticketWindow(page, 'Modifier le ticket');
            const checkbox = window.getByRole('checkbox', { name: 'Récurrence' });
            await expect(checkbox).toBeChecked();
            const label = window.getByText('Récurrence', { exact: true });

            await label.click();
            await expect(checkbox).not.toBeChecked();
            await expect(window.getByRole('group', { name: 'Jours' })).toBeHidden();
            await expectBesideSlot(page, window, 'Modifier le ticket', '13:00');
            await label.scrollIntoViewIfNeeded();
            const closed = await box(window);
            const before = await box(label);

            await label.click();

            await expect(window.getByRole('group', { name: 'Jours' })).toBeVisible();
            await expectGrownDown(page, window, closed, { label, before });
            await page.keyboard.press('Escape');
            await expect(window).toBeHidden();
        });
    }

    test('se replace quand on réduit le navigateur, la fenêtre ouverte', async ({ page }) => {
        const date = claimDay(day(11));
        await page.setViewportSize({ width: 1440, height: 900 });
        await startTimeAt(page, date, '08:00');
        await openDay(page, date);
        // Assez haut pour qu'elle s'ouvre dessous, et qu'elle y tienne dépliée, avant qu'on
        // réduise le navigateur.
        await slotAt(page, '09:00', 120);
        await doubleClickSlot(page, '09:00');
        const window = ticketWindow(page);
        await window.getByLabel('Ticket').fill('OPS-12');
        await window.getByText('Récurrence', { exact: true }).click();
        await expect(window.getByRole('group', { name: 'Jours' })).toBeVisible();
        await expectBesideSlot(page, window, 'Nouveau ticket', '09:00');

        await page.setViewportSize({ width: 1440, height: 560 });

        await expectBesideSlot(page, window, 'Nouveau ticket', '09:00');
        // Son contenu défile, ses champs gardés.
        await expect(window.getByLabel('Ticket')).toHaveValue('OPS-12');
        await page.keyboard.press('Escape');
        await expect(window).toBeHidden();
    });
});

test.describe('le rythme au clavier, sous le refus d’un créneau pris', () => {
    test('la carte qui a le curseur reste à l’écran, de Tab aux flèches, la fenêtre plus haute que la place', async ({
        page,
    }) => {
        // Une autre récurrence prend le créneau chaque semaine, ce jour de la semaine : chaque
        // carte du rythme est refusée, et le groupe désigne le refus, loin sous lui. Servie avec
        // la journée, sans rien écrire.
        const date = day(23);
        await serveOngoing(page, date, {
            '019a6c1e-1330-7000-8000-000000000123': {
                start: '14:00',
                end: '15:00',
                kind: 'weekly',
                weekdays: [isoWeekday(date)],
                everyWeeks: 1,
                monthWeek: null,
                monthDay: null,
                firstDay: addDays(date, -7),
                until: null,
                slot: { kind: 'work', ticket: 'OPS-12', comment: 'Point hebdo' },
            },
        });
        const window = await openShortWindow(page, 23, '14:15');
        await recurrenceBox(window).click();
        const alert = window.getByRole('alert');
        await expect(alert).toContainText('ce créneau est déjà pris par la récurrence « Point hebdo ».');
        const rhythm = window.getByRole('radiogroup', { name: 'Rythme' });
        await expect(rhythm).toHaveAccessibleDescription(/ce créneau est déjà pris/);

        await page.keyboard.press('Tab');

        const weekly = rhythm.getByRole('radio', { name: 'Chaque semaine' });
        await expect(weekly).toBeFocused();
        await expectWithinBody(window, weekly);
        for (const [key, name] of [
            ['ArrowRight', 'Une semaine sur 2'],
            ['ArrowRight', 'Chaque mois'],
            ['ArrowLeft', 'Une semaine sur 2'],
        ] as const) {
            await page.keyboard.press(key);
            const card = rhythm.getByRole('radio', { name });
            await expect(card).toBeChecked();
            await expect(card).toBeFocused();
            await expect(alert).toBeAttached();
            await expectWithinBody(window, card);
        }
        await page.keyboard.press('Escape');
        await expect(window).toBeHidden();
    });
});

test.describe('un refus dans une fenêtre qui défile', () => {
    test.use({ expectedErrors: [refusedWith(409)] });

    test('un refus qui ne tient à aucun champ s’amène à l’écran, la fenêtre plus haute que la place', async ({
        page,
        request,
    }) => {
        const date = claimDay(day(22));
        await writeDay(request, date, [{ start: '14:00', end: '15:00', ticket: 'SHOP-482', comment: 'Mapping' }]);
        await page.setViewportSize(SHORT);
        await startTimeAt(page, date, '18:00');
        await openDay(page, date);
        await scrollGridTo(page, '14:00');
        await doubleClickSlot(page, '14:15');
        const window = ticketWindow(page, 'Modifier le ticket');
        await window.getByLabel('Commentaire').fill('Mapping revu');
        // L'autre onglet raccourcit le bloc et pose OPS-1 derrière.
        await writeDay(request, date, [
            { start: '14:00', end: '14:30', ticket: 'SHOP-482', comment: 'Mapping' },
            { start: '14:30', end: '15:00', ticket: 'OPS-1', comment: 'Autre onglet' },
        ]);

        await window.getByLabel('Commentaire').press('Enter');

        const refusal = window.getByText('La journée a changé entre-temps. Vérifiez, puis enregistrez de nouveau.');
        await expect(refusal).toBeVisible();
        await expect(refusal).toBeInViewport({ ratio: 1 });
        await expect(async () => {
            const said = await box(refusal);
            const body = await box(scrollingBody(window));
            expect(said.y).toBeGreaterThanOrEqual(body.y - 1);
            expect(said.y + said.height).toBeLessThanOrEqual(body.y + body.height + 1);
        }).toPass();
        await expect(window.getByLabel('Commentaire')).toHaveValue('Mapping revu');
        await page.keyboard.press('Escape');
        await expect(window).toBeHidden();
    });

    for (const [index, width, height] of [
        [24, 1440, 900],
        [25, 1024, 720],
    ] as const) {
        test(`un refus qui ne tient à aucun champ s’amène à l’écran, la fenêtre posée au-dessus de son créneau, en ${String(width)} × ${String(height)}`, async ({
            page,
            request,
        }) => {
            const date = claimDay(day(index));
            await writeDay(request, date, [{ start: '18:00', end: '19:00', ticket: 'SHOP-482', comment: 'Mapping' }]);
            await page.setViewportSize({ width, height });
            await startTimeAt(page, date, '08:00');
            await openDay(page, date);
            // Le quart d'heure de la dernière ligne visible : la fenêtre s'ouvre au-dessus, et le
            // refus l'allonge au-delà du bas de l'écran.
            await lowOnScreen(page, '18:30', 0);
            await doubleClickSlot(page, '18:30');
            const window = ticketWindow(page, 'Modifier le ticket');
            await expectBesideSlot(page, window, 'Modifier le ticket', '18:30');
            const quarter = await box(slot(page, '18:30'));
            expect((await box(window)).y).toBeLessThan(quarter.y);
            await window.getByLabel('Commentaire').fill('Mapping revu');
            // L'autre onglet remplace le bloc par OPS-1.
            await writeDay(request, date, [{ start: '18:00', end: '19:00', ticket: 'OPS-1', comment: 'Autre onglet' }]);

            await window.getByLabel('Commentaire').press('Enter');

            // Devenue Nouveau ticket, plus haute du refus et de « Remplace… », elle a grandi vers
            // le bas au-delà de l'écran : son contenu défile, et le refus s'amène à l'écran.
            const replacing = ticketWindow(page);
            const refusal = replacing.getByText(
                'La journée a changé entre-temps. Vérifiez, puis enregistrez de nouveau.',
            );
            await expect(refusal).toBeVisible();
            await expect(replacing.getByText(/^Remplace /)).toHaveText('Remplace OPS-1 sur ces 60 minutes.');
            await expectWithinBody(replacing, refusal);
            await expect(refusal).toBeInViewport({ ratio: 1 });
            await expect(replacing.getByLabel('Commentaire')).toHaveValue('Mapping revu');
            await page.keyboard.press('Escape');
            await expect(replacing).toBeHidden();
        });
    }
});
