import { addDays, isDate, isoWeekday } from '../day/calendar';
import type { QuarterChanges } from './changes';
import { type Cell, type Grid, normalizeCell, sameContent, unlinked } from './grid';
import { isRecord } from './json';
import * as Quarter from './quarter';

/**
 * Les récurrences, vues du moteur : leur rythme, les jours où elles tombent, et la règle
 * qui détache une fois entière quand un geste lui prend un quart d'heure.
 *
 * Les jours où une récurrence tombe ont une seule définition, celle du serveur
 * (src/Recurrence/Rhythm.php) : les cas de tests/cases/recurrences.json les éprouvent des
 * deux côtés. La fenêtre les annonce, le serveur les pose.
 */

/** Comment une récurrence revient (src/Recurrence/RhythmKind.php). */
export type RhythmKind = 'weekly' | 'monthly_weekday' | 'monthly_date';

/** Le dernier jour de la semaine du mois. */
export const LAST_WEEK = -1;

export interface Rhythm {
    readonly kind: RhythmKind;
    /** En jours de la semaine ISO, de 1 pour lundi à 7 pour dimanche, dans l'ordre. */
    readonly weekdays: readonly number[];
    /** Chaque semaine (1), ou une semaine sur 2, 3 ou 4. */
    readonly everyWeeks: number;
    /** Le n-ième jour de la semaine du mois, de 1 à 4, ou le dernier (LAST_WEEK). */
    readonly monthWeek: number | null;
    /** La date du mois, du 1er au 31. */
    readonly monthDay: number | null;
}

/** Ce qui définit les jours où elle tombe : son rythme, compté depuis son premier jour, jusqu'à sa fin. */
export interface Schedule {
    readonly rhythm: Rhythm;
    /** « AAAA-MM-JJ ». */
    readonly firstDay: string;
    readonly until: string | null;
    /**
     * Ses fois détachées ou effacées « cette fois seulement » après aujourd'hui, « AAAA-MM-JJ » :
     * elle y tombe encore, mais ne s'y pose plus (src/Repository/RecurrenceRepository.php,
     * skippedAfter).
     */
    readonly skipped?: readonly string[];
}

/** Un rythme sur une plage de la journée, de son premier jour à sa fin : ce qui prend un créneau. */
export interface TimedSchedule extends Schedule {
    /** Sa plage, en minutes depuis minuit. */
    readonly start: number;
    readonly end: number;
}

/** Ce qu'elle pose : un ticket et son commentaire, ou une pause. */
export type RecurrenceContent =
    { readonly kind: 'work'; readonly ticket: string; readonly comment: string | null } | { readonly kind: 'pause' };

/** Une récurrence telle que l'API la rend (src/Recurrence/RecurrenceView.php). */
export interface Recurrence extends TimedSchedule {
    readonly id: string;
    readonly content: RecurrenceContent;
}

/**
 * Ce que la fenêtre règle d'une récurrence (src/Api/Input/RecurrenceRuleInput.php) : son
 * rythme et sa fin.
 */
export interface RecurrenceRule extends Rhythm {
    /** « AAAA-MM-JJ », ou null sans fin. */
    readonly until: string | null;
}

/**
 * La récurrence que portait le bloc d'une fenêtre, telle que la fenêtre l'a vue : ses jours
 * et sa fin (src/Api/Input/ReplacedRecurrenceInput.php). Changée depuis, dans un autre
 * onglet, le serveur refuse de la remplacer, comme une journée en retard.
 */
export interface SeenRecurrence {
    readonly id: string;
    /** En jours de la semaine ISO. */
    readonly weekdays: readonly number[];
    readonly until: string | null;
}

/**
 * Elle va encore jusqu'à ce jour. Finie avant lui — retirée ou arrêtée depuis un autre
 * jour —, le bloc qu'elle y avait posé n'en est plus une fois : ni flèche, ni case cochée.
 */
export function reaches(recurrence: Recurrence, date: string): boolean {
    return recurrence.until === null || recurrence.until >= date;
}

/** Ce qu'une fenêtre voit d'une récurrence. */
export function seenOf(recurrence: Recurrence): SeenRecurrence {
    return { id: recurrence.id, weekdays: recurrence.rhythm.weekdays, until: recurrence.until };
}

