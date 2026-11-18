import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { cell } from './calendar';
import { addDays, claimDay, startTimeAt, weekdaysFrom, writeDay } from './day';
import {
    blocks,
    clickOutside,
    clickSlot,
    doubleClickSlot,
    expectGridMatchesBase,
    figures,
    lane,
    menu,
    message,
    objectiveButton,
    objectiveWindow,
    openAnyway,
    openDay,
    openSampleDay,
    rightClickSlot,
    scrollGridTo,
    slot,
    slots,
    ticketWindow,
} from './editing';
import { expect, expectAccessible, expectScreen, OPEN_TOOLTIP, refusedWith, test, THEMES, VIEWPORTS } from './fixtures';
import {
    arrow,
    dayButton,
    isoWeekday,
    nextWeekday,
    postRecurrence,
    recurrenceBox,
    serverToday,
    times,
    until,
    withdrawRecurrence,
} from './recurrence';
import { SCENARIOS } from './scenarios';
import { clearSentDay, receivedWorklogs, sendButton, sendWindow } from './send';

/**
 * La case « Récurrence » de la fenêtre d'un ticket ou d'une pause : la créer à la
 * souris et au clavier, ses refus, la flèche du bloc, un geste qui ne change que cette fois,
 * annuler qui rend la flèche ; et la fenêtre, plus haute, qui défile sur un écran court.
 *
 * L'horloge du serveur ne s'avance pas d'ici : la pose du jour venu se prouve côté serveur
 * (tests/Recurrence/RecurrencePoserTest.php). Les parcours écrivent dans la base de
 * l'application de développement : chaque récurrence y reçoit une fin passée, pour ne
 * jamais rien poser sur un jour à venir du poste.
 *
 * Le navigateur vit en 2016–2017, le serveur à la vraie date : vus du serveur, ces jours sont
 * passés, et les parcours y jouent la branche « jour passé » (DayWriter::changePast). Les
 * branches « aujourd'hui » se prouvent par PHPUnit (tests/Api/RecurrenceApiTest.php) et par le
 * faux serveur de Vitest (tests/front/grid/daySessionRecurrence.test.ts).
 *
 * Seul « un jour à venir » prend de vrais jours à venir du poste, pour que le serveur y
 * prévoie la récurrence : née sur un lundi à venir, elle ne revient que le lundi suivant, et
 * elle est retirée quand le parcours s'arrête, même s'il échoue. Ses captures, elles, se
 * prennent sur des blocs posés d'un jour de 2016, à venir pour le navigateur : à l'écran, une
 * fois prévue et une fois posée ne se distinguent pas.
 */

const day = weekdaysFrom('2017-03-06');

const MORNING = [
    { start: '09:15', end: '09:30', ticket: 'OPS-12', comment: 'Daily' },
    { start: '09:30', end: '11:15', ticket: 'SHOP-482', comment: 'Mapping des colonnes' },
    { start: '12:30', end: '13:30' },
];

/** La question « quelles fois », par son titre. */
function scopeWindow(page: Page, title: string): Locator {
    return page.getByRole('dialog', { name: title });
}

/** Le lundi de ce jour-là, ou celui d'après. */
function mondayFrom(date: string): string {
    return addDays(date, (8 - new Date(`${date}T12:00:00Z`).getUTCDay()) % 7);
}

test.describe('un jour à venir', () => {
    test('montre sa récurrence comme ses autres blocs, comptée ; l’effacer ne vaut que cette fois, annuler la rend, même mis à 0h00 sans l’y ramener ; elle suit sa série jusque dans un onglet resté ouvert', async ({
        page,
        context,
        request,
    }) => {
        const today = serverToday();
        // Vus du serveur : le lundi à venir où elle naît, et le lundi d'après, qui la prévoit.
        const first = claimDay(mondayFrom(addDays(today, 8)));
        const ahead = claimDay(addDays(first, 7));
        const daily = { start: '09:15', end: '09:30', ticket: 'OPS-12', comment: 'Daily' };
        await postRecurrence(request, first, daily, [1], ahead);
        try {
            await startTimeAt(page, today, '08:00');
            await openDay(page, ahead);
            // La base de développement peut avoir ses propres récurrences : on ne regarde que celle-ci.
            const block = blocks(page).filter({ hasText: 'Daily' });

            await expect(block).toHaveCount(1);
            await expect(block.getByRole('img', { name: 'Revient chaque lundi' })).toBeVisible();
            await expect(cell(page, ahead)).not.toHaveAccessibleName(/non envoyé/);
            await expect(page.getByRole('button', { name: 'Envoyer sur Jira' })).toBeVisible();
            await expectGridMatchesBase(page, request, ahead);

            // Effacée cette fois, choix d'avance de la question : un seul geste, et annuler la
            // rend avec sa flèche.
            await clickSlot(page, '09:15');
            await page.keyboard.press('Delete');
            await page.keyboard.press('Enter');
            await expect(block).toHaveCount(0);
            await expect(message(page)).toContainText('OPS-12');
            await expectGridMatchesBase(page, request, ahead);
            await page.keyboard.press('ControlOrMeta+z');
            await expect(block.getByRole('img', { name: 'Revient chaque lundi' })).toBeVisible();
            await expectGridMatchesBase(page, request, ahead);

            // Mis à 0h00, il se ferme sur place : il n'avait que des fois prévues. Revenir à
            // un objectif les rend.
            await objectiveButton(page).click();
            const objective = objectiveWindow(page);
            await objective.getByLabel('Durée à travailler').fill('0h00');
            await expect(objective.getByRole('status')).toContainText('posé par une récurrence, sera retiré.');
            await objective.getByRole('button', { name: 'Enregistrer' }).click();
            await expect(objective).toBeHidden();
            await expect(page.getByText("Vos récurrences ne s'y posent pas.")).toBeVisible();
            await expect(block).toHaveCount(0);
            await objectiveButton(page).click();
            await objective.getByRole('button', { name: 'Revenir à 7h30' }).click();
            await objective.getByRole('button', { name: 'Enregistrer' }).click();
            await expect(objective).toBeHidden();
            await expect(block.getByRole('img', { name: 'Revient chaque lundi' })).toBeVisible();
            await expectGridMatchesBase(page, request, ahead);

            // Effacée cette fois, puis le jour mis à 0h00 : Ctrl+Z, sur la grille ouverte quand
            // même, ne l'y ramène pas, et elle ne compte pas. Sa récurrence la retient, et
            // « Revenir à 7h30 » la rend.
            await clickSlot(page, '09:15');
            await page.keyboard.press('Delete');
            await page.keyboard.press('Enter');
            await expect(block).toHaveCount(0);
            await objectiveButton(page).click();
            await objective.getByLabel('Durée à travailler').fill('0h00');
            await objective.getByRole('button', { name: 'Enregistrer' }).click();
            await expect(objective).toBeHidden();
            // Vide, il se ferme ; le « Annuler » de l'effacement, resté affiché, agit encore.
            await expect(openAnyway(page)).toBeVisible();
            await message(page).getByRole('button', { name: 'Annuler' }).click();
            await expect(message(page)).toHaveCount(0);
            await expect(slots(page)).toHaveAttribute('aria-busy', 'false');
            await expect(block).toHaveCount(0);
            await expect(objectiveButton(page)).toContainText('0h00');
            await expectGridMatchesBase(page, request, ahead);

            // Ctrl+Maj+Z refait l'effacement : revenu à 7h30, la fois reste effacée, et Ctrl+Z la rend.
            await page.keyboard.press('ControlOrMeta+Shift+z');
            await expect(slots(page)).toHaveAttribute('aria-busy', 'false');
            await objectiveButton(page).click();
            await objective.getByRole('button', { name: 'Revenir à 7h30' }).click();
            await objective.getByRole('button', { name: 'Enregistrer' }).click();
            await expect(objective).toBeHidden();
            await expect(block).toHaveCount(0);
            await expectGridMatchesBase(page, request, ahead);
            await clickSlot(page, '12:00');
            await page.keyboard.press('ControlOrMeta+z');
            await expect(block.getByRole('img', { name: 'Revient chaque lundi' })).toBeVisible();
            await expectGridMatchesBase(page, request, ahead);

            // Un autre onglet, resté ouvert sur ce lundi, a ouvert la confirmation de l'envoi.
            const other = await context.newPage();
            await startTimeAt(other, today, '08:00');
            await openDay(other, ahead);
            await sendButton(other).click();
            const confirm = sendWindow(other, 'Envoyer sur Jira');
            await expect(confirm.getByRole('listitem').filter({ hasText: 'OPS-12' })).toHaveCount(1);

            // Depuis le lundi où elle est née, son commentaire change avec les suivantes : la
            // fois suit sa série.
            await openDay(page, first);
            await doubleClickSlot(page, '09:15');
            const window = ticketWindow(page, 'Modifier le ticket');
            await window.getByLabel('Commentaire').fill('Daily changé');
            await window.getByRole('button', { name: 'Enregistrer' }).click();
            const modify = scopeWindow(page, 'Modifier une récurrence');
            await modify.getByText('Cette fois et les suivantes').click();
            await modify.getByRole('button', { name: 'Enregistrer' }).click();
            await expect(modify).toBeHidden();
            await openDay(page, ahead);
            const changed = blocks(page).filter({ hasText: 'Daily changé' });
            await expect(changed.getByRole('img', { name: 'Revient chaque lundi' })).toBeVisible();
            await expectGridMatchesBase(page, request, ahead);

            // L'onglet resté ouvert envoie l'ancien commentaire : refusé, rien ne part.
            await confirm.getByRole('button', { name: 'Envoyer sur Jira' }).click();
            await expect(message(other)).toContainText("La journée a changé entre-temps. Rien n'a été envoyé.");
            await expect(blocks(other).filter({ hasText: 'Daily changé' })).toHaveCount(1);
            expect(await receivedWorklogs(request, ahead)).toEqual([]);
            await other.close();
        } finally {
            // Coupée, c'est la récurrence née de la coupe qui pose le bloc du premier lundi :
            // la retirer suffit, la première l'a été par la coupe.
            await withdrawRecurrence(request, first, daily, [1]);
        }
    });
});

