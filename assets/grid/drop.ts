import { fill, type QuarterChanges } from './changes';
import { work } from './grid';

/**
 * Un favori déposé sur la grille : seul le quart d'heure sous le pointeur prend son
 * ticket, sans commentaire — sur un créneau vide comme sur un bloc, qui se coupe autour.
 * Pour changer tout un bloc, on le sélectionne et on colle le favori copié. Son nom
 * n'entre pas dans la saisie.
 */
export function dropTicket(ticket: string, quarter: number): QuarterChanges {
    return fill([quarter], work(ticket));
}
