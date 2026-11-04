/**
 * Une longueur que le pointeur règle au pixel — la largeur de la colonne de gauche, la
 * carte d'un favori qu'on glisse —, posée sur l'élément comme une variable CSS que sa
 * feuille lit (day.css). C'est la seule valeur en pixels qu'un composant écrit : elle
 * vient du geste, pas du design. Null retire la variable, et la feuille reprend son
 * token.
 */
export function setPointerLength(element: HTMLElement | null, name: `--${string}`, pixels: number | null): void {
    if (pixels === null) {
        element?.style.removeProperty(name);
    } else {
        element?.style.setProperty(name, `${String(Math.round(pixels))}px`);
    }
}
