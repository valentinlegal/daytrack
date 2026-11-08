import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { claimDay, weekdaysFrom, writeDay } from './day';
import { doubleClickSlot, openDay, savedDay, ticketWindow } from './editing';
import { expect, test } from './fixtures';

/**
 * Les jours qu'un parcours écrit se vident quand il s'arrête, même quand il échoue, qu'il
 * les ait posés par l'API ou que sa page les ait écrits ; et deux parcours qui pourraient
 * tourner ensemble ne prennent jamais le même jour (tests/e2e/day.ts, tests/e2e/fixtures.ts).
 *
 * Des jours de juin 2019, que les autres parcours ne prennent pas.
 */
test.describe.configure({ mode: 'serial' });

const workday = weekdaysFrom('2019-06-03');
const BY_API = workday(0);
const BY_PAGE = workday(1);

/** Le premier parcours est allé jusqu'à son échec voulu, ses deux jours remplis. */
let filledBeforeFailing = false;

test('un parcours qui échoue après avoir écrit ses jours, par l’API et par un geste de sa page', async ({
    page,
    request,
}) => {
    test.fail(true, 'Il échoue exprès : le suivant vérifie que ses jours sont vides.');

    await writeDay(request, BY_API, [{ start: '09:00', end: '10:00', ticket: 'ESSAI-1' }], 120);
    // La page écrit elle-même, par un geste : le parcours ne prend pas ce jour par l'API.
    await openDay(page, BY_PAGE);
    await doubleClickSlot(page, '14:00');
    const window = ticketWindow(page);
    await window.getByLabel('Ticket').fill('ESSAI-2');
    await window.getByLabel('Ticket').press('Enter');
    await expect(window).toHaveCount(0);
    await expect.poll(() => savedDay(request, BY_PAGE)).toHaveLength(1);
    expect(await savedDay(request, BY_API)).toHaveLength(1);
    filledBeforeFailing = true;

    expect('le parcours', 'échoue ici, ses jours encore remplis').toBe('vide');
});

test('ses jours sont vides, et leur objectif est l’habituel', async ({ request }) => {
    expect(filledBeforeFailing, 'le parcours d’avant a rempli ses jours avant d’échouer').toBe(true);
    for (const date of [BY_API, BY_PAGE]) {
        expect(await savedDay(request, date), date).toEqual([]);
        const day = (await (await request.get(`/api/days/${date}`)).json()) as {
            objective: number;
            habitualObjective: number;
        };
        expect(day.objective, date).toBe(day.habitualObjective);
    }
});

test('un parcours suivant du même fichier qui reprend un de ces jours', async ({ request }) => {
    await writeDay(request, BY_API, [{ start: '11:00', end: '11:30', ticket: 'ESSAI-1' }]);
    expect(await savedDay(request, BY_API)).toHaveLength(1);
});

test('le vide aussi en partant', async ({ request }) => {
    expect(await savedDay(request, BY_API)).toEqual([]);
});

test('un jour déjà pris par un parcours qui peut tourner en même temps se refuse', () => {
    const date = workday(2);
    const claims = process.env.E2E_DAY_CLAIMS ?? '';
    writeFileSync(join(claims, `${date} un-autre-parcours`), 'autre.spec.ts › un parcours d’un autre fichier');

    expect(() => claimDay(date)).toThrow(
        `Le ${date} est pris par plusieurs parcours : autre.spec.ts › un parcours d’un autre fichier ; claimed-days.spec.ts.`,
    );
});
