import confetti from 'canvas-confetti';

/** Les teintes de la gerbe : quatre teintes de types de ticket, et l'orange de « Non envoyé ». */
const TINTS = ['--c-vert-bar', '--c-rouge-bar', '--c-bleu-bar', '--c-violet-bar', '--warn'];

/** Environ 2 s à soixante images par seconde : le temps de monter, puis de retomber. */
const TICKS = 120;

const cannons = new WeakMap<HTMLCanvasElement, confetti.CreateTypes>();

/**
 * La gerbe d'un envoi réussi : une centaine de confettis partent du centre du bouton, tout droit
 * vers le haut, en éventail, puis retombent sur l'écran et s'effacent en 2 s environ, récapitulatif
 * ouvert ou fermé. Le bouton n'a qu'une trentaine de pixels au-dessus de son centre : l'éventail
 * est large et la vitesse modérée, mais la plupart des confettis sortent un moment par le haut,
 * et on les voit surtout retomber. Rien ne bloque, rien ne prend le curseur, et rien du tout quand
 * le système demande moins de mouvement.
 */
export function celebrate(canvas: HTMLCanvasElement, from: DOMRect): void {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return;
    }

    let fire = cannons.get(canvas);
    if (fire === undefined) {
        fire = confetti.create(canvas, { resize: true, disableForReducedMotion: true });
        cannons.set(canvas, fire);
    }

    const box = canvas.getBoundingClientRect();
    const style = getComputedStyle(canvas);
    void fire({
        particleCount: 100,
        angle: 90,
        spread: 120,
        startVelocity: 16,
        gravity: 0.8,
        ticks: TICKS,
        origin: {
            x: (from.left + from.width / 2 - box.left) / box.width,
            y: (from.top + from.height / 2 - box.top) / box.height,
        },
        colors: TINTS.map((name) => style.getPropertyValue(name).trim()).filter((color) => color !== ''),
        disableForReducedMotion: true,
    });
}
