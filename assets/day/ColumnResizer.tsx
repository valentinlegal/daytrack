import { type KeyboardEvent, type MouseEvent, useRef } from 'react';

import { tokenPixels } from '../components/tokenPixels';
import { FAVORITES_COLUMN } from './FavoritesColumn';
import { clampWidth, type SideBounds } from './sideWidth';

/**
 * Le bord droit de la colonne de gauche, qui règle sa largeur : au pointeur, et au
 * clavier par les flèches, de --s-2 en --s-2, Début et Fin pour ses bornes. Un
 * double-clic la remet à sa largeur de départ. Sous 1280 px, la colonne a sa largeur
 * étroite et le bord ne se règle pas.
 *
 * @param onWidth la nouvelle largeur, null pour la largeur de départ ; done une fois le
 *                geste fini, quand elle se retient
 */
export function ColumnResizer({
    width,
    bounds,
    onWidth,
}: {
    width: number;
    bounds: SideBounds;
    onWidth: (width: number | null, done: boolean) => void;
}) {
    const stopRef = useRef<(() => void) | null>(null);

    const onMouseDown = (event: MouseEvent<HTMLDivElement>) => {
        if (event.button !== 0) {
            return;
        }
        // Ni sélection de texte pendant le geste, ni focus volé à ce qu'on faisait.
        event.preventDefault();
        stopRef.current?.();
        const startX = event.clientX;
        let current = width;
        const onMove = (move: globalThis.MouseEvent) => {
            current = clampWidth(width + move.clientX - startX, bounds);
            onWidth(current, false);
        };
        const onUp = () => {
            stop();
            onWidth(current, true);
        };
        const stop = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            stopRef.current = null;
        };
        stopRef.current = stop;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const step = tokenPixels('--s-2');
        const next =
            event.key === 'ArrowLeft'
                ? width - step
                : event.key === 'ArrowRight'
                  ? width + step
                  : event.key === 'Home'
                    ? bounds.min
                    : event.key === 'End'
                      ? bounds.max
                      : null;
        if (next !== null) {
            event.preventDefault();
            onWidth(clampWidth(next, bounds), true);
        }
    };

    // Un séparateur qu'on règle est un contrôle (le motif « window splitter » de
    // WAI-ARIA) : il prend le focus et répond au pointeur, ce que jsx-a11y ne sait pas.
    /* eslint-disable jsx-a11y-x/no-noninteractive-element-interactions, jsx-a11y-x/no-noninteractive-tabindex */
    return (
        <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Largeur des favoris"
            aria-valuemin={bounds.min}
            aria-valuemax={bounds.max}
            aria-valuenow={width}
            aria-valuetext={`${String(width)} pixels`}
            aria-controls={FAVORITES_COLUMN}
            tabIndex={0}
            className="column-resizer absolute inset-y-0 -right-1 z-(--z-sel) w-2 cursor-col-resize outline-none max-lg:hidden"
            onMouseDown={onMouseDown}
            onDoubleClick={() => {
                onWidth(null, true);
            }}
            onKeyDown={onKeyDown}
        />
    );
    /* eslint-enable jsx-a11y-x/no-noninteractive-element-interactions, jsx-a11y-x/no-noninteractive-tabindex */
}
