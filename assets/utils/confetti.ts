import confetti from 'canvas-confetti';

/** Nombre de particules de l'explosion — volontairement faible pour rester discret */
const PARTICLE_COUNT = 50;
/**
 * Dispersion à 360° : un cône dirigé vers le haut (comportement par défaut de la lib) enverrait
 * une bonne partie des particules au-dessus de la fenêtre pour un bouton proche du haut de l'écran
 * (ex : icône de l'AppHeader), avec un rendu "particules invisibles puis qui retombent". Un éclatement
 * radial reste visible immédiatement dans toutes les directions, quelle que soit la position du bouton.
 */
const SPREAD = 360;
/** Vitesse initiale des particules — faible pour que l'effet reste contenu près du bouton */
const START_VELOCITY = 12;
/** Durée de vie des particules en frames — courte pour qu'elles s'effacent avant de trop s'éloigner */
const TICKS = 90;
/** Décélération des particules à chaque frame — plus faible que la valeur par défaut (0.9) pour resserrer le rayon de l'explosion */
const DECAY = 0.85;

export interface FireConfettiOptions {
    /**
     * Décalage horizontal de l'origine, en fraction de la largeur de la fenêtre (ex : -0.03 = 3 %
     * vers la gauche). Utile pour un bouton proche du bord de l'écran, où une partie de l'éclatement
     * radial sortirait sinon immédiatement de la zone visible.
     */
    originOffsetX?: number;
    /** Multiplicateur appliqué au nombre de particules et à leur vitesse initiale, pour un effet plus ou moins large */
    scale?: number;
}

/**
 * Déclenche une explosion de confettis contenue, centrée sur l'élément donné.
 * Ne fait rien si l'élément est absent (ex : ref pas encore montée).
 */
export function fireConfettiFromElement(element: HTMLElement | null, options: FireConfettiOptions = {}): void {
    if (null === element) return;

    const { originOffsetX = 0, scale = 1 } = options;

    const rect = element.getBoundingClientRect();
    const origin = {
        x: Math.min(1, Math.max(0, (rect.left + rect.width / 2) / window.innerWidth + originOffsetX)),
        y: (rect.top + rect.height / 2) / window.innerHeight,
    };

    void confetti({
        particleCount: Math.round(PARTICLE_COUNT * scale),
        spread: SPREAD,
        startVelocity: START_VELOCITY * scale,
        ticks: TICKS,
        decay: DECAY,
        origin,
        disableForReducedMotion: true,
    });
}
