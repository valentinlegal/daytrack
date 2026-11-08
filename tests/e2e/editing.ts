import type { APIRequestContext, Locator, Page, Request } from '@playwright/test';

import { startTimeAt, weekdaysFrom } from './day';
import { expect } from './fixtures';

/**
 * Saisir dans la grille comme quelqu'un qui s'en sert : à la souris sur les
 * créneaux, au clavier dans leur liste, puis relire la base pour vérifier qu'elle
 * contient exactement ce que l'écran montre.
 */

interface SavedBlock {
    readonly start: string;
    readonly end: string;
    readonly kind: 'work' | 'pause';
    readonly ticket: string | null;
    readonly comment: string | null;
}

/** La grille défilée jusqu'à ce que cette heure soit en haut de la vue, ou aussi près que possible. */
export async function scrollGridTo(page: Page, time: string) {
    await slot(page, time).evaluate((option) => {
        option.closest('[role="region"]')?.scrollTo({ top: 0 });
        const region = option.closest('[role="region"]');
        if (region !== null) {
            region.scrollTop = option.getBoundingClientRect().top - region.getBoundingClientRect().top;
        }
    });
}

/** La liste des créneaux : elle porte le curseur de la grille. */
export function slots(page: Page): Locator {
    return page.getByRole('listbox', { name: 'Créneaux de la journée' });
}

export function slot(page: Page, time: string): Locator {
    return page.locator(`#creneau-${time.replace(':', '')}`);
}

export function selectedSlots(page: Page): Locator {
    return slots(page).getByRole('option', { selected: true });
}

/** Les blocs de la journée, de haut en bas. */
export function blocks(page: Page): Locator {
    return page.getByRole('list', { name: 'Saisies du jour' }).getByRole('listitem');
}

/** La colonne des blocs, que la grille fermée grise. */
export function lane(page: Page): Locator {
    return page.getByRole('list', { name: 'Saisies du jour' }).locator('..');
}

export function figures(page: Page): Locator {
    return page.getByRole('group', { name: 'Chiffres du jour' });
}

/** Ouvre la journée, à l'heure qu'a le navigateur, et attend ses chiffres. */
export async function openDay(page: Page, date: string): Promise<void> {
    await page.goto(`/${date}`);
    await expect(figures(page)).toBeVisible();
}

export function openAnyway(page: Page): Locator {
    return page.getByRole('button', { name: 'Saisir quand même' });
}