/**
 * Le dernier jour du lundi au vendredi que l'API ouvre, de vingt-huit à trente jours devant :
 * aucun autre parcours n'en prend. Le même jour du mois d'avant n'est pas à venir : une
 * récurrence de chaque mois à cette date n'y tombe pas avant lui. Aucun, à la fin de février.
 */
function lastOpenWeekday(today: string): string | undefined {
    return [30, 29, 28]
        .map((days) => addDays(today, days))
        .find((day) => isoWeekday(day) <= 5 && monthBefore(day) <= today);
}

/** La base de développement peut avoir ses propres récurrences ce jour-là : le parcours s'en écarte. */
async function skipUnlessFree(request: APIRequestContext, date: string): Promise<void> {
    const shown = (await (await request.get(`/api/days/${date}`)).json()) as {
        blocks: unknown[];
        send: { state: string };
    };
    test.skip(
        shown.blocks.length > 0 || shown.send.state !== 'nothing',
        `Le ${date} n'est pas libre dans cette base : une récurrence y tombe, ou il est envoyé.`,
    );
}

/** Le même jour du mois d'avant, ou le dernier de ce mois s'il est plus court. */
function monthBefore(date: string): string {
    const day = Number(date.slice(8));
    const first = new Date(`${date.slice(0, 8)}01T12:00:00Z`);
    first.setUTCMonth(first.getUTCMonth() - 1);
    const previous = first.toISOString().slice(0, 8);
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();

    return `${previous}${String(Math.min(day, last)).padStart(2, '0')}`;
}

/** Le nom d'une prochaine fois, comme le lit le lecteur d'écran : « Vendredi 11 décembre ». */
function timeName(date: string): string {
    const name = new Intl.DateTimeFormat('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
    }).format(new Date(`${date}T12:00:00Z`));

    return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Le premier jour du lundi au vendredi de 2015 qui porte la même date du mois : aucun autre parcours n'y écrit. */
function sameDateIn2015(date: string): string {
    const day = Number(date.slice(8));
    for (let month = 1; month <= 12; month += 1) {
        const candidate = `2015-${String(month).padStart(2, '0')}-${date.slice(8)}`;
        if (new Date(`${candidate}T12:00:00Z`).getUTCDate() === day && isoWeekday(candidate) <= 5) {
            return candidate;
        }
    }
    throw new Error(`Aucun jour de semaine de 2015 n'est le ${String(day)}.`);
}

test.describe('un jour à venir envoyé', () => {
    // Le calendrier dit l'état d'envoi du jour, tel que la base le lit.
    test.use({ marks: 'base' });

    test('garde ce que l’envoi y a posé quand une récurrence naît ensuite, même vu d’un onglet resté ouvert ; vidé et renvoyé vide, il la reçoit', async ({
        page,
        context,
        request,
    }) => {
        const today = serverToday();
        // Une revue chaque mois, à la date du jour envoyé, née d'un jour de 2015 : à venir, elle
        // ne tombe que sur lui, et ne se montre sur aucun jour d'un autre parcours.
        const last = lastOpenWeekday(today);
        test.skip(
            last === undefined,
            'À la fin de février, la revue de chaque mois tomberait aussi sur un jour proche.',
        );
        if (last === undefined) {
            return;
        }
        const sent = claimDay(last);
        const born = claimDay(sameDateIn2015(sent));
        const review = { start: '07:15', end: '07:30', ticket: 'ESSAI-1', comment: 'Revue du jour envoyé' };
        const rhythm = { kind: 'monthly_date', monthDay: Number(sent.slice(8)) } as const;
        // La base de développement peut y avoir ses propres récurrences : envoyer puis vider le
        // jour leur retirerait leur fois.
        const shown = (await (await request.get(`/api/days/${sent}`)).json()) as {
            blocks: unknown[];
            send: { state: string };
        };
        test.skip(
            shown.blocks.length > 0 || shown.send.state !== 'nothing',
            `Le ${sent} n'est pas libre dans cette base : une récurrence y tombe, ou il est envoyé.`,
        );
        await writeDay(request, sent, [{ start: '14:00', end: '14:15', ticket: 'ESSAI-2', comment: 'Saisie envoyée' }]);
        try {
            await startTimeAt(page, today, '08:00');
            await openDay(page, sent);
            await sendButton(page).click();
            await sendWindow(page, 'Envoyer sur Jira').getByRole('button', { name: 'Envoyer sur Jira' }).click();
            await expect(sendButton(page)).toHaveText(/^Envoyé à/);
            const other = await context.newPage();
            await startTimeAt(other, today, '08:00');
            await openDay(other, sent);

            await postRecurrence(request, born, review, [], sent, rhythm);

            await openDay(page, sent);
            const reviews = blocks(page).filter({ hasText: 'Revue du jour envoyé' });
            const saved = blocks(page).filter({ hasText: 'Saisie envoyée' });
            await expect(sendButton(page)).toHaveText(/^Envoyé à/);
            await expect(saved).toHaveCount(1);
            await expect(reviews).toHaveCount(0);
            await expect(cell(page, sent)).toHaveAccessibleName(/, envoyé$/);
            await expectGridMatchesBase(page, request, sent);
            // Sa fenêtre, depuis le jour où elle est née, ne l'y annonce pas.
            await openDay(page, born);
            await doubleClickSlot(page, '07:15');
            await expect(ticketWindow(page, 'Modifier le ticket')).toBeVisible();
            await expect(times(ticketWindow(page, 'Modifier le ticket'))).toHaveCount(0);
            await page.keyboard.press('Escape');

            // L'onglet resté ouvert n'est pas en retard : son geste passe, et annuler le défait,
            // sans que la revue s'y montre.
            const savedThere = blocks(other).filter({ hasText: 'Saisie envoyée' });
            await clickSlot(other, '14:00');
            await other.keyboard.press('Delete');
            await expect(savedThere).toHaveCount(0);
            await expect(sendButton(other)).toHaveAccessibleName("Renvoyer sur Jira, modifié depuis l'envoi");
            await expectGridMatchesBase(other, request, sent);
            await expect(savedThere).toHaveCount(0);
            await expect(message(other)).not.toContainText('La journée a changé');
            await other.keyboard.press('ControlOrMeta+z');
            await expect(savedThere).toHaveCount(1);
            await expect(sendButton(other)).toHaveText(/^Envoyé à/);
            await expect(blocks(other).filter({ hasText: 'Revue du jour envoyé' })).toHaveCount(0);
            await expectGridMatchesBase(other, request, sent);
            await other.close();

            // Vidé puis renvoyé vide, il n'a plus d'envoi : la revue s'y montre, prévue.
            await openDay(page, sent);
            await clickSlot(page, '14:00');
            await page.keyboard.press('Delete');
            await expect(saved).toHaveCount(0);
            await sendButton(page).click();
            await sendWindow(page, 'Envoyer sur Jira').getByRole('button', { name: 'Envoyer sur Jira' }).click();
            await expect(reviews.getByRole('img', { name: /^Revient / })).toBeVisible();
            await expect(sendButton(page)).toHaveAccessibleName('Envoyer sur Jira, journée non envoyée');
            await expectGridMatchesBase(page, request, sent);
            expect(await receivedWorklogs(request, sent)).toEqual([]);
            await openDay(page, born);
            await doubleClickSlot(page, '07:15');
            await expect(times(ticketWindow(page, 'Modifier le ticket'))).toHaveCount(1);
            await expect(times(ticketWindow(page, 'Modifier le ticket'))).toHaveAccessibleName(timeName(sent));
            await page.keyboard.press('Escape');
        } finally {
            await withdrawRecurrence(request, born, review, []);
        }
    });
});