/** Chaque semaine, ou une semaine sur 2, 3 ou 4, ces jours-là. */
export function weekly(weekdays: readonly number[], everyWeeks = 1): Rhythm {
    return {
        kind: 'weekly',
        weekdays: [...new Set(weekdays)].sort((a, b) => a - b),
        everyWeeks,
        monthWeek: null,
        monthDay: null,
    };
}

/** Le n-ième jour de la semaine du mois, de 1 à 4, ou le dernier (LAST_WEEK) : le 3e vendredi. */
export function monthlyWeekday(weekday: number, week: number): Rhythm {
    return { kind: 'monthly_weekday', weekdays: [weekday], everyWeeks: 1, monthWeek: week, monthDay: null };
}

/** Une date du mois : le 16. Un mois qui ne l'a pas n'en a pas. */
export function monthlyDate(day: number): Rhythm {
    return { kind: 'monthly_date', weekdays: [], everyWeeks: 1, monthWeek: null, monthDay: day };
}

export function sameRhythm(a: Rhythm, b: Rhythm): boolean {
    return (
        a.kind === b.kind &&
        a.weekdays.join() === b.weekdays.join() &&
        a.everyWeeks === b.everyWeeks &&
        a.monthWeek === b.monthWeek &&
        a.monthDay === b.monthDay
    );
}

/**
 * Les rythmes mensuels que ce jour permet, dans l'ordre où la fenêtre les propose : son
 * rang dans le mois, du 1er au 4e — un « 5e jeudi » n'existe pas tous les mois —, sa date, et
 * « le dernier » quand il l'est. Le serveur refuse les autres (src/Recurrence/Rhythm.php,
 * permittedBy). Un jour que les réglages ne travaillent pas n'a que sa date : un rang y
 * tomberait toujours un jour non travaillé — sauf le rythme que la récurrence a déjà
 * (`kept`), qu'elle garde tant qu'on ne le change pas, comme les jours de la semaine décochés
 * des réglages après coup.
 */
export function monthlyChoices(date: string, workingDays: readonly number[], kept: Rhythm | null = null): Rhythm[] {
    const weekday = isoWeekday(date);
    const dayOfMonth = Number(date.slice(8, 10));
    const rank = Math.ceil(dayOfMonth / 7);
    const working = workingDays.includes(weekday);
    const last = addDays(date, 7).slice(5, 7) !== date.slice(5, 7);
    const offered = (rhythm: Rhythm) => (working || (kept !== null && sameRhythm(kept, rhythm)) ? [rhythm] : []);

    return [
        ...(rank <= 4 ? offered(monthlyWeekday(weekday, rank)) : []),
        monthlyDate(dayOfMonth),
        ...(last ? offered(monthlyWeekday(weekday, LAST_WEEK)) : []),
    ];
}

/**
 * Le rythme d'une récurrence coupée avec les suivantes, collée un autre jour : il prend ce que
 * permet ce jour, de la même sorte. Un seul jour par semaine devient celui du collage, une
 * semaine sur n comptée depuis la sienne ; plusieurs jours restent les mêmes. Un n-ième jour
 * du mois devient celui du collage, à son rang — le dernier quand il l'était et que ce jour
 * l'est aussi, ou quand ce serait un 5e, qui n'existe pas tous les mois — ; une date du mois
 * devient celle du collage.
 *
 * Plusieurs jours perdent ceux que les réglages ne travaillent plus : le serveur refuse qu'une
 * récurrence neuve y tombe. S'il n'en reste aucun, null : elle ne repart pas de ce collage.
 */
export function followRhythm(rhythm: Rhythm, date: string, workingDays: readonly number[]): Rhythm | null {
    const weekday = isoWeekday(date);
    const dayOfMonth = Number(date.slice(8, 10));
    switch (rhythm.kind) {
        case 'weekly': {
            if (rhythm.weekdays.length === 1) {
                return weekly([weekday], rhythm.everyWeeks);
            }
            const worked = rhythm.weekdays.filter((day) => workingDays.includes(day));

            return worked.length === 0 ? null : weekly(worked, rhythm.everyWeeks);
        }
        case 'monthly_weekday': {
            const rank = Math.ceil(dayOfMonth / 7);
            const last = addDays(date, 7).slice(5, 7) !== date.slice(5, 7);

            return monthlyWeekday(weekday, (rhythm.monthWeek === LAST_WEEK && last) || rank > 4 ? LAST_WEEK : rank);
        }
        case 'monthly_date':
            return monthlyDate(dayOfMonth);
    }
}

