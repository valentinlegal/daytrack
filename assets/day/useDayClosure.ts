import { type RefObject, useEffect, useRef, useState } from 'react';

import { type ClosureFacts, closureReason, staysOpen } from './dayClosure';

export interface DayClosure {
    /** La grille ne prend aucun geste : voir GridEditing.closed. */
    readonly closed: boolean;
    /** Pourquoi elle est fermée, null quand elle est ouverte. */
    readonly reason: string | null;
    /**
     * « Saisir quand même » : ouvre le jour affiché, pour ce jour-là seulement, sans rien
     * écrire. Revenu plus tard sans saisie, on le retrouve fermé, à 0h00 s'il l'était.
     */
    readonly openAnyway: () => void;
}

/** La grille d'un jour non travaillé, fermée à la saisie tant qu'elle est vide (closureReason). */
export function useDayClosure(facts: Omit<ClosureFacts, 'openedAnyway'>): DayClosure {
    const { date, day } = facts;
    const [openedAnyway, setOpenedAnyway] = useState<string | null>(null);
    if (openedAnyway !== null && openedAnyway !== date) {
        setOpenedAnyway(null);
    }
    if (staysOpen(day) && openedAnyway !== date) {
        setOpenedAnyway(date);
    }
    const reason = closureReason({ ...facts, openedAnyway });

    return {
        closed: reason !== null,
        reason,
        openAnyway: () => {
            setOpenedAnyway(date);
        },
    };
}

/** Le message d'une grille fermée, et son bouton. */
export interface OffDay {
    readonly reason: string;
    readonly onOpen: () => void;
}

/**
 * Où va le curseur autour d'une grille fermée, qui ne le prend pas. « Saisir quand même »
 * disparaît avec elle : le curseur, perdu, va à la grille. Ce qui le rendrait à une grille
 * fermée — une fenêtre restée ouverte pendant qu'elle se fermait, un message — le donne à
 * « Saisir quand même », dès qu'il paraît.
 *
 * Appelé après la grille, dont il reçoit focusGrid.
 */
export function useOffDayFocus(
    closure: DayClosure,
    focusGrid: () => void,
): {
    /** Le message de la grille fermée, null quand elle est ouverte. */
    offDay: OffDay | null;
    /** Le bouton « Saisir quand même ». */
    openAnywayRef: RefObject<HTMLButtonElement | null>;
    /** Rend le curseur à la grille, ou à « Saisir quand même » quand elle est fermée. */
    returnFocus: () => void;
} {
    const { closed } = closure;
    const openingRef = useRef(false);
    const openAnywayRef = useRef<HTMLButtonElement>(null);
    const focusButtonRef = useRef(false);

    useEffect(() => {
        if (!closed && openingRef.current) {
            openingRef.current = false;
            focusGrid();
        }
    });

    useEffect(() => {
        if (focusButtonRef.current && openAnywayRef.current !== null) {
            focusButtonRef.current = false;
            openAnywayRef.current.focus();
        }
    });

    return {
        offDay:
            closure.reason === null
                ? null
                : {
                      reason: closure.reason,
                      onOpen: () => {
                          openingRef.current = true;
                          closure.openAnyway();
                      },
                  },
        openAnywayRef,
        returnFocus: () => {
            if (!closed) {
                focusGrid();
            } else if (openAnywayRef.current !== null) {
                openAnywayRef.current.focus();
            } else {
                focusButtonRef.current = true;
            }
        },
    };
}