test.describe('un jour à venir envoyé, puis changé ailleurs', () => {
    // L'onglet resté ouvert est refusé exprès : la journée a changé dans l'autre.
    test.use({ expectedErrors: [refusedWith(409)] });

    test('l’onglet qui montre encore la flèche d’une récurrence arrêtée ailleurs est en retard ; envoyé pendant une panne puis vidé, le jour redevient comme un autre, sa pause comprise', async ({
        page,
        context,
        request,
    }) => {
        const today = serverToday();
        // Vus du serveur : le lundi qui vient. Les autres parcours prennent les autres jours du
        // mois, et leurs séries vont jusqu'à huit semaines, sauf le lundi de cette semaine-ci. Une
        // récurrence de chaque mois à sa date n'y tombe sur aucun autre jour ouvert.
        const sent = claimDay(nextWeekday(today, 1, 0));
        const born = claimDay(sameDateIn2015(sent));
        const rhythm = { kind: 'monthly_date', monthDay: Number(sent.slice(8)) } as const;
        await skipUnlessFree(request, sent);

        // L'onglet resté ouvert. La journée d'abord : l'écrire remplace tout, la fois prévue comprise.
        const stopped = { start: '08:15', end: '08:30', ticket: 'ESSAI-1', comment: 'Revue arrêtée ailleurs' };
        await writeDay(request, sent, [{ start: '14:00', end: '14:15', ticket: 'ESSAI-2', comment: 'Saisie envoyée' }]);
        await postRecurrence(request, born, stopped, [], null, rhythm);
        try {
            await startTimeAt(page, today, '08:00');
            await openDay(page, sent);
            await sendButton(page).click();
            await sendWindow(page, 'Envoyer sur Jira').getByRole('button', { name: 'Envoyer sur Jira' }).click();
            await expect(sendButton(page)).toHaveText(/^Envoyé à/);
            const reviews = blocks(page).filter({ hasText: 'Revue arrêtée ailleurs' });
            await expect(reviews.getByRole('img', { name: /^Revient / })).toBeVisible();

            // Dans un autre onglet, depuis le jour où elle est née, la revue s'arrête : la fois que
            // l'envoi a posée reste, sans flèche, et la journée change.
            const other = await context.newPage();
            await startTimeAt(other, today, '08:00');
            await openDay(other, born);
            await doubleClickSlot(other, '08:15');
            const window = ticketWindow(other, 'Modifier le ticket');
            await recurrenceBox(window).click();
            await window.getByRole('button', { name: 'Enregistrer' }).click();
            await expect(window).toBeHidden();
            await other.close();

            // L'onglet resté ouvert la montre encore, et demande quelles fois effacer : son effacement
            // est refusé, sans rien écrire, et la journée relue la montre sans flèche.
            await clickSlot(page, '08:15');
            await page.keyboard.press('Delete');
            const question = scopeWindow(page, 'Effacer une récurrence');
            await expect(question.getByRole('radio', { name: 'Cette fois seulement' })).toBeFocused();
            await page.keyboard.press('Enter');
            await expect(question).toBeHidden();
            await expect(message(page)).toContainText('La journée a changé entre-temps');
            await expect(reviews).toHaveCount(1);
            await expect(reviews.getByRole('img', { name: /^Revient / })).toHaveCount(0);
            await expectGridMatchesBase(page, request, sent);

            // Relu, il l'efface sans question, et Ctrl+Z la rend.
            await clickSlot(page, '08:15');
            await page.keyboard.press('Delete');
            await expect(question).toBeHidden();
            await expect(reviews).toHaveCount(0);
            await expectGridMatchesBase(page, request, sent);
            await page.keyboard.press('ControlOrMeta+z');
            await expect(reviews).toHaveCount(1);
            await expect(page.getByText('La journée a changé entre-temps')).toHaveCount(0);
            await expect(sendButton(page)).toHaveText(/^Envoyé à/);
            await expectGridMatchesBase(page, request, sent);
        } finally {
            await clearSentDay(request, sent);
            await withdrawRecurrence(request, born, stopped, []);
        }

        // L'envoi raté. Le seul ticket du jour, que Jira ne sait pas lire : l'envoi échoue sans rien
        // écrire. La journée d'abord, comme plus haut.
        const lunch = { start: '12:00', end: '12:30' };
        const review = { start: '08:15', end: '08:30', ticket: 'ESSAI-1', comment: 'Revue du jour rouvert' };
        await writeDay(request, sent, [{ start: '14:00', end: '14:15', ticket: 'PANNE-1' }]);
        await postRecurrence(request, born, lunch, [], null, rhythm);
        try {
            await openDay(page, sent);
            const lunches = blocks(page).filter({ hasText: 'Pause' });
            await expect(lunches.getByRole('img', { name: /^Revient / })).toBeVisible();
            await sendButton(page).click();
            await sendWindow(page, 'Envoyer sur Jira').getByRole('button', { name: 'Envoyer sur Jira' }).click();
            await expect(sendWindow(page, "Échec de l'envoi")).toContainText("rien n'a été envoyé");
            await page.keyboard.press('Escape');
            await expect(sendButton(page)).toHaveAccessibleName("Réessayer l'envoi, échec");

            // Une revue naît ensuite, chaque mois à sa date : l'envoi raté garde le jour tel qu'il l'a
            // posé, tant qu'il a son ticket.
            await postRecurrence(request, born, review, [], null, rhythm);
            await openDay(page, sent);
            const reviews = blocks(page).filter({ hasText: 'Revue du jour rouvert' });
            await expect(blocks(page).filter({ hasText: 'PANNE-1' })).toHaveCount(1);
            await expect(reviews).toHaveCount(0);
            await expectGridMatchesBase(page, request, sent);

            // Vidé de son ticket, Jira n'a rien de lui : la revue s'y montre, et la pause redevient prévue.
            await clickSlot(page, '14:00');
            await page.keyboard.press('Delete');
            await expect(reviews.getByRole('img', { name: /^Revient / })).toBeVisible();
            await expect(lunches.getByRole('img', { name: /^Revient / })).toBeVisible();
            await expect(sendButton(page)).toHaveAccessibleName('Envoyer sur Jira, journée non envoyée');
            await expectGridMatchesBase(page, request, sent);
            expect(await receivedWorklogs(request, sent)).toEqual([]);

            // Ctrl+Z rend le ticket ; rien ne referme le jour.
            await page.keyboard.press('ControlOrMeta+z');
            await expect(blocks(page).filter({ hasText: 'PANNE-1' })).toHaveCount(1);
            await expect(reviews).toHaveCount(1);
            await expectGridMatchesBase(page, request, sent);
            await page.keyboard.press('ControlOrMeta+Shift+z');
            await expect(blocks(page).filter({ hasText: 'PANNE-1' })).toHaveCount(0);
            await expectGridMatchesBase(page, request, sent);

            // La pause suit de nouveau sa série : arrêtée depuis le jour où elle est née, elle n'y est plus.
            await withdrawRecurrence(request, born, lunch, []);
            await openDay(page, sent);
            await expect(lunches).toHaveCount(0);
            await expect(reviews).toHaveCount(1);
            await expectGridMatchesBase(page, request, sent);
        } finally {
            // Retirées d'abord : la journée vidée n'a plus rien à envoyer.
            await withdrawRecurrence(request, born, review, []);
            await withdrawRecurrence(request, born, lunch, []);
            await clearSentDay(request, sent);
        }
    });
});

