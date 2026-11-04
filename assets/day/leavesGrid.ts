import { FAVORITES_COLUMN } from './FavoritesColumn';

/** Ce qu'il faut savoir d'un appui du pointeur : où il tombe, et où dans cet élément. */
export interface PointerDown {
    readonly target: EventTarget | null;
    readonly offsetX: number;
    readonly offsetY: number;
}

/**
 * Un clic dans la colonne des favoris ou dans le récapitulatif quitte la grille, et en
 * vide la sélection. Un clic sur un favori, lui, vise la grille : il le copie pour qu'on
 * le colle sur la sélection. Ni le menu d'un favori, posé dans la colonne, ni son bord,
 * qui en règle la largeur, ni une barre de défilement, qui la fait défiler, ne la
 * quittent.
 */
export function leavesGrid({ target, offsetX, offsetY }: PointerDown): boolean {
    // Une icône est un élément SVG : elle compte comme ce qui la porte.
    if (!(target instanceof Element)) {
        return false;
    }

    return (
        target.closest(`#${FAVORITES_COLUMN}, #recap`) !== null &&
        target.closest('[data-favorite], [role="menu"], [role="separator"]') === null &&
        !(target instanceof HTMLElement && onScrollbar(target, offsetX, offsetY))
    );
}

/**
 * L'appui tombe sur la barre de défilement de l'élément : au-delà de sa partie
 * visible, quand il en a une. Une barre qui se pose par-dessus le contenu, comme sur
 * Mac, ne se distingue pas du contenu.
 */
function onScrollbar(target: HTMLElement, offsetX: number, offsetY: number): boolean {
    return target.clientWidth > 0 && (offsetX >= target.clientWidth || offsetY >= target.clientHeight);
}