/** Son rythme et sa fin, tels que la fenêtre les enverrait. */
export function ruleOf(recurrence: Recurrence): RecurrenceRule {
    return { ...recurrence.rhythm, until: recurrence.until };
}

/** Elle s'y poserait : elle y tombe, et cette fois n'a été ni détachée ni effacée. */
export function takesOn(schedule: Schedule, date: string): boolean {
    return fallsOn(schedule, date) && schedule.skipped?.includes(date) !== true;
}

/** Elle tombe ce jour-là, entre son premier jour et sa fin, selon son rythme seul. */
export function fallsOn(schedule: Schedule, date: string): boolean {
    const { rhythm, firstDay, until } = schedule;
    if (date < firstDay || (until !== null && date > until)) {
        return false;
    }
    const weekday = isoWeekday(date);
    const dayOfMonth = Number(date.slice(8, 10));
    switch (rhythm.kind) {
        case 'weekly':
            return (
                rhythm.weekdays.includes(weekday) &&
                Math.trunc(daysBetween(monday(firstDay), monday(date)) / 7) % rhythm.everyWeeks === 0
            );
        case 'monthly_weekday':
            return (
                rhythm.weekdays.includes(weekday) &&
                (rhythm.monthWeek === LAST_WEEK
                    ? addDays(date, 7).slice(5, 7) !== date.slice(5, 7)
                    : Math.ceil(dayOfMonth / 7) === rhythm.monthWeek)
            );
        case 'monthly_date':
            return dayOfMonth === rhythm.monthDay;
    }
}

/**
 * Le jour où un rythme mensuel tombe dans ce mois (« AAAA-MM »), ou null s'il n'y tombe
 * pas : le 31 d'un mois de 30 jours. Un rythme à la semaine n'a pas de jour du mois.
 */
export function dayIn(rhythm: Rhythm, month: string): string | null {
    const first = `${month}-01`;
    const length = Number(addDays(addDays(first, 31).slice(0, 7) + '-01', -1).slice(8, 10));
    const weekday = rhythm.weekdays[0] ?? 1;
    let day: number | null;
    switch (rhythm.kind) {
        case 'weekly':
            day = null;
            break;
        case 'monthly_date':
            day = rhythm.monthDay !== null && rhythm.monthDay <= length ? rhythm.monthDay : null;
            break;
        case 'monthly_weekday':
            day =
                rhythm.monthWeek === LAST_WEEK
                    ? length - ((isoWeekday(`${month}-${pad(length)}`) - weekday + 7) % 7)
                    : 1 + ((weekday - isoWeekday(first) + 7) % 7) + 7 * ((rhythm.monthWeek ?? 1) - 1);
            break;
    }

    return day === null ? null : `${month}-${pad(day)}`;
}

/** Au-delà, un rythme mensuel ne se cherche plus : 28 ans, le cycle des jours de la semaine d'un siècle. */
export const MONTHLY_YEARS = 28;

/**
 * La première date où deux récurrences tombent au même créneau — leurs heures se croisent,
 * elles tombent un même jour, chacune entre son premier jour et sa fin —, ou null. Jamais
 * deux tickets sur un créneau : la fenêtre l'annonce, le serveur la refuse
 * (src/Recurrence/RecurrenceClash.php), sur les cas de tests/cases/recurrences.json.
 *
 * Une fois détachée ou effacée « cette fois seulement » ne prend plus son créneau : seules
 * comptent les fois qui se poseraient encore (takesOn). La même phase, plus loin, le prend
 * toujours. Un jour à venir déjà envoyé (`closed`, DayState.settledAhead) ne reçoit plus aucune
 * récurrence : il compte comme une fois sautée pour toutes.
 *
 * Entre deux rythmes à la semaine, la recherche est exacte : leurs semaines se répètent
 * ensemble au bout du plus petit commun multiple de leurs « une semaine sur n ». Avec un
 * rythme mensuel, elle parcourt ses seules fois, mois par mois, sur 28 ans au plus. Ces bornes
 * se comptent après la dernière fois sautée.
 */
