import {
    type RefObject,
    useCallback,
    useEffect,
    useEffectEvent,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from 'react';

import { ErrorIcon } from '../components/icons';
import { Toast } from '../components/Toast';
import { tokenPixels } from '../components/tokenPixels';
import type { FavoriteList } from '../favorites/favoriteList';
import type { SelectionActions } from '../grid/actions';
import type { DayApi, DaySession, SessionSnapshot } from '../grid/daySession';
import { tabMemory } from '../grid/daySession';
import { DaySessions } from '../grid/daySessions';
import { dayFigures } from '../grid/figures';
import type { Grid } from '../grid/grid';
import * as Quarter from '../grid/quarter';
import { recap } from '../grid/recap';
import { NOTHING_SENT, type SendFailure } from '../grid/send';
import type { TabStorage } from '../grid/tabStore';
import { useTicketBook } from '../jira/TicketsContext';
import { ColumnVersion } from '../version/ColumnVersion';
import {
    dayLabel,
    dayTitle,
    isDate,
    isWorkingDay,
    lastOpenDay,
    monthOf,
    monthWeeks,
    nextWorkingDay,
    tenseOf,
    weekdayName,
} from './calendar';
import type { CalendarApi, CalendarMonth, DayMark } from './calendarApi';
import { ColumnResizer } from './ColumnResizer';
import { celebrate } from './confetti';
import { DayBar } from './DayBar';
import { DayGrid } from './DayGrid';
import { FavoritesColumn } from './FavoritesColumn';
import { figuresLine } from './figuresLine';
import { GridMenu } from './GridMenu';
import { leavesGrid } from './leavesGrid';
import { MonthCalendar } from './MonthCalendar';
import { ObjectiveWindow, type OpenWindow } from './ObjectiveWindow';
import { setPointerLength } from './pointerLength';
import { Recap } from './Recap';
import { readRecapOpen, writeRecapOpen } from './recapPreference';
import { type ScreenMemory, screenMemory } from './screenMemory';
import { emptyHintStart, openingTop } from './scroll';
import { SendButton } from './SendButton';
import { recapFates, SENDING_ANNOUNCE, sendButton, sendRows, type SendWindowKind } from './sendView';
import { SendWindow } from './SendWindow';
import { readSideWidth, sideBounds, writeSideWidth } from './sideWidth';
import { TicketWindow } from './TicketWindow';
import { type Favorites, useFavorites } from './useFavorites';
import { type BlockDropTarget, MESSAGE_DURATION, useGridEditing } from './useGridEditing';
import { useUserMoment } from './useUserMoment';

/** Ce que le serveur dit à la page (templates/app.html.twig). */
export interface DayConfig {
    /** Le jour de l'adresse, « AAAA-MM-JJ ». */
    readonly date: string;
    /** Le fuseau de l'utilisateur, celui du serveur (DAYTRACK_TIMEZONE). */
    readonly timezone: string;
    /** Combien de jours devant aujourd'hui s'ouvrent. */
    readonly futureDays: number;
    /**
     * Les jours travaillés des réglages au chargement de la page, en jours de la semaine
     * ISO : chaque journée lue les redit ensuite.
     */
    readonly workingDays: readonly number[];
}

/** À partir de cette largeur, le récapitulatif s'ouvre de lui-même. */
const RECAP_OPEN_QUERY = '(width >= 1440px)';

/** En dessous, il s'ouvre par-dessus la grille, et Échap le ferme : le même seuil que day.css et max-lg. */
const OVERLAY_QUERY = '(width < 1280px)';

/** Le temps entre deux lectures d'une journée qu'un autre onglet envoie. */
const SENDING_POLL = 2000;

/** Ce que l'ouverture d'un jour a donné : sa session, ou l'échec de sa lecture. */
type Opened = { readonly date: string } & (
    | {
          readonly session: DaySession;
          /** L'heure en haut de la vue quand la journée s'est ouverte : le message d'une journée vide s'y place. */
          readonly top: number;
      }
    | { readonly failed: true }
);

/**
 * L'écran Journée : la barre, la colonne de gauche, la grille et le récapitulatif.
 *
 * Le jour affiché est celui de l'adresse ; changer de jour l'y écrit, et les flèches du
 * navigateur y ramènent. Tout ce qui lit la journée passe par sa session : une réponse
 * arrivée après un changement de jour ne touche jamais la journée affichée.
 */
export function DayScreen({
    config,
    api,
    calendarApi,
    storage,
    favorites,
    leaveRef,
    readHabitual,
    onSettings,
    onUpdateToken,
    onJiraRefusal,
    onSendingChange,
}: {
    config: DayConfig;
    api: DayApi;
    /** Les marques du calendrier ; sans elle, le calendrier n'en porte aucune. */
    calendarApi?: CalendarApi | undefined;
    storage: TabStorage;
    favorites: FavoriteList;
    /** L'objectif habituel des réglages, relu quand la fenêtre Objectif du jour s'ouvre. */
    readHabitual?: (() => Promise<number>) | undefined;
    /** Ce qui enregistre les fenêtres ouvertes avant de quitter la journée ; la promesse dit si c'est fait. */
    leaveRef?: RefObject<() => Promise<boolean>>;
    /** Le bouton Réglages du pied de colonne. */
    onSettings?: () => void;
    /** « Mettre à jour le jeton », depuis le résultat d'un envoi que Jira a refusé. */
    onUpdateToken?: () => void;
    /** Un envoi a appris que Jira refuse le jeton : le bandeau le dit. */
    onJiraRefusal?: (refusal: Extract<SendFailure, 'refused' | 'missing_scope'>) => void;
    /** Un envoi part, ou finit : ce qui est hors de l'écran passe sous le voile. */
    onSendingChange?: (sending: boolean) => void;
}) {
    const sessions = useMemo(() => new DaySessions(api, tabMemory(storage)), [api, storage]);
    const memory = useMemo(() => screenMemory(storage), [storage]);
    const moment = useUserMoment(config.timezone);
    const [date, setDate] = useState(config.date);
    const [opened, setOpened] = useState<Opened | null>(null);
    const [recapOpen, setRecapOpen] = useState(
        () =>
            !window.matchMedia(OVERLAY_QUERY).matches &&
            (readRecapOpen(() => window.localStorage) ?? window.matchMedia(RECAP_OPEN_QUERY).matches),
    );
    const recapToggleRef = useRef<HTMLButtonElement>(null);
    const recapHideRef = useRef<HTMLButtonElement>(null);
    const titleRef = useRef<HTMLHeadingElement>(null);
    const laneRef = useRef<HTMLDivElement>(null);
    const listboxRef = useRef<HTMLDivElement>(null);
    const objectiveRef = useRef<HTMLButtonElement>(null);
    // La fenêtre Objectif du jour, ouverte sur un jour, et l'écart qui l'aligne sur la date.
    // Ce qui enregistre les fenêtres ouvertes, relu par les flèches du navigateur.
    const flushRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true));
    const objectiveFlushRef = useRef<OpenWindow | null>(null);
    // Le jour affiché, relu une fois les fenêtres enregistrées.
    const dateRef = useRef(date);
    useEffect(() => {
        dateRef.current = date;
    }, [date]);
    // La zone principale, où le menu de la grille se pose.
    const [main, setMain] = useState<HTMLElement | null>(null);
    const [objective, setObjective] = useState<{ date: string; alignOffset: number } | null>(null);
    // Le bouton à qui rendre le focus une fois le récapitulatif ouvert ou fermé.
    const focusAfterRef = useRef<RefObject<HTMLButtonElement | null> | null>(null);
    // Ce qui prend un bloc glissé hors de la grille : la liste des favoris.
    const blockDropRef = useRef<BlockDropTarget | null>(null);
    // Ce qui enregistre ce qui est ouvert à côté de la grille avant une fenêtre de ticket.
    const beforeWindowRef = useRef<(() => Promise<boolean>) | null>(null);
    // Ce qui enregistre les fenêtres ouvertes avant le formulaire d'un favori.
    const beforeFormRef = useRef<(() => Promise<boolean>) | null>(null);
    const { sideRef, side } = useSideWidth();
    // La fenêtre du bouton Jira, ouverte sur un jour, et l'envoi parti de cet onglet.
    const [sendWindow, setSendWindow] = useState<{ date: string; kind: SendWindowKind } | null>(null);
    const [sending, setSending] = useState(false);
    const sendRef = useRef<HTMLButtonElement>(null);
    const confettiRef = useRef<HTMLCanvasElement>(null);

    const tense = tenseOf(date, moment.date);
    const now = tense === 'today' ? moment.minute : null;
    const { scrollerRef, visibleTop } = useGridScroll(now, memory);

    useEffect(() => {
        let current = true;
        sessions.open(date).then(
            (session) => {
                if (current && session !== null) {
                    setOpened({ date, session, top: visibleTop() });
                }
            },
            () => {
                if (current) {
                    setOpened({ date, failed: true });
                }
            },
        );

        return () => {
            current = false;
        };
    }, [sessions, date, visibleTop]);

    // Les flèches du navigateur : le jour revient de l'adresse.
    useEffect(() => {
        const onPopState = () => {
            const path = window.location.pathname.slice(1);
            if (isDate(path)) {
                // Comme les flèches de la barre : les fenêtres ouvertes s'enregistrent
                // d'abord. Refusée, une fenêtre reste ouverte, et l'adresse revient au
                // jour qu'elle montre encore.
                void flushRef.current().then((closed) => {
                    if (closed) {
                        setDate(path);
                        setOpened(null);
                    } else {
                        window.history.pushState(null, '', `/${dateRef.current}`);
                    }
                });
            } else {
                window.location.reload();
            }
        };
        window.addEventListener('popstate', onPopState);

        return () => {
            window.removeEventListener('popstate', onPopState);
        };
    }, []);

    const last = lastOpenDay(moment.date, config.futureDays);

    // Ce qui vient d'un autre jour que celui affiché ne s'affiche pas.
    const shown = opened?.date === date ? opened : null;
    const session = shown !== null && 'session' in shown ? shown.session : null;
    const snapshot = useSnapshot(session);
    const day = snapshot?.day ?? null;

    // Les marques se relisent après chaque écriture, et après chaque envoi, qui ne change
    // pas la version de la journée.
    const { month, setMonth, marks, daysOff, monthDaysOff, monthWorkingDays } = useMonthMarks(
        calendarApi,
        date,
        moment.date,
        day === null ? null : `${String(day.version)} ${day.send.state}`,
    );

    // Les jours travaillés : ceux de la dernière réponse arrivée, la journée lue ou le
    // calendrier relu au retour sur l'onglet — un autre a pu changer les réglages.
    const [workingDays, setWorkingDays] = useState(config.workingDays);
    const [learned, setLearned] = useState<{ day: string | null; month: string | null }>({ day: null, month: null });
    const fromDay = day?.workingDays.join() ?? null;
    const fromMonth = monthWorkingDays?.join() ?? null;
    if (fromDay !== learned.day || fromMonth !== learned.month) {
        setLearned({ day: fromDay, month: fromMonth });
        const fresh =
            fromMonth !== learned.month ? monthWorkingDays : fromDay !== learned.day ? day?.workingDays : null;
        if (fresh != null && fresh.join() !== workingDays.join()) {
            setWorkingDays(fresh);
        }
    }
    // Où mènent les flèches de la barre : leur infobulle le dit.
    const previousDay = nextWorkingDay(date, -1, workingDays);
    const nextDay = nextWorkingDay(date, 1, workingDays);
    const canGoNext = nextDay <= last;

    // « Saisir quand même » ouvre un jour non travaillé — selon les réglages, ou mis à 0h00
    // — pour ce jour-là seulement, sans rien écrire : revenu plus tard sans saisie, on le
    // retrouve fermé, à 0h00 s'il l'était.
    const [openedAnyway, setOpenedAnyway] = useState<string | null>(null);
    if (openedAnyway !== null && openedAnyway !== date) {
        setOpenedAnyway(null);
    }
    // Pendant la lecture, un jour que les réglages ne travaillent pas, ou que le calendrier
    // sait mis à 0h00, se montre déjà fermé : la grille ne passe pas par le blanc avant le gris.
    const weekOff = !(day?.working ?? isWorkingDay(date, workingDays));
    const declaredOff = day?.declaredOff ?? monthDaysOff?.has(date) ?? false;
    // Vu avec une saisie, il reste ouvert tant qu'on y est, même mis à 0h00 ensuite :
    // effacer la dernière ne le ferme pas sous le curseur, et Ctrl+Z la rend.
    if (day !== null && day.grid.blocks().length > 0 && openedAnyway !== date) {
        setOpenedAnyway(date);
    }
    const closed =
        (weekOff || declaredOff) && (day === null || day.grid.blocks().length === 0) && openedAnyway !== date;
    const openAnywayRef = useRef(false);

    const hintStart = shown !== null && 'session' in shown ? emptyHintStart(shown.top, now, closed ? 4 : 2) : null;
    const figures =
        day === null
            ? null
            : figuresLine(dayFigures(day.grid, day.objective, now), day.objective, tense, day.working, day.declaredOff);
    const tickets = useMemo(() => (day === null ? null : recap(day.grid)), [day]);
    const send = day?.send ?? NOTHING_SENT;
    const sendView = sendButton(sending ? { ...send, state: 'sending' } : send);
    const openSend = sendWindow?.date === date ? sendWindow.kind : null;
    const rows = useMemo(
        () => (day === null || openSend === null ? [] : sendRows(recap(day.grid), day.send, openSend)),
        [day, openSend],
    );

    // Une journée qu'un autre onglet envoie se relit jusqu'à ce que l'envoi finisse, même
    // quand une lecture échoue et ne change rien.
    const sendingElsewhere = !sending && send.state === 'sending';
    const [polls, setPolls] = useState(0);
    useEffect(() => {
        if (session === null || !sendingElsewhere) {
            return;
        }
        const timer = window.setTimeout(() => {
            void session.refresh().then(() => {
                setPolls((count) => count + 1);
            });
        }, SENDING_POLL);

        return () => {
            window.clearTimeout(timer);
        };
    }, [session, sendingElsewhere, polls]);

    useEffect(() => {
        onSendingChange?.(sending);
    }, [onSendingChange, sending]);

    /**
     * Ouvre ou ferme le récapitulatif. Un bouton qui disparaît avec lui emporterait le
     * focus : il passe alors au bouton qui prend sa place.
     */
    const setRecap = (open: boolean) => {
        const overlay = window.matchMedia(OVERLAY_QUERY).matches;
        const focused = document.activeElement;
        const lost =
            focused !== null &&
            (open ? !overlay && focused === recapToggleRef.current : focused.closest('#recap') !== null);
        focusAfterRef.current = lost ? (open ? recapHideRef : recapToggleRef) : null;
        setRecapOpen(open);
        if (!overlay) {
            writeRecapOpen(() => window.localStorage, open);
        }
    };

    useEffect(() => {
        focusAfterRef.current?.current?.focus();
        focusAfterRef.current = null;
    }, [recapOpen]);

    // Sous 1280 px, le récapitulatif couvre la droite de la grille : une fenêtre ou le
    // menu passeraient dessous. Ils le ferment en s'ouvrant.
    const closeOverlayRecap = () => {
        if (recapOpen && window.matchMedia(OVERLAY_QUERY).matches) {
            setRecap(false);
        }
    };

    const editing = useGridEditing({
        session,
        day,
        laneRef,
        listboxRef,
        visibleTop,
        onWindowOpen: () => {
            closeOverlayRecap();
        },
        blockDropRef,
        beforeWindowRef,
        closed,
    });

    // « Saisir quand même » disparaît avec la grille fermée : le curseur, perdu, va à la grille.
    useEffect(() => {
        if (!closed && openAnywayRef.current) {
            openAnywayRef.current = false;
            editing.focusGrid();
        }
    });

    // Une grille fermée ne prend pas le curseur : ce qui le lui rendrait — une fenêtre restée
    // ouverte pendant qu'elle se fermait, un message — le donne à « Saisir quand même », dès
    // qu'il paraît.
    const openAnywayButtonRef = useRef<HTMLButtonElement>(null);
    const focusOpenAnywayRef = useRef(false);
    const returnFocus = () => {
        if (!closed) {
            editing.focusGrid();
        } else if (openAnywayButtonRef.current !== null) {
            openAnywayButtonRef.current.focus();
        } else {
            focusOpenAnywayRef.current = true;
        }
    };
    useEffect(() => {
        if (focusOpenAnywayRef.current && openAnywayButtonRef.current !== null) {
            focusOpenAnywayRef.current = false;
            openAnywayButtonRef.current.focus();
        }
    });

    const favoriteGestures = useFavorites({ list: favorites, editing, laneRef, blockDropRef, beforeFormRef });
    const drag = favoriteGestures.drag;

    // Les titres de plus d'une heure se relisent dans Jira, une fois la journée affichée,
    // puis ceux des favoris quand leur liste change : l'écran ne les attend pas.
    const book = useTicketBook();
    useEffect(() => {
        if (session !== null) {
            void book?.refresh(ticketsOfGrid(session.current().day.grid));
        }
    }, [book, session]);
    const favoriteTickets = [...new Set(favoriteGestures.snapshot.favorites?.map((favorite) => favorite.ticket))]
        .sort()
        .join(' ');
    useEffect(() => {
        if (favoriteTickets !== '') {
            void book?.refresh(favoriteTickets.split(' '));
        }
    }, [book, favoriteTickets]);

    /**
     * Les fenêtres ouvertes s'enregistrent avant de changer de jour, comme sur un clic à
     * côté : le jour qu'on quitte les fermerait sans rien garder. Une fenêtre refusée
     * reste ouverte, avec son message, et le jour aussi.
     */
    const flushWindows = async (leavingPage = false): Promise<boolean> =>
        (await editing.flushWindow(leavingPage)) && (await flushBesideGrid());
    /** L'objectif et le formulaire d'un favori : ce qui s'enregistre à côté de la fenêtre de ticket. */
    const flushBesideGrid = async (): Promise<boolean> =>
        (await (objectiveFlushRef.current?.save() ?? Promise.resolve(true))) && (await favoriteGestures.leave());
    const besideGridOpen = objective?.date === date || favoriteGestures.form !== null;
    useEffect(() => {
        flushRef.current = () => flushWindows();
        beforeWindowRef.current = besideGridOpen ? flushBesideGrid : null;
        beforeFormRef.current =
            editing.window === null && objective?.date !== date
                ? null
                : async () =>
                      (await editing.flushWindow()) &&
                      (await (objectiveFlushRef.current?.save() ?? Promise.resolve(true)));
        if (leaveRef !== undefined) {
            leaveRef.current = () => flushWindows();
        }
    });

    // Quitter la page — la flèche du navigateur vers un jour ouvert par son adresse, un
    // rechargement, l'onglet fermé — emporterait ce qu'une fenêtre ouverte n'a pas
    // encore enregistré. Elle s'enregistre, comme sur un clic à côté, et le navigateur
    // demande s'il faut partir : refusée, on reste, et la fenêtre dit pourquoi.
    const onBeforeUnload = useEffectEvent((event: BeforeUnloadEvent) => {
        if (!editing.unsavedWindow() && objectiveFlushRef.current?.unsaved() !== true) {
            return;
        }
        event.preventDefault();
        void flushWindows(true);
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

    /** Le bouton Jira : la fenêtre que son état ouvre, ou la referme. */
    const onSendButton = () => {
        const opens = sendView.opens;
        if (opens === null) {
            return;
        }
        if (openSend !== null) {
            setSendWindow(null);

            return;
        }
        // Une fenêtre de ticket ouverte s'enregistre d'abord, comme sur un clic à côté :
        // la confirmation montre la journée telle qu'elle partira.
        void flushWindows().then((closed) => {
            if (closed) {
                closeOverlayRecap();
                setSendWindow({ date: dateRef.current, kind: opens });
            }
        });
    };

    /**
     * Envoie la journée affichée. Le voile bloque l'écran jusqu'à la réponse : la journée
     * envoyée est celle qu'on voit. Tout est arrivé, les confettis partent ; sinon la
     * fenêtre du résultat s'ouvre d'elle-même.
     */
    const startSend = () => {
        if (session === null || sending) {
            return;
        }
        const sent = session;
        setSendWindow(null);
        setSending(true);
        void sent.sendToJira().then((outcome) => {
            setSending(false);
            const status = sent.current().day.send;
            if (dateRef.current !== sent.date) {
                return;
            }
            if (outcome.kind === 'stale') {
                editing.notify({ content: "La journée a changé entre-temps. Rien n'a été envoyé." });

                return;
            }
            if (status.failure === 'refused' || status.failure === 'missing_scope') {
                onJiraRefusal?.(status.failure);
            }
            if (status.state === 'partial' || status.state === 'unverified' || status.state === 'failed') {
                setSendWindow({ date: sent.date, kind: 'result' });
            } else if (status.state === 'sent' && outcome.kind === 'done') {
                const button = sendRef.current;
                const canvas = confettiRef.current;
                if (button !== null && canvas !== null) {
                    celebrate(canvas, button.getBoundingClientRect(), !recapOpen);
                }
            } else if (outcome.kind === 'failed' && status.state !== 'sending') {
                editing.notify({ content: "L'envoi n'a pas abouti. Réessayez." });
            }
        });
    };

    /**
     * Change de jour, une fois les fenêtres enregistrées.
     *
     * @param left ce qui ne doit arriver que si on quitte vraiment les fenêtres : refusée, une
     *             fenêtre garde le jour affiché, et ce qui l'entoure
     */
    const go = (next: string, left?: () => void) => {
        if (next > last || (next === date && left === undefined)) {
            return;
        }
        void flushWindows().then((closed) => {
            if (!closed) {
                return;
            }
            left?.();
            if (dateRef.current === next) {
                return;
            }
            window.history.pushState(null, '', `/${next}`);
            setDate(next);
            // La session du jour qu'on quitte se ferme : revenir dessus avant que
            // l'autre jour ne soit lu ne doit pas la remontrer.
            setOpened(null);
        });
    };

    // Échap ferme d'abord ce qui est ouvert — une fenêtre, un menu, une infobulle, puis le
    // récapitulatif quand il couvre la grille —, et vide ensuite la sélection de la
    // grille, d'où que soit le curseur. Les écouteurs sont posés une fois, et lisent
    // l'état courant.
    const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
        if (event.key !== 'Escape' || event.defaultPrevented) {
            return;
        }
        // Une fenêtre du bouton Jira se ferme d'abord, par sa croix ou Échap (Popover).
        if (openSend !== null) {
            return;
        }
        if (recapOpen && window.matchMedia(OVERLAY_QUERY).matches) {
            event.preventDefault();
            setRecap(false);
        } else if (editing.deselect()) {
            event.preventDefault();
        }
    });
    // Un clic dans la colonne des favoris ou dans le récapitulatif quitte la grille. Une
    // fenêtre ouverte le prend pour elle : c'est un clic à côté, qui l'enregistre.
    const onMouseDown = useEffectEvent((event: MouseEvent) => {
        if (editing.window === null && objective?.date !== date && leavesGrid(event)) {
            editing.deselect();
        }
    });
    // Pendant un envoi, le clavier ne fait rien d'autre que passer d'un élément à l'autre :
    // ni Échap, ni annuler, ni un raccourci de la grille. Le voile retient la souris.
    const onSendingKey = useEffectEvent((event: KeyboardEvent) => {
        if (sending && event.key !== 'Tab') {
            event.preventDefault();
            event.stopPropagation();
        }
    });
    useEffect(() => {
        const listener = (event: KeyboardEvent) => {
            onSendingKey(event);
        };
        window.addEventListener('keydown', listener, true);

        return () => {
            window.removeEventListener('keydown', listener, true);
        };
    }, []);

    useEffect(() => {
        const keyListener = (event: KeyboardEvent) => {
            onKeyDown(event);
        };
        const mouseListener = (event: MouseEvent) => {
            onMouseDown(event);
        };
        window.addEventListener('keydown', keyListener);
        window.addEventListener('mousedown', mouseListener);

        return () => {
            window.removeEventListener('keydown', keyListener);
            window.removeEventListener('mousedown', mouseListener);
        };
    }, []);

    return (
        <div
            ref={sideRef}
            className="day-screen group relative flex h-full overflow-clip bg-bg text-ink"
            data-recap={recapOpen ? 'open' : 'closed'}
            aria-busy={sending || undefined}
        >
            <div className="relative flex min-w-0 flex-1 flex-col">
                <DayBar
                    title={dayTitle(date)}
                    figures={figures}
                    previousTip={dayLabel(previousDay)}
                    nextTip={dayLabel(nextDay)}
                    canGoNext={canGoNext}
                    recapOpen={recapOpen}
                    recapToggleRef={recapToggleRef}
                    titleRef={titleRef}
                    objectiveRef={objectiveRef}
                    objectiveOpen={objective?.date === date}
                    onObjective={() => {
                        // Fenêtre ouverte, recliquer sur l'objectif est un clic à côté :
                        // elle s'enregistre, et ne se ferme que si c'est accepté.
                        if (objective?.date === date) {
                            void objectiveFlushRef.current?.save();

                            return;
                        }
                        const open = () => {
                            const button = objectiveRef.current?.getBoundingClientRect().left ?? 0;
                            const title = titleRef.current?.getBoundingClientRect().left ?? button;
                            setObjective({ date, alignOffset: title - button });
                            closeOverlayRecap();
                        };
                        // Ce qui est ouvert s'enregistre d'abord. Refusé, il reprend le curseur,
                        // et cet objectif, qui venait de le prendre, s'enregistrerait tout seul.
                        if (editing.window === null && favoriteGestures.form === null) {
                            open();
                        } else {
                            void flushWindows().then((closed) => {
                                if (closed) {
                                    open();
                                }
                            });
                        }
                    }}
                    onToday={() => {
                        // Déjà sur aujourd'hui, il ramène quand même le calendrier à son mois.
                        go(moment.date, () => {
                            setMonth(monthOf(moment.date));
                        });
                    }}
                    onPrevious={() => {
                        go(previousDay);
                    }}
                    onNext={() => {
                        go(nextDay);
                    }}
                    onToggleRecap={() => {
                        setRecap(!recapOpen);
                    }}
                    sending={sending}
                    sendButton={
                        <SendButton
                            ref={sendRef}
                            view={sendView}
                            open={openSend !== null}
                            hidden={day === null}
                            onClick={onSendButton}
                        />
                    }
                />
                <div inert={sending} className="flex min-h-0 flex-1">
                    <FavoritesColumn
                        favorites={favoriteGestures}
                        resizer={side === null ? null : <ColumnResizer {...side} />}
                        calendar={
                            <MonthCalendar
                                month={month}
                                shown={date}
                                today={moment.date}
                                last={last}
                                workingDays={workingDays}
                                marks={marks}
                                daysOff={daysOff}
                                onMonth={setMonth}
                                onOpen={(day) => {
                                    go(day);
                                }}
                            />
                        }
                        version={
                            <ColumnVersion
                                beforeOpen={async () => {
                                    const closed = await flushWindows();
                                    if (closed) {
                                        closeOverlayRecap();
                                    }

                                    return closed;
                                }}
                            />
                        }
                        onSettings={onSettings}
                    />
                    <main ref={setMain} className="relative flex min-w-0 flex-1 flex-col">
                        <DayGrid
                            hintStart={hintStart}
                            drop={
                                drag?.kind === 'favorite' && drag.quarter !== null
                                    ? { ticket: drag.favorite.ticket, quarter: drag.quarter }
                                    : null
                            }
                            scrollerRef={scrollerRef}
                            laneRef={laneRef}
                            listboxRef={listboxRef}
                            grid={day?.grid ?? null}
                            loading={shown === null}
                            busy={snapshot?.busy ?? false}
                            now={now}
                            editing={editing}
                            onMenuOpen={() => {
                                // Le menu pourrait passer sous le message d'un geste : il s'en va.
                                editing.dismissMessage();
                                closeOverlayRecap();
                            }}
                            openAnywayRef={openAnywayButtonRef}
                            offDay={
                                closed
                                    ? {
                                          reason: weekOff
                                              ? `${weekdayName(date)} n'est pas un jour travaillé.`
                                              : "Avec un objectif à 0h00, ce jour n'est pas travaillé.",
                                          onOpen: () => {
                                              openAnywayRef.current = true;
                                              setOpenedAnyway(date);
                                          },
                                      }
                                    : null
                            }
                            menu={
                                <GridMenu
                                    selection={editing.selection}
                                    actions={withoutKnownFavorite(editing.actions(), favoriteGestures)}
                                    mac={editing.mac}
                                    onNewTicket={editing.newTicket}
                                    onEditSelection={editing.editSelection}
                                    onCopy={editing.copy}
                                    onCut={editing.cut}
                                    onPaste={editing.paste}
                                    onPause={editing.convertToPause}
                                    onFavorite={(ticket) => {
                                        favoriteGestures.addTicket(ticket, 0);
                                    }}
                                    onClear={editing.clear}
                                    container={main}
                                    returnFocus={returnFocus}
                                />
                            }
                        />
                        <Toast
                            message={editing.message}
                            duration={MESSAGE_DURATION}
                            onDismiss={editing.dismissMessage}
                            returnFocus={returnFocus}
                        />
                        {shown !== null && 'failed' in shown && (
                            <p
                                role="alert"
                                className="absolute inset-0 m-auto flex h-fit w-fit items-center gap-2 font-medium text-inc"
                            >
                                <ErrorIcon />
                                Cette journée ne se lit pas. Rechargez la page.
                            </p>
                        )}
                    </main>
                </div>
            </div>
            <div inert={sending} className="contents">
                <Recap
                    tickets={tickets}
                    open={recapOpen}
                    hideRef={recapHideRef}
                    onClose={() => {
                        setRecap(false);
                    }}
                    fates={recapFates(tickets ?? [], send)}
                />
            </div>
            {sending && <div aria-hidden="true" className="send-veil" />}
            <canvas ref={confettiRef} aria-hidden="true" className="send-confetti" />
            {/* Une zone à part, sans rôle : celle du message de la grille reste la seule « status » de l'écran. */}
            <p aria-live="polite" className="sr-only">
                {sending ? SENDING_ANNOUNCE : ''}
            </p>
            {day !== null && (
                <SendWindow
                    kind={openSend}
                    date={date}
                    status={day.send}
                    rows={rows}
                    worked={dayFigures(day.grid, day.objective, null).worked}
                    hasPause={day.grid.blocks().some((block) => block.content.kind === 'pause')}
                    anchor={sendRef}
                    onClose={() => {
                        setSendWindow(null);
                    }}
                    onSend={startSend}
                    onUpdateToken={() => {
                        setSendWindow(null);
                        onUpdateToken?.();
                    }}
                    returnFocus={() => {
                        sendRef.current?.focus();
                    }}
                />
            )}
            <TicketWindow
                date={date}
                window={editing.window}
                note={editing.windowNote}
                place={editing.placeWindow}
                gridRef={laneRef}
                checkRef={editing.windowCheckRef}
                onDraft={editing.setDraft}
                onSave={editing.saveWindow}
                onCancel={editing.cancelWindow}
                onPause={editing.pauseWindow}
                onDelete={editing.deleteWindow}
                onCheckTicket={editing.checkTicket}
                returnFocus={returnFocus}
            />
            <ObjectiveWindow
                open={objective?.date === date}
                session={session}
                day={day}
                now={now}
                tense={tense}
                anchor={objectiveRef}
                alignOffset={objective?.alignOffset ?? 0}
                flushRef={objectiveFlushRef}
                readHabitual={readHabitual}
                onClose={() => {
                    setObjective(null);
                }}
            />
        </div>
    );
}

