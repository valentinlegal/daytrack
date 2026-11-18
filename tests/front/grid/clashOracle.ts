import {
    LAST_WEEK,
    type Recurrence,
    type Rhythm,
    type Schedule,
    type TimedSchedule,
} from '../../../assets/grid/recurrence';

/**
 * Deux récurrences au même créneau, cherchées à la force brute : jour après jour, de leur
 * premier jour commun à la fin de la plus courte, sans rien prendre au moteur. Les jours se
 * comptent en entiers depuis le 1er janvier 1970, sans heure ni fuseau, et chaque jour se juge
 * de nouveau par son rythme : c'est l'étalon de firstClash (assets/grid/recurrence.ts), que les
 * tests tirés au hasard comparent à lui.
 *
 * L'horizon est celui que la règle fixe : trois ans entre deux rythmes à la semaine — bien
 * au-delà du plus petit commun multiple de leurs « une semaine sur n », douze semaines au
 * plus —, 28 ans avec un rythme mensuel, le cycle des jours de la semaine d'un siècle.
 */

const MONTHLY_YEARS = 28;
const WEEKLY_DAYS = 3 * 366;

/** Un jour du calendrier, en jours depuis le 1er janvier 1970. */
function dayNumber(date: string): number {
    return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;
}

/** L'année, le mois et le jour d'un numéro de jour (H. Hinnant, « days_from_civil » à l'envers). */
function civil(day: number): { readonly year: number; readonly month: number; readonly date: number } {
    const shifted = day + 719_468;
    const era = Math.floor(shifted / 146_097);
    const ofEra = shifted - era * 146_097;
    const yearOfEra = Math.floor(
        (ofEra - Math.floor(ofEra / 1460) + Math.floor(ofEra / 36_524) - Math.floor(ofEra / 146_096)) / 365,
    );
    const ofYear = ofEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
    const monthIndex = Math.floor((5 * ofYear + 2) / 153);
    const date = ofYear - Math.floor((153 * monthIndex + 2) / 5) + 1;
    const month = monthIndex < 10 ? monthIndex + 3 : monthIndex - 9;

    return { year: yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, date };
}

function format(day: number): string {
    const { year, month, date } = civil(day);

    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
}

/** Le jour de la semaine ISO : le 1er janvier 1970 était un jeudi. */
function weekday(day: number): number {
    return ((((day + 3) % 7) + 7) % 7) + 1;
}

/** Le rythme seul tombe ce jour-là, compté depuis `first`. */
function rhythmFalls(rhythm: Rhythm, day: number, first: number): boolean {
    const iso = weekday(day);
    switch (rhythm.kind) {
        case 'weekly': {
            const weeks = (day - (iso - 1) - (first - (weekday(first) - 1))) / 7;

            return rhythm.weekdays.includes(iso) && weeks % rhythm.everyWeeks === 0;
        }
        case 'monthly_weekday': {
            const { date } = civil(day);
            const last = civil(day + 7).month !== civil(day).month;

            return (
                rhythm.weekdays.includes(iso) &&
                (rhythm.monthWeek === LAST_WEEK ? last : Math.ceil(date / 7) === rhythm.monthWeek)
            );
        }
        case 'monthly_date':
            return civil(day).date === rhythm.monthDay;
    }
}

/** Le même jour, des années plus tard ; un 29 février sans 29 devient le 1er mars, comme le serveur. */
function yearsLater(day: number, years: number): number {
    const { year, month, date } = civil(day);

    return Date.UTC(year + years, month - 1, date) / 86_400_000;
}

/** Elle tombe ce jour-là, entre son premier jour et sa fin, jugé comme la force brute le juge. */
export function bruteFalls(schedule: Schedule, date: string): boolean {
    const day = dayNumber(date);
    const first = dayNumber(schedule.firstDay);

    return (
        day >= first &&
        (schedule.until === null || day <= dayNumber(schedule.until)) &&
        rhythmFalls(schedule.rhythm, day, first)
    );
}

/**
 * La première date, après `after` s'il est donné, où les deux tombent sans que l'une y ait
 * une fois sautée, hors des jours envoyés (`closed`), et où leurs heures se croisent, ou null.
 * L'horizon se compte après la dernière fois sautée.
 */
export function bruteClash(
    a: TimedSchedule,
    b: TimedSchedule,
    after: string | null = null,
    closed: readonly string[] = [],
): string | null {
    if (a.start >= b.end || b.start >= a.end) {
        return null;
    }
    const firstA = dayNumber(a.firstDay);
    const firstB = dayNumber(b.firstDay);
    const from = Math.max(firstA, firstB, after === null ? -Infinity : dayNumber(after) + 1);
    const shut = closed.map(dayNumber);
    const skippedA = new Set([...(a.skipped ?? []).map(dayNumber), ...shut]);
    const skippedB = new Set([...(b.skipped ?? []).map(dayNumber), ...shut]);
    const base = Math.max(from, ...[...skippedA, ...skippedB].map((day) => day + 1));
    const monthly = a.rhythm.kind !== 'weekly' || b.rhythm.kind !== 'weekly';
    const to = Math.min(
        a.until === null ? Infinity : dayNumber(a.until),
        b.until === null ? Infinity : dayNumber(b.until),
        monthly ? yearsLater(base, MONTHLY_YEARS) : base + WEEKLY_DAYS,
    );
    for (let day = from; day <= to; day += 1) {
        if (
            rhythmFalls(a.rhythm, day, firstA) &&
            rhythmFalls(b.rhythm, day, firstB) &&
            !skippedA.has(day) &&
            !skippedB.has(day)
        ) {
            return format(day);
        }
    }

    return null;
}

/** Parmi les autres, la première à prendre le créneau — la plus ancienne, à date égale —, et ce jour-là. */
export function bruteEarliest(
    candidate: TimedSchedule,
    others: Iterable<Recurrence>,
    after: string | null = null,
    closed: readonly string[] = [],
): { readonly recurrence: Recurrence; readonly date: string } | null {
    let found: { readonly recurrence: Recurrence; readonly date: string } | null = null;
    for (const other of others) {
        const date = bruteClash(candidate, other, after, closed);
        if (date !== null && (found === null || `${date}${other.id}` < `${found.date}${found.recurrence.id}`)) {
            found = { recurrence: other, date };
        }
    }

    return found;
}
