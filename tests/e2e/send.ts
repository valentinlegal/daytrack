import type { APIRequestContext, Locator, Page, Route } from '@playwright/test';

import { clearDay, SAME_ORIGIN, writeDay } from './day';

/**
 * L'envoi sur Jira, vu des parcours. Il part du serveur de l'application vers le Jira
 * simulé (dev/jira/), jamais vers un vrai Jira (global-setup.ts) ; un parcours relit ce
 * que ce Jira a reçu, et défait ses envois en partant.
 */

/** Le Jira simulé, tel que l'application le joint, dans le réseau du conteneur des parcours. */
const SIMULATED_JIRA = 'https://jira/_simulation';

/** Le compte du Jira simulé (dev/jira/src/Catalog.php) : celui dont l'envoi remplace les heures. */
const ACCOUNT_ID = '712020:simule-dev';

export interface ReceivedWorklog {
    readonly id: string;
    readonly ticket: string;
    /** « 09:30 », à l'heure de Paris. */
    readonly time: string;
    readonly seconds: number;
    readonly comment: string | null;
}

/** Les saisies de l'utilisateur que le Jira simulé a pour ce jour, dans l'ordre du jour. */
export async function receivedWorklogs(request: APIRequestContext, date: string): Promise<ReceivedWorklog[]> {
    const state = (await (await request.get(SIMULATED_JIRA, { ignoreHTTPSErrors: true })).json()) as {
        worklogs: {
            id: string;
            issueKey: string;
            authorId: string;
            started: string;
            timeSpentSeconds: number;
            comment: unknown;
        }[];
    };

    return state.worklogs
        .filter((worklog) => worklog.authorId === ACCOUNT_ID && worklog.started.startsWith(date))
        .map((worklog) => ({
            id: worklog.id,
            ticket: worklog.issueKey,
            time: worklog.started.slice(11, 16),
            seconds: worklog.timeSpentSeconds,
            comment: textOf(worklog.comment),
        }))
        .sort((a, b) => a.time.localeCompare(b.time) || a.ticket.localeCompare(b.ticket));
}

/**
 * Vide la journée, et la renvoie si elle a été envoyée : le Jira simulé n'en garde plus
 * rien, et l'envoi enregistré disparaît avec lui. Un essai raté reste en mémoire même la
 * journée vidée, et reviendrait avec la même journée au parcours suivant ; une journée
 * vidée dont Jira ne trouvait plus un ticket reste envoyée, pour le redire. Un envoi
 * complet, puis le renvoi de la journée vidée, effacent l'un et l'autre.
 */
export async function clearSentDay(request: APIRequestContext, date: string): Promise<void> {
    await clearDay(request, date);
    const cleared = (await sendOf(request, date)).send;
    if (cleared.attemptedAt !== null || cleared.state === 'sent') {
        await writeDay(request, date, [{ start: '07:00', end: '07:15', ticket: 'ESSAI-1' }]);
        await sendDay(request, date);
        await clearDay(request, date);
    }
    if ((await sendOf(request, date)).send.state !== 'nothing') {
        await sendDay(request, date);
    }
}

async function sendOf(
    request: APIRequestContext,
    date: string,
): Promise<{ version: number; send: { state: string; attemptedAt: unknown } }> {
    return (await (await request.get(`/api/days/${date}`)).json()) as {
        version: number;
        send: { state: string; attemptedAt: unknown };
    };
}

async function sendDay(request: APIRequestContext, date: string): Promise<void> {
    const { version } = await sendOf(request, date);
    await request.post(`/api/days/${date}/send`, { headers: SAME_ORIGIN, data: { version } });
}

/** Le bouton Jira, quel que soit son état. */
export function sendButton(page: Page): Locator {
    return page.locator('.send-button');
}

/** La fenêtre du bouton Jira qui porte ce titre. */
export function sendWindow(page: Page, title: string): Locator {
    return page.getByRole('dialog', { name: title });
}

/**
 * Change ce que le serveur dit de l'envoi de la journée, lue ou envoyée : pour un écran
 * qui doit montrer une heure fixe, ou ce qu'un Jira que le parcours ne peut pas mettre en
 * panne aurait répondu.
 */
export async function rewriteSend(
    page: Page,
    rewrite: (send: Record<string, unknown>, url: URL) => Record<string, unknown>,
): Promise<void> {
    await page.route('**/api/days/**', async (route: Route) => {
        const response = await route.fetch();
        const json: unknown = await response.json().catch(() => null);
        if (typeof json !== 'object' || json === null) {
            await route.fulfill({ response });

            return;
        }
        const day = 'day' in json && typeof json.day === 'object' && json.day !== null ? json.day : json;
        if ('send' in day && typeof day.send === 'object' && day.send !== null) {
            Object.assign(day, { send: rewrite(day.send as Record<string, unknown>, new URL(route.request().url())) });
        }
        await route.fulfill({ response, json });
    });
}

function textOf(document: unknown): string | null {
    const parts: string[] = [];
    const walk = (node: unknown) => {
        if (typeof node !== 'object' || node === null) {
            return;
        }
        if ('text' in node && typeof node.text === 'string') {
            parts.push(node.text);
        }
        if ('content' in node && Array.isArray(node.content)) {
            node.content.forEach(walk);
        }
    };
    walk(document);
    const text = parts.join(' ').trim();

    return text === '' ? null : text;
}

/**
 * Retient l'envoi de ce jour dans le navigateur : le voile reste posé, et l'envoi
 * n'atteint jamais le serveur. Ce qui est rendu le relâche, en répondant la journée
 * telle qu'elle est, sans rien d'envoyé.
 */
export async function holdSend(page: Page, date: string): Promise<() => Promise<void>> {
    const held: { route: Route | null } = { route: null };
    await page.route(`**/api/days/${date}/send`, (route) => {
        held.route = route;
    });

    return async () => {
        const route = held.route;
        if (route !== null) {
            const response = await page.request.get(`/api/days/${date}`);
            await route.fulfill({ status: 200, json: (await response.json()) as unknown });
        }
    };
}
