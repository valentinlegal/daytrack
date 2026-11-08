import { useEffect, useEffectEvent } from 'react';

import { leavesGrid } from './leavesGrid';
import type { Favorites } from './useFavorites';
import type { GridEditing } from './useGridEditing';
import type { RecapPanel } from './useRecapPanel';

/**
 * Échap ferme d'abord ce qui est ouvert — une fenêtre, un menu, une infobulle, le
 * formulaire d'un favori, puis le récapitulatif quand il couvre la grille —, et vide
 * ensuite la sélection de la grille, d'où que soit le curseur. Ce qu'une fenêtre, un menu
 * ou un glisser ont déjà pris pour eux (defaultPrevented) ne va pas plus loin.
 *
 * Un clic dans la colonne des favoris ou dans le récapitulatif quitte la grille. Une
 * fenêtre ouverte le prend pour elle : c'est un clic à côté, qui l'enregistre.
 *
 * Les écouteurs sont posés une fois, et lisent l'état courant.
 */
export function useGridExits({
    editing,
    favorites,
    recap,
    sendWindowOpen,
    objectiveOpen,
}: {
    editing: GridEditing;
    favorites: Favorites;
    recap: RecapPanel;
    /** Une fenêtre du bouton Jira se ferme d'abord, par sa croix ou Échap (Popover). */
    sendWindowOpen: boolean;
    objectiveOpen: boolean;
}): void {
    const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
        if (event.key !== 'Escape' || event.defaultPrevented || sendWindowOpen) {
            return;
        }
        if (favorites.escape() || recap.escape() || editing.deselect()) {
            event.preventDefault();
        }
    });
    const onMouseDown = useEffectEvent((event: MouseEvent) => {
        if (editing.window === null && !objectiveOpen && leavesGrid(event)) {
            editing.deselect();
        }
    });

    useEffect(() => {
        const keyListener = (event: KeyboardEvent) => {
            onKeyDown(event);
        };
        const mouseListener = (event: MouseEvent) => {
            onMouseDown(event);
        };
        window.addEventListener('keydown', keyListener);
        window.addEventListener('mousedown', mouseListener);

        return () => {
            window.removeEventListener('keydown', keyListener);
            window.removeEventListener('mousedown', mouseListener);
        };
    }, []);
}
