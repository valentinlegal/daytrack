import type { DayFigures } from '../grid/figures';
import type { Tense } from './calendar';

/**
 * Ce que dit la ligne des chiffres, sous la date. Les chiffres viennent de dayFigures,
 * leur seule définition côté navigateur ; ici, on choisit seulement lesquels montrer.
 *
 * Après la barre de progression :
 * - au-dessus de l'objectif, quel que soit le jour : « Solde +0h45 » ;
 * - pile dessus : « Objectif atteint » ;
 * - en dessous, un jour passé : « Solde −0h45 » ;
 * - en dessous, aujourd'hui : « Reste 2h30 », puis « Fin prévue à 17:45 » s'il y en a une et
 *   que la journée a déjà une saisie — vide, elle dit « Reste 7h30 » seul ;
 * - en dessous, un jour à venir : « Reste 7h30 », sans fin prévue.
 *
 * Un jour non travaillé n'a ni objectif ni barre : « Jour non travaillé » tant que rien
 * n'y est travaillé, puis « 3h00 » et « Solde +3h00 », tout comptant en plus.
 *
 * Un jour mis à 0h00 garde son objectif, qui le défait, mais pas de barre : « Jour non
 * travaillé » de même tant que rien n'y est travaillé, puis « Solde +1h30 ».
 */
export type FiguresTail =
    | { readonly kind: 'remaining'; readonly remaining: number; readonly projectedEnd: number | null }
    | { readonly kind: 'reached' }
    | { readonly kind: 'balance'; readonly balance: number }
    | { readonly kind: 'off' };

export interface FiguresLine {
    /** Travaillé selon les réglages : sinon, ni objectif ni barre. */
    readonly working: boolean;
    /** Mis à 0h00 dans la fenêtre Objectif du jour : l'objectif reste, sans barre. */
    readonly declaredOff: boolean;
    readonly worked: number;
    readonly objective: number;
    /** L'avancement vers l'objectif, de 0 à 1. Un objectif à zéro est atteint d'office. */
    readonly progress: number;
    /** L'objectif est atteint ou dépassé : la barre passe au vert. */
    readonly reached: boolean;
    readonly tail: FiguresTail;
}

export function figuresLine(
    figures: DayFigures,
    objective: number,
    tense: Tense,
    working = true,
    declaredOff = false,
): FiguresLine {
    return {
        working,
        declaredOff: working && declaredOff,
        worked: figures.worked,
        objective,
        progress: objective === 0 ? 1 : Math.min(1, figures.worked / objective),
        reached: figures.remaining === 0,
        tail: !working
            ? { kind: 'balance', balance: figures.balance }
            : declaredOff
              ? figures.worked === 0
                  ? { kind: 'off' }
                  : { kind: 'balance', balance: figures.balance }
              : tail(figures, tense),
    };
}

function tail(figures: DayFigures, tense: Tense): FiguresTail {
    if (figures.balance > 0) {
        return { kind: 'balance', balance: figures.balance };
    }
    if (figures.remaining === 0) {
        return { kind: 'reached' };
    }
    if (tense === 'past') {
        return { kind: 'balance', balance: figures.balance };
    }

    return {
        kind: 'remaining',
        remaining: figures.remaining,
        projectedEnd: tense === 'today' && figures.worked > 0 ? figures.projectedEnd : null,
    };
}