test.describe('quelles fois changer, sur un jour à venir', () => {
    test('modifier puis effacer, cette fois seulement ou avec les suivantes, et annuler rend tout', async ({
        page,
        request,
    }) => {
        const today = serverToday();
        // Vus du serveur : le prochain jeudi, où elle naît, celui qu'on touche, et celui d'après,
        // à 16:15, sous un nom à lui — la base de développement a ses propres récurrences, les
        // lundis, mercredis et vendredis, et l'API ne va pas au-delà de trente jours. Elle finit
        // avant la quatrième semaine, dont le jeudi revient à recurrence-reshape.spec.ts.
        const first = claimDay(nextWeekday(today, 4, 0));
        const ahead = claimDay(addDays(first, 7));
        const after = claimDay(addDays(first, 14));
        const daily = { start: '16:15', end: '16:30', ticket: 'OPS-12', comment: 'Revue parcours' };
        await postRecurrence(request, first, daily, [4], after);
        const onDay = (text: string) => blocks(page).filter({ hasText: text });
        try {
            await startTimeAt(page, today, '08:00');
            await openDay(page, ahead);
            await expect(onDay('Revue parcours').getByRole('img', { name: 'Revient chaque jeudi' })).toBeVisible();

            // Modifier : la question prend la place de la fenêtre, Retour la rend telle quelle.
            await doubleClickSlot(page, '16:15');
            const window = ticketWindow(page, 'Modifier le ticket');
            await window.getByLabel('Commentaire').fill('Rétro');
            await window.getByRole('button', { name: 'Enregistrer' }).click();
            const modify = scopeWindow(page, 'Modifier une récurrence');
            await expect(modify).toContainText('Revue parcours, jeudi');
            await expect(modify.getByRole('radio', { name: 'Cette fois seulement' })).toBeChecked();
            await expect(modify.getByText('Les fois passées ne changent jamais.')).toBeVisible();
            await expectAccessible(page);
            await modify.getByRole('button', { name: 'Retour' }).click();
            await expect(window.getByLabel('Commentaire')).toHaveValue('Rétro');
            // Le curseur revient au champ qu'on venait de quitter.
            await expect(window.getByLabel('Commentaire')).toBeFocused();
            await window.getByRole('button', { name: 'Enregistrer' }).click();
            await expect(modify.getByRole('radio', { name: 'Cette fois seulement' })).toBeFocused();
            await page.keyboard.press('ArrowDown');
            await expect(modify.getByRole('radio', { name: 'Cette fois et les suivantes' })).toBeChecked();
            await page.keyboard.press('Enter');
            await expect(modify).toBeHidden();
            await expect(onDay('Rétro').getByRole('img', { name: 'Revient chaque jeudi' })).toBeVisible();
            await expectGridMatchesBase(page, request, ahead);
            await page.keyboard.press('ControlOrMeta+z');
            await expect(onDay('Revue parcours').getByRole('img', { name: 'Revient chaque jeudi' })).toBeVisible();
            await expectGridMatchesBase(page, request, ahead);

            // Effacer cette fois seulement : le jeudi d'après le garde.
            await clickSlot(page, '16:15');
            await page.keyboard.press('Delete');
            const erase = scopeWindow(page, 'Effacer une récurrence');
            await erase.getByRole('button', { name: 'Effacer' }).click();
            await expect(erase).toBeHidden();
            await expect(onDay('Revue parcours')).toHaveCount(0);
            await expect(message(page)).toContainText('OPS-12 effacé');
            await page.keyboard.press('ControlOrMeta+z');
            await expect(onDay('Revue parcours')).toHaveCount(1);

            // Échap ferme la question sans rien effacer.
            await clickSlot(page, '16:15');
            await page.keyboard.press('Delete');
            await expect(erase).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(erase).toBeHidden();
            await expect(onDay('Revue parcours')).toHaveCount(1);

            // Effacer avec les suivantes, à la souris : le jeudi d'après le perd aussi.
            await clickSlot(page, '16:15');
            await page.keyboard.press('Delete');
            await erase.getByText('Cette fois et les suivantes').click();
            await erase.getByRole('button', { name: 'Effacer' }).click();
            await expect(onDay('Revue parcours')).toHaveCount(0);
            await expectGridMatchesBase(page, request, ahead);
            await openDay(page, after);
            await expect(onDay('Revue parcours')).toHaveCount(0);
            await openDay(page, ahead);
            await page.keyboard.press('ControlOrMeta+z');
            await expect(onDay('Revue parcours').getByRole('img', { name: 'Revient chaque jeudi' })).toBeVisible();
            await openDay(page, after);
            await expect(onDay('Revue parcours')).toHaveCount(1);
        } finally {
            await withdrawRecurrence(request, first, daily, [4]);
        }
    });
});

test.describe('un jour mis à 0h00 après coup', () => {
    test('perd les blocs de ses récurrences, garde ses autres tickets, et les retrouve en revenant à un objectif', async ({
        page,
        request,
    }) => {
        const date = claimDay(day(17));
        await writeDay(request, date, MORNING);
        await postRecurrence(request, date, MORNING[0] ?? { start: '', end: '' }, [1, 2, 3, 4, 5], date);
        await startTimeAt(page, date, '15:20');
        await openDay(page, date);
        await expect(arrow(page, 'Revient chaque semaine, du lundi au vendredi')).toHaveCount(1);

        await objectiveButton(page).click();
        const window = objectiveWindow(page);
        await window.getByLabel('Durée à travailler').fill('0h00');
        // Le lecteur d'écran l'entend sans quitter le champ.
        await expect(window.getByRole('status')).toContainText(
            'Daily, posé par une récurrence, sera retiré. Vos autres tickets restent.',
        );
        // Revenir à l'habituel avant d'enregistrer : rien ne sera retiré, la phrase se tait.
        await window.getByRole('button', { name: 'Revenir à 7h30' }).click();
        await expect(window).not.toContainText('sera retiré');
        await window.getByLabel('Durée à travailler').fill('0h00');
        await window.getByRole('button', { name: 'Enregistrer' }).click();
        await expect(window).toBeHidden();

        await expect(arrow(page, 'Revient chaque semaine, du lundi au vendredi')).toHaveCount(0);
        await expect(blocks(page)).toHaveCount(2);
        await expect(objectiveButton(page)).toContainText('0h00');
        await expectGridMatchesBase(page, request, date);

        // Revenir à un objectif la rend, avec sa flèche.
        await objectiveButton(page).click();
        await window.getByRole('button', { name: 'Revenir à 7h30' }).click();
        await window.getByRole('button', { name: 'Enregistrer' }).click();
        await expect(window).toBeHidden();
        await expect(arrow(page, 'Revient chaque semaine, du lundi au vendredi')).toHaveCount(1);
        await expect(blocks(page)).toHaveCount(3);
        await expectGridMatchesBase(page, request, date);
    });
});

