import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { addDays, claimDay, SAME_ORIGIN } from './day';
import { blocks, doubleClickSlot, openDay, ticketWindow } from './editing';
import { expect, test } from './fixtures';
import { postRecurrence, recurrenceBox, until } from './recurrence';

/**
 * « Jusqu'au » montre la dernière fois d'une récurrence, jamais une fin où elle ne tombe pas —
 * celle que « Cette fois et les suivantes » pose à la veille du jour touché, que personne n'a
 * saisie. Ici, le Point revient chaque jeudi, de 13:00 à 13:30, et finit le lendemain, un
 * vendredi, où il ne vient pas : sa fenêtre montre le jeudi. La coupe d'une récurrence plus loin,
 * puis son collage, se jouent sur la vraie fenêtre, sans navigateur
 * (tests/front/day/gridUntil.test.tsx) : ils demandent des jours à venir, que d'autres parcours
 * prennent.
 *
 * Le parcours prend un jeudi de 2013, qu'aucun autre ne prend. Il doit être vierge — ni bloc, ni
 * congé, ni objectif choisi, ni envoi — avant d'être pris : le ménage des parcours le vide en
 * entier quand ils s'arrêtent (fixtures.ts), et effacerait ce que le poste y garde. Le parcours ne
 * retire que la récurrence qu'il a fait naître.
 */
test.describe.configure({ mode: 'default' });

const DATE = '2013-03-07';
const POINT = { start: '13:00', end: '13:30', ticket: 'OPS-12', comment: 'Point' };

interface ShownDay {
    readonly version: number;
    readonly objective: number;
    readonly habitualObjective: number;
    readonly declaredOff: boolean;
    readonly send: { readonly state: string };
    readonly blocks: { start: string; end: string; recurrence: string | null }[];
    readonly recurrences: Record<string, { until: string | null; firstDay: string; slot: { comment: string | null } }>;
}

async function shownDay(request: APIRequestContext, date: string): Promise<ShownDay> {
    return (await (await request.get(`/api/days/${date}`)).json()) as ShownDay;
}

/** Le jour du parcours, vierge, et pris ; rien n'est pris tant qu'il ne l'est pas. */
async function takeDay(request: APIRequestContext): Promise<string> {
    const day = await shownDay(request, DATE);
    if (
        day.blocks.length > 0 ||
        day.declaredOff ||
        day.objective !== day.habitualObjective ||
        day.send.state !== 'nothing'
    ) {
        throw new Error(`Le ${DATE} n'est pas vierge : ce parcours a besoin de ce jour sans rien.`);
    }

    return claimDay(DATE);
}

/**
 * Retire la récurrence du Point née ce jour-là, et rien d'autre, comme annuler sa création. Le
 * jour se vide ensuite (fixtures.ts).
 */
async function withdrawOurs(request: APIRequestContext): Promise<void> {
    const { recurrences, version } = await shownDay(request, DATE);
    for (const [id, rule] of Object.entries(recurrences)) {
        if (rule.firstDay !== DATE || rule.slot.comment !== POINT.comment) {
            continue;
        }
        await request.patch(`/api/days/${DATE}/slots`, {
            headers: SAME_ORIGIN,
            data: { version, changes: [], recurrences: [{ recurrence: id, from: rule.until, to: addDays(DATE, -1) }] },
        });
    }
}

function block(page: Page, text: string): Locator {
    return blocks(page).filter({ hasText: text });
}

test.describe('« Jusqu’au » d’une récurrence qui finit un jour où elle ne vient pas', () => {
    test('montre sa dernière fois, le jeudi, pas le vendredi enregistré', async ({ page, request }) => {
        const date = await takeDay(request);
        try {
            await postRecurrence(request, date, POINT, [4], addDays(date, 1));
            await openDay(page, date);
            await expect(block(page, 'Point')).toContainText('De 13:00 à 13:30');

            await doubleClickSlot(page, '13:00');
            const window = ticketWindow(page, 'Modifier le ticket');
            await expect(recurrenceBox(window)).toBeChecked();
            await expect(until(window)).toHaveValue(date);
            await page.keyboard.press('Escape');
            await expect(window).toBeHidden();
        } finally {
            await withdrawOurs(request);
        }
    });
});