/** La valeur qu'une couleur de tokens.css prend dans la page. */
export async function tokenColor(page: Page, token: `--${string}`): Promise<string> {
    return page.evaluate((name) => {
        const probe = document.createElement('div');
        probe.style.backgroundColor = `var(${name})`;
        document.body.append(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();

        return color;
    }, token);
}

/** Les écritures que la page envoie à partir d'ici, hors ce qu'elle demande à Jira. */
export function recordWrites(page: Page): Request[] {
    const writes: Request[] = [];
    page.on('request', (sent) => {
        const jira = /\/api\/(jira\/check|tickets\/refresh)$/.test(new URL(sent.url()).pathname);
        if (sent.method() !== 'GET' && !jira) {
            writes.push(sent);
        }
    });

    return writes;
}

/** Ces écritures, chacune par sa méthode et son adresse : « PUT /api/days/2025-01-06/objective ». */
export function describedWrites(writes: readonly Request[]): string[] {
    return writes.map((sent) => `${sent.method()} ${new URL(sent.url()).pathname}`);
}

/**
 * Où le pointeur vise un créneau : à tant de pixels du bord gauche de la colonne des
 * blocs, en son milieu, ou près du bord droit de ce qu'on en voit — le récapitulatif posé
 * par-dessus la grille, sous 1280 px, en cache la droite.
 */
export type Aim = number | 'middle' | 'right';

/**
 * Près du bord gauche de la colonne : là où visent les gestes qui n'ouvrent pas de
 * fenêtre, et un second double-clic, une fenêtre déjà ouverte près du bord droit.
 */
export const NEAR_LEFT = 24;

/**
 * Un point du créneau, là où le pointeur le vise : près du bord gauche de la colonne des
 * blocs, par défaut. Une fenêtre de ticket s'ouvre au pointeur, à sa hauteur : le
 * double-clic vise près du bord droit (doubleClickSlot), pour qu'elle laisse libre le
 * bord gauche, où visent les autres gestes.
 */
export async function slotPoint(page: Page, time: string, aim: Aim = NEAR_LEFT): Promise<{ x: number; y: number }> {
    const option = slot(page, time);
    await option.scrollIntoViewIfNeeded();

    return pointOf(page, time, aim);
}

async function pointOf(page: Page, time: string, aim: Aim = NEAR_LEFT): Promise<{ x: number; y: number }> {
    const box = await slot(page, time).boundingBox();
    if (box === null) {
        throw new Error(`Le créneau de ${time} n'est pas à l'écran.`);
    }
    // Fermé, il est caché : on le cherche par son identifiant, pas par son rôle. Ouvert, il
    // glisse peut-être encore : on attend qu'il soit à sa place pour mesurer son bord.
    const recap = page.locator('#recap');
    const cover =
        (await recap.getAttribute('data-state')) === 'open'
            ? await recap.evaluate(async (panel) => {
                  await Promise.all(panel.getAnimations().map((animation) => animation.finished));

                  return panel.getBoundingClientRect().left;
              })
            : Infinity;
    const right = Math.min(box.x + box.width, cover) - NEAR_LEFT;

    const x = aim === 'right' ? right : aim === 'middle' ? box.x + box.width / 2 : Math.min(box.x + aim, right);

    return { x, y: box.y + box.height / 2 };
}

export async function clickSlot(page: Page, time: string, modifiers: ('Shift' | 'ControlOrMeta')[] = []) {
    const { x, y } = await slotPoint(page, time);
    for (const key of modifiers) {
        await page.keyboard.down(key);
    }
    await page.mouse.click(x, y);
    for (const key of modifiers) {
        await page.keyboard.up(key);
    }
}

export async function doubleClickSlot(page: Page, time: string, aim: Aim = 'right') {
    const { x, y } = await slotPoint(page, time, aim);
    await page.mouse.dblclick(x, y);
}

export async function rightClickSlot(page: Page, time: string, aim: Aim = NEAR_LEFT) {
    const { x, y } = await slotPoint(page, time, aim);
    await page.mouse.click(x, y, { button: 'right' });
}

/** Glisser d'un créneau à un autre, en passant par ceux d'entre eux. */
export async function dragSlots(page: Page, from: string, to: string) {
    // Les deux bouts se mesurent une fois la grille placée : un défilement entre eux
    // décalerait le premier.
    await slot(page, from).evaluate((option) => {
        option.scrollIntoView({ block: 'center' });
    });
    const start = await pointOf(page, from);
    const end = await pointOf(page, to);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 6 });
    await page.mouse.up();
}

export function ticketWindow(page: Page, name = 'Nouveau ticket'): Locator {
    return page.getByRole('dialog', { name });
}

export function message(page: Page): Locator {
    return page.getByRole('status').filter({ has: page.getByRole('button', { name: 'Fermer le message' }) });
}

/** La journée telle que la base la contient. */
export async function savedDay(request: APIRequestContext, date: string): Promise<SavedBlock[]> {
    const response = await request.get(`/api/days/${date}`);

    return ((await response.json()) as { blocks: SavedBlock[] }).blocks;
}

/** Ce que la liste des créneaux dit de chacun, tel que la base le contient : « 09:30, SHOP-482, Tests ». */
function labelsOf(blocks: readonly SavedBlock[]): string[] {
    const labels: string[] = [];
    for (let minutes = 420; minutes < 1200; minutes += 15) {
        const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
        const block = blocks.find((candidate) => candidate.start <= time && time < candidate.end);
        labels.push(
            block === undefined
                ? `${time}, vide`
                : block.kind === 'pause'
                  ? `${time}, pause`
                  : [time, block.ticket, block.comment].filter((part) => part !== null).join(', '),
        );
    }

    return labels;
}