test.describe('créer une récurrence', () => {
    test('depuis Nouveau ticket, à la souris : la case déplie les jours, les prochaines fois et la phrase', async ({
        page,
        request,
    }) => {
        const date = claimDay(day(1));
        await writeDay(request, date, []);
        await startTimeAt(page, date, '08:00');
        await openDay(page, date);

        await doubleClickSlot(page, '09:15');
        const window = ticketWindow(page);
        await window.getByLabel('Ticket').fill('OPS-12');
        await window.getByLabel('Commentaire').fill('Daily');
        const box = recurrenceBox(window);
        await expect(box).not.toBeChecked();
        await expect(window.getByRole('group', { name: 'Jours' })).toBeHidden();

        // Seules la case et son libellé se cliquent, pas le reste de la ligne.
        const row = await box.boundingBox();
        const frame = await window.boundingBox();
        if (row === null || frame === null) {
            throw new Error("La case « Récurrence » n'est pas à l'écran.");
        }
        await page.mouse.click(frame.x + frame.width - 40, row.y + row.height / 2);
        await expect(box).not.toBeChecked();
        await window.getByText('Récurrence', { exact: true }).click();

        await expect(box).toBeChecked();
        // Le jour du bloc — un mardi — est choisi, et seuls les jours travaillés se proposent.
        await expect(dayButton(window, 'Mardi')).toHaveAttribute('aria-pressed', 'true');
        await expect(window.getByRole('group', { name: 'Jours' }).getByRole('button')).toHaveCount(5);
        await expect(times(window)).toHaveCount(5);
        await expect(times(window).first()).toHaveAccessibleName('Mardi 14 mars');
        await expect(window.getByText("Chaque mardi, de 09:15 à 09:30, à partir d'aujourd'hui.")).toBeVisible();
        for (const name of ['Lundi', 'Mercredi', 'Jeudi', 'Vendredi']) {
            await dayButton(window, name).click();
        }
        await expect(
            window.getByText("Chaque semaine, du lundi au vendredi, de 09:15 à 09:30, à partir d'aujourd'hui."),
        ).toBeVisible();
        const end = day(5);
        await until(window).fill(end);
        await expect(times(window)).toHaveCount(4);
        await window.getByRole('button', { name: 'Enregistrer' }).click();

        await expect(window).toBeHidden();
        await expect(arrow(page, 'Revient chaque semaine, du lundi au vendredi')).toBeVisible();
        await expectGridMatchesBase(page, request, date);
        const saved = (await (await request.get(`/api/days/${date}`)).json()) as {
            blocks: { recurrence: string | null }[];
            recurrences: Record<string, { weekdays: number[]; until: string | null; firstDay: string }>;
        };
        const id = saved.blocks[0]?.recurrence ?? '';
        expect(saved.recurrences[id]).toMatchObject({ weekdays: [1, 2, 3, 4, 5], until: end, firstDay: date });
    });

    test('au clavier, sur une pause : Espace coche la case, Entrée enregistre', async ({ page, request }) => {
        const date = claimDay(day(2));
        await writeDay(request, date, MORNING);
        await startTimeAt(page, date, '08:00');
        await openDay(page, date);

        await doubleClickSlot(page, '12:45');
        const window = ticketWindow(page, 'Modifier la pause');
        await expect(window.getByRole('button', { name: 'Enregistrer' })).toHaveAttribute('aria-disabled', 'true');
        // Ticket, Commentaire, puis la case.
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        await expect(recurrenceBox(window)).toBeFocused();
        await page.keyboard.press('Space');
        await expect(recurrenceBox(window)).toBeChecked();
        // Une pause qui revient s'enregistre sans ticket.
        await expect(window.getByRole('button', { name: 'Enregistrer' })).not.toHaveAttribute('aria-disabled', 'true');
        await until(window).fill(day(4));
        await until(window).press('Enter');

        await expect(window).toBeHidden();
        await expect(arrow(page, 'Revient chaque mercredi')).toBeVisible();
        await expectGridMatchesBase(page, request, date);
    });

    test('refuse, sous leur champ, aucun jour, une date commencée, une fin avant le bloc', async ({
        page,
        request,
    }) => {
        const date = claimDay(day(3));
        await writeDay(request, date, MORNING);
        await startTimeAt(page, date, '08:00');
        await openDay(page, date);
        await doubleClickSlot(page, '09:15');
        const window = ticketWindow(page, 'Modifier le ticket');
        await recurrenceBox(window).click();

        // Le jour du bloc, un jeudi, était le seul choisi : sans lui, « Enregistrer » est
        // grisé, Entrée ne fait rien, et seul le clic à côté dit pourquoi.
        await dayButton(window, 'Jeudi').click();
        await expect(window.getByRole('button', { name: 'Enregistrer' })).toHaveAttribute('aria-disabled', 'true');
        await window.getByLabel('Commentaire').press('Enter');
        await expect(window.getByText('Choisissez au moins un jour.')).toBeHidden();
        await clickOutside(page);
        await expect(window.getByText('Choisissez au moins un jour.')).toBeVisible();
        await expect(dayButton(window, 'Lundi')).toBeFocused();
        await expect(window).toBeVisible();

        await dayButton(window, 'Jeudi').click();
        await expect(window.getByText('Choisissez au moins un jour.')).toBeHidden();
        // Une date commencée n'est jamais lue comme « sans fin ».
        await until(window).click();
        await page.keyboard.type('31');
        await window.getByRole('button', { name: 'Enregistrer' }).click();
        await expect(until(window)).toHaveAttribute('aria-invalid', 'true');
        await expect(until(window)).toBeFocused();
        await expect(window.getByText('Complétez la date.')).toBeVisible();
        // Vidé au clavier, le champ n'a plus rien à compléter.
        await page.keyboard.press('Backspace');
        await expect(window.getByText('Complétez la date.')).toBeHidden();
        await expect(until(window)).not.toHaveAttribute('aria-invalid', 'true');
        // De même vidé d'un coup, comme par « Effacer » du calendrier du navigateur.
        await page.keyboard.type('31');
        await window.getByRole('button', { name: 'Enregistrer' }).click();
        await expect(window.getByText('Complétez la date.')).toBeVisible();
        await until(window).fill('');
        await expect(window.getByText('Complétez la date.')).toBeHidden();

        await until(window).fill(day(0));
        await window.getByRole('button', { name: 'Enregistrer' }).click();
        await expect(window.getByText('Choisissez un jour à partir du jeudi 9 mars.')).toBeVisible();
        // Rien n'est parti.
        const saved = (await (await request.get(`/api/days/${date}`)).json()) as { recurrences: object };
        expect(saved.recurrences).toEqual({});
    });
});

