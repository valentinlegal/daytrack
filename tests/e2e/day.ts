import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { type APIRequestContext, type Page, test, type TestInfo } from '@playwright/test';

/**
 * Poser une journée par l'API, comme le ferait la page, puis la regarder à une heure
 * donnée.
 *
 * Les parcours écrivent dans la base de l'application qu'ils visitent — celle du
 * développement sur le poste. Ils prennent donc des jours passés, que personne ne saisit
 * à la main, un jour par parcours pour ne jamais se gêner en parallèle (claimDay), et ces
 * jours se vident quand le parcours s'arrête, qu'il réussisse ou non (fixtures.ts). Deux
 * parcours qui prendraient le même jour échouent tout de suite, au lieu de se gêner de
 * temps en temps.
 */

export interface Entry {
    readonly start: string;
    readonly end: string;
    /** Un ticket ; sans lui, c'est une pause. */
    readonly ticket?: string;
    readonly comment?: string;
}

/** Ce que le navigateur joint à une requête partie de la page de DayTrack (src/EventListener/SameOriginGuard.php). */
export const SAME_ORIGIN = { 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' };

const HABITUAL_OBJECTIVE = 450;

/** Les jours que le parcours en cours a pris, à vider quand il s'arrête (fixtures.ts). */
let taken: Set<string> | null = null;

/**
 * Les jours qu'un fichier a pris pour tous ses parcours, hors de l'un d'eux — dans un
 * beforeAll —, par son chemin : c'est lui qui les vide, dans son afterAll, et pas le premier
 * parcours qui y écrit.
 */
const shared = new Map<string, Set<string>>();

/** Les fichiers dont les parcours passent l'un après l'autre, par leur chemin. */
const inOrder = new Map<string, boolean>();

/**
 * Prend ce jour pour le parcours en cours : il se vide quand le parcours s'arrête
 * (fixtures.ts) — ou, pris dans un beforeAll, dans l'afterAll du fichier. Le jour
 * s'inscrit au nom de son parcours dans le dossier des réservations (global-setup.ts),
 * pour tout le lancement : deux parcours qui peuvent tourner en même temps ne prennent
 * jamais le même jour, même s'ils ne se croisent qu'une fois sur cent. Chacun pose sa
 * propre marque et relit ensuite le dossier : de deux parcours qui arrivent ensemble, le
 * second voit forcément le premier.
 *
 * Seuls ceux d'un fichier qui les passe l'un après l'autre partagent leurs jours.
 */
export function claimDay(date: string): string {
    const claims = process.env.E2E_DAY_CLAIMS;
    if (claims === undefined) {
        throw new Error('La préparation des parcours (global-setup.ts) n’a pas tourné.');
    }
    const info = test.info();
    // Un parcours par son titre, pas par son identifiant : repris après un échec, ou rejoué
    // en série (--repeat-each, --workers=1), il garde son jour. Rejouées en parallèle, ses
    // répétitions prendraient le même jour en même temps : elles se refusent.
    const repeated = info.repeatEachIndex > 0 && info.config.workers > 1;
    const holder = runsInOrder(info)
        ? basename(info.file)
        : `${info.titlePath.join(' › ')}${repeated ? ` (répétition ${String(info.repeatEachIndex + 1)})` : ''}`;
    const key = createHash('sha1').update(holder).digest('hex');
    writeFileSync(join(claims, `${date} ${key}`), holder);
    const holders = readdirSync(claims)
        .filter((claim) => claim.startsWith(`${date} `))
        .map((claim) => readFileSync(join(claims, claim), 'utf8'))
        .sort();
    if (holders.length > 1) {
        const again = repeated ? ' Rejouez ses répétitions l’une après l’autre : --workers=1.' : '';
        throw new Error(`Le ${date} est pris par plusieurs parcours : ${holders.join(' ; ')}.${again}`);
    }
    const ofFile = shared.get(info.file) ?? new Set<string>();
    shared.set(info.file, ofFile);
    if (taken === null) {
        ofFile.add(date);
    } else if (!ofFile.has(date)) {
        taken.add(date);
    }

    return date;
}

/** Recueille les jours que prend le parcours qui commence (fixtures.ts). */
export function collectDays(): void {
    taken = new Set();
}

/**
 * Les jours que le parcours a pris, à vider. Ceux que reprend le ménage ne passent pas pour
 * autant au fichier : le parcours suivant qui les écrit les videra aussi (stopCollecting).
 */
export function releaseDays(): string[] {
    const days = [...(taken ?? [])];
    taken = new Set();

    return days;
}

/** Le parcours est vidé : jusqu'au suivant, un jour pris l'est pour tout le fichier. */
export function stopCollecting(): void {
    taken = null;
}

/**
 * Un fichier passe ses parcours l'un après l'autre quand rien ne les fait tourner ensemble,
 * ou qu'il le demande lui-même, en tête de fichier.
 */
function runsInOrder(info: TestInfo): boolean {
    let known = inOrder.get(info.file);
    if (known === undefined) {
        const mode = /^test\.describe\.configure\(\{ mode: '(default|serial|parallel)' \}\);$/m.exec(
            readFileSync(info.file, 'utf8'),
        )?.[1];
        known = mode === undefined ? !info.config.fullyParallel : mode !== 'parallel';
        inOrder.set(info.file, known);
    }

    return known;
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

/**
 * Les jours d'un fichier de parcours, comptés au calendrier : `day(1)` est le lendemain de
 * `first`, samedi et dimanche compris. Chaque fichier a les siens, que les autres ne
 * prennent pas.
 */
export function daysFrom(first: string): (index: number) => string {
    return (index) => addDays(first, index);
}

/**
 * Les jours d'un fichier de parcours, comptés en jours de semaine (weekday) : `workday(1)` est
 * le jour du lundi au vendredi qui suit `first`. Chaque fichier a les siens, que les autres
 * ne prennent pas.
 */
export function weekdaysFrom(first: string): (index: number) => string {
    return (index) => weekday(first, index);
}

/** Vide la journée et lui rend l'objectif habituel de l'application, qu'elle suit de nouveau. */
export async function clearDay(request: APIRequestContext, date: string): Promise<void> {
    const { habitualObjective, working } = (await (await request.get(`/api/days/${date}`)).json()) as {
        habitualObjective: number;
        working: boolean;
    };
    // Un jour non travaillé n'a pas d'objectif à rendre : le serveur le refuserait.
    await writeDay(request, date, [], working ? habitualObjective : undefined);
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