/**
 * La largeur de la colonne de gauche, réglée par son bord : posée sur l'écran, que la
 * colonne et la zone du logo lisent (day.css). Elle se retient une fois le geste fini ;
 * un double-clic sur le bord l'oublie.
 */
function useSideWidth(): {
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

/**
 * Le mois du calendrier et ses marques. Il suit le jour affiché ; ses flèches le
 * changent sans changer de jour. Les marques se relisent à chaque changement de mois,
 * après chaque écriture de la journée, à minuit, et au retour sur l'onglet, qu'un autre
 * a pu changer. Une réponse arrivée après un autre mois ne s'affiche pas.
 */
function useMonthMarks(
    api: CalendarApi | undefined,
    date: string,
    today: string,
    /** Change à chaque écriture de la journée et à chaque envoi : les marques se relisent. */
    version: string | null,
): {
    month: string;
    setMonth: (month: string) => void;
    marks: ReadonlyMap<string, DayMark> | null;
    /** Les jours mis à 0h00 du mois affiché, null tant qu'ils ne sont pas lus. */
    daysOff: ReadonlySet<string> | null;
    /** Ceux de la dernière lecture, quel qu'en soit le mois : ses six semaines débordent. */
    monthDaysOff: ReadonlySet<string> | null;
    /** Les jours travaillés de la dernière lecture, quel qu'en soit le mois. */
    monthWorkingDays: readonly number[] | null;
} {
    const [month, setMonth] = useState(() => monthOf(date));
    const [monthOfDate, setMonthOfDate] = useState(date);
    if (monthOfDate !== date) {
        setMonthOfDate(date);
        setMonth(monthOf(date));
    }
    const [read, setRead] = useState<{ month: string; read: CalendarMonth } | null>(null);
    const [visits, setVisits] = useState(0);

    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState === 'visible') {
                setVisits((count) => count + 1);
            }
        };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', onVisible);

        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('focus', onVisible);
        };
    }, []);

    useEffect(() => {
        if (api === undefined) {
            return;
        }
        let current = true;
        const weeks = monthWeeks(month);
        const from = weeks[0]?.[0];
        const to = weeks.at(-1)?.[6];
        if (from === undefined || to === undefined) {
            return;
        }
        api.marks(from, to).then(
            (calendar) => {
                if (current) {
                    setRead({ month, read: calendar });
                }
            },
            () => {
                // Sans réponse, le calendrier garde ce qu'il montrait jusqu'à la prochaine
                // lecture.
            },
        );

        return () => {
            current = false;
        };
    }, [api, month, today, version, visits]);

    return {
        month,
        setMonth,
        marks: read?.month === month ? read.read.marks : null,
        daysOff: read?.month === month ? read.read.daysOff : null,
        monthDaysOff: read?.read.daysOff ?? null,
        monthWorkingDays: read?.read.workingDays ?? null,
    };
}