test.describe('un bloc qui revient', () => {
    test('effacer cette fois seulement, au clavier, et annuler rend le bloc et sa flèche', async ({
        page,
        request,
    }) => {
        const date = claimDay(day(6));
        await writeDay(request, date, MORNING);
        await postRecurrence(request, date, MORNING[0] ?? { start: '', end: '' }, [1, 2, 3, 4, 5], day(8));
        await startTimeAt(page, date, '08:00');
        await openDay(page, date);
        await expect(arrow(page, 'Revient chaque semaine, du lundi au vendredi')).toBeVisible();

        await clickSlot(page, '09:15');
        await page.keyboard.press('Delete');
        const question = scopeWindow(page, 'Effacer une récurrence');
        await expect(question.getByRole('radio', { name: 'Cette fois seulement' })).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(question).toBeHidden();
        await expect(message(page)).toContainText('OPS-12 effacé');
        await expect(arrow(page, 'Revient chaque semaine, du lundi au vendredi')).toBeHidden();
        await expectGridMatchesBase(page, request, date);

        await page.keyboard.press('ControlOrMeta+Z');
        await expect(arrow(page, 'Revient chaque semaine, du lundi au vendredi')).toBeVisible();
        await expectGridMatchesBase(page, request, date);
    });

    test('coller par-dessus le détache : il perd sa flèche, et copier ne la garde pas', async ({ page, request }) => {
        const date = claimDay(day(7));
        await writeDay(request, date, MORNING);
        await postRecurrence(request, date, MORNING[0] ?? { start: '', end: '' }, [1, 2, 3, 4, 5], day(8));
        await startTimeAt(page, date, '08:00');
        await openDay(page, date);

        // Le Daily copié, collé sur 14:00 : une saisie ordinaire, sans flèche.
        await clickSlot(page, '09:15');
        await page.keyboard.press('ControlOrMeta+C');
        await clickSlot(page, '14:00');
        await page.keyboard.press('ControlOrMeta+V');
        await expect(blocks(page).filter({ hasText: 'OPS-12' })).toHaveCount(2);
        await expect(arrow(page, 'Revient chaque semaine, du lundi au vendredi')).toHaveCount(1);

        // SHOP-482 collé sur le Daily : cette fois seulement.
        await clickSlot(page, '10:00');
        await page.keyboard.press('ControlOrMeta+C');
        await clickSlot(page, '09:15');
        await page.keyboard.press('ControlOrMeta+V');
        await expect(arrow(page, 'Revient chaque semaine, du lundi au vendredi')).toHaveCount(0);
        await expectGridMatchesBase(page, request, date);
    });

    test('d’un jour passé, garde sa case cochée : à la réouverture, après les réglages ou un autre jour', async ({
        page,
        request,
    }) => {
        const date = claimDay(day(20));
        await writeDay(request, date, MORNING);
        await postRecurrence(request, date, MORNING[0] ?? { start: '', end: '' }, [1, 2, 3, 4, 5], day(21));
        await startTimeAt(page, day(22), '08:00');
        await openDay(page, date);
        const reopened = async () => {
            await doubleClickSlot(page, '09:15');
            const window = ticketWindow(page, 'Modifier le ticket');
            await expect(recurrenceBox(window)).toBeChecked();
            await expect(
                window.getByRole('group', { name: 'Jours' }).getByRole('button', { pressed: true }),
            ).toHaveCount(5);
            await expect(until(window)).toHaveValue(day(21));
            await expect(window.getByText('Ne revient plus.')).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(window).toBeHidden();
        };

        await reopened();
        await reopened();
        await page.getByRole('button', { name: 'Réglages' }).click();
        await page.getByRole('link', { name: 'Retour à la journée' }).click();
        await reopened();
        await page.getByRole('button', { name: 'Jour suivant' }).click();
        await page.getByRole('button', { name: 'Jour précédent' }).click();
        await reopened();
        await expect(arrow(page, 'Revient chaque semaine, du lundi au vendredi')).toBeVisible();
    });

    test('décocher la case l’arrête : le bloc reste, sans flèche', async ({ page, request }) => {
        const date = claimDay(day(9));
        await writeDay(request, date, MORNING);
        await postRecurrence(request, date, MORNING[0] ?? { start: '', end: '' }, [1, 2, 3, 4, 5], day(12));
        await startTimeAt(page, date, '08:00');
        await openDay(page, date);

        await doubleClickSlot(page, '09:15');
        const window = ticketWindow(page, 'Modifier le ticket');
        await expect(recurrenceBox(window)).toBeChecked();
        await expect(dayButton(window, 'Vendredi')).toHaveAttribute('aria-pressed', 'true');
        await recurrenceBox(window).click();
        await clickOutside(page);

        // La question prend la place des champs ; un clic à côté valide le choix d'avance.
        const question = scopeWindow(page, 'Arrêter une récurrence');
        await expect(question.getByRole('radiogroup', { name: 'Quelles fois arrêter' })).toBeVisible();
        await clickOutside(page);
        await expect(question).toBeHidden();
        await expect(blocks(page).filter({ hasText: 'OPS-12' })).toHaveCount(1);
        await expect(arrow(page, 'Revient chaque semaine, du lundi au vendredi')).toBeHidden();
        await expectGridMatchesBase(page, request, date);
    });
});

test.describe('un jour fermé', () => {
    test('mis à 0h00, vide, il dit que les récurrences ne s’y posent pas, et « Saisir quand même » n’en pose aucune', async ({
        page,
        request,
    }) => {
        const date = claimDay(day(13));
        const off = claimDay(day(14));
        await writeDay(request, date, MORNING);
        await postRecurrence(request, date, MORNING[0] ?? { start: '', end: '' }, [1, 2, 3, 4, 5], day(15));
        // Le lendemain, un congé : objectif à 0h00.
        await writeDay(request, off, [], 0);
        await startTimeAt(page, off, '08:00');
        await openDay(page, off);

        await expect(
            page
                .getByText('Avec un objectif à 0h00, ce jour n’est pas travaillé.')
                .or(page.getByText("Avec un objectif à 0h00, ce jour n'est pas travaillé.")),
        ).toBeVisible();
        await expect(page.getByText("Vos récurrences ne s'y posent pas.")).toBeVisible();
        await page.getByRole('button', { name: 'Saisir quand même' }).click();
        await expect(blocks(page)).toHaveCount(0);
        await expectGridMatchesBase(page, request, off);
    });

    test('sans récurrence qui y tombe, il n’en dit rien', async ({ page, request }) => {
        const off = claimDay(day(16));
        await writeDay(request, off, [], 0);
        await startTimeAt(page, off, '08:00');
        await openDay(page, off);

        await expect(page.getByRole('button', { name: 'Saisir quand même' })).toBeVisible();
        await expect(page.getByText("Vos récurrences ne s'y posent pas.")).toBeHidden();
    });
});

test.describe('la fenêtre d’un ticket qui revient, sur un écran court', () => {
    for (const [index, viewport] of [
        [10, { width: 1440, height: 640 }],
        [11, { width: 1024, height: 720 }],
    ] as const) {
        test(`tient en ${String(viewport.width)} × ${String(viewport.height)} : son pied visible, Tab amène « Jusqu’au » à l’écran`, async ({
            page,
            request,
        }) => {
            const date = claimDay(day(index));
            await writeDay(request, date, MORNING);
            await page.setViewportSize(viewport);
            await startTimeAt(page, date, '15:20');
            await openDay(page, date);
            await scrollGridTo(page, '11:00');
            await doubleClickSlot(page, '15:15');
            const window = ticketWindow(page);
            await window.getByLabel('Ticket').fill('OPS-21');
            await recurrenceBox(window).click();

            await expect(window.getByRole('button', { name: 'Enregistrer' })).toBeInViewport({ ratio: 1 });
            await expect(window.getByRole('heading', { name: 'Nouveau ticket' })).toBeInViewport({ ratio: 1 });
            const shown = await window.boundingBox();
            expect((shown?.y ?? -1) >= 0 && (shown?.y ?? 0) + (shown?.height ?? 0) <= viewport.height).toBe(true);

            await until(window).focus();
            await expect(until(window)).toBeInViewport({ ratio: 1 });
            await page.keyboard.press('Escape');
            await expect(window).toBeHidden();
            await expect(slot(page, '15:15')).toBeVisible();
        });
    }
});

