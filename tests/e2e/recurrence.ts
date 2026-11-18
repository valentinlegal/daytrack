import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { addDays, SAME_ORIGIN } from './day';
import { blocks } from './editing';

/**
 * Ce que les parcours des récurrences partagent : les champs que déplie la case
 * « Récurrence », la flèche d'un bloc qui revient, et les récurrences qu'ils posent ou
 * retirent par l'API, comme la fenêtre (tests/e2e/recurrences.spec.ts,
 * tests/e2e/recurrence-rhythms.spec.ts).
 */

export function recurrenceBox(window: Locator): Locator {
    return window.getByRole('checkbox', { name: 'Récurrence' });
}

export function dayButton(window: Locator, name: string): Locator {
    return window.getByRole('group', { name: 'Jours' }).getByRole('button', { name });
}

export function until(window: Locator): Locator {
    return window.getByLabel("Jusqu'au");
}

export function times(window: Locator): Locator {
    return window.getByRole('list', { name: 'Prochaines fois' }).getByRole('listitem');
}

/** La flèche d'un bloc qui revient, par ce que le lecteur d'écran en lit. */
export function arrow(page: Page, label: string): Locator {
    return blocks(page).getByRole('img', { name: label });
}

/** Une plage de la grille, et ce qui l'occupe : sans ticket, une pause. */
export interface Range {
    readonly start: string;
    readonly end: string;
    readonly ticket?: string;
    readonly comment?: string;
}

/**
 * Le rythme, au-delà des jours de la semaine : chaque semaine par défaut, une semaine sur
 * n, ou chaque mois au rang ou à la date (src/Api/Input/RecurrenceRuleInput.php).
 */
export interface RhythmFields {
    readonly kind?: 'weekly' | 'monthly_weekday' | 'monthly_date';
    readonly everyWeeks?: number;
    readonly monthWeek?: number | null;
    readonly monthDay?: number | null;
}

/**
 * Pose une récurrence par l'API, comme la fenêtre : sur la plage d'un bloc, ses jours, sa
 * fin, et son rythme s'il n'est pas de chaque semaine.
 */
export async function postRecurrence(
    request: APIRequestContext,
    date: string,
    range: Range,
    weekdays: number[],
    end: string | null,
    rhythm: RhythmFields = {},
): Promise<void> {
    const { version } = (await (await request.get(`/api/days/${date}`)).json()) as { version: number };
    const response = await request.put(`/api/days/${date}/recurrence`, {
        headers: SAME_ORIGIN,
        data: { version, changes: [changeOf(range)], recurrence: { weekdays, until: end, ...rhythm }, replaces: null },
    });
    if (!response.ok()) {
        throw new Error(
            `L'API refuse la récurrence du ${date} : ${String(response.status())} ${await response.text()}`,
        );
    }
}

/**
 * Retire la récurrence née du bloc de `range.start`, comme décocher sa case depuis son premier
 * jour : elle ne tombe plus jamais. Le bloc reste, sans flèche, et le ménage du parcours le vide.
 */
export async function withdrawRecurrence(
    request: APIRequestContext,
    date: string,
    range: Range,
    weekdays: number[],
): Promise<void> {
    const { version, blocks: shown } = (await (await request.get(`/api/days/${date}`)).json()) as {
        version: number;
        blocks: { start: string; recurrence: string | null }[];
    };
    const id = shown.find((block) => block.start === range.start)?.recurrence ?? null;
    if (id === null) {
        return;
    }
    const { until: end } = (
        (await (await request.get(`/api/days/${date}`)).json()) as {
            recurrences: Record<string, { until: string | null }>;
        }
    ).recurrences[id] ?? { until: null };
    const response = await request.put(`/api/days/${date}/recurrence`, {
        headers: SAME_ORIGIN,
        data: { version, changes: [changeOf(range)], recurrence: null, replaces: { id, weekdays, until: end } },
    });
    if (!response.ok()) {
        throw new Error(
            `L'API ne retire pas la récurrence du ${date} : ${String(response.status())} ${await response.text()}`,
        );
    }
}

/**
 * Sert la journée avec ces récurrences seules dans `ongoing`, à la place de celles de la
 * base : l'écran ne dépend ni des récurrences du poste, ni de celles d'un autre parcours.
 * Rien n'est écrit.
 */
export async function serveOngoing(page: Page, date: string, ongoing: Record<string, object>): Promise<void> {
    await page.route(
        (url) => url.pathname === `/api/days/${date}`,
        async (route) => {
            if (route.request().method() !== 'GET') {
                await route.fallback();

                return;
            }
            const response = await route.fetch();
            await route.fulfill({ response, json: { ...((await response.json()) as object), ongoing } });
        },
    );
}

/** Aujourd'hui pour le serveur, à Paris, au format « AAAA-MM-JJ ». */
export function serverToday(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
}

/** Le jour de la semaine ISO, de 1 pour lundi à 7 pour dimanche. */
export function isoWeekday(date: string): number {
    return ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

/** Le `index`-ième jour de ce jour de la semaine ISO après `today` : 0 pour le premier. */
export function nextWeekday(today: string, weekday: number, index: number): string {
    return addDays(today, ((weekday - isoWeekday(today) + 7) % 7 || 7) + 7 * index);
}

function changeOf(range: Range) {
    return range.ticket === undefined
        ? { start: range.start, end: range.end, kind: 'pause' }
        : { start: range.start, end: range.end, kind: 'work', ticket: range.ticket, comment: range.comment ?? null };
}
