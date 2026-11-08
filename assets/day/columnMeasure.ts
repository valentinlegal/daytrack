import { tokenPixels } from '../components/tokenPixels';
import { type Column, gridScale, type GridScale, quarterAt } from './columnGeometry';

/**
 * Les mesures de la grille, prises dans la page au moment du geste : la grille a pu défiler
 * depuis le rendu. columnGeometry.ts en fait les heures.
 */

/** La hauteur d'un quart d'heure : le token que les rangées de la grille prennent (day.css). */
const ROW = '--h-row';

/** La colonne des blocs, mesurée ; null tant qu'elle n'est pas dessinée. */
export function measureColumn(lane: HTMLElement | null): Column | null {
    if (lane === null) {
        return null;
    }
    const { top, height } = lane.getBoundingClientRect();
    const row = tokenPixels(ROW, lane);

    // Le bord haut de la colonne n'est pas une rangée : 07:00 commence dessous.
    return height === 0 || row <= 0 ? null : { top: top + lane.clientTop, row };
}

/** Le quart d'heure sous le pointeur, à cette hauteur ; null tant que la colonne n'est pas dessinée. */
export function pointedQuarter(lane: HTMLElement | null, clientY: number): number | null {
    const column = measureColumn(lane);

    return column === null ? null : quarterAt(column, clientY);
}

/** Le passage du défilement de la zone qui défile aux heures de la grille. */
export function measureScale(scroller: HTMLElement): GridScale {
    const content = scroller.firstElementChild;
    const margin = content === null ? 0 : Number.parseFloat(getComputedStyle(content).paddingTop);

    return gridScale(tokenPixels(ROW, scroller), Number.isFinite(margin) ? margin : 0, scroller.clientHeight);
}
