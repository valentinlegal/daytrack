import * as Quarter from '../grid/quarter';

/**
 * La géométrie de la colonne des blocs : où tombe un quart d'heure à l'écran, le quart
 * d'heure sous le pointeur, la zone qui défile près des bords pendant un glisser, et
 * l'heure que montre le défilement. Une seule définition pour tous les gestes — appui,
 * glisser, double-clic, menu, fenêtre de ticket, favori qu'on dépose — et pour la place
 * de la grille à l'ouverture.
 *
 * Pure : elle part de mesures en pixels, et ne lit ni la page ni React. Les mesures se
 * prennent dans columnMeasure.ts.
 */

/** La colonne telle qu'elle est posée, dans la fenêtre du navigateur. */
export interface Column {
    /** Le haut de 07:00. */
    readonly top: number;
    /** La hauteur d'un quart d'heure, --h-row : les rangées de la grille la prennent (day.css). */
    readonly row: number;
}

/** Un point de la fenêtre du navigateur. */
export interface Point {
    readonly x: number;
    readonly y: number;
}

/** La zone qui fait défiler la grille, telle qu'on la voit, dans la fenêtre du navigateur. */
export interface View {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
}

/** Les rangées, près du bord haut ou bas de la vue, où un glisser fait défiler la grille. */
export const EDGE_ROWS = 2;

/** À chaque image, la grille défile de cette fraction de la zone du bord. */
const EDGE_SPEED = 1 / 8;

/**
 * Le quart d'heure sous ce point, au plus près de la grille quand il en sort par le haut
 * ou le bas : glisser au-dessus de 07:00 vise 07:00, sous 20:00, 19:45.
 */
export function quarterAt(column: Column, y: number): number {
    const index = Math.floor((y - column.top) / column.row);

    return Quarter.FIRST + Math.min(Math.max(index, 0), Quarter.COUNT - 1) * Quarter.MINUTES;
}

/**
 * La hauteur où commence le quart d'heure de cette heure, dans la fenêtre du navigateur.
 * 20:00 est le bas de la dernière rangée.
 */
export function quarterTop(column: Column, minutes: number): number {
    return column.top + ((minutes - Quarter.FIRST) / Quarter.MINUTES) * column.row;
}

/**
 * Ce que la grille défile à chaque image pendant un glisser : vers le bord haut ou bas
 * de la vue quand le pointeur en approche à moins de EDGE_ROWS rangées, ou l'a passé ;
 * rien quand il est à gauche de la vue, sur la colonne des favoris.
 *
 * Un bord ne fait défiler que vers où le pointeur est allé depuis l'appui : parti de la
 * dernière ligne visible, un glisser qui remonte ne fait pas descendre la grille sous lui,
 * ni sa sélection avec elle.
 *
 * @param startY où le pointeur a appuyé
 * @return le défilement à ajouter, en pixels : négatif vers le haut, zéro s'il n'y en a pas
 */
export function edgeScroll(view: View, row: number, pointer: Point, startY: number): number {
    const edge = row * EDGE_ROWS;
    if (pointer.x < view.left) {
        return 0;
    }
    if (pointer.y < view.top + edge && pointer.y < startY) {
        return -edge * EDGE_SPEED;
    }
    if (pointer.y > view.bottom - edge && pointer.y > startY) {
        return edge * EDGE_SPEED;
    }

    return 0;
}

/**
 * Le passage du défilement de la grille à ses heures. La grille commence sous une marge,
 * qui laisse voir en entier l'heure de 07:00 : au défilement 0, le haut de la vue est un
 * peu avant 07:00.
 */
export interface GridScale {
    /** Le défilement qui montre cette heure en entier, sa marge au-dessus : c'est la position que l'onglet retient. */
    readonly toPixels: (minutes: number) => number;
    /** L'heure qu'un défilement montre ainsi. */
    readonly toMinutes: (scrollTop: number) => number;
    /** L'heure au bord haut de la vue, marge comprise. */
    readonly viewTop: (scrollTop: number) => number;
    /** Ce que la vue montre de la grille, en minutes. */
    readonly visibleMinutes: number;
}

/**
 * @param row    la hauteur d'un quart d'heure
 * @param margin la marge au-dessus de 07:00, en haut de la zone qui défile
 * @param height la hauteur de la vue
 */
export function gridScale(row: number, margin: number, height: number): GridScale {
    return {
        toPixels: (minutes) => ((minutes - Quarter.FIRST) / Quarter.MINUTES) * row,
        toMinutes: (scrollTop) => Quarter.FIRST + (scrollTop / row) * Quarter.MINUTES,
        viewTop: (scrollTop) => Quarter.FIRST + ((scrollTop - margin) / row) * Quarter.MINUTES,
        visibleMinutes: ((height - margin) / row) * Quarter.MINUTES,
    };
}
