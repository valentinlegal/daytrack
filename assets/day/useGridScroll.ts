import { type RefObject, useCallback, useLayoutEffect, useRef } from 'react';

import * as Quarter from '../grid/quarter';
import { measureScale } from './columnMeasure';
import type { ScreenMemory } from './screenMemory';
import { openingTop } from './scroll';

/**
 * Place la grille une fois, à l'ouverture de l'écran : là où l'onglet l'avait
 * laissée, sinon selon openingTop. Ensuite, elle ne bouge plus d'elle-même — passer
 * d'un jour à l'autre garde sa position —, et l'onglet retient où on la laisse.
 *
 * visibleTop lit l'heure en haut de la vue, au moment où on l'appelle.
 */
export function useGridScroll(
    now: number | null,
    memory: ScreenMemory,
): { scrollerRef: RefObject<HTMLDivElement | null>; visibleTop: () => number } {
    const scrollerRef = useRef<HTMLDivElement>(null);
    const openingRef = useRef({ now, memory });

    const visibleTop = useCallback(() => {
        const element = scrollerRef.current;

        return element === null ? Quarter.FIRST : measureScale(element).viewTop(element.scrollTop);
    }, []);

    useLayoutEffect(() => {
        const element = scrollerRef.current;
        if (element === null) {
            return;
        }
        const { toMinutes, toPixels, visibleMinutes } = measureScale(element);
        const { now: openedAt, memory: tab } = openingRef.current;

        element.scrollTop = toPixels(tab.gridTop() ?? openingTop(openedAt, visibleMinutes));

        // La position posée à l'ouverture n'est pas un choix de l'utilisateur : elle ne
        // se retient pas, et un rechargement plus tard dans la journée la recalcule.
        // Seul ce qu'il fait défiler ensuite se retient.
        const opened = element.scrollTop;
        let moved = false;
        let frame = 0;
        const onScroll = () => {
            if (!moved && element.scrollTop === opened) {
                return;
            }
            moved = true;
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                tab.setGridTop(toMinutes(element.scrollTop));
            });
        };
        element.addEventListener('scroll', onScroll, { passive: true });

        return () => {
            cancelAnimationFrame(frame);
            element.removeEventListener('scroll', onScroll);
        };
    }, []);

    return { scrollerRef, visibleTop };
}
