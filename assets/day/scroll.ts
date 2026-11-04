import * as Quarter from '../grid/quarter';

/**
 * Où la grille se place quand on ouvre DayTrack : l'heure en haut de la vue, en minutes
 * depuis minuit.
 *
 * Le jour en cours garde au moins une heure visible après la ligne « maintenant », le
 * haut calé sur une heure pleine : on y note surtout ce qu'on vient de faire, la
 * journée déjà passée reste donc sous les yeux. Un autre jour s'ouvre sur 08:00.
 */
export const OTHER_DAY_TOP = 480;

const AHEAD = 60;
const HOUR = 60;

/**
 * @param now            l'heure qu'il est, si la journée est celle d'aujourd'hui ; null sinon
 * @param visibleMinutes ce que la vue montre de la grille, en minutes
 */
export function openingTop(now: number | null, visibleMinutes: number): number {
    if (now === null) {
        return OTHER_DAY_TOP;
    }
    const top = Math.ceil((now + AHEAD - visibleMinutes) / HOUR) * HOUR;

    return Math.min(Math.max(top, Quarter.FIRST), Quarter.DAY_END);
}

/**
 * Le premier quart d'heure du message d'une journée vide, en minutes : le premier quart
 * d'heure entier visible en haut de la grille à l'ouverture du jour, après une ligne
 * d'air. Si la ligne « maintenant » passe dans le message, il descend au quart d'heure
 * qui la suit. Il tient toujours entre 07:00 et 20:00.
 *
 * @param visibleTop l'heure en haut de la vue à l'ouverture du jour, en minutes
 * @param now        l'heure qu'il est, si la journée est celle d'aujourd'hui ; null sinon
 * @param quarters   les quarts d'heure qu'il occupe : deux lignes, et deux de plus sur un
 *                   jour non travaillé pour « Saisir quand même »
 */
export function emptyHintStart(visibleTop: number, now: number | null, quarters = 2): number {
    const hint = quarters * Quarter.MINUTES;
    const last = Quarter.DAY_END - hint;
    const start = Math.min(
        Math.max(Math.ceil(visibleTop / Quarter.MINUTES) * Quarter.MINUTES + Quarter.MINUTES, Quarter.FIRST),
        last,
    );
    if (now !== null && now > start && now < start + hint) {
        return Math.min(Math.ceil(now / Quarter.MINUTES) * Quarter.MINUTES, last);
    }

    return start;
}
