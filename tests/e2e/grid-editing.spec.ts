import type { Locator, Page } from '@playwright/test';

import { clearDay, type Entry, freezeTime, startTimeAt, writeDay } from './day';
import {
    clickSlot,
    doubleClickSlot,
    dragSlots,
    expectGridMatchesBase,
    glideTo,
    menu,
    message,
    NEAR_LEFT,
    rightClickSlot,
    savedDay,
    slot,
    slotPoint,
    slots,
    ticketWindow,
} from './editing';
import { expect, refusedWith, test, VIEWPORTS } from './fixtures';

/**
 * La saisie dans la grille : chaque geste à la souris et au clavier, ses refus, et la
 * base relue après lui. Chaque parcours prend un jour de 2025 à lui (tests/e2e/day.ts).
 */

/**
 * Le jour d'un parcours : `index` jours après le lundi 8 septembre 2025, après ceux de
 * l'écran en lecture (day.spec.ts) et avant ceux des écrans de la saisie. Un samedi ou un
 * dimanche est fermé à la saisie : un parcours qui saisit sur une journée vide, ou qui en
 * lit l'objectif, prend un jour de semaine.
 */
function day(index: number): string {
    const date = new Date(Date.UTC(2025, 8, 8 + index));

    return `${String(date.getUTCFullYear())}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

const MORNING: Entry[] = [
    { start: '09:15', end: '09:30', ticket: 'OPS-12', comment: 'Daily' },
    { start: '09:30', end: '11:15', ticket: 'SHOP-482', comment: 'Mapping des colonnes' },
    { start: '11:15', end: '11:45', ticket: 'SHOP-519', comment: 'Reproduction' },
    { start: '12:30', end: '13:30' },
];

async function open(page: Page, date: string) {
    await page.goto(`/${date}`);
    await expect(page.getByRole('group', { name: 'Chiffres du jour' })).toBeVisible();
}

function blocks(page: Page) {
    return page.getByRole('list', { name: 'Saisies du jour' }).getByRole('listitem');
}

/** Le commentaire de Modifier la sélection, où l'on écrit le nouveau. */
function selectionComment(page: Page): Locator {
    return ticketWindow(page, 'Modifier la sélection').getByLabel('Commentaire');
}

/** Les boutons d'une fenêtre, dans l'ordre, par leur nom : la croix, puis le pied. */
function buttonNames(window: Locator): Promise<string[]> {
    return window
        .getByRole('button')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? node.textContent.trim()));
}

test.describe('la fenêtre Nouveau ticket, refusée', () => {
    test.use({ expectedErrors: [refusedWith(422)] });

    test('garde la fenêtre et la saisie sur un refus, le message sous son champ', async ({ page, request }) => {
        const date = day(3);
        await writeDay(request, date, []);
        await open(page, date);

        await doubleClickSlot(page, '10:00');
        const window = ticketWindow(page);
        await window.getByLabel('Commentaire').fill('Revue');
        await window.getByRole('button', { name: 'Enregistrer' }).click();
        const ticket = window.getByLabel('Ticket');
        await expect(ticket).toHaveAttribute('aria-invalid', 'true');
        await expect(ticket).toHaveAccessibleDescription('Indiquez un ticket.');
        await expect(ticket).toBeFocused();
        await expect(window.getByLabel('Commentaire')).toHaveValue('Revue');

        // Un clic à côté ne ferme pas une fenêtre refusée.
        await ticket.fill('shop_482');
        await clickSlot(page, '15:00');
        await expect(window).toBeVisible();
        await expect(ticket).toHaveAccessibleDescription("Un identifiant de ticket s'écrit comme SHOP-482.");
        await expect(ticket).toHaveValue('SHOP_482');

        await ticket.fill('SHOP-482');
        await ticket.press('Enter');
        await expect(window).toBeHidden();
        await expect(blocks(page)).toHaveText([/SHOP-482.*Revue/]);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('garde la sélection qu’elle remplace quand elle prend pour elle le clic dans les favoris', async ({
        page,
        request,
    }) => {
        const date = day(32);
        await writeDay(request, date, MORNING);
        await open(page, date);
        const selected = slots(page).getByRole('option', { selected: true });

        // Une lettre tapée sur un bloc ouvre Nouveau ticket sur la sélection exacte.
        await clickSlot(page, '10:00');
        await clickSlot(page, '10:30', ['Shift']);
        await page.keyboard.press('s');
        const window = ticketWindow(page);
        const ticket = window.getByLabel('Ticket');
        await ticket.fill('shop_482');

        // Le clic dans la colonne des favoris est un clic à côté de la fenêtre, refusé : elle
        // reste ouverte, et la sélection qu'elle remplacera reste dessinée.
        await page
            .getByRole('complementary', { name: 'Favoris et calendrier' })
            .getByRole('heading', { name: 'Favoris' })
            .click();
        await expect(ticket).toHaveAccessibleDescription(/^Un identifiant de ticket s'écrit comme SHOP-482\./);
        await expect(window).toBeVisible();
        await expect(selected).toHaveCount(3);
        await page.keyboard.press('Escape');
        await expect(window).toHaveCount(0);
        await expect(selected).toHaveCount(3);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });
});

test.describe('la fenêtre Nouveau ticket', () => {
    test('s’ouvre au double-clic sur un créneau vide et enregistre à Entrée', async ({ page, request }) => {
        const date = day(0);
        await writeDay(request, date, []);
        await open(page, date);

        await doubleClickSlot(page, '15:15');
        const window = ticketWindow(page);
        await expect(window).toBeVisible();
        await expect(window).toContainText('Lundi 8 septembre de 15:15 à 15:30');
        await expect(window.getByLabel('Ticket')).toBeFocused();

        await window.getByLabel('Ticket').fill('shop-501');
        await window.getByLabel('Commentaire').fill('Relance');
        await window.getByLabel('Commentaire').press('Enter');

        await expect(window).toBeHidden();
        await expect(blocks(page)).toHaveText([/SHOP-501.*Relance.*0h15/]);
        await expect(slots(page)).toBeFocused();
        // L'ajout d'un seul bloc se voit dans la grille : pas de message.
        await expect(message(page)).toHaveCount(0);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('s’ouvre après un glisser à une lettre, à Entrée ou au menu, pour toute la plage', async ({
        page,
        request,
    }) => {
        const date = day(1);
        await writeDay(request, date, MORNING);
        await open(page, date);
        const window = ticketWindow(page);

        // Une lettre : Nouveau ticket sur la plage, la lettre déjà écrite dans le champ.
        await dragSlots(page, '14:00', '14:45');
        await expect(window).toHaveCount(0);
        await page.keyboard.type('o');
        await expect(window).toContainText('de 14:00 à 15:00');
        await expect(window.getByLabel('Ticket')).toHaveValue('O');
        await page.keyboard.type('ps-7');
        await expect(window.getByLabel('Ticket')).toHaveValue('OPS-7');
        await page.keyboard.press('Enter');
        await expect(window).toHaveCount(0);
        await expect(blocks(page).filter({ hasText: 'OPS-7' })).toHaveText([/De 14:00 à 15:00.*1h00/]);

        // Entrée, glissé de bas en haut : la plage entière, le champ vide.
        await dragSlots(page, '15:30', '15:00');
        await expect(window).toHaveCount(0);
        await page.keyboard.press('Enter');
        await expect(window).toContainText('de 15:00 à 15:45');
        await expect(window.getByLabel('Ticket')).toHaveValue('');
        await window.getByLabel('Ticket').fill('OPS-13');
        await window.getByLabel('Ticket').press('Enter');
        await expect(blocks(page).filter({ hasText: 'OPS-13' })).toHaveText([/De 15:00 à 15:45.*0h45/]);

        // « Nouveau ticket… » du clic droit, dans la plage glissée : elle reste sélectionnée.
        await dragSlots(page, '16:00', '16:15');
        await rightClickSlot(page, '16:15');
        await page.getByRole('menuitem', { name: 'Nouveau ticket…' }).click();
        await expect(window).toContainText('de 16:00 à 16:30');
        await page.keyboard.press('Escape');

        // Sur une partie d'un bloc, la lettre remplace la plage exacte, et le dit.
        await dragSlots(page, '09:30', '09:45');
        await page.keyboard.type('s');
        await expect(window).toContainText('de 09:30 à 10:00');
        await expect(window.getByText(/^Remplace /)).toHaveText('Remplace SHOP-482 sur ces 30 minutes.');
        await page.keyboard.press('Escape');

        // Le double-clic sur un créneau vide l'ouvre toujours sur ce créneau.
        await doubleClickSlot(page, '17:00');
        await expect(window).toContainText('de 17:00 à 17:15');
        await page.keyboard.press('Escape');

        expect(await savedDay(request, date)).toMatchObject([
            ...MORNING,
            { start: '14:00', end: '15:00', ticket: 'OPS-7', comment: null },
            { start: '15:00', end: '15:45', ticket: 'OPS-13', comment: null },
        ]);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('enregistre au clic à côté, et ferme sans rien écrire à la croix, à Échap et à Annuler', async ({
        page,
        request,
    }) => {
        const date = day(2);
        await writeDay(request, date, []);
        await open(page, date);

        for (const close of ['Fermer', 'Escape', 'Annuler'] as const) {
            await doubleClickSlot(page, '10:00');
            await ticketWindow(page).getByLabel('Ticket').fill('OPS-1');
            if (close === 'Escape') {
                await page.keyboard.press('Escape');
            } else {
                await ticketWindow(page).getByRole('button', { name: close, exact: true }).click();
            }
            await expect(ticketWindow(page)).toHaveCount(0);
        }
        expect(await savedDay(request, date)).toEqual([]);

        await doubleClickSlot(page, '10:00');
        await ticketWindow(page).getByLabel('Ticket').fill('OPS-1');
        await clickSlot(page, '12:00');
        await expect(ticketWindow(page)).toHaveCount(0);
        await expect(blocks(page)).toHaveText([/OPS-1/]);
        // Le clic qui ferme la fenêtre sélectionne aussi, comme dans un tableur.
        await expect(slot(page, '12:00')).toHaveAttribute('aria-selected', 'true');

        // Une sélection commencée dans un champ et relâchée dehors n'est pas un clic à côté.
        await doubleClickSlot(page, '11:00');
        const field = ticketWindow(page).getByLabel('Ticket');
        await field.fill('OPS-2');
        const box = await field.boundingBox();
        const outside = await slot(page, '15:00').boundingBox();
        await page.mouse.move((box?.x ?? 0) + 4, (box?.y ?? 0) + 8);
        await page.mouse.down();
        await page.mouse.move((outside?.x ?? 0) + 40, (outside?.y ?? 0) + 8, { steps: 4 });
        await page.mouse.up();
        await expect(ticketWindow(page)).toBeVisible();
        await page.keyboard.press('Escape');

        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('pose une pause, qui ne compte pas dans le temps travaillé', async ({ page, request }) => {
        const date = day(4);
        await writeDay(request, date, []);
        await open(page, date);

        await dragSlots(page, '12:30', '13:15');
        await page.keyboard.press('Enter');
        await ticketWindow(page).getByRole('button', { name: 'Pause' }).click();
        await expect(blocks(page)).toHaveText([/Pause.*1h00/]);
        await expect(page.getByRole('group', { name: 'Chiffres du jour' })).toContainText('0h00');
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('n’écrit qu’une fois sur une Entrée répétée ou un double clic', async ({ page, request }) => {
        const date = day(7);
        await writeDay(request, date, []);
        await open(page, date);
        const writes: string[] = [];
        page.on('request', (sent) => {
            if (sent.method() === 'PATCH') {
                writes.push(sent.url());
            }
        });

        // Une touche tenue se répète : la fenêtre ne s'enregistre qu'une fois, et ne se rouvre pas.
        await doubleClickSlot(page, '10:00');
        await ticketWindow(page).getByLabel('Ticket').fill('OPS-12');
        await page.keyboard.down('Enter');
        await page.keyboard.down('Enter');
        await page.keyboard.down('Enter');
        await page.keyboard.up('Enter');
        await expect(blocks(page)).toHaveCount(1);
        await expect(ticketWindow(page, 'Modifier le ticket')).toHaveCount(0);

        // Deux clics sur Enregistrer ne font qu'un geste.
        await doubleClickSlot(page, '11:00');
        const save = ticketWindow(page).getByRole('button', { name: 'Enregistrer' });
        await ticketWindow(page).getByLabel('Ticket').fill('OPS-13');
        await save.evaluate((button: HTMLButtonElement) => {
            button.click();
            button.click();
        });
        await expect(ticketWindow(page)).toHaveCount(0);

        await expect(blocks(page)).toHaveCount(2);
        expect(writes).toHaveLength(2);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('saisit aux bornes de la journée, 07:00 et 19:45', async ({ page, request }) => {
        const date = day(8);
        await writeDay(request, date, []);
        await open(page, date);

        for (const [time, ticket] of [
            ['07:00', 'OPS-1'],
            ['19:45', 'OPS-2'],
        ] as const) {
            await doubleClickSlot(page, time);
            await ticketWindow(page).getByLabel('Ticket').fill(ticket);
            await page.keyboard.press('Enter');
            await expect(ticketWindow(page)).toHaveCount(0);
        }
        expect(await savedDay(request, date)).toMatchObject([
            { start: '07:00', end: '07:15', ticket: 'OPS-1' },
            { start: '19:45', end: '20:00', ticket: 'OPS-2' },
        ]);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });
});

test.describe('un glisser sur la grille', () => {
    function selected(page: Page): Locator {
        return slots(page).getByRole('option', { selected: true });
    }

    test('ne fait que sélectionner, sur des créneaux vides comme sur des blocs, copié ou non', async ({
        page,
        request,
    }) => {
        const date = day(91);
        await writeDay(request, date, MORNING);
        await open(page, date);
        const writes: string[] = [];
        page.on('request', (sent) => {
            if (sent.method() === 'PATCH') {
                writes.push(sent.url());
            }
        });

        // Sur des créneaux vides, rien de copié.
        await dragSlots(page, '14:00', '14:45');
        await expect(selected(page)).toHaveText([/^14:00/, /^14:15/, /^14:30/, /^14:45/]);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(slots(page)).toBeFocused();

        // Sur des blocs.
        await dragSlots(page, '09:30', '10:00');
        await expect(selected(page)).toHaveText([/^09:30/, /^09:45/, /^10:00/]);
        await expect(page.getByRole('dialog')).toHaveCount(0);

        // Sur des créneaux vides, un ticket copié.
        await clickSlot(page, '11:15');
        await page.keyboard.press('ControlOrMeta+C');
        await dragSlots(page, '16:00', '16:30');
        await expect(selected(page)).toHaveText([/^16:00/, /^16:15/, /^16:30/]);
        await expect(page.getByRole('dialog')).toHaveCount(0);

        expect(writes).toHaveLength(0);
        expect(await savedDay(request, date)).toMatchObject(MORNING);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('colle sur la plage un créneau copié la veille, et Ctrl/⌘+Z la vide d’un coup', async ({ page, request }) => {
        const before = day(92);
        const date = day(93);
        await writeDay(request, before, [{ start: '09:00', end: '10:00', ticket: 'SHOP-482', comment: 'Revue' }]);
        await writeDay(request, date, []);
        await open(page, before);

        // Un clic sur un bloc copie un seul créneau, qui remplit toute la plage.
        await clickSlot(page, '09:15');
        await page.keyboard.press('ControlOrMeta+C');
        await page.getByRole('button', { name: 'Jour suivant' }).click();
        await expect(page).toHaveURL(`/${date}`);
        await expect(blocks(page)).toHaveCount(0);

        await dragSlots(page, '15:30', '15:00');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await page.keyboard.press('ControlOrMeta+V');
        await expect(blocks(page)).toHaveText([/De 15:00 à 15:45.*SHOP-482.*Revue.*0h45/]);
        // Sur des créneaux vides, le collage ajoute : il se voit, sans message.
        await expect(message(page)).toHaveCount(0);
        await expect(selected(page)).toHaveText([/^15:00/, /^15:15/, /^15:30/]);
        await expect
            .poll(() => savedDay(request, date))
            .toMatchObject([{ start: '15:00', end: '15:45', ticket: 'SHOP-482', comment: 'Revue' }]);
        await expectGridMatchesBase(page, request, date);

        await page.keyboard.press('ControlOrMeta+Z');
        await expect(blocks(page)).toHaveCount(0);
        await expect.poll(() => savedDay(request, date)).toEqual([]);
        await expectGridMatchesBase(page, request, date);

        // La veille n'a pas bougé.
        expect(await savedDay(request, before)).toMatchObject([
            { start: '09:00', end: '10:00', ticket: 'SHOP-482', comment: 'Revue' },
        ]);
        await clearDay(request, before);
        await clearDay(request, date);
    });

    test('colle en entier un groupe du matin sur un glisser de l’après-midi, et dit ce qu’il remplace', async ({
        page,
        request,
    }) => {
        const date = day(94);
        await writeDay(request, date, MORNING);
        await open(page, date);

        // Un groupe sélectionné en glissant, collé sur une plage plus courte : il se colle en
        // entier à partir de son premier créneau, et la sélection devient ce qui a été collé.
        await dragSlots(page, '09:15', '09:45');
        await page.keyboard.press('ControlOrMeta+C');
        await dragSlots(page, '14:00', '14:15');
        await page.keyboard.press('ControlOrMeta+V');
        await expect(blocks(page).filter({ hasText: 'OPS-12' })).toHaveText([/De 09:15 à 09:30/, /De 14:00 à 14:15/]);
        await expect(blocks(page).filter({ hasText: 'Mapping des colonnes' })).toHaveText([
            /De 09:30 à 11:15/,
            /De 14:15 à 14:45/,
        ]);
        await expect(message(page)).toHaveCount(0);
        await expect(selected(page)).toHaveText([/^14:00/, /^14:15/, /^14:30/]);
        await expectGridMatchesBase(page, request, date);

        // Collé par-dessus un bloc, il le dit, et Ctrl/⌘+Z le rend.
        await dragSlots(page, '11:15', '11:30');
        await page.keyboard.press('ControlOrMeta+V');
        await expect(message(page)).toHaveText(/^SHOP-519 remplacé/);
        await expect(blocks(page).filter({ hasText: 'SHOP-519' })).toHaveCount(0);
        await expectGridMatchesBase(page, request, date);
        await page.keyboard.press('ControlOrMeta+Z');
        await expect(blocks(page).filter({ hasText: 'SHOP-519' })).toHaveText([/De 11:15 à 11:45/]);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });
});

test.describe('la fenêtre Modifier le ticket', () => {
    test('s’ouvre sur le bloc entier, l’entoure, et modifie tous ses quarts d’heure', async ({ page, request }) => {
        const date = day(10);
        await writeDay(request, date, MORNING);
        await open(page, date);

        await doubleClickSlot(page, '10:30');
        const window = ticketWindow(page, 'Modifier le ticket');
        await expect(window).toContainText('Jeudi 18 septembre de 09:30 à 11:15');
        await expect(window.getByLabel('Ticket')).toHaveValue('SHOP-482');
        await expect(window.getByLabel('Commentaire')).toHaveValue('Mapping des colonnes');
        await expect(blocks(page).filter({ hasText: 'SHOP-482' })).toHaveClass(/edit-ring/);

        await window.getByLabel('Commentaire').fill('Tests');
        await window.getByLabel('Commentaire').press('Enter');
        await expect(blocks(page).filter({ hasText: 'SHOP-482' })).toHaveText([/De 09:30 à 11:15.*Tests.*1h45/]);
        await expect(message(page)).toHaveCount(0);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('supprime un bloc, le dit, et l’annulation le rend', async ({ page, request }) => {
        const date = day(11);
        await writeDay(request, date, MORNING);
        await open(page, date);

        await doubleClickSlot(page, '11:30');
        await ticketWindow(page, 'Modifier le ticket').getByRole('button', { name: 'Supprimer' }).click();
        await expect(blocks(page).filter({ hasText: 'SHOP-519' })).toHaveCount(0);
        await expect(message(page)).toHaveText(/SHOP-519 supprimé/);
        await expectGridMatchesBase(page, request, date);

        await message(page).getByRole('button', { name: 'Annuler' }).click();
        await expect(blocks(page).filter({ hasText: 'SHOP-519' })).toHaveText([/De 11:15 à 11:45/]);
        await expect(message(page)).toHaveCount(0);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('supprime un bloc qu’on vide', async ({ page, request }) => {
        const date = day(12);
        await writeDay(request, date, MORNING);
        await open(page, date);

        await doubleClickSlot(page, '09:15');
        const window = ticketWindow(page, 'Modifier le ticket');
        await window.getByLabel('Ticket').fill('');
        await window.getByLabel('Commentaire').fill('');
        await window.getByLabel('Commentaire').press('Enter');
        await expect(blocks(page).filter({ hasText: 'OPS-12' })).toHaveCount(0);
        await expect(message(page)).toHaveText(/OPS-12 supprimé/);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('convertit en pause, et ouvre une pause comme une pause', async ({ page, request }) => {
        const date = day(13);
        await writeDay(request, date, MORNING);
        await open(page, date);

        await doubleClickSlot(page, '11:15');
        await ticketWindow(page, 'Modifier le ticket').getByRole('button', { name: 'Convertir en pause' }).click();
        await expect(blocks(page).filter({ hasText: 'SHOP-519' })).toHaveCount(0);

        await doubleClickSlot(page, '12:45');
        const pause = ticketWindow(page, 'Modifier la pause');
        await expect(pause).toContainText('de 12:30 à 13:30');
        await expect(pause.getByLabel('Ticket')).toHaveValue('');
        await expect(pause.getByRole('button', { name: 'Convertir en pause' })).toHaveCount(0);
        await pause.getByLabel('Ticket').fill('OPS-21');
        await pause.getByLabel('Ticket').press('Enter');
        await expect(blocks(page).filter({ hasText: 'OPS-21' })).toHaveText([/De 12:30 à 13:30/]);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('porte la corbeille et la tasse en icônes seules, sur une ligne', async ({ page, request }) => {
        const date = day(66);
        await writeDay(request, date, MORNING);
        await open(page, date);

        await doubleClickSlot(page, '10:00');
        const window = ticketWindow(page, 'Modifier le ticket');
        expect(await buttonNames(window)).toEqual([
            'Fermer',
            'Supprimer',
            'Convertir en pause',
            'Annuler',
            'Enregistrer',
        ]);
        // Chaque icône se nomme dans son infobulle, au survol, sans « title » du navigateur.
        for (const name of ['Supprimer', 'Convertir en pause']) {
            const icon = window.getByRole('button', { name });
            await expect(icon).toHaveText('');
            await expect(icon).not.toHaveAttribute('title');
            await glideTo(page, icon);
            // L'infobulle d'avant s'efface en fondu pendant que la suivante paraît.
            await expect(page.getByRole('tooltip').filter({ hasText: name })).toBeVisible();
        }
        await page.mouse.move(0, 0);
        const footer = (await window.getByRole('button').all()).slice(1);
        const tops = await Promise.all(footer.map(async (button) => (await button.boundingBox())?.y));
        expect(new Set(tops).size).toBe(1);

        await page.keyboard.press('Escape');
        await clearDay(request, date);
    });

    test('grise « Enregistrer » d’une pause tant qu’aucun ticket n’y est tapé', async ({ page, request }) => {
        const date = day(67);
        await writeDay(request, date, MORNING);
        await open(page, date);

        await doubleClickSlot(page, '13:00');
        const pause = ticketWindow(page, 'Modifier la pause');
        const save = pause.getByRole('button', { name: 'Enregistrer' });
        expect(await buttonNames(pause)).toEqual(['Fermer', 'Supprimer', 'Annuler', 'Enregistrer']);
        await expect(save).toHaveAttribute('aria-disabled', 'true');

        // Grisé, il ne fait rien : ni au clic — que Playwright retiendrait, d'où « force » —,
        // ni à Entrée.
        await save.click({ force: true });
        await pause.getByLabel('Ticket').press('Enter');
        await expect(pause).toBeVisible();

        await pause.getByLabel('Ticket').fill('ops-21');
        await expect(save).not.toHaveAttribute('aria-disabled');
        await pause.getByLabel('Ticket').fill('  ');
        await expect(save).toHaveAttribute('aria-disabled', 'true');

        // Rien de tapé, un clic à côté ferme, et la pause reste une pause.
        await clickSlot(page, '15:00');
        await expect(pause).toHaveCount(0);
        expect(await savedDay(request, date)).toContainEqual(
            expect.objectContaining({ start: '12:30', kind: 'pause' }),
        );

        await doubleClickSlot(page, '13:00');
        await pause.getByLabel('Ticket').fill('ops-21');
        await save.click();
        await expect(blocks(page).filter({ hasText: 'OPS-21' })).toHaveText([/De 12:30 à 13:30/]);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });
});

test.describe('le champ Ticket', () => {
    test('se récrit pendant la frappe, sans déplacer le curseur, et lit une adresse collée', async ({
        page,
        request,
    }) => {
        const date = day(37);
        await writeDay(request, date, []);
        await open(page, date);

        await doubleClickSlot(page, '10:00');
        const ticket = ticketWindow(page).getByLabel('Ticket');
        await expect(ticket).toHaveCSS('width', '160px');
        await ticket.pressSequentially('shop 48');
        await expect(ticket).toHaveValue('SHOP48');
        // Le curseur reste là où l'on tape, même au milieu.
        await ticket.press('ArrowLeft');
        await ticket.press('ArrowLeft');
        await ticket.pressSequentially('-');
        await expect(ticket).toHaveValue('SHOP-48');
        await ticket.press('End');
        await ticket.pressSequentially('2');
        await expect(ticket).toHaveValue('SHOP-482');

        await ticket.fill('https://exemple.atlassian.net/browse/shop-519?focusedCommentId=10');
        await expect(ticket).toHaveValue('SHOP-519');
        await ticket.press('Enter');
        await expect(blocks(page)).toHaveText([/SHOP-519/]);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('dit une forme refusée en quittant le champ, jamais pendant la frappe', async ({ page, request }) => {
        const date = day(38);
        await writeDay(request, date, []);
        await open(page, date);

        await doubleClickSlot(page, '10:00');
        const window = ticketWindow(page);
        const ticket = window.getByLabel('Ticket');
        const comment = window.getByLabel('Commentaire');
        await ticket.pressSequentially('shop');
        await expect(ticket).not.toHaveAttribute('aria-invalid');

        // Le départ du champ dit le refus, et laisse le curseur où l'on allait.
        await ticket.press('Tab');
        await expect(comment).toBeFocused();
        await expect(ticket).toHaveAttribute('aria-invalid', 'true');
        await expect(ticket).toHaveAccessibleDescription("Un identifiant de ticket s'écrit comme SHOP-482.");

        // Taper l'efface ; il ne revient qu'au départ du champ.
        await ticket.click();
        await ticket.pressSequentially('-4');
        await expect(ticket).not.toHaveAttribute('aria-invalid');
        await ticket.pressSequentially('82');
        await comment.click();
        await expect(ticket).not.toHaveAttribute('aria-invalid');

        // Un champ vide n'a pas de forme à juger.
        await ticket.fill('');
        await comment.click();
        await expect(ticket).not.toHaveAttribute('aria-invalid');

        // Un bouton du pied fait son geste du premier clic : le refus n'apparaît pas
        // sous le champ pour pousser le bouton sous le pointeur.
        await ticket.fill('shop');
        await window.getByRole('button', { name: 'Annuler' }).click();
        await expect(window).toHaveCount(0);
        expect(await savedDay(request, date)).toEqual([]);
        await clearDay(request, date);
    });
});

test.describe('le champ Commentaire', () => {
    test('grandit jusqu’à quatre lignes puis défile, tient sur une ligne et s’enregistre à Entrée', async ({
        page,
        request,
    }) => {
        const date = day(70);
        await writeDay(request, date, []);
        await open(page, date);

        await doubleClickSlot(page, '10:00');
        const window = ticketWindow(page);
        const comment = window.getByLabel('Commentaire');
        const height = async () => (await comment.boundingBox())?.height ?? 0;
        const empty = await height();
        expect(empty).toBe(58);

        await comment.fill('Revue de code '.repeat(4));
        const two = await height();
        expect(two).toBe(empty);
        await comment.fill('Revue de code '.repeat(12));
        const grown = await height();
        expect(grown).toBeGreaterThan(two);
        await comment.fill('Revue de code '.repeat(40));
        const tallest = await height();
        // Quatre lignes de 14 px à 1,4, la marge et le bord.
        expect(tallest).toBeCloseTo(4 * 14 * 1.4 + 2 * 8 + 2, 0);
        await comment.fill('Revue de code '.repeat(60));
        expect(await height()).toBe(tallest);
        expect(await comment.evaluate((area) => area.scrollHeight > area.clientHeight)).toBe(true);

        // Un retour à la ligne collé devient une espace ; Entrée enregistre.
        await window.getByLabel('Ticket').fill('SHOP-482');
        await comment.fill('Revue\nde code');
        await expect(comment).toHaveValue('Revue de code');
        await comment.press('Enter');
        await expect(window).toBeHidden();
        await expect(blocks(page)).toHaveText([/SHOP-482.*Revue de code/]);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });
});

test.describe('la sélection, le menu et les raccourcis', () => {
    test('se compose à la souris : clic, Maj+clic, Ctrl/⌘+clic', async ({ page, request }) => {
        const date = day(20);
        await writeDay(request, date, MORNING);
        await open(page, date);

        // Un clic sur un bloc ne sélectionne que le quart d'heure cliqué.
        await clickSlot(page, '10:00');
        await expect(slots(page).getByRole('option', { selected: true })).toHaveText([
            '10:00, SHOP-482, Mapping des colonnes',
        ]);
        await clickSlot(page, '10:30', ['Shift']);
        await expect(slots(page).getByRole('option', { selected: true })).toHaveCount(3);
        await clickSlot(page, '14:00', ['ControlOrMeta']);
        await clickSlot(page, '10:15', ['ControlOrMeta']);
        await expect(slots(page).getByRole('option', { selected: true })).toHaveText([/^10:00/, /^10:30/, /^14:00/]);
        // Le créneau retiré n'est plus désigné : la liste porte alors son propre anneau.
        await expect(slots(page)).not.toHaveAttribute('aria-activedescendant');
        await clickSlot(page, '14:15', ['ControlOrMeta']);
        await expect(slots(page)).toHaveAttribute('aria-activedescendant', 'creneau-1415');
        await clearDay(request, date);
    });

    test('se parcourt au clavier et ouvre Nouveau ticket sur une plage', async ({ page, request }) => {
        const date = day(21);
        await writeDay(request, date, []);
        await open(page, date);

        // La grille s'ouvre sur 08:00 : le clavier y commence.
        await slots(page).focus();
        await page.keyboard.press('ArrowDown');
        await expect(slots(page)).toHaveAttribute('aria-activedescendant', /creneau-08/);
        const start = (await slots(page).getAttribute('aria-activedescendant')) ?? '';
        await page.keyboard.press('Shift+ArrowDown');
        await page.keyboard.press('Shift+ArrowDown');
        await page.keyboard.press('Enter');
        const window = ticketWindow(page);
        await expect(window).toContainText('de 08:15 à 09:00');
        await expect(window.getByLabel('Ticket')).toBeFocused();
        await page.keyboard.type('OPS-12');
        await page.keyboard.press('Enter');
        await expect(blocks(page)).toHaveText([/OPS-12.*0h45/]);
        await expect(slots(page)).toBeFocused();

        // Entrée sur un bloc ouvre Modifier le ticket ; Échap ferme, puis vide la sélection.
        await page.keyboard.press('Enter');
        await expect(ticketWindow(page, 'Modifier le ticket')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(slots(page)).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(slots(page).getByRole('option', { selected: true })).toHaveCount(0);
        expect(start).toMatch(/^creneau-08/);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('copie, colle et dit ce qui a été remplacé', async ({ page, request }) => {
        const date = day(22);
        await writeDay(request, date, MORNING);
        await open(page, date);

        await clickSlot(page, '09:15');
        await clickSlot(page, '09:45', ['Shift']);
        await page.keyboard.press('ControlOrMeta+C');

        // Sur des créneaux vides, le collage ajoute : il se voit, sans message.
        await clickSlot(page, '15:00');
        await page.keyboard.press('ControlOrMeta+V');
        await expect(blocks(page).filter({ hasText: 'OPS-12' })).toHaveCount(2);
        await expect(message(page)).toHaveCount(0);
        // La sélection devient ce qui a été collé, même au-delà du créneau choisi.
        await expect(slots(page).getByRole('option', { selected: true })).toHaveText([/^15:00/, /^15:15/, /^15:30/]);

        // Par-dessus des blocs, il le dit.
        await clickSlot(page, '11:15');
        await page.keyboard.press('ControlOrMeta+V');
        await expect(message(page)).toHaveText(/SHOP-519 remplacé/);
        await expectGridMatchesBase(page, request, date);

        await page.keyboard.press('ControlOrMeta+Z');
        await expect(blocks(page).filter({ hasText: 'SHOP-519' })).toHaveText([/De 11:15 à 11:45/]);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('ne colle rien qui dépasserait 20:00, et le dit', async ({ page, request }) => {
        const date = day(23);
        await writeDay(request, date, MORNING);
        await open(page, date);

        await clickSlot(page, '09:30');
        await clickSlot(page, '10:00', ['Shift']);
        await page.keyboard.press('ControlOrMeta+C');
        await clickSlot(page, '19:45');
        await page.keyboard.press('ControlOrMeta+V');

        await expect(message(page)).toHaveText(/Rien n'est collé, le groupe dépasserait 20:00\./);
        await expect(message(page).getByRole('button', { name: 'Annuler' })).toHaveCount(0);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('efface, annule et rétablit', async ({ page, request }) => {
        const date = day(24);
        await writeDay(request, date, MORNING);
        await open(page, date);

        await clickSlot(page, '11:00');
        await clickSlot(page, '11:30', ['Shift']);
        await page.keyboard.press('Delete');
        await expect(message(page)).toHaveText(/3 créneaux effacés/);
        await expectGridMatchesBase(page, request, date);

        await page.keyboard.press('ControlOrMeta+Z');
        await expect(blocks(page).filter({ hasText: 'SHOP-519' })).toHaveText([/De 11:15 à 11:45/]);
        await expectGridMatchesBase(page, request, date);

        await page.keyboard.press('ControlOrMeta+Shift+Z');
        await expect(blocks(page).filter({ hasText: 'SHOP-519' })).toHaveCount(0);
        await expectGridMatchesBase(page, request, date);

        // Retour arrière efface aussi, et une sélection vide n'écrit rien.
        await clickSlot(page, '09:15');
        await page.keyboard.press('Backspace');
        await expect(message(page)).toHaveText(/OPS-12 effacé/);
        await clickSlot(page, '17:00');
        await page.keyboard.press('Delete');
        await expect(message(page)).toHaveText(/OPS-12 effacé/);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('propose au menu ce qui sert, grise le reste, et s’ouvre au clavier', async ({ page, request }) => {
        const date = day(25);
        await writeDay(request, date, MORNING);
        await open(page, date);

        await clickSlot(page, '13:30');
        await clickSlot(page, '15:00', ['Shift']);
        await rightClickSlot(page, '14:15');
        const menu = page.getByRole('menu', { name: 'Actions sur la sélection' });
        await expect(menu).toContainText('7 créneaux, 1h45');
        await expect(menu.getByRole('menuitem')).toHaveText([
            'Nouveau ticket…',
            /^Modifier la sélection…/,
            /^Copier/,
            /^Couper/,
            /^Coller/,
            'Convertir en pause',
            'Ajouter aux favoris',
            /^Effacer/,
        ]);
        for (const [name, enabled] of [
            ['Nouveau ticket…', true],
            ['Modifier la sélection…', false],
            ['Copier', false],
            ['Couper', false],
            ['Coller', false],
            ['Convertir en pause', true],
            ['Ajouter aux favoris', false],
            ['Effacer', false],
        ] as const) {
            const item = menu.getByRole('menuitem', { name });
            await (enabled
                ? expect(item).not.toHaveAttribute('aria-disabled', 'true')
                : expect(item).toHaveAttribute('aria-disabled', 'true'));
        }
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);

        // Un clic droit hors de la sélection la remplace.
        await rightClickSlot(page, '10:00');
        await expect(menu).toContainText('1 créneau, 0h15');
        await menu.getByRole('menuitem', { name: 'Effacer' }).click();
        await expect(message(page)).toHaveText(/SHOP-482 effacé/);
        await expectGridMatchesBase(page, request, date);

        // Au clavier, il s'ouvre sur le premier choix, sur le créneau sélectionné. Le
        // pointeur s'écarte : resté où le menu s'ouvre, il y prendrait le choix survolé.
        await clickSlot(page, '09:45');
        await page.mouse.move(0, 0);
        await page.keyboard.press('Shift+F10');
        await expect(menu.getByRole('menuitem', { name: 'Nouveau ticket…' })).toBeFocused();
        // Radix ne déplace le curseur du menu qu'après la flèche : une flèche tapée avant
        // repartirait du même choix. Chacune attend donc la précédente, comme une main.
        await page.keyboard.press('ArrowDown');
        await expect(menu.getByRole('menuitem', { name: 'Modifier la sélection…' })).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(menu.getByRole('menuitem', { name: 'Copier' })).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(menu.getByRole('menuitem', { name: 'Couper' })).toBeFocused();
        // Coller est grisé : la flèche le saute.
        await page.keyboard.press('ArrowDown');
        await expect(menu.getByRole('menuitem', { name: 'Convertir en pause' })).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(slot(page, '09:45')).toHaveText('09:45, pause');
        await expect(slot(page, '09:30')).toHaveText('09:30, SHOP-482, Mapping des colonnes');
        await expect(slots(page)).toBeFocused();
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('menu ouvert, le raccourci écrit en face d’un choix le fait, et le menu se ferme', async ({
        page,
        request,
    }) => {
        const date = day(87);
        await writeDay(request, date, MORNING);
        await open(page, date);
        const menu = page.getByRole('menu', { name: 'Actions sur la sélection' });

        // Ctrl/⌘+C copie, puis Ctrl/⌘+V colle, chacun menu ouvert.
        await rightClickSlot(page, '09:15');
        await page.keyboard.press('ControlOrMeta+C');
        await expect(menu).toHaveCount(0);
        await expect(slots(page)).toBeFocused();
        await rightClickSlot(page, '16:00');
        await page.keyboard.press('ControlOrMeta+V');
        await expect(menu).toHaveCount(0);
        await expect(slot(page, '16:00')).toHaveText('16:00, OPS-12, Daily');

        // Suppr efface, Retour arrière aussi ; un choix grisé ne répond pas.
        await rightClickSlot(page, '16:00');
        await page.keyboard.press('Delete');
        await expect(menu).toHaveCount(0);
        await expect(slot(page, '16:00')).toHaveText('16:00, vide');
        await rightClickSlot(page, '09:15');
        await page.keyboard.press('Backspace');
        await expect(slot(page, '09:15')).toHaveText('09:15, vide');
        await rightClickSlot(page, '17:00');
        await page.keyboard.press('Delete');
        await expect(menu).toBeVisible();
        await page.keyboard.press('Escape');
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('sur Mac, le menu écrit ⌘C et ⌫', async ({ page, request }) => {
        const date = day(88);
        await writeDay(request, date, MORNING);
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
        });
        await open(page, date);

        await rightClickSlot(page, '09:15');
        const menu = page.getByRole('menu', { name: 'Actions sur la sélection' });
        await expect(menu.getByRole('menuitem', { name: 'Copier' }).locator('kbd')).toHaveText('⌘C');
        await expect(menu.getByRole('menuitem', { name: 'Effacer' }).locator('kbd')).toHaveText('⌫');
        await expect(menu.getByRole('menuitem', { name: 'Effacer' })).toHaveAttribute(
            'aria-keyshortcuts',
            'Delete Backspace',
        );
        await page.keyboard.press('Escape');
        await clearDay(request, date);
    });

    test('coupe au clavier et au menu, puis colle ailleurs', async ({ page, request }) => {
        const date = day(27);
        await writeDay(request, date, MORNING);
        await open(page, date);

        await clickSlot(page, '11:15');
        await clickSlot(page, '11:30', ['Shift']);
        await page.keyboard.press('ControlOrMeta+X');
        await expect(message(page)).toHaveText(/SHOP-519 coupé/);
        await expect(blocks(page).filter({ hasText: 'SHOP-519' })).toHaveCount(0);
        await clickSlot(page, '15:00');
        await page.keyboard.press('ControlOrMeta+V');
        await expect(blocks(page).filter({ hasText: 'SHOP-519' })).toHaveText([/De 15:00 à 15:30/]);
        await expectGridMatchesBase(page, request, date);

        await clickSlot(page, '09:15');
        await clickSlot(page, '09:45', ['Shift']);
        await rightClickSlot(page, '09:30');
        await page.getByRole('menuitem', { name: 'Couper' }).click();
        await expect(message(page)).toHaveText(/3 créneaux coupés/);
        await clickSlot(page, '16:00');
        await page.keyboard.press('ControlOrMeta+V');
        await expect(slot(page, '16:00')).toHaveText('16:00, OPS-12, Daily');
        await expect(slot(page, '16:30')).toHaveText('16:30, SHOP-482, Mapping des colonnes');
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('s’efface à Échap d’où que soit le curseur, et au clic dans les favoris ou le récapitulatif', async ({
        page,
        request,
    }) => {
        const date = day(29);
        await writeDay(request, date, MORNING);
        await page.setViewportSize({ width: 1440, height: 900 });
        await open(page, date);
        const selected = slots(page).getByRole('option', { selected: true });
        const favorites = page.getByRole('complementary', { name: 'Favoris et calendrier' });
        const recap = page.getByRole('complementary', { name: 'Récapitulatif' });

        // Un clic dans la colonne des favoris, à côté des favoris, ou dans le récapitulatif.
        await clickSlot(page, '10:00');
        await expect(selected).toHaveCount(1);
        await favorites.getByRole('heading', { name: 'Favoris' }).click();
        await expect(selected).toHaveCount(0);
        await clickSlot(page, '10:00');
        await clickSlot(page, '10:30', ['Shift']);
        await expect(selected).toHaveCount(3);
        await recap.getByRole('heading', { name: 'Récapitulatif' }).click();
        await expect(selected).toHaveCount(0);

        // Échap ferme d'abord le menu, et la sélection reste ; puis Échap la vide, le
        // curseur hors de la grille, sur le titre du jour.
        await clickSlot(page, '14:00');
        await rightClickSlot(page, '14:00');
        const menu = page.getByRole('menu', { name: 'Actions sur la sélection' });
        await expect(menu).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await expect(selected).toHaveCount(1);
        await page.getByRole('heading', { level: 1 }).click();
        await expect(slots(page)).not.toBeFocused();
        await page.keyboard.press('Escape');
        await expect(selected).toHaveCount(0);

        // Au clavier : le curseur passé de la grille au bouton du récapitulatif, Échap ferme
        // d'abord son infobulle, puis vide la sélection.
        await slots(page).focus();
        await page.keyboard.press('ArrowDown');
        await expect(selected).toHaveCount(1);
        await page.keyboard.press('Tab');
        await expect(recap.getByRole('button', { name: 'Masquer le récapitulatif' })).toBeFocused();
        await expect(page.getByRole('tooltip')).toHaveText('Masquer le récapitulatif');
        await page.keyboard.press('Escape');
        await expect(page.getByRole('tooltip')).toHaveCount(0);
        await expect(selected).toHaveCount(1);
        await page.keyboard.press('Escape');
        await expect(selected).toHaveCount(0);
        await expect(recap).toBeVisible();

        // Un clic sur un favori garde la sélection, pour qu'on le colle dessus. Échap, le
        // curseur sur la carte, la vide : Ctrl/⌘+V n'a plus rien où coller.
        await clickSlot(page, '14:00');
        await favorites.locator('[data-favorite]').filter({ hasText: 'OPS-7' }).click();
        await expect(message(page)).toContainText('OPS-7 copié');
        await expect(selected).toHaveCount(1);
        // La carte qui reprend le curseur ouvre son infobulle ; Radix ne la ferme qu'au
        // mouvement suivant du pointeur hors d'elle, comme le fait une vraie souris.
        await page.mouse.move(0, 0, { steps: 5 });
        await expect(page.getByRole('tooltip')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(selected).toHaveCount(0);
        await page.keyboard.press('ControlOrMeta+V');
        await expect(blocks(page)).toHaveCount(4);
        await expect(page.getByRole('list', { name: 'Saisies du jour' })).not.toContainText('OPS-7');

        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('ferme à Échap le récapitulatif posé sur la grille avant de s’effacer, puis repart du créneau quitté', async ({
        page,
        request,
    }) => {
        const date = day(31);
        await writeDay(request, date, MORNING);
        await page.setViewportSize({ width: 1024, height: 720 });
        await open(page, date);
        const selected = slots(page).getByRole('option', { selected: true });
        const recap = page.locator('#recap');

        // Sous 1280 px, le récapitulatif se pose sur la grille : Échap le ferme d'abord,
        // même le curseur dans la grille, et la sélection reste pour un collage.
        await page.getByRole('button', { name: 'Afficher le récapitulatif' }).click();
        await expect(recap).toHaveAttribute('data-state', 'open');
        await clickSlot(page, '10:00');
        await expect(slots(page)).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(recap).toHaveAttribute('data-state', 'closed');
        await expect(selected).toHaveText(['10:00, SHOP-482, Mapping des colonnes']);
        await page.keyboard.press('Escape');
        await expect(selected).toHaveCount(0);

        // Le curseur reste où il était, comme celui d'un tableur : ↓ reprend sous lui.
        await expect(slots(page)).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(selected).toHaveText(['10:15, SHOP-482, Mapping des colonnes']);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('ne s’entoure pas après Échap sur une sélection faite à la souris, mais au clavier si', async ({
        page,
        request,
    }) => {
        const date = day(33);
        await writeDay(request, date, MORNING);
        await open(page, date);
        const selected = slots(page).getByRole('option', { selected: true });
        const outline = () => slots(page).evaluate((element) => getComputedStyle(element).outlineStyle);
        const cleared = async (ring: 'none' | 'solid') => {
            await page.keyboard.press('Escape');
            await expect(selected).toHaveCount(0);
            await expect(slots(page)).toBeFocused();
            await expect.poll(outline).toBe(ring);
        };

        // Le clic donne le curseur à la grille ; Échap vide la sélection sans rien dessiner :
        // un anneau autour de la grille ressemblerait à une sélection de tout le jour.
        await clickSlot(page, '10:00');
        await cleared('none');

        // Pareil quand une fenêtre ou un menu, fermés à Échap, rendent le curseur à la grille
        // et lui laissent la sélection, pour un collage.
        await doubleClickSlot(page, '10:00');
        await page.keyboard.press('Escape');
        await expect(ticketWindow(page, 'Modifier le ticket')).toHaveCount(0);
        await expect(selected).toHaveCount(7);
        await cleared('none');
        await rightClickSlot(page, '14:00');
        await page.keyboard.press('Escape');
        await expect(page.getByRole('menu', { name: 'Actions sur la sélection' })).toHaveCount(0);
        await expect(selected).toHaveCount(1);
        await cleared('none');

        // Un favori collé au clavier sur une sélection faite à la souris.
        await clickSlot(page, '15:00');
        await page.locator('[data-favorite]').filter({ hasText: 'OPS-7' }).click();
        await page.keyboard.press('ControlOrMeta+V');
        await expect(slot(page, '15:00')).toHaveText('15:00, OPS-7');
        await expect(slots(page)).toBeFocused();
        await cleared('none');
        await page.keyboard.press('ControlOrMeta+Z');
        await expect(slot(page, '15:00')).toHaveText('15:00, vide');

        // Revenu dans la grille au clavier, le curseur s'y montre là où il était resté, et
        // compte comme venu du clavier.
        await page.keyboard.press('Shift+Tab');
        await expect(slots(page)).not.toBeFocused();
        await page.keyboard.press('Tab');
        await expect(selected).toHaveText(['15:00, vide']);
        await cleared('solid');
        await clickSlot(page, '10:00');
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await expect(selected).toHaveText(['10:00, SHOP-482, Mapping des colonnes']);
        await cleared('solid');

        // ↓ rend le curseur, que la sélection dessine ; Échap, au clavier, entoure la grille,
        // et le menu ouvert au clavier ne compte pas comme un clic.
        await clickSlot(page, '10:00');
        await page.keyboard.press('Escape');
        await page.keyboard.press('ArrowDown');
        await expect(selected).toHaveText(['10:15, SHOP-482, Mapping des colonnes']);
        await cleared('solid');
        await page.keyboard.press('Shift+F10');
        await page.keyboard.press('Escape');
        await expect(page.getByRole('menu', { name: 'Actions sur la sélection' })).toHaveCount(0);
        await expect(selected).toHaveText(['10:15, SHOP-482, Mapping des colonnes']);
        await cleared('solid');
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('ne prend au premier Maj+clic ou Ctrl/⌘+clic que le créneau cliqué', async ({ page, request }) => {
        const date = day(34);
        await writeDay(request, date, MORNING);
        const selected = slots(page).getByRole('option', { selected: true });

        // Le clic donne le curseur à la grille sans qu'elle en pose un de son côté, en haut
        // de la vue, comme le ferait une arrivée au clavier.
        for (const modifier of ['Shift', 'ControlOrMeta'] as const) {
            await open(page, date);
            await clickSlot(page, '10:00', [modifier]);
            await expect(selected).toHaveText(['10:00, SHOP-482, Mapping des colonnes']);
        }
        await clearDay(request, date);
    });

    test('garde un anneau sur la grille au clavier, même sans sélection', async ({ page, request }) => {
        const date = day(28);
        await writeDay(request, date, MORNING);
        await open(page, date);

        await slots(page).focus();
        await page.keyboard.press('ArrowDown');
        const outline = () => slots(page).evaluate((element) => getComputedStyle(element).outlineStyle);
        // Le cadre de la sélection montre le curseur ; Échap le retire, l'anneau de la liste le remplace.
        expect(await outline()).toBe('none');
        await page.keyboard.press('Escape');
        await expect(slots(page)).not.toHaveAttribute('aria-activedescendant');
        expect(await outline()).toBe('solid');
        await clearDay(request, date);
    });

    test('convertit en pause une plage vide par le menu', async ({ page, request }) => {
        const date = day(14);
        await writeDay(request, date, []);
        await open(page, date);

        await clickSlot(page, '12:00');
        await clickSlot(page, '12:45', ['Shift']);
        await rightClickSlot(page, '12:30');
        await page.getByRole('menuitem', { name: 'Convertir en pause' }).click();
        await expect(blocks(page)).toHaveText([/Pause.*1h00/]);
        // Rien n'a disparu : pas de message.
        await expect(message(page)).toHaveCount(0);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });
});

/**
 * Remplacer une partie d'un bloc : « Nouveau ticket… » du menu, ou une lettre tapée sur
 * la sélection, ouvre Nouveau ticket sur la sélection exacte. Le double-clic et Entrée
 * gardent le bloc entier.
 */
test.describe('remplacer une sélection par un nouveau ticket', () => {
    function note(window: Locator): Locator {
        return window.getByText(/^Remplace /);
    }

    test('au menu : la sélection exacte, le bloc coupé, le message, et Ctrl/⌘+Z qui défait tout d’un coup', async ({
        page,
        request,
    }) => {
        const date = day(71);
        await writeDay(request, date, MORNING);
        await open(page, date);

        await clickSlot(page, '10:00');
        await clickSlot(page, '10:15', ['Shift']);
        await rightClickSlot(page, '10:00');
        await page.getByRole('menuitem', { name: 'Nouveau ticket…' }).click();
        const window = ticketWindow(page);
        await expect(window).toContainText('de 10:00 à 10:30');
        await expect(note(window)).toHaveText('Remplace SHOP-482 sur ces 30 minutes.');
        // Le champ, vide, prend le curseur, et l'annonce du remplacement le décrit.
        const ticket = window.getByLabel('Ticket');
        await expect(ticket).toBeFocused();
        await expect(ticket).toHaveValue('');
        await expect(ticket).toHaveAccessibleDescription('Remplace SHOP-482 sur ces 30 minutes.');
        // Le bloc n'est pas entouré : c'est la sélection qui reste dessinée.
        await expect(page.locator('.edit-ring')).toHaveCount(0);
        await expect(page.locator('.border-dashed')).toHaveCount(0);
        await expect(page.locator('.bg-sel-fill')).toHaveCount(1);

        await ticket.fill('OPS-12');
        await window.getByLabel('Commentaire').fill('Point client');
        await window.getByRole('button', { name: 'Enregistrer' }).click();
        await expect(window).toHaveCount(0);
        await expect(message(page)).toHaveText(/^SHOP-482 remplacé de 10:00 à 10:30/);
        expect(await savedDay(request, date)).toMatchObject([
            { start: '09:15', end: '09:30', ticket: 'OPS-12', comment: 'Daily' },
            { start: '09:30', end: '10:00', ticket: 'SHOP-482', comment: 'Mapping des colonnes' },
            { start: '10:00', end: '10:30', ticket: 'OPS-12', comment: 'Point client' },
            { start: '10:30', end: '11:15', ticket: 'SHOP-482', comment: 'Mapping des colonnes' },
            { start: '11:15', end: '11:45', ticket: 'SHOP-519' },
            { start: '12:30', end: '13:30', kind: 'pause' },
        ]);
        await expectGridMatchesBase(page, request, date);

        // Un seul Ctrl/⌘+Z rend le bloc entier, coupe comprise ; rétablir le recoupe.
        await page.keyboard.press('ControlOrMeta+Z');
        await expect(blocks(page)).toHaveCount(4);
        expect((await savedDay(request, date))[1]).toMatchObject({ start: '09:30', end: '11:15', ticket: 'SHOP-482' });
        await page.keyboard.press('ControlOrMeta+Shift+Z');
        await expect(blocks(page)).toHaveCount(6);
        await expectGridMatchesBase(page, request, date);

        // « Annuler » du message défait aussi le remplacement d'un coup.
        await clickSlot(page, '11:15');
        await clickSlot(page, '11:30', ['Shift']);
        await page.keyboard.press('Shift+F10');
        await page.keyboard.press('Enter');
        await expect(ticketWindow(page)).toBeVisible();
        await page.keyboard.type('OPS-13');
        await page.keyboard.press('Enter');
        await expect(message(page)).toHaveText(/^SHOP-519 remplacé de 11:15 à 11:45/);
        await message(page).getByRole('button', { name: 'Annuler' }).click();
        await expect(slot(page, '11:30')).toHaveText('11:30, SHOP-519, Reproduction');
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('une lettre tapée ouvre Nouveau ticket sur la sélection, la touche écrite dans le champ', async ({
        page,
        request,
    }) => {
        const date = day(72);
        await writeDay(request, date, MORNING);
        await open(page, date);
        const writes: string[] = [];
        page.on('request', (sent) => {
            if (sent.method() === 'PATCH') {
                writes.push(sent.url());
            }
        });

        // Tapé d'une traite : rien ne se perd ni ne s'écrit deux fois en passant à la fenêtre.
        await clickSlot(page, '10:45');
        await page.keyboard.type('ops-12');
        const window = ticketWindow(page);
        await expect(window).toContainText('de 10:45 à 11:00');
        await expect(window.getByLabel('Ticket')).toHaveValue('OPS-12');
        await expect(note(window)).toHaveText('Remplace SHOP-482 sur ces 15 minutes.');
        // Échap ferme sans rien écrire.
        await page.keyboard.press('Escape');
        await expect(window).toHaveCount(0);
        await expect(slots(page)).toBeFocused();
        await expect(slot(page, '10:45')).toHaveText('10:45, SHOP-482, Mapping des colonnes');

        // Un chiffre aussi, et sur des créneaux vides, sans rien à remplacer.
        await clickSlot(page, '15:00');
        await clickSlot(page, '15:15', ['Shift']);
        await page.keyboard.press('4');
        await expect(window.getByLabel('Ticket')).toHaveValue('4');
        await expect(note(window)).toHaveCount(0);
        await expect(page.locator('.border-dashed')).toHaveCount(1);
        await page.keyboard.press('Escape');

        // Un raccourci n'est pas une lettre tapée, ni une lettre sans sélection.
        await clickSlot(page, '09:15');
        await page.keyboard.press('ControlOrMeta+C');
        await page.keyboard.press('Escape');
        await expect(slots(page).getByRole('option', { selected: true })).toHaveCount(0);
        await page.keyboard.press('a');
        await expect(page.getByRole('dialog')).toHaveCount(0);

        // Le double-clic et Entrée gardent le bloc entier.
        await doubleClickSlot(page, '10:45');
        await expect(ticketWindow(page, 'Modifier le ticket')).toContainText('de 09:30 à 11:15');
        await page.keyboard.press('Escape');
        await clickSlot(page, '10:45');
        await page.keyboard.press('Enter');
        await expect(ticketWindow(page, 'Modifier le ticket')).toContainText('de 09:30 à 11:15');
        await page.keyboard.press('Escape');

        expect(writes).toHaveLength(0);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('n’écrit qu’une fois sur une Entrée répétée', async ({ page, request }) => {
        const date = day(73);
        await writeDay(request, date, MORNING);
        await open(page, date);
        const writes: string[] = [];
        page.on('request', (sent) => {
            if (sent.method() === 'PATCH') {
                writes.push(sent.url());
            }
        });

        await clickSlot(page, '10:00');
        await page.keyboard.type('OPS-12');
        await page.keyboard.down('Enter');
        await page.keyboard.down('Enter');
        await page.keyboard.down('Enter');
        await page.keyboard.up('Enter');
        await expect(ticketWindow(page)).toHaveCount(0);
        await expect(message(page)).toHaveText(/^SHOP-482 remplacé de 10:00 à 10:15/);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect(writes).toHaveLength(1);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('remplace aux bornes de la journée, 07:00 et 19:45, la fenêtre où il y a la place', async ({
        page,
        request,
    }) => {
        const date = day(74);
        await writeDay(request, date, [
            { start: '07:00', end: '07:30', ticket: 'OPS-1' },
            { start: '19:30', end: '20:00', ticket: 'OPS-2' },
        ]);
        await open(page, date);

        // À 07:00, pas de place au-dessus : la fenêtre passe dessous.
        await clickSlot(page, '07:00');
        await page.keyboard.type('SHOP-1');
        const window = ticketWindow(page);
        await expect(note(window)).toHaveText('Remplace OPS-1 sur ces 15 minutes.');
        const first = await slot(page, '07:00').boundingBox();
        expect((await window.boundingBox())?.y ?? 0).toBeGreaterThan(first?.y ?? Infinity);
        await page.keyboard.press('Enter');
        await expect(message(page)).toHaveText(/^OPS-1 remplacé de 07:00 à 07:15/);

        await clickSlot(page, '19:45');
        await page.keyboard.type('SHOP-2');
        await expect(note(window)).toHaveText('Remplace OPS-2 sur ces 15 minutes.');
        const last = await slot(page, '19:45').boundingBox();
        const box = await window.boundingBox();
        expect((box?.y ?? Infinity) + (box?.height ?? 0)).toBeLessThan(last?.y ?? 0);
        await page.keyboard.press('Enter');
        await expect(message(page)).toHaveText(/^OPS-2 remplacé de 19:45 à 20:00/);

        expect(await savedDay(request, date)).toMatchObject([
            { start: '07:00', end: '07:15', ticket: 'SHOP-1' },
            { start: '07:15', end: '07:30', ticket: 'OPS-1' },
            { start: '19:30', end: '19:45', ticket: 'OPS-2' },
            { start: '19:45', end: '20:00', ticket: 'SHOP-2' },
        ]);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('remplace une sélection en plusieurs morceaux, ticket et pause, et l’annule d’un coup', async ({
        page,
        request,
    }) => {
        const date = day(75);
        await writeDay(request, date, MORNING);
        await open(page, date);

        await clickSlot(page, '09:45');
        await clickSlot(page, '12:45', ['ControlOrMeta']);
        await rightClickSlot(page, '12:45');
        await page.getByRole('menuitem', { name: 'Nouveau ticket…' }).click();
        const window = ticketWindow(page);
        await expect(window).toContainText(/, 2 créneaux, 0h30/);
        await expect(note(window)).toHaveText('Remplace SHOP-482 et la pause sur ces 30 minutes.');
        await expect(page.locator('.bg-sel-fill')).toHaveCount(2);
        await window.getByLabel('Ticket').fill('OPS-5');
        await page.keyboard.press('Enter');
        await expect(message(page)).toHaveText(/^2 créneaux remplacés/);
        await expect(slot(page, '09:45')).toHaveText('09:45, OPS-5');
        await expect(slot(page, '12:45')).toHaveText('12:45, OPS-5');
        await expectGridMatchesBase(page, request, date);

        await page.keyboard.press('ControlOrMeta+Z');
        await expect(slot(page, '09:45')).toHaveText('09:45, SHOP-482, Mapping des colonnes');
        await expect(slot(page, '12:45')).toHaveText('12:45, pause');
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('« Pause » convertit la sélection, et le dit', async ({ page, request }) => {
        const date = day(76);
        await writeDay(request, date, MORNING);
        await open(page, date);

        await clickSlot(page, '11:15');
        await page.keyboard.type('O');
        await ticketWindow(page).getByRole('button', { name: 'Pause' }).click();
        await expect(message(page)).toHaveText(/^SHOP-519 converti en pause/);
        await expect(slot(page, '11:15')).toHaveText('11:15, pause');
        await expect(slot(page, '11:30')).toHaveText('11:30, SHOP-519, Reproduction');
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });
});

test.describe('modifier la sélection', () => {
    function note(window: Locator): Locator {
        return window.getByText(/^Modifie /);
    }

    test('au menu : la fenêtre remplie, le commentaire de la sélection seule changé, et Ctrl/⌘+Z qui le défait', async ({
        page,
        request,
    }) => {
        const date = day(9);
        await writeDay(request, date, MORNING);
        await open(page, date);

        await clickSlot(page, '10:00');
        await clickSlot(page, '10:15', ['Shift']);
        await rightClickSlot(page, '10:00');
        const item = menu(page).getByRole('menuitem', { name: 'Modifier la sélection…' });
        await expect(item).not.toHaveAttribute('aria-disabled', 'true');
        await expect(item).toHaveAttribute('aria-keyshortcuts', 'F2');
        await expect(item.locator('kbd')).toHaveText('F2');
        await item.click();

        const window = ticketWindow(page, 'Modifier la sélection');
        await expect(window).toContainText('Mercredi 17 septembre de 10:00 à 10:30');
        // Le curseur va au champ Ticket, comme à la création et au double-clic, et la phrase
        // sous les champs le décrit.
        const ticket = window.getByLabel('Ticket');
        await expect(ticket).toBeFocused();
        await expect(ticket).toHaveValue('SHOP-482');
        await expect(window.getByLabel('Commentaire')).toHaveValue('Mapping des colonnes');
        await expect(note(window)).toHaveText('Modifie SHOP-482 sur ces 30 minutes seulement.');
        await expect(ticket).toHaveAccessibleDescription(/^Modifie SHOP-482 sur ces 30 minutes seulement\./);
        // La sélection reste dessinée dessous, le bloc n'est pas entouré.
        await expect(page.locator('.edit-ring')).toHaveCount(0);
        await expect(page.locator('.bg-sel-fill')).toHaveCount(1);
        expect(await buttonNames(window)).toEqual([
            'Fermer',
            'Effacer',
            'Convertir en pause',
            'Annuler',
            'Enregistrer',
        ]);

        await selectionComment(page).fill('Point client');
        await page.keyboard.press('Enter');
        await expect(window).toHaveCount(0);
        await expect(message(page)).toHaveText(/^SHOP-482 modifié de 10:00 à 10:30/);
        expect(await savedDay(request, date)).toMatchObject([
            { start: '09:15', end: '09:30', ticket: 'OPS-12', comment: 'Daily' },
            { start: '09:30', end: '10:00', ticket: 'SHOP-482', comment: 'Mapping des colonnes' },
            { start: '10:00', end: '10:30', ticket: 'SHOP-482', comment: 'Point client' },
            { start: '10:30', end: '11:15', ticket: 'SHOP-482', comment: 'Mapping des colonnes' },
            { start: '11:15', end: '11:45', ticket: 'SHOP-519' },
            { start: '12:30', end: '13:30', kind: 'pause' },
        ]);
        await expectGridMatchesBase(page, request, date);

        // Un seul Ctrl/⌘+Z rend le bloc entier ; rétablir le recoupe.
        await page.keyboard.press('ControlOrMeta+Z');
        await expect(blocks(page)).toHaveCount(4);
        await expectGridMatchesBase(page, request, date);
        await page.keyboard.press('ControlOrMeta+Shift+Z');
        await expect(blocks(page)).toHaveCount(6);
        await expectGridMatchesBase(page, request, date);

        // « Annuler » du message le défait aussi.
        await clickSlot(page, '10:45');
        await page.keyboard.press('F2');
        await selectionComment(page).fill('Relecture');
        await page.keyboard.press('Enter');
        await expect(message(page)).toHaveText(/^SHOP-482 modifié de 10:45 à 11:00/);
        await message(page).getByRole('button', { name: 'Annuler' }).click();
        await expect(slot(page, '10:45')).toHaveText('10:45, SHOP-482, Mapping des colonnes');
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('à F2, s’ouvre au milieu de la colonne ; ailleurs que sur un ticket et un commentaire, dit pourquoi rien ne s’ouvre', async ({
        page,
        request,
    }) => {
        const date = day(15);
        await writeDay(request, date, [
            ...MORNING,
            { start: '14:00', end: '14:30', ticket: 'SHOP-482', comment: 'Tests' },
        ]);
        await open(page, date);
        const writes: string[] = [];
        page.on('request', (sent) => {
            if (sent.method() === 'PATCH') {
                writes.push(sent.url());
            }
        });

        await clickSlot(page, '10:30');
        await page.mouse.move(0, 0);
        await page.keyboard.press('F2');
        const window = ticketWindow(page, 'Modifier la sélection');
        await expect(window).toContainText('de 10:30 à 10:45');
        await expect(window.getByLabel('Ticket')).toBeFocused();
        // Au clavier, la fenêtre se pose au milieu de la colonne des blocs.
        const lane = await page.getByRole('list', { name: 'Saisies du jour' }).boundingBox();
        const box = await window.boundingBox();
        expect(
            Math.abs((box?.x ?? 0) + (box?.width ?? 0) / 2 - ((lane?.x ?? 0) + (lane?.width ?? 0) / 2)),
        ).toBeLessThan(2);
        // Échap ferme sans rien écrire.
        await page.keyboard.press('Escape');
        await expect(window).toHaveCount(0);
        await expect(slots(page)).toBeFocused();

        const refusal = "Rien ne s'ouvre, la sélection ne porte pas un seul ticket avec un seul commentaire.";
        for (const [from, to, modifier] of [
            // Deux tickets, un créneau vide, une pause, le même ticket avec deux commentaires.
            ['11:00', '11:15', 'Shift'],
            ['11:30', '11:45', 'Shift'],
            ['12:30', '12:30', 'Shift'],
            ['11:00', '14:00', 'ControlOrMeta'],
        ] as const) {
            await clickSlot(page, from);
            await clickSlot(page, to, [modifier]);
            await page.keyboard.press('F2');
            await expect(page.getByRole('dialog')).toHaveCount(0);
            await expect(message(page)).toHaveText(new RegExp(`^${refusal}`));
            await expect(message(page).getByRole('button', { name: 'Annuler' })).toHaveCount(0);
            // Le menu le grise, et F2 n'y fait rien.
            await rightClickSlot(page, from);
            await expect(menu(page).getByRole('menuitem', { name: 'Modifier la sélection…' })).toHaveAttribute(
                'aria-disabled',
                'true',
            );
            await page.keyboard.press('F2');
            await expect(menu(page)).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(menu(page)).toHaveCount(0);
        }

        // Sans sélection, F2 ne dit rien. Le menu a déjà emporté le message.
        await expect(message(page)).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(slots(page).getByRole('option', { selected: true })).toHaveCount(0);
        await page.keyboard.press('F2');
        await expect(message(page)).toHaveCount(0);
        await expect(page.getByRole('dialog')).toHaveCount(0);

        // Menu ouvert sur un seul ticket, F2 fait le choix et le menu se ferme.
        await clickSlot(page, '14:15');
        await rightClickSlot(page, '14:15');
        await page.keyboard.press('F2');
        await expect(menu(page)).toHaveCount(0);
        await expect(ticketWindow(page, 'Modifier la sélection')).toBeVisible();
        await page.keyboard.press('Escape');

        // Le double-clic et Entrée modifient toujours le bloc entier.
        await doubleClickSlot(page, '10:30');
        await expect(ticketWindow(page, 'Modifier le ticket')).toContainText('de 09:30 à 11:15');
        await page.keyboard.press('Escape');
        await clickSlot(page, '10:30');
        await page.keyboard.press('Enter');
        await expect(ticketWindow(page, 'Modifier le ticket')).toContainText('de 09:30 à 11:15');
        await page.keyboard.press('Escape');

        expect(writes).toHaveLength(0);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('n’enregistre rien quand rien n’a changé, et une seule fois sur une Entrée répétée', async ({
        page,
        request,
    }) => {
        const date = day(16);
        await writeDay(request, date, MORNING);
        await open(page, date);
        const writes: string[] = [];
        page.on('request', (sent) => {
            if (sent.method() === 'PATCH') {
                writes.push(sent.url());
            }
        });

        // Rien de changé : Enregistrer, Entrée ou un clic à côté ferment sans rien écrire ni dire.
        // Fermée, la fenêtre rend le curseur à la grille au tour suivant : F2 l'attend.
        await clickSlot(page, '10:00');
        await page.keyboard.press('F2');
        const window = ticketWindow(page, 'Modifier la sélection');
        await window.getByRole('button', { name: 'Enregistrer' }).click();
        await expect(window).toHaveCount(0);
        await expect(slots(page)).toBeFocused();
        await page.keyboard.press('F2');
        await expect(window.getByLabel('Ticket')).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(window).toHaveCount(0);
        await expect(slots(page)).toBeFocused();
        await page.keyboard.press('F2');
        await window.getByLabel('Commentaire').fill('  Mapping   des colonnes ');
        await page.mouse.click(5, 5);
        await expect(window).toHaveCount(0);
        await expect(message(page)).toHaveCount(0);
        expect(writes).toHaveLength(0);

        await clickSlot(page, '10:00');
        await page.keyboard.press('F2');
        await selectionComment(page).fill('Revue');
        await page.keyboard.down('Enter');
        await page.keyboard.down('Enter');
        await page.keyboard.down('Enter');
        await page.keyboard.up('Enter');
        await expect(window).toHaveCount(0);
        await expect(message(page)).toHaveText(/^SHOP-482 modifié de 10:00 à 10:15/);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect(writes).toHaveLength(1);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('efface ou convertit la sélection seule, remplace par un autre ticket, et le dit', async ({
        page,
        request,
    }) => {
        const date = day(17);
        await writeDay(request, date, MORNING);
        await open(page, date);

        // La corbeille, nommée « Effacer » comme dans le menu.
        await clickSlot(page, '10:00');
        await page.keyboard.press('F2');
        const window = ticketWindow(page, 'Modifier la sélection');
        const trash = window.getByRole('button', { name: 'Effacer' });
        await glideTo(page, trash);
        await expect(page.getByRole('tooltip').filter({ hasText: 'Effacer' })).toBeVisible();
        await trash.click();
        await expect(message(page)).toHaveText(/^SHOP-482 effacé/);
        await expect(slot(page, '10:00')).toHaveText('10:00, vide');
        await expect(slot(page, '09:45')).toHaveText('09:45, SHOP-482, Mapping des colonnes');
        await expect(slot(page, '10:15')).toHaveText('10:15, SHOP-482, Mapping des colonnes');
        await expectGridMatchesBase(page, request, date);

        // Le ticket vidé l'efface aussi.
        await clickSlot(page, '10:15');
        await page.keyboard.press('F2');
        await window.getByLabel('Ticket').fill('');
        await window.getByLabel('Ticket').press('Enter');
        await expect(message(page)).toHaveText(/^SHOP-482 effacé/);
        await expect(slot(page, '10:15')).toHaveText('10:15, vide');

        // La tasse.
        await clickSlot(page, '10:30');
        await page.keyboard.press('F2');
        await window.getByRole('button', { name: 'Convertir en pause' }).click();
        await expect(message(page)).toHaveText(/^SHOP-482 converti en pause/);
        await expect(slot(page, '10:30')).toHaveText('10:30, pause');

        // Un autre ticket remplace la sélection, comme Nouveau ticket.
        await clickSlot(page, '10:45');
        await page.keyboard.press('F2');
        await window.getByLabel('Ticket').fill('OPS-12');
        await window.getByLabel('Ticket').press('Enter');
        await expect(message(page)).toHaveText(/^SHOP-482 remplacé de 10:45 à 11:00/);
        await expect(slot(page, '10:45')).toHaveText('10:45, OPS-12, Mapping des colonnes');
        await expect(slot(page, '11:00')).toHaveText('11:00, SHOP-482, Mapping des colonnes');
        expect(await savedDay(request, date)).toMatchObject([
            { start: '09:15', end: '09:30', ticket: 'OPS-12', comment: 'Daily' },
            { start: '09:30', end: '10:00', ticket: 'SHOP-482', comment: 'Mapping des colonnes' },
            { start: '10:30', end: '10:45', kind: 'pause' },
            { start: '10:45', end: '11:00', ticket: 'OPS-12', comment: 'Mapping des colonnes' },
            { start: '11:00', end: '11:15', ticket: 'SHOP-482', comment: 'Mapping des colonnes' },
            { start: '11:15', end: '11:45', ticket: 'SHOP-519' },
            { start: '12:30', end: '13:30', kind: 'pause' },
        ]);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('sur un bloc entier, fait ce que ferait Modifier le ticket, sans phrase ni message', async ({
        page,
        request,
    }) => {
        const date = day(18);
        await writeDay(request, date, MORNING);
        await open(page, date);

        await clickSlot(page, '11:15');
        await clickSlot(page, '11:30', ['Shift']);
        await page.keyboard.press('F2');
        const window = ticketWindow(page, 'Modifier la sélection');
        await expect(window.getByLabel('Commentaire')).toHaveValue('Reproduction');
        await expect(note(window)).toHaveCount(0);
        await selectionComment(page).fill('Correctif');
        await page.keyboard.press('Enter');
        await expect(window).toHaveCount(0);
        await expect(message(page)).toHaveCount(0);
        await expect(blocks(page).filter({ hasText: 'SHOP-519' })).toHaveText([/De 11:15 à 11:45.*Correctif/]);
        await expectGridMatchesBase(page, request, date);

        // Deux blocs entiers, en morceaux : de même.
        await writeDay(request, date, [
            { start: '09:00', end: '09:15', ticket: 'OPS-12', comment: 'Daily' },
            { start: '14:00', end: '14:15', ticket: 'OPS-12', comment: 'Daily' },
        ]);
        await page.reload();
        await clickSlot(page, '09:00');
        await clickSlot(page, '14:00', ['ControlOrMeta']);
        await page.keyboard.press('F2');
        await expect(window).toContainText(/, 2 créneaux, 0h30/);
        await expect(note(window)).toHaveCount(0);
        await page.keyboard.press('Escape');
        await clearDay(request, date);
    });

    test('modifie une sélection en plusieurs morceaux d’un coup, et l’annule d’un coup', async ({ page, request }) => {
        const date = day(39);
        await writeDay(request, date, MORNING);
        await open(page, date);

        await clickSlot(page, '09:45');
        await clickSlot(page, '10:45', ['ControlOrMeta']);
        await rightClickSlot(page, '10:45');
        await menu(page).getByRole('menuitem', { name: 'Modifier la sélection…' }).click();
        const window = ticketWindow(page, 'Modifier la sélection');
        await expect(window).toContainText(/, 2 créneaux, 0h30/);
        await expect(note(window)).toHaveText('Modifie SHOP-482 sur ces 30 minutes seulement.');
        await expect(page.locator('.bg-sel-fill')).toHaveCount(2);
        await selectionComment(page).fill('Relecture');
        await page.keyboard.press('Enter');
        await expect(message(page)).toHaveText(/^SHOP-482 modifié/);
        await expect(slot(page, '09:45')).toHaveText('09:45, SHOP-482, Relecture');
        await expect(slot(page, '10:00')).toHaveText('10:00, SHOP-482, Mapping des colonnes');
        await expect(slot(page, '10:45')).toHaveText('10:45, SHOP-482, Relecture');
        await expectGridMatchesBase(page, request, date);

        await page.keyboard.press('ControlOrMeta+Z');
        await expect(blocks(page)).toHaveCount(4);
        await expect(slot(page, '09:45')).toHaveText('09:45, SHOP-482, Mapping des colonnes');
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('modifie aux bornes de la journée, 07:00 et 19:45, la fenêtre où il y a la place', async ({
        page,
        request,
    }) => {
        const date = day(46);
        await writeDay(request, date, [
            { start: '07:00', end: '07:30', ticket: 'OPS-1', comment: 'Matin' },
            { start: '19:30', end: '20:00', ticket: 'OPS-2', comment: 'Soir' },
        ]);
        await open(page, date);

        await clickSlot(page, '07:00');
        await page.keyboard.press('F2');
        const window = ticketWindow(page, 'Modifier la sélection');
        const first = await slot(page, '07:00').boundingBox();
        expect((await window.boundingBox())?.y ?? 0).toBeGreaterThan(first?.y ?? Infinity);
        await selectionComment(page).fill('Tôt');
        await page.keyboard.press('Enter');
        await expect(message(page)).toHaveText(/^OPS-1 modifié de 07:00 à 07:15/);

        await clickSlot(page, '19:45');
        await page.keyboard.press('F2');
        const last = await slot(page, '19:45').boundingBox();
        const box = await window.boundingBox();
        expect((box?.y ?? Infinity) + (box?.height ?? 0)).toBeLessThan(last?.y ?? 0);
        await selectionComment(page).fill('Tard');
        await page.keyboard.press('Enter');
        await expect(message(page)).toHaveText(/^OPS-2 modifié de 19:45 à 20:00/);

        expect(await savedDay(request, date)).toMatchObject([
            { start: '07:00', end: '07:15', ticket: 'OPS-1', comment: 'Tôt' },
            { start: '07:15', end: '07:30', ticket: 'OPS-1', comment: 'Matin' },
            { start: '19:30', end: '19:45', ticket: 'OPS-2', comment: 'Soir' },
            { start: '19:45', end: '20:00', ticket: 'OPS-2', comment: 'Tard' },
        ]);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });
});

test.describe('une fenêtre ouverte, un autre geste sur la grille', () => {
    test('un glisser ou un double-clic enregistrent d’abord la fenêtre ouverte', async ({ page, request }) => {
        const date = day(85);
        await writeDay(request, date, [{ start: '09:30', end: '10:30', ticket: 'SHOP-482', comment: 'Mapping' }]);
        await open(page, date);

        // Le glisser est un clic à côté : la fenêtre s'enregistre, et il sélectionne sa plage
        // sans en ouvrir d'autre.
        await doubleClickSlot(page, '12:00');
        await ticketWindow(page).getByLabel('Ticket').fill('OPS-7');
        await ticketWindow(page).getByLabel('Commentaire').fill('Tapé avant');
        await dragSlots(page, '14:00', '14:45');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(blocks(page).filter({ hasText: 'OPS-7' })).toHaveText([/De 12:00 à 12:15/]);
        await expect(slots(page).getByRole('option', { selected: true })).toHaveText([
            /^14:00/,
            /^14:15/,
            /^14:30/,
            /^14:45/,
        ]);

        await doubleClickSlot(page, '09:45');
        await ticketWindow(page, 'Modifier le ticket').getByLabel('Commentaire').fill('Mapping revu');
        await doubleClickSlot(page, '16:00', NEAR_LEFT);
        await expect(ticketWindow(page)).toContainText('de 16:00 à 16:15');
        await page.keyboard.press('Escape');

        expect(await savedDay(request, date)).toMatchObject([
            { start: '09:30', end: '10:30', ticket: 'SHOP-482', comment: 'Mapping revu' },
            { start: '12:00', end: '12:15', ticket: 'OPS-7', comment: 'Tapé avant' },
        ]);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('une lettre tapée après un glisser, la fenêtre d’avant encore en route, écrit le ticket entier', async ({
        page,
        request,
    }) => {
        const date = day(98);
        await writeDay(request, date, []);
        await open(page, date);
        // Jira tarde : la fenêtre ouverte attend sa réponse pour s'enregistrer, et celle que
        // la première lettre demande attend qu'elle ait fini.
        await page.route('**/api/tickets/**', async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 900));
            await route.fallback();
        });

        await doubleClickSlot(page, '12:00');
        await ticketWindow(page).getByLabel('Ticket').fill('ESSAI-601');
        await dragSlots(page, '14:00', '14:45');
        // Tapé pendant l'attente, tiret, faute et Retour arrière compris : tout revient au
        // champ, et rien d'autre ne touche la grille.
        await page.keyboard.type('shop-48x', { delay: 40 });
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Delete');
        await page.keyboard.type('2', { delay: 40 });
        const window = ticketWindow(page);
        await expect(window).toContainText('de 14:00 à 15:00');
        await expect(window.getByLabel('Ticket')).toHaveValue('SHOP-482');
        await window.getByLabel('Ticket').press('Enter');
        await expect(window).toHaveCount(0);

        expect(await savedDay(request, date)).toMatchObject([
            { start: '12:00', end: '12:15', ticket: 'ESSAI-601' },
            { start: '14:00', end: '15:00', ticket: 'SHOP-482' },
        ]);
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('Échap pendant un glisser n’abandonne que le glisser : la fenêtre ouverte garde sa saisie', async ({
        page,
        request,
    }) => {
        const date = day(99);
        await writeDay(request, date, []);
        await open(page, date);

        await doubleClickSlot(page, '12:00');
        const window = ticketWindow(page);
        await window.getByLabel('Ticket').fill('OPS-7');
        await window.getByLabel('Commentaire').fill('Tapé avant');
        // Les deux bouts se mesurent une fois la grille placée, comme dans dragSlots.
        await slot(page, '14:00').evaluate((option) => {
            option.scrollIntoView({ block: 'center' });
        });
        const from = await slotPoint(page, '14:00');
        const to = await slotPoint(page, '14:45');
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 6 });
        await page.keyboard.press('Escape');
        await expect(window).toBeVisible();
        await expect(window.getByLabel('Ticket')).toHaveValue('OPS-7');
        await expect(window.getByLabel('Commentaire')).toHaveValue('Tapé avant');
        await page.mouse.up();

        // Échap a abandonné le glisser : le relâcher n'est plus qu'un clic à côté, qui enregistre.
        await expect(window).toHaveCount(0);
        await expect(slots(page).getByRole('option', { selected: true })).toHaveText([/^14:00/]);
        expect(await savedDay(request, date)).toMatchObject([
            { start: '12:00', end: '12:15', ticket: 'OPS-7', comment: 'Tapé avant' },
        ]);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('le message d’un geste s’en va quand une fenêtre ou le menu s’ouvre', async ({ page, request }) => {
        const date = day(86);
        await writeDay(request, date, MORNING);
        await open(page, date);

        await clickSlot(page, '11:15');
        await page.keyboard.press('Delete');
        await expect(message(page)).toHaveText(/SHOP-519 effacé/);
        await doubleClickSlot(page, '16:00');
        await expect(ticketWindow(page)).toBeVisible();
        await expect(message(page)).toHaveCount(0);
        await page.keyboard.press('Escape');

        await clickSlot(page, '09:15');
        await page.keyboard.press('Delete');
        await expect(message(page)).toHaveText(/OPS-12 effacé/);
        await rightClickSlot(page, '16:00');
        await expect(page.getByRole('menu')).toBeVisible();
        await expect(message(page)).toHaveCount(0);
        await page.keyboard.press('Escape');
        // Ctrl/⌘+Z défait toujours le dernier geste.
        await page.keyboard.press('ControlOrMeta+Z');
        await expect(slot(page, '09:15')).toHaveText('09:15, OPS-12, Daily');
        await clearDay(request, date);
    });
});

test.describe('le message d’annulation', () => {
    test('reste 8 secondes, et tant que le pointeur est dessus', async ({ page, request }) => {
        const date = day(30);
        await writeDay(request, date, MORNING);
        // L'heure ne passe qu'à la main : celle qui s'écoulerait entre deux lignes compterait dans les 8 secondes.
        await freezeTime(page, day(31), '10:00');
        await open(page, date);

        await clickSlot(page, '09:15');
        await page.keyboard.press('Delete');
        await expect(message(page)).toHaveText(/OPS-12 effacé/);
        // Le raccourci est dans l'infobulle d'« Annuler », qui s'ouvre aussi au focus.
        await message(page).getByRole('button', { name: 'Annuler' }).focus();
        await expect(page.getByRole('tooltip')).toHaveText(/^Annuler \((Ctrl\+Z|⌘Z)\)$/);
        await page.evaluate(() => {
            (document.activeElement as HTMLElement | null)?.blur();
        });
        await page.clock.runFor(7_000);
        await expect(message(page)).toBeVisible();
        await message(page).hover();
        await page.clock.runFor(5_000);
        await expect(message(page)).toBeVisible();
        await page.mouse.move(0, 0);
        await page.clock.runFor(8_100);
        await expect(message(page)).toHaveCount(0);

        // Sa croix le ferme ; le geste suivant le retire.
        await clickSlot(page, '10:00');
        await page.keyboard.press('Delete');
        await message(page).getByRole('button', { name: 'Fermer le message' }).click();
        await expect(message(page)).toHaveCount(0);
        await page.keyboard.press('ControlOrMeta+Z');
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });
});

test.describe('un onglet resté ouvert pendant qu’on changeait la journée ailleurs', () => {
    test.use({ expectedErrors: [refusedWith(409)] });

    test('n’écrit rien, le dit, et remet la grille à jour', async ({ page, request }) => {
        const date = day(35);
        await writeDay(request, date, MORNING);
        await open(page, date);
        await writeDay(request, date, [{ start: '09:15', end: '09:30', ticket: 'OPS-99', comment: 'Ailleurs' }]);

        await clickSlot(page, '11:15');
        await page.keyboard.press('Delete');
        await expect(message(page)).toHaveText("La journée a changé entre-temps. Rien n'a été modifié.");
        await expect(blocks(page)).toHaveText([/OPS-99/]);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('ne colle rien sur un glisser, le dit, puis colle en disant ce qu’il remplace désormais', async ({
        page,
        request,
    }) => {
        const date = day(95);
        await writeDay(request, date, MORNING);
        await open(page, date);
        await clickSlot(page, '11:15');
        await page.keyboard.press('ControlOrMeta+C');
        // Un autre onglet pose OPS-99 au milieu de la plage.
        const elsewhere = [...MORNING, { start: '14:15', end: '14:30', ticket: 'OPS-99', comment: 'Ailleurs' }];
        await writeDay(request, date, elsewhere);

        await dragSlots(page, '14:00', '14:45');
        await page.keyboard.press('ControlOrMeta+V');
        await expect(message(page)).toHaveText("La journée a changé entre-temps. Rien n'a été modifié.");
        await expect(blocks(page).filter({ hasText: 'OPS-99' })).toHaveText([/De 14:15 à 14:30/]);
        await expect(slots(page).getByRole('option', { selected: true })).toHaveCount(4);
        expect(await savedDay(request, date)).toMatchObject(elsewhere);
        await expectGridMatchesBase(page, request, date);

        // Collé de nouveau, il remplace ce que l'autre onglet a posé, et le dit.
        await page.keyboard.press('ControlOrMeta+V');
        await expect(message(page)).toHaveText(/^OPS-99 remplacé/);
        await expect(blocks(page).filter({ hasText: 'OPS-99' })).toHaveCount(0);
        await expect(blocks(page).filter({ hasText: 'SHOP-519' })).toHaveText([/De 11:15 à 11:45/, /De 14:00 à 15:00/]);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('garde la fenêtre ouverte et ce qui a été tapé', async ({ page, request }) => {
        const date = day(36);
        await writeDay(request, date, MORNING);
        await open(page, date);
        await doubleClickSlot(page, '15:00');
        await ticketWindow(page).getByLabel('Ticket').fill('OPS-7');
        await writeDay(request, date, []);

        await ticketWindow(page).getByLabel('Ticket').press('Enter');
        await expect(ticketWindow(page)).toContainText(
            'La journée a changé entre-temps. Vérifiez, puis enregistrez de nouveau.',
        );
        await expect(ticketWindow(page).getByLabel('Ticket')).toHaveValue('OPS-7');
        await expect(blocks(page)).toHaveCount(0);

        await ticketWindow(page).getByLabel('Ticket').press('Enter');
        await expect(ticketWindow(page)).toHaveCount(0);
        await expect(blocks(page)).toHaveText([/OPS-7/]);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('garde Nouveau ticket ouvert sur la sélection, et dit ce qu’elle remplace désormais', async ({
        page,
        request,
    }) => {
        const date = day(77);
        await writeDay(request, date, MORNING);
        await open(page, date);
        await clickSlot(page, '10:00');
        await clickSlot(page, '10:15', ['Shift']);
        await page.keyboard.type('OPS-12');
        const window = ticketWindow(page);
        await expect(window.getByText(/^Remplace /)).toHaveText('Remplace SHOP-482 sur ces 30 minutes.');
        await writeDay(request, date, [{ start: '10:00', end: '10:15', ticket: 'OPS-99', comment: 'Ailleurs' }]);

        await window.getByLabel('Ticket').press('Enter');
        await expect(window).toContainText('La journée a changé entre-temps. Vérifiez, puis enregistrez de nouveau.');
        await expect(window.getByLabel('Ticket')).toHaveValue('OPS-12');
        await expect(window.getByText(/^Remplace /)).toHaveText('Remplace OPS-99 sur 15 minutes.');
        await expect(blocks(page)).toHaveText([/OPS-99/]);

        await window.getByLabel('Ticket').press('Enter');
        await expect(window).toHaveCount(0);
        await expect(message(page)).toHaveText(/^OPS-99 remplacé de 10:00 à 10:15/);
        expect(await savedDay(request, date)).toMatchObject([{ start: '10:00', end: '10:30', ticket: 'OPS-12' }]);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('suit dans Modifier le ticket le bloc tel qu’il est désormais, sans écraser l’autre onglet', async ({
        page,
        request,
    }) => {
        const date = day(82);
        await writeDay(request, date, [{ start: '09:30', end: '11:15', ticket: 'SHOP-482', comment: 'Mapping' }]);
        await open(page, date);
        await doubleClickSlot(page, '10:00');
        const window = ticketWindow(page, 'Modifier le ticket');
        await expect(window).toContainText('de 09:30 à 11:15');
        await window.getByLabel('Commentaire').fill('Mapping revu');
        // L'autre onglet raccourcit le bloc et pose OPS-1 derrière.
        await writeDay(request, date, [
            { start: '09:30', end: '10:30', ticket: 'SHOP-482', comment: 'Mapping' },
            { start: '10:30', end: '11:15', ticket: 'OPS-1', comment: 'Autre onglet' },
        ]);

        await window.getByLabel('Commentaire').press('Enter');
        await expect(window).toContainText('La journée a changé entre-temps. Vérifiez, puis enregistrez de nouveau.');
        await expect(window).toContainText('de 09:30 à 10:30');
        await expect(window.getByLabel('Commentaire')).toHaveValue('Mapping revu');

        await window.getByLabel('Commentaire').press('Enter');
        await expect(window).toHaveCount(0);
        expect(await savedDay(request, date)).toMatchObject([
            { start: '09:30', end: '10:30', ticket: 'SHOP-482', comment: 'Mapping revu' },
            { start: '10:30', end: '11:15', ticket: 'OPS-1', comment: 'Autre onglet' },
        ]);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('change Modifier le ticket en Nouveau ticket quand le bloc a été remplacé ailleurs, et le dit', async ({
        page,
        request,
    }) => {
        const date = day(83);
        await writeDay(request, date, [{ start: '09:30', end: '10:30', ticket: 'SHOP-482', comment: 'Mapping' }]);
        await open(page, date);
        await doubleClickSlot(page, '10:00');
        await ticketWindow(page, 'Modifier le ticket').getByLabel('Commentaire').fill('Mapping revu');
        await writeDay(request, date, [{ start: '09:30', end: '10:30', ticket: 'OPS-1', comment: 'Autre onglet' }]);

        await page.keyboard.press('Enter');
        const window = ticketWindow(page);
        await expect(window).toContainText('La journée a changé entre-temps. Vérifiez, puis enregistrez de nouveau.');
        await expect(window.getByText(/^Remplace /)).toHaveText('Remplace OPS-1 sur ces 60 minutes.');
        await expect(window.getByLabel('Ticket')).toHaveValue('SHOP-482');

        await window.getByLabel('Commentaire').press('Enter');
        await expect(window).toHaveCount(0);
        await expect(message(page)).toHaveText(/^OPS-1 remplacé de 09:30 à 10:30/);
        await page.keyboard.press('ControlOrMeta+Z');
        await expect(slot(page, '09:30')).toHaveText('09:30, OPS-1, Autre onglet');
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('passe Modifier la sélection en Nouveau ticket quand la sélection a changé ailleurs, et le dit', async ({
        page,
        request,
    }) => {
        const date = day(49);
        await writeDay(request, date, MORNING);
        await open(page, date);
        await clickSlot(page, '10:00');
        await clickSlot(page, '10:15', ['Shift']);
        await page.keyboard.press('F2');
        await selectionComment(page).fill('Point client');
        // L'autre onglet pose OPS-99 sur 10:00.
        await writeDay(request, date, [
            { start: '09:30', end: '10:00', ticket: 'SHOP-482', comment: 'Mapping des colonnes' },
            { start: '10:00', end: '10:15', ticket: 'OPS-99', comment: 'Ailleurs' },
            { start: '10:15', end: '11:15', ticket: 'SHOP-482', comment: 'Mapping des colonnes' },
        ]);

        await page.keyboard.press('Enter');
        const window = ticketWindow(page);
        await expect(window).toContainText('La journée a changé entre-temps. Vérifiez, puis enregistrez de nouveau.');
        await expect(window.getByText(/^Remplace /)).toHaveText('Remplace 2 tickets sur ces 30 minutes.');
        await expect(window.getByLabel('Ticket')).toHaveValue('SHOP-482');
        await expect(window.getByLabel('Commentaire')).toHaveValue('Point client');
        await expect(blocks(page).filter({ hasText: 'OPS-99' })).toHaveCount(1);

        await window.getByLabel('Commentaire').press('Enter');
        await expect(window).toHaveCount(0);
        expect(await savedDay(request, date)).toMatchObject([
            { start: '09:30', end: '10:00', ticket: 'SHOP-482', comment: 'Mapping des colonnes' },
            { start: '10:00', end: '10:30', ticket: 'SHOP-482', comment: 'Point client' },
            { start: '10:30', end: '11:15', ticket: 'SHOP-482', comment: 'Mapping des colonnes' },
        ]);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('garde Modifier la sélection quand seul le bloc a changé ailleurs, sans plus rien dire de lui', async ({
        page,
        request,
    }) => {
        const date = day(53);
        await writeDay(request, date, MORNING);
        await open(page, date);
        await clickSlot(page, '10:00');
        await clickSlot(page, '10:15', ['Shift']);
        await page.keyboard.press('F2');
        const window = ticketWindow(page, 'Modifier la sélection');
        await expect(window.getByText(/^Modifie /)).toBeVisible();
        await selectionComment(page).fill('Point client');
        // L'autre onglet ne laisse de SHOP-482 que la sélection.
        await writeDay(request, date, [
            { start: '10:00', end: '10:30', ticket: 'SHOP-482', comment: 'Mapping des colonnes' },
        ]);

        await page.keyboard.press('Enter');
        await expect(window).toContainText('La journée a changé entre-temps. Vérifiez, puis enregistrez de nouveau.');
        await expect(window.getByText(/^Modifie /)).toHaveCount(0);
        await expect(window.getByLabel('Commentaire')).toHaveValue('Point client');

        await window.getByLabel('Commentaire').press('Enter');
        await expect(window).toHaveCount(0);
        await expect(message(page)).toHaveCount(0);
        expect(await savedDay(request, date)).toMatchObject([
            { start: '10:00', end: '10:30', ticket: 'SHOP-482', comment: 'Point client' },
        ]);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });

    test('garde la sélection sur la fenêtre refusée, et Entrée l’enregistre de nouveau', async ({ page, request }) => {
        const date = day(84);
        await writeDay(request, date, [{ start: '09:30', end: '10:00', ticket: 'SHOP-482' }]);
        await open(page, date);
        await doubleClickSlot(page, '15:00');
        const window = ticketWindow(page);
        await window.getByLabel('Ticket').fill('OPS-7');
        await window.getByLabel('Commentaire').fill('Tapé avant');
        await writeDay(request, date, [{ start: '09:30', end: '10:00', ticket: 'OPS-99' }]);

        // Le clic à côté est refusé : la fenêtre reste, le curseur est sur la grille, et
        // la sélection revient au créneau qu'elle vise.
        await clickSlot(page, '17:00');
        await expect(window).toContainText('La journée a changé entre-temps.');
        await expect(slots(page)).toBeFocused();
        await expect(slots(page).getByRole('option', { selected: true })).toHaveText(/15:00/);
        await page.keyboard.press('Enter');
        await expect(window).toHaveCount(0);
        expect(await savedDay(request, date)).toMatchObject([
            { start: '09:30', ticket: 'OPS-99' },
            { start: '15:00', end: '15:15', ticket: 'OPS-7', comment: 'Tapé avant' },
        ]);
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });
});

test.describe('la fin prévue', () => {
    test('compte le créneau en cours comme travaillé, saisi ou non, sauf en pause', async ({ page, request }) => {
        const date = day(100);
        await writeDay(request, date, [{ start: '09:00', end: '14:00', ticket: 'SHOP-482' }]);
        await startTimeAt(page, date, '15:20');
        await open(page, date);
        const figures = page.getByRole('group', { name: 'Chiffres du jour' });
        // 2h30 à faire depuis 15:15, le début du créneau de la ligne « maintenant ».
        await expect(figures).toContainText('Reste 2h30');
        await expect(figures).toContainText('Fin prévue à 17:45');

        await doubleClickSlot(page, '15:15');
        await ticketWindow(page).getByLabel('Ticket').fill('SHOP-482');
        await page.keyboard.press('Enter');
        await expect(figures).toContainText('Reste 2h15');
        await expect(figures).toContainText('Fin prévue à 17:45');

        await doubleClickSlot(page, '15:15');
        await ticketWindow(page, 'Modifier le ticket').getByRole('button', { name: 'Convertir en pause' }).click();
        await expect(figures).toContainText('Reste 2h30');
        await expect(figures).toContainText('Fin prévue à 18:00');

        await page.keyboard.press('ControlOrMeta+z');
        await expect(figures).toContainText('Reste 2h15');
        await expect(figures).toContainText('Fin prévue à 17:45');
        await expectGridMatchesBase(page, request, date);
        await clearDay(request, date);
    });
});

test.describe('l’objectif du jour', () => {
    function objectiveButton(page: Page) {
        return page.getByRole('button', { name: /^Objectif du jour/ });
    }

    test('se règle au quart d’heure, recalcule la fin prévue et s’enregistre', async ({ page, request }) => {
        const date = day(44);
        await writeDay(request, date, [{ start: '09:00', end: '14:00', ticket: 'SHOP-482' }]);
        await startTimeAt(page, date, '15:20');
        await open(page, date);

        await objectiveButton(page).click();
        const window = page.getByRole('dialog', { name: 'Objectif du jour' });
        await expect(objectiveButton(page)).toHaveAttribute('aria-expanded', 'true');
        // 2h30 à faire depuis 15:15, le début du créneau en cours.
        await expect(window).toContainText('Fin prévue à 17:45. Les autres jours gardent votre objectif habituel.');
        // À l'objectif habituel, rien à remettre.
        await expect(window.getByRole('button', { name: 'Revenir à 7h30' })).toHaveCount(0);
        const field = window.getByLabel('Durée à travailler');
        await expect(field).toBeFocused();
        await expect(field).toHaveValue('7h30');

        for (let step = 0; step < 6; step += 1) {
            await window.getByRole('button', { name: 'Enlever 15 minutes' }).click();
        }
        await expect(field).toHaveValue('6h00');
        await expect(window).toContainText('Fin prévue à 16:15.');
        await expect(window.getByRole('button', { name: 'Revenir à 7h30' })).toBeVisible();
        await window.getByRole('button', { name: 'Enregistrer' }).click();

        await expect(window).toHaveCount(0);
        await expect(objectiveButton(page)).toBeFocused();
        await expect(page.getByRole('group', { name: 'Chiffres du jour' })).toContainText('Fin prévue à 16:15');
        expect(((await (await request.get(`/api/days/${date}`)).json()) as { objective: number }).objective).toBe(360);
        await clearDay(request, date);
    });

    test('se tape, et refuse sous le champ ce qui n’est pas un objectif', async ({ page, request }) => {
        const date = day(45);
        await writeDay(request, date, []);
        await open(page, date);

        await objectiveButton(page).click();
        const window = page.getByRole('dialog', { name: 'Objectif du jour' });
        const field = window.getByLabel('Durée à travailler');
        for (const [typed, refusal] of [
            ['7h10', "L'objectif se règle au quart d'heure."],
            ['13h15', "L'objectif va de 0h00 à 13h00."],
            ['beaucoup', 'Indiquez une durée, comme 7h30.'],
        ] as const) {
            await field.fill(typed);
            await field.press('Enter');
            await expect(field).toHaveAttribute('aria-invalid', 'true');
            await expect(field).toHaveAccessibleDescription(refusal);
            await expect(field).toHaveValue(typed);
        }
        await field.fill('7,5');
        await field.press('ArrowUp');
        await expect(field).toHaveValue('7h45');
        await field.press('Enter');
        await expect(window).toHaveCount(0);
        await expect(objectiveButton(page)).toHaveAccessibleName('Objectif du jour, 7h45. Modifier');
        await clearDay(request, date);
    });

    test('revient à l’objectif habituel, et reste entre 0h00 et 13h00', async ({ page, request }) => {
        const date = day(42);
        await writeDay(request, date, [], 15);
        await open(page, date);

        await objectiveButton(page).click();
        const window = page.getByRole('dialog', { name: 'Objectif du jour' });
        await window.getByRole('button', { name: 'Enlever 15 minutes' }).click();
        await window.getByRole('button', { name: 'Enlever 15 minutes' }).click();
        await expect(window.getByLabel('Durée à travailler')).toHaveValue('0h00');
        await window.getByLabel('Durée à travailler').press('Enter');
        // À 0h00, le jour se déclare non travaillé : la barre garde l'objectif, qui le défait.
        await expect(page.getByRole('group', { name: 'Chiffres du jour' })).toHaveText('0h00/0h00Jour non travaillé');

        await objectiveButton(page).click();
        await window.getByLabel('Durée à travailler').fill('13h00');
        await window.getByRole('button', { name: 'Ajouter 15 minutes' }).click();
        await expect(window.getByLabel('Durée à travailler')).toHaveValue('13h00');

        // Le lien remet la durée sans rien enregistrer, comme − et + : le curseur revient
        // au champ, et le lien s'en va.
        await window.getByRole('button', { name: 'Revenir à 7h30' }).click();
        await expect(window.getByLabel('Durée à travailler')).toHaveValue('7h30');
        await expect(window.getByLabel('Durée à travailler')).toBeFocused();
        await expect(window.getByRole('button', { name: 'Revenir à 7h30' })).toHaveCount(0);
        await expect(objectiveButton(page)).toHaveAccessibleName('Objectif du jour, 0h00. Modifier');
        expect(((await (await request.get(`/api/days/${date}`)).json()) as { objective: number }).objective).toBe(0);

        await window.getByLabel('Durée à travailler').press('Enter');
        await expect(window).toHaveCount(0);
        await expect(objectiveButton(page)).toHaveAccessibleName('Objectif du jour, 7h30. Modifier');
        await clearDay(request, date);
    });

    test('enregistre au clic à côté, abandonne à Échap', async ({ page, request }) => {
        const date = day(43);
        await writeDay(request, date, []);
        await open(page, date);

        await objectiveButton(page).click();
        const window = page.getByRole('dialog', { name: 'Objectif du jour' });
        await window.getByLabel('Durée à travailler').fill('6h');
        await page.keyboard.press('Escape');
        await expect(window).toHaveCount(0);
        await expect(objectiveButton(page)).toHaveAccessibleName('Objectif du jour, 7h30. Modifier');

        await objectiveButton(page).click();
        await window.getByLabel('Durée à travailler').fill('6h');
        await clickSlot(page, '15:00');
        await expect(window).toHaveCount(0);
        await expect(objectiveButton(page)).toHaveAccessibleName('Objectif du jour, 6h00. Modifier');
        await clearDay(request, date);
    });
});

test.describe('changer de jour, une fenêtre ouverte', () => {
    test('enregistre la fenêtre de ticket, puis change de jour', async ({ page, request }) => {
        const date = day(51);
        await writeDay(request, date, []);
        await writeDay(request, day(52), []);
        await open(page, date);

        await doubleClickSlot(page, '09:00');
        await ticketWindow(page).getByLabel('Ticket').fill('SHOP-482');
        await page.getByRole('button', { name: 'Jour suivant' }).click();

        await expect(page).toHaveURL(new RegExp(`/${day(52)}$`));
        expect(await savedDay(request, date)).toMatchObject([{ start: '09:00', end: '09:15', ticket: 'SHOP-482' }]);
        expect(await savedDay(request, day(52))).toEqual([]);
        await clearDay(request, date);
    });

    test('enregistre l’objectif, puis change de jour', async ({ page, request }) => {
        const date = day(57);
        await writeDay(request, date, []);
        await open(page, date);

        await page.getByRole('button', { name: /^Objectif du jour/ }).click();
        await page.getByRole('dialog', { name: 'Objectif du jour' }).getByLabel('Durée à travailler').fill('6h');
        await page.getByRole('button', { name: 'Jour suivant' }).click();

        await expect(page).toHaveURL(new RegExp(`/${day(58)}$`));
        expect(((await (await request.get(`/api/days/${date}`)).json()) as { objective: number }).objective).toBe(360);
        await clearDay(request, date);
    });
});

test.describe('changer de jour, une fenêtre refusée', () => {
    test.use({ expectedErrors: [refusedWith(422)] });

    test('reste sur le jour, la fenêtre ouverte avec son message', async ({ page, request }) => {
        const date = day(59);
        await writeDay(request, date, []);
        await open(page, date);

        await doubleClickSlot(page, '09:00');
        await ticketWindow(page).getByLabel('Ticket').fill('pas un ticket');
        await page.getByRole('button', { name: 'Jour suivant' }).click();

        await expect(ticketWindow(page).getByLabel('Ticket')).toHaveAccessibleDescription(
            "Un identifiant de ticket s'écrit comme SHOP-482.",
        );
        await expect(page).toHaveURL(new RegExp(`/${date}$`));
        await page.keyboard.press('Escape');
        await clearDay(request, date);
    });
});

test('le message rend le curseur à la grille après Annuler ou sa croix, au clavier', async ({ page, request }) => {
    const date = day(60);
    await writeDay(request, date, MORNING);
    await open(page, date);

    for (const button of ['Annuler', 'Fermer le message']) {
        await clickSlot(page, '09:15');
        await page.keyboard.press('Delete');
        await message(page).getByRole('button', { name: button }).focus();
        await page.keyboard.press('Enter');
        await expect(message(page)).toHaveCount(0);
        await expect(slots(page)).toBeFocused();
        // Le geste suivant attend que l'annulation soit revenue : sur une grille encore en
        // attente, 09:15 serait vide sous le clic, et Suppr n'aurait rien à effacer.
        await expect(slots(page)).toHaveAttribute('aria-busy', 'false');
    }
    await expectGridMatchesBase(page, request, date);
    await clearDay(request, date);
});

test('le pied d’une fenêtre reste dedans, même avec des libellés plus larges', async ({ page, request }) => {
    const date = day(61);
    await writeDay(request, date, MORNING);
    await page.setViewportSize({ width: 1024, height: 720 });
    await open(page, date);
    // Une police plus large que celle du conteneur, comme celle d'un Mac.
    await page.addStyleTag({ content: '[role="dialog"] button { letter-spacing: 0.12em; }' });

    await doubleClickSlot(page, '10:00');
    const window = ticketWindow(page, 'Modifier le ticket');
    const frame = await window.boundingBox();
    for (const name of ['Convertir en pause', 'Supprimer', 'Annuler', 'Enregistrer']) {
        const box = await window.getByRole('button', { name, exact: true }).boundingBox();
        expect(box !== null && frame !== null && box.x + box.width <= frame.x + frame.width).toBe(true);
        expect(box !== null && box.x + box.width <= 1024).toBe(true);
    }
    await page.keyboard.press('Escape');
    await clearDay(request, date);
});

test.describe('les flèches du navigateur, une fenêtre ouverte', () => {
    test.use({ expectedErrors: [refusedWith(422)] });

    test('enregistrent la fenêtre avant de changer de jour, et restent sur le jour si elle est refusée', async ({
        page,
        request,
    }) => {
        const [first, second] = [day(62), day(63)];
        await writeDay(request, first, []);
        await writeDay(request, second, []);
        await open(page, first);
        await page.getByRole('button', { name: 'Jour suivant' }).click();
        await expect(page).toHaveURL(new RegExp(`/${second}$`));

        await doubleClickSlot(page, '09:00');
        const ticket = ticketWindow(page).getByLabel('Ticket');
        await ticket.fill('pas un ticket');
        await page.goBack();
        await expect(ticket).toHaveAccessibleDescription("Un identifiant de ticket s'écrit comme SHOP-482.");
        await expect(page).toHaveURL(new RegExp(`/${second}$`));
        await expect(page.getByRole('heading', { level: 1 })).toContainText(String(Number(second.slice(-2))));

        await ticket.fill('SHOP-482');
        await page.goBack();
        await expect(page).toHaveURL(new RegExp(`/${first}$`));
        await expect(ticketWindow(page)).toHaveCount(0);
        expect(await savedDay(request, second)).toMatchObject([{ start: '09:00', ticket: 'SHOP-482' }]);
        await clearDay(request, second);
    });

    test('vers un jour ouvert par son adresse, enregistrent la fenêtre et demandent avant de quitter la page', async ({
        page,
        request,
    }) => {
        const [first, second] = [day(78), day(79)];
        await writeDay(request, first, []);
        await writeDay(request, second, []);
        // Deux pages : Précédent quitte celle du second jour.
        await open(page, first);
        await open(page, second);
        const back = () =>
            page.evaluate(() => {
                history.back();
            });

        // Rester : la fenêtre s'est enregistrée, comme sur un clic à côté.
        await doubleClickSlot(page, '18:00');
        await ticketWindow(page).getByLabel('Ticket').fill('OPS-12');
        const stay = page.waitForEvent('dialog');
        await back();
        const asked = await stay;
        expect(asked.type()).toBe('beforeunload');
        await asked.dismiss();
        await expect(ticketWindow(page)).toHaveCount(0);
        await expect(page).toHaveURL(new RegExp(`/${second}$`));
        expect(await savedDay(request, second)).toMatchObject([{ start: '18:00', end: '18:15', ticket: 'OPS-12' }]);

        // Refusée : on reste, la fenêtre ouverte avec ce qui a été tapé et son refus.
        await doubleClickSlot(page, '18:30');
        const ticket = ticketWindow(page).getByLabel('Ticket');
        await ticket.fill('pas un ticket');
        const refused = page.waitForEvent('dialog');
        await back();
        await (await refused).dismiss();
        await expect(ticket).toHaveAccessibleDescription("Un identifiant de ticket s'écrit comme SHOP-482.");
        await expect(ticket).toHaveValue('PASUNTICKET');

        // Partir : ce qui était tapé arrive quand même.
        await ticket.fill('OPS-13');
        page.once('dialog', (dialog) => {
            void dialog.accept();
        });
        await back();
        await expect(page).toHaveURL(new RegExp(`/${first}$`));
        await expect
            .poll(() => savedDay(request, second))
            .toMatchObject([{ ticket: 'OPS-12' }, { start: '18:30', end: '18:45', ticket: 'OPS-13' }]);

        // Sans rien de tapé, la page se quitte sans rien demander.
        await page.goForward();
        await expect(page.getByRole('group', { name: 'Chiffres du jour' })).toBeVisible();
        await doubleClickSlot(page, '19:00');
        await expect(ticketWindow(page)).toBeVisible();
        await page.goBack();
        await expect(page).toHaveURL(new RegExp(`/${first}$`));
        await clearDay(request, second);
    });
});

test.describe('la place de Nouveau ticket', () => {
    async function expectInGrid(page: Page) {
        const window = await ticketWindow(page).boundingBox();
        const bar = await page.getByRole('banner').boundingBox();
        const height = page.viewportSize()?.height ?? 0;
        expect(window?.y ?? 0).toBeGreaterThanOrEqual((bar?.y ?? 0) + (bar?.height ?? Infinity));
        expect((window?.y ?? Infinity) + (window?.height ?? 0)).toBeLessThanOrEqual(height);
    }

    test('reste dans la grille pour une sélection haute ou en morceaux', async ({ page, request }) => {
        const date = day(80);
        await writeDay(request, date, []);
        await page.setViewportSize({ width: 1024, height: 720 });
        await open(page, date);

        // Une plage de deux heures, la grille telle qu'elle s'ouvre : accrochée par son haut.
        await dragSlots(page, '09:30', '11:15');
        await page.keyboard.press('Enter');
        await expect(ticketWindow(page)).toContainText('de 09:30 à 11:30');
        await expectInGrid(page);
        await page.keyboard.press('Escape');

        // Deux morceaux aux bouts de la journée : accrochée au morceau qu'on voit.
        for (const [from, to] of [
            ['07:00', '19:45'],
            ['19:45', '07:00'],
        ] as const) {
            await clickSlot(page, from);
            await clickSlot(page, to, ['ControlOrMeta']);
            await page.keyboard.press('s');
            await expect(ticketWindow(page)).toContainText('2 créneaux, 0h30');
            await expectInGrid(page);
            await page.keyboard.press('Escape');
        }
        await clearDay(request, date);
    });

    test('passe sous le créneau plutôt que sur la barre du haut', async ({ page, request }) => {
        const date = day(81);
        await writeDay(request, date, []);
        await page.setViewportSize({ width: 1440, height: 900 });
        await open(page, date);

        // 11:00 à 380 px du haut : la fenêtre tiendrait au-dessus, mais sur la barre, et
        // dessous, dans la grille.
        const offset = ((await slot(page, '11:00').boundingBox())?.y ?? 0) - 380;
        await page.getByRole('region', { name: 'Grille de la journée' }).evaluate((grid, by) => {
            grid.scrollTop += by;
        }, offset);
        const { x, y } = await slotPoint(page, '11:00');
        expect(y).toBeGreaterThan(380);
        await page.mouse.dblclick(x, y);
        await expect(ticketWindow(page)).toBeVisible();
        await expectInGrid(page);
        expect((await ticketWindow(page).boundingBox())?.y ?? 0).toBeGreaterThan(y);
        await page.keyboard.press('Escape');
        await clearDay(request, date);
    });
});

test.describe('où s’ouvre une fenêtre de ticket', () => {
    const BLOCK: Entry[] = [{ start: '09:30', end: '11:15', ticket: 'SHOP-482', comment: 'Mapping des colonnes' }];

    /** Une boîte à l'écran, qui doit y être. */
    async function boxOf(locator: Locator) {
        const box = await locator.boundingBox();
        if (box === null) {
            throw new Error('L’élément mesuré n’est pas à l’écran.');
        }

        return box;
    }

    /** La colonne des blocs, sans son bord : la liste des créneaux la couvre. */
    function lane(page: Page): Locator {
        return slots(page);
    }

    /** Le haut de la grille à 09:30 : le bloc entier et la place dessous. */
    async function showMorning(page: Page) {
        await slot(page, '09:30').evaluate((option) => {
            option.scrollIntoView({ block: 'start' });
        });
    }

    /**
     * La fenêtre se centre sur x, sans sortir de la colonne des blocs, à --s-2 de ses
     * bords ; sa flèche désigne x, à --s-3 au moins des bords de la fenêtre.
     */
    async function expectAt(page: Page, window: Locator, x: number) {
        const arrow = window.locator('svg[viewBox="0 0 16 8"]');
        await expect(arrow).toBeVisible();
        // Radix la pose une fois mesurée : on attend qu'elle soit à sa place.
        await expect(async () => {
            const column = await boxOf(lane(page));
            const box = await boxOf(window);
            const left = Math.max(column.x + 8, Math.min(x - box.width / 2, column.x + column.width - 8 - box.width));
            expect(Math.abs(box.x - left)).toBeLessThanOrEqual(1);
            const tip = await boxOf(arrow);
            const aimed = Math.max(left + 20, Math.min(x, left + box.width - 20));
            expect(Math.abs(tip.x + tip.width / 2 - aimed)).toBeLessThanOrEqual(1);
        }).toPass();
    }

    /** Modifier le ticket se pose sous ce quart d'heure, à --s-3, et le haut du bloc reste au-dessus d'elle. */
    async function expectUnder(page: Page, window: Locator, time: string) {
        await expect(async () => {
            const quarter = await boxOf(slot(page, time));
            const box = await boxOf(window);
            expect(Math.abs(box.y - (quarter.y + quarter.height + 12))).toBeLessThanOrEqual(1);
            expect((await boxOf(slot(page, '09:30'))).y).toBeLessThan(box.y);
        }).toPass();
    }

    VIEWPORTS.forEach((viewport, v) => {
        test(`au pointeur à la souris, au milieu de la colonne au clavier, ${String(viewport.width)} × ${String(viewport.height)}`, async ({
            page,
            request,
        }) => {
            const date = day(100 + v);
            await writeDay(request, date, BLOCK);
            await page.setViewportSize(viewport);
            await open(page, date);
            await showMorning(page);

            // Contre le bord gauche, au milieu, près du bord droit : Nouveau ticket sur un
            // créneau vide, puis Modifier le ticket en bas du long bloc.
            for (const aim of [4, 'middle', 'right'] as const) {
                const empty = await slotPoint(page, '12:00', aim);
                await page.mouse.dblclick(empty.x, empty.y);
                await expectAt(page, ticketWindow(page), empty.x);
                await page.keyboard.press('Escape');
                await expect(ticketWindow(page)).toHaveCount(0);

                const bottom = await slotPoint(page, '11:00', aim);
                await page.mouse.dblclick(bottom.x, bottom.y);
                const edit = ticketWindow(page, 'Modifier le ticket');
                await expectAt(page, edit, bottom.x);
                await expectUnder(page, edit, '11:00');
                await page.keyboard.press('Escape');
                await expect(edit).toHaveCount(0);
            }

            // Au clavier, sans pointeur : le milieu de la colonne, même après un clic.
            const middle = (await boxOf(lane(page))).x + (await boxOf(lane(page))).width / 2;
            await clickSlot(page, '10:00');
            await page.keyboard.press('Enter');
            const edit = ticketWindow(page, 'Modifier le ticket');
            await expectAt(page, edit, middle);
            await expectUnder(page, edit, '10:00');
            await page.keyboard.press('Escape');

            await clickSlot(page, '12:00');
            await page.keyboard.press('s');
            await expectAt(page, ticketWindow(page), middle);
            await page.keyboard.press('Escape');

            expect(await savedDay(request, date)).toMatchObject([{ start: '09:30', end: '11:15', ticket: 'SHOP-482' }]);
            await clearDay(request, date);
        });
    });

    test('ouvre « Nouveau ticket… » là où était le coin du menu, et au milieu depuis le clavier', async ({
        page,
        request,
    }) => {
        const date = day(105);
        await writeDay(request, date, BLOCK);
        await page.setViewportSize({ width: 1440, height: 900 });
        await open(page, date);
        await showMorning(page);

        await clickSlot(page, '12:00');
        await clickSlot(page, '12:30', ['Shift']);
        const point = await slotPoint(page, '12:15', 500);
        await page.mouse.click(point.x, point.y, { button: 'right' });
        await menu(page).getByRole('menuitem', { name: 'Nouveau ticket…' }).click();
        await expect(ticketWindow(page)).toContainText('de 12:00 à 12:45');
        await expectAt(page, ticketWindow(page), point.x);
        await page.keyboard.press('Escape');

        // Le menu ouvert au clavier n'a pas de pointeur.
        await clickSlot(page, '12:00');
        await page.keyboard.press('Shift+F10');
        await expect(menu(page).getByRole('menuitem', { name: 'Nouveau ticket…' })).toBeFocused();
        await page.keyboard.press('Enter');
        const column = await boxOf(lane(page));
        await expectAt(page, ticketWindow(page), column.x + column.width / 2);
        await page.keyboard.press('Escape');
        await clearDay(request, date);
    });

    test('ne passe jamais sous le récapitulatif ouvert à côté de la grille', async ({ page, request }) => {
        const date = day(106);
        await writeDay(request, date, BLOCK);
        await page.addInitScript(() => {
            localStorage.setItem('daytrack.recap-open', 'true');
        });
        await page.setViewportSize({ width: 1280, height: 800 });
        await open(page, date);
        await showMorning(page);
        const recap = await boxOf(page.getByRole('complementary', { name: 'Récapitulatif' }));

        // Près de lui : elle s'arrête contre lui, sa flèche au pointeur.
        const point = await slotPoint(page, '11:00', 'right');
        expect(point.x).toBeGreaterThan(recap.x - 200);
        await page.mouse.dblclick(point.x, point.y);
        const edit = ticketWindow(page, 'Modifier le ticket');
        await expectAt(page, edit, point.x);
        const box = await boxOf(edit);
        expect(Math.abs(box.x + box.width - (recap.x - 8))).toBeLessThanOrEqual(1);
        await page.keyboard.press('Escape');
        await clearDay(request, date);
    });

    test('se rouvre au clavier sous le quart d’heure double-cliqué, pas sous la fin du bloc', async ({
        page,
        request,
    }) => {
        const date = day(113);
        await writeDay(request, date, BLOCK);
        await page.setViewportSize({ width: 1440, height: 900 });
        await open(page, date);
        await showMorning(page);

        await doubleClickSlot(page, '10:15');
        const edit = ticketWindow(page, 'Modifier le ticket');
        await expectUnder(page, edit, '10:15');
        await page.keyboard.press('Escape');
        await expect(edit).toHaveCount(0);
        await expect(slots(page)).toBeFocused();

        // La sélection s'est arrêtée sur 10:15 : Entrée la rouvre sous lui, au milieu.
        await page.keyboard.press('Enter');
        await expectUnder(page, edit, '10:15');
        const column = await boxOf(lane(page));
        await expectAt(page, edit, column.x + column.width / 2);
        await page.keyboard.press('Escape');

        // Les flèches en repartent aussi, le curseur revenu à la grille.
        await expect(edit).toHaveCount(0);
        await expect(slots(page)).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(slots(page).getByRole('option', { selected: true })).toHaveText([/^10:30/]);
        await clearDay(request, date);
    });

    test('garde son horizontale quand la grille défile, son quart d’heure suivi', async ({ page, request }) => {
        const date = day(107);
        await writeDay(request, date, BLOCK);
        await page.setViewportSize({ width: 1440, height: 900 });
        await open(page, date);
        await showMorning(page);

        const point = await slotPoint(page, '10:45', 300);
        await page.mouse.dblclick(point.x, point.y);
        const edit = ticketWindow(page, 'Modifier le ticket');
        await expectUnder(page, edit, '10:45');
        const quarter = await boxOf(slot(page, '10:45'));
        await page.getByRole('region', { name: 'Grille de la journée' }).evaluate((grid, by) => {
            grid.scrollTop += by;
        }, quarter.height * 2);
        await expect.poll(async () => (await boxOf(slot(page, '10:45'))).y).toBeLessThan(quarter.y - quarter.height);
        await expectUnder(page, edit, '10:45');
        await expectAt(page, edit, point.x);
        await page.keyboard.press('Escape');
        await clearDay(request, date);
    });

    test.describe('un refus parce que la journée a changé ailleurs', () => {
        test.use({ expectedErrors: [refusedWith(409)] });

        test('reste à son quart d’heure s’il est encore dans le bloc, sinon au premier, à la même horizontale', async ({
            page,
            request,
        }) => {
            const date = day(108);
            for (const [time, after] of [
                ['10:00', '10:00'],
                ['11:00', '09:30'],
            ] as const) {
                await writeDay(request, date, BLOCK);
                await open(page, date);
                await showMorning(page);
                const point = await slotPoint(page, time, 300);
                await page.mouse.dblclick(point.x, point.y);
                const edit = ticketWindow(page, 'Modifier le ticket');
                await edit.getByLabel('Commentaire').fill('Mapping revu');
                // L'autre onglet raccourcit le bloc et pose OPS-1 derrière.
                await writeDay(request, date, [
                    { start: '09:30', end: '10:30', ticket: 'SHOP-482', comment: 'Mapping des colonnes' },
                    { start: '10:30', end: '11:15', ticket: 'OPS-1', comment: 'Autre onglet' },
                ]);

                await edit.getByLabel('Commentaire').press('Enter');
                await expect(edit).toContainText('La journée a changé entre-temps.');
                await expect(edit).toContainText('de 09:30 à 10:30');
                await expectUnder(page, edit, after);
                await expectAt(page, edit, point.x);
                await page.keyboard.press('Escape');
                await expect(edit).toHaveCount(0);
                await clearDay(request, date);
            }
        });

        test('reste au même endroit quand Nouveau ticket prend la place de Modifier le ticket', async ({
            page,
            request,
        }) => {
            const date = day(109);
            await writeDay(request, date, BLOCK);
            await open(page, date);
            await showMorning(page);
            const point = await slotPoint(page, '11:00', 300);
            await page.mouse.dblclick(point.x, point.y);
            await ticketWindow(page, 'Modifier le ticket').getByLabel('Commentaire').fill('Mapping revu');
            // L'autre onglet remplace le bloc entier : la fenêtre devient Nouveau ticket.
            await writeDay(request, date, [{ start: '09:30', end: '11:15', ticket: 'OPS-1', comment: 'Autre onglet' }]);

            await page.keyboard.press('Enter');
            const window = ticketWindow(page);
            await expect(window).toContainText('La journée a changé entre-temps.');
            await expect(window.getByText(/^Remplace /)).toHaveText('Remplace OPS-1 sur ces 105 minutes.');
            await expectUnder(page, window, '11:00');
            await expectAt(page, window, point.x);
            await page.keyboard.press('Escape');
            await expect(window).toHaveCount(0);
            expect(await savedDay(request, date)).toMatchObject([{ start: '09:30', end: '11:15', ticket: 'OPS-1' }]);
            await clearDay(request, date);
        });

        test('garde son côté quand elle grandit sans place dessous, sans flèche', async ({ page, request }) => {
            const date = day(114);
            await writeDay(request, date, BLOCK);
            await page.setViewportSize({ width: 1440, height: 720 });
            await open(page, date);
            await showMorning(page);
            await doubleClickSlot(page, '11:00', 300);
            const edit = ticketWindow(page, 'Modifier le ticket');
            await expectUnder(page, edit, '11:00');

            // La grille défilée : sous 11:00, la place de Modifier le ticket, pas celle de
            // Nouveau ticket, plus haut d'un message et d'une phrase.
            const region = page.getByRole('region', { name: 'Grille de la journée' });
            const bottom = Math.min((await boxOf(region)).y + (await boxOf(region)).height, 720);
            const room = (await boxOf(edit)).height + 12 + 8 + 30;
            const quarter = await boxOf(slot(page, '11:00'));
            await region.evaluate(
                (grid, by) => {
                    grid.scrollTop += by;
                },
                quarter.y + quarter.height - (bottom - room),
            );
            await expect
                .poll(async () => {
                    const moved = await boxOf(slot(page, '11:00'));

                    return Math.abs(moved.y + moved.height - (bottom - room));
                })
                .toBeLessThanOrEqual(1);
            await expectUnder(page, edit, '11:00');
            await edit.getByLabel('Commentaire').fill('Mapping revu');
            await writeDay(request, date, [{ start: '09:30', end: '11:15', ticket: 'OPS-1', comment: 'Autre onglet' }]);

            await page.keyboard.press('Enter');
            const window = ticketWindow(page);
            await expect(window).toContainText('La journée a changé entre-temps.');
            await expect(window).toHaveAttribute('data-side', 'bottom');
            await expect(window.locator('svg[viewBox="0 0 16 8"]')).toBeHidden();
            await expect(async () => {
                const box = await boxOf(window);
                expect(Math.abs(box.y + box.height - (bottom - 8))).toBeLessThanOrEqual(1);
            }).toPass();
            await page.keyboard.press('Escape');
            await clearDay(request, date);
        });
    });
});

test('recliquer sur l’objectif enregistre, et garde une durée refusée', async ({ page, request }) => {
    const date = day(64);
    await writeDay(request, date, []);
    await open(page, date);
    const button = page.getByRole('button', { name: /^Objectif du jour/ });
    const window = page.getByRole('dialog', { name: 'Objectif du jour' });

    await button.click();
    await window.getByLabel('Durée à travailler').fill('7h40');
    await button.click();
    await expect(window.getByLabel('Durée à travailler')).toHaveAccessibleDescription(
        "L'objectif se règle au quart d'heure.",
    );
    await expect(window.getByLabel('Durée à travailler')).toHaveValue('7h40');

    await window.getByLabel('Durée à travailler').fill('7h45');
    await button.click();
    await expect(window).toHaveCount(0);
    await expect(button).toHaveAccessibleName('Objectif du jour, 7h45. Modifier');
    await clearDay(request, date);
});

test('sous 1280 px, l’objectif et le menu ferment le récapitulatif posé sur la grille', async ({ page, request }) => {
    const date = day(65);
    await writeDay(request, date, MORNING);
    await page.setViewportSize({ width: 1024, height: 720 });
    await open(page, date);
    const recap = page.getByRole('complementary', { name: 'Récapitulatif' });

    // Sous 1280 px, il s'ouvre fermé : on l'ouvre.
    await page.getByRole('button', { name: 'Afficher le récapitulatif' }).click();
    await expect(recap).toHaveAttribute('data-state', 'open');
    await page.getByRole('button', { name: /^Objectif du jour/ }).click();
    await expect(recap).toHaveAttribute('data-state', 'closed');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Afficher le récapitulatif' }).click();
    await expect(recap).toHaveAttribute('data-state', 'open');
    await rightClickSlot(page, '10:00');
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(recap).toHaveAttribute('data-state', 'closed');
    await page.keyboard.press('Escape');
    await clearDay(request, date);
});

test('sous 1280 px, une fenêtre de ticket ferme le récapitulatif posé sur la grille', async ({ page, request }) => {
    const date = day(50);
    await writeDay(request, date, MORNING);
    await page.setViewportSize({ width: 1024, height: 720 });
    await open(page, date);
    const recap = page.getByRole('complementary', { name: 'Récapitulatif' });
    await page.getByRole('button', { name: 'Afficher le récapitulatif' }).click();
    await expect(recap).toHaveAttribute('data-state', 'open');

    await doubleClickSlot(page, '15:00');
    await expect(ticketWindow(page)).toBeVisible();
    await expect(recap).toHaveAttribute('data-state', 'closed');
    await page.keyboard.press('Escape');
    await clearDay(request, date);
});
