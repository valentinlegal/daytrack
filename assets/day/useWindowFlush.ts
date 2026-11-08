import { type RefObject, useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef } from 'react';

import type { OpenWindow } from './ObjectiveWindow';
import type { Favorites } from './useFavorites';
import type { GridEditing } from './useGridEditing';

type Flush = () => Promise<boolean>;

/**
 * Ce qui enregistre les fenêtres ouvertes — la fenêtre de ticket, l'objectif du jour, le
 * formulaire d'un favori — avant un geste qui les fermerait : changer de jour, ouvrir une
 * autre fenêtre, quitter la page. Créé avant la grille et les favoris, qui le reçoivent,
 * et relié à eux ensuite par useWindowFlush.
 */
export interface OpenWindows {
    /**
     * Enregistre tout ce qui est ouvert, comme un clic à côté. La promesse dit si tout s'est
     * fermé ; refusée, une fenêtre reste ouverte avec son message.
     */
    readonly flush: Flush;
    /**
     * Un envoi sur Jira est en cours : la journée ne se quitte pas avant d'en voir l'issue.
     * Le voile retient la souris et le clavier ; seules les flèches du navigateur le lisent.
     */
    readonly held: () => boolean;
    /** Ce qui s'enregistre à côté de la grille avant une fenêtre de ticket ; null quand rien n'y est ouvert. */
    readonly beforeTicketWindowRef: RefObject<Flush | null>;
    /** Ce qui s'enregistre avant le formulaire d'un favori ; null quand rien n'est ouvert. */
    readonly beforeFavoriteFormRef: RefObject<Flush | null>;
    /** Ce que flush appelle, posé par useWindowFlush à chaque rendu. */
    readonly flushRef: RefObject<Flush>;
    /** Ce que held lit, posé par useWindowFlush à chaque rendu. */
    readonly heldRef: RefObject<boolean>;
}

export function useOpenWindows(): OpenWindows {
    const flushRef = useRef<Flush>(() => Promise.resolve(true));
    const heldRef = useRef(false);
    const beforeTicketWindowRef = useRef<Flush | null>(null);
    const beforeFavoriteFormRef = useRef<Flush | null>(null);
    const flush = useCallback(() => flushRef.current(), []);
    const held = useCallback(() => heldRef.current, []);

    return { flush, held, beforeTicketWindowRef, beforeFavoriteFormRef, flushRef, heldRef };
}

/**
 * Relie les fenêtres ouvertes à ce qui les enregistre (OpenWindows), à chaque rendu et avant
 * tout geste : un geste lit toujours les fenêtres telles qu'il les voit.
 *
 * Quitter la page — la flèche du navigateur vers un jour ouvert par son adresse, un
 * rechargement, l'onglet fermé — emporterait ce qu'une fenêtre ouverte n'a pas encore
 * enregistré. Elle s'enregistre, comme sur un clic à côté, et le navigateur demande s'il
 * faut partir : refusée, on reste, et la fenêtre dit pourquoi.
 */
export function useWindowFlush(
    { flushRef, heldRef, beforeTicketWindowRef, beforeFavoriteFormRef }: OpenWindows,
    {
        editing,
        favorites,
        objective,
        sending,
        leaveRef,
    }: {
        editing: GridEditing;
        favorites: Favorites;
        objective: { readonly open: boolean; readonly flushRef: RefObject<OpenWindow | null> };
        /** Un envoi sur Jira parti de cet onglet attend sa réponse. */
        sending: boolean;
        /** Ce que l'application appelle avant de quitter la journée pour les réglages. */
        leaveRef?: RefObject<() => Promise<boolean>> | undefined;
    },
): void {
    const saveObjective = (): Promise<boolean> => objective.flushRef.current?.save() ?? Promise.resolve(true);
    /** L'objectif et le formulaire d'un favori : ce qui s'enregistre à côté de la fenêtre de ticket. */
    const flushBesideGrid = async (): Promise<boolean> => (await saveObjective()) && (await favorites.leave());
    const flushAll = async (leavingPage = false): Promise<boolean> =>
        (await editing.flushWindow(leavingPage)) && (await flushBesideGrid());
    const besideGridOpen = objective.open || favorites.form !== null;

    useLayoutEffect(() => {
        flushRef.current = () => flushAll();
        heldRef.current = sending;
        beforeTicketWindowRef.current = besideGridOpen ? flushBesideGrid : null;
        beforeFavoriteFormRef.current =
            editing.window === null && !objective.open
                ? null
                : async () => (await editing.flushWindow()) && (await saveObjective());
        if (leaveRef !== undefined) {
            leaveRef.current = () => flushAll();
        }
    });

    const onBeforeUnload = useEffectEvent((event: BeforeUnloadEvent) => {
        if (!editing.unsavedWindow() && objective.flushRef.current?.unsaved() !== true) {
            return;
        }
        event.preventDefault();
        void flushAll(true);
    });
    useEffect(() => {
        const listener = (event: BeforeUnloadEvent) => {
            onBeforeUnload(event);
        };
        window.addEventListener('beforeunload', listener);

        return () => {
            window.removeEventListener('beforeunload', listener);
        };
    }, []);
}
