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

import { fromKeyboard, openMenuAt } from '../components/keyboardMenu';
import type { ToastMessage } from '../components/Toast';
import { tokenPixels } from '../components/tokenPixels';
import { selectionActions, type SelectionActions } from '../grid/actions';
import { fill, type QuarterChanges } from '../grid/changes';
import { paste as pasteOn } from '../grid/clipboard';
import type { DayState } from '../grid/day';
import type { DaySession, Outcome } from '../grid/daySession';
import {
    deleteEntry,
    draftOf,
    type EntryAction,
    type EntryDraft,
    type EntryTarget,
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
import { type Grid, normalizeTicket, PAUSE, sameCell, work } from '../grid/grid';
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
import { NO_CHECK, type TicketCheck } from '../jira/useTicketLookup';
import { quarterTop } from './columnGeometry';
import { measureColumn, pointedQuarter } from './columnMeasure';
import {
    elsewhereRefusal,
    type GridMessage,
    PART_REFUSAL,
    partNote,
    refusalMessage,
    replaceNote,
    type UndoableGesture,
    undoMessage,
    windowRefusal,
} from './messages';
import { startPointerDrag } from './pointerDrag';
import {
    eraseAction,
    initialRecurrence,
    recurrenceAction,
    recurrenceChanged,
    type RecurrenceDraft,
    gestureExtension,
    seenAgain,
    selectionCut,
    selectionErase,
    selectionShorten,
} from './recurrenceDraft';
import { GRID_SHORTCUTS, isMac, PAGE_SHORTCUTS, shortcutKeys, shortcutLabel, shortcutOf } from './shortcuts';
import { shapeRefusal, TicketSave } from './ticketSave';
import {
    across,
    aimedQuarter,
    type Attachment,
    attachWindow,
    reattachWindow,
    type Room,
    type Span,
    windowAnchor,
} from './windowPlacement';

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
    /** La case « Récurrence » réglée ; absente, elle est telle qu'à l'ouverture (initialRecurrence). */
    readonly recurrence?: RecurrenceDraft;
    /** La question « quelles fois », qui a pris la place de ses champs ; absente, elle les montre. */
    readonly question?: WindowQuestion;
}

/**
 * Quelles fois change un geste sur un bloc qui revient : « Cette fois seulement », choisi
 * d'avance, ou « Cette fois et les suivantes ». Entrée et un clic à côté valident le choix,
 * comme dans toute fenêtre.
 */
export interface WindowQuestion {
    readonly action: AskAction;
    readonly choice: ScopeChoice;
    /**
     * Posée par la fenêtre du ticket — Enregistrer, la corbeille — : Retour la rend telle qu'on
     * l'a laissée. Posée par la grille — Suppr, Effacer du menu — : Annuler ferme.
     */
    readonly back: boolean;
}

export type ScopeChoice = 'once' | 'following';

type AskAction = Extract<EntryAction, { readonly kind: 'ask' }>;

/** La question qu'une fenêtre qui s'ouvre pose d'emblée, jugée sur la journée enregistrée : Suppr. */
type Asked = (day: DayState) => { readonly target: EntryTarget; readonly action: AskAction } | null;

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
    /** Sous « Jours » et « Jusqu'au » de la récurrence. */
    readonly weekdays: string | null;
    readonly until: string | null;
    /**
     * Sous ses prochaines fois : un créneau qu'une autre récurrence prend déjà. La fenêtre le
     * dit d'elle-même tant qu'elle la connaît ; celui-ci vient d'Enregistrer, ou du serveur.
     */
    readonly rhythm: string | null;
    /** Ce qui ne tient à aucun champ : la journée changée ailleurs, le serveur muet. */
    readonly general: string | null;
    /** Un enregistrement vient d'être refusé : le curseur va au champ refusé. */
    readonly focus: boolean;
}

const NO_ERRORS: WindowErrors = {
    ticket: null,
    comment: null,
    weekdays: null,
    until: null,
    rhythm: null,
    general: null,
    focus: false,
};

/** Ce que dit la fenêtre quand la journée a changé là où elle écrit. */
const STALE_REFUSAL = windowRefusal({ kind: 'stale' });

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
     * déposé, ni annulation. Copier un favori reste possible : ce n'est pas écrire. Fermée
     * sous le curseur, elle garde annuler et rétablir pour les gestes qu'on vient d'y faire :
     * le message de l'un d'eux garde son « Annuler ».
     */
    readonly closed: boolean;
    /**
     * Ce que la fenêtre dit sous ses champs : ce que Nouveau ticket remplacera, « Remplace
     * SHOP-482 sur ces 30 minutes. », ou la partie de bloc que Modifier la sélection
     * modifie, « Modifie SHOP-482 sur ces 45 minutes seulement. ».
     */
    readonly windowNote: string | null;
    /** La case « Récurrence » de la fenêtre, telle qu'elle est réglée ; null quand la fenêtre n'en a pas. */
    readonly windowRecurrence: RecurrenceDraft | null;
    readonly setRecurrence: (draft: RecurrenceDraft) => void;
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
    readonly onListboxBlur: () => void;
    /** Ce que le menu propose, lu à son ouverture. */
    readonly actions: () => SelectionActions;
    /** « Nouveau ticket… » : la fenêtre s'ouvre sur la sélection exacte. */
    readonly newTicket: () => void;
    /** « Modifier la sélection… » : la fenêtre s'ouvre sur la sélection exacte, déjà remplie. */
    readonly editSelection: () => void;
    readonly copy: () => void;
    /** Couper la sélection ; vrai s'il ouvre la question « Couper une récurrence », qui prend le curseur. */
    readonly cut: () => boolean;
    /** Coller ; vrai s'il ouvre la question « Allonger une récurrence », qui prend le curseur. */
    readonly paste: () => boolean;
    readonly convertToPause: () => void;
    /** Effacer la sélection ; vrai s'il ouvre la question « quelles fois », qui prend le curseur. */
    readonly clear: () => boolean;
    readonly setDraft: (draft: EntryDraft) => void;
    /** On quitte le champ Ticket : une forme refusée se dit là, jamais pendant la frappe. */
    readonly checkTicket: () => void;
    /**
     * Enregistre la fenêtre, comme Entrée. `check` dit ce que Jira sait du ticket tapé : quand
     * il le cherche encore, l'enregistrement attend sa réponse, fenêtre en envoi, et ne part
     * pas si le ticket est introuvable (ticketSave.ts).
     */
    readonly saveWindow: (check: TicketCheck) => void;
    /**
     * La croix, Échap, Annuler. La question posée par la fenêtre du ticket rend ses champs,
     * tels qu'on les a laissés ; sinon, la fenêtre se ferme.
     */
    readonly cancelWindow: () => void;
    /** Un choix de la question « quelles fois ». */
    readonly chooseScope: (choice: ScopeChoice) => void;
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
     * Un message venu d'à côté de la grille — la liste des favoris, l'envoi sur Jira —, au
     * même endroit. Son « Annuler », s'il en a un, fait `undo`, et prend Ctrl/⌘+Z tant qu'il
     * est affiché : un geste qui n'est pas de la grille ne doit pas laisser ce raccourci
     * défaire la grille en silence.
     *
     * @param returnFocus où rendre le curseur quand le message part sous lui, si ce n'est pas
     *                    à la grille
     */
    readonly notify: (message: GridMessage | null, undo?: () => void, returnFocus?: () => void) => void;
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
    /** Sa hauteur au plus, quand elle a grandi au-dessus de son créneau (windowAnchor) ; null sinon. */
    readonly maxHeight: number | null;
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
 * de jour ne touche plus la grille, et seul un refus s'y dit encore, en message.
 */