export function firstClash(
    a: TimedSchedule,
    b: TimedSchedule,
    after: string | null = null,
    closed: Iterable<string> = [],
): string | null {
    if (a.start >= b.end || b.start >= a.end) {
        return null;
    }
    const from = latest([a.firstDay, b.firstDay, ...(after === null ? [] : [addDays(after, 1)])]);
    let to = a.until === null ? b.until : b.until === null || a.until < b.until ? a.until : b.until;
    const shut = new Set(closed);
    const takes = (schedule: Schedule, date: string): boolean => takesOn(schedule, date) && !shut.has(date);
    // Avant la dernière fois sautée, chaque jour se juge ; les bornes partent du lendemain.
    const skipped = [...(a.skipped ?? []), ...(b.skipped ?? []), ...shut].filter((date) => date >= from);
    const base = skipped.length === 0 ? from : addDays(latest(skipped), 1);
    if (a.rhythm.kind !== 'weekly' || b.rhythm.kind !== 'weekly') {
        const [monthly, other] = a.rhythm.kind !== 'weekly' ? [a, b] : [b, a];
        const limit = addYears(base, MONTHLY_YEARS);
        to = to === null || to > limit ? limit : to;
        for (let month = from.slice(0, 7); month <= to.slice(0, 7); month = nextMonth(month)) {
            const day = dayIn(monthly.rhythm, month);
            if (day !== null && day >= from && day <= to && takes(monthly, day) && takes(other, day)) {
                return day;
            }
        }

        return null;
    }
    const weeks = lcm(a.rhythm.everyWeeks, b.rhythm.everyWeeks);
    // Une semaine de plus : la première, entamée, n'a pas ses jours d'avant le départ.
    const limit = addDays(base, 7 * (weeks + 1) - 1);
    to = to === null || to > limit ? limit : to;
    for (let day = from; day <= to; day = addDays(day, 1)) {
        if (takes(a, day) && takes(b, day)) {
            return day;
        }
    }

    return null;
}

/** Le plus tard de ces jours « AAAA-MM-JJ ». */
function latest(days: readonly string[]): string {
    return days.reduce((last, day) => (day > last ? day : last));
}

/**
 * Parmi les autres, celle qui prend le créneau le plus tôt — la plus ancienne, à date
 * égale —, et ce jour-là ; null si le créneau est libre. Le serveur nomme la même.
 */
export function earliestClash(
    candidate: TimedSchedule,
    others: Iterable<Recurrence>,
    after: string | null = null,
    closed: Iterable<string> = [],
): { readonly recurrence: Recurrence; readonly date: string } | null {
    let found: { readonly recurrence: Recurrence; readonly date: string } | null = null;
    const shut = [...closed];
    for (const other of others) {
        const date = firstClash(candidate, other, after, shut);
        if (
            date !== null &&
            (found === null || date < found.date || (date === found.date && other.id < found.recurrence.id))
        ) {
            found = { recurrence: other, date };
        }
    }

    return found;
}

/** Une tuile des prochaines fois : un jour où elle tombe, ou une semaine sans, en pointillé. */
export interface TimelineDay {
    readonly date: string;
    readonly falls: boolean;
}

/**
 * Ses prochaines fois, après ce jour, comme la fenêtre les montre. Une semaine sur n montre
 * aussi les semaines sans : chaque jour d'une semaine où elle revient, et une tuile en
 * pointillé par semaine sans, le premier de ses jours qui viendrait. Une série qui s'arrête ne
 * finit pas sur une semaine sans. Les autres rythmes ne montrent que leurs fois (nextTimes).
 * Une fois détachée ou effacée ne se montre pas.
 */
export function timeline(schedule: Schedule, after: string, workingDays: readonly number[], count = 5): TimelineDay[] {
    const { rhythm, until } = schedule;
    if (rhythm.kind !== 'weekly' || rhythm.everyWeeks === 1) {
        return nextTimes(schedule, after, workingDays, count).map((date) => ({ date, falls: true }));
    }
    const days: TimelineDay[] = [];
    let date = after < schedule.firstDay ? addDays(schedule.firstDay, -1) : after;
    let offWeek: string | null = null;
    for (let step = 0; step < 7 * (rhythm.everyWeeks + 1) * count && days.length < count; step += 1) {
        date = addDays(date, 1);
        if (until !== null && date > until) {
            break;
        }
        if (!rhythm.weekdays.includes(isoWeekday(date)) || !workingDays.includes(isoWeekday(date))) {
            continue;
        }
        if (schedule.skipped?.includes(date) === true) {
            continue;
        }
        if (fallsOn(schedule, date)) {
            days.push({ date, falls: true });
        } else if (offWeek !== monday(date)) {
            offWeek = monday(date);
            days.push({ date, falls: false });
        }
    }
    // Une série qui s'arrête ne finit pas sur une semaine sans : après la dernière tuile, plus
    // aucune fois ne vient.
    const last = days.at(-1);
    if (last !== undefined && nextTimes(schedule, last.date, workingDays, 1).length === 0) {
        while (days.at(-1)?.falls === false) {
            days.pop();
        }
    }

    return days.some((day) => day.falls) ? days : [];
}

