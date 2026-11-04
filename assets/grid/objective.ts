import * as Quarter from './quarter';

/**
 * L'objectif du jour tel qu'on le tape dans sa fenêtre, et ses bornes, celles du
 * serveur (src/Day/Objective.php, src/Api/Input/ObjectiveInput.php) : de 0h00 à
 * 13h00, au quart d'heure.
 */
export const MAX_OBJECTIVE = Quarter.DAY_END - Quarter.FIRST;

export type ObjectiveReading =
    | { readonly kind: 'ok'; readonly minutes: number }
    /** Ce n'est pas une durée. */
    | { readonly kind: 'format' }
    /** Une durée, mais pas au quart d'heure : − et + partent d'elle. */
    | { readonly kind: 'quarter'; readonly minutes: number }
    /** Une durée au-delà de 13h00. */
    | { readonly kind: 'range'; readonly minutes: number };

/**
 * Lit une durée tapée comme dans la v1 : `7h30`, `7h`, `7:30`, `7,5`, `7.5` ou `8`.
 * Les heures seules se lisent en heures : `8` vaut 8h00.
 */
export function readObjective(text: string): ObjectiveReading {
    const value = text.trim().toLowerCase();
    const clock = /^(\d{1,2})\s*(?:h\s*(\d{1,2})?|:\s*(\d{2}))$/.exec(value);
    const decimal = /^(\d{1,2})(?:[.,](\d{1,4}))?$/.exec(value);
    let minutes: number;
    if (clock !== null) {
        const hourMinutes = Number(clock[2] ?? clock[3] ?? '0');
        if (hourMinutes >= 60) {
            return { kind: 'format' };
        }
        minutes = Number(clock[1]) * 60 + hourMinutes;
    } else if (decimal !== null) {
        minutes = Number(`${decimal[1] ?? '0'}.${decimal[2] ?? '0'}`) * 60;
    } else {
        return { kind: 'format' };
    }
    if (minutes > MAX_OBJECTIVE) {
        return { kind: 'range', minutes };
    }

    return !Number.isInteger(minutes) || minutes % Quarter.MINUTES !== 0
        ? { kind: 'quarter', minutes }
        : { kind: 'ok', minutes };
}

/**
 * − et + : le quart d'heure d'avant ou d'après, sans sortir des bornes. Une durée hors
 * du quart d'heure va au plus proche dans le sens demandé : 8h10 donne 8h00 ou 8h15.
 */
export function stepObjective(minutes: number, step: -1 | 1): number {
    const quarters = minutes / Quarter.MINUTES;
    const next = ((step > 0 ? Math.floor(quarters) : Math.ceil(quarters)) + step) * Quarter.MINUTES;

    return Math.min(Math.max(next, 0), MAX_OBJECTIVE);
}