/**
 * Ce que la grille affiche est ce que la base contient : quart d'heure par quart d'heure,
 * et bloc par bloc. Les deux se relisent jusqu'à s'accorder, le temps qu'un geste en
 * route arrive ; un écart qui dure fait échouer le parcours, et dit où.
 */
export async function expectGridMatchesBase(page: Page, request: APIRequestContext, date: string) {
    // Un geste encore en route — une annulation qui n'est pas revenue — laisserait la
    // grille et la base pareilles avant lui : on compare ce qu'elles sont après.
    await expect(slots(page)).toHaveAttribute('aria-busy', 'false');
    await expect
        .poll(
            async () => {
                const [shown, blocks, saved] = await Promise.all([
                    slots(page).getByRole('option').allTextContents(),
                    page.getByRole('list', { name: 'Saisies du jour' }).getByRole('listitem').count(),
                    savedDay(request, date),
                ]);
                const expected = labelsOf(saved);
                const gaps = shown.flatMap((label, index) =>
                    label === expected[index] ? [] : [`écran « ${label} », base « ${expected[index] ?? ''} »`],
                );

                return blocks === saved.length
                    ? gaps
                    : [...gaps, `${String(blocks)} blocs pour ${String(saved.length)}`];
            },
            { message: 'La grille et la base diffèrent' },
        )
        .toEqual([]);
}

/**
 * Amène la souris sur un élément en plusieurs pas, comme une vraie, puis l'y laisse jusqu'à
 * ce que `shown` — ce que son survol ouvre, une infobulle — paraisse.
 *
 * Une main posée sur la souris la fait encore bouger d'un pixel, et il le faut : d'un bouton
 * à son voisin, Radix croit le pointeur en chemin vers l'infobulle d'avant, et n'écoute le
 * survol du voisin qu'au mouvement qui suit la fin de ce chemin, qu'il ne repère qu'une fois
 * la page rendue. Le dernier pas de Playwright arrivait parfois avant ce rendu, sur un poste
 * chargé, et l'infobulle attendait un mouvement qui ne venait plus. Le pointeur bouge donc
 * d'un pixel à chaque image, jusqu'à ce qu'elle paraisse.
 */
export async function glideTo(page: Page, target: Locator, shown: Locator) {
    const box = await target.boundingBox();
    if (box === null) {
        throw new Error('L’élément visé n’est pas à l’écran.');
    }
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y, { steps: 4 });
    const deadline = Date.now() + 5000;
    for (let shift = 1; !(await shown.isVisible()) && Date.now() < deadline; shift = -shift) {
        await nextFrame(page);
        await page.mouse.move(x + shift, y);
    }
    await expect(shown).toBeVisible();
}

/**
 * Clique à côté de la fenêtre ouverte, après qu'on y a tapé : dans l'en-tête, à côté du
 * logo, là où rien ne prend le focus.
 *
 * Radix n'écoute le clic à côté qu'un tour après avoir posé la fenêtre. Une main met bien
 * plus longtemps à aller cliquer ailleurs ; Playwright, non : sur un poste chargé, son clic
 * passait parfois avant ce tour, et la fenêtre restait ouverte. La page finit donc son tour
 * avant le clic. Ce tour est posé au plus tard à la première frappe dans la fenêtre, qui
 * fait rendre la page : sans frappe, rien ne garantit qu'il passe avant le nôtre. Sous une
 * horloge figée (`freezeTime`), aucun tour ne passe : ni cette aide ni `glideTo` n'y servent.
 */
export async function clickOutside(page: Page) {
    await page.evaluate(
        () =>
            new Promise<void>((resolve) => {
                setTimeout(resolve, 0);
            }),
    );
    await page.mouse.click(5, 5);
}

/** Attend que la page ait rendu une image. */
async function nextFrame(page: Page) {
    await page.evaluate(
        () =>
            new Promise<void>((resolve) => {
                requestAnimationFrame(() => {
                    resolve();
                });
            }),
    );
}