/**
 * Sa dernière fois : le dernier jour, au plus tard à sa fin, où elle se pose — son rythme y
 * tombe, la fois n'est ni effacée ni détachée « cette fois seulement », et les réglages
 * travaillent ce jour-là. C'est elle que « Jusqu'au » montre : coupée par « Cette fois et les
 * suivantes », une récurrence finit la veille du jour touché, une fin que personne n'a saisie.
 * Faute d'une telle fois, le dernier jour où son rythme tombe, sinon sa fin ; null sans fin. Elle
 * ne se cherche pas au-delà de deux ans.
 */
export function lastTime(schedule: Schedule, workingDays: readonly number[] | null = null): string | null {
    const { until, firstDay } = schedule;
    if (until === null) {
        return null;
    }
    let falls: string | null = null;
    for (let date = until, day = 0; date >= firstDay && day < 800; date = addDays(date, -1), day += 1) {
        if (!fallsOn(schedule, date)) {
            continue;
        }
        if (takesOn(schedule, date) && (workingDays === null || workingDays.includes(isoWeekday(date)))) {
            return date;
        }
        falls ??= date;
    }

    return falls ?? until;
}

/**
 * Ses prochaines fois, après ce jour : les jours où elle se pose et que les réglages
 * travaillent, au plus `count`. Sans fin, elle en a toujours ; elle n'en cherche pas au-delà
 * de deux ans.
 */
export function nextTimes(schedule: Schedule, after: string, workingDays: readonly number[], count = 5): string[] {
    const times: string[] = [];
    let date = after < schedule.firstDay ? addDays(schedule.firstDay, -1) : after;
    for (let day = 0; day < 800 && times.length < count; day += 1) {
        date = addDays(date, 1);
        if (schedule.until !== null && date > schedule.until) {
            break;
        }
        if (workingDays.includes(isoWeekday(date)) && takesOn(schedule, date)) {
            times.push(date);
        }
    }

    return times;
}

/**
 * Ce qu'un geste écrit, et ce qu'il détache : un quart d'heure qu'il prend à une
 * récurrence sans le lui laisser détache la fois entière de ce jour, dont les autres quarts
 * d'heure gardent leur contenu sans elle. Le serveur fait de même (src/Entity/Day.php,
 * change) ; le geste les nomme lui-même, pour qu'annuler les lui rende.
 */
export function detach(grid: Grid, changes: QuarterChanges): QuarterChanges {
    const detached = new Set<string>();
    for (const [quarter, cell] of changes) {
        const before = grid.at(quarter)?.recurrence ?? null;
        if (before !== null && (cell?.recurrence ?? null) !== before) {
            detached.add(before);
        }
    }
    if (detached.size === 0) {
        return changes;
    }
    const all = new Map<number, Cell>(changes);
    for (const quarter of Quarter.all()) {
        const cell = grid.at(quarter);
        if (cell !== null && cell.recurrence !== null && detached.has(cell.recurrence) && !all.has(quarter)) {
            all.set(quarter, unlinked(cell));
        }
    }

    return all;
}

/**
 * Ce qu'un collage ou un favori déposé change vraiment : le même contenu posé sur une fois qui
 * revient ne la touche pas — le même ticket, le même commentaire —, et elle garde sa
 * récurrence. Tout autre contenu la remplace, et la détache (detach).
 */
export function keepingOccurrences(grid: Grid, changes: QuarterChanges): QuarterChanges {
    return new Map(
        [...changes].filter(([quarter, cell]) => {
            const before = grid.at(quarter);
            const after = normalizeCell(cell);

            return !(
                before !== null &&
                after !== null &&
                before.recurrence !== null &&
                after.recurrence === null &&
                sameContent(before, after)
            );
        }),
    );
}