export function useGridEditing({
    session,
    day,
    laneRef,
    scrollerRef,
    listboxRef,
    visibleTop,
    onWindowOpen,
    blockDropRef,
    beforeWindowRef,
    closed = false,
    today,
    openingDay = null,
}: {
    session: DaySession | null;
    day: DayState | null;
    /**
     * Le jour qui s'ouvre, tant qu'il se lit : on y sélectionne déjà, et ce qu'on y fait
     * attend qu'il soit lu (awaitingRef). Null une fois lu, ou si sa lecture a échoué.
     */
    openingDay?: string | null;
    /** La grille est fermée à la saisie : voir GridEditing.closed. */
    closed?: boolean;
    /** « AAAA-MM-JJ » : un bloc qui revient d'un jour passé n'a pas de case « Récurrence ». */
    today: string;
    /** La colonne des blocs : le pointeur s'y lit en quarts d'heure. */
    laneRef: RefObject<HTMLElement | null>;
    /**
     * La zone qui fait défiler la grille : un glisser la fait défiler près de ses bords, et
     * la fenêtre de ticket reste dans ce qu'elle montre.
     */
    scrollerRef: RefObject<HTMLElement | null>;
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
    /**
     * La page a perdu le focus pendant que la grille l'avait — un autre onglet, une autre
     * application : le navigateur le lui rendra au retour, et personne n'aura tapé Tab.
     * Rendu ailleurs, ou suivi d'une frappe ou d'un appui, ce retour n'est plus à attendre.
     */
    const pageLeftRef = useRef(false);
    /**
     * Le dernier geste venait du clavier. Une fenêtre ou un menu fermés par Échap ou Entrée
     * rendent le curseur à la grille et le montrent, s'il était dans la vue quand la grille a
     * perdu le focus (cursorShownRef) : la grille a pu défiler pendant qu'ils étaient ouverts.
     * Fermés d'un clic, ou sur un curseur déjà hors de vue, la grille ne bouge pas.
     */
    const keyboardLastRef = useRef(false);
    const cursorShownRef = useRef(false);
    useEffect(() => {
        const onKey = () => {
            keyboardLastRef.current = true;
            pageLeftRef.current = false;
        };
        const onPointer = () => {
            keyboardLastRef.current = false;
            pageLeftRef.current = false;
        };
        const onFocusIn = (event: globalThis.FocusEvent) => {
            if (event.target !== listboxRef.current) {
                pageLeftRef.current = false;
            }
        };
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('pointerdown', onPointer, true);
        window.addEventListener('focusin', onFocusIn, true);

        return () => {
            window.removeEventListener('keydown', onKey, true);
            window.removeEventListener('pointerdown', onPointer, true);
            window.removeEventListener('focusin', onFocusIn, true);
        };
    }, [listboxRef]);

    /** Le créneau du curseur, celui que la liste désigne, tel que l'écran l'affiche déjà. */
    const cursorOption = (): HTMLElement | null => {
        const id = listboxRef.current?.getAttribute('aria-activedescendant');

        return id === null || id === undefined ? null : document.getElementById(id);
    };
    const [ticketWindow, setTicketWindow] = useState<TicketWindow | null>(null);
    const [message, setMessage] = useState<ToastMessage | null>(null);
    const counterRef = useRef(0);
    /** Le message venu de la liste des favoris, affiché en ce moment : son « Annuler » prend Ctrl/⌘+Z. */
    const foreignKeyRef = useRef<number | null>(null);
    /** L'enregistrement de la fenêtre : un seul à la fois, que d'autres gestes attendent. */
    const [save] = useState(() => new TicketSave());
    /**
     * La fenêtre qui attend pour s'ouvrir que celle d'avant s'enregistre, et les gestes d'avant
     * avec elle. Seule la dernière demandée s'ouvre, sur la journée telle qu'ils l'ont laissée,
     * et ce qu'on tape sur la grille pendant l'attente s'ajoute à son champ Ticket : une lettre
     * ne demande pas une fenêtre de plus, qui effacerait les autres. Un appui sur la grille y
     * renonce : elle viserait autre chose que ce qu'il sélectionne.
     */
    const openingRef = useRef<{
        readonly session: DaySession;
        readonly aimAt: (grid: Grid) => EntryTarget | null;
        readonly aim: WindowAim;
        readonly none: (() => void) | null;
        readonly asked: Asked | null;
        draft: EntryDraft | null;
    } | null>(null);
    /**
     * Où le dernier clic droit a ouvert le menu, depuis le bord gauche de la colonne des
     * blocs : « Nouveau ticket… » s'y ouvre. Null quand il s'est ouvert au clavier.
     */
    const menuXRef = useRef<number | null>(null);
    /**
     * Le menu demandé d'un clic droit pendant qu'une fenêtre s'enregistre : il s'ouvre une fois
     * qu'elle s'est fermée, sauf si un autre geste a été demandé entre-temps — un appui ou une
     * touche sur la grille, une fenêtre, un geste qui écrit, un favori déposé. Le dernier
     * demandé l'emporte, comme pour les fenêtres (openingRef), et un menu qui s'ouvre renonce
     * à la fenêtre qui attendait.
     */
    const menuWaitRef = useRef<object | null>(null);
    /** Le menu qu'on rejoue, une fois la fenêtre fermée, avec ce qu'en disait le clic droit. */
    const menuReplayRef = useRef<{
        readonly x: number | null;
        readonly trusted: boolean;
        readonly quarter: number | null;
    } | null>(null);
    /**
     * Le créneau que vise le menu ouvert au clavier : celui où s'arrête la sélection. Il se
     * pose au bas de ce créneau, à la frontière du suivant, et le pointeur qu'il simule ne
     * dit pas lequel des deux il désigne.
     */
    const keyboardMenuRef = useRef<number | null>(null);
    /** Comment la fenêtre ouverte s'est accrochée, à quels quarts d'heure, et sur quelle mesure (placeWindow). */
    const attachmentRef = useRef<({ readonly id: string } & Measured) | null>(null);
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
    /**
     * Annuler ou rétablir, tels que l'écran est au dernier rendu : le message d'un geste
     * survit aux rendus, et son « Annuler » ne doit pas voir la fenêtre qu'il y avait
     * quand il est né.
     */
    const rewindRef = useRef<(direction: 'undo' | 'redo') => void>(() => undefined);
    /**
     * Le dernier geste parti qui peut changer la grille. Le message d'un geste ne propose
     * « Annuler » que si aucun autre n'est parti depuis : cet « Annuler » défait le dernier
     * geste de la file, qui serait l'autre.
     */
    const turnRef = useRef(0);
    const sessionRef = useRef(session);
    const mac = useMemo(() => isMac(navigator.platform), []);

    // Un autre jour : sa sélection, sa fenêtre et son message ne le suivent pas. Ce qui s'est
    // fait pendant qu'il s'ouvrait est à lui : la sélection qu'on y a faite, et le refus revenu
    // d'un autre jour qu'on y a dit (elsewhere), restent quand il arrive.
    const [shownSession, setShownSession] = useState(session);
    const [shownOpening, setShownOpening] = useState(openingDay);
    if (shownSession !== session || shownOpening !== openingDay) {
        const arrived = shownSession === null && session !== null && shownOpening === session.date;
        setShownSession(session);
        setShownOpening(openingDay);
        if (!arrived) {
            setSelection(EMPTY_SELECTION);
            setPointerCursor(false);
            setMessage(null);
        }
        setTicketWindow(null);
    }
    // La journée affichée a été ouverte à la saisie pendant cette visite : fermée ensuite sous
    // le curseur, elle garde annuler et rétablir (rewind). Une autre visite repart sans.
    const [openedHere, setOpenedHere] = useState<DaySession | null>(null);
    if (session !== null && !closed && openedHere !== session) {
        setOpenedHere(session);
    }
    // La journée relue sous la fenêtre de ticket ouverte — au retour sur la page, ou pendant
    // qu'un autre onglet l'envoie — a pu changer là où elle écrit. Elle suit son bloc tel
    // qu'il est désormais (retarget), garde ce qu'on y a tapé, et dit que la journée a
    // changé : l'enregistrer n'écrase jamais en silence ce qu'un autre onglet a posé. Pendant
    // qu'elle s'enregistre, c'est sa réponse qui en décide.
    //
    // La question « quelles fois », décidée sur la journée d'avant, ne vaut plus : posée par
    // les champs, elle les leur rend, avec ce refus ; posée par Suppr, elle se ferme, et le
    // refus se dit en message, comme quand le serveur la refuse.
    const [shownDay, setShownDay] = useState(day);
    if (shownDay !== day) {
        setShownDay(day);
        const open = ticketWindow;
        if (open !== null && !open.sending && shownSession === session && shownDay !== null && day !== null) {
            const target = retarget(day.grid, open.target);
            if (target !== open.target || changedUnder(shownDay.grid, day.grid, writtenBy(open))) {
                if (open.question?.back === false) {
                    setTicketWindow(null);
                    const said = refusalMessage({ kind: 'stale' });
                    // La clé de la fenêtre, tirée du même compteur : aucun message ne l'a prise.
                    setMessage(said === null ? null : toastOf(said, open.key, mac));
                } else {
                    setTicketWindow({
                        ...withoutQuestion(open),
                        target,
                        errors: { ...open.errors, general: STALE_REFUSAL, focus: false },
                    });
                    setSelection(windowSelection(target, open.aim));
                }
            }
        }
    }
    useEffect(() => {
        sessionRef.current = session;
    }, [session]);
    /** Le jour qui s'ouvre, pour une réponse qui revient après le rendu qui l'a fait partir. */
    const openingDayRef = useRef(openingDay);
    useEffect(() => {
        openingDayRef.current = openingDay;
    }, [openingDay]);

    const grid = day?.grid ?? null;
    const next = () => (counterRef.current += 1);

    /** La réponse revient-elle à la journée encore affichée ? */
    const current = (from: DaySession) => sessionRef.current === from;

    const show = (gridMessage: GridMessage | null) => {
        setMessage(
            gridMessage === null
                ? null
                : toastOf(gridMessage, next(), mac, () => {
                      rewindRef.current('undo');
                  }),
        );
    };

    /**
     * Un geste part : le message du geste d'avant s'en va, son « Annuler » viserait celui-ci.
     * Rend son tour, que sa réponse présente pour dire ce qu'il a fait.
     */
    const begin = (): number => {
        turnRef.current += 1;
        setMessage(null);

        return turnRef.current;
    };

    /**
     * Le message d'un geste : ce qu'il a fait disparaître, ou pourquoi il n'a rien fait. Un
     * autre geste parti depuis, ce qu'il a fait ne se dit plus ; un refus se dit toujours.
     * Sans rien à dire, il laisse le message tel qu'il est : celui du geste d'avant s'en est
     * allé à son départ, et ce qui s'affiche depuis est le refus d'un autre — qu'un geste
     * abandonné derrière lui ne doit pas effacer.
     */
    const report = (from: DaySession, outcome: Outcome, gesture: UndoableGesture | null, turn: number) => {
        if (!current(from)) {
            elsewhere(from, outcome.kind === 'saved' ? null : refusalMessage(outcome));

            return;
        }
        const said =
            outcome.kind === 'saved'
                ? gesture === null || turn !== turnRef.current
                    ? null
                    : undoMessage(gesture, outcome.step)
                : refusalMessage(outcome);
        if (said !== null) {
            show(said);
        }
    };

    /**
     * Le refus d'un geste qui revient après qu'on a changé de jour : la journée affichée — ou
     * celle qui s'ouvre, qui le garde en arrivant — le dit, le jour du geste devant, et rien
     * d'autre n'y change. Revenu pendant que son propre jour se rouvre, il se dit comme sur
     * lui, sans le jour. Ce qu'un tel geste a fait, lui, ne se dit plus.
     */
    const elsewhere = (from: DaySession, said: GridMessage | null) => {
        if (said !== null) {
            show(openingDayRef.current === from.date ? said : elsewhereRefusal(from.date, said));
        }
    };

    /**
     * Ce qu'on a fait sur la journée pendant qu'elle s'ouvrait, dans l'ordre : chaque geste
     * repart une fois qu'elle est lue, sur ce qu'elle montre et la sélection qu'on y a faite en
     * attendant, comme s'il venait d'être fait. Rien ne se perd sans se voir : un autre jour
     * demandé entre-temps y renonce, comme à tout ce qu'on quitte, et une lecture qui échoue le
     * dit à la place de la grille.
     */
    const awaitingRef = useRef<{ readonly date: string; readonly gestures: AwaitedGesture[] } | null>(null);

    /** Vrai si la journée s'ouvre encore : le geste l'attend. */
    const awaits = (gesture: AwaitedGesture): boolean => {
        if (session !== null || openingDay === null) {
            return false;
        }
        const awaiting = awaitingRef.current;
        const last = awaiting?.date === openingDay ? awaiting.gestures.at(-1) : undefined;
        if (awaiting?.date !== openingDay) {
            awaitingRef.current = { date: openingDay, gestures: [gesture] };
        } else if (last?.kind === 'type' && gesture.kind === 'type') {
            // Ce qu'on tape à la suite s'écrit à la suite du ticket, comme dans la fenêtre qui attend.
            awaiting.gestures[awaiting.gestures.length - 1] = {
                kind: 'type',
                key: typedTicket(last.key + gesture.key),
            };
        } else {
            awaiting.gestures.push(gesture);
        }

        return true;
    };

    /** La dernière touche tapée attend la journée : un caractère de plus s'écrit à sa suite. */
    const typing = (): boolean => {
        const awaiting = awaitingRef.current;

        return session === null && awaiting?.date === openingDay && awaiting.gestures.at(-1)?.kind === 'type';
    };

    /** Retour arrière sur le ticket qui attend la journée : sa dernière lettre s'efface. */
    const untype = () => {
        const gestures = awaitingRef.current?.gestures;
        const last = gestures?.at(-1);
        if (gestures !== undefined && last?.kind === 'type') {
            gestures[gestures.length - 1] = { kind: 'type', key: typedTicket(last.key).slice(0, -1) };
        }
    };

    /** Échap sur le ticket qui attend la journée : on y renonce, comme à une fenêtre qui attend. */
    const forgetTyped = () => {
        const gestures = awaitingRef.current?.gestures;
        if (gestures?.at(-1)?.kind === 'type') {
            gestures.pop();
        }
    };

    /**
     * Un geste qui passe par la file de la journée attend la fenêtre de ticket ouverte : on
     * l'a quittée pour le faire, elle s'enregistre donc d'abord, comme sur un clic à côté, et
     * les gestes s'enregistrent dans l'ordre où on les a faits. Refusée, elle reste ouverte
     * avec son message, et le geste n'a pas lieu.
     *
     * Le geste ne lit pas la fenêtre : il peut partir d'un écran où elle est encore ouverte.
     * Ce qu'il peut faire se juge sur la journée enregistrée, une fois la fenêtre partie : un
     * effacement juste après elle efface ce qu'elle vient d'écrire. De même après un geste
     * encore en route : la journée affichée n'a pas encore ce qu'il écrit, et le geste se juge
     * à son tour dans la file, qui ne fait rien quand il n'y a rien à faire.
     *
     * Fermée, la grille n'en prend aucun, sauf annuler et rétablir quand elle s'est fermée sous le
     * curseur (`evenClosed`, rewind).
     */
    const afterWindow = (
        action: 'copy' | 'cut' | 'pause' | 'clear' | null,
        gesture: (session: DaySession) => void,
        evenClosed = false,
    ) => {
        menuWaitRef.current = null;
        if (session === null || (closed && !evenClosed)) {
            return;
        }
        const from = session;
        const go = () => {
            const { busy, day: saved } = from.current();
            if (action === null || busy || selectionActions(saved.grid, selection, false)[action]) {
                gesture(from);
            }
        };
        if (ticketWindow === null) {
            go();

            return;
        }
        void leaveWindow().then((left) => {
            if (left && current(from)) {
                go();
            }
        });
    };

    /** Un geste sur la grille. Le message du geste d'avant s'en va : son « Annuler » viserait celui-ci. */
    const run = (changes: QuarterChanges, gesture: UndoableGesture | null) => {
        if (session === null || closed) {
            return;
        }
        const turn = begin();
        void session.apply(changes).then((outcome) => {
            report(session, outcome, gesture, turn);
        });
    };

    /**
     * Annuler ou rétablir le dernier geste de la journée. Fermée, la grille n'y répond que si elle
     * était ouverte plus tôt dans cette visite (`openedHere`) : vidée puis mise à 0h00 sous le
     * curseur, elle garde le « Annuler » du message, Ctrl/⌘+Z et Ctrl/⌘+Maj+Z pour les gestes
     * qu'on vient d'y faire. Revenu sur un jour fermé, ou la page rechargée, elle n'y répond
     * plus : « Saisir quand même » la rouvre. Tapé pendant que la journée s'ouvre, le geste
     * l'attend, puis se juge sur elle comme s'il venait d'être tapé.
     */
    const rewind = (direction: 'undo' | 'redo') => {
        if (awaits({ kind: direction })) {
            return;
        }
        afterWindow(
            null,
            (from) => {
                begin();
                void (direction === 'undo' ? from.undo() : from.redo()).then((outcome) => {
                    const said = refusalMessage(outcome, direction);
                    if (!current(from)) {
                        elsewhere(from, said);
                    } else if (said !== null) {
                        show(said);
                    }
                });
            },
            openedHere === session,
        );
    };

    const copy = () => {
        afterWindow('copy', (from) => {
            void from.copy(selection);
        });
    };

    /**
     * Couper la sélection. Un seul bloc qui revient, en entier, d'aujourd'hui ou d'un jour à venir :
     * la question « Couper une récurrence » s'ouvre sous le quart d'heure visé, comme Suppr
     * (selectionCut) ; sinon, la coupe ordinaire.
     */
    const cut = (aim: WindowAim = keyboardAim()): boolean => {
        const shown = session?.current().day ?? null;
        if (shown === null || closed || selectionCut(shown, selection.quarters, today, aim.quarter) === null) {
            afterWindow('cut', (from) => {
                plainCut(from, selection);
            });

            return false;
        }
        const cutting = selection;
        openWindow(
            () => null,
            aim,
            null,
            () => {
                if (session !== null) {
                    plainCut(session, cutting);
                }
            },
            (saved) => selectionCut(saved, cutting.quarters, today, aim.quarter),
        );

        return true;
    };

    const plainCut = (from: DaySession, cutting: Selection) => {
        const turn = begin();
        void from.cut(cutting).then((outcome) => {
            report(from, outcome, 'cut', turn);
        });
    };

    /**
     * Coller sur la sélection. Le même contenu au bord d'un bloc qui revient l'allonge : la
     * question « Allonger une récurrence » s'ouvre sur ce qu'on colle, jugée sur la journée
     * enregistrée (gestureExtension) ; sinon, le collage se fait sans rien demander — celui d'une
     * récurrence coupée avec les suivantes compris, qui repart de ce jour (DaySession.paste).
     */
    const paste = (aim: WindowAim = keyboardAim()): boolean => {
        if (selection.quarters.length === 0) {
            return false;
        }
        const pasting = selection;
        const shown = session?.current().day ?? null;
        if (session === null || shown === null || closed || pasteExtension(session, shown, pasting) === null) {
            afterWindow(null, (from) => {
                plainPaste(from, pasting);
            });

            return false;
        }
        const from = session;
        openWindow(
            () => null,
            aim,
            null,
            () => {
                plainPaste(from, pasting);
            },
            (saved) => pasteExtension(from, saved, pasting),
        );

        return true;
    };

    const plainPaste = (from: DaySession, pasting: Selection) => {
        const turn = begin();
        void from.paste(pasting, today).then(({ outcome, pasted }) => {
            if (current(from) && pasted.length > 0) {
                setSelection((shown) => followed(shown, pasting, selectQuarters(pasted)));
            }
            report(from, outcome, 'paste', turn);
        });
    };

    /** Ce que le presse-papier collerait sur cette journée allonge-t-il un bloc qui revient ? */
    const pasteExtension = (from: DaySession, day: DayState, pasting: Selection) => {
        const clipboard = from.clipboard();
        const result = clipboard === null || clipboard.recurrence !== undefined ? null : pasteOn(clipboard, pasting);

        return result?.kind === 'paste' ? gestureExtension(day, result.changes, today, 'paste') : null;
    };

    const convertToPause = () => {
        afterWindow('pause', () => {
            run(fill(selection.quarters, PAUSE), 'pause');
        });
    };

    /**
     * Effacer la sélection. Un seul bloc qui revient, en entier, d'aujourd'hui ou d'un jour à
     * venir : la question « Effacer une récurrence » s'ouvre sous le quart d'heure visé, comme
     * une fenêtre, et se juge sur la journée enregistrée une fois les gestes d'avant partis ;
     * sinon, la sélection s'efface cette fois seulement.
     */
    const clear = (aim: WindowAim = keyboardAim()): boolean => {
        const shown = session?.current().day ?? null;
        const quarters = selection.quarters;
        // Le haut ou le bas d'un bloc qui revient le raccourcit : la question « Raccourcir une
        // récurrence » (selectionShorten).
        const asked: Asked = (day) =>
            selectionErase(day, quarters, today, aim.quarter) ?? selectionShorten(day, quarters, today);
        if (shown === null || closed || asked(shown) === null) {
            afterWindow('clear', () => {
                run(fill(selection.quarters, null), 'clear');
            });

            return false;
        }
        openWindow(
            () => null,
            aim,
            null,
            () => {
                run(fill(quarters, null), 'clear');
            },
            asked,
        );

        return true;
    };

    // La fenêtre de ticket.

    /**
     * Une fenêtre déjà ouverte s'enregistre d'abord, comme sur un clic à côté : une Entrée
     * ou une lettre tapée sur la grille ne la jettent pas. Refusée, elle reste ouverte avec
     * son message, et l'autre ne s'ouvre pas.
     *
     * Ce qu'elle vise se lit sur la journée enregistrée, une fois les gestes d'avant
     * enregistrés : ouverte sur un collage encore en route, elle montrerait ce qu'il
     * remplace, et l'enregistrer l'écraserait. Un de ces gestes refusé, elle ne s'ouvre pas,
     * comme ceux qui attendaient derrière lui dans la file : elle partait d'une journée qui
     * n'est plus la bonne, et son refus reste dit.
     *
     * @param aimAt ce qu'elle vise sur cette journée ; rien, elle ne s'ouvre pas
     * @param none  ce qui se dit alors, s'il y a lieu
     */
    const openWindow = (
        aimAt: (grid: Grid) => EntryTarget | null,
        aim: WindowAim,
        draft: EntryDraft | null = null,
        none: (() => void) | null = null,
        asked: Asked | null = null,
    ) => {
        menuWaitRef.current = null;
        if (session === null || closed) {
            return;
        }
        const before = beforeWindowRef?.current ?? null;
        if (ticketWindow === null && before === null && !session.current().busy) {
            openingRef.current = null;
            presentOn(session.current().day, aimAt, aim, draft, none, asked);

            return;
        }
        const opening = { session, aimAt, aim, draft, none, asked };
        openingRef.current = opening;
        const refusals = session.refusals();
        void Promise.all([leaveWindow(), before?.() ?? true]).then(async ([left, others]) => {
            const waiting = () =>
                openingRef.current === opening && left && others && current(session) && session.refusals() === refusals;
            while (waiting() && session.current().busy) {
                await session.settled();
            }
            if (!waiting()) {
                if (openingRef.current === opening) {
                    openingRef.current = null;
                }

                return;
            }
            openingRef.current = null;
            presentOn(session.current().day, opening.aimAt, opening.aim, opening.draft, opening.none, opening.asked);
        });
    };

    const presentOn = (
        saved: DayState,
        aimAt: (grid: Grid) => EntryTarget | null,
        aim: WindowAim,
        draft: EntryDraft | null,
        none: (() => void) | null,
        asked: Asked | null,
    ) => {
        const question = asked?.(saved) ?? null;
        const target = question?.target ?? aimAt(saved.grid);
        if (target !== null) {
            present(
                target,
                aim,
                draft,
                question === null ? undefined : { action: question.action, choice: 'once', back: false },
            );
        } else {
            none?.();
        }
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
        openWindow(
            (saved) => partTarget(saved, selection),
            aim,
            null,
            () => {
                show(PART_REFUSAL);
            },
        );
    };

    /** Au clavier, sans pointeur : le milieu de la colonne, et le créneau où s'arrête la sélection. */
    const keyboardAim = (): WindowAim => ({ x: null, quarter: selection.head });

    /**
     * L'enregistrement de la fenêtre, sa case « Récurrence » comprise : créer, changer ou
     * arrêter la récurrence du bloc (recurrenceDraft.ts).
     */
    const withRecurrence = (shown: TicketWindow, base: EntryAction): EntryAction => {
        const day = session?.current().day ?? null;
        if (day === null) {
            return base;
        }
        const initial = initialRecurrence(shown.target, day);

        return recurrenceAction(base, shown.target, shown.recurrence ?? initial, initial, day, today);
    };

    /**
     * Un autre geste quitte la fenêtre ouverte : elle s'enregistre, comme sur un clic à
     * côté, et un ticket que Jira ne connaît pas la garde ouverte de la même façon. La
     * promesse dit si elle s'est fermée.
     */
    const leaveWindow = (leavingPage = false): Promise<boolean> => {
        if (ticketWindow === null) {
            return Promise.resolve(true);
        }
        const check = windowCheckRef.current;
        const action = windowAction(ticketWindow);
        // La page se ferme : personne ne répondra à la question, c'est le choix d'avance.
        const chosen = leavingPage && action.kind === 'ask' ? action.once : action;

        return write(
            chosen,
            checkOf(ticketWindow, chosen, leavingPage ? { refused: check.refused, known: () => undefined } : check),
        );
    };

    /**
     * Ce que fait l'enregistrement de la fenêtre, comme Entrée ou un clic à côté : la réponse
     * choisie quand elle pose la question, sinon ses champs et sa case « Récurrence ».
     */
    const windowAction = (shown: TicketWindow): EntryAction => {
        const question = shown.question;
        if (question !== undefined) {
            return question.choice === 'once' ? question.action.once : question.action.following;
        }

        return withRecurrence(shown, saveEntry(shown.target, shown.draft));
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
    const present = (target: EntryTarget, aimed: WindowAim, draft: EntryDraft | null, question?: WindowQuestion) => {
        // Nouveau ticket s'accroche à sa sélection, pas à un quart d'heure. Une question posée par
        // la grille s'ouvre sous le quart d'heure visé, même sur ce qu'on colle à côté d'un bloc.
        const aim = target.kind === 'edit' || question !== undefined ? aimed : { ...aimed, quarter: null };
        setSelection(windowSelection(target, aim));
        setTicketWindow({
            key: next(),
            target,
            aim,
            draft: draft ?? draftOf(target),
            errors: NO_ERRORS,
            sending: false,
            ...(question === undefined ? {} : { question }),
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
        openWindow(() => selectionTarget(selection), keyboardAim(), { ticket: typedTicket(key), comment: '' });
    };

    /**
     * Une touche pendant qu'une fenêtre demandée attend celle d'avant, ou un geste en
     * route : elle lui revient, comme si elle était déjà ouverte, et aucune ne fait rien à
     * la grille entre-temps, raccourcis compris. Échap y renonce. Demandée par une lettre,
     * un caractère s'écrit à la suite du ticket et Retour arrière efface le dernier. Tab,
     * les touches de fonction et les raccourcis du navigateur gardent leur effet. Faux s'il
     * n'y a pas de telle fenêtre.
     */
    const typeOnOpening = (event: KeyboardEvent<HTMLElement>): boolean => {
        const opening = waitingOpening();
        if (opening === null || event.nativeEvent.isComposing) {
            return false;
        }
        const { key } = event;
        const { draft } = opening;
        const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
        if (key === 'Escape') {
            event.preventDefault();
            openingRef.current = null;
        } else if (plain && draft !== null && key === 'Backspace') {
            event.preventDefault();
            opening.draft = { ...draft, ticket: draft.ticket.slice(0, -1) };
        } else if (plain && draft !== null && key.length === 1) {
            event.preventDefault();
            opening.draft = { ...draft, ticket: typedTicket(draft.ticket + key) };
        } else if (plain && key !== 'Tab' && !/^F\d+$/.test(key)) {
            event.preventDefault();
        }

        return true;
    };

    /** La fenêtre de cette journée qui attend pour s'ouvrir, s'il y en a une. */
    const waitingOpening = () => {
        const opening = openingRef.current;

        return opening?.session === session ? opening : null;
    };

    /**
     * Ce que fait la fenêtre ; la promesse dit si elle s'est fermée. Il passe par le chemin
     * commun des champs Ticket (ticketSave.ts) : un enregistrement déjà en route n'en lance
     * pas un second, on attend le sien ; un ticket que Jira ne connaît pas garde la fenêtre
     * ouverte, même au clic à côté, le refus sous son champ.
     *
     * `check`, quand Jira cherche encore le ticket tapé, fait attendre sa réponse : l'attente
     * compte comme l'envoi. Rien ne se tape, rien ne ferme la fenêtre ni n'en ouvre une autre,
     * et ce qui part est ce que la fenêtre montrait au geste. Sans lui — une pause, un
     * effacement —, il n'y a pas de ticket à vérifier.
     */
    const write = (action: EntryAction, check: TicketCheck | null = null): Promise<boolean> => {
        const shown = ticketWindow;
        const from = session;
        if (shown === null) {
            return Promise.resolve(true);
        }
        if (from === null) {
            return Promise.resolve(false);
        }
        let turn = 0;
        // La journée sur laquelle l'enregistrement part : relue changée pendant que Jira
        // cherche le ticket, la fenêtre refusée suit son bloc et le dit.
        const base = from.current().day.grid;

        return save.run({
            check,
            // Un geste fait avant que l'écran ait montré la réponse voit encore l'envoi : c'est
            // cette réponse qui vaut pour lui.
            sending: shown.sending,
            refuse: (ticket, answered) => {
                if (!answered) {
                    setTicketWindow((open) =>
                        open === null
                            ? open
                            : {
                                  ...withoutQuestion(open),
                                  sending: false,
                                  errors: { ...NO_ERRORS, ticket, focus: true },
                              },
                    );

                    return;
                }
                const now = from.current().day.grid;
                const target = retarget(now, shown.target);
                const general =
                    target !== shown.target || changedUnder(base, now, quartersOf(shown.target)) ? STALE_REFUSAL : null;
                keepWindow(target, shown.aim);
                setTicketWindow((open) =>
                    open?.key === shown.key
                        ? {
                              ...withoutQuestion(open),
                              target,
                              sending: false,
                              errors: { ...NO_ERRORS, ticket, general, focus: true },
                          }
                        : open,
                );
            },
            start: () => {
                if (action.kind === 'close') {
                    setTicketWindow(null);

                    return true;
                }
                if (action.kind === 'ask') {
                    // La question prend la place des champs, à la même largeur : ce qu'on y a
                    // tapé reste, que Retour rend.
                    keepWindow(shown.target, shown.aim);
                    setTicketWindow((open) =>
                        open?.key === shown.key
                            ? { ...open, errors: NO_ERRORS, question: { action, choice: 'once', back: true } }
                            : open,
                    );

                    return false;
                }
                if (action.kind === 'refuse') {
                    keepWindow(shown.target, shown.aim);
                    setTicketWindow((open) =>
                        open?.key === shown.key
                            ? {
                                  ...open,
                                  errors: {
                                      ...NO_ERRORS,
                                      weekdays: action.weekdays,
                                      until: action.until,
                                      rhythm: action.rhythm,
                                      focus: true,
                                  },
                              }
                            : open,
                    );

                    return false;
                }
                turn = begin();
                setTicketWindow({ ...shown, sending: true, errors: NO_ERRORS });
                // Décidé sur la journée qu'on voit, il part une fois Jira d'accord : relue changée
                // entre-temps, elle le refuse.
                const seen = from.seen();
                const cuts = action.cuts ?? null;
                if (action.kind === 'recurrence') {
                    const { changes, rule, replaces } = action;

                    return () => from.saveRecurrence(changes, rule, replaces, seen, cuts);
                }
                const { changes } = action;

                return () => from.apply(changes, seen, cuts);
            },
            settle: (outcome) => {
                const closed = outcome.kind === 'saved' || outcome.kind === 'unchanged';
                if (!current(from)) {
                    if (!closed) {
                        elsewhere(from, refusalMessage(outcome));
                    }

                    return closed;
                }
                if (closed) {
                    setTicketWindow((open) => (open?.key === shown.key ? null : open));
                    const gesture = action.kind === 'write' || action.kind === 'recurrence' ? action.gesture : null;
                    if (outcome.kind === 'saved' && gesture !== null && turn === turnRef.current) {
                        show(undoMessage(gesture, outcome.step));
                    }

                    return true;
                }
                // Posée par la grille, la question n'a pas de champs où dire le refus : elle se
                // ferme, et le refus se dit comme pour un effacement.
                if (shown.question?.back === false) {
                    setTicketWindow((open) => (open?.key === shown.key ? null : open));
                    const said = refusalMessage(outcome);
                    if (said !== null) {
                        show(said);
                    }

                    return false;
                }
                // Un créneau qu'une autre récurrence a pris ailleurs depuis la lecture de la
                // journée : relue, elle la connaît, et la fenêtre montre ses fois prises et
                // l'alternance, sans rien perdre de ce qu'on y a réglé.
                if (outcome.kind === 'invalid' && errorsOf(outcome).rhythm !== null) {
                    void from.refresh();
                }
                // La journée a pu être relue : la fenêtre suit son bloc tel qu'il est désormais.
                // La question posée par ses champs les lui rend, le refus sous le sien.
                const now = from.current().day;
                const target = retarget(now.grid, shown.target);
                keepWindow(target, shown.aim);
                setTicketWindow((open) => {
                    if (open?.key !== shown.key) {
                        return open;
                    }
                    // Refusée parce que la journée, ou la récurrence du bloc, a changé ailleurs :
                    // la fenêtre le dit, et le prochain enregistrement remplace la récurrence
                    // telle qu'elle est désormais.
                    const recurrence =
                        outcome.kind === 'stale' ? seenAgain(open.recurrence, target, now) : open.recurrence;

                    return {
                        ...withoutQuestion(open),
                        target,
                        sending: false,
                        errors: errorsOf(outcome),
                        ...(recurrence === undefined ? {} : { recurrence }),
                    };
                });

                return false;
            },
        });
    };

    // Le rectangle se calcule quand Radix le mesure, jamais au rendu : la grille a pu
    // défiler depuis.
    const target = ticketWindow?.target ?? null;
    const aim = ticketWindow?.aim ?? null;
    const windowKey = ticketWindow?.key ?? null;
    // La question posée par Suppr est plus étroite que la fenêtre du ticket (TicketWindow.tsx) :
    // elle se centre sur sa propre largeur.
    const narrow = ticketWindow?.question?.back === false;
    const placeWindow = useMemo(() => {
        if (target === null || aim === null || windowKey === null) {
            return null;
        }
        const width = tokenPixels(narrow ? '--w-pop-sm' : '--w-pop');
        const anchored = anchorQuarters(target, aim);
        // Le côté se choisit quand la fenêtre a sa hauteur : ensuite, elle ne fait plus que
        // suivre son créneau, même quand un refus la change de bloc ou de titre, tant qu'elle
        // vise les mêmes quarts d'heure. Qui grandit le fait vers le bas, sans bouger ; seul un
        // écran réduit la replace, quand elle ne tient plus entière nulle part (reattachWindow).
        const id = `${String(windowKey)}:${anchored.join()}`;

        return (height: number) => {
            const lane = laneRef.current;
            if (lane === null) {
                return { rect: new DOMRect(), stopped: false, maxHeight: null };
            }
            const kept = attachmentRef.current?.id === id ? attachmentRef.current : null;
            const placed = placeOn(lane, scrollerRef.current, anchored, aim, { width, height }, kept);
            if (height > 0) {
                attachmentRef.current = { id, ...placed.measured };
            }

            return placed;
        };
    }, [target, aim, windowKey, narrow, laneRef, scrollerRef]);

    // Le clavier, au niveau de la page : annuler et rétablir valent partout, sauf dans
    // un champ, qui garde les siens. L'écouteur est posé une fois et lit l'état courant.
    const onPageKeyDown = useEffectEvent((event: globalThis.KeyboardEvent) => {
        // Une fenêtre qui attend pour s'ouvrir retient aussi annuler et rétablir (typeOnOpening),
        // comme le ticket tapé qui attend la journée et s'écrira dans la sienne (typing).
        if (event.defaultPrevented || editable(event.target) || waitingOpening() !== null || typing()) {
            return;
        }
        const shortcut = shortcutOf(event, PAGE_SHORTCUTS);
        if (shortcut === null) {
            return;
        }
        event.preventDefault();
        if (shortcut === 'undo' && message?.key === foreignKeyRef.current && message.action !== undefined) {
            setMessage(null);
            message.action.onAction();
        } else {
            rewind(shortcut);
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

    // Le glisser : il suit le pointeur jusqu'au relâcher, même hors de la grille, et fait
    // défiler la grille quand il approche de son bord (pointerDrag.ts).
    const dragMove = (clientX: number, clientY: number) => {
        const quarter = pointedQuarter(laneRef.current, clientY);
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
    // Échap abandonne le glisser, soulevé ou non, sans rien poser, comme un favori qu'on
    // glisse : la grille ne garde en sélection que son quart d'heure de départ. La fenêtre de
    // ticket restée ouverte n'entend pas cet Échap (pointerDrag.ts), et garde sa saisie.
    const dragCancel = () => {
        const drag = dragRef.current;
        dragRef.current = null;
        if (drag !== null) {
            setSelection(selectQuarter(drag.from));
        }
        blockDropRef?.current?.cancel();
    };
    useLayoutEffect(() => {
        rewindRef.current = rewind;
    });
    const dragHandlersRef = useRef({ move: dragMove, end: dragEnd, cancel: dragCancel });
    useLayoutEffect(() => {
        dragHandlersRef.current = { move: dragMove, end: dragEnd, cancel: dragCancel };
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

    /** @param start où le pointeur a appuyé, dans la fenêtre du navigateur */
    const startDrag = (quarter: number, start: { x: number; y: number }) => {
        dragRef.current?.stop();
        const stop = startPointerDrag({
            start,
            threshold: 0,
            lane: () => laneRef.current,
            scroller: () => scrollerRef.current,
            onMove: (x, y) => {
                dragHandlersRef.current.move(x, y);
            },
            onEnd: (x, y) => {
                dragHandlersRef.current.end(x, y);
            },
            onCancel: () => {
                dragHandlersRef.current.cancel();
            },
        });
        const content = grid?.at(quarter) ?? null;
        dragRef.current = {
            from: quarter,
            to: quarter,
            ticket: content?.kind === 'work' ? content.ticket : null,
            lifted: false,
            stop,
        };
    };

    const focusGrid = () => {
        // Fermée à la saisie, la grille ne prend pas le curseur (GridEditing.closed).
        if (closed) {
            return;
        }
        givingFocusRef.current = true;
        listboxRef.current?.focus({ preventScroll: true });
        givingFocusRef.current = false;
        if (keyboardLastRef.current && cursorShownRef.current) {
            cursorOption()?.scrollIntoView({ block: 'nearest' });
        }
    };

    /** Le clavier commence au premier quart d'heure entier en haut de la vue. */
    const keyboardStart = (): Selection => {
        const top = Quarter.ceil(visibleTop());

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
        ticketWindow !== null && windowCheckRef.current.refused && !ticketWindow.sending && save.current === null;

    /**
     * Entrée sur la sélection : Nouveau ticket ou Modifier le ticket. La fenêtre refusée vise
     * déjà cette sélection : Entrée l'enregistre de nouveau, sans en rouvrir une sur ce qu'elle
     * vient d'écrire. Celle qui s'enregistre encore n'est pas refusée : la nouvelle l'attend, et
     * s'ouvre sur ce qu'elle a écrit.
     */
    const enter = () => {
        const target = grid === null ? null : targetOfSelection(grid, selection);
        if (ticketWindow?.sending === false && target !== null && sameQuarters(target, ticketWindow.target)) {
            void leaveWindow();
        } else if (target !== null) {
            openWindow((saved) => targetOfSelection(saved, selection), keyboardAim());
        }
    };

    /** Le menu du clavier, sur le créneau où la sélection s'arrête, pas là où le navigateur le poserait. */
    const keyboardMenu = () => {
        keyboardMenuRef.current = selection.head;
        openMenuOn(laneRef.current, listboxRef.current, selection.head);
        keyboardMenuRef.current = null;
    };

    /** Un double-clic : la fenêtre du quart d'heure, là où était le pointeur dans la colonne. */
    const openOn = (quarter: number, x: number | null) => {
        openWindow((saved) => targetAt(saved, quarter), { x, quarter });
    };

    const copyTicket = (ticket: string) => {
        if (awaits({ kind: 'copyTicket', ticket }) || session === null) {
            return;
        }
        setMessage(null);
        void session.copyContent(work(ticket)).then(() => {
            if (current(session)) {
                show({ ticket, text: 'copié', undo: false });
            }
        });
    };

    const dropTicketOn = (ticket: string, quarter: number) => {
        menuWaitRef.current = null;
        if (awaits({ kind: 'drop', ticket, quarter }) || session === null || grid === null || closed) {
            return;
        }
        // Comme un clic à côté : la fenêtre ouverte s'enregistre d'abord. Refusée, elle
        // reste ouverte avec son message, et le favori n'est pas posé.
        const before = selection;
        const changes = dropTicket(ticket, quarter);
        const from = session;
        const drop = () => {
            setSelection((shown) => followed(shown, before, selectQuarter(quarter)));
            const turn = begin();
            void from.drop(changes).then((outcome) => {
                report(from, outcome, 'replace', turn);
            });
        };
        void leaveWindow().then((closed) => {
            if (!closed || !current(session)) {
                return;
            }
            // Au bord d'un bloc qui revient du même ticket, sans commentaire, il l'allonge : la
            // question « Allonger une récurrence » s'ouvre sur le quart d'heure déposé.
            if (gestureExtension(session.current().day, changes, today, 'replace') === null) {
                drop();

                return;
            }
            openWindow(
                () => null,
                { x: null, quarter },
                null,
                drop,
                (saved) => gestureExtension(saved, changes, today, 'replace'),
            );
        });
    };

    /**
     * Un geste qui a attendu la journée : il se fait sur ce qu'elle montre maintenant, et la
     * sélection qu'on y a faite en attendant.
     */
    const replay = useEffectEvent((gesture: AwaitedGesture) => {
        switch (gesture.kind) {
            case 'copy':
                copy();
                break;
            case 'cut':
                cut();
                break;
            case 'paste':
                paste();
                break;
            case 'clear':
                clear();
                break;
            case 'edit':
                editSelection(keyboardAim());
                break;
            case 'enter':
                enter();
                break;
            case 'menu':
                keyboardMenu();
                break;
            case 'type':
                typeOnSelection(gesture.key);
                break;
            case 'undo':
            case 'redo':
                rewind(gesture.kind);
                break;
            case 'open':
                openOn(gesture.quarter, gesture.x);
                break;
            case 'drop':
                dropTicketOn(gesture.ticket, gesture.quarter);
                break;
            case 'copyTicket':
                copyTicket(gesture.ticket);
                break;
        }
    });
    useEffect(() => {
        const awaiting = awaitingRef.current;
        if (awaiting === null || openingDay === awaiting.date) {
            return;
        }
        awaitingRef.current = null;
        if (session?.date === awaiting.date) {
            awaiting.gestures.forEach((gesture) => {
                replay(gesture);
            });
        }
    }, [session, openingDay]);

    const replaced = ticketWindow === null || grid === null ? null : replacedBy(grid, ticketWindow.target);
    const part = ticketWindow?.target.kind === 'part' ? ticketWindow.target : null;

    return {
        selection,
        pointerCursor,
        window: ticketWindow,
        windowRecurrence:
            ticketWindow === null || session === null
                ? null
                : (ticketWindow.recurrence ?? initialRecurrence(ticketWindow.target, session.current().day)),
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
            if (event.button === 0) {
                menuWaitRef.current = null;
            }
            const quarter = pointedQuarter(laneRef.current, event.clientY);
            // Pendant que la journée s'ouvre, on y sélectionne déjà : ce qu'on y fera l'attend.
            if (event.button !== 0 || quarter === null || (grid === null && openingDay === null) || closed) {
                return;
            }
            // Ni sélection de texte, ni focus volé par un bloc : le curseur va à la grille.
            event.preventDefault();
            if ((event.detail > 1 && !firstClickOnLaneRef.current) || windowHeld()) {
                return;
            }
            // Un appui est le dernier geste demandé : il renonce à la fenêtre qui attendait, qui
            // viserait autre chose que ce qu'il sélectionne. Le second clic d'un double-clic sur
            // un choix du menu, tombé sur la grille, n'en est pas un.
            openingRef.current = null;
            focusGrid();
            setPointerCursor(true);
            if (event.shiftKey) {
                setSelection((shown) => extendTo(shown, quarter));
            } else if (event.ctrlKey || event.metaKey) {
                setSelection((shown) => toggleQuarter(shown, quarter));
            } else {
                setSelection(selectQuarter(quarter));
                startDrag(quarter, { x: event.clientX, y: event.clientY });
            }
        },
        onLaneDoubleClick: (event) => {
            const quarter = pointedQuarter(laneRef.current, event.clientY);
            if (quarter === null || closed || !firstClickOnLaneRef.current) {
                return;
            }
            const x = laneX(laneRef.current, event.clientX);
            if (!awaits({ kind: 'open', quarter, x }) && grid !== null) {
                openOn(quarter, x);
            }
        },
        onLaneContextMenu: (event) => {
            const keyboardQuarter = keyboardMenuRef.current;
            keyboardMenuRef.current = null;
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
            const replay = menuReplayRef.current;
            menuReplayRef.current = null;
            // Le menu est le dernier geste demandé : la fenêtre qui attendait ne s'ouvre pas.
            openingRef.current = null;
            const trusted = replay?.trusted ?? event.nativeEvent.isTrusted;
            // Le menu se pose au pointeur, et « Nouveau ticket… » s'ouvre là où il était.
            // Ouvert au clavier, il n'en a pas : la fenêtre prend le milieu de la colonne.
            const x = replay === null ? (trusted ? laneX(laneRef.current, event.clientX) : null) : replay.x;
            const aimed = replay === null ? keyboardQuarter : replay.quarter;
            // Le clic droit à côté enregistre la fenêtre ouverte : le menu attend qu'elle se
            // ferme, où il a été demandé — ouvert aussitôt, il passerait sous elle. Refusée,
            // elle reste ouverte avec son message, la sélection sur ce qu'elle vise, et le
            // menu ne s'ouvre pas.
            if (replay === null && ticketWindow !== null) {
                event.preventDefault();
                const { clientX, clientY } = event;
                const from = session;
                const waiting = {};
                menuWaitRef.current = waiting;
                void leaveWindow().then((left) => {
                    if (menuWaitRef.current !== waiting) {
                        return;
                    }
                    menuWaitRef.current = null;
                    const lane = laneRef.current;
                    if (left && from !== null && current(from) && lane !== null) {
                        menuReplayRef.current = { x, trusted, quarter: aimed };
                        lane.dispatchEvent(
                            new globalThis.MouseEvent('contextmenu', {
                                bubbles: true,
                                cancelable: true,
                                clientX,
                                clientY,
                            }),
                        );
                    }
                });

                return;
            }
            menuXRef.current = x;
            const quarter = aimed ?? pointedQuarter(laneRef.current, event.clientY);
            // Un clic droit hors de la sélection la remplace, comme dans un tableur. Le menu
            // ouvert au clavier (touche Menu, Maj+F10) arrive ici aussi, sans être de confiance.
            if (quarter !== null && !selection.quarters.includes(quarter)) {
                setSelection(selectQuarter(quarter));
                setPointerCursor(trusted);
            }
        },
        onListboxFocus: () => {
            // Le curseur arrive au clavier, par Tab : il compte comme venu du clavier, et sur
            // une grille sans sélection, il s'y montre là où il était resté, sinon en haut de
            // la vue. Resté hors de vue, la grille défile jusqu'à lui, comme aux flèches.
            // Rendu par l'écran, ou par un clic, il garde d'où venait sa sélection, et la
            // grille ne bouge pas. Rendu par le navigateur, au retour sur la page, rien n'a
            // bougé : la grille non plus.
            const restored = pageLeftRef.current;
            pageLeftRef.current = false;
            if (restored || givingFocusRef.current || listboxRef.current?.matches(':focus-visible') !== true) {
                return;
            }
            setPointerCursor(false);
            let shown = selection;
            if (selection.quarters.length === 0) {
                shown = selection.head === null ? keyboardStart() : selectQuarter(selection.head);
                setSelection(shown);
            }
            reveal(shown.head);
        },
        onListboxBlur: () => {
            pageLeftRef.current = !document.hasFocus();
            const option = cursorOption()?.getBoundingClientRect();
            const view = scrollerRef.current?.getBoundingClientRect();
            cursorShownRef.current =
                option !== undefined && view !== undefined && option.bottom > view.top && option.top < view.bottom;
        },
        onListboxKeyDown: (event) => {
            menuWaitRef.current = null;
            if ((grid === null && openingDay === null) || closed || typeOnOpening(event)) {
                return;
            }
            const key = event.key;
            const command = event.ctrlKey || event.metaKey;
            const shortcut = shortcutOf(event.nativeEvent, GRID_SHORTCUTS);
            const plain = !command && !event.altKey;
            if (
                grid === null &&
                typing() &&
                !event.nativeEvent.isComposing &&
                !(plain && key.length === 1) &&
                key !== 'Tab'
            ) {
                // Un ticket tapé attend la journée : comme dans une fenêtre qui attend
                // (typeOnOpening), Retour arrière en efface la dernière lettre, Échap y renonce
                // en gardant la sélection, et les autres touches — Entrée, Suppr, les flèches,
                // F2, Maj+F10, Ctrl/⌘+V — n'agissent pas derrière la fenêtre qui s'ouvrira avec
                // lui. Tab, les autres touches de fonction et les raccourcis du navigateur gardent
                // leur effet.
                if (key === 'Escape') {
                    event.preventDefault();
                    forgetTyped();
                } else if ((plain && !/^F\d+$/.test(key)) || shortcut !== null) {
                    event.preventDefault();
                    if (plain && key === 'Backspace') {
                        untype();
                    }
                }

                return;
            }
            if (grid === null && key !== 'ArrowUp' && key !== 'ArrowDown') {
                // La journée s'ouvre encore : le curseur s'y déplace, et le reste l'attend.
                const awaited: AwaitedGesture | null =
                    key === 'Enter' && !command
                        ? event.repeat
                            ? null
                            : { kind: 'enter' }
                        : shortcut === 'delete'
                          ? { kind: 'clear' }
                          : shortcut === 'edit'
                            ? event.repeat
                                ? null
                                : { kind: 'edit' }
                            : shortcut !== null
                              ? { kind: shortcut }
                              : typed(event.nativeEvent) || (typing() && key.length === 1 && !command && !event.altKey)
                                ? { kind: 'type', key }
                                : null;
                if (awaited !== null || shortcut !== null || key === 'Enter') {
                    event.preventDefault();
                }
                if (awaited !== null) {
                    awaits(awaited);
                }

                return;
            }
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
                    enter();
                }
            } else if (shortcut !== null) {
                event.preventDefault();
                switch (shortcut) {
                    case 'edit':
                        if (!event.repeat) {
                            editSelection(keyboardAim());
                        }
                        break;
                    case 'delete':
                        clear();
                        break;
                    case 'menu':
                        keyboardMenu();
                        break;
                    case 'copy':
                        copy();
                        break;
                    case 'cut':
                        cut();
                        break;
                    case 'paste':
                        paste();
                        break;
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
            openWindow(() => selectionTarget(selection), { x: menuXRef.current, quarter: selection.head });
        },
        editSelection: () => {
            editSelection({ x: menuXRef.current, quarter: selection.head });
        },
        copy,
        cut: () => cut({ x: menuXRef.current, quarter: selection.head }),
        paste: () => paste({ x: menuXRef.current, quarter: selection.head }),
        convertToPause,
        clear: () => clear({ x: menuXRef.current, quarter: selection.head }),
        setRecurrence: (draft) => {
            // Régler un champ efface son refus, comme taper dans un champ refusé.
            setTicketWindow((open) =>
                open === null || open.sending
                    ? open
                    : {
                          ...open,
                          recurrence: draft,
                          errors: {
                              ...open.errors,
                              weekdays:
                                  draft.weekdays.join() === (open.recurrence?.weekdays ?? []).join()
                                      ? open.errors.weekdays
                                      : null,
                              // Une date commencée puis vidée change aussi : le champ, vide, n'a
                              // plus rien à compléter.
                              until:
                                  draft.until === open.recurrence?.until &&
                                  (draft.incomplete === true) === (open.recurrence.incomplete === true)
                                      ? open.errors.until
                                      : null,
                              // Le créneau se juge de nouveau sur ce qu'on vient de régler.
                              rhythm: draft === open.recurrence ? open.errors.rhythm : null,
                              focus: false,
                          },
                      },
            );
        },
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
            setTicketWindow((open) => {
                const refusal = open === null || open.sending ? null : shapeRefusal(open.draft.ticket);

                return open === null || refusal === null
                    ? open
                    : { ...open, errors: { ...open.errors, ticket: refusal, focus: false } };
            });
        },
        saveWindow: (check) => {
            if (ticketWindow !== null) {
                const action = windowAction(ticketWindow);
                void write(action, checkOf(ticketWindow, action, check));
            }
        },
        flushWindow: leaveWindow,
        unsavedWindow: () => {
            if (ticketWindow === null) {
                return false;
            }
            const shown = draftOf(ticketWindow.target);
            const day = session?.current().day ?? null;

            return (
                ticketWindow.draft.ticket !== shown.ticket ||
                ticketWindow.draft.comment !== shown.comment ||
                (day !== null &&
                    recurrenceChanged(
                        ticketWindow.recurrence ?? null,
                        initialRecurrence(ticketWindow.target, day),
                        day.date,
                        day.workingDays,
                    ))
            );
        },
        cancelWindow: () => {
            if (ticketWindow?.sending !== false) {
                return;
            }
            if (ticketWindow.question?.back === true) {
                setTicketWindow(withoutQuestion(ticketWindow));
            } else {
                setTicketWindow(null);
            }
        },
        chooseScope: (choice) => {
            setTicketWindow((open) =>
                open?.question === undefined || open.sending
                    ? open
                    : { ...open, question: { ...open.question, choice } },
            );
        },
        pauseWindow: () => {
            if (ticketWindow !== null) {
                // « Pause » de Nouveau ticket pose une pause qui revient, la case cochée ;
                // « Convertir en pause » ne change que cette fois.
                const pause = pauseEntry(ticketWindow.target);
                void write(ticketWindow.target.kind === 'new' ? withRecurrence(ticketWindow, pause) : pause);
            }
        },
        deleteWindow: () => {
            const day = session?.current().day ?? null;
            if (ticketWindow !== null && day !== null) {
                // Sur un bloc qui revient, la corbeille demande quelles fois effacer.
                void write(eraseAction(ticketWindow.target, day, today, deleteEntry(ticketWindow.target)));
            }
        },
        focusGrid,
        deselect: () => {
            // Quitter la grille renonce aussi au menu qui attendait une fenêtre.
            menuWaitRef.current = null;
            if (selection.quarters.length === 0) {
                return false;
            }
            setSelection(deselect(selection));

            return true;
        },
        notify: (shown, undo, returnFocus) => {
            const key = next();
            foreignKeyRef.current = key;
            setMessage(shown === null ? null : toastOf(shown, key, mac, undo, returnFocus));
        },
        copyTicket,
        dropTicket: dropTicketOn,
    };
}

/** Un geste fait pendant que la journée s'ouvrait, qui attend qu'elle soit lue (useGridEditing, awaits). */
type AwaitedGesture =
    | { readonly kind: 'copy' | 'cut' | 'paste' | 'clear' | 'edit' | 'enter' | 'menu' | 'undo' | 'redo' }
    | { readonly kind: 'type'; readonly key: string }
    /** Un double-clic : la fenêtre du quart d'heure, et où le pointeur était dans la colonne. */
    | { readonly kind: 'open'; readonly quarter: number; readonly x: number | null }
    | { readonly kind: 'drop'; readonly ticket: string; readonly quarter: number }
    | { readonly kind: 'copyTicket'; readonly ticket: string };

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
 * @param anchored les quarts d'heure auxquels elle s'accroche (anchorQuarters)
 * @param size     la largeur de la fenêtre, et sa hauteur, contenu compris
 * @param kept     comment elle s'est accrochée, et sur quelle mesure, si elle l'a déjà fait
 */
function placeOn(
    lane: HTMLElement,
    scroller: HTMLElement | null,
    anchored: readonly number[],
    aim: WindowAim,
    { width, height }: { readonly width: number; readonly height: number },
    kept: Measured | null,
): PlacedWindow & { readonly measured: Measured } {
    const rect = lane.getBoundingClientRect();
    const column = measureColumn(lane) ?? { top: rect.top, row: 0 };
    const row = column.row;
    const y = (quarter: number) => quarterTop(column, quarter);
    const frame = scroller?.getBoundingClientRect() ?? rect;
    const view = { top: Math.max(frame.top, 0), bottom: Math.min(frame.bottom, window.innerHeight) };
    const margin = tokenPixels('--s-2');
    const room: Room = { height, gap: tokenPixels('--s-3'), margin };
    const runs = selectionRuns(selectQuarters(anchored)).map(({ start, end }) => ({ top: y(start), bottom: y(end) }));
    const prefer = aim.quarter === null ? 'above' : 'below';
    const attached =
        kept === null
            ? attachWindow(runs, view, room, row, prefer)
            : remeasured(kept, height, view)
              ? reattachWindow(
                    runs,
                    view,
                    room,
                    row,
                    prefer,
                    kept.attachment,
                    !sameView(kept.view, view) ? 'view' : height > kept.height ? 'grown' : 'shrunk',
                )
              : kept.attachment;
    // Sa plus petite hauteur depuis qu'elle s'est accrochée : rapetissée, elle se recolle à son
    // créneau ; ce qu'elle regagne ensuite se prend vers le bas, sans qu'elle bouge
    // (windowAnchor). Ouverte dépliée, la case décochée puis recochée revient sous la souris.
    const opened = kept?.attachment === attached ? Math.min(kept.opened, height) : height;
    const { span, stopped, maxHeight } = windowAnchor(runs, view, room, row, attached, opened);
    // Le bord de la colonne n'en fait pas partie : la fenêtre s'aligne sur les blocs.
    const inside = rect.left + lane.clientLeft;
    const { left, arrow } = across(
        aim.x === null ? null : rect.left + aim.x,
        { left: inside, right: inside + lane.clientWidth },
        width,
        margin,
        // La flèche, large de --s-4, à --s-3 au moins des bords de la fenêtre.
        tokenPixels('--s-3') + tokenPixels('--s-4') / 2,
    );

    return {
        rect: new DOMRect(left, span.top, (arrow - left) * 2, span.bottom - span.top),
        stopped,
        maxHeight,
        measured: { attachment: attached, height, view, opened },
    };
}

/** Comment la fenêtre s'est accrochée, sur sa hauteur et la partie visible de la grille d'alors. */
interface Measured {
    readonly attachment: Attachment;
    readonly height: number;
    readonly view: Span;
    /** Sa plus petite hauteur depuis qu'elle s'est accrochée. */
    readonly opened: number;
}

/**
 * Sa hauteur ou la partie visible de la grille ont changé depuis la dernière mesure — au
 * pixel près : une mesure fractionnaire ne la fait pas bouger. Défiler ne change ni l'une ni
 * l'autre.
 */
function remeasured(kept: Measured, height: number, view: Span): boolean {
    return Math.abs(kept.height - height) >= 1 || !sameView(kept.view, view);
}

/** La même partie visible de la grille : seule la fenêtre a changé de hauteur. */
function sameView(before: Span, now: Span): boolean {
    return Math.abs(before.top - now.top) < 1 && Math.abs(before.bottom - now.bottom) < 1;
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

/**
 * La sélection qu'un geste donne une fois enregistré — ce qui a été collé, le favori déposé —,
 * sauf si on en a fait une autre pendant qu'il était en route : la réponse ne la reprend pas.
 *
 * @param before la sélection au moment du geste
 */
function followed(shown: Selection, before: Selection, after: Selection): Selection {
    return shown === before ? after : shown;
}

/** Un de ces quarts d'heure a changé d'une journée à l'autre. */
function changedUnder(before: Grid, after: Grid, quarters: readonly number[]): boolean {
    return quarters.some((quarter) => !sameCell(before.at(quarter), after.at(quarter)));
}

function sameQuarters(a: EntryTarget, b: EntryTarget): boolean {
    return quartersOf(a).join() === quartersOf(b).join();
}

/** Ouvre le menu du clic droit sous un quart d'heure, un peu à droite du bord de la colonne. */
function openMenuOn(lane: HTMLElement | null, from: HTMLElement | null, quarter: number | null): void {
    const column = lane === null ? null : measureColumn(lane);
    if (lane === null || column === null || from === null || quarter === null) {
        return;
    }
    openMenuAt(from, lane.getBoundingClientRect().left + column.row * 2, quarterTop(column, quarter + Quarter.MINUTES));
}

/**
 * Le message en bas de la grille : le ticket qu'il nomme en gras, puis ce qui s'est passé,
 * et son « Annuler », s'il en a un, qui fait `undo` (Ctrl/⌘+Z, que son infobulle écrit).
 */
function toastOf(
    message: GridMessage,
    key: number,
    mac: boolean,
    undo?: () => void,
    returnFocus?: () => void,
): ToastMessage {
    return {
        key,
        content:
            message.ticket === null ? (
                message.text
            ) : (
                <>
                    <b className="font-mono font-semibold whitespace-nowrap">{message.ticket}</b> {message.text}
                </>
            ),
        action:
            message.undo && undo !== undefined
                ? {
                      label: 'Annuler',
                      title: `Annuler (${shortcutLabel('undo', mac) ?? ''})`,
                      keyShortcuts: shortcutKeys('undo', mac),
                      onAction: undo,
                  }
                : undefined,
        returnFocus,
    };
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
    const weekdays = field('weekdays');
    const until = field('until');
    const rhythm = field('rhythm');

    return {
        ticket,
        comment,
        weekdays,
        until,
        rhythm,
        general:
            ticket === null && comment === null && weekdays === null && until === null && rhythm === null
                ? (outcome.violations[0]?.message ?? null)
                : null,
        focus: true,
    };
}

/**
 * Les quarts d'heure qu'écrirait la fenêtre : ceux de ce qu'elle vise, et, sur la question,
 * ceux qu'écrit l'une ou l'autre réponse — la même fois, ses morceaux compris.
 */
function writtenBy(shown: TicketWindow): readonly number[] {
    const action = shown.question?.action;

    return action === undefined
        ? quartersOf(shown.target)
        : [
              ...new Set([
                  ...quartersOf(shown.target),
                  ...action.once.changes.keys(),
                  ...action.following.changes.keys(),
              ]),
          ];
}

/**
 * Ce que Jira doit avoir dit du ticket tapé avant que la fenêtre parte. La question ne le
 * vérifie que si la réponse choisie écrit un autre ticket que celui du bloc : effacer, ou
 * arrêter sans changer le ticket, partent sans attendre Jira — un bloc qui revient dont Jira ne
 * connaît plus le ticket s'efface donc comme un autre.
 */
function checkOf(shown: TicketWindow, action: EntryAction, check: TicketCheck): TicketCheck | null {
    if (shown.question === undefined) {
        return check;
    }
    // Allonger écrit le ticket du bloc qui revient : rien de nouveau à vérifier.
    const reshaped = shown.question.action.reshapes?.content;
    const kept =
        reshaped === undefined
            ? normalizeTicket(draftOf(shown.target).ticket)
            : reshaped.kind === 'work'
              ? reshaped.ticket
              : null;
    const written = action.kind === 'write' || action.kind === 'recurrence' ? [...action.changes.values()] : [];

    return written.some((cell) => cell?.kind === 'work' && normalizeTicket(cell.ticket) !== kept) ? check : null;
}

/** La fenêtre avec ses champs, sans la question qui les remplaçait. */
function withoutQuestion(shown: TicketWindow): TicketWindow {
    if (shown.question === undefined) {
        return shown;
    }
    const fields: { -readonly [K in keyof TicketWindow]?: TicketWindow[K] } = { ...shown };
    delete fields.question;

    return fields as TicketWindow;
}
