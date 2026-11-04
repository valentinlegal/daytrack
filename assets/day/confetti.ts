import confetti from 'canvas-confetti';

/** Les teintes de la gerbe : quatre teintes de types de ticket, et l'orange de « Non envoyé ». */
const TINTS = ['--c-vert-bar', '--c-rouge-bar', '--c-bleu-bar', '--c-violet-bar', '--warn'];

/** Environ 1,2 s à soixante images par seconde. */
const TICKS = 72;

const cannons = new WeakMap<HTMLCanvasElement, confetti.CreateTypes>();

/**
 * La gerbe d'un envoi réussi : une centaine de confettis partent du centre du bouton vers
 * l'intérieur de l'écran, vers le bas, et vers le bas et la gauche quand le bouton touche
 * le bord. Ils retombent et s'effacent en 1,2 s environ, sans rien bloquer ni prendre le
 * curseur. Rien du tout quand le système demande moins de mouvement.
 */
export function celebrate(canvas: HTMLCanvasElement, from: DOMRect, towardsLeft: boolean): void {
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
        angle: towardsLeft ? 240 : 270,
        spread: 80,
        startVelocity: 28,
        gravity: 1.1,
        ticks: TICKS,
        origin: {
            x: (from.left + from.width / 2 - box.left) / box.width,
            y: (from.top + from.height / 2 - box.top) / box.height,
        },
        colors: TINTS.map((name) => style.getPropertyValue(name).trim()).filter((color) => color !== ''),
        disableForReducedMotion: true,
    });
}