/** Les quarts d'heure qu'elle a posés ce jour-là et qui lui sont restés. */
export function occurrenceIn(grid: Grid, recurrence: string): number[] {
    return Quarter.all().filter((quarter) => grid.at(quarter)?.recurrence === recurrence);
}

/**
 * Les récurrences d'une journée rendue par l'API, par leur identifiant. Une réponse qui
 * n'en a pas la forme lève : l'écran n'affiche rien plutôt qu'une flèche de travers.
 */
export function readRecurrences(json: unknown): Map<string, Recurrence> {
    if (!isRecord(json)) {
        throw new TypeError("« recurrences » n'est pas un objet.");
    }

    return new Map(Object.entries(json).map(([id, value]) => [id, readRecurrence(id, value)]));
}

function readRecurrence(id: string, json: unknown): Recurrence {
    if (!isRecord(json)) {
        throw new TypeError(`La récurrence ${id} n'est pas un objet.`);
    }
    const start = typeof json.start === 'string' ? Quarter.parse(json.start) : null;
    const end = typeof json.end === 'string' ? Quarter.parse(json.end) : null;
    const { kind, weekdays, everyWeeks, monthWeek, monthDay, firstDay, until } = json;
    const content = readContent(json.slot);
    // Ses fois sautées à venir ; une réponse qui ne les dit pas n'en a pas.
    const skipped = json.skipped ?? [];
    if (
        start === null ||
        end === null ||
        (kind !== 'weekly' && kind !== 'monthly_weekday' && kind !== 'monthly_date') ||
        !Array.isArray(weekdays) ||
        !weekdays.every((day: unknown) => typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 7) ||
        typeof everyWeeks !== 'number' ||
        !Number.isInteger(everyWeeks) ||
        everyWeeks < 1 ||
        (monthWeek !== null && typeof monthWeek !== 'number') ||
        (monthDay !== null && typeof monthDay !== 'number') ||
        typeof firstDay !== 'string' ||
        !isDate(firstDay) ||
        (until !== null && (typeof until !== 'string' || !isDate(until))) ||
        content === null ||
        !Array.isArray(skipped) ||
        !skipped.every((date: unknown) => typeof date === 'string' && isDate(date))
    ) {
        throw new TypeError(`La récurrence ${id} n'a pas la forme d'une récurrence.`);
    }

    return {
        id,
        start,
        end,
        rhythm: { kind, weekdays: weekdays as number[], everyWeeks, monthWeek, monthDay },
        firstDay,
        until,
        content,
        ...(skipped.length === 0 ? {} : { skipped: skipped as string[] }),
    };
}

function readContent(json: unknown): RecurrenceContent | null {
    if (!isRecord(json)) {
        return null;
    }
    if (json.kind === 'pause') {
        return { kind: 'pause' };
    }
    const { ticket, comment } = json;

    return json.kind === 'work' && typeof ticket === 'string' && (comment === null || typeof comment === 'string')
        ? { kind: 'work', ticket, comment }
        : null;
}

function monday(date: string): string {
    return addDays(date, 1 - isoWeekday(date));
}

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

/** Le mois suivant, « AAAA-MM ». */
function nextMonth(month: string): string {
    const year = Number(month.slice(0, 4));
    const index = Number(month.slice(5, 7));

    return index === 12 ? `${String(year + 1).padStart(4, '0')}-01` : `${month.slice(0, 4)}-${pad(index + 1)}`;
}

/** Le même jour, des années plus tard ; un 29 février sans 29 devient le 1er mars, comme le serveur. */
function addYears(date: string, years: number): string {
    const moved = `${String(Number(date.slice(0, 4)) + years).padStart(4, '0')}${date.slice(4)}`;

    return isDate(moved) ? moved : addDays(`${moved.slice(0, 8)}28`, 1);
}

function lcm(a: number, b: number): number {
    let [x, y] = [a, b];
    while (y !== 0) {
        [x, y] = [y, x % y];
    }

    return (a * b) / x;
}

/** Des jours « AAAA-MM-JJ », comptés en jours entiers : midi évite tout changement d'heure. */
function daysBetween(from: string, to: string): number {
    return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}
