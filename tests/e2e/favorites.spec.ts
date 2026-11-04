import AxeBuilder from '@axe-core/playwright';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { clearDay, type Entry, startTimeAt, weekday, writeDay } from './day';
import { clickSlot, doubleClickSlot, expectGridMatchesBase, message, savedDay, slotPoint } from './editing';
import { expect, refusedWith, test } from './fixtures';

/**
 * La liste des favoris, contre la vraie base : un clic copie, glisser pose sur un
 * créneau, double-clic renomme, glisser dans la liste change l'ordre, un bloc glissé sur
 * la liste devient un favori, et le menu du clic droit fait tout cela sans glisser.
 *
 * Les favoris ne tiennent à aucun jour : ces parcours passent l'un après l'autre, avec
 * des tickets à eux (ESSAI-*), qu'ils retirent en partant. Ils ne supposent pas la liste
 * vide : sur le poste, celle du développement peut avoir les siens.
 */
test.use({ favorites: 'base' });
test.describe.configure({ mode: 'serial' });

const SAME_ORIGIN = { 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' };

interface SavedFavorite {
    readonly id: string;
    readonly ticket: string;
    readonly name: string | null;
}

/**
 * Le jour d'un parcours : le `index`-ième jour de semaine à partir du 1er juillet 2024,
 * des mois que les autres parcours ne prennent pas : ils tournent en même temps, sur la
 * même base. Un samedi serait fermé à la saisie.
 */
function day(index: number): string {
    return weekday('2024-07-01', index);
}

async function savedFavorites(request: APIRequestContext): Promise<SavedFavorite[]> {
    const response = await request.get('/api/favorites');

    return ((await response.json()) as { favorites: SavedFavorite[] }).favorites;
}

/** Les favoris de ces parcours, de haut en bas, tels que la base les tient. */
async function ours(request: APIRequestContext): Promise<string[]> {
    return (await savedFavorites(request))
        .filter((favorite) => favorite.ticket.startsWith('ESSAI-'))
        .map((favorite) => (favorite.name === null ? favorite.ticket : `${favorite.ticket} « ${favorite.name} »`));
}

/** Ajoute ces favoris par l'API, le premier nommé en tête de liste. */
async function addFavorites(request: APIRequestContext, ...tickets: string[]): Promise<void> {
    for (const ticket of [...tickets].reverse()) {
        const response = await request.post('/api/favorites', { headers: SAME_ORIGIN, data: { ticket } });
        expect(response.status(), ticket).toBe(201);
    }
}

async function removeOurs(request: APIRequestContext): Promise<void> {
    for (const favorite of await savedFavorites(request)) {
        if (favorite.ticket.startsWith('ESSAI-')) {
            await request.delete(`/api/favorites/${favorite.id}`, { headers: SAME_ORIGIN });
        }
    }
}

function column(page: Page): Locator {
    return page.getByRole('complementary', { name: 'Favoris et calendrier' });
}

/** Le + de l'en-tête ; une liste vide a aussi son bouton, plus bas. */
function addButton(page: Page): Locator {
    return column(page).getByRole('button', { name: 'Ajouter un favori' }).first();
}

function card(page: Page, ticket: string): Locator {
    return column(page).getByRole('list', { name: 'Favoris' }).locator('[data-favorite]').filter({ hasText: ticket });
}

/**
 * Les cartes de ces parcours, de haut en bas, telles que l'écran les montre : la place
 * laissée pendant un glisser comprise.
 */
async function shownOurs(page: Page): Promise<string[]> {
    const texts = await column(page).getByRole('list', { name: 'Favoris' }).locator(':scope > li').allTextContents();

    return texts.filter((text) => text.startsWith('ESSAI-'));
}

function form(page: Page, name = 'Nouveau favori'): Locator {
    return column(page).getByRole('group', { name });
}

async function center(target: Locator): Promise<{ x: number; y: number }> {
    const box = await target.boundingBox();
    if (box === null) {
        throw new Error('L’élément visé n’est pas à l’écran.');
    }

    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Ce qu'une carte montre : son cadre, sa poignée, sa pastille et son nom. */
function cardBody(page: Page, ticket: string): Locator {
    return card(page, ticket).locator(':scope > span');
}

/** La valeur qu'une couleur de tokens.css prend dans la page. */
async function tokenColor(page: Page, token: `--${string}`): Promise<string> {
    return page.evaluate((name) => {
        const probe = document.createElement('div');
        probe.style.backgroundColor = `var(${name})`;
        document.body.append(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();

        return color;
    }, token);
}

function selectedSlots(page: Page): Locator {
    return page.getByRole('listbox', { name: 'Créneaux de la journée' }).getByRole('option', { selected: true });
}

/** Un point de la colonne des heures, à la hauteur de ce créneau : à gauche de la colonne des blocs. */
async function hoursPoint(page: Page, time: string): Promise<{ x: number; y: number }> {
    const lane = await page.getByRole('listbox', { name: 'Créneaux de la journée' }).boundingBox();
    if (lane === null) {
        throw new Error('La grille n’est pas à l’écran.');
    }

    return { x: lane.x - 16, y: (await slotPoint(page, time)).y };
}

/** Appuie sur une carte et l'amène là, sans la lâcher. */
async function lift(page: Page, from: Locator, to: { x: number; y: number }): Promise<void> {
    const start = await center(from);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
}

/**
 * Ouvre la journée à 10:00. Ce qu'un parcours interrompu y aurait laissé s'en va
 * d'abord, sauf si le parcours vient de l'y poser.
 */
async function open(page: Page, date: string, entries: readonly Entry[] = []): Promise<void> {
    await writeDay(page.request, date, entries);
    await startTimeAt(page, date, '10:00');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${date}`);
    await expect(page.getByRole('group', { name: 'Chiffres du jour' })).toBeVisible();
}

test.beforeEach(async ({ request }) => {
    await removeOurs(request);
});

test.afterEach(async ({ request }) => {
    await removeOurs(request);
});

test.describe('ajouter', () => {
    test('un favori s’ajoute par son identifiant, en tête de liste, une seule fois', async ({ page, request }) => {
        await addFavorites(request, 'ESSAI-1');
        await open(page, day(0));

        await addButton(page).click();
        const field = form(page).getByLabel('Nouveau favori');
        await expect(field).toBeFocused();
        await field.pressSequentially(' essai-2');
        await expect(field).toHaveValue('ESSAI-2');
        // Une Entrée répétée pendant que l'ajout part n'ajoute qu'une fois.
        await page.route('**/api/favorites', async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 300));
            await route.fallback();
        });
        await field.press('Enter');
        await page.keyboard.press('Enter');

        await expect(form(page)).toHaveCount(0);
        await expect.poll(() => shownOurs(page)).toEqual(['ESSAI-2', 'ESSAI-1']);
        expect(await ours(request)).toEqual(['ESSAI-2', 'ESSAI-1']);
        await expect(addButton(page)).toBeFocused();
        await expect(message(page)).toHaveCount(0);
    });

    test.describe(() => {
        test.use({ expectedErrors: [refusedWith(422)] });

        test('un ticket déjà en favori se refuse sous le champ, sans rien perdre de la saisie', async ({
            page,
            request,
        }) => {
            await addFavorites(request, 'ESSAI-1');
            await open(page, day(1));

            await addButton(page).click();
            const field = form(page).getByLabel('Nouveau favori');
            await field.fill('ESSAI-1');
            await form(page).getByRole('button', { name: 'Ajouter' }).click();

            await expect(form(page).getByText('ESSAI-1 est déjà dans vos favoris.')).toBeVisible();
            await expect(field).toHaveAttribute('aria-invalid', 'true');
            await expect(field).toHaveValue('ESSAI-1');
            // Le curseur est revenu au champ, et taper efface le refus.
            await expect(field).toBeFocused();
            await page.keyboard.press('Backspace');
            await expect(field).not.toHaveAttribute('aria-invalid');
            expect(await ours(request)).toEqual(['ESSAI-1']);
        });
    });

    test.describe(() => {
        test.use({ expectedErrors: [/ERR_FAILED/] });

        test('un ajout ou un renommage que le serveur ne reçoit pas garde ce qui a été tapé', async ({
            page,
            request,
        }) => {
            await addFavorites(request, 'ESSAI-1');
            await open(page, day(25));
            await page.route('**/api/favorites**', (route) =>
                route.request().method() === 'GET' ? route.fallback() : route.abort('failed'),
            );

            await addButton(page).click();
            await form(page).getByLabel('Nouveau favori').fill('ESSAI-2');
            await page.keyboard.press('Enter');
            await expect(form(page).getByText("L'enregistrement n'a pas abouti. Réessayez.")).toBeVisible();
            await expect(form(page).getByLabel('Nouveau favori')).toHaveValue('ESSAI-2');
            await page.keyboard.press('Escape');

            await card(page, 'ESSAI-1').dblclick();
            const rename = form(page, 'Renommer le favori ESSAI-1');
            await rename.getByLabel('Nom').fill('Point du matin');
            await page.keyboard.press('Enter');
            await expect(rename.getByText("L'enregistrement n'a pas abouti. Réessayez.")).toBeVisible();
            await expect(rename.getByLabel('Nom')).toHaveValue('Point du matin');

            expect(await ours(request)).toEqual(['ESSAI-1']);
        });
    });

    test('une forme refusée se dit en quittant le champ, et Échap ferme sans rien ajouter', async ({
        page,
        request,
    }) => {
        await open(page, day(2));
        const add = addButton(page);

        await add.click();
        const field = form(page).getByLabel('Nouveau favori');
        await field.fill('ESSAI');
        await field.press('Tab');
        await expect(form(page).getByText("Un identifiant de ticket s'écrit comme SHOP-482.")).toBeVisible();

        // Le curseur est passé sur « Annuler » : Échap ferme quand même.
        await expect(form(page).getByRole('button', { name: 'Annuler' })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(form(page)).toHaveCount(0);
        await expect(add).toBeFocused();
        expect(await ours(request)).toEqual([]);
    });

    test('un clic à côté enregistre ce qui a été tapé, et ferme un formulaire vide', async ({ page, request }) => {
        await open(page, day(3));
        const add = addButton(page);

        await add.click();
        await page.getByRole('heading', { level: 1 }).click();
        await expect(form(page)).toHaveCount(0);
        // Le + referme aussi un formulaire vide.
        await add.click();
        await expect(form(page)).toHaveCount(1);
        await add.click();
        await expect(form(page)).toHaveCount(0);

        await add.click();
        await form(page).getByLabel('Nouveau favori').fill('ESSAI-3');
        await page.getByRole('heading', { level: 1 }).click();
        await expect(form(page)).toHaveCount(0);
        await expect.poll(() => ours(request)).toEqual(['ESSAI-3']);
    });
});

test.describe('renommer', () => {
    test('un double-clic renomme, et un nom vidé rend le titre', async ({ page, request }) => {
        await addFavorites(request, 'ESSAI-1');
        await open(page, day(4));

        await card(page, 'ESSAI-1').dblclick();
        const field = form(page, 'Renommer le favori ESSAI-1').getByLabel('Nom');
        await expect(field).toBeFocused();
        await field.fill('  Point  du matin ');
        await field.press('Enter');

        await expect(card(page, 'ESSAI-1')).toContainText('Point du matin');
        await expect(card(page, 'ESSAI-1')).toBeFocused();
        expect(await ours(request)).toEqual(['ESSAI-1 « Point du matin »']);

        // F2, comme dans un tableur : le nom s'ouvre sélectionné.
        await page.keyboard.press('F2');
        await expect(field).toHaveValue('Point du matin');
        await field.press('Delete');
        await field.press('Enter');
        await expect(card(page, 'ESSAI-1')).toHaveText('ESSAI-1');
        expect(await ours(request)).toEqual(['ESSAI-1']);
    });
});

test.describe('poser sur la grille', () => {
    test('un clic copie le favori, et Ctrl+V le colle sur la sélection', async ({ page, request }) => {
        const date = day(5);
        await addFavorites(request, 'ESSAI-1');
        await open(page, date);

        await clickSlot(page, '10:00');
        await clickSlot(page, '10:30', ['Shift']);
        await card(page, 'ESSAI-1').click();
        await expect(message(page)).toContainText('ESSAI-1 copié');

        // Le curseur est resté sur la carte : Ctrl+V colle sur la sélection, et passe à la grille.
        await page.keyboard.press('ControlOrMeta+V');
        await expect(page.getByRole('listbox', { name: 'Créneaux de la journée' })).toBeFocused();

        await expect
            .poll(() => savedDay(request, date))
            .toEqual([{ start: '10:00', end: '10:45', kind: 'work', ticket: 'ESSAI-1', comment: null }]);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('glisser un favori sur un créneau vide le pose sur ce quart d’heure, et Ctrl+Z l’enlève', async ({
        page,
        request,
    }) => {
        const date = day(6);
        await addFavorites(request, 'ESSAI-1');
        await open(page, date);

        // Un créneau loin des bords : près d'eux, la grille défile sous le pointeur.
        await lift(page, card(page, 'ESSAI-1'), await slotPoint(page, '12:00'));
        // La zone de dépôt dit ses heures, le favori reste à sa place en pointillé.
        await expect(page.getByText('12:00 à 12:15', { exact: true })).toBeVisible();
        await expect(page.locator('.favorite-drag')).toBeVisible();
        await page.mouse.up();

        await expect(page.getByText('12:00 à 12:15', { exact: true })).toHaveCount(0);
        await expect(page.locator('.favorite-drag')).toHaveCount(0);
        await expect
            .poll(() => savedDay(request, date))
            .toEqual([{ start: '12:00', end: '12:15', kind: 'work', ticket: 'ESSAI-1', comment: null }]);
        // Rien n'a disparu : pas de message, l'ajout se voit dans la grille.
        await expect(message(page)).toHaveCount(0);
        await expectGridMatchesBase(page, request, date);

        await page.keyboard.press('ControlOrMeta+Z');
        await expect.poll(() => savedDay(request, date)).toEqual([]);
        await clearDay(request, date);
    });

    test('glisser un favori sur un bloc ne change que le quart d’heure visé', async ({ page, request }) => {
        const date = day(7);
        await addFavorites(request, 'ESSAI-1');
        await open(page, date, [{ start: '10:00', end: '11:00', ticket: 'SHOP-482', comment: 'Mapping' }]);

        await lift(page, card(page, 'ESSAI-1'), await slotPoint(page, '10:15'));
        await expect(page.getByText('10:15 à 10:30', { exact: true })).toBeVisible();
        await page.mouse.up();

        await expect
            .poll(() => savedDay(request, date))
            .toEqual([
                { start: '10:00', end: '10:15', kind: 'work', ticket: 'SHOP-482', comment: 'Mapping' },
                { start: '10:15', end: '10:30', kind: 'work', ticket: 'ESSAI-1', comment: null },
                { start: '10:30', end: '11:00', kind: 'work', ticket: 'SHOP-482', comment: 'Mapping' },
            ]);
        await expect(message(page)).toContainText('SHOP-482 remplacé de 10:15 à 10:30');
        await message(page).getByRole('button', { name: 'Annuler' }).click();
        await expect
            .poll(() => savedDay(request, date))
            .toEqual([{ start: '10:00', end: '11:00', kind: 'work', ticket: 'SHOP-482', comment: 'Mapping' }]);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('un favori lâché hors de la grille et de la liste, ou après Échap, ne fait rien', async ({
        page,
        request,
    }) => {
        const date = day(8);
        await addFavorites(request, 'ESSAI-1');
        await open(page, date);

        await lift(page, card(page, 'ESSAI-1'), await center(page.getByRole('heading', { level: 1 })));
        await page.mouse.up();
        await lift(page, card(page, 'ESSAI-1'), await slotPoint(page, '11:00'));
        await page.keyboard.press('Escape');
        await expect(page.locator('.favorite-drag')).toHaveCount(0);
        await page.mouse.up();

        // Un dépôt parti par erreur aurait mis la grille en attente : on attend qu'elle n'attende plus.
        await expect(page.getByRole('listbox', { name: 'Créneaux de la journée' })).toHaveAttribute(
            'aria-busy',
            'false',
        );
        expect(await savedDay(request, date)).toEqual([]);
        await expect(message(page)).toHaveCount(0);
    });

    test('sous 1280 px, un favori lâché sur le récapitulatif ouvert ne tombe pas sous lui', async ({
        page,
        request,
    }) => {
        const date = day(20);
        await addFavorites(request, 'ESSAI-1');
        await page.addInitScript(() => {
            localStorage.setItem('daytrack.recap-open', 'true');
        });
        await open(page, date);
        await page.setViewportSize({ width: 1024, height: 720 });
        const recap = page.getByRole('complementary', { name: 'Récapitulatif' });
        await expect(recap).toBeVisible();

        const box = await recap.boundingBox();
        const row = await slotPoint(page, '11:00');
        await lift(page, card(page, 'ESSAI-1'), { x: (box?.x ?? 0) + 40, y: row.y });
        await expect(page.getByText('11:00 à 11:15', { exact: true })).toHaveCount(0);
        await page.mouse.up();

        await expect(page.getByRole('listbox', { name: 'Créneaux de la journée' })).toHaveAttribute(
            'aria-busy',
            'false',
        );
        expect(await savedDay(request, date)).toEqual([]);
    });

    test('déposé pendant qu’une fenêtre de ticket est ouverte, il l’enregistre d’abord', async ({ page, request }) => {
        const date = day(21);
        await addFavorites(request, 'ESSAI-1');
        await open(page, date);

        await doubleClickSlot(page, '09:00');
        await page.getByRole('dialog', { name: 'Nouveau ticket' }).getByLabel('Ticket').fill('OPS-12');
        await lift(page, card(page, 'ESSAI-1'), await slotPoint(page, '11:00'));
        await page.mouse.up();

        await expect
            .poll(() => savedDay(request, date))
            .toEqual([
                { start: '09:00', end: '09:15', kind: 'work', ticket: 'OPS-12', comment: null },
                { start: '11:00', end: '11:15', kind: 'work', ticket: 'ESSAI-1', comment: null },
            ]);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await clearDay(request, date);
    });

    test.describe(() => {
        test.use({ expectedErrors: [refusedWith(422)] });

        test('une fenêtre de ticket refusée reste ouverte, et le favori n’est pas posé', async ({ page, request }) => {
            const date = day(22);
            await addFavorites(request, 'ESSAI-1');
            await open(page, date);

            await doubleClickSlot(page, '09:00');
            const window = page.getByRole('dialog', { name: 'Nouveau ticket' });
            await window.getByLabel('Commentaire').fill('Sans ticket');
            await lift(page, card(page, 'ESSAI-1'), await slotPoint(page, '11:00'));
            await page.mouse.up();

            await expect(window.getByText('Indiquez un ticket.')).toBeVisible();
            await expect(page.getByRole('listbox', { name: 'Créneaux de la journée' })).toHaveAttribute(
                'aria-busy',
                'false',
            );
            expect(await savedDay(request, date)).toEqual([]);
        });
    });
});

test.describe('ranger', () => {
    test('glisser un favori dans la liste change l’ordre', async ({ page, request }) => {
        await addFavorites(request, 'ESSAI-1', 'ESSAI-2', 'ESSAI-3');
        await open(page, day(9));

        const below = await card(page, 'ESSAI-3').boundingBox();
        if (below === null) {
            throw new Error('ESSAI-3 n’est pas à l’écran.');
        }
        await lift(page, card(page, 'ESSAI-1'), { x: below.x + below.width / 2, y: below.y + below.height - 4 });
        // La place laissée en pointillé suit le pointeur : c'est là qu'il tombera.
        await expect.poll(() => shownOurs(page)).toEqual(['ESSAI-2', 'ESSAI-3', 'ESSAI-1']);
        await page.mouse.up();

        await expect.poll(() => ours(request)).toEqual(['ESSAI-2', 'ESSAI-3', 'ESSAI-1']);
        await expect.poll(() => shownOurs(page)).toEqual(['ESSAI-2', 'ESSAI-3', 'ESSAI-1']);
    });

    test('au clavier, Alt+flèche déplace le favori et le curseur le suit', async ({ page, request }) => {
        await addFavorites(request, 'ESSAI-1', 'ESSAI-2', 'ESSAI-3');
        await open(page, day(10));

        await card(page, 'ESSAI-1').focus();
        await page.keyboard.press('Alt+ArrowDown');
        await expect.poll(() => ours(request)).toEqual(['ESSAI-2', 'ESSAI-1', 'ESSAI-3']);
        await expect(card(page, 'ESSAI-1')).toBeFocused();

        await page.keyboard.press('Alt+ArrowDown');
        await expect.poll(() => ours(request)).toEqual(['ESSAI-2', 'ESSAI-3', 'ESSAI-1']);
        await page.keyboard.press('Alt+ArrowUp');
        await expect.poll(() => ours(request)).toEqual(['ESSAI-2', 'ESSAI-1', 'ESSAI-3']);
        await expect(card(page, 'ESSAI-1')).toBeFocused();
    });

    test('le menu du clic droit renomme, déplace et retire, et Annuler remet le favori à sa place', async ({
        page,
        request,
    }) => {
        await addFavorites(request, 'ESSAI-1', 'ESSAI-2', 'ESSAI-3');
        await open(page, day(11));
        const menu = page.getByRole('menu', { name: 'Actions sur le favori ESSAI-2' });

        await card(page, 'ESSAI-2').click({ button: 'right' });
        await expect(menu.getByRole('menuitem', { name: 'Monter' })).toBeEnabled();
        await menu.getByRole('menuitem', { name: 'Monter' }).click();
        await expect.poll(() => ours(request)).toEqual(['ESSAI-2', 'ESSAI-1', 'ESSAI-3']);

        // En tête de liste, Monter est grisé.
        await card(page, 'ESSAI-2').click({ button: 'right' });
        await expect(menu.getByRole('menuitem', { name: 'Monter' })).toBeDisabled();
        await menu.getByRole('menuitem', { name: 'Retirer des favoris' }).click();

        await expect.poll(() => ours(request)).toEqual(['ESSAI-1', 'ESSAI-3']);
        await expect(message(page)).toContainText('ESSAI-2 retiré des favoris');
        await message(page).getByRole('button', { name: 'Annuler' }).click();
        await expect.poll(() => ours(request)).toEqual(['ESSAI-2', 'ESSAI-1', 'ESSAI-3']);
        // Le curseur va au favori remis, pas à la grille.
        await expect(card(page, 'ESSAI-2')).toBeFocused();
    });

    test('Ctrl+Z, le message du retrait affiché, remet le favori sans toucher la grille', async ({ page, request }) => {
        const date = day(23);
        await addFavorites(request, 'ESSAI-1', 'ESSAI-2');
        await open(page, date, [{ start: '15:00', end: '15:15', ticket: 'OPS-12' }]);

        await card(page, 'ESSAI-1').focus();
        await page.keyboard.press('Delete');
        await expect(message(page)).toContainText('ESSAI-1 retiré des favoris');
        await page.keyboard.press('ControlOrMeta+Z');

        await expect.poll(() => ours(request)).toEqual(['ESSAI-1', 'ESSAI-2']);
        await expect(message(page)).toHaveCount(0);
        expect(await savedDay(request, date)).toEqual([
            { start: '15:00', end: '15:15', kind: 'work', ticket: 'OPS-12', comment: null },
        ]);
        await expect(card(page, 'ESSAI-1')).toBeFocused();
        await clearDay(request, date);
    });

    test('Suppr tenu ne retire qu’un favori, et la croix du message rend le curseur à la liste', async ({
        page,
        request,
    }) => {
        await addFavorites(request, 'ESSAI-1', 'ESSAI-2', 'ESSAI-3');
        await open(page, day(24));

        await card(page, 'ESSAI-1').focus();
        // Une touche tenue : le premier appui, puis ses répétitions.
        await page.keyboard.down('Delete');
        await expect.poll(() => ours(request)).toEqual(['ESSAI-2', 'ESSAI-3']);
        await page.keyboard.down('Delete');
        await page.keyboard.down('Delete');
        await page.keyboard.up('Delete');
        await expect(card(page, 'ESSAI-2')).toBeFocused();
        expect(await ours(request)).toEqual(['ESSAI-2', 'ESSAI-3']);

        await message(page).getByRole('button', { name: 'Fermer le message' }).focus();
        await page.keyboard.press('Enter');
        await expect(message(page)).toHaveCount(0);
        await expect(addButton(page)).toBeFocused();
    });

    test('menu ouvert, le raccourci écrit fait son choix : Alt+↓, F2, Suppr et Retour arrière', async ({
        page,
        request,
    }) => {
        await addFavorites(request, 'ESSAI-1', 'ESSAI-2', 'ESSAI-3');
        await open(page, day(26));
        const menu = page.getByRole('menu');

        await card(page, 'ESSAI-1').click({ button: 'right' });
        await page.keyboard.press('Alt+ArrowDown');
        await expect(menu).toHaveCount(0);
        await expect.poll(() => ours(request)).toEqual(['ESSAI-2', 'ESSAI-1', 'ESSAI-3']);

        await card(page, 'ESSAI-1').click({ button: 'right' });
        await page.keyboard.press('F2');
        await expect(menu).toHaveCount(0);
        await expect(form(page, 'Renommer le favori ESSAI-1')).toBeVisible();
        await page.keyboard.press('Escape');

        await card(page, 'ESSAI-3').click({ button: 'right' });
        await page.keyboard.press('Delete');
        await expect(menu).toHaveCount(0);
        await expect.poll(() => ours(request)).toEqual(['ESSAI-2', 'ESSAI-1']);
        await expect(message(page)).toContainText('ESSAI-3 retiré des favoris');

        await card(page, 'ESSAI-2').click({ button: 'right' });
        await page.keyboard.press('Backspace');
        await expect.poll(() => ours(request)).toEqual(['ESSAI-1']);
    });

    test('sur Mac, le menu écrit ⌥↑, ⌥↓ et ⌫, et ⌫ retire le favori', async ({ page, request }) => {
        await addFavorites(request, 'ESSAI-1', 'ESSAI-2');
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
        });
        await open(page, day(27));

        await card(page, 'ESSAI-2').click({ button: 'right' });
        const menu = page.getByRole('menu', { name: 'Actions sur le favori ESSAI-2' });
        await expect(menu.getByRole('menuitem').locator('kbd')).toHaveText(['F2', '⌥↑', '⌥↓', '⌫']);
        await page.keyboard.press('Escape');
        // Le menu rend le curseur à sa carte en se fermant : on attend qu'il l'ait fait.
        await expect(menu).toHaveCount(0);
        await expect(card(page, 'ESSAI-2')).toBeFocused();

        await card(page, 'ESSAI-1').focus();
        await page.keyboard.press('Backspace');
        await expect.poll(() => ours(request)).toEqual(['ESSAI-2']);
    });

    test('au clavier, le menu s’ouvre par Maj+F10, et Suppr retire le favori', async ({ page, request }) => {
        await addFavorites(request, 'ESSAI-1', 'ESSAI-2');
        await open(page, day(12));

        await card(page, 'ESSAI-1').focus();
        await page.keyboard.press('Shift+F10');
        const menu = page.getByRole('menu', { name: 'Actions sur le favori ESSAI-1' });
        await expect(menu.getByRole('menuitem', { name: 'Renommer…' })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(card(page, 'ESSAI-1')).toBeFocused();

        await page.keyboard.press('Delete');
        await expect.poll(() => ours(request)).toEqual(['ESSAI-2']);
        // Le curseur va au favori qui prend sa place.
        await expect(card(page, 'ESSAI-2')).toBeFocused();
        await expect(message(page)).toContainText('ESSAI-1 retiré des favoris');
    });
});

test.describe('le survol et le curseur', () => {
    test('le survol ne vaut que pour le favori survolé, et celui qui a le curseur se voit, sans ombre', async ({
        page,
        request,
    }) => {
        await addFavorites(request, 'ESSAI-1', 'ESSAI-2');
        await open(page, day(28));
        const raised = await tokenColor(page, '--bg-raise');
        const pressed = await tokenColor(page, '--bg-press');
        const shadow = (ticket: string) => cardBody(page, ticket).evaluate((node) => getComputedStyle(node).boxShadow);
        const background = (ticket: string) =>
            cardBody(page, ticket).evaluate((node) => getComputedStyle(node).backgroundColor);

        // La souris sur la grille, aucune carte n'est survolée.
        const grid = await slotPoint(page, '14:00');
        await page.mouse.move(grid.x, grid.y);
        await expect.poll(() => shadow('ESSAI-1')).toBe('none');
        await expect.poll(() => shadow('ESSAI-2')).toBe('none');

        // Sur ESSAI-1, elle seule prend l'ombre.
        await card(page, 'ESSAI-1').hover();
        await expect.poll(() => shadow('ESSAI-1')).not.toBe('none');
        expect(await shadow('ESSAI-2')).toBe('none');

        // Un clic pose le curseur sur ESSAI-2 : il en prend le fond, sans ombre ni anneau.
        await card(page, 'ESSAI-2').click();
        await expect(card(page, 'ESSAI-2')).toBeFocused();
        await page.mouse.move(grid.x, grid.y);
        await expect.poll(() => background('ESSAI-2')).toBe(pressed);
        await expect.poll(() => shadow('ESSAI-2')).toBe('none');
        expect(await card(page, 'ESSAI-2').evaluate((node) => getComputedStyle(node).outlineStyle)).toBe('none');
        expect(await background('ESSAI-1')).toBe(raised);

        // Le curseur parti sur la grille, la carte redevient ordinaire.
        await clickSlot(page, '14:00');
        await expect.poll(() => background('ESSAI-2')).toBe(raised);

        // Comme Safari et Firefox sur Mac, un navigateur qui ne donne pas le curseur au
        // bouton cliqué : la carte le prend quand même, toujours sans anneau.
        await page.evaluate(() => {
            document.addEventListener(
                'mousedown',
                (event) => {
                    if (event.target instanceof Element && event.target.closest('[data-favorite]') !== null) {
                        event.preventDefault();
                    }
                },
                true,
            );
        });
        await card(page, 'ESSAI-1').click();
        await expect(card(page, 'ESSAI-1')).toBeFocused();
        await page.mouse.move(grid.x, grid.y);
        await expect.poll(() => background('ESSAI-1')).toBe(pressed);
        expect(await card(page, 'ESSAI-1').evaluate((node) => getComputedStyle(node).outlineStyle)).toBe('none');
    });
});

test.describe('depuis la grille', () => {
    test('glisser un bloc sur la liste en fait un favori, là où on le lâche', async ({ page, request }) => {
        const date = day(13);
        await addFavorites(request, 'ESSAI-1', 'ESSAI-2');
        await open(page, date, [{ start: '09:00', end: '10:00', ticket: 'ESSAI-5', comment: 'Revue' }]);

        const target = await card(page, 'ESSAI-2').boundingBox();
        if (target === null) {
            throw new Error('ESSAI-2 n’est pas à l’écran.');
        }
        const from = await slotPoint(page, '09:15');
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(target.x + target.width / 2, target.y + 4, { steps: 10 });
        await expect.poll(() => shownOurs(page)).toEqual(['ESSAI-1', 'ESSAI-5', 'ESSAI-2']);
        await page.mouse.up();

        await expect.poll(() => ours(request)).toEqual(['ESSAI-1', 'ESSAI-5', 'ESSAI-2']);
        // Le bloc n'a pas bougé, aucune fenêtre ne s'est ouverte, et la grille ne garde en
        // sélection que le quart d'heure d'où il est parti.
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(
            page.getByRole('listbox', { name: 'Créneaux de la journée' }).getByRole('option', { selected: true }),
        ).toHaveText(['09:15, ESSAI-5, Revue']);
        expect(await savedDay(request, date)).toEqual([
            { start: '09:00', end: '10:00', kind: 'work', ticket: 'ESSAI-5', comment: 'Revue' },
        ]);
        await clearDay(request, date);
    });

    test('un bloc se soulève dès qu’il quitte la colonne des blocs, et y revenir reprend la sélection', async ({
        page,
        request,
    }) => {
        const date = day(29);
        await addFavorites(request, 'ESSAI-1');
        await open(page, date, [{ start: '09:00', end: '10:00', ticket: 'ESSAI-5', comment: 'Revue' }]);
        const lifted = page.locator('.favorite-drag');

        const from = await slotPoint(page, '09:15');
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        // Dans la grille, le glisser sélectionne, comme sur tout bloc.
        const below = await slotPoint(page, '09:45');
        await page.mouse.move(below.x, below.y, { steps: 4 });
        await expect(selectedSlots(page)).toHaveCount(3);
        await expect(lifted).toHaveCount(0);

        // Sur la colonne des heures, il se soulève : la sélection revient à 09:15, la
        // carte de son ticket suit le pointeur, et la liste ne montre encore aucune place.
        const hours = await hoursPoint(page, '09:45');
        await page.mouse.move(hours.x, hours.y, { steps: 4 });
        await expect(lifted).toHaveText('ESSAI-5');
        await expect(selectedSlots(page)).toHaveText(['09:15, ESSAI-5, Revue']);
        await expect.poll(() => shownOurs(page)).toEqual(['ESSAI-1']);

        // Revenu sur la grille, il redevient une sélection.
        const back = await slotPoint(page, '10:15');
        await page.mouse.move(back.x, back.y, { steps: 4 });
        await expect(lifted).toHaveCount(0);
        await expect(selectedSlots(page)).toHaveCount(5);

        // Lâché sur la colonne des heures, il ne fait rien.
        await page.mouse.move(hours.x, hours.y, { steps: 4 });
        await expect(lifted).toBeVisible();
        await page.mouse.up();
        await expect(lifted).toHaveCount(0);
        await expect(selectedSlots(page)).toHaveText(['09:15, ESSAI-5, Revue']);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect(await ours(request)).toEqual(['ESSAI-1']);
        expect(await savedDay(request, date)).toEqual([
            { start: '09:00', end: '10:00', kind: 'work', ticket: 'ESSAI-5', comment: 'Revue' },
        ]);
        await clearDay(request, date);
    });

    test('Échap lâche un bloc soulevé sans rien poser, même relâché sur la liste', async ({ page, request }) => {
        const date = day(33);
        await addFavorites(request, 'ESSAI-1');
        await open(page, date, [{ start: '09:00', end: '10:00', ticket: 'ESSAI-5' }]);
        const lifted = page.locator('.favorite-drag');

        const from = await slotPoint(page, '09:15');
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x, (await slotPoint(page, '09:45')).y, { steps: 4 });
        const target = await center(card(page, 'ESSAI-1'));
        await page.mouse.move(target.x, target.y + 8, { steps: 10 });
        await expect(lifted).toHaveText('ESSAI-5');
        await expect.poll(() => shownOurs(page)).toEqual(['ESSAI-1', 'ESSAI-5']);

        await page.keyboard.press('Escape');
        await expect(lifted).toHaveCount(0);
        await expect.poll(() => shownOurs(page)).toEqual(['ESSAI-1']);
        await expect(selectedSlots(page)).toHaveText(['09:15, ESSAI-5']);
        await page.mouse.up();

        await expect(message(page)).toHaveCount(0);
        expect(await ours(request)).toEqual(['ESSAI-1']);
        await expect(selectedSlots(page)).toHaveText(['09:15, ESSAI-5']);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await clearDay(request, date);
    });

    test('un bloc ajouté le dit, et Annuler comme Ctrl+Z le retirent sans toucher la grille', async ({
        page,
        request,
    }) => {
        const date = day(30);
        await addFavorites(request, 'ESSAI-1');
        await open(page, date, [{ start: '09:00', end: '10:00', ticket: 'ESSAI-5' }]);
        const dropOnList = async () => {
            const from = await slotPoint(page, '09:15');
            const to = await center(card(page, 'ESSAI-1'));
            await page.mouse.move(from.x, from.y);
            await page.mouse.down();
            await page.mouse.move(to.x, to.y + 8, { steps: 10 });
            await page.mouse.up();
        };

        await dropOnList();
        await expect(message(page)).toContainText('ESSAI-5 ajouté aux favoris');
        await expect.poll(() => ours(request)).toEqual(['ESSAI-1', 'ESSAI-5']);
        await message(page).getByRole('button', { name: 'Annuler' }).click();
        await expect.poll(() => ours(request)).toEqual(['ESSAI-1']);

        await dropOnList();
        await expect(message(page)).toContainText('ESSAI-5 ajouté aux favoris');
        await page.keyboard.press('ControlOrMeta+Z');
        await expect.poll(() => ours(request)).toEqual(['ESSAI-1']);
        await expect(message(page)).toHaveCount(0);
        expect(await savedDay(request, date)).toEqual([
            { start: '09:00', end: '10:00', kind: 'work', ticket: 'ESSAI-5', comment: null },
        ]);
        await clearDay(request, date);
    });

    test('le menu de la grille ajoute en tête de liste le ticket de la sélection, s’il n’y en a qu’un', async ({
        page,
        request,
    }) => {
        const date = day(31);
        await addFavorites(request, 'ESSAI-1');
        await open(page, date, [
            { start: '09:00', end: '10:00', ticket: 'ESSAI-5' },
            { start: '10:00', end: '10:30', ticket: 'ESSAI-6' },
            { start: '10:30', end: '11:00', ticket: 'ESSAI-5' },
        ]);
        const menu = page.getByRole('menu', { name: 'Actions sur la sélection' });
        const add = menu.getByRole('menuitem', { name: 'Ajouter aux favoris' });

        // Deux tickets dans la sélection : grisé.
        await clickSlot(page, '09:45');
        await clickSlot(page, '10:15', ['Shift']);
        await page.keyboard.press('Shift+F10');
        await expect(add).toHaveAttribute('aria-disabled', 'true');
        await page.keyboard.press('Escape');

        // Un seul, en deux blocs, et le vide autour : il s'ajoute en tête, au clavier.
        await clickSlot(page, '10:30');
        await clickSlot(page, '11:15', ['Shift']);
        await page.keyboard.press('Shift+F10');
        await expect(add).not.toHaveAttribute('aria-disabled', 'true');
        await add.focus();
        await page.keyboard.press('Enter');
        await expect(message(page)).toContainText('ESSAI-5 ajouté aux favoris');
        await expect.poll(() => ours(request)).toEqual(['ESSAI-5', 'ESSAI-1']);
        await expect(page.getByRole('listbox', { name: 'Créneaux de la journée' })).toBeFocused();
        expect(await savedDay(request, date)).toHaveLength(3);
        await clearDay(request, date);
    });

    test('un ticket déjà en favori grise « Ajouter aux favoris »', async ({ page, request }) => {
        const date = day(32);
        await addFavorites(request, 'ESSAI-5');
        await open(page, date, [{ start: '09:00', end: '10:00', ticket: 'ESSAI-5' }]);

        await clickSlot(page, '09:15');
        await page.keyboard.press('Shift+F10');
        const add = page.getByRole('menuitem', { name: 'Ajouter aux favoris' });
        await expect(add).toHaveAttribute('aria-disabled', 'true');
        await page.keyboard.press('Escape');
        expect(await ours(request)).toEqual(['ESSAI-5']);
        await clearDay(request, date);
    });

    test('un bloc dont le ticket est déjà en favori y déplace ce favori, sans message', async ({ page, request }) => {
        const date = day(14);
        await addFavorites(request, 'ESSAI-5', 'ESSAI-1', 'ESSAI-2');
        await open(page, date, [{ start: '09:00', end: '10:00', ticket: 'ESSAI-5' }]);
        const lifted = page.locator('.favorite-drag');

        const from = await slotPoint(page, '09:15');
        const target = await card(page, 'ESSAI-2').boundingBox();
        if (target === null) {
            throw new Error('ESSAI-2 n’est pas à l’écran.');
        }
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(target.x + target.width / 2, target.y + target.height - 4, { steps: 10 });
        // C'est le favori ESSAI-5 qui suit le pointeur, en pointillé à la place visée.
        await expect(lifted).toContainText('ESSAI-5');
        await expect.poll(() => shownOurs(page)).toEqual(['ESSAI-1', 'ESSAI-2', 'ESSAI-5']);
        await page.mouse.up();

        await expect.poll(() => ours(request)).toEqual(['ESSAI-1', 'ESSAI-2', 'ESSAI-5']);
        await expect(message(page)).toHaveCount(0);

        // Échap, au-dessus de la liste, le lâche sans rien déplacer.
        const first = await card(page, 'ESSAI-1').boundingBox();
        if (first === null) {
            throw new Error('ESSAI-1 n’est pas à l’écran.');
        }
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(first.x + first.width / 2, first.y + 4, { steps: 10 });
        await expect.poll(() => shownOurs(page)).toEqual(['ESSAI-5', 'ESSAI-1', 'ESSAI-2']);
        await page.keyboard.press('Escape');
        await expect(lifted).toHaveCount(0);
        await expect.poll(() => shownOurs(page)).toEqual(['ESSAI-1', 'ESSAI-2', 'ESSAI-5']);
        await page.mouse.up();
        expect(await ours(request)).toEqual(['ESSAI-1', 'ESSAI-2', 'ESSAI-5']);
        expect(await savedDay(request, date)).toEqual([
            { start: '09:00', end: '10:00', kind: 'work', ticket: 'ESSAI-5', comment: null },
        ]);
        await clearDay(request, date);
    });
});

test.describe('un autre onglet', () => {
    test.use({ expectedErrors: [refusedWith(409)] });

    test('un ordre parti d’une liste changée ailleurs n’écrit rien, et la liste se remet à jour', async ({
        page,
        context,
        request,
    }) => {
        await addFavorites(request, 'ESSAI-1', 'ESSAI-2', 'ESSAI-3');
        await open(page, day(15));

        // Un autre onglet retire ESSAI-3 ; celui-ci le montre encore.
        const other = await context.newPage();
        await other.goto(`/${day(15)}`);
        await card(other, 'ESSAI-3').click({ button: 'right' });
        await other.getByRole('menu').getByRole('menuitem', { name: 'Retirer des favoris' }).click();
        await expect.poll(() => ours(request)).toEqual(['ESSAI-1', 'ESSAI-2']);
        await other.close();

        await card(page, 'ESSAI-1').focus();
        await page.keyboard.press('Alt+ArrowDown');

        await expect(message(page)).toContainText("La liste a changé entre-temps. Rien n'a été déplacé.");
        await expect.poll(() => shownOurs(page)).toEqual(['ESSAI-1', 'ESSAI-2']);
        expect(await ours(request)).toEqual(['ESSAI-1', 'ESSAI-2']);
    });
});

test.describe('la colonne', () => {
    test('se règle de 224 à 360 px par son bord, s’en souvient, et revient à 256 px au double-clic', async ({
        page,
    }) => {
        await open(page, day(16));
        const width = async () => (await column(page).boundingBox())?.width;
        const logo = async () =>
            (
                await page
                    .getByRole('banner')
                    .getByRole('link', { name: /^DayTrack/ })
                    .locator('..')
                    .boundingBox()
            )?.width;
        const edge = page.getByRole('separator', { name: 'Largeur des favoris' });
        expect(await width()).toBe(256);

        const start = await center(edge);
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x + 300, start.y, { steps: 5 });
        await page.mouse.up();
        expect(await width()).toBe(360);
        expect(await logo()).toBe(360);
        await expect(edge).toHaveAttribute('aria-valuenow', '360');

        await page.reload();
        await expect(page.getByRole('group', { name: 'Chiffres du jour' })).toBeVisible();
        expect(await width()).toBe(360);

        await edge.focus();
        await page.keyboard.press('ArrowLeft');
        expect(await width()).toBe(352);
        await page.keyboard.press('Home');
        expect(await width()).toBe(224);

        await edge.dblclick();
        expect(await width()).toBe(256);
        await page.reload();
        expect(await width()).toBe(256);
    });

    test('à 224 px, le pied du renommage tient dans son cadre', async ({ page, request }) => {
        await addFavorites(request, 'ESSAI-1');
        await open(page, day(19));
        await page.setViewportSize({ width: 1024, height: 720 });

        await card(page, 'ESSAI-1').dblclick();
        const frame = await form(page, 'Renommer le favori ESSAI-1').boundingBox();
        for (const name of ['Annuler', 'Enregistrer']) {
            const button = await form(page, 'Renommer le favori ESSAI-1').getByRole('button', { name }).boundingBox();
            expect(button?.x ?? 0, name).toBeGreaterThanOrEqual(frame?.x ?? 0);
            expect((button?.x ?? 0) + (button?.width ?? 0), name).toBeLessThanOrEqual(
                (frame?.x ?? 0) + (frame?.width ?? 0),
            );
        }
    });

    test('reste à 224 px sous 1280 px, et son bord ne s’y règle pas', async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('daytrack.side-width', '340');
        });
        await open(page, day(17));
        expect((await column(page).boundingBox())?.width).toBe(340);

        await page.setViewportSize({ width: 1024, height: 720 });
        expect((await column(page).boundingBox())?.width).toBe(224);
        await expect(page.getByRole('separator', { name: 'Largeur des favoris' })).toBeHidden();
    });

    test('le formulaire et le menu ouverts passent le contrôle d’accessibilité', async ({ page, request }) => {
        await addFavorites(request, 'ESSAI-1');
        await open(page, day(18));
        await page.clock.resume();
        const axe = () =>
            new AxeBuilder({ page })
                .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
                .analyze();

        await addButton(page).click();
        expect((await axe()).violations).toEqual([]);
        await page.keyboard.press('Escape');

        await card(page, 'ESSAI-1').click({ button: 'right' });
        await expect(page.getByRole('menu')).toBeVisible();
        // L'infobulle du +, que le curseur rendu par Échap a ouverte, finit de s'effacer.
        await expect(page.getByRole('tooltip')).toHaveCount(0);
        expect((await axe()).violations).toEqual([]);
    });
});
