import {
    type KeyboardEvent,
    type MouseEvent,
    type RefObject,
    useEffect,
    useEffectEvent,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';

import type { ToastMessage } from '../components/Toast';
import { tokenPixels } from '../components/tokenPixels';
import { selectionActions, type SelectionActions } from '../grid/actions';
import { fill, type QuarterChanges } from '../grid/changes';
import type { DayState } from '../grid/day';
import type { DaySession, Outcome } from '../grid/daySession';
import {
    deleteEntry,
    draftOf,
    type EntryAction,
    type EntryDraft,
    type EntryTarget,
    hasTicketShape,
    partTarget,
    pauseEntry,
    quartersOf,
    replacedBy,
    retarget,
    saveEntry,
    selectionTarget,
    targetAt,
    targetOfSelection,
    typedTicket,
} from '../grid/entry';
import { dropTicket } from '../grid/drop';
import { PAUSE, work } from '../grid/grid';
import * as Quarter from '../grid/quarter';
import {
    deselect,
    EMPTY_SELECTION,
    extendTo,
    moveSelection,
    type Selection,
    selectionRuns,
    selectQuarter,
    selectQuarters,
    toggleQuarter,
} from '../grid/selection';
import { TICKET_NOT_FOUND } from '../jira/lookupMessages';
import { NO_CHECK, type TicketCheck } from '../jira/useTicketLookup';
import {
    type GridMessage,
    PART_REFUSAL,
    partNote,
    refusalMessage,
    replaceNote,
    TICKET_SHAPE_REFUSAL,
    type UndoableGesture,
    undoMessage,
    windowRefusal,
} from './messages';
import { isMac, shortcutAria, shortcutLabel } from './shortcuts';
import { across, aimedQuarter, type Attachment, attachWindow, type Room, windowAnchor } from './windowPlacement';

/** Le message d'annulation reste 8 secondes, et plus longtemps tant qu'on le tient. */
export const MESSAGE_DURATION = 8000;

/** Une fenêtre Nouveau ticket ou Modifier le ticket, et ce qu'on y a tapé. */
export interface TicketWindow {
    /** Change à chaque ouverture : une nouvelle fenêtre repart de son contenu. */
    readonly key: number;
    readonly target: EntryTarget;
    readonly aim: WindowAim;
    readonly draft: EntryDraft;
    readonly errors: WindowErrors;
    /** Un enregistrement attend sa réponse. */
    readonly sending: boolean;
}

/**
 * Là où la fenêtre a été demandée, et donc où elle s'ouvre. Elle le garde tant qu'elle
 * est ouverte, refus compris : elle ne suit pas le pointeur.
 */
export interface WindowAim {
    /**
     * L'horizontale du double-clic ou du clic droit, depuis le bord gauche de la colonne
     * des blocs ; null au clavier, où le milieu de la colonne en tient lieu.
     */
    readonly x: number | null;
    /**
     * Ouverte sur un bloc, le quart d'heure double-cliqué, ou celui où s'arrête la
     * sélection au clavier : elle se pose dessous, et y reste quand Nouveau ticket prend sa
     * place après un refus. Null quand elle s'est ouverte en Nouveau ticket, accrochée à sa
     * sélection.
     */
    readonly quarter: number | null;
}

export interface WindowErrors {
    readonly ticket: string | null;
    readonly comment: string | null;
    /** Ce qui ne tient à aucun champ : la journée changée ailleurs, le serveur muet. */
    readonly general: string | null;
    /** Un enregistrement vient d'être refusé : le curseur va au champ refusé. */
    readonly focus: boolean;
}

const NO_ERRORS: WindowErrors = { ticket: null, comment: null, general: null, focus: false };

export interface GridEditing {
    readonly selection: Selection;
    /**
     * Le curseur de la grille vient du pointeur : sans sélection, après Échap, rien ne se
     * dessine. Venu du clavier, la grille s'entoure pour montrer qu'elle le garde.
     */
    readonly pointerCursor: boolean;
    readonly window: TicketWindow | null;
    /**
     * Un jour non travaillé, vide, tant qu'on n'a pas choisi « Saisir quand même » : la
     * grille ne prend aucun geste — ni sélection, ni fenêtre, ni collage, ni favori
     * déposé, ni annulation. Copier un favori reste possible : ce n'est pas écrire.
     */
    readonly closed: boolean;
    /**
     * Ce que la fenêtre dit sous ses champs : ce que Nouveau ticket remplacera, « Remplace
     * SHOP-482 sur ces 30 minutes. », ou la partie de bloc que Modifier la sélection
     * modifie, « Modifie SHOP-482 sur ces 45 minutes seulement. ».
     */
    readonly windowNote: string | null;
    readonly message: ToastMessage | null;
    /**
     * Ce à quoi la fenêtre de ticket s'accroche — le créneau visé, la sélection ou le
     * bloc —, la grille là où elle est, selon la hauteur de la fenêtre.
     */
    readonly placeWindow: ((height: number) => PlacedWindow) | null;
    /**
     * Ce que Jira sait du ticket tapé dans la fenêtre, qui le tient à jour : un autre geste
     * qui la quitte n'enregistre rien que Jira ait refusé, et attend sa réponse.
     */
    readonly windowCheckRef: RefObject<TicketCheck>;
    readonly mac: boolean;
    readonly dismissMessage: () => void;
    readonly onLaneMouseDown: (event: MouseEvent<HTMLElement>) => void;
    readonly onLaneDoubleClick: (event: MouseEvent<HTMLElement>) => void;
    readonly onLaneContextMenu: (event: MouseEvent<HTMLElement>) => void;
    readonly onListboxKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
    readonly onListboxFocus: () => void;
    /** Ce que le menu propose, lu à son ouverture. */
    readonly actions: () => SelectionActions;
    /** « Nouveau ticket… » : la fenêtre s'ouvre sur la sélection exacte. */
    readonly newTicket: () => void;
    /** « Modifier la sélection… » : la fenêtre s'ouvre sur la sélection exacte, déjà remplie. */
    readonly editSelection: () => void;
    readonly copy: () => void;
    readonly cut: () => void;
    readonly paste: () => void;
    readonly convertToPause: () => void;
    readonly clear: () => void;
    readonly setDraft: (draft: EntryDraft) => void;
    /** On quitte le champ Ticket : une forme refusée se dit là, jamais pendant la frappe. */
    readonly checkTicket: () => void;
    /**
     * Enregistre la fenêtre. `known`, quand Jira cherche encore le ticket tapé, demande sa
     * réponse : l'enregistrement l'attend, fenêtre en envoi, et ne part pas si le ticket
     * est introuvable.
     */
    readonly saveWindow: (known?: () => Promise<boolean> | undefined) => void;
    readonly cancelWindow: () => void;
    readonly pauseWindow: () => void;
    readonly deleteWindow: () => void;
    /**
     * Enregistre la fenêtre ouverte, comme un clic à côté, avant un geste qui la
     * fermerait : changer de jour. La promesse dit si elle s'est fermée ; refusée, elle
     * reste ouverte avec son message.
     *
     * @param leavingPage la page se ferme : rien n'attend Jira, la réponse n'arriverait
     *                    plus, et le serveur reste juge
     */
    readonly flushWindow: (leavingPage?: boolean) => Promise<boolean>;
    /** La fenêtre de ticket ouverte a reçu ce qui n'est pas encore enregistré. */
    readonly unsavedWindow: () => boolean;
    /** Rend le curseur à la grille, s'il s'est perdu. */
    readonly focusGrid: () => void;
    /**
     * On quitte la grille — Échap, d'où que soit le curseur, un clic dans la colonne des
     * favoris ou dans le récapitulatif : sa sélection s'efface, sans rien écrire, et les
     * flèches repartent du créneau atteint. Faux s'il n'y avait rien à effacer.
     */
    readonly deselect: () => boolean;
    /**
     * Un message venu d'à côté de la grille — la liste des favoris —, au même endroit. Son
     * « Annuler », s'il en a un, prend Ctrl/⌘+Z tant qu'il est affiché : un geste qui n'est
     * pas de la grille ne doit pas laisser ce raccourci défaire la grille en silence.
     */
    readonly notify: (message: Omit<ToastMessage, 'key'> | null) => void;
    /** Un clic sur un favori : son ticket, sans commentaire, dans le presse-papier de l'onglet. */
    readonly copyTicket: (ticket: string) => void;
    /** Un favori déposé sur ce quart d'heure. */
    readonly dropTicket: (ticket: string, quarter: number) => void;
}

/** La fenêtre de ticket, placée. */
export interface PlacedWindow {
    readonly rect: DOMRect;
    /** Son créneau est sorti de la vue : elle s'est arrêtée au bord, et sa flèche disparaît. */
    readonly stopped: boolean;
}

/**
 * Ce qui prend un bloc glissé hors de la grille : la liste des favoris. Le glisser part
 * d'un bloc ; sorti de la colonne des blocs par la gauche, il s'en soulève, et la
 * sélection revient au quart d'heure d'où il est parti.
 */
export interface BlockDropTarget {
    /** Le pointeur passe ici, le ticket du bloc en main : vrai si le bloc s'est soulevé. */
    over(ticket: string, clientX: number, clientY: number): boolean;
    /** Le relâcher ici : vrai si le bloc était soulevé, et le glisser ne fait rien d'autre. */
    drop(ticket: string, clientX: number, clientY: number): boolean;
    /** Échap pendant qu'il est soulevé : il est lâché sans rien poser. */
    cancel(): void;
}

/**
 * Les gestes de la grille : la sélection à la souris et au clavier, le glisser, le menu,
 * les raccourcis, la fenêtre de ticket, et le message qui dit ce qu'un geste a fait.
 *
 * Tout passe par la session de la journée affichée : ce qui revient après un changement
 * de jour ne touche plus l'écran.
 */
export function useGridEditing({
    session,
    day,
    laneRef,
    listboxRef,
    visibleTop,
    onWindowOpen,
    blockDropRef,
    beforeWindowRef,
    closed = false,
}: {
    session: DaySession | null;
    day: DayState | null;
    /** La grille est fermée à la saisie : voir GridEditing.closed. */
    closed?: boolean;
    /** La colonne des blocs : le pointeur s'y lit en quarts d'heure. */
    laneRef: RefObject<HTMLElement | null>;
    /** La liste des créneaux, qui porte le curseur de la grille. */
    listboxRef: RefObject<HTMLElement | null>;
    /** L'heure en haut de la vue : le clavier y commence quand rien n'est sélectionné. */
    visibleTop: () => number;
    /** Une fenêtre de ticket s'ouvre : sous 1280 px, le récapitulatif posé par-dessus la grille se ferme. */
    onWindowOpen: () => void;
    /** Ce qui prend un bloc glissé hors de la grille. */
    blockDropRef?: RefObject<BlockDropTarget | null>;
    /**
     * Ce qui enregistre ce qui est ouvert à côté de la grille — l'objectif, le formulaire
     * d'un favori — avant qu'une fenêtre de ticket s'ouvre ; null quand rien ne l'est.
     * Refusé, cela reste ouvert avec son message, et la fenêtre ne s'ouvre pas : elle se
     * ferait enregistrer quand le curseur reviendrait au champ refusé.
     */
    beforeWindowRef?: RefObject<(() => Promise<boolean>) | null>;
}): GridEditing {
    const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
    const [pointerCursor, setPointerCursor] = useState(false);
    /**
     * L'écran rend lui-même le curseur à la grille — un clic, une fenêtre ou un menu qui
     * se ferment : ce n'est pas une arrivée au clavier, même après une touche.
     */
    const givingFocusRef = useRef(false);
    const [ticketWindow, setTicketWindow] = useState<TicketWindow | null>(null);
    const [message, setMessage] = useState<ToastMessage | null>(null);
    const counterRef = useRef(0);
    /** Le message venu de la liste des favoris, affiché en ce moment : son « Annuler » prend Ctrl/⌘+Z. */
    const foreignKeyRef = useRef<number | null>(null);
    /** L'enregistrement de la fenêtre en route, que d'autres gestes attendent. */
    const pendingRef = useRef<Promise<boolean> | null>(null);
    /**
     * La fenêtre qui attend pour s'ouvrir que celle d'avant s'enregistre. Seule la dernière
     * demandée s'ouvre, et ce qu'on tape sur la grille pendant l'attente s'ajoute à son champ
     * Ticket : une lettre ne demande pas une fenêtre de plus, qui effacerait les autres.
     */
    const openingRef = useRef<{
        readonly session: DaySession;
        readonly target: EntryTarget;
        readonly aim: WindowAim;
        draft: EntryDraft | null;
    } | null>(null);
    /**
     * Où le dernier clic droit a ouvert le menu, depuis le bord gauche de la colonne des
     * blocs : « Nouveau ticket… » s'y ouvre. Null quand il s'est ouvert au clavier.
     */
    const menuXRef = useRef<number | null>(null);
    /** Comment la fenêtre ouverte s'est accrochée, et à quels quarts d'heure (placeWindow). */
    const attachmentRef = useRef<{ readonly id: string; readonly attachment: Attachment } | null>(null);
    const windowCheckRef = useRef(NO_CHECK);
    /**
     * Le premier clic de ce qui peut devenir un double-clic est tombé sur la grille. Sinon,
     * le second n'y est pas un geste : le message ou le menu cliqué a disparu sous le
     * pointeur, et ce second clic ne visait pas ce qui est apparu dessous.
     */
    const firstClickOnLaneRef = useRef(false);
    /**
     * Le glisser en cours : le quart d'heure d'où il part, celui qu'il atteint, le ticket
     * du bloc d'où il part, s'il s'en est soulevé vers les favoris, et de quoi l'arrêter.
     */
    const dragRef = useRef<{
        from: number;
        to: number;
        readonly ticket: string | null;
        lifted: boolean;
        readonly stop: () => void;
    } | null>(null);
    const sessionRef = useRef(session);
    const mac = useMemo(() => isMac(navigator.platform), []);

    // Un autre jour : sa sélection, sa fenêtre et son message ne le suivent pas.
    const [shownSession, setShownSession] = useState(session);
    if (shownSession !== session) {
        setShownSession(session);
        setSelection(EMPTY_SELECTION);
        setPointerCursor(false);
        setTicketWindow(null);
        setMessage(null);
    }
    useEffect(() => {
        sessionRef.current = session;
    }, [session]);

    const grid = day?.grid ?? null;
    const next = () => (counterRef.current += 1);

    /** La réponse revient-elle à la journée encore affichée ? */
    const current = (from: DaySession) => sessionRef.current === from;

    const show = (gridMessage: GridMessage | null) => {
        if (gridMessage === null) {
            setMessage(null);

            return;
        }
        setMessage({
            key: next(),
            content:
                gridMessage.ticket === null ? (
                    gridMessage.text
                ) : (
                    <>
                        <b className="font-mono font-semibold whitespace-nowrap">{gridMessage.ticket}</b>{' '}
                        {gridMessage.text}
                    </>
                ),
            action: gridMessage.undo
                ? {
                      label: 'Annuler',
                      title: `Annuler (${shortcutLabel('Z', mac)})`,
                      keyShortcuts: shortcutAria('Z', mac),
                      onAction: () => {
                          rewind('undo');
                      },
                  }
                : undefined,
        });
    };

    /** Le message d'un geste : ce qu'il a fait disparaître, ou pourquoi il n'a rien fait. */
    const report = (outcome: Outcome, gesture: UndoableGesture | null) => {
        if (outcome.kind === 'saved') {
            show(gesture === null ? null : undoMessage(gesture, outcome.step));
        } else {
            show(refusalMessage(outcome));
        }
    };

    /** Un geste sur la grille. Le message du geste d'avant s'en va : son « Annuler » viserait celui-ci. */
    const run = (changes: QuarterChanges, gesture: UndoableGesture | null) => {
        if (session === null || closed) {
            return;
        }
        setMessage(null);
        void session.apply(changes).then((outcome) => {
            if (current(session)) {
                report(outcome, gesture);
            }
        });
    };

    const rewind = (direction: 'undo' | 'redo') => {
        if (session === null || closed) {
            return;
        }
        setMessage(null);
        void (direction === 'undo' ? session.undo() : session.redo()).then((outcome) => {
            if (current(session)) {
                show(refusalMessage(outcome, direction));
            }
        });
    };

    const copy = () => {
        if (session !== null && grid !== null && selectionActions(grid, selection, false).copy) {
            void session.copy(selection);
        }
    };

    const cut = () => {
        if (session === null || closed || grid === null || !selectionActions(grid, selection, false).cut) {
            return;
        }
        setMessage(null);
        void session.cut(selection).then((outcome) => {
            if (current(session)) {
                report(outcome, 'cut');
            }
        });
    };

    const paste = () => {
        if (session === null || closed || selection.quarters.length === 0) {
            return;
        }
        setMessage(null);
        void session.paste(selection).then(({ outcome, pasted }) => {
            if (!current(session)) {
                return;
            }
            if (pasted.length > 0) {
                setSelection(selectQuarters(pasted));
            }
            report(outcome, 'paste');
        });
    };

    const convertToPause = () => {
        if (grid !== null && selectionActions(grid, selection, false).pause) {
            run(fill(selection.quarters, PAUSE), 'pause');
        }
    };

    const clear = () => {
        if (grid !== null && selectionActions(grid, selection, false).clear) {
            run(fill(selection.quarters, null), 'clear');
        }
    };

    // La fenêtre de ticket.

    /**
     * Une fenêtre déjà ouverte s'enregistre d'abord, comme sur un clic à côté : une Entrée
     * ou une lettre tapée sur la grille ne la jettent pas. Refusée, elle reste ouverte avec
     * son message, et l'autre ne s'ouvre pas.
     */
    const openWindow = (target: EntryTarget | null, aim: WindowAim, draft: EntryDraft | null = null) => {
        if (target === null || session === null || closed) {
            return;
        }
        const before = beforeWindowRef?.current ?? null;
        if (ticketWindow === null && before === null) {
            present(target, aim, draft);

            return;
        }
        const opening = { session, target, aim, draft };
        openingRef.current = opening;
        void Promise.all([leaveWindow(), before?.() ?? true]).then(([left, others]) => {
            if (openingRef.current !== opening) {
                return;
            }
            openingRef.current = null;
            if (left && others && current(session)) {
                present(opening.target, opening.aim, opening.draft);
            }
        });
    };

    /**
     * « Modifier la sélection… », ou F2 : la fenêtre s'ouvre là où s'ouvrirait Nouveau
     * ticket, remplie du ticket et du commentaire de la sélection. Sur une sélection qui
     * n'en porte pas qu'un, F2 dit pourquoi rien ne s'ouvre ; le choix du menu, lui, est
     * grisé.
     */
    const editSelection = (aim: WindowAim) => {
        if (grid === null || closed || selection.quarters.length === 0) {
            return;
        }
        const target = partTarget(grid, selection);
        if (target === null) {
            show(PART_REFUSAL);
        } else {
            openWindow(target, aim);
        }
    };

    /** Au clavier, sans pointeur : le milieu de la colonne, et le créneau où s'arrête la sélection. */
    const keyboardAim = (): WindowAim => ({ x: null, quarter: selection.head });

    /**
     * Un autre geste quitte la fenêtre ouverte : elle s'enregistre, comme sur un clic à
     * côté, et un ticket que Jira ne connaît pas la garde ouverte de la même façon. La
     * promesse dit si elle s'est fermée.
     */
    const leaveWindow = (leavingPage = false): Promise<boolean> => {
        if (ticketWindow === null) {
            return Promise.resolve(true);
        }
        if (windowHeld()) {
            setTicketWindow((open) =>
                open === null ? open : { ...open, errors: { ...NO_ERRORS, ticket: TICKET_NOT_FOUND, focus: true } },
            );

            return Promise.resolve(false);
        }

        return write(
            saveEntry(ticketWindow.target, ticketWindow.draft),
            leavingPage ? undefined : windowCheckRef.current.known,
        );
    };

    /**
     * La fenêtre reste ouverte : la sélection revient à ce qu'elle vise, et le glisser que
     * le clic à côté avait commencé s'arrête.
     */
    const keepWindow = (target: EntryTarget, aim: WindowAim) => {
        dragRef.current?.stop();
        if (dragRef.current?.lifted === true) {
            blockDropRef?.current?.cancel();
        }
        dragRef.current = null;
        setSelection(windowSelection(target, aim));
    };

    /**
     * La fenêtre s'ouvre. Le message d'un geste s'en va : la fenêtre pourrait passer
     * dessous, et ce qu'elle va écrire en fera un autre.
     */
    const present = (target: EntryTarget, aimed: WindowAim, draft: EntryDraft | null) => {
        // Nouveau ticket s'accroche à sa sélection, pas à un quart d'heure.
        const aim = target.kind === 'edit' ? aimed : { ...aimed, quarter: null };
        setSelection(windowSelection(target, aim));
        setTicketWindow({
            key: next(),
            target,
            aim,
            draft: draft ?? draftOf(target),
            errors: NO_ERRORS,
            sending: false,
        });
        setMessage(null);
        onWindowOpen();
    };

    /**
     * Une lettre ou un chiffre tapé sur la sélection : Nouveau ticket s'ouvre dessus, la
     * touche écrite dans son champ Ticket, comme dans une cellule de tableur. Tant que la
     * fenêtre attend celle d'avant, les touches suivantes lui reviennent (onListboxKeyDown).
     */
    const typeOnSelection = (key: string) => {
        openWindow(selectionTarget(selection), keyboardAim(), { ticket: typedTicket(key), comment: '' });
    };

    /**
     * Une touche pendant que la fenêtre demandée par une lettre attend celle d'avant : elle
     * lui revient, comme si elle était déjà ouverte — un caractère s'écrit à la suite du
     * ticket, Retour arrière efface le dernier, Échap y renonce —, et aucune autre ne fait
     * rien à la grille entre-temps. Faux s'il n'y a pas de telle fenêtre.
     */
    const typeOnOpening = (event: KeyboardEvent<HTMLElement>): boolean => {
        const opening = openingRef.current;
        if (
            opening?.session !== session ||
            opening.draft === null ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            event.nativeEvent.isComposing
        ) {
            return false;
        }
        const { key } = event;
        const { ticket } = opening.draft;
        if (key === 'Escape') {
            event.preventDefault();
            openingRef.current = null;
        } else if (key === 'Backspace') {
            event.preventDefault();
            opening.draft = { ...opening.draft, ticket: ticket.slice(0, -1) };
        } else if (key.length === 1) {
            event.preventDefault();
            opening.draft = { ...opening.draft, ticket: typedTicket(ticket + key) };
        }

        return true;
    };

    /**
     * Ce que fait la fenêtre ; la promesse dit si elle s'est fermée. Un enregistrement
     * déjà en route n'en lance pas un second : on attend le sien.
     *
     * `known` demande la réponse de Jira sur le ticket tapé, quand il le cherche encore :
     * l'attente compte comme l'envoi. Rien ne se tape, rien ne ferme la fenêtre ni n'en
     * ouvre une autre, et ce qui part est ce que la fenêtre montrait au geste.
     */
    const write = (action: EntryAction, known?: () => Promise<boolean> | undefined): Promise<boolean> => {
        const shown = ticketWindow;
        if (shown === null) {
            return Promise.resolve(true);
        }
        if (shown.sending || pendingRef.current !== null) {
            return pendingRef.current ?? Promise.resolve(false);
        }
        if (session === null) {
            return Promise.resolve(false);
        }
        if (action.kind === 'close') {
            setTicketWindow(null);

            return Promise.resolve(true);
        }
        setMessage(null);
        setTicketWindow({ ...shown, sending: true, errors: NO_ERRORS });
        const pending = (known?.() ?? Promise.resolve(true)).then(async (exists) => {
            if (!exists) {
                // Introuvable : la fenêtre le dit sous le champ, le curseur dedans.
                pendingRef.current = null;
                keepWindow(shown.target, shown.aim);
                setTicketWindow((open) =>
                    open?.key === shown.key
                        ? { ...open, sending: false, errors: { ...NO_ERRORS, ticket: TICKET_NOT_FOUND, focus: true } }
                        : open,
                );

                return false;
            }
            const outcome = await session.apply(action.changes);
            pendingRef.current = null;
            const closed = outcome.kind === 'saved' || outcome.kind === 'unchanged';
            if (!current(session)) {
                return closed;
            }
            if (closed) {
                setTicketWindow((open) => (open?.key === shown.key ? null : open));
                if (outcome.kind === 'saved' && action.gesture !== null) {
                    show(undoMessage(action.gesture, outcome.step));
                }

                return true;
            }
            // La journée a pu être relue : la fenêtre suit son bloc tel qu'il est désormais.
            const target = retarget(session.current().day.grid, shown.target);
            keepWindow(target, shown.aim);
            setTicketWindow((open) =>
                open?.key === shown.key ? { ...open, target, sending: false, errors: errorsOf(outcome) } : open,
            );

            return false;
        });
        pendingRef.current = pending;

        return pending;
    };

    // Le rectangle se calcule quand Radix le mesure, jamais au rendu : la grille a pu
    // défiler depuis.
    const target = ticketWindow?.target ?? null;
    const aim = ticketWindow?.aim ?? null;
    const windowKey = ticketWindow?.key ?? null;
    const placeWindow = useMemo(() => {
        if (target === null || aim === null || windowKey === null) {
            return null;
        }
        const anchored = anchorQuarters(target, aim);
        // Le côté se choisit une fois, quand la fenêtre a sa hauteur : ensuite, elle ne fait
        // plus que suivre son créneau, même quand un refus la change de bloc ou de titre,
        // tant qu'elle vise les mêmes quarts d'heure.
        const id = `${String(windowKey)}:${anchored.join()}`;

        return (height: number) => {
            const lane = laneRef.current;
            if (lane === null) {
                return { rect: new DOMRect(), stopped: false };
            }
            const kept = attachmentRef.current?.id === id ? attachmentRef.current.attachment : null;
            const placed = placeOn(lane, anchored, aim, height, kept);
            if (height > 0 && kept === null) {
                attachmentRef.current = { id, attachment: placed.attachment };
            }

            return placed;
        };
    }, [target, aim, windowKey, laneRef]);

    // Le clavier, au niveau de la page : annuler et rétablir valent partout, sauf dans
    // un champ, qui garde les siens. L'écouteur est posé une fois et lit l'état courant.
    const onPageKeyDown = useEffectEvent((event: globalThis.KeyboardEvent) => {
        if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || editable(event.target)) {
            return;
        }
        const key = event.key.toLowerCase();
        if (key === 'z' && !event.shiftKey && message?.key === foreignKeyRef.current && message.action !== undefined) {
            event.preventDefault();
            setMessage(null);
            message.action.onAction();
        } else if (key === 'z' || key === 'y') {
            event.preventDefault();
            rewind(key === 'y' || event.shiftKey ? 'redo' : 'undo');
        }
    });
    useEffect(() => {
        const listener = (event: globalThis.KeyboardEvent) => {
            onPageKeyDown(event);
        };
        window.addEventListener('keydown', listener);

        return () => {
            window.removeEventListener('keydown', listener);
        };
    }, []);

    // Le glisser : il suit le pointeur jusqu'au relâcher, même hors de la grille, et
    // fait défiler la grille quand il approche de son bord. Ses écouteurs se posent à
    // l'appui, pas au rendu d'après : un geste rapide relâcherait avant eux.
    const dragMove = (clientX: number, clientY: number) => {
        const quarter = quarterAt(laneRef.current, clientY);
        const drag = dragRef.current;
        if (drag !== null) {
            drag.lifted = drag.ticket !== null && blockDropRef?.current?.over(drag.ticket, clientX, clientY) === true;
        }
        if (drag?.lifted === true) {
            // Soulevé, le bloc ne sélectionne plus ce qu'il a traversé : revenu sur la
            // grille, la sélection repart de son quart d'heure.
            if (drag.to !== drag.from) {
                drag.to = drag.from;
                setSelection(selectQuarter(drag.from));
            }

            return;
        }
        if (quarter === null || drag === null || quarter === drag.to) {
            return;
        }
        drag.to = quarter;
        setSelection(extendTo(selectQuarter(drag.from), quarter));
    };
    // Le relâcher n'ouvre rien : le glisser ne fait que sélectionner, sur des créneaux vides
    // comme sur des blocs, que quelque chose soit copié ou non, comme dans un tableur.
    // Ctrl/⌘+V colle alors sur la plage ; une lettre, Entrée ou « Nouveau ticket… » y
    // ouvrent Nouveau ticket.
    const dragEnd = (clientX: number, clientY: number) => {
        const drag = dragRef.current;
        dragRef.current = null;
        if (drag?.ticket != null && blockDropRef?.current?.drop(drag.ticket, clientX, clientY) === true) {
            // Le bloc soulevé est parti dans la liste, ou nulle part : la grille ne garde en
            // sélection que le quart d'heure d'où il est parti.
            setSelection(selectQuarter(drag.from));
        }
    };
    const dragHandlersRef = useRef({ move: dragMove, end: dragEnd });
    useLayoutEffect(() => {
        dragHandlersRef.current = { move: dragMove, end: dragEnd };
    });
    useEffect(
        () => () => {
            dragRef.current?.stop();
        },
        [],
    );
    useEffect(() => {
        const listener = (event: globalThis.MouseEvent) => {
            if (event.detail <= 1) {
                firstClickOnLaneRef.current =
                    event.target instanceof Node && laneRef.current?.contains(event.target) === true;
            }
        };
        window.addEventListener('mousedown', listener, true);

        return () => {
            window.removeEventListener('mousedown', listener, true);
        };
    }, [laneRef]);

    /** @param startY où le pointeur a appuyé, dans la fenêtre du navigateur */
    const startDrag = (quarter: number, startY: number) => {
        dragRef.current?.stop();
        let pointerX = 0;
        let pointerY: number | null = null;
        let frame = 0;
        const onMove = (event: globalThis.MouseEvent) => {
            pointerX = event.clientX;
            pointerY = event.clientY;
            dragHandlersRef.current.move(pointerX, pointerY);
        };
        const onUp = (event: globalThis.MouseEvent) => {
            stop();
            dragHandlersRef.current.end(event.clientX, event.clientY);
        };
        // Échap abandonne le glisser, soulevé ou non, sans rien poser, comme un favori qu'on
        // glisse : la grille ne garde en sélection que son quart d'heure de départ. Il ne ferme
        // qu'une chose à la fois : écouté sur la fenêtre du navigateur, avant la fenêtre de
        // ticket restée ouverte, il ne lui parvient pas, et elle garde sa saisie.
        const onKey = (event: globalThis.KeyboardEvent) => {
            const drag = dragRef.current;
            if (event.key !== 'Escape' || drag === null) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            stop();
            dragRef.current = null;
            setSelection(selectQuarter(drag.from));
            blockDropRef?.current?.cancel();
        };
        const scroll = () => {
            const lane = laneRef.current;
            const scroller = lane?.closest('[role="region"]');
            if (scroller instanceof HTMLElement && lane !== null && pointerY !== null) {
                const { top, bottom } = scroller.getBoundingClientRect();
                const edge = (lane.getBoundingClientRect().height / Quarter.COUNT) * 2;
                const inside = pointerX >= scroller.getBoundingClientRect().left;
                // Un bord ne fait défiler que vers où le pointeur est allé depuis l'appui :
                // parti de la dernière ligne visible, un glisser qui remonte ne fait pas
                // descendre la grille sous lui, ni sa sélection avec elle.
                const up = pointerY < top + edge && pointerY < startY;
                const down = pointerY > bottom - edge && pointerY > startY;
                if (inside && (up || down)) {
                    scroller.scrollTop += (up ? -edge : edge) / 8;
                    dragHandlersRef.current.move(pointerX, pointerY);
                }
            }
            frame = requestAnimationFrame(scroll);
        };
        const stop = () => {
            cancelAnimationFrame(frame);
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            window.removeEventListener('keydown', onKey, true);
        };
        const content = grid?.at(quarter) ?? null;
        dragRef.current = {
            from: quarter,
            to: quarter,
            ticket: content?.kind === 'work' ? content.ticket : null,
            lifted: false,
            stop,
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        window.addEventListener('keydown', onKey, true);
        frame = requestAnimationFrame(scroll);
    };

    const focusGrid = () => {
        // Fermée à la saisie, la grille ne prend pas le curseur (GridEditing.closed).
        if (closed) {
            return;
        }
        givingFocusRef.current = true;
        listboxRef.current?.focus({ preventScroll: true });
        givingFocusRef.current = false;
    };

    /** Le clavier commence au premier quart d'heure entier en haut de la vue. */
    const keyboardStart = (): Selection => {
        const top = Math.ceil(visibleTop() / Quarter.MINUTES) * Quarter.MINUTES;

        return selectQuarter(Math.min(Math.max(top, Quarter.FIRST), Quarter.LAST));
    };

    const reveal = (quarter: number | null) => {
        if (quarter !== null) {
            document.getElementById(optionId(quarter))?.scrollIntoView({ block: 'nearest' });
        }
    };

    /**
     * Un ticket que Jira ne connaît pas garde la fenêtre ouverte, même au clic à côté : ce
     * clic ne déplace rien, et la sélection reste sur ce qu'elle vise. Tout autre refus
     * n'arrive qu'à la réponse du serveur, et la ramène là (keepWindow).
     */
    const windowHeld = () =>
        ticketWindow !== null && windowCheckRef.current.refused && !ticketWindow.sending && pendingRef.current === null;

    const replaced = ticketWindow === null || grid === null ? null : replacedBy(grid, ticketWindow.target);
    const part = ticketWindow?.target.kind === 'part' ? ticketWindow.target : null;

    return {
        selection,
        pointerCursor,
        window: ticketWindow,
        closed,
        windowNote:
            part !== null
                ? part.beyond
                    ? partNote(part.content.ticket, part.quarters.length)
                    : null
                : ticketWindow === null || replaced === null
                  ? null
                  : replaceNote(replaced, quartersOf(ticketWindow.target).length),
        message,
        placeWindow,
        windowCheckRef,
        mac,
        dismissMessage: () => {
            setMessage(null);
        },
        onLaneMouseDown: (event) => {
            const quarter = quarterAt(laneRef.current, event.clientY);
            if (event.button !== 0 || quarter === null || grid === null || closed) {
                return;
            }
            // Ni sélection de texte, ni focus volé par un bloc : le curseur va à la grille.
            event.preventDefault();
            if ((event.detail > 1 && !firstClickOnLaneRef.current) || windowHeld()) {
                return;
            }
            focusGrid();
            setPointerCursor(true);
            if (event.shiftKey) {
                setSelection((shown) => extendTo(shown, quarter));
            } else if (event.ctrlKey || event.metaKey) {
                setSelection((shown) => toggleQuarter(shown, quarter));
            } else {
                setSelection(selectQuarter(quarter));
                startDrag(quarter, event.clientY);
            }
        },
        onLaneDoubleClick: (event) => {
            const quarter = quarterAt(laneRef.current, event.clientY);
            if (quarter !== null && grid !== null && !closed && firstClickOnLaneRef.current) {
                openWindow(targetAt(grid, quarter), { x: laneX(laneRef.current, event.clientX), quarter });
            }
        },
        onLaneContextMenu: (event) => {
            // Le menu du clavier est déjà ouvert sur le créneau sélectionné (touche Menu,
            // Maj+F10). Le navigateur peut envoyer le sien au relâchement, posé sur la liste
            // entière : il viserait un autre créneau, et on l'ignore.
            if (fromKeyboard(event.nativeEvent)) {
                event.preventDefault();

                return;
            }
            if (closed) {
                event.preventDefault();

                return;
            }
            // Retenue, la fenêtre garde la sélection : un menu viserait autre chose que le
            // créneau sous le pointeur.
            if (windowHeld()) {
                event.preventDefault();

                return;
            }
            const quarter = quarterAt(laneRef.current, event.clientY);
            // Le menu se pose au pointeur, et « Nouveau ticket… » s'ouvre là où il était.
            // Ouvert au clavier, il n'en a pas : la fenêtre prend le milieu de la colonne.
            menuXRef.current = event.nativeEvent.isTrusted ? laneX(laneRef.current, event.clientX) : null;
            // Un clic droit hors de la sélection la remplace, comme dans un tableur. Le menu
            // ouvert au clavier (touche Menu, Maj+F10) arrive ici aussi, sans être de confiance.
            if (quarter !== null && !selection.quarters.includes(quarter)) {
                setSelection(selectQuarter(quarter));
                setPointerCursor(event.nativeEvent.isTrusted);
            }
        },
        onListboxFocus: () => {
            // Le curseur arrive au clavier, par Tab : il compte comme venu du clavier, et sur
            // une grille sans sélection, il s'y montre là où il était resté, sinon en haut de
            // la vue. Rendu par l'écran, il garde d'où venait sa sélection.
            if (givingFocusRef.current || listboxRef.current?.matches(':focus-visible') !== true) {
                return;
            }
            setPointerCursor(false);
            if (selection.quarters.length === 0) {
                setSelection(selection.head === null ? keyboardStart() : selectQuarter(selection.head));
            }
        },
        onListboxKeyDown: (event) => {
            if (grid === null || closed || typeOnOpening(event)) {
                return;
            }
            const key = event.key;
            const command = event.ctrlKey || event.metaKey;
            if (key === 'ArrowUp' || key === 'ArrowDown') {
                event.preventDefault();
                setPointerCursor(false);
                const moved =
                    selection.head === null
                        ? keyboardStart()
                        : moveSelection(selection, key === 'ArrowUp' ? -1 : 1, event.shiftKey);
                setSelection(moved);
                reveal(moved.head);
            } else if (key === 'Enter' && !command) {
                event.preventDefault();
                if (!event.repeat) {
                    const target = targetOfSelection(grid, selection);
                    // La fenêtre refusée vise déjà cette sélection : Entrée l'enregistre de
                    // nouveau, sans en rouvrir une sur ce qu'elle vient d'écrire.
                    if (ticketWindow !== null && target !== null && sameQuarters(target, ticketWindow.target)) {
                        void leaveWindow();
                    } else {
                        openWindow(target, keyboardAim());
                    }
                }
            } else if (key === 'F2' && !command && !event.altKey && !event.shiftKey) {
                event.preventDefault();
                if (!event.repeat) {
                    editSelection(keyboardAim());
                }
            } else if (key === 'Delete' || key === 'Backspace') {
                event.preventDefault();
                clear();
            } else if (key === 'ContextMenu' || (key === 'F10' && event.shiftKey)) {
                // Le menu du clavier s'ouvre sur le créneau où la sélection s'arrête, pas
                // là où le navigateur le poserait.
                event.preventDefault();
                openMenuAt(laneRef.current, listboxRef.current, selection.head);
            } else if (command && !event.altKey) {
                const letter = key.toLowerCase();
                if (letter === 'c' || letter === 'x' || letter === 'v') {
                    event.preventDefault();
                    ({ c: copy, x: cut, v: paste })[letter]();
                }
            } else if (typed(event.nativeEvent)) {
                // La touche s'écrit dans la fenêtre, pas une seconde fois dans le champ
                // qui prend le curseur.
                event.preventDefault();
                typeOnSelection(key);
            }
        },
        actions: () =>
            grid === null || closed ? NO_ACTIONS : selectionActions(grid, selection, session?.hasClipboard() ?? false),
        newTicket: () => {
            openWindow(selectionTarget(selection), { x: menuXRef.current, quarter: selection.head });
        },
        editSelection: () => {
            editSelection({ x: menuXRef.current, quarter: selection.head });
        },
        copy,
        cut,
        paste,
        convertToPause,
        clear,
        setDraft: (draft) => {
            // Taper dans un champ refusé efface son refus : il se redira au départ du
            // champ, ou au prochain enregistrement.
            setTicketWindow((open) =>
                open === null || open.sending
                    ? open
                    : {
                          ...open,
                          draft,
                          errors: {
                              ...open.errors,
                              ticket: draft.ticket === open.draft.ticket ? open.errors.ticket : null,
                              comment: draft.comment === open.draft.comment ? open.errors.comment : null,
                              focus: false,
                          },
                      },
            );
        },
        checkTicket: () => {
            setTicketWindow((open) =>
                open === null || open.sending || hasTicketShape(open.draft.ticket)
                    ? open
                    : { ...open, errors: { ...open.errors, ticket: TICKET_SHAPE_REFUSAL, focus: false } },
            );
        },
        saveWindow: (known) => {
            if (ticketWindow !== null) {
                void write(saveEntry(ticketWindow.target, ticketWindow.draft), known);
            }
        },
        flushWindow: leaveWindow,
        unsavedWindow: () => {
            if (ticketWindow === null) {
                return false;
            }
            const shown = draftOf(ticketWindow.target);

            return ticketWindow.draft.ticket !== shown.ticket || ticketWindow.draft.comment !== shown.comment;
        },
        cancelWindow: () => {
            if (ticketWindow?.sending === false) {
                setTicketWindow(null);
            }
        },
        pauseWindow: () => {
            if (ticketWindow !== null) {
                void write(pauseEntry(ticketWindow.target));
            }
        },
        deleteWindow: () => {
            if (ticketWindow !== null) {
                void write(deleteEntry(ticketWindow.target));
            }
        },
        focusGrid,
        deselect: () => {
            if (selection.quarters.length === 0) {
                return false;
            }
            setSelection(deselect(selection));

            return true;
        },
        notify: (shown) => {
            const key = next();
            foreignKeyRef.current = key;
            setMessage(shown === null ? null : { ...shown, key });
        },
        copyTicket: (ticket) => {
            if (session === null) {
                return;
            }
            setMessage(null);
            void session.copyContent(work(ticket)).then(() => {
                if (current(session)) {
                    show({ ticket, text: 'copié', undo: false });
                }
            });
        },
        dropTicket: (ticket, quarter) => {
            if (session === null || grid === null || closed) {
                return;
            }
            // Comme un clic à côté : la fenêtre ouverte s'enregistre d'abord. Refusée, elle
            // reste ouverte avec son message, et le favori n'est pas posé.
            void leaveWindow().then((closed) => {
                if (!closed || !current(session)) {
                    return;
                }
                setSelection(selectQuarter(quarter));
                run(dropTicket(ticket, quarter), 'replace');
            });
        },
    };
}

/** Tant que la journée n'est pas lue, le menu ne propose rien. */
const NO_ACTIONS: SelectionActions = {
    entry: false,
    edit: false,
    copy: false,
    cut: false,
    paste: false,
    pause: false,
    clear: false,
    favorite: null,
};

/** L'identifiant de l'option d'un quart d'heure dans la liste des créneaux. */
export function optionId(quarter: number): string {
    return `creneau-${Quarter.format(quarter).replace(':', '')}`;
}

/** Le quart d'heure sous le pointeur, au plus près de la grille quand il en sort par le haut ou le bas. */
export function quarterAt(lane: HTMLElement | null, clientY: number): number | null {
    if (lane === null) {
        return null;
    }
    const { top, height } = lane.getBoundingClientRect();
    if (height === 0) {
        return null;
    }
    const index = Math.floor(((clientY - top) / height) * Quarter.COUNT);

    return Quarter.FIRST + Math.min(Math.max(index, 0), Quarter.COUNT - 1) * Quarter.MINUTES;
}

/** L'horizontale d'un pointeur, depuis le bord gauche de la colonne des blocs. */
function laneX(lane: HTMLElement | null, clientX: number): number | null {
    return lane === null ? null : clientX - lane.getBoundingClientRect().left;
}

/**
 * Où la fenêtre de ticket s'accroche, dans la partie visible de la grille
 * (windowPlacement.ts) :
 * - Nouveau ticket, au-dessus du créneau visé ou de la sélection, et dessous faute de place ;
 * - Modifier le ticket, sous le quart d'heure visé, et au-dessus faute de place : le haut
 *   du bloc, identifiant et titre, reste visible. Nouveau ticket qui prend sa place après
 *   un refus reste au même endroit.
 *
 * En largeur, les deux se centrent sur le pointeur, leur flèche au pointeur, sans sortir
 * de la colonne des blocs. Elles suivent leur créneau quand la grille défile, et s'arrêtent
 * au bord qu'il a passé.
 *
 * Radix centre la flèche sur le rectangle rendu, et aligne la fenêtre sur son bord gauche
 * (TicketWindow, align « start ») : il part du bord gauche de la fenêtre, et son milieu
 * est l'horizontale que la flèche désigne.
 *
 * @param anchored   les quarts d'heure auxquels elle s'accroche (anchorQuarters)
 * @param height     la hauteur de la fenêtre
 * @param attachment comment elle s'est accrochée, si elle l'a déjà fait
 */
function placeOn(
    lane: HTMLElement,
    anchored: readonly number[],
    aim: WindowAim,
    height: number,
    attachment: Attachment | null,
): PlacedWindow & { readonly attachment: Attachment } {
    const rect = lane.getBoundingClientRect();
    const row = rect.height / Quarter.COUNT;
    const y = (quarter: number) => rect.top + ((quarter - Quarter.FIRST) / Quarter.MINUTES) * row;
    const frame = lane.closest('[role="region"]')?.getBoundingClientRect() ?? rect;
    const view = { top: Math.max(frame.top, 0), bottom: Math.min(frame.bottom, window.innerHeight) };
    const margin = tokenPixels('--s-2');
    const room: Room = { height, gap: tokenPixels('--s-3'), margin };
    const runs = selectionRuns(selectQuarters(anchored)).map(({ start, end }) => ({ top: y(start), bottom: y(end) }));
    const attached = attachment ?? attachWindow(runs, view, room, row, aim.quarter === null ? 'above' : 'below');
    const { span, stopped } = windowAnchor(runs, view, room, row, attached);
    // Le bord de la colonne n'en fait pas partie : la fenêtre s'aligne sur les blocs.
    const inside = rect.left + lane.clientLeft;
    const { left, arrow } = across(
        aim.x === null ? null : rect.left + aim.x,
        { left: inside, right: inside + lane.clientWidth },
        tokenPixels('--w-pop'),
        margin,
        // La flèche, large de --s-4, à --s-3 au moins des bords de la fenêtre.
        tokenPixels('--s-3') + tokenPixels('--s-4') / 2,
    );

    return {
        rect: new DOMRect(left, span.top, (arrow - left) * 2, span.bottom - span.top),
        stopped,
        attachment: attached,
    };
}

/**
 * Les quarts d'heure auxquels la fenêtre s'accroche : le quart d'heure visé de son bloc,
 * ouverte en Modifier le ticket, même devenue Nouveau ticket après un refus ; sa sélection
 * sinon.
 */
function anchorQuarters(target: EntryTarget, aim: WindowAim): readonly number[] {
    const quarters = quartersOf(target);
    const aimed = aim.quarter === null ? undefined : aimedQuarter(quarters, aim.quarter);

    return aimed === undefined ? quarters : [aimed];
}

/**
 * La sélection d'une fenêtre ouverte : ses quarts d'heure, arrêtée sur celui que vise
 * Modifier le ticket. Entrée la rouvre donc au même endroit, et les flèches en repartent.
 */
function windowSelection(target: EntryTarget, aim: WindowAim): Selection {
    const head = aim.quarter === null ? null : (anchorQuarters(target, aim)[0] ?? null);

    return selectQuarters(quartersOf(target), head);
}

function sameQuarters(a: EntryTarget, b: EntryTarget): boolean {
    return quartersOf(a).join() === quartersOf(b).join();
}

/** Ouvre le menu du clic droit sur un quart d'heure, comme si on l'y avait demandé à la souris. */
function openMenuAt(lane: HTMLElement | null, from: HTMLElement | null, quarter: number | null): void {
    if (lane === null || from === null || quarter === null) {
        return;
    }
    const rect = lane.getBoundingClientRect();
    const row = rect.height / Quarter.COUNT;
    const y = rect.top + ((quarter - Quarter.FIRST) / Quarter.MINUTES + 1) * row;
    from.dispatchEvent(
        new globalThis.MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + row * 2,
            clientY: y,
        }),
    );
}

