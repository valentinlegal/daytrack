import { edgeScroll, type Point } from './columnGeometry';
import { measureColumn } from './columnMeasure';

/**
 * Le glisser à la souris, le même pour tous les gestes de l'écran Journée : sur la grille,
 * et d'un favori vers elle. Il suit le pointeur jusqu'au relâcher, même hors de la grille,
 * et la fait défiler quand il approche de son bord haut ou bas (edgeScroll).
 *
 * Ses écouteurs se posent à l'appui, pas au rendu d'après — un geste rapide relâcherait
 * avant eux —, et s'en vont au relâcher.
 *
 * Échap abandonne le glisser sans rien poser, et ne ferme qu'une chose à la fois : écouté
 * sur la fenêtre du navigateur, en capture, et arrêté là, il ne parvient pas à une fenêtre
 * restée ouverte, que Radix écoute sur le document. Elle garde sa saisie.
 */
export interface PointerDrag {
    /** Où le pointeur a appuyé, dans la fenêtre du navigateur. */
    readonly start: Point;
    /**
     * Ce que le pointeur doit parcourir avant que l'appui devienne un glisser, et pas un
     * clic ; zéro : il l'est dès l'appui. Avant, Échap n'est pas pour lui.
     */
    readonly threshold: number;
    /** La colonne des blocs : ses rangées règlent la zone du bord. */
    readonly lane: () => HTMLElement | null;
    /** La zone qui fait défiler la grille. */
    readonly scroller: () => HTMLElement | null;
    /** L'appui devient un glisser : le seuil passé, ou dès l'appui sans seuil. */
    readonly onStart?: () => void;
    /** Le pointeur a bougé, ou la grille a défilé sous lui. */
    readonly onMove: (x: number, y: number) => void;
    /** Le relâcher, une fois l'appui devenu un glisser. */
    readonly onEnd: (x: number, y: number) => void;
    /** Échap : le glisser est abandonné, sans rien poser. */
    readonly onCancel: () => void;
}

/**
 * Commence un glisser, à l'appui. La fonction rendue l'arrête sans rien appeler : un autre
 * geste le remplace, ou l'écran s'en va.
 */
export function startPointerDrag(drag: PointerDrag): () => void {
    let started = drag.threshold <= 0;
    let pointer: Point | null = null;
    let frame = 0;

    // À chaque image, une fois le pointeur parti : la grille a pu défiler sous lui.
    const scroll = () => {
        const scroller = pointer === null ? null : drag.scroller();
        const column = scroller === null ? null : measureColumn(drag.lane());
        if (pointer !== null && scroller !== null && column !== null) {
            const delta = edgeScroll(scroller.getBoundingClientRect(), column.row, pointer, drag.start.y);
            if (delta !== 0) {
                scroller.scrollTop += delta;
                drag.onMove(pointer.x, pointer.y);
            }
        }
        frame = requestAnimationFrame(scroll);
    };
    const onMove = (event: MouseEvent) => {
        pointer = { x: event.clientX, y: event.clientY };
        if (!started) {
            if (Math.hypot(pointer.x - drag.start.x, pointer.y - drag.start.y) < drag.threshold) {
                return;
            }
            started = true;
            drag.onStart?.();
            frame = requestAnimationFrame(scroll);
        }
        drag.onMove(pointer.x, pointer.y);
    };
    const onUp = (event: MouseEvent) => {
        stop();
        if (started) {
            drag.onEnd(event.clientX, event.clientY);
        }
    };
    const onKey = (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || !started) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        stop();
        drag.onCancel();
    };
    const stop = () => {
        cancelAnimationFrame(frame);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        window.removeEventListener('keydown', onKey, true);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey, true);
    if (started) {
        drag.onStart?.();
        frame = requestAnimationFrame(scroll);
    }

    return stop;
}
