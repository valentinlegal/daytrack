import { readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { type APIRequestContext, type Page, test } from '@playwright/test';

/**
 * Poser une journée par l'API, comme le ferait la page, puis la regarder à une heure
 * donnée.
 *
 * Les parcours écrivent dans la base de l'application qu'ils visitent — celle du
 * développement sur le poste. Ils prennent donc des jours passés, que personne ne saisit
 * à la main, un jour par parcours pour ne jamais se gêner en parallèle, et les vident en
 * partant (clearDay). Deux fichiers qui prendraient le même jour échouent tout de suite
 * (claimDay), au lieu de se gêner de temps en temps.
 */

export interface Entry {
    readonly start: string;
    readonly end: string;
    /** Un ticket ; sans lui, c'est une pause. */
    readonly ticket?: string;
    readonly comment?: string;
}

/** Ce que le navigateur joint à une requête partie de la page de DayTrack (src/EventListener/SameOriginGuard.php). */
const SAME_ORIGIN = { 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' };

const HABITUAL_OBJECTIVE = 450;

/**
 * Inscrit ce jour au nom du fichier de parcours qui l'écrit (global-setup.ts) : un seul
 * fichier par jour. Chacun pose sa propre marque et relit ensuite le dossier : de deux
 * fichiers qui arrivent ensemble, le second voit forcément le premier.
 */
function claimDay(date: string): void {
    const claims = process.env.E2E_DAY_CLAIMS;
    if (claims === undefined) {
        throw new Error('La préparation des parcours (global-setup.ts) n’a pas tourné.');
    }
    writeFileSync(join(claims, `${date} ${basename(test.info().file)}`), '');
    const files = readdirSync(claims)
        .filter((claim) => claim.startsWith(`${date} `))
        .map((claim) => claim.slice(date.length + 1));
    if (files.length > 1) {
        throw new Error(`Le ${date} est pris par plusieurs fichiers de parcours : ${files.join(', ')}.`);
    }
}

/**
 * Remplace toute la journée par ces saisies, et pose son objectif. Un jour non travaillé
 * n'en a pas : le serveur le refuse, et seul l'habituel y passe, sans rien poser.
 */
export async function writeDay(
    request: APIRequestContext,
    date: string,
    entries: readonly Entry[],
    objective = HABITUAL_OBJECTIVE,
): Promise<void> {
    claimDay(date);
    const changes = [...gaps(entries), ...entries.map(change)];
    const slots = await request.patch(`/api/days/${date}/slots`, {
        headers: SAME_ORIGIN,
        data: { version: await versionOf(request, date), changes },
    });
    if (!slots.ok()) {
        throw new Error(`L'API refuse la journée du ${date} : ${String(slots.status())} ${await slots.text()}`);
    }
    const written = (await slots.json()) as { version: number; working: boolean };
    if (!written.working && objective === HABITUAL_OBJECTIVE) {
        return;
    }
    const response = await request.put(`/api/days/${date}/objective`, {
        headers: SAME_ORIGIN,
        data: { version: written.version, objective },
    });
    if (!response.ok()) {
        throw new Error(`L'API refuse l'objectif du ${date} : ${String(response.status())} ${await response.text()}`);
    }
}

/**
 * Le jour du lundi au vendredi qui suit `first` de `index` de ces jours, ou le précède si
 * `index` est négatif ; `first` lui-même pour 0, s'il en est un, sinon le lundi d'après.
 *
 * Ce sont les jours travaillés de l'application de développement (global-setup.ts) : un
 * parcours qui regarde une journée ordinaire en prend un. Un samedi s'ouvre fermé à la
 * saisie, sans objectif, et les flèches de la barre le sautent.
 */
export function weekday(first: string, index: number): string {
    const date = new Date(`${first}T00:00:00Z`);
    const weekend = () => date.getUTCDay() === 0 || date.getUTCDay() === 6;
    while (weekend()) {
        date.setUTCDate(date.getUTCDate() + 1);
    }
    for (let left = Math.abs(index); left > 0;) {
        date.setUTCDate(date.getUTCDate() + Math.sign(index));
        if (!weekend()) {
            left -= 1;
        }
    }

    return date.toISOString().slice(0, 10);
}

/** Le jour qui suit `date` de `days` jours du calendrier, ou le précède. */
export function addDays(date: string, days: number): string {
    const day = new Date(`${date}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + days);

    return day.toISOString().slice(0, 10);
}

/** Vide la journée et lui rend l'objectif habituel. */
export async function clearDay(request: APIRequestContext, date: string): Promise<void> {
    await writeDay(request, date, []);
}

/**
 * Fige l'heure du navigateur, avant d'ouvrir la page : le jour d'aujourd'hui et la
 * ligne « maintenant » en dépendent. L'heure ne tourne plus ensuite que par
 * page.clock.runFor ou fastForward.
 *
 * L'horloge s'installe une minute avant, et tourne jusqu'à la pause : installée à
 * l'instant même, elle l'aurait déjà dépassé d'une milliseconde de temps en temps, et
 * pauseAt refuse de revenir en arrière.
 */
export async function freezeTime(page: Page, date: string, time: string): Promise<void> {
    const instant = parisInstant(date, time);
    await page.clock.install({ time: instant.getTime() - 60_000 });
    await page.clock.pauseAt(instant);
}

/**
 * Pose l'heure du navigateur, avant d'ouvrir la page, et la laisse tourner : les
 * minuteurs de la page — celui du message, ceux des fenêtres — avancent avec elle.
 */
export async function startTimeAt(page: Page, date: string, time: string): Promise<void> {
    await page.clock.install({ time: parisInstant(date, time) });
}

async function versionOf(request: APIRequestContext, date: string): Promise<number> {
    const response = await request.get(`/api/days/${date}`);

    return ((await response.json()) as { version: number }).version;
}

function change(entry: Entry) {
    return entry.ticket === undefined
        ? { start: entry.start, end: entry.end, kind: 'pause' }
        : { start: entry.start, end: entry.end, kind: 'work', ticket: entry.ticket, comment: entry.comment ?? null };
}

/** Les plages de 07:00 à 20:00 qu'aucune saisie ne couvre : elles se vident. */
function gaps(entries: readonly Entry[]) {
    const sorted = [...entries].sort((a, b) => a.start.localeCompare(b.start));
    const empty: { start: string; end: string; kind: 'empty' }[] = [];
    let cursor = '07:00';
    for (const { start, end } of sorted) {
        if (start > cursor) {
            empty.push({ start: cursor, end: start, kind: 'empty' });
        }
        cursor = end;
    }
    if (cursor < '20:00') {
        empty.push({ start: cursor, end: '20:00', kind: 'empty' });
    }

    return empty;
}

/** L'instant où il est cette heure-là à Paris, le fuseau de l'application de développement (.env). */
function parisInstant(date: string, time: string): Date {
    const paris = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Paris',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    });
    for (const offset of ['+02:00', '+01:00']) {
        const instant = new Date(`${date}T${time}:00${offset}`);
        if (paris.format(instant) === `${date} ${time}`) {
            return instant;
        }
    }

    throw new RangeError(`${date} ${time} n'existe pas à Paris.`);
}
