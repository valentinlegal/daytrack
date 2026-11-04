/**
 * La largeur de la colonne de gauche, réglée au pointeur : de
 * --w-side-narrow à --w-side-max, --w-side par défaut. Elle vaut d'une session à
 * l'autre, dans ce navigateur. Sous
 * 1280 px, la colonne reste à --w-side-narrow quelle que soit la largeur réglée
 * (day.css).
 */
export const SIDE_WIDTH_STORAGE_KEY = 'daytrack.side-width';

export interface SideBounds {
    readonly min: number;
    readonly max: number;
    /** La largeur de départ, où ramène un double-clic sur le bord. */
    readonly initial: number;
}

/** Les bornes, lues dans les tokens ; null si la feuille de style n'est pas là pour les dire. */
export function sideBounds(read: (name: `--${string}`) => number): SideBounds | null {
    const bounds = { min: read('--w-side-narrow'), max: read('--w-side-max'), initial: read('--w-side') };

    return bounds.min > 0 && bounds.max >= bounds.initial && bounds.initial >= bounds.min ? bounds : null;
}

/** Une largeur gardée dans ses bornes, au pixel près. */
export function clampWidth(width: number, bounds: SideBounds): number {
    return Math.round(Math.min(Math.max(width, bounds.min), bounds.max));
}

/**
 * La largeur réglée, ou null quand il n'y en a pas, qu'elle est illisible, ou que le
 * navigateur refuse l'accès au stockage.
 */
export function readSideWidth(storage: () => Pick<Storage, 'getItem'>, bounds: SideBounds): number | null {
    let stored: string | null;
    try {
        stored = storage().getItem(SIDE_WIDTH_STORAGE_KEY);
    } catch {
        return null;
    }
    // Un nombre de pixels entier, rien d'autre : Number('') vaudrait 0.
    return stored !== null && /^\d{1,4}$/.test(stored) ? clampWidth(Number(stored), bounds) : null;
}

/** Retient la largeur ; null l'oublie, et la colonne revient à sa largeur de départ. */
export function writeSideWidth(storage: () => Pick<Storage, 'setItem' | 'removeItem'>, width: number | null): void {
    try {
        if (width === null) {
            storage().removeItem(SIDE_WIDTH_STORAGE_KEY);
        } else {
            storage().setItem(SIDE_WIDTH_STORAGE_KEY, String(width));
        }
    } catch {
        // Sans stockage, la largeur vaut le temps de la page.
    }
}
