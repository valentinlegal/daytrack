import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { addDays, claimDay, SAME_ORIGIN, startTimeAt, writeDay } from './day';
import {
    blocks,
    clickSlot,
    describedWrites,
    doubleClickSlot,
    expectGridMatchesBase,
    figures,
    menu,
    message,
    openDay,
    recordWrites,
    rightClickSlot,
    scrollGridTo,
    slotPoint,
    ticketWindow,
} from './editing';
import { expect, expectAccessible, refusedWith, test } from './fixtures';
import {
    dayButton,
    isoWeekday,
    postRecurrence,
    type Range,
    recurrenceBox,
    serverToday,
    times,
    until,
} from './recurrence';

/**
 * Couper, allonger et raccourcir un bloc qui revient, dans la grille, à la souris et au
 * clavier : chaque question, ses deux réponses, annuler et rétablir, récurrence comprise ;
 * coller une récurrence coupée sur un autre créneau, puis sur un autre jour, qui prend son jour
 * de la semaine ; un favori déposé et Nouveau ticket au bord d'un bloc qui revient ; un
 * effacement au milieu qui ne demande rien ; un créneau qu'une autre récurrence prend ; les
 * bords de la journée, 07:00 et 20:00.
 *
 * « Cette fois et les suivantes » change les heures d'une récurrence à partir de cette fois :
 * le serveur ne le fait jamais sur un jour passé. Les parcours prennent donc de vrais jours à
 * venir, le lundi et le jeudi de la quatrième semaine.
 *
 * La version d'un jour à venir suit chaque récurrence qui y tombe, à n'importe quelle heure : née
 * ou retirée par un autre parcours entre le moment où une page lit la journée et son geste
 * suivant, elle fait refuser ce geste comme venu d'un onglet en retard (409). Aucun autre
 * parcours n'en fait donc tomber une ces jours-là : ceux des récurrences prennent les mardis,
 * mercredis et vendredis, jusqu'à deux mois ou sans fin, et les lundis et jeudis des trois
 * premières semaines, qu'elles ne dépassent pas (tests/e2e/recurrences.spec.ts,
 * tests/e2e/recurrence-rhythms.spec.ts). Les parcours de ce fichier passent l'un après l'autre,
 * sur ces deux jours et à des heures que les autres ne prennent pas (SLOTS) ; chacun vérifie
 * ses créneaux vides avant d'y poser quoi que ce soit, et retire ses récurrences quand il
 * s'arrête, même s'il échoue. Chacune finit au plus tard un mois après eux.
 *
 * La semaine d'après le second jour est au-delà des trente jours que l'application ouvre : ce
 * qui revient ensuite se lit dans les prochaines fois de la fenêtre, et chaque récurrence posée
 * le premier jour revient aussi le second, où la grille le montre.
 */
test.describe.configure({ mode: 'default' });

const WEEKDAY_WORDS = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const MONTH_WORDS = [
    'janvier',
    'février',
    'mars',
    'avril',
    'mai',
    'juin',
    'juillet',
    'août',
    'septembre',
    'octobre',
    'novembre',
    'décembre',
];

/** Un jour tel que la question le dit : « lundi 7 décembre », « mardi 1er juin ». */
function dayWords(date: string): string {
    const number = Number(date.slice(8));

    return `${WEEKDAY_WORDS[isoWeekday(date)] ?? ''} ${number === 1 ? '1er' : String(number)} ${MONTH_WORDS[Number(date.slice(5, 7)) - 1] ?? ''}`;
}

