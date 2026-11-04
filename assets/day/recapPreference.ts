/**
 * Le récapitulatif ouvert ou fermé : une préférence, qui vaut d'un onglet à l'autre dans
 * ce navigateur, comme la largeur de la colonne de gauche. Sous 1280 px, où il s'ouvre
 * par-dessus la grille, il part fermé, et l'y ouvrir ne change pas la préférence.
 */
export const RECAP_STORAGE_KEY = 'daytrack.recap-open';

/** Ouvert ou fermé, ou null quand rien n'est retenu, que c'est illisible, ou que le navigateur refuse le stockage. */
export function readRecapOpen(storage: () => Pick<Storage, 'getItem'>): boolean | null {
    let stored: string | null;
    try {
        stored = storage().getItem(RECAP_STORAGE_KEY);
    } catch {
        return null;
    }

    return stored === 'true' ? true : stored === 'false' ? false : null;
}

export function writeRecapOpen(storage: () => Pick<Storage, 'setItem'>, open: boolean): void {
    try {
        storage().setItem(RECAP_STORAGE_KEY, String(open));
    } catch {
        // Sans stockage, le choix vaut le temps de la page.
    }
}
