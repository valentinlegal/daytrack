import type { Grid } from './grid';
import * as Quarter from './quarter';

/**
 * Les chiffres du jour, et leur seule définition côté navigateur.
 *
 * Le serveur les calcule aussi (src/Day/DayFigures.php) : le navigateur les refait
 * pour suivre l'heure qui tourne. Les cas de tests/cases/day-figures.json éprouvent
 * les deux calculs, et toute différence entre eux est un bug.
 */
export interface DayFigures {
    /** Les quarts d'heure saisis, pauses exclues, ceux posés plus tard dans la journée compris. */
    readonly worked: number;
    /** Ce qui manque pour atteindre l'objectif, jamais négatif. */
    readonly remaining: number;
    /** Le travaillé moins l'objectif. */
    readonly balance: number;
    /**
     * L'heure, en minutes depuis minuit, où l'objectif sera atteint, au quart d'heure
     * supérieur ; null quand il n'y en a pas.
     */
    readonly projectedEnd: number | null;
}

const MIDNIGHT = 1440;

/**
 * @param now l'heure qu'il est, en minutes depuis minuit, si la journée est celle
 *            d'aujourd'hui ; null pour tout autre jour
 */
export function dayFigures(grid: Grid, objective: number, now: number | null): DayFigures {
    const worked = grid.workedMinutes();
    const remaining = Math.max(0, objective - worked);

    return {
        worked,
        remaining,
        balance: worked - objective,
        projectedEnd: now === null || remaining === 0 ? null : projectedEnd(grid, objective, now),
    };
}

/**
 * L'heure où l'objectif sera atteint en continuant à travailler, en respectant les
 * pauses déjà posées. Le créneau en cours compte comme travaillé, saisi ou non, sauf
 * si c'est une pause : on y travaille, et il se saisira entier. Le saisir ne déplace
 * donc pas la fin. Rien ne se saisit avant 07:00 : on ne compte pas avant. Le compte
 * se fait au quart d'heure, l'unité de la grille, et la fin tombe sur un quart d'heure.
 * À minuit ou après, il n'y a plus de fin prévue, « Reste » suffit.
 */
function projectedEnd(grid: Grid, objective: number, now: number): number | null {
    let quarter = Math.max(now - (now % Quarter.MINUTES), Quarter.FIRST);
    let toWork = objective - grid.workedBefore(quarter);

    // Les pauses ne vivent que sur la grille : passé 20:00, chaque quart d'heure
    // compte, et la boucle s'arrête toujours.
    while (toWork > 0) {
        if (!grid.isPauseAt(quarter)) {
            toWork -= Quarter.MINUTES;
        }
        quarter += Quarter.MINUTES;
    }

    return quarter < MIDNIGHT ? quarter : null;
}