/** L'état de la journée affichée, suivi geste après geste. */
function useSnapshot(session: DaySession | null): SessionSnapshot | null {
    const subscribe = useCallback(
        (listener: () => void) => session?.subscribe(listener) ?? (() => undefined),
        [session],
    );

    return useSyncExternalStore(subscribe, () => session?.current() ?? null);
}

/**
 * Place la grille une fois, à l'ouverture de l'écran : là où l'onglet l'avait
 * laissée, sinon selon openingTop. Ensuite, elle ne bouge plus d'elle-même — passer
 * d'un jour à l'autre garde sa position —, et l'onglet retient où on la laisse.
 *
 * visibleTop lit l'heure en haut de la vue, au moment où on l'appelle.
 */
function useGridScroll(
    now: number | null,
    memory: ScreenMemory,
): { scrollerRef: RefObject<HTMLDivElement | null>; visibleTop: () => number } {
    const scrollerRef = useRef<HTMLDivElement>(null);
    const openingRef = useRef({ now, memory });

    const visibleTop = useCallback(() => {
        const element = scrollerRef.current;

        return element === null ? Quarter.FIRST : gridScale(element).viewTop(element.scrollTop);
    }, []);

    useLayoutEffect(() => {
        const element = scrollerRef.current;
        if (element === null) {
            return;
        }
        const { toMinutes, toPixels, visibleMinutes } = gridScale(element);
        const { now: openedAt, memory: tab } = openingRef.current;

        element.scrollTop = toPixels(tab.gridTop() ?? openingTop(openedAt, visibleMinutes));

        // La position posée à l'ouverture n'est pas un choix de l'utilisateur : elle ne
        // se retient pas, et un rechargement plus tard dans la journée la recalcule.
        // Seul ce qu'il fait défiler ensuite se retient.
        const opened = element.scrollTop;
        let moved = false;
        let frame = 0;
        const onScroll = () => {
            if (!moved && element.scrollTop === opened) {
                return;
            }
            moved = true;
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                tab.setGridTop(toMinutes(element.scrollTop));
            });
        };
        element.addEventListener('scroll', onScroll, { passive: true });

        return () => {
            cancelAnimationFrame(frame);
            element.removeEventListener('scroll', onScroll);
        };
    }, []);

    return { scrollerRef, visibleTop };
}

