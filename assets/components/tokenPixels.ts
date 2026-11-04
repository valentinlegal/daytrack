/**
 * La valeur d'un token de longueur, en pixels, pour ce que le navigateur place
 * lui-même : l'écart d'une fenêtre à ce qui l'a ouverte, sa marge au bord de l'écran.
 * Le token reste la seule source : rien ne s'écrit en dur.
 */
export function tokenPixels(name: `--${string}`, element: Element = document.documentElement): number {
    const value = Number.parseFloat(getComputedStyle(element).getPropertyValue(name));

    return Number.isFinite(value) ? value : 0;
}