/**
 * Ouvre la journée d'exemple « en-cours », à 15:20, récapitulatif ouvert : sous
 * 1280 px, par-dessus la grille.
 */
export async function openSampleDay(page: Page, date: string) {
    await startTimeAt(page, date, '15:20');
    await page.addInitScript(() => {
        localStorage.setItem('daytrack.recap-open', 'true');
    });
    await page.goto(`/${date}`);
    await expect(page.getByRole('group', { name: 'Chiffres du jour' })).toBeVisible();
    // Sous 1280 px, le récapitulatif s'ouvre fermé, quoi qu'on ait retenu : on l'ouvre
    // par son bouton, par-dessus la grille, et la souris s'en va.
    if ((page.viewportSize()?.width ?? 1440) < 1280) {
        await page.getByRole('button', { name: 'Afficher le récapitulatif' }).click();
        await page.mouse.move(0, 0);
        await expect(page.getByRole('complementary', { name: 'Récapitulatif' })).toHaveAttribute('data-state', 'open');
    }
}

/**
 * Le jour d'un parcours : le `index`-ième jour de semaine à partir du lundi 5 janvier
 * 2026, à l'écart des autres parcours — ceux de la saisie (grid-editing.spec.ts) vont
 * jusqu'au 2 janvier, la suite tirée au hasard prend le 29 décembre. Un samedi serait fermé
 * à la saisie.
 */
export const editingDay = weekdaysFrom('2026-01-05');

export function objectiveButton(page: Page): Locator {
    return page.getByRole('button', { name: /^Objectif du jour/ });
}

export function objectiveWindow(page: Page): Locator {
    return page.getByRole('dialog', { name: 'Objectif du jour' });
}

export function menu(page: Page): Locator {
    return page.getByRole('menu', { name: 'Actions sur la sélection' });
}

