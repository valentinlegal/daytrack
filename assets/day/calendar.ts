/**
 * Les jours du calendrier, écrits « AAAA-MM-JJ », sans heure ni fuseau.
 *
 * Un jour se calcule en heure universelle, à minuit : passer d'un jour au suivant ne
 * traverse alors aucun changement d'heure. Jamais par toISOString() sur une heure locale,
 * qui rend le jour de l'heure universelle, pas celui de l'utilisateur.
 */

const WEEKDAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

const MONTHS = [
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

/** Où se place un jour par rapport à aujourd'hui. */
export type Tense = 'past' | 'today' | 'future';

/** Le jour qui suit `date` de `days` jours, ou le précède si `days` est négatif. */
export function addDays(date: string, days: number): string {
    const day = new Date(midnight(date));
    day.setUTCDate(day.getUTCDate() + days);

    return iso(day);
}

function iso(day: Date): string {
    return [
        String(day.getUTCFullYear()).padStart(4, '0'),
        String(day.getUTCMonth() + 1).padStart(2, '0'),
        String(day.getUTCDate()).padStart(2, '0'),
    ].join('-');
}

export function tenseOf(date: string, today: string): Tense {
    if (date === today) {
        return 'today';
    }

    // Des dates « AAAA-MM-JJ » se comparent dans l'ordre du calendrier.
    return date < today ? 'past' : 'future';
}

/** Le dernier jour qui s'ouvre : au-delà, le serveur ramène à aujourd'hui (src/Day/UserCalendar.php). */
export function lastOpenDay(today: string, futureDays: number): string {
    return addDays(today, futureDays);
}

/** « Mardi 6 octobre 2026 », « Jeudi 1er octobre 2026 ». */
export function dayTitle(date: string): string {
    return `${dayLabel(date)} ${String(new Date(midnight(date)).getUTCFullYear())}`;
}

/** « Mardi 6 octobre », sans l'année : le jour tel qu'une fenêtre l'écrit sous son titre. */
export function dayLabel(date: string): string {
    const day = new Date(midnight(date));

    return `${WEEKDAYS[day.getUTCDay()] ?? ''} ${dayNumber(day)} ${MONTHS[day.getUTCMonth()] ?? ''}`;
}

/** « 6 octobre », « 1er octobre » : un jour dans une phrase, sans son nom ni son année. */
export function dayAndMonth(date: string): string {
    const day = new Date(midnight(date));

    return `${dayNumber(day)} ${MONTHS[day.getUTCMonth()] ?? ''}`;
}

/**
 * Le quantième, « 1er » le premier du mois. Seul le jour du calendrier, qui affiche « 1 »,
 * garde le chiffre dans son nom (dayOfMonthLabel).
 */
function dayNumber(day: Date): string {
    const number = day.getUTCDate();

    return number === 1 ? '1er' : String(number);
}

/** « Samedi ». */
export function weekdayName(date: string): string {
    return WEEKDAYS[new Date(midnight(date)).getUTCDay()] ?? '';
}

/** Le jour de la semaine ISO : 1 pour lundi, 7 pour dimanche, comme les réglages. */
export function isoWeekday(date: string): number {
    const day = new Date(midnight(date)).getUTCDay();

    return day === 0 ? 7 : day;
}

/** Travaillé selon les réglages (src/Settings/UserSettings.php, la même règle). */
export function isWorkingDay(date: string, workingDays: readonly number[]): boolean {
    return workingDays.includes(isoWeekday(date));
}

/**
 * Le jour travaillé qui suit `date`, ou le précède si `step` vaut −1 : les flèches de la
 * barre sautent les autres. Sans aucun jour travaillé, elles vont de jour en jour.
 */
export function nextWorkingDay(date: string, step: 1 | -1, workingDays: readonly number[]): string {
    let day = addDays(date, step);
    // Une semaine suffit : un jour travaillé y revient.
    for (let tries = 1; tries < 7 && workingDays.length > 0 && !isWorkingDay(day, workingDays); tries += 1) {
        day = addDays(day, step);
    }

    return day;
}

/** Le mois d'un jour, « AAAA-MM ». */
export function monthOf(date: string): string {
    midnight(date);

    return date.slice(0, 7);
}

/** Le mois qui suit `month` de `months` mois, ou le précède si `months` est négatif. */
export function addMonths(month: string, months: number): string {
    const first = new Date(midnight(`${month}-01`));
    first.setUTCMonth(first.getUTCMonth() + months);

    return iso(first).slice(0, 7);
}

/** « Octobre 2026 ». */
export function monthTitle(month: string): string {
    const first = new Date(midnight(`${month}-01`));
    const name = MONTHS[first.getUTCMonth()] ?? '';

    return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${String(first.getUTCFullYear())}`;
}

/**
 * « 2 octobre », « 1 novembre » : le jour tel que le calendrier le nomme au lecteur
 * d'écran. Il commence par le chiffre que le bouton affiche, « 1 » et non « 1er » : un
 * nom contient le texte visible (WCAG 2.5.3), pour que la commande vocale atteigne le
 * jour qu'on lui dit.
 */
export function dayOfMonthLabel(date: string): string {
    const day = new Date(midnight(date));

    return `${String(day.getUTCDate())} ${MONTHS[day.getUTCMonth()] ?? ''}`;
}

/**
 * Les semaines que le calendrier affiche pour un mois, du lundi au dimanche : celles qui
 * en contiennent un jour, de quatre à six. Les jours du mois d'avant et d'après
 * complètent la première et la dernière.
 */
export function monthWeeks(month: string): string[][] {
    const first = `${month}-01`;
    const last = addDays(`${addMonths(month, 1)}-01`, -1);
    const weeks: string[][] = [];
    // Des dates « AAAA-MM-JJ » se comparent dans l'ordre du calendrier.
    for (let monday = addDays(first, 1 - isoWeekday(first)); monday <= last; monday = addDays(monday, 7)) {
        weeks.push(Array.from({ length: 7 }, (_, index) => addDays(monday, index)));
    }

    return weeks;
}

/** Les flèches du clavier dans la grille du calendrier, en jours. */
const MOVES: Partial<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

/**
 * Le jour qu'une touche vise depuis `from` dans la grille du calendrier, ou null si
 * elle n'y déplace pas le curseur : les flèches de jour en jour et de semaine en
 * semaine, Début et Fin au bout de la semaine, Page précédente et suivante de mois en
 * mois (motif « grille » de l'APG).
 */
export function calendarKeyTarget(from: string, key: string): string | null {
    const move = MOVES[key];
    if (move !== undefined) {
        return addDays(from, move);
    }
    if (key === 'Home') {
        return addDays(from, 1 - isoWeekday(from));
    }
    if (key === 'End') {
        return addDays(from, 7 - isoWeekday(from));
    }
    if (key === 'PageUp' || key === 'PageDown') {
        return sameDayIn(from, key === 'PageUp' ? -1 : 1);
    }

    return null;
}

/** Le même quantième, un mois plus tôt ou plus tard, ramené au dernier jour d'un mois plus court. */
function sameDayIn(from: string, months: number): string {
    const month = addMonths(monthOf(from), months);
    const lastDay = addDays(`${addMonths(month, 1)}-01`, -1);
    const wanted = `${month}-${from.slice(8)}`;

    return wanted > lastDay ? lastDay : wanted;
}

/** Un jour « AAAA-MM-JJ » qui existe au calendrier. */
export function isDate(value: string): boolean {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (parts === null) {
        return false;
    }
    const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
    const time = utc(year, month, day);

    return time.getUTCFullYear() === year && time.getUTCMonth() === month - 1 && time.getUTCDate() === day;
}

function midnight(date: string): number {
    if (!isDate(date)) {
        throw new RangeError(`« ${date} » n'est pas un jour du calendrier.`);
    }
    const [year, month, day] = date.split('-').map(Number) as [number, number, number];

    return utc(year, month, day).getTime();
}

function utc(year: number, month: number, day: number): Date {
    const time = new Date(0);
    // setUTCFullYear et non Date.UTC : celui-ci lit les années 0 à 99 comme 1900 à 1999.
    time.setUTCFullYear(year, month - 1, day);

    return time;
}