/**
 * Les états des récurrences, sur la journée d'exemple « en-cours » à 15:20 : la case
 * décochée et cochée dans Nouveau ticket, et la journée où le Daily et le déjeuner
 * reviennent. Chacun a sa capture de
 * référence aux trois largeurs et dans les deux thèmes, et son contrôle d'accessibilité.
 */
const recurrenceDay = weekdaysFrom('2016-03-07');
const ENTRIES = SCENARIOS[0]?.entries ?? [];
const SCREENS: { name: string; reach: (page: Page, request: APIRequestContext, date: string) => Promise<void> }[] = [
    {
        name: 'recurrence-ferme',
        reach: async (page) => {
            await doubleClickSlot(page, '15:15', 140);
            await ticketWindow(page).getByLabel('Ticket').fill('OPS-21');
            await expect(ticketWindow(page).getByText('Revue des alertes de production')).toBeVisible();
        },
    },
    {
        name: 'recurrence',
        reach: async (page) => {
            await doubleClickSlot(page, '15:15', 140);
            await ticketWindow(page).getByLabel('Ticket').fill('OPS-21');
            await expect(ticketWindow(page).getByText('Revue des alertes de production')).toBeVisible();
            await recurrenceBox(ticketWindow(page)).click();
            await expect(times(ticketWindow(page))).toHaveCount(5);
        },
    },
    {
        name: 'recurrence-posee',
        reach: async (page, request, date) => {
            await postRecurrence(
                request,
                date,
                { start: '09:15', end: '09:30', ticket: 'OPS-12', comment: 'Daily' },
                [1, 2, 3, 4, 5],
                date,
            );
            await postRecurrence(request, date, { start: '12:30', end: '13:30' }, [1, 2, 3, 4, 5], date);
            await page.reload();
            await expect(arrow(page, 'Revient chaque semaine, du lundi au vendredi')).toHaveCount(2);
        },
    },
    {
        name: 'recurrence-modifier',
        reach: async (page, request, date) => {
            await postRecurrence(
                request,
                date,
                { start: '09:15', end: '09:30', ticket: 'OPS-12', comment: 'Daily' },
                [1, 2, 3, 4, 5],
                date,
            );
            await page.reload();
            await doubleClickSlot(page, '09:15', 140);
            const window = ticketWindow(page, 'Modifier le ticket');
            await expect(recurrenceBox(window)).toBeChecked();
            await expect(window.getByText('Ne revient plus.')).toBeVisible();
        },
    },
    {
        name: 'recurrence-sans-jour',
        reach: async (page, request, date) => {
            await postRecurrence(
                request,
                date,
                { start: '09:15', end: '09:30', ticket: 'OPS-12', comment: 'Daily' },
                [1, 2, 3, 4, 5],
                date,
            );
            await page.reload();
            await doubleClickSlot(page, '09:15', 140);
            const window = ticketWindow(page, 'Modifier le ticket');
            for (const name of ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi']) {
                await dayButton(window, name).click();
            }
            await clickOutside(page);
            // Le refus pose le curseur sur le premier jour, et la fenêtre amène son message à l'écran.
            await expect(dayButton(window, 'Lundi')).toBeFocused();
            await expect(window.getByText('Choisissez au moins un jour.')).toBeInViewport({ ratio: 1 });
        },
    },
    {
        name: 'recurrence-infobulle',
        reach: async (page, request, date) => {
            await postRecurrence(
                request,
                date,
                { start: '09:15', end: '09:30', ticket: 'OPS-12', comment: 'Daily' },
                [1, 2, 3, 4, 5],
                date,
            );
            await page.reload();
            // Au survol seulement : la flèche n'entre pas dans le parcours au clavier.
            await arrow(page, 'Revient chaque semaine, du lundi au vendredi').hover();
            await expect(
                page.getByRole('tooltip', { name: 'Revient chaque semaine, du lundi au vendredi' }),
            ).toBeVisible();
        },
    },
];

/**
 * La question « quelles fois », après Enregistrer, après Suppr, après Couper et après Coller au
 * bord du Daily, sur des jours de 2016 que le navigateur voit comme aujourd'hui : elle s'y pose,
 * sans qu'on y réponde. Couper et Coller passent par le menu du clic droit, ouvert à 320 px du
 * bord de la colonne : la question s'ouvre sous le quart d'heure visé, à cette hauteur-là.
 */
const scopeDay = weekdaysFrom('2016-09-05');

const SCOPE_SCREENS: { name: string; reach: (page: Page) => Promise<void> }[] = [
    {
        name: 'recurrence-portee',
        reach: async (page) => {
            await doubleClickSlot(page, '09:15', 140);
            const window = ticketWindow(page, 'Modifier le ticket');
            await window.getByLabel('Commentaire').fill('Daily court');
            await window.getByRole('button', { name: 'Enregistrer' }).click();
            await expect(scopeWindow(page, 'Modifier une récurrence')).toBeVisible();
        },
    },
    {
        name: 'recurrence-effacer',
        reach: async (page) => {
            await clickSlot(page, '09:15');
            await page.keyboard.press('Delete');
            await expect(scopeWindow(page, 'Effacer une récurrence')).toBeVisible();
        },
    },
    {
        name: 'recurrence-couper',
        reach: async (page) => {
            await clickSlot(page, '09:15');
            await rightClickSlot(page, '09:15', 320);
            await menu(page).getByRole('menuitem', { name: 'Couper' }).click();
            const cut = scopeWindow(page, 'Couper une récurrence');
            await expect(
                cut.getByText(
                    'Les fois suivantes se déplacent là où vous collez. Les fois passées ne changent jamais.',
                ),
            ).toBeVisible();
            // Le pointeur s'en va : aucun bouton survolé.
            await page.mouse.move(0, 0);
        },
    },
    {
        name: 'recurrence-allonger',
        reach: async (page) => {
            // Le Daily copié, collé juste dessous : la question s'ouvre sur ce qu'on colle.
            await clickSlot(page, '09:15');
            await page.keyboard.press('ControlOrMeta+C');
            await clickSlot(page, '09:30');
            await rightClickSlot(page, '09:30', 320);
            await menu(page).getByRole('menuitem', { name: 'Coller' }).click();
            await expect(scopeWindow(page, 'Allonger une récurrence')).toContainText('de 09:15 à 09:45');
            await page.mouse.move(0, 0);
        },
    },
];

test.describe('la question « quelles fois », à l’écran', () => {
    SCOPE_SCREENS.forEach((screen, s) => {
        VIEWPORTS.forEach((viewport, v) => {
            THEMES.forEach(({ scheme, name }, t) => {
                const date = scopeDay(s * 6 + v * 2 + t);

                test(`${screen.name}, ${String(viewport.width)} × ${String(viewport.height)}, ${name}`, async ({
                    page,
                    request,
                }, testInfo) => {
                    await writeDay(request, date, ENTRIES);
                    await postRecurrence(
                        request,
                        date,
                        { start: '09:15', end: '09:30', ticket: 'OPS-12', comment: 'Daily' },
                        [1, 2, 3, 4, 5],
                        date,
                    );
                    await page.setViewportSize(viewport);
                    await page.emulateMedia({ colorScheme: scheme });
                    await openSampleDay(page, date);

                    await screen.reach(page);
                    await expectScreen(page, testInfo, `${screen.name}-${String(viewport.width)}-${name}.png`);
                    if (viewport.width === 1440) {
                        await expectAccessible(page);
                    }
                });
            });
        });
    });
});

