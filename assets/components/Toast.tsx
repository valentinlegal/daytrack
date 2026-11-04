import { type ReactNode, useEffect, useRef, useState } from 'react';

import { CloseIcon } from './icons';
import { Tooltip } from './Tooltip';

/**
 * Le message en bas de la grille : couleurs inversées, centré, ce qui vient de se passer
 * et, s'il y a lieu, de quoi le défaire.
 *
 * Sa région reste dans la page, vide entre deux messages : c'est la région
 * `role="status"` commune à l'écran, et un lecteur d'écran n'annonce que ce qui change
 * dans une région déjà là. Le message part au bout de `duration`, et pas tant que le
 * pointeur ou le focus est dessus ; sa croix le ferme.
 */
export interface ToastMessage {
    /** Change à chaque message : le même texte deux fois s'annonce deux fois. */
    readonly key: number;
    readonly content: ReactNode;
    /** Le bouton qui défait le geste, s'il y en a un. */
    readonly action?:
        | {
              readonly label: string;
              /** L'infobulle, qui porte le raccourci : « Annuler (Ctrl+Z) ». */
              readonly title: string;
              readonly keyShortcuts: string;
              readonly onAction: () => void;
          }
        | undefined;
    /**
     * Où rendre le curseur quand le message part sous lui, si ce n'est pas là où l'écran
     * le rend d'habitude : à la liste des favoris pour un favori retiré, pas à la grille.
     */
    readonly returnFocus?: (() => void) | undefined;
}

export function Toast({
    message,
    duration,
    onDismiss,
    returnFocus,
}: {
    message: ToastMessage | null;
    /** En millisecondes. */
    duration: number;
    onDismiss: () => void;
    /**
     * Rend le curseur à ce qu'il servait, quand le message disparaît sous lui après
     * « Annuler » ou sa croix.
     */
    returnFocus?: () => void;
}) {
    const [held, setHeld] = useState({ pointer: false, focus: false });
    const regionRef = useRef<HTMLDivElement>(null);
    const dismissRef = useRef(onDismiss);
    useEffect(() => {
        dismissRef.current = onDismiss;
    });

    // Le pointeur ou le focus le retiennent.
    useEffect(() => {
        const region = regionRef.current;
        if (region === null) {
            return;
        }
        const hold = (part: 'pointer' | 'focus', value: boolean) => () => {
            setHeld((current) => (current[part] === value ? current : { ...current, [part]: value }));
        };
        const enter = hold('pointer', true);
        const leave = hold('pointer', false);
        const focus = hold('focus', true);
        const blur = (event: FocusEvent) => {
            if (!(event.relatedTarget instanceof Node && region.contains(event.relatedTarget))) {
                hold('focus', false)();
            }
        };
        region.addEventListener('pointerenter', enter);
        region.addEventListener('pointerleave', leave);
        region.addEventListener('focusin', focus);
        region.addEventListener('focusout', blur);

        return () => {
            region.removeEventListener('pointerenter', enter);
            region.removeEventListener('pointerleave', leave);
            region.removeEventListener('focusin', focus);
            region.removeEventListener('focusout', blur);
        };
    }, []);

    const paused = held.pointer || held.focus;

    /** Un bouton du message : le message part avec lui, le curseur ne se perd pas. */
    const leaving = (act: () => void) => () => {
        const focused = regionRef.current?.contains(document.activeElement) ?? false;
        const back = message?.returnFocus ?? returnFocus;
        act();
        if (focused) {
            back?.();
        }
    };
    const key = message?.key;

    // Un nouveau message part de ce qui le tient vraiment : le pointeur resté sur
    // l'ancien, qui a disparu sous lui sans bouger, ne le retient pas.
    useEffect(() => {
        const region = regionRef.current;
        if (region !== null) {
            setHeld({ pointer: region.matches(':hover'), focus: region.contains(document.activeElement) });
        }
    }, [key]);
    useEffect(() => {
        if (key === undefined || paused) {
            return;
        }
        const timer = window.setTimeout(() => {
            dismissRef.current();
        }, duration);

        return () => {
            window.clearTimeout(timer);
        };
    }, [key, paused, duration]);

    return (
        <div
            ref={regionRef}
            role="status"
            className={
                message === null
                    ? 'sr-only'
                    : 'absolute inset-x-0 bottom-6 z-(--z-toast) mx-auto flex h-7 w-fit items-center gap-3 rounded-3 bg-btn pr-1 pl-4 whitespace-nowrap text-on-btn shadow-pop'
            }
        >
            {message !== null && (
                <>
                    <span>{message.content}</span>
                    {message.action !== undefined && (
                        <Tooltip label={message.action.title} side="top">
                            <button
                                type="button"
                                aria-keyshortcuts={message.action.keyShortcuts}
                                className="h-ctl-sm cursor-pointer rounded-2 border border-toast-line bg-transparent px-3 font-semibold text-on-btn"
                                onClick={leaving(message.action.onAction)}
                            >
                                {message.action.label}
                            </button>
                        </Tooltip>
                    )}
                    <button
                        type="button"
                        aria-label="Fermer le message"
                        className="flex size-ctl-sm cursor-pointer items-center justify-center rounded-2 border-none bg-transparent text-toast-ink-2"
                        onClick={leaving(onDismiss)}
                    >
                        <CloseIcon />
                    </button>
                </>
            )}
        </div>
    );
}