/** Les gestes qui amènent chaque écran. */
export const EDITING_SCREENS: { name: string; reach: (page: Page) => Promise<void> }[] = [
    {
        name: 'ajout',
        reach: async (page) => {
            // SHOP-501 tapé : Jira l'a trouvé, son titre est à côté du champ. Le double-clic
            // près du bord gauche : la fenêtre s'y arrête, sa flèche au pointeur.
            await doubleClickSlot(page, '15:15', 140);
            await ticketWindow(page).getByLabel('Ticket').fill('SHOP-501');
            await expect(ticketWindow(page).getByText('Relance automatique des paniers abandonnés')).toBeVisible();
        },
    },
    {
        name: 'edition',
        reach: async (page) => {
            // Au milieu de SHOP-482 : la fenêtre sous ce quart d'heure, le haut du bloc au-dessus.
            await doubleClickSlot(page, '10:15', 320);
            await expect(ticketWindow(page, 'Modifier le ticket')).toBeVisible();
        },
    },
    {
        name: 'edition-pause',
        reach: async (page) => {
            await doubleClickSlot(page, '12:45', 240);
            await expect(ticketWindow(page, 'Modifier la pause')).toBeVisible();
        },
    },
    {
        name: 'selection',
        reach: async (page) => {
            // Un ticket copié avant : « Coller » sert.
            await clickSlot(page, '09:15');
            await page.keyboard.press('ControlOrMeta+C');
            await clickSlot(page, '13:30');
            await clickSlot(page, '15:00', ['Shift']);
            // Le menu en haut de la sélection : plus haut, avec
            // « Nouveau ticket… » en tête, il tient dans l'écran.
            await rightClickSlot(page, '13:30');
            await expect(menu(page)).toBeVisible();
        },
    },
    {
        name: 'selection-vide',
        reach: async (page) => {
            // Trois créneaux vides, un ticket copié avant : au clavier, le menu s'ouvre
            // sur « Nouveau ticket… », le premier choix, qui sert aussi ici.
            await clickSlot(page, '09:15');
            await page.keyboard.press('ControlOrMeta+C');
            await clickSlot(page, '08:15');
            await clickSlot(page, '08:45', ['Shift']);
            await page.keyboard.press('Shift+F10');
            await expect(menu(page).getByRole('menuitem', { name: 'Nouveau ticket…' })).toBeFocused();
        },
    },
    {
        name: 'annulation',
        reach: async (page) => {
            await clickSlot(page, '11:15');
            await clickSlot(page, '11:30', ['Shift']);
            await page.keyboard.press('Delete');
            await expect(message(page)).toContainText('SHOP-519 effacé');
            await page.mouse.move(0, 0);
        },
    },
    {
        name: 'objectif',
        reach: async (page) => {
            await objectiveButton(page).click();
            for (let step = 0; step < 6; step += 1) {
                await objectiveWindow(page).getByRole('button', { name: 'Enlever 15 minutes' }).click();
            }
            await objectiveWindow(page).getByLabel('Durée à travailler').focus();
            await expect(objectiveWindow(page).getByLabel('Durée à travailler')).toHaveValue('6h00');
        },
    },
    {
        name: 'remplacer',
        reach: async (page) => {
            // Une demi-heure au milieu de SHOP-482, et OPS-12 tapé dessus.
            await clickSlot(page, '10:00');
            await clickSlot(page, '10:15', ['Shift']);
            await page.keyboard.type('OPS-12');
            await expect(ticketWindow(page).getByText('Remplace SHOP-482 sur ces 30 minutes.')).toBeVisible();
        },
    },
    {
        name: 'remplace',
        reach: async (page) => {
            await clickSlot(page, '10:00');
            await clickSlot(page, '10:15', ['Shift']);
            await page.keyboard.type('OPS-12');
            await ticketWindow(page).getByLabel('Commentaire').fill('Point client');
            await page.keyboard.press('Enter');
            await expect(message(page)).toContainText('SHOP-482 remplacé de 10:00 à 10:30');
            await page.mouse.move(0, 0);
        },
    },
    {
        // La fenêtre ouverte sur 17:00, la grille remontée : arrêtée en bas, sans flèche.
        name: 'ajout-defile',
        reach: async (page) => {
            await doubleClickSlot(page, '17:00', 560);
            await ticketWindow(page).getByLabel('Ticket').fill('SHOP-519');
            await ticketWindow(page).getByLabel('Commentaire').fill('Correctif');
            await expect(ticketWindow(page).getByText('Le total du panier ignore la remise')).toBeVisible();
            await page.getByRole('region', { name: 'Grille de la journée' }).evaluate((region) => {
                region.scrollTop = 0;
            });
        },
    },
    {
        name: 'edition-clavier',
        reach: async (page) => {
            // Entrée, sans pointeur : au milieu de la colonne, sous le créneau sélectionné.
            await clickSlot(page, '10:00');
            await page.mouse.move(0, 0);
            await page.keyboard.press('Enter');
            await expect(ticketWindow(page, 'Modifier le ticket')).toBeVisible();
        },
    },
    {
        name: 'menu-nouveau',
        reach: async (page) => {
            // Trois créneaux vides, « Nouveau ticket… » choisi dans le menu du clic droit : la
            // fenêtre là où était le coin du menu.
            await clickSlot(page, '08:15');
            await clickSlot(page, '08:45', ['Shift']);
            await rightClickSlot(page, '08:15', 420);
            await menu(page).getByRole('menuitem', { name: 'Nouveau ticket…' }).click();
            await expect(ticketWindow(page)).toBeVisible();
            await page.mouse.move(0, 0);
        },
    },
    {
        name: 'modifier-selection',
        reach: async (page) => {
            // 10:00 à 10:45 dans SHOP-482, « Modifier la sélection… » choisi dans le menu du
            // clic droit : la fenêtre remplie là où était le coin du menu, le curseur dans le
            // champ Ticket.
            await clickSlot(page, '10:00');
            await clickSlot(page, '10:30', ['Shift']);
            await rightClickSlot(page, '10:00', 420);
            await menu(page).getByRole('menuitem', { name: 'Modifier la sélection…' }).click();
            await expect(ticketWindow(page, 'Modifier la sélection').getByLabel('Ticket')).toBeFocused();
            await page.mouse.move(0, 0);
        },
    },
];