test.describe('la question de Suppr, sur un bloc en bas de l’écran', () => {
    test('passe au-dessus du bloc, entière à l’écran, sa flèche au milieu de la colonne', async ({ page, request }) => {
        // Après les jours des captures de la question ; la récurrence finit le jour même.
        const date = scopeDay(SCOPE_SCREENS.length * VIEWPORTS.length * THEMES.length);
        await writeDay(request, date, []);
        await postRecurrence(
            request,
            date,
            { start: '19:30', end: '19:45', ticket: 'OPS-12', comment: 'Bilan du soir' },
            [1, 2, 3, 4, 5],
            date,
        );
        await page.setViewportSize({ width: 1024, height: 720 });
        await startTimeAt(page, date, '15:20');
        await openDay(page, date);
        // La grille défile jusqu'en bas : le bloc tient dans ses dernières rangées.
        await slot(page, '19:45').evaluate((option) => {
            const region = option.closest('[role="region"]');
            if (region !== null) {
                region.scrollTop = region.scrollHeight;
            }
        });
        const block = blocks(page).filter({ hasText: 'Bilan du soir' });
        await expect(block).toBeInViewport({ ratio: 1 });

        await clickSlot(page, '19:30');
        await page.keyboard.press('Delete');
        const question = scopeWindow(page, 'Effacer une récurrence');
        await expect(question.getByRole('radio', { name: 'Cette fois seulement' })).toBeFocused();
        await expect(question).toBeInViewport({ ratio: 1 });
        // Au-dessus du bloc, flèche vers le bas, faute de place dessous.
        await expect(question).toHaveAttribute('data-side', 'top');
        const shown = await question.boundingBox();
        const aimed = await block.boundingBox();
        expect(shown).not.toBeNull();
        expect(aimed).not.toBeNull();
        expect((shown?.y ?? 0) + (shown?.height ?? 0)).toBeLessThanOrEqual(aimed?.y ?? 0);
        // Au clavier, le milieu de la colonne tient lieu de pointeur : la question s'y centre,
        // à sa propre largeur, et sa flèche y tombe.
        const column = await lane(page).evaluate((element) => {
            const rect = element.getBoundingClientRect();

            return rect.left + element.clientLeft + element.clientWidth / 2;
        });
        const arrowX = await question.evaluate((dialog) => {
            const rect = dialog.lastElementChild?.getBoundingClientRect();

            return rect === undefined ? 0 : rect.left + rect.width / 2;
        });
        expect(Math.abs((shown?.x ?? 0) + (shown?.width ?? 0) / 2 - column)).toBeLessThanOrEqual(1);
        expect(Math.abs(arrowX - column)).toBeLessThanOrEqual(1);

        // Annuler la ferme, sans rien effacer.
        await question.getByRole('button', { name: 'Annuler' }).click();
        await expect(question).toBeHidden();
        await expect(block).toHaveCount(1);
        await expectGridMatchesBase(page, request, date);
    });
});

test.describe('les écrans des récurrences', () => {
    SCREENS.forEach((screen, s) => {
        VIEWPORTS.forEach((viewport, v) => {
            THEMES.forEach(({ scheme, name }, t) => {
                const date = recurrenceDay(s * 6 + v * 2 + t);

                test(`${screen.name}, ${String(viewport.width)} × ${String(viewport.height)}, ${name}`, async ({
                    page,
                    request,
                }, testInfo) => {
                    await writeDay(request, date, ENTRIES);
                    await page.setViewportSize(viewport);
                    await page.emulateMedia({ colorScheme: scheme });
                    await openSampleDay(page, date);

                    await screen.reach(page, request, date);
                    await expectScreen(page, testInfo, `${screen.name}-${String(viewport.width)}-${name}.png`);

                    if (viewport.width === 1440) {
                        // Une infobulle ouverte se pose à la racine de la page, hors des repères.
                        await expectAccessible(page, { exclude: [OPEN_TOOLTIP] });
                    }
                });
            });
        });
    });
});

/**
 * Les jours à venir et les congés : un jour à venir où les récurrences se montrent, un congé
 * à venir où elles ne se posent pas, et la journée en cours qu'on met à 0h00, la fenêtre de
 * l'objectif ouverte. Le jour à venir l'est pour le navigateur, qui vit deux jours avant lui.
 */
const aheadDay = weekdaysFrom('2016-05-02');

/** Ouvre `date` vue depuis `today`, à 15:20, le récapitulatif ouvert, comme la journée d'exemple. */
async function openFrom(page: Page, today: string, date: string): Promise<void> {
    await startTimeAt(page, today, '15:20');
    await page.addInitScript(() => {
        localStorage.setItem('daytrack.recap-open', 'true');
    });
    await page.goto(`/${date}`);
    await expect(figures(page)).toBeVisible();
    if ((page.viewportSize()?.width ?? 1440) < 1280) {
        await page.getByRole('button', { name: 'Afficher le récapitulatif' }).click();
        await page.mouse.move(0, 0);
        await expect(page.getByRole('complementary', { name: 'Récapitulatif' })).toHaveAttribute('data-state', 'open');
    }
}

const DAILY = { start: '09:15', end: '09:30', ticket: 'OPS-12', comment: 'Daily' };
const LUNCH = { start: '12:30', end: '13:30' };

const AHEAD_SCREENS: {
    name: string;
    reach: (page: Page, request: APIRequestContext, date: string) => Promise<void>;
}[] = [
    {
        name: 'recurrence-avenir',
        reach: async (page, request, date) => {
            await writeDay(request, date, [
                { start: '10:00', end: '11:00', ticket: 'SHOP-498', comment: 'Maquette du filtre' },
            ]);
            await postRecurrence(request, date, DAILY, [1, 2, 3, 4, 5], date);
            await postRecurrence(request, date, LUNCH, [1, 2, 3, 4, 5], date);
            await postRecurrence(
                request,
                date,
                { start: '14:00', end: '15:00', ticket: 'OPS-12', comment: 'Rétrospective' },
                [isoWeekday(date)],
                date,
            );
            await openFrom(page, addDays(date, -2), date);
            await expect(arrow(page, 'Revient chaque semaine, du lundi au vendredi')).toHaveCount(2);
            await expect(blocks(page)).toHaveCount(4);
        },
    },
    {
        name: 'recurrence-conge-avenir',
        reach: async (page, request, date) => {
            // Une récurrence y tombe ; le jour, vidé, est mis à 0h00.
            await writeDay(request, date, []);
            await postRecurrence(request, date, DAILY, [1, 2, 3, 4, 5], date);
            await writeDay(request, date, [], 0);
            await openFrom(page, addDays(date, -2), date);
            await expect(page.getByText("Vos récurrences ne s'y posent pas.")).toBeVisible();
        },
    },
    {
        name: 'recurrence-conge-apres',
        reach: async (page, request, date) => {
            await writeDay(request, date, ENTRIES);
            await postRecurrence(request, date, DAILY, [1, 2, 3, 4, 5], date);
            await postRecurrence(request, date, LUNCH, [1, 2, 3, 4, 5], date);
            await postRecurrence(
                request,
                date,
                { start: '13:30', end: '14:00', ticket: 'OPS-12', comment: 'Poker planning' },
                [isoWeekday(date)],
                date,
            );
            await openFrom(page, date, date);
            await objectiveButton(page).click();
            const window = objectiveWindow(page);
            await window.getByLabel('Durée à travailler').fill('0h00');
            await expect(window).toContainText(
                'Daily, la pause et Poker planning, posés par vos récurrences, seront retirés. Vos autres tickets restent.',
            );
        },
    },
];

test.describe('les jours à venir et les congés, à l’écran', () => {
    AHEAD_SCREENS.forEach((screen, s) => {
        VIEWPORTS.forEach((viewport, v) => {
            THEMES.forEach(({ scheme, name }, t) => {
                const date = aheadDay(s * 6 + v * 2 + t);

                test(`${screen.name}, ${String(viewport.width)} × ${String(viewport.height)}, ${name}`, async ({
                    page,
                    request,
                }, testInfo) => {
                    claimDay(date);
                    await page.setViewportSize(viewport);
                    await page.emulateMedia({ colorScheme: scheme });

                    await screen.reach(page, request, date);
                    await expectScreen(page, testInfo, `${screen.name}-${String(viewport.width)}-${name}.png`);

                    if (viewport.width === 1440) {
                        await expectAccessible(page);
                    }
                });
            });
        });
    });
});