/**
 * Un clic droit demandé au clavier par le navigateur : un événement de pointeur sans
 * pointeur. Celui que la grille envoie elle-même n'est pas « de confiance ».
 */
function fromKeyboard(event: globalThis.MouseEvent): boolean {
    return event.isTrusted && event instanceof PointerEvent && event.pointerType === '';
}

/**
 * Une lettre ou un chiffre tapé seul : il ouvre Nouveau ticket. Pas un raccourci, ni une
 * touche morte en cours de composition, ni ce qu'Option ou AltGr ajoutent à une lettre.
 */
function typed(event: globalThis.KeyboardEvent): boolean {
    return !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing && /^[\p{L}\p{N}]$/u.test(event.key);
}

/** Un champ où l'on tape, ou une fenêtre : Ctrl/⌘+Z y défait la frappe, pas la grille. */
function editable(target: EventTarget | null): boolean {
    return (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            target.closest('[role="dialog"]') !== null)
    );
}

function errorsOf(outcome: Outcome): WindowErrors {
    if (outcome.kind !== 'invalid') {
        return { ...NO_ERRORS, general: windowRefusal(outcome) };
    }
    const field = (name: string) =>
        outcome.violations.find((violation) => violation.field.endsWith(`.${name}`) || violation.field === name)
            ?.message ?? null;
    const ticket = field('ticket');
    const comment = field('comment');

    return {
        ticket,
        comment,
        general: ticket === null && comment === null ? (outcome.violations[0]?.message ?? null) : null,
        focus: true,
    };
}
