/**
 * Les durées telles que l'écran les écrit : `1h45`, `0h15`, et un solde signé, `+0h45` ou
 * `−0h45`.
 */

/** Le moins de la typographie (U+2212), pas le tiret du clavier. */
const MINUS = '−';

export function duration(minutes: number): string {
    if (!Number.isInteger(minutes) || minutes < 0) {
        throw new RangeError(`${String(minutes)} n'est pas une durée.`);
    }

    return `${String(Math.floor(minutes / 60))}h${String(minutes % 60).padStart(2, '0')}`;
}

export function signedDuration(minutes: number): string {
    return `${minutes < 0 ? MINUS : '+'}${duration(Math.abs(minutes))}`;
}
