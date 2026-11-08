import { type RefObject, useLayoutEffect, useRef, useState } from 'react';

import { tokenPixels } from '../components/tokenPixels';
import { setPointerLength } from './pointerLength';
import { readSideWidth, sideBounds, writeSideWidth } from './sideWidth';

/**
 * La largeur de la colonne de gauche, réglée par son bord : posée sur l'écran, que la
 * colonne et la zone du logo lisent (day.css). Elle se retient une fois le geste fini ;
 * un double-clic sur le bord l'oublie.
 */
export function useSideWidth(): {
    sideRef: RefObject<HTMLDivElement | null>;
    side: {
        width: number;
        bounds: NonNullable<ReturnType<typeof sideBounds>>;
        onWidth: (width: number | null, done: boolean) => void;
    } | null;
} {
    const sideRef = useRef<HTMLDivElement>(null);
    const [bounds] = useState(() => sideBounds((name) => tokenPixels(name)));
    const [width, setWidth] = useState(() =>
        bounds === null ? null : readSideWidth(() => window.localStorage, bounds),
    );

    useLayoutEffect(() => {
        setPointerLength(sideRef.current, '--w-side-chosen', width);
    }, [width]);

    return {
        sideRef,
        side:
            bounds === null
                ? null
                : {
                      width: width ?? bounds.initial,
                      bounds,
                      onWidth: (next, done) => {
                          setWidth(next);
                          if (done) {
                              writeSideWidth(() => window.localStorage, next);
                          }
                      },
                  },
    };
}