/**
 * Le passage des pixels de la zone qui défile aux heures de la grille. La grille
 * commence sous une marge, qui laisse voir en entier l'heure de 07:00 : au défilement
 * 0, le haut de la vue est un peu avant 07:00.
 */
function gridScale(element: HTMLElement): {
    toMinutes: (scrollTop: number) => number;
    toPixels: (minutes: number) => number;
    viewTop: (scrollTop: number) => number;
    visibleMinutes: number;
} {
    const row = Number.parseFloat(getComputedStyle(element).getPropertyValue('--h-row'));
    const content = element.firstElementChild;
    const margin = content === null ? 0 : Number.parseFloat(getComputedStyle(content).paddingTop);

    return {
        // Le défilement qui montre une heure en entier, sa marge au-dessus, et l'heure
        // qu'un défilement montre ainsi : c'est la position que l'onglet retient.
        toPixels: (minutes) => ((minutes - Quarter.FIRST) / Quarter.MINUTES) * row,
        toMinutes: (scrollTop) => Quarter.FIRST + (scrollTop / row) * Quarter.MINUTES,
        // L'heure au bord haut de la vue, marge comprise.
        viewTop: (scrollTop) => Quarter.FIRST + ((scrollTop - margin) / row) * Quarter.MINUTES,
        visibleMinutes: ((element.clientHeight - margin) / row) * Quarter.MINUTES,
    };
}

/** Les tickets d'une journée, chacun une fois. */
function ticketsOfGrid(grid: Grid): string[] {
    return [
        ...new Set(grid.blocks().flatMap((block) => (block.content.kind === 'work' ? [block.content.ticket] : []))),
    ];
}

/**
 * « Ajouter aux favoris » grisé quand le ticket de la sélection y est déjà : un ticket
 * n'y est jamais ajouté deux fois, et ce qui ne servirait à rien est grisé.
 */
function withoutKnownFavorite(actions: SelectionActions, favorites: Favorites): SelectionActions {
    return actions.favorite !== null && favorites.has(actions.favorite) ? { ...actions, favorite: null } : actions;
}