/** Le même, comme une prochaine fois le lit : « Lundi 7 décembre ». */
function dayTitle(date: string): string {
    const words = dayWords(date);

    return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Le nom d'un bouton de jour : « Lundi ». */
function weekdayTitle(date: string): string {
    const word = WEEKDAY_WORDS[isoWeekday(date)] ?? '';

    return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Le jour de la semaine ISO `weekday` entre 22 et 28 jours après `today`. */
function fourthWeek(today: string, weekday: number): string {
    const first = addDays(today, 22);

    return addDays(first, (weekday - isoWeekday(first) + 7) % 7);
}

interface ShownBlock {
    readonly start: string;
    readonly end: string;
    readonly kind: string;
    readonly ticket: string | null;
    readonly comment: string | null;
    readonly recurrence: string | null;
}

interface ShownRecurrence {
    readonly start: string;
    readonly end: string;
    readonly weekdays: number[];
    readonly everyWeeks: number;
    readonly firstDay: string;
    readonly until: string | null;
    readonly slot: { readonly kind: string; readonly ticket: string | null; readonly comment: string | null };
}

interface ShownDay {
    readonly version: number;
    readonly blocks: ShownBlock[];
    readonly recurrences: Record<string, ShownRecurrence>;
    readonly ongoing: Record<string, ShownRecurrence>;
}

async function shownDay(request: APIRequestContext, date: string): Promise<ShownDay> {
    return (await (await request.get(`/api/days/${date}`)).json()) as ShownDay;
}

/** La récurrence que porte le bloc de `start`, telle que la base la garde ; null s'il n'en porte pas. */
async function recurrenceAt(request: APIRequestContext, date: string, start: string): Promise<ShownRecurrence | null> {
    const day = await shownDay(request, date);
    const id = day.blocks.find((block) => block.start === start)?.recurrence ?? null;

    return id === null ? null : (day.recurrences[id] ?? null);
}

/** Les deux jours des parcours : le plus tôt et le plus tard du lundi et du jeudi de la quatrième semaine. */
interface Days {
    readonly early: string;
    readonly late: string;
}

/**
 * Les créneaux des parcours. Aucun autre parcours n'y coche la case « Récurrence » : une
 * récurrence de ces jours-là y marquerait « Pris » ses prochaines fois. Aucun n'y pose une
 * récurrence qui revient ces jours-là : celles du soir, de 18:00 à 18:45, peuvent y tomber.
 */
const SLOTS: readonly Range[] = [
    { start: '07:00', end: '07:30' },
    { start: '11:00', end: '12:00' },
    { start: '17:00', end: '18:00' },
    { start: '19:00', end: '20:00' },
];

/**
 * Prend les deux jours pour le parcours, et vérifie que ses créneaux y sont vides : ni saisie,
 * ni fois prévue d'une récurrence. Un reste d'un parcours interrompu, ou une récurrence de la
 * base de développement, se dit ici, avant que le parcours ne pose rien.
 */
async function takeDays(request: APIRequestContext): Promise<Days> {
    const today = serverToday();
    const [early = '', late = ''] = [fourthWeek(today, 1), fourthWeek(today, 4)].sort();
    for (const date of [early, late]) {
        claimDay(date);
        const shown = (await shownDay(request, date)).blocks.filter((block) =>
            SLOTS.some((slot) => block.start < slot.end && slot.start < block.end),
        );
        if (shown.length > 0) {
            const named = shown
                .map((block) => `${block.start}–${block.end} ${block.comment ?? block.ticket ?? 'pause'}`)
                .join(', ');
            throw new Error(
                `Le ${date} n'est pas vide : ${named}. Ces parcours y posent leurs récurrences : retirez ce qui s'y trouve.`,
            );
        }
    }

    return { early, late };
}

/**
 * Le créneau ne revient par aucune récurrence d'ailleurs, quel que soit son jour : une
 * récurrence collée qui revient au-delà des deux jours des parcours y serait refusée.
 */
async function expectSlotFree(request: APIRequestContext, days: Days, range: Range): Promise<void> {
    const { ongoing } = await shownDay(request, days.early);
    const taken = Object.values(ongoing).filter(
        (other) =>
            other.firstDay !== days.early &&
            other.firstDay !== days.late &&
            other.start < range.end &&
            range.start < other.end,
    );
    if (taken.length > 0) {
        const named = taken
            .map((other) => `${other.slot.comment ?? other.slot.ticket ?? 'une pause'} (${other.start}–${other.end})`)
            .join(', ');
        throw new Error(
            `De ${range.start} à ${range.end}, une récurrence de la base de développement revient : ${named}. Ce parcours a besoin de ce créneau libre.`,
        );
    }
}

/**
 * Retire chaque récurrence née sur l'un des deux jours, comme annuler sa création : sa fin
 * revient à la veille de son premier jour, et elle ne tombe plus jamais, même si ce jour-là
 * n'en montre plus rien — une fois détachée « cette fois seulement ». Les jours se vident
 * ensuite (fixtures.ts). Toutes sont essayées, même si l'une refuse.
 */
async function withdrawOurs(request: APIRequestContext, days: Days): Promise<void> {
    const ours = [days.early, days.late];
    const { ongoing } = await shownDay(request, days.early);
    const failures: unknown[] = [];
    for (const [id, rule] of Object.entries(ongoing)) {
        if (!ours.includes(rule.firstDay)) {
            continue;
        }
        try {
            const { version } = await shownDay(request, rule.firstDay);
            const response = await request.patch(`/api/days/${rule.firstDay}/slots`, {
                headers: SAME_ORIGIN,
                data: {
                    version,
                    changes: [],
                    recurrences: [{ recurrence: id, from: rule.until, to: addDays(rule.firstDay, -1) }],
                },
            });
            if (!response.ok()) {
                throw new Error(
                    `L'API ne retire pas la récurrence ${id} : ${String(response.status())} ${await response.text()}`,
                );
            }
        } catch (error) {
            failures.push(error);
        }
    }
    if (failures.length > 0) {
        throw failures[0];
    }
}

/** La question « quelles fois », par son titre. */
function question(page: Page, title: string): Locator {
    return page.getByRole('dialog', { name: title });
}

/** Le bloc qui porte ce texte : son commentaire, sinon son ticket. */
function block(page: Page, text: string): Locator {
    return blocks(page).filter({ hasText: text });
}

/** Revient chaque semaine les deux jours des parcours : le lundi et le jeudi. */
const BOTH = 'Revient chaque semaine, lundi et jeudi';

/** Une récurrence des deux jours, née le premier, qui finit le second. */
async function postBoth(request: APIRequestContext, days: Days, range: Range): Promise<void> {
    await postRecurrence(request, days.early, range, [1, 4], days.late);
}

/** Va au jour d'avant ou d'après, par les flèches de la barre, jusqu'à ce jour-là. */
async function travelTo(page: Page, date: string): Promise<void> {
    for (let left = 10; left > 0 && new URL(page.url()).pathname !== `/${date}`; left -= 1) {
        const shown = new URL(page.url()).pathname;
        await page.getByRole('button', { name: `/${date}` < shown ? 'Jour précédent' : 'Jour suivant' }).click();
        await expect(page).not.toHaveURL(shown);
    }
    await expect(page).toHaveURL(`/${date}`);
    await expect(figures(page)).toBeVisible();
}

/** Ouvre le premier jour, vu d'aujourd'hui à 08:00. */
async function openEarly(page: Page, days: Days): Promise<void> {
    await startTimeAt(page, serverToday(), '08:00');
    await openDay(page, days.early);
}

test.describe('couper un bloc qui revient', () => {
    test('avec les suivantes, au clavier : collé sur un autre créneau, les fois suivantes s’y déplacent ; annuler et rétablir', async ({
        page,
        request,
    }) => {
        const days = await takeDays(request);
        const review = { start: '11:00', end: '11:30', ticket: 'OPS-12', comment: 'Revue de sprint' };
        try {
            await postBoth(request, days, review);
            await openEarly(page, days);
            await expect(block(page, 'Revue de sprint').getByRole('img', { name: BOTH })).toBeVisible();

            // Le bloc entier, au clavier : Ctrl+X pose la question, « Cette fois seulement » choisi.
            await clickSlot(page, '11:00');
            await page.keyboard.press('Shift+ArrowDown');
            await page.keyboard.press('ControlOrMeta+X');
            const cut = question(page, 'Couper une récurrence');
            await expect(cut).toContainText(`Revue de sprint, ${dayWords(days.early)}`);
            await expect(
                cut.getByText(
                    'Les fois suivantes se déplacent là où vous collez. Les fois passées ne changent jamais.',
                ),
            ).toBeVisible();
            await expect(cut.getByRole('radio', { name: 'Cette fois seulement' })).toBeFocused();
            await expect(cut.getByRole('radio', { name: 'Cette fois seulement' })).toBeChecked();
            await expect(cut.getByRole('button', { name: 'Annuler' })).toBeVisible();
            await expectAccessible(page);

            // Échap n'y coupe rien.
            await page.keyboard.press('Escape');
            await expect(cut).toBeHidden();
            await expect(block(page, 'Revue de sprint')).toHaveCount(1);

            await page.keyboard.press('ControlOrMeta+X');
            await expect(cut.getByRole('radio', { name: 'Cette fois seulement' })).toBeFocused();
            await page.keyboard.press('ArrowDown');
            await expect(cut.getByRole('radio', { name: 'Cette fois et les suivantes' })).toBeChecked();
            await page.keyboard.press('Enter');
            await expect(cut).toBeHidden();
            await expect(message(page)).toContainText('OPS-12 coupé');
            await expect(block(page, 'Revue de sprint')).toHaveCount(0);
            await expectGridMatchesBase(page, request, days.early);

            // Collé à 17:00 sur un seul quart d'heure : son bloc à sa longueur, et son rythme.
            await clickSlot(page, '17:00');
            await page.keyboard.press('ControlOrMeta+V');
            const moved = block(page, 'Revue de sprint');
            await expect(moved).toContainText('De 17:00 à 17:30');
            await expect(moved.getByRole('img', { name: BOTH })).toBeVisible();
            await expectGridMatchesBase(page, request, days.early);
            expect(await recurrenceAt(request, days.early, '17:00')).toMatchObject({
                start: '17:00',
                end: '17:30',
                weekdays: [1, 4],
                firstDay: days.early,
                until: days.late,
            });

            // Le collage suivant colle le bloc seul.
            await clickSlot(page, '19:00');
            await page.keyboard.press('ControlOrMeta+V');
            await expect(block(page, 'Revue de sprint')).toHaveCount(2);
            await expect(block(page, 'Revue de sprint').getByRole('img', { name: BOTH })).toHaveCount(1);
            await expectGridMatchesBase(page, request, days.early);

            // Le second jour, la fois suivante est à 17:00, et plus rien à 11:00.
            await travelTo(page, days.late);
            await expect(block(page, 'Revue de sprint')).toHaveCount(1);
            await expect(block(page, 'Revue de sprint')).toContainText('De 17:00 à 17:30');
            await expect(block(page, 'Revue de sprint').getByRole('img', { name: BOTH })).toBeVisible();
            await expectGridMatchesBase(page, request, days.late);

            // Annuler les deux collages puis la coupe rend le bloc à 11:00 ; rétablir refait tout.
            await travelTo(page, days.early);
            await page.keyboard.press('ControlOrMeta+Z');
            await expect(block(page, 'Revue de sprint')).toHaveCount(1);
            await expectGridMatchesBase(page, request, days.early);
            await page.keyboard.press('ControlOrMeta+Z');
            await expect(block(page, 'Revue de sprint')).toHaveCount(0);
            await expectGridMatchesBase(page, request, days.early);
            await page.keyboard.press('ControlOrMeta+Z');
            await expect(block(page, 'Revue de sprint')).toContainText('De 11:00 à 11:30');
            await expect(block(page, 'Revue de sprint').getByRole('img', { name: BOTH })).toBeVisible();
            await expectGridMatchesBase(page, request, days.early);
            expect(await recurrenceAt(request, days.early, '11:00')).toMatchObject({ until: days.late });

            for (let step = 0; step < 3; step += 1) {
                await page.keyboard.press('ControlOrMeta+Shift+Z');
                await expectGridMatchesBase(page, request, days.early);
            }
            await expect(block(page, 'Revue de sprint')).toHaveCount(2);
            await expect(block(page, 'Revue de sprint').first()).toContainText('De 17:00 à 17:30');
            await expect(block(page, 'Revue de sprint').first().getByRole('img', { name: BOTH })).toBeVisible();
            await travelTo(page, days.late);
            await expect(block(page, 'Revue de sprint')).toContainText('De 17:00 à 17:30');
            await expectGridMatchesBase(page, request, days.late);
        } finally {
            await withdrawOurs(request, days);
        }
    });

    test.describe('puis défait à contretemps', () => {
        // Annuler la coupe avant le collage, ou rétablir le collage avant la coupe, se refuse (422).
        test.use({ expectedErrors: [refusedWith(422)] });

        test('avec les suivantes, à la souris, puis collé un autre jour : une semaine sur deux, au jour du collage', async ({
            page,
            request,
        }) => {
            const days = await takeDays(request);
            const poker = { start: '11:00', end: '11:30', ticket: 'OPS-12', comment: 'Poker planning' };
            const pasted = { start: '17:00', end: '17:30' };
            await expectSlotFree(request, days, pasted);
            const before = `Revient un ${WEEKDAY_WORDS[isoWeekday(days.early)] ?? ''} sur deux`;
            const after = `Revient un ${WEEKDAY_WORDS[isoWeekday(days.late)] ?? ''} sur deux`;
            try {
                await postRecurrence(request, days.early, poker, [isoWeekday(days.early)], addDays(days.early, 28), {
                    everyWeeks: 2,
                });
                await startTimeAt(page, serverToday(), '08:00');
                await openDay(page, days.early);
                await expect(block(page, 'Poker planning').getByRole('img', { name: before })).toBeVisible();

                // Le bloc entier à la souris, Couper du menu, et la souris répond.
                await clickSlot(page, '11:00');
                await clickSlot(page, '11:15', ['Shift']);
                await rightClickSlot(page, '11:00');
                await menu(page).getByRole('menuitem', { name: 'Couper' }).click();
                const cut = question(page, 'Couper une récurrence');
                await expect(cut).toContainText(`Poker planning, ${dayWords(days.early)}`);
                await cut.getByText('Cette fois et les suivantes').click();
                await cut.getByRole('button', { name: 'Couper' }).click();
                await expect(cut).toBeHidden();
                await expect(message(page)).toContainText('OPS-12 coupé');
                await expect(block(page, 'Poker planning')).toHaveCount(0);
                await expectGridMatchesBase(page, request, days.early);

                // Un jour après la coupe, avant de coller : la récurrence en repart, à son jour de la semaine.
                await travelTo(page, days.late);
                await clickSlot(page, pasted.start);
                await rightClickSlot(page, pasted.start);
                await menu(page).getByRole('menuitem', { name: 'Coller' }).click();
                const moved = block(page, 'Poker planning');
                await expect(moved).toContainText('De 17:00 à 17:30');
                await expect(moved.getByRole('img', { name: after })).toBeVisible();
                await expect(page.getByRole('dialog')).toHaveCount(0);
                await expectGridMatchesBase(page, request, days.late);
                expect(await recurrenceAt(request, days.late, '17:00')).toMatchObject({
                    weekdays: [isoWeekday(days.late)],
                    everyWeeks: 2,
                    firstDay: days.late,
                    until: addDays(days.early, 28),
                });

                // Sa fenêtre le dit : une semaine sur deux, son jour, et la semaine sans avant la suivante.
                await doubleClickSlot(page, '17:00');
                const window = ticketWindow(page, 'Modifier le ticket');
                await expect(recurrenceBox(window)).toBeChecked();
                await expect(
                    window
                        .getByRole('radiogroup', { name: 'Rythme' })
                        .getByRole('radio', { name: 'Une semaine sur 2' }),
                ).toBeChecked();
                await expect(dayButton(window, weekdayTitle(days.late))).toHaveAttribute('aria-pressed', 'true');
                await expect(dayButton(window, weekdayTitle(days.early))).toHaveAttribute('aria-pressed', 'false');
                await expect(times(window).nth(0)).toHaveAccessibleName(
                    `${dayTitle(addDays(days.late, 7))}, rien ce jour-là`,
                );
                await expect(times(window).nth(1)).toHaveAccessibleName(dayTitle(addDays(days.late, 14)));
                await page.keyboard.press('Escape');
                await expect(window).toBeHidden();

                // Le jour de la coupe : plus rien. Ctrl+Z, sur lui, la ferait revivre à ses deux places :
                // refusé, il dit d'annuler le collage d'abord.
                await travelTo(page, days.early);
                await expect(block(page, 'Poker planning')).toHaveCount(0);
                await page.keyboard.press('ControlOrMeta+Z');
                await expect(message(page)).toContainText(`Annulez d'abord le collage du ${dayWords(days.late)}.`);
                await expect(block(page, 'Poker planning')).toHaveCount(0);
                await expectGridMatchesBase(page, request, days.early);

                // Annuler le collage, sur son jour, retire la récurrence qu'il a fait repartir ; la coupe
                // s'annule ensuite, et rend le bloc et sa récurrence.
                await travelTo(page, days.late);
                await page.keyboard.press('ControlOrMeta+Z');
                await expect(block(page, 'Poker planning')).toHaveCount(0);
                await expectGridMatchesBase(page, request, days.late);
                await travelTo(page, days.early);
                await page.keyboard.press('ControlOrMeta+Z');
                await expect(block(page, 'Poker planning').getByRole('img', { name: before })).toBeVisible();
                await expectGridMatchesBase(page, request, days.early);

                // Rétablir le collage, la coupe annulée, la doublerait : refusé, il dit de rétablir la
                // coupe d'abord. Rétablie, le collage se rétablit.
                await travelTo(page, days.late);
                await page.keyboard.press('ControlOrMeta+Shift+Z');
                await expect(message(page)).toContainText(`Rétablissez d'abord la coupe du ${dayWords(days.early)}.`);
                await expect(block(page, 'Poker planning')).toHaveCount(0);
                await expectGridMatchesBase(page, request, days.late);
                await travelTo(page, days.early);
                await page.keyboard.press('ControlOrMeta+Shift+Z');
                await expect(block(page, 'Poker planning')).toHaveCount(0);
                await expectGridMatchesBase(page, request, days.early);
                await travelTo(page, days.late);
                await page.keyboard.press('ControlOrMeta+Shift+Z');
                await expect(block(page, 'Poker planning').getByRole('img', { name: after })).toBeVisible();
                await expectGridMatchesBase(page, request, days.late);
            } finally {
                await withdrawOurs(request, days);
            }
        });
    });

    test('cette fois seulement : la coupe ordinaire, collée sans récurrence ; le second jour garde la sienne', async ({
        page,
        request,
    }) => {
        const days = await takeDays(request);
        const review = { start: '11:00', end: '11:30', ticket: 'OPS-12', comment: 'Revue de sprint' };
        try {
            await postBoth(request, days, review);
            await openEarly(page, days);

            await clickSlot(page, '11:00');
            await page.keyboard.press('Shift+ArrowDown');
            await page.keyboard.press('ControlOrMeta+X');
            await expect(question(page, 'Couper une récurrence')).toBeVisible();
            await page.keyboard.press('Enter');
            await expect(question(page, 'Couper une récurrence')).toBeHidden();
            await expect(message(page)).toContainText('OPS-12 coupé');
            await expect(block(page, 'Revue de sprint')).toHaveCount(0);

            await clickSlot(page, '17:00');
            await page.keyboard.press('ControlOrMeta+V');
            await expect(block(page, 'Revue de sprint')).toContainText('De 17:00 à 17:30');
            await expect(block(page, 'Revue de sprint').getByRole('img')).toHaveCount(0);
            await expectGridMatchesBase(page, request, days.early);
            expect(await recurrenceAt(request, days.early, '17:00')).toBeNull();

            await travelTo(page, days.late);
            await expect(block(page, 'Revue de sprint')).toContainText('De 11:00 à 11:30');
            await expect(block(page, 'Revue de sprint').getByRole('img', { name: BOTH })).toBeVisible();

            // Annuler le collage puis la coupe rend le bloc et sa flèche ; rétablir les refait.
            await travelTo(page, days.early);
            await page.keyboard.press('ControlOrMeta+Z');
            await page.keyboard.press('ControlOrMeta+Z');
            await expect(block(page, 'Revue de sprint')).toContainText('De 11:00 à 11:30');
            await expect(block(page, 'Revue de sprint').getByRole('img', { name: BOTH })).toBeVisible();
            await expectGridMatchesBase(page, request, days.early);
            await page.keyboard.press('ControlOrMeta+Shift+Z');
            await page.keyboard.press('ControlOrMeta+Shift+Z');
            await expect(block(page, 'Revue de sprint')).toContainText('De 17:00 à 17:30');
            await expectGridMatchesBase(page, request, days.early);
        } finally {
            await withdrawOurs(request, days);
        }
    });
});

test.describe('allonger un bloc qui revient', () => {
    test('en collant dessous au clavier, puis dessus à la souris, avec les suivantes : un seul bloc à ses nouvelles heures', async ({
        page,
        request,
    }) => {
        const days = await takeDays(request);
        const alerts = { start: '11:15', end: '11:45', ticket: 'OPS-21', comment: 'Revue des alertes' };
        try {
            await postBoth(request, days, alerts);
            await openEarly(page, days);

            // Son premier quart d'heure copié, collé juste dessous : « Allonger une récurrence ».
            await clickSlot(page, '11:15');
            await page.keyboard.press('ControlOrMeta+C');
            await clickSlot(page, '11:45');
            await page.keyboard.press('ControlOrMeta+V');
            const extend = question(page, 'Allonger une récurrence');
            await expect(extend).toContainText(`Revue des alertes, ${dayWords(days.early)}, de 11:15 à 12:00`);
            await expect(extend.getByRole('radio', { name: 'Cette fois seulement' })).toBeFocused();
            await expect(extend.getByRole('button', { name: 'Annuler' })).toBeVisible();
            await expect(extend.getByRole('button', { name: 'Allonger' })).toBeVisible();
            // Rien ne s'écrit tant qu'on n'a pas répondu.
            await expect(block(page, 'Revue des alertes')).toContainText('De 11:15 à 11:45');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Enter');
            await expect(extend).toBeHidden();
            await expect(block(page, 'Revue des alertes')).toHaveCount(1);
            await expect(block(page, 'Revue des alertes')).toContainText('De 11:15 à 12:00');
            await expect(block(page, 'Revue des alertes').getByRole('img', { name: BOTH })).toBeVisible();
            // Allonger ne dit rien : le bloc se voit.
            await expect(message(page)).toHaveCount(0);
            await expectGridMatchesBase(page, request, days.early);

            // Dessus, à la souris, par Coller du menu.
            await clickSlot(page, '11:00');
            await rightClickSlot(page, '11:00');
            await menu(page).getByRole('menuitem', { name: 'Coller' }).click();
            await expect(extend).toContainText(`Revue des alertes, ${dayWords(days.early)}, de 11:00 à 12:00`);
            await extend.getByText('Cette fois et les suivantes').click();
            await extend.getByRole('button', { name: 'Allonger' }).click();
            await expect(extend).toBeHidden();
            await expect(block(page, 'Revue des alertes')).toContainText('De 11:00 à 12:00');
            await expectGridMatchesBase(page, request, days.early);
            expect(await recurrenceAt(request, days.early, '11:00')).toMatchObject({
                start: '11:00',
                end: '12:00',
                firstDay: days.early,
                until: days.late,
            });

            // La fois suivante a ses nouvelles heures.
            await travelTo(page, days.late);
            await expect(block(page, 'Revue des alertes')).toContainText('De 11:00 à 12:00');
            await expect(block(page, 'Revue des alertes').getByRole('img', { name: BOTH })).toBeVisible();
            await expectGridMatchesBase(page, request, days.late);

            // Annuler défait les deux, récurrence comprise ; rétablir les refait.
            await travelTo(page, days.early);
            await page.keyboard.press('ControlOrMeta+Z');
            await expect(block(page, 'Revue des alertes')).toContainText('De 11:15 à 12:00');
            await expectGridMatchesBase(page, request, days.early);
            await page.keyboard.press('ControlOrMeta+Z');
            await expect(block(page, 'Revue des alertes')).toContainText('De 11:15 à 11:45');
            await expect(block(page, 'Revue des alertes').getByRole('img', { name: BOTH })).toBeVisible();
            await expectGridMatchesBase(page, request, days.early);
            expect(await recurrenceAt(request, days.early, '11:15')).toMatchObject({ end: '11:45', until: days.late });
            await page.keyboard.press('ControlOrMeta+Shift+Z');
            await page.keyboard.press('ControlOrMeta+Shift+Z');
            await expect(block(page, 'Revue des alertes')).toContainText('De 11:00 à 12:00');
            await expectGridMatchesBase(page, request, days.early);
            await travelTo(page, days.late);
            await expect(block(page, 'Revue des alertes')).toContainText('De 11:00 à 12:00');
        } finally {
            await withdrawOurs(request, days);
        }
    });

    test('en déposant un favori au bord, cette fois seulement : un seul bloc, sans flèche ; le second jour ne change pas', async ({
        page,
        request,
    }) => {
        const days = await takeDays(request);
        const support = { start: '17:00', end: '17:30', ticket: 'OPS-7' };
        try {
            await postBoth(request, days, support);
            await openEarly(page, days);
            await expect(block(page, 'OPS-7').getByRole('img', { name: BOTH })).toBeVisible();

            // Loin du bas de la grille : près de lui, elle défilerait sous le pointeur.
            await scrollGridTo(page, '15:00');
            const card = page
                .getByRole('complementary', { name: 'Favoris et calendrier' })
                .getByRole('list', { name: 'Favoris' })
                .locator('[data-favorite]')
                .filter({ hasText: 'OPS-7' });
            // La liste des favoris défile sur un écran bas : la carte d'abord à l'écran.
            await card.scrollIntoViewIfNeeded();
            const from = await card.boundingBox();
            if (from === null) {
                throw new Error('Le favori OPS-7 n’est pas à l’écran.');
            }
            const to = await slotPoint(page, '17:30');
            await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
            await page.mouse.down();
            await page.mouse.move(to.x, to.y, { steps: 8 });
            await expect(page.getByText('17:30 à 17:45', { exact: true })).toBeVisible();
            await page.mouse.up();

            const extend = question(page, 'Allonger une récurrence');
            await expect(extend).toContainText(`OPS-7, ${dayWords(days.early)}, de 17:00 à 17:45`);
            await expect(extend.getByRole('radio', { name: 'Cette fois seulement' })).toBeFocused();
            await page.keyboard.press('Enter');
            await expect(extend).toBeHidden();
            await expect(block(page, 'OPS-7')).toHaveCount(1);
            await expect(block(page, 'OPS-7')).toContainText('De 17:00 à 17:45');
            await expect(block(page, 'OPS-7').getByRole('img')).toHaveCount(0);
            await expectGridMatchesBase(page, request, days.early);

            await travelTo(page, days.late);
            await expect(block(page, 'OPS-7')).toContainText('De 17:00 à 17:30');
            await expect(block(page, 'OPS-7').getByRole('img', { name: BOTH })).toBeVisible();

            // Ctrl+Z rend le bloc d'avant et sa flèche ; rétablir l'allonge de nouveau.
            await travelTo(page, days.early);
            await page.keyboard.press('ControlOrMeta+Z');
            await expect(block(page, 'OPS-7')).toContainText('De 17:00 à 17:30');
            await expect(block(page, 'OPS-7').getByRole('img', { name: BOTH })).toBeVisible();
            await expectGridMatchesBase(page, request, days.early);
            await page.keyboard.press('ControlOrMeta+Shift+Z');
            await expect(block(page, 'OPS-7')).toContainText('De 17:00 à 17:45');
            await expect(block(page, 'OPS-7').getByRole('img')).toHaveCount(0);
            await expectGridMatchesBase(page, request, days.early);
        } finally {
            await withdrawOurs(request, days);
        }
    });

    test('depuis Nouveau ticket, au même rythme et à la même fin : la question prend la place de la fenêtre, Retour la rend', async ({
        page,
        request,
    }) => {
        const days = await takeDays(request);
        const code = { start: '17:00', end: '17:30', ticket: 'SHOP-482', comment: 'Revue de code' };
        try {
            await postBoth(request, days, code);
            await openEarly(page, days);

            await doubleClickSlot(page, '17:30');
            const window = ticketWindow(page);
            await window.getByLabel('Ticket').fill('SHOP-482');
            await window.getByLabel('Commentaire').fill('Revue de code');
            await recurrenceBox(window).click();
            await dayButton(window, weekdayTitle(days.late)).click();
            await until(window).fill(days.late);
            await window.getByRole('button', { name: 'Enregistrer' }).click();

            const extend = question(page, 'Allonger une récurrence');
            await expect(extend).toContainText(`Revue de code, ${dayWords(days.early)}, de 17:00 à 17:45`);
            await expect(extend.getByRole('button', { name: 'Retour' })).toBeVisible();
            await expect(extend.getByRole('button', { name: 'Allonger' })).toBeVisible();
            await expect(extend.getByRole('radio', { name: 'Cette fois seulement' })).toBeFocused();
            await expectAccessible(page);

            // Retour rend la fenêtre telle qu'on l'a laissée.
            await extend.getByRole('button', { name: 'Retour' }).click();
            await expect(window.getByLabel('Ticket')).toHaveValue('SHOP-482');
            await expect(window.getByLabel('Commentaire')).toHaveValue('Revue de code');
            await expect(recurrenceBox(window)).toBeChecked();
            await expect(dayButton(window, weekdayTitle(days.late))).toHaveAttribute('aria-pressed', 'true');
            await expect(until(window)).toHaveValue(days.late);

            // Entrée l'enregistre de nouveau ; avec les suivantes, un seul bloc, une seule récurrence.
            await window.getByLabel('Commentaire').press('Enter');
            await expect(extend.getByRole('radio', { name: 'Cette fois seulement' })).toBeFocused();
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Enter');
            await expect(extend).toBeHidden();
            await expect(block(page, 'Revue de code')).toHaveCount(1);
            await expect(block(page, 'Revue de code')).toContainText('De 17:00 à 17:45');
            await expect(block(page, 'Revue de code').getByRole('img', { name: BOTH })).toBeVisible();
            await expectGridMatchesBase(page, request, days.early);
            const { ongoing } = await shownDay(request, days.early);
            expect(
                Object.values(ongoing)
                    .filter((rule) => rule.slot.comment === 'Revue de code')
                    .map(({ start, end, firstDay }) => ({ start, end, firstDay })),
            ).toEqual([{ start: '17:00', end: '17:45', firstDay: days.early }]);

            await travelTo(page, days.late);
            await expect(block(page, 'Revue de code')).toContainText('De 17:00 à 17:45');

            await travelTo(page, days.early);
            await page.keyboard.press('ControlOrMeta+Z');
            await expect(block(page, 'Revue de code')).toContainText('De 17:00 à 17:30');
            await expect(block(page, 'Revue de code').getByRole('img', { name: BOTH })).toBeVisible();
            await expectGridMatchesBase(page, request, days.early);
            await page.keyboard.press('ControlOrMeta+Shift+Z');
            await expect(block(page, 'Revue de code')).toContainText('De 17:00 à 17:45');
            await expectGridMatchesBase(page, request, days.early);
        } finally {
            await withdrawOurs(request, days);
        }
    });

    test('jusqu’aux bords de la journée, avec les suivantes : jusqu’à 20:00 et depuis 07:00', async ({
        page,
        request,
    }) => {
        const days = await takeDays(request);
        const evening = { start: '19:30', end: '19:45', ticket: 'OPS-12', comment: 'Clôture du soir' };
        const morning = { start: '07:15', end: '07:30', ticket: 'OPS-12', comment: 'Point du matin' };
        try {
            await postBoth(request, days, evening);
            await postBoth(request, days, morning);
            await openEarly(page, days);
            const extend = question(page, 'Allonger une récurrence');

            await clickSlot(page, '19:30');
            await page.keyboard.press('ControlOrMeta+C');
            await clickSlot(page, '19:45');
            await page.keyboard.press('ControlOrMeta+V');
            await expect(extend).toContainText(`Clôture du soir, ${dayWords(days.early)}, de 19:30 à 20:00`);
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Enter');
            await expect(block(page, 'Clôture du soir')).toContainText('De 19:30 à 20:00');
            await expectGridMatchesBase(page, request, days.early);

            await clickSlot(page, '07:15');
            await page.keyboard.press('ControlOrMeta+C');
            await clickSlot(page, '07:00');
            await page.keyboard.press('ControlOrMeta+V');
            await expect(extend).toContainText(`Point du matin, ${dayWords(days.early)}, de 07:00 à 07:30`);
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Enter');
            await expect(block(page, 'Point du matin')).toContainText('De 07:00 à 07:30');
            await expectGridMatchesBase(page, request, days.early);
            expect(await recurrenceAt(request, days.early, '19:30')).toMatchObject({ start: '19:30', end: '20:00' });
            expect(await recurrenceAt(request, days.early, '07:00')).toMatchObject({ start: '07:00', end: '07:30' });

            await travelTo(page, days.late);
            await expect(block(page, 'Clôture du soir')).toContainText('De 19:30 à 20:00');
            await expect(block(page, 'Point du matin')).toContainText('De 07:00 à 07:30');
            await expectGridMatchesBase(page, request, days.late);

            await travelTo(page, days.early);
            await page.keyboard.press('ControlOrMeta+Z');
            await page.keyboard.press('ControlOrMeta+Z');
            await expect(block(page, 'Point du matin')).toContainText('De 07:15 à 07:30');
            await expect(block(page, 'Clôture du soir')).toContainText('De 19:30 à 19:45');
            await expectGridMatchesBase(page, request, days.early);
            await page.keyboard.press('ControlOrMeta+Shift+Z');
            await expect(block(page, 'Clôture du soir')).toContainText('De 19:30 à 20:00');
            await expectGridMatchesBase(page, request, days.early);
        } finally {
            await withdrawOurs(request, days);
        }
    });
});

test.describe('raccourcir un bloc qui revient', () => {
    test('par le bas au clavier, par le haut à la souris, avec les suivantes ; effacer au milieu ne demande rien', async ({
        page,
        request,
    }) => {
        const days = await takeDays(request);
        const security = { start: '17:00', end: '18:00', ticket: 'OPS-21', comment: 'Point sécurité' };
        try {
            await postBoth(request, days, security);
            await openEarly(page, days);

            // Au milieu : coupé en deux cette fois seulement, sans question.
            await clickSlot(page, '17:15');
            await clickSlot(page, '17:30', ['Shift']);
            await page.keyboard.press('Delete');
            await expect(message(page)).toContainText('OPS-21 effacé');
            await expect(page.getByRole('dialog')).toHaveCount(0);
            await expect(block(page, 'Point sécurité')).toHaveCount(2);
            await expectGridMatchesBase(page, request, days.early);
            await page.keyboard.press('ControlOrMeta+Z');
            await expect(block(page, 'Point sécurité')).toHaveCount(1);
            await expect(block(page, 'Point sécurité').getByRole('img', { name: BOTH })).toBeVisible();
            await expectGridMatchesBase(page, request, days.early);

            // Le bas, au clavier.
            await clickSlot(page, '17:45');
            await page.keyboard.press('Delete');
            const shorten = question(page, 'Raccourcir une récurrence');
            await expect(shorten).toContainText(`Point sécurité, ${dayWords(days.early)}, de 17:00 à 17:45`);
            await expect(shorten.getByText('Les fois passées ne changent jamais.')).toBeVisible();
            await expect(shorten.getByRole('button', { name: 'Annuler' })).toBeVisible();
            await expect(shorten.getByRole('radio', { name: 'Cette fois seulement' })).toBeFocused();
            await expectAccessible(page);
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Enter');
            await expect(shorten).toBeHidden();
            await expect(message(page)).toContainText('OPS-21 effacé');
            await expect(block(page, 'Point sécurité')).toContainText('De 17:00 à 17:45');
            await expect(block(page, 'Point sécurité').getByRole('img', { name: BOTH })).toBeVisible();
            await expectGridMatchesBase(page, request, days.early);

            // Le haut, à la souris, par Effacer du menu.
            await clickSlot(page, '17:00');
            await rightClickSlot(page, '17:00');
            await menu(page).getByRole('menuitem', { name: 'Effacer' }).click();
            await expect(shorten).toContainText(`Point sécurité, ${dayWords(days.early)}, de 17:15 à 17:45`);
            await shorten.getByText('Cette fois et les suivantes').click();
            await shorten.getByRole('button', { name: 'Raccourcir' }).click();
            await expect(shorten).toBeHidden();
            await expect(block(page, 'Point sécurité')).toContainText('De 17:15 à 17:45');
            await expectGridMatchesBase(page, request, days.early);
            expect(await recurrenceAt(request, days.early, '17:15')).toMatchObject({
                start: '17:15',
                end: '17:45',
                until: days.late,
            });

            await travelTo(page, days.late);
            await expect(block(page, 'Point sécurité')).toContainText('De 17:15 à 17:45');
            await expect(block(page, 'Point sécurité').getByRole('img', { name: BOTH })).toBeVisible();
            await expectGridMatchesBase(page, request, days.late);

            await travelTo(page, days.early);
            await page.keyboard.press('ControlOrMeta+Z');
            await expect(block(page, 'Point sécurité')).toContainText('De 17:00 à 17:45');
            await page.keyboard.press('ControlOrMeta+Z');
            await expect(block(page, 'Point sécurité')).toContainText('De 17:00 à 18:00');
            await expect(block(page, 'Point sécurité').getByRole('img', { name: BOTH })).toBeVisible();
            await expectGridMatchesBase(page, request, days.early);
            await page.keyboard.press('ControlOrMeta+Shift+Z');
            await expect(block(page, 'Point sécurité')).toContainText('De 17:00 à 17:45');
            await expectGridMatchesBase(page, request, days.early);
        } finally {
            await withdrawOurs(request, days);
        }
    });
});

test.describe('un créneau qu’une autre récurrence prend', () => {
    test.use({ expectedErrors: [refusedWith(422)] });

    test('ni allongé ni collé : le refus en bas de la grille, rien d’écrit, et la récurrence coupée reste à coller', async ({
        page,
        request,
    }) => {
        const days = await takeDays(request);
        const review = { start: '11:00', end: '11:30', ticket: 'OPS-12', comment: 'Point produit' };
        const retro = { start: '11:30', end: '12:00', ticket: 'OPS-12', comment: 'Rétrospective produit' };
        try {
            await postBoth(request, days, review);
            await postBoth(request, days, retro);
            await openEarly(page, days);
            const refused = 'Ce créneau est déjà pris par la récurrence « Rétrospective produit ».';

            // Allonger sur la rétrospective, avec les suivantes : refusé.
            await clickSlot(page, '11:00');
            await page.keyboard.press('ControlOrMeta+C');
            await clickSlot(page, '11:30');
            const writes = recordWrites(page);
            await page.keyboard.press('ControlOrMeta+V');
            await expect(question(page, 'Allonger une récurrence')).toContainText('de 11:00 à 11:45');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Enter');
            await expect(message(page)).toContainText(refused);
            await expect(block(page, 'Point produit')).toContainText('De 11:00 à 11:30');
            await expect(block(page, 'Rétrospective produit')).toContainText('De 11:30 à 12:00');
            await expect(blocks(page).getByRole('img', { name: BOTH })).toHaveCount(2);
            expect(describedWrites(writes)).toEqual([`PUT /api/days/${days.early}/recurrence`]);
            await expectGridMatchesBase(page, request, days.early);

            // Couper avec les suivantes, puis coller sur la rétrospective : refusé, rien n'est collé.
            await clickSlot(page, '11:00');
            await page.keyboard.press('Shift+ArrowDown');
            await page.keyboard.press('ControlOrMeta+X');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Enter');
            await expect(message(page)).toContainText('OPS-12 coupé');
            await clickSlot(page, '11:30');
            await page.keyboard.press('ControlOrMeta+V');
            await expect(message(page)).toContainText(refused);
            await expect(block(page, 'Rétrospective produit')).toContainText('De 11:30 à 12:00');
            await expect(block(page, 'Rétrospective produit').getByRole('img', { name: BOTH })).toBeVisible();
            await expectGridMatchesBase(page, request, days.early);

            // Le presse-papier la garde : collée ailleurs, elle repart.
            await clickSlot(page, '17:00');
            await page.keyboard.press('ControlOrMeta+V');
            const moved = block(page, 'Point produit');
            await expect(moved).toContainText('De 17:00 à 17:30');
            await expect(moved.getByRole('img', { name: BOTH })).toBeVisible();
            await expectGridMatchesBase(page, request, days.early);

            // Annuler le collage puis la coupe : seuls les gestes faits se défont.
            await page.keyboard.press('ControlOrMeta+Z');
            await expect(moved).toHaveCount(0);
            await page.keyboard.press('ControlOrMeta+Z');
            await expect(moved).toContainText('De 11:00 à 11:30');
            await expect(moved.getByRole('img', { name: BOTH })).toBeVisible();
            await expectGridMatchesBase(page, request, days.early);
        } finally {
            await withdrawOurs(request, days);
        }
    });
});

test.describe('un jour passé', () => {
    test('ne demande jamais : couper, raccourcir et coller au bord ne changent que cette fois', async ({
        page,
        request,
    }) => {
        // Un mardi de 2017, que le navigateur voit de la veille au lendemain ; sa récurrence y finit.
        const date = '2017-06-06';
        await writeDay(request, date, []);
        await postRecurrence(
            request,
            date,
            { start: '11:00', end: '11:30', ticket: 'OPS-12', comment: 'Revue de sprint' },
            [2],
            date,
        );
        await startTimeAt(page, '2017-06-07', '08:00');
        await openDay(page, date);
        await expect(block(page, 'Revue de sprint').getByRole('img', { name: 'Revient chaque mardi' })).toBeVisible();

        await clickSlot(page, '11:00');
        await page.keyboard.press('Shift+ArrowDown');
        await page.keyboard.press('ControlOrMeta+X');
        await expect(message(page)).toContainText('OPS-12 coupé');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(block(page, 'Revue de sprint')).toHaveCount(0);
        await expectGridMatchesBase(page, request, date);
        await page.keyboard.press('ControlOrMeta+Z');
        await expect(block(page, 'Revue de sprint').getByRole('img', { name: 'Revient chaque mardi' })).toBeVisible();

        await clickSlot(page, '11:15');
        await page.keyboard.press('Delete');
        await expect(message(page)).toContainText('OPS-12 effacé');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expectGridMatchesBase(page, request, date);
        await page.keyboard.press('ControlOrMeta+Z');
        await expectGridMatchesBase(page, request, date);

        await clickSlot(page, '11:00');
        await page.keyboard.press('ControlOrMeta+C');
        await clickSlot(page, '11:30');
        await page.keyboard.press('ControlOrMeta+V');
        await expect(blocks(page).filter({ hasText: 'Revue de sprint' }).last()).toContainText('11:45');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expectGridMatchesBase(page, request, date);
    });
});
