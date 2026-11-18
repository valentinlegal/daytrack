import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { addDays, claimDay, type Entry, startTimeAt, writeDay } from './day';
import {
    blocks,
    clickSlot,
    describedWrites,
    clickOutside,
    doubleClickSlot,
    dragSlots,
    expectGridMatchesBase,
    openDay,
    openSampleDay,
    recordWrites,
    savedDay,
    slots,
    ticketWindow,
} from './editing';
import { expect, expectAccessible, expectScreen, refusedWith, test, THEMES, VIEWPORTS } from './fixtures';
import {
    arrow,
    dayButton,
    nextWeekday,
    postRecurrence,
    type Range,
    recurrenceBox,
    serveOngoing,
    serverToday,
    times,
    until,
    withdrawRecurrence,
} from './recurrence';

/**
 * Les rythmes d'une récurrence et les créneaux déjà pris, dans la fenêtre
 * d'un ticket : créer une semaine sur n et chaque mois, au rang ou à la date, au clavier ;
 * changer de carte sans perdre ses jours ni son « une semaine sur » ; le 31 et les 5es jours
 * de la semaine ; les semaines sans, en pointillé. Puis le refus d'un créneau qu'une autre
 * récurrence prend déjà : ses fois « Pris », Enregistrer qui n'envoie rien, « Alterner », un
 * onglet resté ouvert que le serveur refuse, « cette fois et les suivantes », et annuler
 * qui défait la récurrence créée.
 *
 * Les rythmes se créent sur des jours de 2017, passés pour le serveur : chaque récurrence y
 * reçoit une fin passée, pour ne jamais rien poser sur un jour à venir du poste.
 *
 * Un conflit ne compte que sur les jours après aujourd'hui, celui du serveur : les parcours
 * des conflits prennent donc de vrais jours à venir, les mardis, mercredis et vendredis — les
 * lundis et jeudis sont à tests/e2e/recurrences.spec.ts —, sur un créneau du soir que rien
 * d'autre ne coche, et ils passent l'un après l'autre : leurs récurrences se verraient. Tout
 * ce qu'ils posent y est retiré quand ils s'arrêtent, même s'ils échouent. La base de
 * développement a ses propres récurrences : un créneau déjà pris arrête le parcours, en le
 * disant, avant qu'il ne pose rien.
 *
 * Les captures des conflits se prennent sur des jours de 2016, sans rien enregistrer : la
 * récurrence qui prend le créneau est servie à la page avec la journée, à la place de celles
 * de la base, que les captures n'ont pas à montrer.
 */

/** Une carte du rythme, par son libellé : « Chaque semaine », « Une semaine sur 2 », « Chaque mois ». */
function pace(window: Locator, name: string): Locator {
    return window.getByRole('radiogroup', { name: 'Rythme' }).getByRole('radio', { name });
}

/** Un bouton de « Une semaine sur », par son nom : « Une semaine sur 3 ». */
function everyWeeks(window: Locator, name: string): Locator {
    return window.getByRole('group', { name: 'Une semaine sur' }).getByRole('button', { name });
}

function monthDays(window: Locator): Locator {
    return window.getByRole('radiogroup', { name: 'Jour du mois' }).getByRole('radio');
}

function monthDay(window: Locator, name: string): Locator {
    return window.getByRole('radiogroup', { name: 'Jour du mois' }).getByRole('radio', { name });
}

