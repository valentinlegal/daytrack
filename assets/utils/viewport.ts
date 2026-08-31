/** Marge minimale entre un élément flottant et le bord de la fenêtre. */
export const VIEWPORT_MARGIN = 8;

/**
 * Ramène le rectangle (`top`, `left`, `height`, `width`) entièrement dans la
 * fenêtre, en conservant `VIEWPORT_MARGIN` px de marge. Une dimension à 0 (pas
 * encore mesurée) laisse la coordonnée correspondante inchangée.
 */
export function clampToViewport(
    top: number,
    left: number,
    height: number,
    width: number,
): { top: number; left: number } {
    return {
        top: height > 0
            ? Math.max(VIEWPORT_MARGIN, Math.min(top, window.innerHeight - height - VIEWPORT_MARGIN))
            : top,
        left: width > 0
            ? Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - width - VIEWPORT_MARGIN))
            : left,
    };
}
