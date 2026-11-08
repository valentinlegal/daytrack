/**
 * Le quart d'heure, l'unité de la grille, comme côté serveur (src/Day/Quarter.php).
 *
 * Un quart d'heure se désigne par son début, en minutes depuis minuit, à l'heure de
 * l'utilisateur : 09:15 vaut 555. C'est une heure affichée sur la grille, pas un
 * instant — le changement d'heure, la nuit, ne la déplace pas.
 */

export const MINUTES = 15;

/** 07:00, le premier quart d'heure de la grille. */
export const FIRST = 420;

/** 20:00, la fin de la grille : le dernier quart d'heure commence à 19:45. */
export const DAY_END = 1200;

/** 19:45, le dernier quart d'heure de la grille. */
export const LAST = DAY_END - MINUTES;

/** Les 52 quarts d'heure de la grille. */
export const COUNT = (DAY_END - FIRST) / MINUTES;

/**
 * Lit une heure écrite « HH:MM ». Rend null pour tout ce qui n'en est pas une,
 * qu'elle tombe sur un quart d'heure ou non.
 */
export function parse(time: string): number | null {
    const parts = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);

    return parts === null ? null : Number(parts[1]) * 60 + Number(parts[2]);
}

export function format(minutes: number): string {
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Le début du quart d'heure où tombe cette heure : 10:07 donne 10:00, 10:15 reste 10:15.
 * L'heure peut avoir des secondes, en fraction de minute.
 */
export function floor(minutes: number): number {
    return Math.floor(minutes / MINUTES) * MINUTES;
}

/**
 * Le premier quart d'heure qui commence à cette heure ou après : 10:07 donne 10:15, 10:15
 * reste 10:15. L'heure peut avoir des secondes, en fraction de minute.
 */
export function ceil(minutes: number): number {
    // « + 0 » : un arrondi vers le haut d'une heure négative rendrait -0.
    return Math.ceil(minutes / MINUTES) * MINUTES + 0;
}

/** Une heure où un quart d'heure de la grille commence ou finit : 07:00 à 20:00. */
export function isBoundary(minutes: number): boolean {
    return Number.isInteger(minutes) && minutes >= FIRST && minutes <= DAY_END && minutes % MINUTES === 0;
}

/** Le début d'un quart d'heure de la grille : 07:00 à 19:45. */
export function isQuarter(minutes: number): boolean {
    return isBoundary(minutes) && minutes !== DAY_END;
}

/** Refuse ce qui n'est pas un quart d'heure de la grille : c'est un bug de l'appelant. */
export function assertQuarter(minutes: number): void {
    if (!isQuarter(minutes)) {
        throw new RangeError(`${String(minutes)} ne commence pas un quart d'heure de la grille.`);
    }
}

/** Les débuts des quarts d'heure de [start, end[. */
export function between(start: number, end: number): number[] {
    const quarters: number[] = [];
    for (let quarter = start; quarter < end; quarter += MINUTES) {
        quarters.push(quarter);
    }

    return quarters;
}

/** Tous les quarts d'heure de la grille, de 07:00 à 19:45. */
export function all(): number[] {
    return between(FIRST, DAY_END);
}
