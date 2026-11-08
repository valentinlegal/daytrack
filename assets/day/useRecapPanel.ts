import { type RefObject, useEffect, useRef, useState } from 'react';

import { readRecapOpen, writeRecapOpen } from './recapPreference';

/** À partir de cette largeur, le récapitulatif s'ouvre de lui-même. */
const RECAP_OPEN_QUERY = '(width >= 1440px)';

/** En dessous, il s'ouvre par-dessus la grille, et Échap le ferme : le même seuil que day.css et max-lg. */
const OVERLAY_QUERY = '(width < 1280px)';

function overlay(): boolean {
    return window.matchMedia(OVERLAY_QUERY).matches;
}

export interface RecapPanel {
    readonly open: boolean;
    /** Le bouton de la barre qui l'ouvre et le ferme. */
    readonly toggleRef: RefObject<HTMLButtonElement | null>;
    /** Le bouton qui le ferme, dans le récapitulatif. */
    readonly hideRef: RefObject<HTMLButtonElement | null>;
    readonly setOpen: (open: boolean) => void;
    /**
     * Sous 1280 px, il couvre la droite de la grille : une fenêtre ou le menu passeraient
     * dessous. Ils le ferment en s'ouvrant.
     */
    readonly closeOverlay: () => void;
    /** Échap : il se ferme s'il couvre la grille. Faux sinon. */
    readonly escape: () => boolean;
}

/**
 * Le récapitulatif, à droite de la grille : ouvert de lui-même aux grandes largeurs, puis
 * comme on l'a laissé. Par-dessus la grille, sous 1280 px, il s'ouvre à la demande et ne
 * se retient pas.
 */
export function useRecapPanel(): RecapPanel {
    const [open, setOpen] = useState(
        () => !overlay() && (readRecapOpen(() => window.localStorage) ?? window.matchMedia(RECAP_OPEN_QUERY).matches),
    );
    const toggleRef = useRef<HTMLButtonElement>(null);
    const hideRef = useRef<HTMLButtonElement>(null);
    // Le bouton à qui rendre le focus une fois le récapitulatif ouvert ou fermé.
    const focusAfterRef = useRef<RefObject<HTMLButtonElement | null> | null>(null);

    /**
     * Ouvre ou ferme le récapitulatif. Un bouton qui disparaît avec lui emporterait le
     * focus : il passe alors au bouton qui prend sa place.
     */
    const change = (next: boolean) => {
        const covers = overlay();
        const focused = document.activeElement;
        const lost =
            focused !== null && (next ? !covers && focused === toggleRef.current : focused.closest('#recap') !== null);
        focusAfterRef.current = lost ? (next ? hideRef : toggleRef) : null;
        setOpen(next);
        if (!covers) {
            writeRecapOpen(() => window.localStorage, next);
        }
    };

    useEffect(() => {
        focusAfterRef.current?.current?.focus();
        focusAfterRef.current = null;
    }, [open]);

    const escape = () => {
        if (!open || !overlay()) {
            return false;
        }
        change(false);

        return true;
    };

    return {
        open,
        toggleRef,
        hideRef,
        setOpen: change,
        closeOverlay: () => {
            escape();
        },
        escape,
    };
}
