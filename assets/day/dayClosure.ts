import type { DayState } from '../grid/day';
import { isWorkingDay, weekdayName } from './calendar';

/** Ce qui décide si la grille d'un jour est fermée à la saisie. */
export interface ClosureFacts {
    readonly date: string;
    /** La journée lue, null pendant sa lecture. */
    readonly day: DayState | null;
    /** Les jours travaillés les plus récents (latestWorkingDays). */
    readonly workingDays: readonly number[];
    /** Les jours mis à 0h00 que le calendrier a lus, null tant qu'il ne les a pas lus. */
    readonly daysOff: ReadonlySet<string> | null;
    /** Le jour ouvert par « Saisir quand même », ou vu avec une saisie (staysOpen). */
    readonly openedAnyway: string | null;
}

/**
 * Pourquoi la grille de ce jour est fermée à la saisie, ou null quand elle est ouverte.
 *
 * Un jour non travaillé — selon les réglages, ou mis à 0h00 — se ferme tant qu'il est
 * vide. Pendant la lecture, ce que les réglages et le calendrier en savent le ferme déjà :
 * la grille ne passe pas par le blanc avant le gris.
 */
export function closureReason({ date, day, workingDays, daysOff, openedAnyway }: ClosureFacts): string | null {
    const weekOff = !(day?.working ?? isWorkingDay(date, workingDays));
    const declaredOff = day?.declaredOff ?? daysOff?.has(date) ?? false;
    if (!(weekOff || declaredOff) || (day !== null && day.grid.blocks().length > 0) || openedAnyway === date) {
        return null;
    }

    return weekOff
        ? `${weekdayName(date)} n'est pas un jour travaillé.`
        : "Avec un objectif à 0h00, ce jour n'est pas travaillé.";
}

/**
 * Vu avec une saisie, un jour reste ouvert tant qu'on y est, même mis à 0h00 ensuite :
 * effacer la dernière ne le ferme pas sous le curseur, et Ctrl+Z la rend.
 */
export function staysOpen(day: DayState | null): boolean {
    return day !== null && day.grid.blocks().length > 0;
}