const WEEKDAY_NAMES = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const MONTH_NAMES = [
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

/** Un jour tel que le lecteur d'écran le lit sur une prochaine fois : « Mercredi 25 novembre », « Lundi 1er juin ». */
function dayName(date: string): string {
    const day = new Date(`${date}T12:00:00Z`);
    const number = day.getUTCDate();

    return `${WEEKDAY_NAMES[day.getUTCDay()] ?? ''} ${number === 1 ? '1er' : String(number)} ${MONTH_NAMES[day.getUTCMonth()] ?? ''}`;
}

/** Ces éléments, tels que le lecteur d'écran les lit, dans l'ordre. */
async function expectNames(found: Locator, names: readonly string[]): Promise<void> {
    await expect(found).toHaveCount(names.length);
    for (const [index, name] of names.entries()) {
        await expect(found.nth(index)).toHaveAccessibleName(name);
    }
}

/** Les prochaines fois, telles que le lecteur d'écran les lit, dans l'ordre. */
async function expectTimes(window: Locator, names: readonly string[]): Promise<void> {
    await expectNames(times(window), names);
}

/**
 * Le refus d'un créneau déjà pris, mot pour mot, sous les prochaines fois : l'alerte le porte,
 * suivi du lien « Alterner » quand il est proposé.
 */
function refusal(window: Locator, text: string): Locator {
    return window.getByRole('alert').getByText(text, { exact: true });
}

/** La phrase sous les prochaines fois. */
function sentence(window: Locator, text: string): Locator {
    return window.getByText(text, { exact: true });
}

/** Une récurrence telle que la journée la rend. */
interface ShownRecurrence {
    readonly start: string;
    readonly end: string;
    readonly kind: string;
    readonly weekdays: number[];
    readonly everyWeeks: number;
    readonly monthWeek: number | null;
    readonly monthDay: number | null;
    readonly firstDay: string;
    readonly until: string | null;
    readonly slot: { readonly kind: string; readonly ticket: string | null; readonly comment: string | null };
}

interface ShownDay {
    readonly version: number;
    readonly blocks: {
        start: string;
        end: string;
        kind: string;
        ticket: string | null;
        comment: string | null;
        recurrence: string | null;
    }[];
    readonly recurrences: Record<string, ShownRecurrence>;
    readonly ongoing: Record<string, ShownRecurrence>;
}

async function shownDay(request: APIRequestContext, date: string): Promise<ShownDay> {
    return (await (await request.get(`/api/days/${date}`)).json()) as ShownDay;
}

/** La récurrence que porte le bloc de `start`, telle que la base la garde. */
async function recurrenceAt(request: APIRequestContext, date: string, start: string): Promise<ShownRecurrence> {
    const day = await shownDay(request, date);
    const id = day.blocks.find((block) => block.start === start)?.recurrence ?? null;
    const found = id === null ? undefined : day.recurrences[id];
    if (found === undefined) {
        throw new Error(`Le bloc de ${start}, le ${date}, ne porte aucune récurrence.`);
    }

    return found;
}

/**
 * Le créneau ne revient par aucune récurrence que la journée connaît : la base de
 * développement a les siennes, et un reste d'un parcours interrompu se dirait ici.
 */
async function expectSlotFree(request: APIRequestContext, date: string, range: Range): Promise<void> {
    const { ongoing } = await shownDay(request, date);
    const taken = Object.values(ongoing).filter((other) => other.start < range.end && range.start < other.end);
    if (taken.length > 0) {
        const named = taken
            .map(
                (other) =>
                    `${other.slot.comment ?? other.slot.ticket ?? 'une pause'} (${other.start}–${other.end}, depuis le ${other.firstDay})`,
            )
            .join(', ');
        throw new Error(
            `De ${range.start} à ${range.end}, une récurrence de la base de développement va jusqu'au ${date} : ${named}. Ce parcours a besoin de ce créneau libre : retirez-la, ou choisissez-lui un autre créneau.`,
        );
    }
}

/** Nouveau ticket, ouvert au clavier : le créneau sélectionné, puis Entrée. */
async function newTicketByKeyboard(page: Page, time: string): Promise<Locator> {
    await clickSlot(page, time);
    await page.keyboard.press('Enter');
    const window = ticketWindow(page);
    await expect(window.getByLabel('Ticket')).toBeFocused();

    return window;
}

/* -------------------------------------------------------------------------------------- */
/* Les rythmes, sur des jours de 2017                                                       */
/* -------------------------------------------------------------------------------------- */

const AFTERNOON = { start: '14:00', end: '14:15' };

/** Un jour de 2017 à lui, vide, vu comme aujourd'hui par le navigateur. */
async function openEmptyDay(page: Page, request: APIRequestContext, date: string, range: Range): Promise<void> {
    claimDay(date);
    await writeDay(request, date, []);
    await expectSlotFree(request, date, range);
    await startTimeAt(page, date, '08:00');
    await openDay(page, date);
}

test.describe('créer chaque rythme, au clavier', () => {
    test('une semaine sur trois, lundi et jeudi : Tab, flèches et Espace, puis Entrée dans « Jusqu’au »', async ({
        page,
        request,
    }) => {
        // Un lundi.
        const date = '2017-09-04';
        await openEmptyDay(page, request, date, AFTERNOON);
        const window = await newTicketByKeyboard(page, '14:00');
        await page.keyboard.type('OPS-12');
        await page.keyboard.press('Tab');
        await expect(window.getByLabel('Commentaire')).toBeFocused();
        await page.keyboard.type('Revue des dépendances');
        await page.keyboard.press('Tab');
        await expect(recurrenceBox(window)).toBeFocused();
        await page.keyboard.press('Space');
        await expect(recurrenceBox(window)).toBeChecked();

        // Le rythme : Tab entre sur la carte choisie, la flèche passe à la suivante et la choisit.
        await page.keyboard.press('Tab');
        await expect(pace(window, 'Chaque semaine')).toBeFocused();
        await expect(pace(window, 'Chaque semaine')).toBeChecked();
        await page.keyboard.press('ArrowRight');
        await expect(pace(window, 'Une semaine sur 2')).toBeChecked();
        await expect(pace(window, 'Une semaine sur 2')).toBeFocused();

        // Les jours : le lundi du bloc est déjà choisi, le jeudi s'y ajoute.
        await page.keyboard.press('Tab');
        await expect(dayButton(window, 'Lundi')).toBeFocused();
        await expect(dayButton(window, 'Lundi')).toHaveAttribute('aria-pressed', 'true');
        for (let step = 0; step < 3; step += 1) {
            await page.keyboard.press('Tab');
        }
        await expect(dayButton(window, 'Jeudi')).toBeFocused();
        await page.keyboard.press('Space');
        await expect(dayButton(window, 'Jeudi')).toHaveAttribute('aria-pressed', 'true');

        // « Une semaine sur » : 2 d'avance, 3 par Entrée ; la carte suit le chiffre.
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        await expect(everyWeeks(window, 'Une semaine sur 2')).toBeFocused();
        await expect(everyWeeks(window, 'Une semaine sur 2')).toHaveAttribute('aria-pressed', 'true');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Enter');
        await expect(everyWeeks(window, 'Une semaine sur 3')).toHaveAttribute('aria-pressed', 'true');
        await expect(everyWeeks(window, 'Une semaine sur 2')).toHaveAttribute('aria-pressed', 'false');
        await expect(pace(window, 'Une semaine sur 3')).toBeChecked();
        // Chaque jour d'une semaine où elle revient, une seule tuile par semaine sans.
        await expectTimes(window, [
            'Jeudi 7 septembre',
            'Lundi 11 septembre, rien ce jour-là',
            'Lundi 18 septembre, rien ce jour-là',
            'Lundi 25 septembre',
            'Jeudi 28 septembre',
        ]);
        await expect(
            sentence(window, "Une semaine sur trois, lundi et jeudi, de 14:00 à 14:15, à partir d'aujourd'hui."),
        ).toBeVisible();

        // « Jusqu'au », tapé au clavier, puis Entrée enregistre.
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        await expect(until(window)).toBeFocused();
        await page.keyboard.type('15122017');
        await expect(until(window)).toHaveValue('2017-12-15');
        await expect(
            sentence(
                window,
                "Une semaine sur trois, lundi et jeudi, de 14:00 à 14:15, d'aujourd'hui au vendredi 15 décembre.",
            ),
        ).toBeVisible();
        await page.keyboard.press('Enter');

        await expect(window).toBeHidden();
        await expect(arrow(page, 'Revient une semaine sur trois, lundi et jeudi')).toBeVisible();
        await expectGridMatchesBase(page, request, date);
        expect(await recurrenceAt(request, date, '14:00')).toMatchObject({
            kind: 'weekly',
            weekdays: [1, 4],
            everyWeeks: 3,
            monthWeek: null,
            monthDay: null,
            firstDay: date,
            until: '2017-12-15',
        });
    });

    test('chaque mois, au rang : le 1er lundi du mois, coché d’avance, et Entrée sur lui', async ({
        page,
        request,
    }) => {
        // Le premier lundi d'octobre.
        const date = '2017-10-02';
        await openEmptyDay(page, request, date, AFTERNOON);
        const window = await newTicketByKeyboard(page, '14:00');
        await page.keyboard.type('OPS-12');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Space');
        await page.keyboard.press('Tab');
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowRight');
        await expect(pace(window, 'Chaque mois')).toBeChecked();
        await expect(pace(window, 'Chaque mois')).toBeFocused();

        // Les jours disparaissent : la date décide. Ce lundi n'est pas le dernier du mois.
        await expect(window.getByRole('group', { name: 'Jours' })).toBeHidden();
        await expect(window.getByRole('group', { name: 'Une semaine sur' })).toBeHidden();
        await expectNames(monthDays(window), ['Le 1er lundi du mois', 'Le 2 de chaque mois']);
        await expect(monthDay(window, 'Le 1er lundi du mois')).toBeChecked();
        await page.keyboard.press('Tab');
        await expect(monthDay(window, 'Le 1er lundi du mois')).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(until(window)).toBeFocused();
        await page.keyboard.type('31122017');
        await expectTimes(window, ['Lundi 6 novembre', 'Lundi 4 décembre']);
        await expect(
            sentence(window, "Le 1er lundi du mois, de 14:00 à 14:15, d'aujourd'hui au dimanche 31 décembre."),
        ).toBeVisible();
        // Entrée sur le jour du mois enregistre, comme dans les autres champs. Le champ date
        // passe d'un segment à l'autre à Tab : on en ressort par l'année, le mois, puis le jour.
        for (let step = 0; step < 3; step += 1) {
            await page.keyboard.press('Shift+Tab');
        }
        await expect(monthDay(window, 'Le 1er lundi du mois')).toBeFocused();
        await page.keyboard.press('Enter');

        await expect(window).toBeHidden();
        await expect(arrow(page, 'Revient le 1er lundi du mois')).toBeVisible();
        await expectGridMatchesBase(page, request, date);
        expect(await recurrenceAt(request, date, '14:00')).toMatchObject({
            kind: 'monthly_weekday',
            weekdays: [1],
            everyWeeks: 1,
            monthWeek: 1,
            monthDay: null,
            firstDay: date,
            until: '2017-12-31',
        });
    });

    test('chaque mois, à la date : la flèche vers le bas passe au 16 de chaque mois', async ({ page, request }) => {
        // Le 3e lundi d'octobre.
        const date = '2017-10-16';
        await openEmptyDay(page, request, date, AFTERNOON);
        const window = await newTicketByKeyboard(page, '14:00');
        await page.keyboard.type('SHOP-512');
        await page.keyboard.press('Tab');
        await page.keyboard.type('Dépendances');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Space');
        await page.keyboard.press('Tab');
        await page.keyboard.press('ArrowLeft');
        await expect(pace(window, 'Chaque mois')).toBeChecked();
        await page.keyboard.press('Tab');
        await expect(monthDay(window, 'Le 3e lundi du mois')).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(monthDay(window, 'Le 16 de chaque mois')).toBeChecked();
        // Les mois où il tombe un jour non travaillé n'en ont pas : le samedi 16 décembre.
        await expect(window.getByText("Les mois où le 16 tombe un jour non travaillé n'en ont pas.")).toBeVisible();
        await page.keyboard.press('Tab');
        await page.keyboard.type('31032018');
        await expectTimes(window, ['Jeudi 16 novembre', 'Mardi 16 janvier', 'Vendredi 16 février', 'Vendredi 16 mars']);
        await expect(
            sentence(window, "Le 16 de chaque mois, de 14:00 à 14:15, d'aujourd'hui au samedi 31 mars 2018."),
        ).toBeVisible();
        await page.keyboard.press('Enter');

        await expect(window).toBeHidden();
        await expect(arrow(page, 'Revient le 16 de chaque mois')).toBeVisible();
        await expectGridMatchesBase(page, request, date);
        expect(await recurrenceAt(request, date, '14:00')).toMatchObject({
            kind: 'monthly_date',
            everyWeeks: 1,
            monthWeek: null,
            monthDay: 16,
            firstDay: date,
            until: '2018-03-31',
        });
    });
});

test.describe('changer de rythme', () => {
    test('garde les jours choisis et le chiffre de « Une semaine sur » : chaque mois les cache, la semaine les rend', async ({
        page,
        request,
    }) => {
        // Un mardi, le premier du mois.
        const date = '2017-09-05';
        await openEmptyDay(page, request, date, AFTERNOON);
        await doubleClickSlot(page, '14:00');
        const window = ticketWindow(page);
        await window.getByLabel('Ticket').fill('OPS-12');
        await recurrenceBox(window).click();
        await dayButton(window, 'Lundi').click();
        await dayButton(window, 'Vendredi').click();
        await pace(window, 'Une semaine sur 2').click();
        await everyWeeks(window, 'Une semaine sur 4').click();
        await expect(pace(window, 'Une semaine sur 4')).toBeChecked();

        await pace(window, 'Chaque mois').click();
        await expect(window.getByRole('group', { name: 'Jours' })).toBeHidden();
        await expect(window.getByRole('group', { name: 'Une semaine sur' })).toBeHidden();
        await expect(monthDay(window, 'Le 1er mardi du mois')).toBeChecked();
        await expect(sentence(window, "Le 1er mardi du mois, de 14:00 à 14:15, à partir d'aujourd'hui.")).toBeVisible();

        // Revenir à la semaine retrouve les trois jours, et la carte garde son « 4 ».
        await pace(window, 'Chaque semaine').click();
        const pressed = window.getByRole('group', { name: 'Jours' }).getByRole('button', { pressed: true });
        await expectNames(pressed, ['Lundi', 'Mardi', 'Vendredi']);
        await expect(window.getByRole('group', { name: 'Une semaine sur' })).toBeHidden();
        await expect(pace(window, 'Une semaine sur 4')).toBeVisible();
        await expect(
            sentence(window, "Chaque semaine, lundi, mardi et vendredi, de 14:00 à 14:15, à partir d'aujourd'hui."),
        ).toBeVisible();

        await pace(window, 'Une semaine sur 4').click();
        await expect(everyWeeks(window, 'Une semaine sur 4')).toHaveAttribute('aria-pressed', 'true');
        await expectNames(pressed, ['Lundi', 'Mardi', 'Vendredi']);
        await expect(
            sentence(
                window,
                "Une semaine sur quatre, lundi, mardi et vendredi, de 14:00 à 14:15, à partir d'aujourd'hui.",
            ),
        ).toBeVisible();

        // Rien n'est parti.
        await page.keyboard.press('Escape');
        await expect(window).toBeHidden();
        expect(await savedDay(request, date)).toEqual([]);
        expect((await shownDay(request, date)).recurrences).toEqual({});
    });
});

test.describe('chaque mois, à la fin du mois', () => {
    test('le 31 saute les mois sans 31 et ceux où il tombe un jour non travaillé, et le dit ; aucun 5e jour de la semaine', async ({
        page,
        request,
    }) => {
        // Le mardi 31 octobre, 5e mardi du mois.
        const date = '2017-10-31';
        const range = { start: '15:00', end: '15:15' };
        await openEmptyDay(page, request, date, range);
        await doubleClickSlot(page, '15:00');
        const window = ticketWindow(page);
        await window.getByLabel('Ticket').fill('OPS-21');
        await window.getByLabel('Commentaire').fill('Bilan du mois');
        await recurrenceBox(window).click();
        await pace(window, 'Chaque mois').click();

        // Pas de « 5e mardi » : la date, cochée d'avance, et le dernier mardi.
        await expectNames(monthDays(window), ['Le 31 de chaque mois', 'Le dernier mardi du mois']);
        await expect(monthDay(window, 'Le 31 de chaque mois')).toBeChecked();
        // Novembre, février, avril, juin et septembre n'ont pas de 31 ; le 31 décembre est un
        // dimanche, le 31 mars un samedi.
        await expectTimes(window, [
            'Mercredi 31 janvier',
            'Jeudi 31 mai',
            'Mardi 31 juillet',
            'Vendredi 31 août',
            'Mercredi 31 octobre',
        ]);
        const note = window.getByText("Les mois sans 31, et ceux où il tombe un jour non travaillé, n'en ont pas.");
        await expect(note).toBeVisible();
        await expect(sentence(window, "Le 31 de chaque mois, de 15:00 à 15:15, à partir d'aujourd'hui.")).toBeVisible();

        // Le dernier mardi tombe chaque mois : la note se tait.
        await monthDay(window, 'Le dernier mardi du mois').click();
        await expectTimes(window, [
            'Mardi 28 novembre',
            'Mardi 26 décembre',
            'Mardi 30 janvier',
            'Mardi 27 février',
            'Mardi 27 mars',
        ]);
        await expect(note).toBeHidden();
        await page.keyboard.press('Escape');
        await expect(window).toBeHidden();

        // Le 29, 5e mercredi : la date et le dernier, sans rang.
        const fifth = claimDay('2017-11-29');
        await openDay(page, fifth);
        await doubleClickSlot(page, '15:00');
        await ticketWindow(page).getByLabel('Ticket').fill('OPS-21');
        await recurrenceBox(ticketWindow(page)).click();
        await pace(ticketWindow(page), 'Chaque mois').click();
        await expectNames(monthDays(ticketWindow(page)), ['Le 29 de chaque mois', 'Le dernier mercredi du mois']);
        await expect(
            ticketWindow(page).getByText("Les mois sans 29, et ceux où il tombe un jour non travaillé, n'en ont pas."),
        ).toBeVisible();
        await page.keyboard.press('Escape');

        // Le 24, 4e vendredi et le dernier : les trois, le rang coché d'avance.
        const fourth = claimDay('2017-11-24');
        await openDay(page, fourth);
        await doubleClickSlot(page, '15:00');
        await ticketWindow(page).getByLabel('Ticket').fill('OPS-21');
        await recurrenceBox(ticketWindow(page)).click();
        await pace(ticketWindow(page), 'Chaque mois').click();
        await expectNames(monthDays(ticketWindow(page)), [
            'Le 4e vendredi du mois',
            'Le 24 de chaque mois',
            'Le dernier vendredi du mois',
        ]);
        await expect(monthDay(ticketWindow(page), 'Le 4e vendredi du mois')).toBeChecked();
        await page.keyboard.press('Escape');

        // Rien n'est parti.
        for (const shown of [date, fifth, fourth]) {
            expect((await shownDay(request, shown)).recurrences, shown).toEqual({});
        }
    });
});

test.describe('une semaine sur deux', () => {
    test('montre les semaines sans en pointillé, et ne finit pas sur l’une d’elles', async ({ page, request }) => {
        // Un mardi.
        const date = '2017-11-07';
        await openEmptyDay(page, request, date, AFTERNOON);
        await doubleClickSlot(page, '14:00');
        const window = ticketWindow(page);
        await window.getByLabel('Ticket').fill('OPS-12');
        await window.getByLabel('Commentaire').fill('Poker planning');
        await recurrenceBox(window).click();
        await pace(window, 'Une semaine sur 2').click();

        await expectTimes(window, [
            'Mardi 14 novembre, rien ce jour-là',
            'Mardi 21 novembre',
            'Mardi 28 novembre, rien ce jour-là',
            'Mardi 5 décembre',
            'Mardi 12 décembre, rien ce jour-là',
        ]);
        const borders = await times(window).evaluateAll((items) =>
            items.map((item) => getComputedStyle(item).borderTopStyle),
        );
        expect(borders).toEqual(['dashed', 'solid', 'dashed', 'solid', 'dashed']);
        await expect(sentence(window, "Un mardi sur deux, de 14:00 à 14:15, à partir d'aujourd'hui.")).toBeVisible();

        // Jusqu'au 12 décembre, une semaine sans : la série s'arrête le 5.
        await until(window).fill('2017-12-12');
        await expectTimes(window, [
            'Mardi 14 novembre, rien ce jour-là',
            'Mardi 21 novembre',
            'Mardi 28 novembre, rien ce jour-là',
            'Mardi 5 décembre',
        ]);
        await expect(
            sentence(window, "Un mardi sur deux, de 14:00 à 14:15, d'aujourd'hui au mardi 12 décembre."),
        ).toBeVisible();
        await window.getByRole('button', { name: 'Enregistrer' }).click();

        await expect(window).toBeHidden();
        await expect(arrow(page, 'Revient un mardi sur deux')).toBeVisible();
        await expectGridMatchesBase(page, request, date);
        expect(await recurrenceAt(request, date, '14:00')).toMatchObject({
            kind: 'weekly',
            weekdays: [2],
            everyWeeks: 2,
            firstDay: date,
            until: '2017-12-12',
        });
    });
});

/* -------------------------------------------------------------------------------------- */
/* Les créneaux déjà pris, sur de vrais jours à venir                                       */
/* -------------------------------------------------------------------------------------- */

/** Le créneau du soir des conflits : aucun autre parcours n'y coche la case « Récurrence ». */
const EVENING = { start: '18:00', end: '18:45' };

/** Nouveau ticket sur le créneau du soir, glissé de 18:00 à 18:30. */
async function newEveningTicket(page: Page, comment: string): Promise<Locator> {
    await dragSlots(page, EVENING.start, '18:30');
    await page.keyboard.press('Enter');
    const window = ticketWindow(page);
    await expect(window).toContainText(`de ${EVENING.start} à ${EVENING.end}`);
    await window.getByLabel('Ticket').fill('OPS-12');
    await window.getByLabel('Commentaire').fill(comment);

    return window;
}

/** Le soir d'un jour, occupé par ce commentaire. */
function evening(comment: string): Range {
    return { ...EVENING, ticket: 'OPS-12', comment };
}

/**
 * Retire chaque récurrence née sur un de ces jours au créneau du soir, depuis son premier
 * jour : elle ne tombe plus jamais. Toutes sont essayées, même si l'une refuse.
 */
async function withdrawEvenings(request: APIRequestContext, days: readonly string[]): Promise<void> {
    const failures: unknown[] = [];
    for (const date of [...days].sort()) {
        try {
            const day = await shownDay(request, date);
            const block = day.blocks.find((shown) => shown.start === EVENING.start);
            const id = block?.recurrence ?? null;
            const recurrence = id === null ? undefined : day.recurrences[id];
            if (block !== undefined && recurrence?.firstDay === date) {
                await withdrawRecurrence(
                    request,
                    date,
                    {
                        start: block.start,
                        end: block.end,
                        ticket: block.ticket ?? 'OPS-12',
                        comment: block.comment ?? '',
                    },
                    recurrence.weekdays,
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

/** Les récurrences du soir que la journée voit encore, par leur commentaire. */
async function eveningsOn(request: APIRequestContext, date: string): Promise<ShownRecurrence[]> {
    const { ongoing } = await shownDay(request, date);

    return Object.values(ongoing).filter((other) => other.start < EVENING.end && EVENING.start < other.end);
}

test.describe('un créneau déjà pris, sur de vrais jours à venir', () => {
    test.describe.configure({ mode: 'serial' });

    test('face à une semaine sur deux : « Pris », Enregistrer n’envoie rien, « Alterner » au clavier le libère', async ({
        page,
        request,
    }) => {
        const today = serverToday();
        // Vus du serveur : le mercredi où naît la rétrospective, puis le mercredi d'après, libre.
        const first = claimDay(nextWeekday(today, 3, 0));
        const date = claimDay(nextWeekday(today, 3, 1));
        await expectSlotFree(request, first, EVENING);
        try {
            await postRecurrence(request, first, evening('Rétrospective'), [3], addDays(first, 56), {
                everyWeeks: 2,
            });
            await startTimeAt(page, today, '08:00');
            await openDay(page, date);
            await expect(blocks(page).filter({ hasText: 'Rétrospective' })).toHaveCount(0);
            const window = await newEveningTicket(page, 'Démo de sprint');
            await recurrenceBox(window).click();

            const alert = window.getByRole('alert');
            await expect(
                refusal(window, 'Un mercredi sur deux, ce créneau est déjà pris par la récurrence « Rétrospective ».'),
            ).toBeVisible();
            const taken = (offset: number) => `${dayName(addDays(date, offset))}, déjà pris par Rétrospective`;
            await expectTimes(window, [
                taken(7),
                dayName(addDays(date, 14)),
                taken(21),
                dayName(addDays(date, 28)),
                taken(35),
            ]);
            await expect(times(window).filter({ hasText: 'Pris' })).toHaveCount(3);

            // Enregistrer est grisé, Entrée dans un champ n'envoie rien, et le clic à côté garde la
            // fenêtre, le curseur sur « Alterner ».
            const writes = recordWrites(page);
            const save = window.getByRole('button', { name: 'Enregistrer' });
            await expect(save).toHaveAttribute('aria-disabled', 'true');
            await window.getByLabel('Commentaire').press('Enter');
            await clickOutside(page);
            const alternate = window.getByRole('button', { name: 'Alterner avec « Rétrospective »' });
            await expect(alternate).toBeFocused();
            // Le rythme, qui le lève, désigne le refus.
            await expect(window.getByRole('radiogroup', { name: 'Rythme' })).toHaveAccessibleDescription(
                /ce créneau est déjà pris par la récurrence/,
            );
            await expect(window).toBeVisible();
            expect(describedWrites(writes)).toEqual([]);

            // Entrée sur le lien : une semaine sur deux, les semaines libres.
            await page.keyboard.press('Enter');
            await expect(alert).toBeHidden();
            await expect(pace(window, 'Une semaine sur 2')).toBeChecked();
            // Le lien parti avec le refus, le curseur passe à la carte qu'il a choisie.
            await expect(pace(window, 'Une semaine sur 2')).toBeFocused();
            await expect(
                window.getByText('En alternance avec « Rétrospective », qui revient les autres mercredis.'),
            ).toBeVisible();
            await expectTimes(window, [
                `${dayName(addDays(date, 7))}, rien ce jour-là`,
                dayName(addDays(date, 14)),
                `${dayName(addDays(date, 21))}, rien ce jour-là`,
                dayName(addDays(date, 28)),
                `${dayName(addDays(date, 35))}, rien ce jour-là`,
            ]);
            await window.getByRole('button', { name: 'Enregistrer' }).click();

            await expect(window).toBeHidden();
            await expect(
                blocks(page)
                    .filter({ hasText: 'Démo de sprint' })
                    .getByRole('img', { name: 'Revient un mercredi sur deux' }),
            ).toBeVisible();
            await expectGridMatchesBase(page, request, date);
            expect(await recurrenceAt(request, date, EVENING.start)).toMatchObject({
                kind: 'weekly',
                weekdays: [3],
                everyWeeks: 2,
                firstDay: date,
                until: null,
            });
        } finally {
            await withdrawEvenings(request, [first, date]);
        }
    });

    test('face à une récurrence de chaque semaine : le refus seul, sans « Alterner », même en une semaine sur deux', async ({
        page,
        request,
    }) => {
        const today = serverToday();
        // Vus du serveur : le mardi qu'on ouvre, et celui d'après, où naît le point hebdo.
        const date = claimDay(nextWeekday(today, 2, 0));
        const first = claimDay(nextWeekday(today, 2, 1));
        await expectSlotFree(request, date, EVENING);
        try {
            await postRecurrence(request, first, evening('Point hebdo'), [2], addDays(first, 56));
            await startTimeAt(page, today, '08:00');
            await openDay(page, date);
            const window = await newEveningTicket(page, 'Démo de sprint');
            await recurrenceBox(window).click();

            const alert = window.getByRole('alert');
            await expect(alert).toHaveText('Chaque mardi, ce créneau est déjà pris par la récurrence « Point hebdo ».');
            await expect(window.getByRole('button', { name: /^Alterner/ })).toHaveCount(0);
            await expect(times(window).filter({ hasText: 'Pris' })).toHaveCount(5);

            // Enregistrer est grisé ; le clic à côté garde la fenêtre, le curseur sur la carte choisie.
            const writes = recordWrites(page);
            await expect(window.getByRole('button', { name: 'Enregistrer' })).toHaveAttribute('aria-disabled', 'true');
            await clickOutside(page);
            await expect(pace(window, 'Chaque semaine')).toBeFocused();
            expect(describedWrites(writes)).toEqual([]);

            // Une semaine sur deux tombe encore sur lui : le refus reste, toujours sans lien.
            await page.keyboard.press('ArrowRight');
            await expect(pace(window, 'Une semaine sur 2')).toBeChecked();
            await expect(alert).toHaveText('Chaque mardi, ce créneau est déjà pris par la récurrence « Point hebdo ».');
            await expect(window.getByRole('button', { name: /^Alterner/ })).toHaveCount(0);
            await expect(window.getByRole('button', { name: 'Enregistrer' })).toHaveAttribute('aria-disabled', 'true');
            expect(describedWrites(writes)).toEqual([]);

            // À la souris, la carte cliquée se coche : le refus qu'elle désigne ne fait pas défiler
            // sous le pointeur la fenêtre, que l'écran plus bas fait défiler.
            await page.setViewportSize({ width: 1440, height: 560 });
            await pace(window, 'Chaque mois').click();
            await expect(pace(window, 'Chaque mois')).toBeChecked();
            await pace(window, 'Chaque semaine').click();
            await expect(pace(window, 'Chaque semaine')).toBeChecked();

            await page.keyboard.press('Escape');
            await expect(window).toBeHidden();
            expect(await savedDay(request, date)).toEqual([]);
            expect((await eveningsOn(request, date)).map((other) => other.slot.comment)).toEqual(['Point hebdo']);
        } finally {
            await withdrawEvenings(request, [date, first]);
        }
    });

    test.describe('un onglet resté ouvert', () => {
        test.use({ expectedErrors: [refusedWith(422)] });

        test('refusé par le serveur, la fenêtre garde tout, relit la journée, puis montre « Pris » et « Alterner »', async ({
            page,
            request,
        }) => {
            const today = serverToday();
            // Vus du serveur : le mardi qu'on ouvre, et celui d'après, où l'autre onglet pose sa revue.
            const date = claimDay(nextWeekday(today, 2, 2));
            const later = claimDay(nextWeekday(today, 2, 3));
            await expectSlotFree(request, date, EVENING);
            const end = addDays(date, 63);
            try {
                await startTimeAt(page, today, '08:00');
                await openDay(page, date);
                const window = await newEveningTicket(page, 'Démo de sprint');
                await recurrenceBox(window).click();
                await until(window).fill(end);
                await expect(window.getByRole('alert')).toHaveCount(0);

                // Pendant ce temps, ailleurs : une revue un mardi sur deux, à partir du mardi d'après.
                await postRecurrence(request, later, evening('Revue de sprint'), [2], addDays(later, 56), {
                    everyWeeks: 2,
                });
                const writes = recordWrites(page);
                await window.getByRole('button', { name: 'Enregistrer' }).click();

                const alert = window.getByRole('alert');
                await expect(
                    refusal(
                        window,
                        'Un mardi sur deux, ce créneau est déjà pris par la récurrence « Revue de sprint ».',
                    ),
                ).toBeVisible();
                await expect(window.getByRole('button', { name: 'Alterner avec « Revue de sprint »' })).toBeVisible();
                const taken = (offset: number) => `${dayName(addDays(date, offset))}, déjà pris par Revue de sprint`;
                await expectTimes(window, [
                    taken(7),
                    dayName(addDays(date, 14)),
                    taken(21),
                    dayName(addDays(date, 28)),
                    taken(35),
                ]);
                // Rien de la saisie n'est perdu.
                await expect(window.getByLabel('Ticket')).toHaveValue('OPS-12');
                await expect(window.getByLabel('Commentaire')).toHaveValue('Démo de sprint');
                await expect(recurrenceBox(window)).toBeChecked();
                await expect(pace(window, 'Chaque semaine')).toBeChecked();
                await expect(dayButton(window, 'Mardi')).toHaveAttribute('aria-pressed', 'true');
                await expect(until(window)).toHaveValue(end);
                // Seul l'enregistrement refusé est parti, et rien ne s'est écrit.
                expect(describedWrites(writes)).toEqual([`PUT /api/days/${date}/recurrence`]);
                expect(await savedDay(request, date)).toEqual([]);
                expect((await eveningsOn(request, date)).map((other) => other.slot.comment)).toEqual([
                    'Revue de sprint',
                ]);

                // Alterner, au clavier, et l'enregistrement passe.
                await window.getByRole('button', { name: 'Alterner avec « Revue de sprint »' }).focus();
                await page.keyboard.press('Enter');
                await expect(alert).toBeHidden();
                await expect(
                    window.getByText('En alternance avec « Revue de sprint », qui revient les autres mardis.'),
                ).toBeVisible();
                await window.getByRole('button', { name: 'Enregistrer' }).click();
                await expect(window).toBeHidden();
                await expect(
                    blocks(page)
                        .filter({ hasText: 'Démo de sprint' })
                        .getByRole('img', { name: 'Revient un mardi sur deux' }),
                ).toBeVisible();
                await expectGridMatchesBase(page, request, date);
            } finally {
                await withdrawEvenings(request, [date, later]);
            }
        });
    });

    test('cette fois et les suivantes : passer une récurrence qui alterne à chaque semaine est refusé, sans rien envoyer', async ({
        page,
        request,
    }) => {
        const today = serverToday();
        // Vus du serveur : la démo d'un vendredi sur deux, la rétrospective des autres vendredis,
        // et une fois à venir de la démo.
        const first = claimDay(nextWeekday(today, 5, 0));
        const other = claimDay(nextWeekday(today, 5, 1));
        const date = claimDay(nextWeekday(today, 5, 2));
        await expectSlotFree(request, first, EVENING);
        try {
            await postRecurrence(request, first, evening('Démo de sprint'), [5], addDays(first, 56), {
                everyWeeks: 2,
            });
            await postRecurrence(request, other, evening('Rétrospective'), [5], addDays(other, 56), {
                everyWeeks: 2,
            });
            await startTimeAt(page, today, '08:00');
            await openDay(page, date);
            const demo = blocks(page).filter({ hasText: 'Démo de sprint' });
            await expect(demo.getByRole('img', { name: 'Revient un vendredi sur deux' })).toBeVisible();

            await doubleClickSlot(page, EVENING.start);
            const window = ticketWindow(page, 'Modifier le ticket');
            await expect(recurrenceBox(window)).toBeChecked();
            await expect(pace(window, 'Une semaine sur 2')).toBeChecked();
            // L'alternance se dit aussi dans la fenêtre de l'autre.
            await expect(
                window.getByText('En alternance avec « Rétrospective », qui revient les autres vendredis.'),
            ).toBeVisible();

            await pace(window, 'Chaque semaine').click();
            await expect(
                refusal(window, 'Un vendredi sur deux, ce créneau est déjà pris par la récurrence « Rétrospective ».'),
            ).toBeVisible();
            await expect(times(window).filter({ hasText: 'Pris' })).toHaveCount(3);
            const writes = recordWrites(page);
            await expect(window.getByRole('button', { name: 'Enregistrer' })).toHaveAttribute('aria-disabled', 'true');
            await clickOutside(page);
            await expect(window.getByRole('button', { name: 'Alterner avec « Rétrospective »' })).toBeFocused();
            // Ni question, ni écriture.
            await expect(page.getByRole('dialog', { name: 'Modifier une récurrence' })).toHaveCount(0);
            expect(describedWrites(writes)).toEqual([]);

            await page.keyboard.press('Escape');
            await expect(window).toBeHidden();
            await expect(demo.getByRole('img', { name: 'Revient un vendredi sur deux' })).toBeVisible();
            await expectGridMatchesBase(page, request, date);
            expect(await recurrenceAt(request, date, EVENING.start)).toMatchObject({
                everyWeeks: 2,
                firstDay: first,
                until: addDays(first, 56),
            });
        } finally {
            await withdrawEvenings(request, [first, other, date]);
        }
    });

    test('annuler la création défait la récurrence, rétablir la refait, et la grille suit la base à chaque pas', async ({
        page,
        request,
    }) => {
        const today = serverToday();
        const date = claimDay(nextWeekday(today, 3, 2));
        await expectSlotFree(request, date, EVENING);
        try {
            await startTimeAt(page, today, '08:00');
            await openDay(page, date);
            const window = await newEveningTicket(page, 'Bilan du soir');
            await recurrenceBox(window).click();
            await window.getByRole('button', { name: 'Enregistrer' }).click();
            await expect(window).toBeHidden();
            const block = blocks(page).filter({ hasText: 'Bilan du soir' });
            await expect(block.getByRole('img', { name: 'Revient chaque mercredi' })).toBeVisible();
            await expectGridMatchesBase(page, request, date);
            expect((await eveningsOn(request, date)).map((other) => other.firstDay)).toEqual([date]);

            await expect(slots(page)).toBeFocused();
            await page.keyboard.press('ControlOrMeta+Z');
            await expect(block).toHaveCount(0);
            await expectGridMatchesBase(page, request, date);
            expect(await eveningsOn(request, date)).toEqual([]);

            await page.keyboard.press('ControlOrMeta+Shift+Z');
            await expect(block.getByRole('img', { name: 'Revient chaque mercredi' })).toBeVisible();
            await expectGridMatchesBase(page, request, date);
            expect((await eveningsOn(request, date)).map((other) => other.firstDay)).toEqual([date]);

            await page.keyboard.press('ControlOrMeta+Z');
            await expect(block).toHaveCount(0);
            await expectGridMatchesBase(page, request, date);
            expect(await eveningsOn(request, date)).toEqual([]);
        } finally {
            await withdrawEvenings(request, [date]);
        }
    });
});

/* -------------------------------------------------------------------------------------- */
/* Les captures                                                                             */
/* -------------------------------------------------------------------------------------- */

const DAILY: Entry = { start: '09:15', end: '09:30', ticket: 'OPS-12', comment: 'Daily' };
const LUNCH: Entry = { start: '12:30', end: '13:30' };

/** La rétrospective d'un jeudi sur deux, qui revient la semaine d'avant le jour et celle d'après. */
function retrospective(date: string): Record<string, ShownRecurrence> {
    return {
        '019a6c1e-1330-7000-8000-000000000133': {
            start: '14:00',
            end: '15:00',
            kind: 'weekly',
            weekdays: [4],
            everyWeeks: 2,
            monthWeek: null,
            monthDay: null,
            firstDay: addDays(date, -7),
            until: null,
            slot: { kind: 'work', ticket: 'OPS-12', comment: 'Rétrospective' },
        },
    };
}

async function conflictWindow(page: Page): Promise<Locator> {
    await dragSlots(page, '14:00', '14:45');
    await page.keyboard.press('Enter');
    const window = ticketWindow(page);
    await window.getByLabel('Ticket').fill('OPS-12');
    await window.getByLabel('Commentaire').fill('Démo de sprint');
    await expect(window.getByText("Cérémonies d'équipe")).toBeVisible();
    await recurrenceBox(window).click();
    await expect(
        refusal(window, 'Un jeudi sur deux, ce créneau est déjà pris par la récurrence « Rétrospective ».'),
    ).toBeVisible();

    return window;
}

/** Les jours de chaque capture, un par largeur et par thème, que nul autre parcours ne prend. */
const CAPTURES: {
    name: string;
    days: readonly string[];
    entries: readonly Entry[];
    ongoing: (date: string) => Record<string, ShownRecurrence>;
    reach: (page: Page) => Promise<void>;
}[] = [
    {
        name: 'recurrence-mois',
        // Des 3es vendredis, comme le vendredi 16 octobre 2026.
        days: ['2016-01-15', '2016-02-19', '2016-06-17', '2016-07-15', '2016-08-19', '2016-10-21'],
        entries: [DAILY, { start: '11:00', end: '11:30', ticket: 'SHOP-512', comment: 'Dépendances' }, LUNCH],
        ongoing: () => ({}),
        reach: async (page) => {
            await doubleClickSlot(page, '11:00', 140);
            const window = ticketWindow(page, 'Modifier le ticket');
            await expect(window.getByText('Mise à jour des dépendances du front')).toBeVisible();
            await recurrenceBox(window).click();
            await pace(window, 'Chaque mois').click();
            await expect(monthDay(window, 'Le 3e vendredi du mois')).toBeChecked();
            await expect(times(window)).toHaveCount(5);
        },
    },
    {
        name: 'recurrence-mois-31',
        // Des 31 du lundi au vendredi.
        days: ['2016-05-31', '2016-08-31', '2016-10-31', '2017-01-31', '2017-05-31', '2017-07-31'],
        entries: [DAILY, LUNCH, { start: '16:00', end: '16:30', ticket: 'OPS-21', comment: 'Bilan du mois' }],
        ongoing: () => ({}),
        reach: async (page) => {
            await doubleClickSlot(page, '16:00', 140);
            const window = ticketWindow(page, 'Modifier le ticket');
            await expect(window.getByText('Revue des alertes de production')).toBeVisible();
            await recurrenceBox(window).click();
            await pace(window, 'Chaque mois').click();
            await expect(monthDay(window, 'Le 31 de chaque mois')).toBeChecked();
            await expect(
                window.getByText("Les mois sans 31, et ceux où il tombe un jour non travaillé, n'en ont pas."),
            ).toBeVisible();
        },
    },
    {
        name: 'recurrence-conflit',
        // Des jeudis, comme le jeudi 22 octobre 2026.
        days: Array.from({ length: 6 }, (_, index) => addDays('2016-06-02', 7 * index)),
        entries: [DAILY, LUNCH],
        ongoing: retrospective,
        reach: async (page) => {
            const window = await conflictWindow(page);
            await expect(window.getByRole('button', { name: 'Alterner avec « Rétrospective »' })).toBeVisible();
            await expect(times(window).filter({ hasText: 'Pris' })).toHaveCount(3);
        },
    },
    {
        name: 'recurrence-alterner',
        days: Array.from({ length: 6 }, (_, index) => addDays('2016-07-14', 7 * index)),
        entries: [DAILY, LUNCH],
        ongoing: retrospective,
        reach: async (page) => {
            const window = await conflictWindow(page);
            await window.getByRole('button', { name: 'Alterner avec « Rétrospective »' }).click();
            await expect(window.getByRole('alert')).toBeHidden();
            await expect(
                window.getByText('En alternance avec « Rétrospective », qui revient les autres jeudis.'),
            ).toBeVisible();
        },
    },
];

test.describe('les rythmes et les créneaux pris, à l’écran', () => {
    for (const capture of CAPTURES) {
        VIEWPORTS.forEach((viewport, v) => {
            THEMES.forEach(({ scheme, name }, t) => {
                const date = capture.days[v * 2 + t] ?? '';

                test(`${capture.name}, ${String(viewport.width)} × ${String(viewport.height)}, ${name}`, async ({
                    page,
                    request,
                }, testInfo) => {
                    await writeDay(request, date, capture.entries);
                    await serveOngoing(page, date, capture.ongoing(date));
                    await page.setViewportSize(viewport);
                    await page.emulateMedia({ colorScheme: scheme });
                    await openSampleDay(page, date);

                    await capture.reach(page);
                    // La fenêtre, plus haute que la place, fait défiler son contenu : la capture en
                    // montre la fin, les prochaines fois, le refus et la phrase. Le pointeur s'en
                    // va : aucune carte survolée.
                    await page.locator('.popover-body').evaluate((body) => {
                        body.scrollTop = body.scrollHeight;
                    });
                    await page.mouse.move(0, 0);
                    await expectScreen(page, testInfo, `${capture.name}-${String(viewport.width)}-${name}.png`);
                    if (viewport.width === 1440) {
                        await expectAccessible(page);
                    }
                });
            });
        });
    }
});
