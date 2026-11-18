import {
    act,
    type ReactNode,
    type RefObject,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useSyncExternalStore,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { DayGrid } from '../../../assets/day/DayGrid';
import { GridMenu } from '../../../assets/day/GridMenu';
import {
    initialRecurrence,
    linkedRecurrence,
    type RecurrenceDraft,
    saveBlocked,
} from '../../../assets/day/recurrenceDraft';
import { useTicketField } from '../../../assets/day/TicketField';
import { TicketWindow } from '../../../assets/day/TicketWindow';
import { type FavoriteDrag, useFavorites } from '../../../assets/day/useFavorites';
import {
    type BlockDropTarget,
    type GridEditing,
    type PlacedWindow,
    type ScopeChoice,
    useGridEditing,
    type WindowQuestion,
} from '../../../assets/day/useGridEditing';
import { FavoriteList } from '../../../assets/favorites/favoriteList';
import { type SlotChange, toSlotChanges } from '../../../assets/grid/changes';
import {
    type DayApi,
    DaySession,
    type SendOutcome,
    type SessionSnapshot,
    type TabMemory,
    tabMemory,
} from '../../../assets/grid/daySession';
import { draftOf } from '../../../assets/grid/entry';
import { unlinked } from '../../../assets/grid/grid';
import * as Quarter from '../../../assets/grid/quarter';
import type { RecurrenceRule } from '../../../assets/grid/recurrence';
import type { JiraApi, LookupResult } from '../../../assets/jira/jiraApi';
import { JiraStatus } from '../../../assets/jira/jiraStatus';
import { TicketBook } from '../../../assets/jira/ticketBook';
import { TicketsProvider } from '../../../assets/jira/TicketsContext';
import type { Tint } from '../../../assets/settings/tints';
import type { TicketCheck } from '../../../assets/jira/useTicketLookup';
import { FakeFavoritesServer } from '../favorites/fakeFavoritesServer';
import { FakeDayServer, type Request } from '../grid/fakeDayServer';
import { memoryStorage, type Range, rangesOf, weeklyRule } from '../grid/support';

/**
 * Les gestes de la grille, sans navigateur : useGridEditing monté sur une vraie
 * DaySession et le faux serveur des journées, avec un serveur et un Jira qui tardent
 * quand on veut. C'est ce qui rend les croisements déterministes : un effacement fait
 * pendant qu'une fenêtre s'enregistre, une fenêtre demandée pendant qu'un collage est en
 * route, un menu ou un « Annuler » qui arrive au mauvais moment.
 *
 * Deux montages :
 * - mountGrid, le crochet seul, sous une colonne et une liste de créneaux nues : les
 *   gestes y arrivent comme l'écran les reçoit — appuis, touches, menu —, et la fenêtre
 *   de ticket y est réduite à ce qu'elle fait des gestes (WindowStandIn) ;
 * - mountScreen, la vraie grille, son vrai menu et la vraie fenêtre de ticket ; avec des
 *   favoris, leur colonne réduite à ses cartes, qu'on glisse vers la grille.
 *
 * Ce que l'écran réel ajoute — Radix, le focus, le pointeur — reste prouvé dans Chromium
 * (tests/e2e/) ; ici se prouve l'ordre des gestes.
 */

// React vérifie que ses rendus de test passent par act().
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Ce que jsdom ne fait pas, et dont la grille et Radix se servent : il ne dessine ni ne
// mesure rien.
if (typeof globalThis.requestAnimationFrame !== 'function') {
    globalThis.requestAnimationFrame = (callback) =>
        setTimeout(() => {
            callback(0);
        }, 16) as unknown as number;
    globalThis.cancelAnimationFrame = (id) => {
        clearTimeout(id);
    };
}
const drawable = Element.prototype as Partial<Pick<Element, 'scrollIntoView'>>;
drawable.scrollIntoView ??= () => undefined;
(globalThis as Partial<Pick<typeof globalThis, 'ResizeObserver'>>).ResizeObserver ??= class {
    observe(): void {
        // Rien ne change de taille.
    }
    unobserve(): void {
        // Rien n'est observé.
    }
    disconnect(): void {
        // Rien n'est observé.
    }
};

/** Un mardi : la journée est travaillée. */
export const DATE = '2026-10-06';

/** La colonne des blocs : un quart d'heure fait 20 px, 07:00 en haut, à 0. */
const ROW = 20;
const LANE = { top: 0, left: 0, width: 400, height: Quarter.COUNT * ROW };

/** La colonne des favoris, à gauche de la grille, et l'horizontale de ses cartes. */
const SIDE = { top: 0, left: -300, width: 250, height: LANE.height };
const CARD_X = -200;

/** L'écart, en pixels, qu'un appui sur un favori doit parcourir pour devenir un glisser (--s-1). */
const DRAG_THRESHOLD = 4;

function rectOf(box: { top: number; left: number; width: number; height: number }): () => DOMRect {
    return () => ({
        ...box,
        right: box.left + box.width,
        bottom: box.top + box.height,
        x: box.left,
        y: box.top,
        toJSON: () => box,
    });
}

const laneRect = rectOf(LANE);

/** Le milieu d'un quart d'heure dans la fenêtre du navigateur. */
function yOf(quarter: number): number {
    return LANE.top + ((quarter - Quarter.FIRST) / Quarter.MINUTES) * ROW + ROW / 2;
}

function quarterOfY(clientY: number): number {
    return Quarter.FIRST + Math.floor((clientY - LANE.top) / ROW) * Quarter.MINUTES;
}

/** Des réponses qu'on retient, puis qu'on lâche une à une ou toutes ensemble, dans l'ordre. */
export class Held {
    private holding = false;
    private readonly waiting: (() => void)[] = [];

    /** Les réponses arrivées pendant qu'on retient attendent qu'on les lâche. */
    hold(): void {
        this.holding = true;
    }

    /** Ne retient plus, et lâche tout ce qui attendait. */
    release(): void {
        this.holding = false;
        this.waiting.splice(0).forEach((answer) => {
            answer();
        });
    }

    /** Lâche la plus ancienne réponse retenue ; faux s'il n'y en avait pas. */
    releaseOne(): boolean {
        const answer = this.waiting.shift();
        answer?.();

        return answer !== undefined;
    }

    get holds(): boolean {
        return this.holding;
    }

    /** Les réponses qui attendent qu'on les lâche. */
    get count(): number {
        return this.waiting.length;
    }

    carry<T>(result: () => T): Promise<T> {
        if (!this.holding) {
            return Promise.resolve(result());
        }

        return new Promise((resolve) => {
            this.waiting.push(() => {
                resolve(result());
            });
        });
    }
}

/**
 * Le serveur des journées, qui reçoit chaque requête quand elle part et peut retenir sa
 * réponse. Il sait aussi perdre une écriture avant qu'elle l'atteigne, comme un réseau
 * coupé.
 */
export class SlowServer extends Held {
    readonly server: FakeDayServer;
    readonly api: DayApi;
    /** Chaque requête partie de l'écran, dans l'ordre : celles que le serveur refuse comprises. */
    readonly requests: Request[] = [];
    private lost = 0;

    constructor(server = new FakeDayServer()) {
        super();
        this.server = server;
        this.api = server.api((request, handle) => this.send(request, handle));
    }

    /** Les `count` prochaines écritures de créneaux n'atteignent pas le serveur. */
    lose(count = 1): void {
        this.lost = count;
    }

    /** Les blocs de la journée en base. */
    ranges(): Range[] {
        return rangesOf(this.server.read(DATE).grid);
    }

    private send<T>(request: Request, handle: () => T): Promise<T> {
        this.requests.push(request);
        if (this.lost > 0 && (request.kind === 'changeSlots' || request.kind === 'saveRecurrence')) {
            this.lost -= 1;

            return Promise.reject(new TypeError('Failed to fetch'));
        }
        const result = handle();

        return this.carry(() => result);
    }
}

/**
 * Jira, vu de l'écran : il connaît tous les tickets sauf ceux qu'on lui dit, et retient ses
 * réponses quand on veut. L'écran ne connaît un ticket qu'une fois que Jira l'a trouvé.
 */
export class SlowJira extends Held {
    readonly book: TicketBook;
    /** Les tickets que Jira ne connaît pas. */
    readonly missing = new Set(['SHOP-999']);
    /** La teinte du type de chaque ticket : vert, sauf ceux qu'on lui dit. */
    readonly colors = new Map<string, Tint>();
    lookups = 0;

    constructor() {
        super();
        const api = {
            lookup: (ticket: string) => this.lookup(ticket),
            connection: () => Promise.resolve(null),
        } as unknown as JiraApi;
        this.book = new TicketBook(api, new JiraStatus(api, { state: 'connected', missingScopes: [] }));
    }

    private lookup(ticket: string): Promise<LookupResult> {
        this.lookups += 1;

        return this.carry(() =>
            this.missing.has(ticket)
                ? { status: 'not_found' }
                : {
                      status: 'found',
                      ticket: { title: `Titre de ${ticket}`, type: 'Story', color: this.colors.get(ticket) ?? 'vert' },
                  },
        );
    }
}

/**
 * Ce que la fenêtre de ticket fait des gestes, sans son apparence ni Radix (TicketWindow.tsx,
 * Popover.tsx) : elle dit au crochet ce que Jira sait du ticket tapé, Entrée l'enregistre
 * quand elle le permet, un appui à côté l'enregistre sauf pendant un envoi, et Échap, d'où
 * que soit le curseur, est pour elle : il la ferme sauf pendant un envoi — ou, sur la
 * question posée par ses champs, les rend —, et ne vide pas la sélection de la grille. Sur la
 * question « quelles fois », Entrée valide le choix, comme le bouton de droite.
 */
interface WindowGestures {
    enter(): void;
    outside(): void;
    /** Le bouton de droite du pied : Enregistrer, Arrêter ou Effacer. */
    save(): void;
}

const NO_WINDOW: WindowGestures = { enter: () => undefined, outside: () => undefined, save: () => undefined };

function WindowStandIn({
    session,
    editing,
    checkRef,
    gesturesRef,
}: {
    session: DaySession;
    editing: GridEditing;
    checkRef: RefObject<TicketCheck>;
    gesturesRef: RefObject<WindowGestures>;
}) {
    const shown = editing.window;
    const day = useSyncExternalStore(
        (listener) => session.subscribe(listener),
        () => session.current().day,
    );
    // Le même champ Ticket que TicketWindow : un bloc qui garde son ticket n'attend Jira que
    // s'il le cherche encore.
    const { check } = useTicketField(
        shown?.draft.ticket ?? '',
        shown === null ? '' : draftOf(shown.target).ticket,
        checkRef,
    );
    // Comme TicketWindow : une pause sans ticket s'enregistre quand sa case « Récurrence » a
    // changé, mais pas avec un commentaire, et une récurrence sans jour ne s'enregistre pas
    // par Entrée.
    const initial = shown === null ? null : initialRecurrence(shown.target, day);
    useEffect(() => {
        // Sur la question, c'est le crochet qui juge si la réponse attend Jira : effacer n'écrit
        // pas de ticket.
        const save = () => {
            if (shown?.question !== undefined || !check.refused) {
                editing.saveWindow(check);
            }
        };
        gesturesRef.current =
            shown === null
                ? NO_WINDOW
                : {
                      enter: () => {
                          // Sur la question, Entrée valide le choix, sans rien juger des champs.
                          if (shown.question !== undefined) {
                              save();

                              return;
                          }
                          const blocked = saveBlocked(
                              shown.target,
                              shown.draft,
                              editing.windowRecurrence,
                              initial,
                              day.date,
                              day.workingDays,
                          );
                          if (!blocked && !check.refused) {
                              save();
                          }
                      },
                      outside: () => {
                          if (!shown.sending) {
                              save();
                          }
                      },
                      save,
                  };
    });
    // Comme Radix, qui l'écoute sur tout le document, avant tout le reste.
    useEffect(() => {
        if (shown === null) {
            return undefined;
        }
        const onEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') {
                return;
            }
            event.preventDefault();
            if (!shown.sending) {
                editing.cancelWindow();
            }
        };
        document.addEventListener('keydown', onEscape, true);

        return () => {
            document.removeEventListener('keydown', onEscape, true);
        };
    });

    return null;
}

type Modifiers = Pick<KeyboardEventInit, 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey' | 'repeat'>;

/** Un montage du banc, et les gestes qu'on y fait. */
export class Bench {
    readonly slow: SlowServer;
    readonly jira: SlowJira;
    /** La mémoire de l'onglet : l'historique de chaque jour, gardé d'un jour à l'autre. */
    readonly memory: TabMemory;
    /** Aujourd'hui : la journée du banc, un jour d'après, qui la rend passée, ou la veille, qui la rend à venir. */
    readonly today: string;
    /** Les menus ouverts, dans l'ordre : le créneau où chacun a été demandé. */
    readonly menus: number[] = [];
    /** Ce que la fenêtre a montré, rendu après rendu : « - », « edit », « new* » en envoi… */
    readonly windows: string[] = [];
    /**
     * Chaque fois que Radix a placé la vraie fenêtre : la hauteur qu'elle s'est mesurée, et le
     * rectangle où elle s'accroche, que sa flèche désigne en son milieu.
     */
    readonly placements: { readonly height: number; readonly rect: DOMRect }[] = [];
    editingRef: GridEditing | null = null;
    /** Ce qu'on glisse depuis les favoris, au dernier rendu ; undefined sans favoris montés. */
    favoriteDrag: FavoriteDrag | null | undefined = undefined;
    laneElement: HTMLElement | null = null;
    listboxElement: HTMLElement | null = null;
    readonly windowGestures: RefObject<WindowGestures> = { current: NO_WINDOW };
    renders = 0;
    menuQuarter = -1;
    /**
     * La vraie grille, son vrai menu et la vraie fenêtre : ils attendent les minuteries, et
     * settle les laisse passer ; Entrée et Échap y vont au champ qui a le curseur.
     */
    real = false;
    private readonly root: Root;
    private readonly container: HTMLElement;
    private readonly removeEscape: () => void;
    /** La journée affichée ; un changement de jour en ouvre une autre (switchDay). Null pendant qu'elle se lit (openSlowly). */
    private shownSession: DaySession | null;
    /** Le jour qui s'ouvre, tant qu'il se lit (openSlowly). */
    private openingDate: string | null = null;
    /** La grille se ferme comme sur l'écran Journée (MountOptions.closes). */
    closes = false;
    private readonly sessionListeners = new Set<() => void>();

    constructor(
        slow: SlowServer,
        jira: SlowJira,
        session: DaySession,
        render: (probe: Probe) => ReactNode,
        today = DATE,
        memory: TabMemory = tabMemory(memoryStorage()),
    ) {
        this.slow = slow;
        this.jira = jira;
        this.shownSession = session;
        this.memory = memory;
        this.today = today;
        this.container = document.createElement('div');
        document.body.append(this.container);
        this.root = createRoot(this.container);
        // Comme l'écran Journée (useGridExits) : Échap, que rien d'autre n'a pris, vide la sélection.
        const onEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !event.defaultPrevented && this.editingRef?.deselect() === true) {
                event.preventDefault();
            }
        };
        window.addEventListener('keydown', onEscape);
        // Le créneau où le dernier clic droit a été demandé, rejoué ou non : le vrai menu s'y ouvre.
        const onContextMenu = (event: MouseEvent) => {
            this.menuQuarter = quarterOfY(event.clientY);
        };
        document.addEventListener('contextmenu', onContextMenu, true);
        this.removeEscape = () => {
            window.removeEventListener('keydown', onEscape);
            document.removeEventListener('contextmenu', onContextMenu, true);
        };
        const probe: Probe = {
            opening: () => this.openingDate,
            sessions: {
                current: () => this.shownSession,
                subscribe: (listener) => {
                    this.sessionListeners.add(listener);

                    return () => {
                        this.sessionListeners.delete(listener);
                    };
                },
            },
            today,
            closes: () => this.closes,
            gesturesRef: this.windowGestures,
            onRender: (editing) => {
                this.editingRef = editing;
                this.renders += 1;
                const shown =
                    editing.window === null ? '-' : `${editing.window.target.kind}${editing.window.sending ? '*' : ''}`;
                if (this.windows.at(-1) !== shown) {
                    this.windows.push(shown);
                }
            },
            onElements: (lane, listbox) => {
                this.laneElement = lane;
                this.listboxElement = listbox;
                if (lane !== null) {
                    lane.getBoundingClientRect = laneRect;
                    // Les rangées de la grille prennent --h-row (day.css), que jsdom ne lit pas.
                    lane.style.setProperty('--h-row', `${String(ROW)}px`);
                }
            },
            onFavorites: (drag, side, scroller) => {
                this.favoriteDrag = drag;
                if (side !== null) {
                    side.getBoundingClientRect = rectOf(SIDE);
                }
                // La zone qui défile montre toute la grille : un favori y tombe partout.
                if (scroller !== null) {
                    scroller.getBoundingClientRect = laneRect;
                }
            },
            onMenu: () => {
                this.menus.push(this.menuQuarter);
            },
            onPlace: (height, placed) => {
                this.placements.push({ height, rect: placed.rect });
            },
        };
        act(() => {
            this.root.render(
                <TicketsProvider book={jira.book} state="connected">
                    {render(probe)}
                </TicketsProvider>,
            );
        });
    }

    /** La session de la journée affichée. */
    get session(): DaySession {
        if (this.shownSession === null) {
            throw new Error('La journée se lit encore.');
        }

        return this.shownSession;
    }

    /** Ce que le crochet rend au dernier rendu. */
    get editing(): GridEditing {
        if (this.editingRef === null) {
            throw new Error("Le crochet n'est pas rendu.");
        }

        return this.editingRef;
    }

    get lane(): HTMLElement {
        if (this.laneElement === null) {
            throw new Error("La colonne des blocs n'est pas rendue.");
        }

        return this.laneElement;
    }

    get listbox(): HTMLElement {
        if (this.listboxElement === null) {
            throw new Error("La liste des créneaux n'est pas rendue.");
        }

        return this.listboxElement;
    }

    /** La trace des fenêtres repart de ce que l'écran montre maintenant. */
    forgetWindows(): void {
        this.windows.splice(0, this.windows.length - 1);
    }

    /** Ce que la grille affiche : la journée de la session, telle qu'elle l'a reçue du serveur. */
    shown(): Range[] {
        return rangesOf(this.session.current().day.grid);
    }

    snapshot(): SessionSnapshot {
        return this.session.current();
    }

    /**
     * Laisse passer tout ce qui peut passer — réponses lâchées, rendus, effets —, sans rien
     * lâcher de ce qui est retenu.
     */
    async settle(): Promise<void> {
        let renders = -1;
        for (let round = 0; round < 20 && renders !== this.renders; round += 1) {
            renders = this.renders;
            await act(async () => {
                // Radix pose ses écouteurs au tour suivant de la boucle des minuteries.
                await new Promise((resolve) => (this.real ? setTimeout(resolve, 0) : setImmediate(resolve)));
            });
        }
    }

    /**
     * Lâche ce que le serveur, ou Jira, retient — tout, et il ne retient plus, ou seulement la
     * plus ancienne réponse —, et laisse passer ce qui suit.
     */
    async answer(from: Held, all = true): Promise<void> {
        act(() => {
            if (all) {
                from.release();
            } else {
                from.releaseOne();
            }
        });
        await this.settle();
    }

    /**
     * Appuie sur un favori, sans bouger : l'appui est un clic à côté de la fenêtre ouverte, que
     * Radix entend, puis le favori le prend.
     */
    holdFavorite(ticket: string): void {
        const card = document.querySelector(`[data-ticket="${ticket}"]`);
        if (card === null) {
            throw new Error(`${ticket} n'est pas dans les favoris.`);
        }
        const at = { clientX: CARD_X, clientY: SIDE.top + ROW, button: 0 };
        act(() => {
            card.dispatchEvent(
                new PointerEvent('pointerdown', {
                    bubbles: true,
                    cancelable: true,
                    pointerType: 'mouse',
                    isPrimary: true,
                    ...at,
                }),
            );
            card.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 1, ...at }));
        });
    }

    /** Entrée ou Espace sur un favori, qui a le curseur : un clic sans pointeur. */
    activateFavorite(ticket: string): void {
        const card = document.querySelector(`[data-ticket="${ticket}"]`);
        if (card === null) {
            throw new Error(`${ticket} n'est pas dans les favoris.`);
        }
        act(() => {
            card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
        });
    }

    /** Le pointeur, appuyé, passe au-dessus de ce quart d'heure de la grille. */
    moveTo(quarter: number): void {
        this.mouse(document, 'mousemove', quarter);
    }

    /** Le pointeur se relâche au-dessus de ce quart d'heure de la grille. */
    release(quarter: number): void {
        this.mouse(document, 'mouseup', quarter, { button: 0, detail: 1 });
    }

    /** Lâche tout ce que le serveur et Jira retiennent, jusqu'à ce que plus rien n'attende. */
    async drain(): Promise<void> {
        await this.settle();
        for (let round = 0; round < 100 && (this.slow.count > 0 || this.jira.count > 0); round += 1) {
            act(() => {
                this.slow.release();
                this.jira.release();
            });
            await this.settle();
        }
    }

    // Le clavier : la liste des créneaux a le curseur.

    /** Une touche sur la grille. Vrai si l'écran l'a prise pour lui (preventDefault). */
    press(key: string, modifiers: Modifiers = {}): boolean {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
        act(() => {
            this.listbox.dispatchEvent(event);
        });

        return event.defaultPrevented;
    }

    /** Ctrl/⌘+Z, ou Maj+Ctrl/⌘+Z pour rétablir, d'où que soit le curseur hors d'un champ. */
    undo(redo = false): void {
        this.press('z', { ctrlKey: true, shiftKey: redo });
    }

    // Le pointeur, sur la colonne des blocs.

    /**
     * Un appui à côté de la fenêtre ouverte l'enregistre (Popover, onPointerDownOutside),
     * avant que la grille ne le reçoive : la vraie fenêtre l'entend par Radix, celle du
     * crochet seul par WindowStandIn.
     */
    private pointerDown(quarter: number, button: number): void {
        const event = new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            clientX: 100,
            clientY: yOf(quarter),
            button,
            pointerType: 'mouse',
            isPrimary: true,
        });
        act(() => {
            this.lane.dispatchEvent(event);
            this.windowGestures.current.outside();
        });
    }

    private mouse(target: EventTarget, type: string, quarter: number, init: MouseEventInit = {}): MouseEvent {
        const event = new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: 100,
            clientY: yOf(quarter),
            ...init,
        });
        act(() => {
            target.dispatchEvent(event);
        });

        return event;
    }

    click(quarter: number, modifiers: Pick<MouseEventInit, 'shiftKey' | 'ctrlKey' | 'metaKey'> = {}, detail = 1): void {
        this.pointerDown(quarter, 0);
        this.mouse(this.lane, 'mousedown', quarter, { button: 0, detail, ...modifiers });
        this.mouse(document, 'mouseup', quarter, { button: 0, detail, ...modifiers });
        this.mouse(this.lane, 'click', quarter, { button: 0, detail, ...modifiers });
    }

    doubleClick(quarter: number): void {
        this.click(quarter, {}, 1);
        this.click(quarter, {}, 2);
        this.mouse(this.lane, 'dblclick', quarter, { button: 0, detail: 2 });
    }

    /**
     * Le second clic d'un double-clic dont le premier visait autre chose — un choix du menu,
     * qui a disparu sous le pointeur — et qui tombe sur la grille.
     */
    strayClick(quarter: number): void {
        this.mouse(document.body, 'mousedown', quarter, { button: 0, detail: 1 });
        this.mouse(document, 'mouseup', quarter, { button: 0, detail: 1 });
        this.pointerDown(quarter, 0);
        this.mouse(this.lane, 'mousedown', quarter, { button: 0, detail: 2 });
        this.mouse(document, 'mouseup', quarter, { button: 0, detail: 2 });
    }

    rightClick(quarter: number): void {
        this.pointerDown(quarter, 2);
        this.mouse(this.lane, 'mousedown', quarter, { button: 2, detail: 1 });
        this.mouse(this.lane, 'contextmenu', quarter, { button: 2 });
        this.mouse(document, 'mouseup', quarter, { button: 2, detail: 1 });
    }

    /** Un glisser de `from` à `to`, relâché. */
    drag(from: number, to: number): void {
        this.pointerDown(from, 0);
        this.mouse(this.lane, 'mousedown', from, { button: 0, detail: 1 });
        const step = from <= to ? Quarter.MINUTES : -Quarter.MINUTES;
        for (let quarter = from; quarter !== to; quarter += step) {
            this.mouse(document, 'mousemove', quarter + step);
        }
        this.mouse(document, 'mouseup', to, { button: 0, detail: 1 });
    }

    /** Sélectionne ces quarts d'heure, du premier au dernier, au pointeur. */
    select(quarters: readonly number[]): void {
        const [first] = quarters;
        const last = quarters.at(-1);
        if (first === undefined || last === undefined) {
            return;
        }
        this.click(first);
        if (last !== first) {
            this.click(last, { shiftKey: true });
        }
    }

    // La fenêtre de ticket ouverte : le curseur y est.

    /** Tape dans la fenêtre ouverte : son ticket, et son commentaire s'il est donné. */
    type(ticket: string, comment?: string): void {
        const shown = this.editing.window;
        if (shown === null) {
            throw new Error("Aucune fenêtre n'est ouverte.");
        }
        act(() => {
            this.editing.setDraft({ ticket, comment: comment ?? shown.draft.comment });
        });
    }

    /** Règle la case « Récurrence » de la fenêtre ouverte, comme on la coche et choisit ses jours. */
    setRecurrence(draft: RecurrenceDraft): void {
        if (this.editing.window === null) {
            throw new Error("Aucune fenêtre n'est ouverte.");
        }
        act(() => {
            this.editing.setRecurrence(draft);
        });
    }

    /**
     * Change une part de la case « Récurrence » de la fenêtre ouverte — ses jours, sa carte, sa
     * fin —, le reste tel qu'elle le montre, comme on la règle à la souris.
     */
    adjustRecurrence(change: Partial<RecurrenceDraft>): void {
        const draft = this.editing.windowRecurrence;
        if (draft === null) {
            throw new Error("La fenêtre n'a pas de case « Récurrence ».");
        }
        this.setRecurrence({ ...draft, ...change });
    }

    /** Entrée dans le champ Ticket de la fenêtre. */
    enter(): void {
        const field = document.querySelector('[role="dialog"] input');
        if (this.editing.window === null || (this.real && field === null)) {
            throw new Error("Aucune fenêtre n'est ouverte : Entrée n'irait nulle part.");
        }
        act(() => {
            if (this.real && field !== null) {
                field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
            } else {
                this.windowGestures.current.enter();
            }
        });
    }

    /** Échap, là où est le curseur : la fenêtre ouverte le prend avant tout le reste. */
    escape(): void {
        const target = this.real ? (document.activeElement ?? document.body) : document.body;
        act(() => {
            target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        });
    }

    /** Un bouton du pied de la fenêtre : Effacer, Pause ou Annuler. */
    button(name: 'delete' | 'pause' | 'cancel'): void {
        act(() => {
            ({ delete: this.editing.deleteWindow, pause: this.editing.pauseWindow, cancel: this.editing.cancelWindow })[
                name
            ]();
        });
    }

    /** La question « quelles fois » de la fenêtre ouverte, si elle la pose. */
    question(): WindowQuestion | undefined {
        return this.editing.window?.question;
    }

    /** Un choix de la question : le bouton radio de la vraie fenêtre, qu'on clique. */
    chooseScope(choice: ScopeChoice): void {
        const radio = document.querySelector<HTMLInputElement>(`[role="radiogroup"] input[value="${choice}"]`);
        act(() => {
            if (this.real && radio !== null) {
                radio.click();
            } else {
                this.editing.chooseScope(choice);
            }
        });
    }

    /**
     * Le bouton de droite du pied de la question, ou de la fenêtre : Enregistrer, Arrêter,
     * Effacer, Couper, Allonger ou Raccourcir.
     */
    confirm(): void {
        const button = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((candidate) =>
            ['Enregistrer', 'Arrêter', 'Effacer', 'Couper', 'Allonger', 'Raccourcir'].includes(
                candidate.textContent.trim(),
            ),
        );
        act(() => {
            if (this.real && button !== undefined) {
                button.click();
            } else {
                this.windowGestures.current.save();
            }
        });
    }

    /** Le bouton de gauche du pied de la question : Retour, ou Annuler. */
    back(): void {
        const button = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((candidate) =>
            ['Retour', 'Annuler'].includes(candidate.textContent.trim()),
        );
        act(() => {
            if (this.real && button !== undefined) {
                button.click();
            } else {
                this.editing.cancelWindow();
            }
        });
    }

    /**
     * Les flèches de la barre vers un autre jour (useDayNavigation) : la fenêtre ouverte
     * s'enregistre d'abord, comme sur un clic à côté, et on attend sa réponse ; refusée, ou
     * sa question posée, on reste. Sinon, la session quittée se ferme et l'autre jour s'ouvre,
     * lu sur le serveur, avec la même mémoire d'onglet. La promesse dit si on est parti.
     */
    switchDay(date: string): Promise<boolean> {
        let flushing: Promise<boolean> = Promise.resolve(true);
        act(() => {
            flushing = this.editing.flushWindow();
        });

        return flushing.then((closed) => {
            if (closed) {
                act(() => {
                    this.shownSession?.close();
                    this.openingDate = null;
                    this.shownSession = new DaySession(this.slow.server.read(date), this.slow.api, this.memory);
                    this.notifySessions();
                });
            }

            return closed;
        });
    }

    /**
     * Un autre jour, qui se lit lentement (useDayNavigation) : la session quittée se ferme, et la
     * grille attend la journée tant qu'on ne l'a pas lâchée (arrive). La promesse dit si on est
     * parti.
     */
    openSlowly(date: string): Promise<boolean> {
        let flushing: Promise<boolean> = Promise.resolve(true);
        if (this.shownSession !== null) {
            act(() => {
                flushing = this.editing.flushWindow();
            });
        }

        return flushing.then((closed) => {
            if (closed) {
                act(() => {
                    this.shownSession?.close();
                    this.shownSession = null;
                    this.openingDate = date;
                    this.notifySessions();
                });
            }

            return closed;
        });
    }

    /** La journée qui s'ouvrait est lue, telle que le serveur l'a maintenant ; ou sa lecture échoue. */
    async arrive(fails = false): Promise<void> {
        const date = this.openingDate;
        if (date === null) {
            throw new Error("Aucune journée ne s'ouvre.");
        }
        act(() => {
            this.openingDate = null;
            this.shownSession = fails ? null : new DaySession(this.slow.server.read(date), this.slow.api, this.memory);
            this.notifySessions();
        });
        await this.settle();
    }

    private notifySessions(): void {
        this.sessionListeners.forEach((listener) => {
            listener();
        });
    }

    /** Un choix du menu ouvert. */
    choose(item: 'newTicket' | 'editSelection' | 'convertToPause' | 'clear' | 'copy' | 'cut' | 'paste'): void {
        act(() => {
            this.editing[item]();
        });
    }

    /** Le bouton « Annuler » du message affiché. */
    undoMessage(): void {
        const action = this.editing.message?.action;
        if (action === undefined) {
            throw new Error("Le message n'a pas de bouton « Annuler ».");
        }
        act(() => {
            action.onAction();
        });
    }

    /**
     * Le retour sur la page — l'onglet retrouvé, la fenêtre qui reprend la main : la journée
     * se relit, à son tour dans sa file (useDayNavigation).
     */
    comeBack(): void {
        act(() => {
            void this.session.refresh();
        });
    }

    /** Un autre onglet écrit la journée : l'écran n'en sait rien avant de la relire. */
    elsewhere(...changes: SlotChange[]): void {
        this.slow.server.changeSlots(DATE, this.slow.server.read(DATE).version, changes);
    }

    /**
     * Un autre onglet, sur un autre jour, enregistre la fenêtre d'un bloc qui revient : sa case
     * décochée l'arrête à partir de ce jour-là (null), d'autres jours la coupent en deux. La
     * journée du banc n'en sait rien avant de la relire, mais sa version a changé si elle
     * prévoyait cette récurrence. Coupée puis collée, elle ne repart pas au-delà de son collage :
     * le serveur le refuse sous « Jusqu'au », rien ne change, et l'appel rend false.
     */
    recurrenceElsewhere(id: string, on: string, rule: RecurrenceRule | null): boolean {
        const { server } = this.slow;
        const day = server.read(on);
        const block = day.grid.blocks().find((candidate) => candidate.content.recurrence === id);
        const recurrence = server.recurrence(id);
        if (block === undefined || recurrence === undefined) {
            throw new Error(`La récurrence ${id} ne pose rien le ${on}.`);
        }
        // Ce que la fenêtre écrit : le bloc tel qu'il est, sans son lien, que le serveur pose.
        const changes = toSlotChanges(
            new Map(Quarter.between(block.start, block.end).map((quarter) => [quarter, unlinked(block.content)])),
        );
        const result = server.saveRecurrence(on, day.version, changes, rule, {
            id,
            weekdays: recurrence.weekdays,
            until: recurrence.until,
        });
        if (
            result.status === 'invalid' &&
            result.violations.every(
                (violation) =>
                    violation.field === 'recurrence.until' &&
                    violation.message.startsWith("Annulez d'abord le collage du "),
            )
        ) {
            return false;
        }
        if (result.status !== 'saved') {
            throw new Error(`L'autre onglet n'a pas changé ${id} : ${JSON.stringify(result)}.`);
        }

        return true;
    }

    /** L'envoi sur Jira, confirmé dans sa fenêtre : il part à son tour, derrière les gestes d'avant. */
    sendToJira(): Promise<SendOutcome> {
        let sent: Promise<SendOutcome> = Promise.resolve({ kind: 'abandoned' });
        act(() => {
            sent = this.session.sendToJira();
        });

        return sent;
    }

    /** Un favori déposé sur ce quart d'heure. */
    dropFavorite(ticket: string, quarter: number): void {
        act(() => {
            this.editing.dropTicket(ticket, quarter);
        });
    }

    unmount(): void {
        act(() => {
            this.root.unmount();
        });
        this.removeEscape();
        this.container.remove();
    }
}

interface MountOptions {
    /** Ce que la journée contient au départ, écrit en base avant le montage. */
    readonly blocks?: readonly SlotChange[];
    /**
     * Des récurrences nées la veille, du lundi au vendredi, posées sur la journée avant les
     * blocs : chacune, un créneau qui revient.
     */
    readonly recurrences?: readonly SlotChange[];
    /**
     * Les récurrences de départ sont nées avant le refus d'un créneau pris : elles peuvent se
     * croiser, et le serveur les garde.
     */
    readonly crossing?: boolean;
    /**
     * Des saisies faites sur la journée avant que ses récurrences n'y tombent : elles gardent
     * leur créneau, et une récurrence s'y pose autour, en deux morceaux s'il le faut. Un jour à
     * venir, elles y sont, et ses récurrences s'y prévoient autour.
     */
    readonly earlier?: readonly SlotChange[];
    /** Les favoris, de haut en bas ; avec mountScreen seulement. */
    readonly favorites?: readonly string[];
    /** L'heure en haut de la vue : le clavier y commence. */
    readonly top?: number;
    /**
     * Aujourd'hui ; un jour d'après rend la journée du banc passée. La veille (EVE) la rend à
     * venir : ses récurrences n'y sont pas posées, mais prévues.
     */
    readonly today?: string;
    /**
     * La grille se ferme comme sur l'écran Journée : un jour non travaillé ou mis à 0h00, vide
     * (assets/day/dayClosure.ts).
     */
    readonly closes?: boolean;
    readonly slow?: SlowServer;
    readonly jira?: SlowJira;
}

const mounted: Bench[] = [];

/** Démonte tout ce qui a été monté : à appeler après chaque test. */
export function unmountAll(): void {
    mounted.splice(0).forEach((bench) => {
        bench.unmount();
    });
}

function open(
    {
        blocks = [],
        recurrences = [],
        crossing = false,
        earlier = [],
        top = 600,
        today = DATE,
        closes = false,
        slow = new SlowServer(),
        jira = new SlowJira(),
    }: MountOptions,
    render: (probe: Probe, top: number) => ReactNode,
): Bench {
    const seed = () => {
        seedRecurrences(slow.server, recurrences, null);
    };
    if (crossing) {
        slow.server.beforeClashRule(seed);
    } else {
        seed();
    }
    if (earlier.length > 0) {
        slow.server.changeSlots(DATE, slow.server.read(DATE).version, earlier);
    }
    // Le jour venu, ses récurrences s'y posent ; à venir, il les prévoit.
    if (today >= DATE) {
        slow.server.pose(DATE);
    }
    // Le serveur a ensuite la même horloge que l'écran : un jour passé y change à partir de
    // demain, un jour à venir prévoit ses récurrences.
    slow.server.setToday(today);
    if (blocks.length > 0) {
        slow.server.changeSlots(DATE, slow.server.read(DATE).version, blocks);
    }
    const memory = tabMemory(memoryStorage());
    const session = new DaySession(slow.server.read(DATE), slow.api, memory);
    const bench = new Bench(slow, jira, session, (probe) => render(probe, top), today, memory);
    bench.closes = closes;
    mounted.push(bench);

    return bench;
}

/** La veille de la journée du banc, un lundi. */
export const EVE = '2026-10-05';

/**
 * Chaque créneau devient une récurrence née la veille, du lundi au vendredi, que le serveur
 * pose sur la journée du banc comme le jour venu : ses blocs y reviennent.
 *
 * @param poseOn le jour venu, où elles se posent ; null pour ne rien poser : la journée du
 *               banc, à venir, les prévoit
 */
export function seedRecurrences(
    server: FakeDayServer,
    recurrences: readonly SlotChange[],
    poseOn: string | null = DATE,
): void {
    for (const change of recurrences) {
        const result = server.saveRecurrence(
            EVE,
            server.read(EVE).version,
            [change],
            weeklyRule([1, 2, 3, 4, 5]),
            null,
        );
        if (result.status !== 'saved') {
            throw new Error(`La récurrence de ${change.start} n'est pas née : ${JSON.stringify(result)}.`);
        }
    }
    if (poseOn !== null) {
        server.pose(poseOn);
    }
}

/** Le crochet seul, sous une colonne et une liste nues, avec ce que la fenêtre fait des gestes. */
export function mountGrid(options: MountOptions = {}): Bench {
    return open(options, (probe, top) => <BareGrid probe={probe} top={top} />);
}

/** La vraie grille, son vrai menu et la vraie fenêtre de ticket ; et des favoris, si on en donne. */
export function mountScreen(options: MountOptions = {}): Bench {
    let favorites: FavoriteList | null = null;
    if (options.favorites !== undefined) {
        const server = new FakeFavoritesServer();
        server.seed(...options.favorites);
        favorites = new FavoriteList(server.api());
    }
    const bench = open(options, (probe, top) => <RealScreen probe={probe} top={top} favorites={favorites} />);
    bench.real = true;

    return bench;
}

/**
 * Ce que jsdom ne sait pas, et dont le glisser d'un favori se sert : l'écart d'un appui à un
 * glisser (--s-1), et l'élément sous le pointeur, qui dit si rien n'est posé sur la grille.
 */
function drawFavorites(lane: () => HTMLElement | null): () => void {
    const root = document.documentElement;
    root.style.setProperty('--s-1', `${String(DRAG_THRESHOLD)}px`);
    const pointed = document as Partial<Pick<Document, 'elementFromPoint'>>;
    const before = pointed.elementFromPoint;
    pointed.elementFromPoint = (x: number) => (x >= LANE.left && x <= LANE.left + LANE.width ? lane() : null);

    return () => {
        root.style.removeProperty('--s-1');
        if (before === undefined) {
            delete pointed.elementFromPoint;
        } else {
            pointed.elementFromPoint = before;
        }
    };
}

/** Ce que les composants du banc lui disent : ce qu'ils rendent, leurs éléments, le menu ouvert. */
interface Probe {
    /** La session de la journée affichée, qu'un changement de jour remplace ; null pendant qu'elle se lit. */
    readonly sessions: {
        readonly current: () => DaySession | null;
        readonly subscribe: (listener: () => void) => () => void;
    };
    /** Aujourd'hui : la journée du banc, un jour d'après, qui la rend passée, ou la veille, qui la rend à venir. */
    readonly today: string;
    /** La grille se ferme quand le jour, vide, n'est pas travaillé. */
    readonly closes: () => boolean;
    readonly gesturesRef: RefObject<WindowGestures>;
    onRender(editing: GridEditing): void;
    onElements(lane: HTMLElement | null, listbox: HTMLElement | null): void;
    /** Radix place la vraie fenêtre, à cette hauteur, là. */
    onPlace(height: number, placed: PlacedWindow): void;
    /** Ce qu'on glisse depuis les favoris, leur colonne, et la zone qui fait défiler la grille. */
    onFavorites(drag: FavoriteDrag | null, side: HTMLElement | null, scroller: HTMLElement | null): void;
    onMenu(): void;
    /** Le jour qui s'ouvre, tant qu'il se lit. */
    readonly opening: () => string | null;
}

function useEditing(probe: Probe, top: number) {
    const session = useSyncExternalStore(probe.sessions.subscribe, probe.sessions.current);
    const snapshot = useSyncExternalStore(
        (listener) => session?.subscribe(listener) ?? (() => undefined),
        () => session?.current() ?? null,
    );
    const laneRef = useRef<HTMLDivElement | null>(null);
    const scrollerRef = useRef<HTMLDivElement | null>(null);
    const listboxRef = useRef<HTMLDivElement | null>(null);
    // Le jour qui s'ouvre, suivi comme la session : une lecture qui échoue se rend aussi.
    const opening = useSyncExternalStore(probe.sessions.subscribe, probe.opening);
    const editing = useGridEditing({
        session,
        day: snapshot?.day ?? null,
        openingDay: opening,
        today: probe.today,
        laneRef,
        scrollerRef,
        listboxRef,
        visibleTop: () => top,
        onWindowOpen: () => undefined,
        closed:
            snapshot !== null &&
            probe.closes() &&
            (!snapshot.day.working || snapshot.day.declaredOff) &&
            snapshot.day.grid.blocks().length === 0,
    });
    probe.onRender(editing);
    useLayoutEffect(() => {
        probe.onElements(laneRef.current, listboxRef.current);
    });

    return { session, snapshot, editing, laneRef, scrollerRef, listboxRef };
}

function BareGrid({ probe, top }: { probe: Probe; top: number }) {
    const { session, editing, laneRef, listboxRef } = useEditing(probe, top);

    return (
        <>
            <div
                ref={laneRef}
                role="presentation"
                onMouseDown={editing.onLaneMouseDown}
                onDoubleClick={editing.onLaneDoubleClick}
                // Comme ContextMenu.Trigger de Radix : le menu s'ouvre si rien ne l'a empêché.
                onContextMenu={(event) => {
                    editing.onLaneContextMenu(event);
                    if (!event.defaultPrevented) {
                        event.preventDefault();
                        probe.onMenu();
                    }
                }}
            >
                <div
                    ref={listboxRef}
                    role="listbox"
                    aria-label="Créneaux"
                    tabIndex={0}
                    onKeyDown={editing.onListboxKeyDown}
                    onFocus={editing.onListboxFocus}
                />
            </div>
            {session !== null && (
                <WindowStandIn
                    session={session}
                    editing={editing}
                    checkRef={editing.windowCheckRef}
                    gesturesRef={probe.gesturesRef}
                />
            )}
        </>
    );
}

function RealScreen({ probe, top, favorites }: { probe: Probe; top: number; favorites: FavoriteList | null }) {
    const { snapshot, editing, laneRef, scrollerRef, listboxRef } = useEditing(probe, top);
    const returnFocus = () => {
        editing.focusGrid();
    };
    // Ce que la fenêtre mesure, et où elle se place, chaque fois que Radix la place.
    const { placeWindow } = editing;
    const place = useMemo(
        () =>
            placeWindow === null
                ? null
                : (height: number) => {
                      const placed = placeWindow(height);
                      probe.onPlace(height, placed);

                      return placed;
                  },
        [placeWindow, probe],
    );
    // Une journée ne s’ouvre lentement que sous la grille nue (mountGrid).
    if (snapshot === null) {
        return null;
    }

    return (
        <>
            {favorites !== null && (
                <FavoriteCards
                    list={favorites}
                    editing={editing}
                    laneRef={laneRef}
                    scrollerRef={scrollerRef}
                    probe={probe}
                />
            )}
            <DayGrid
                scrollerRef={scrollerRef}
                laneRef={laneRef}
                listboxRef={listboxRef}
                date={snapshot.day.date}
                grid={snapshot.day.grid}
                recurrences={snapshot.day.recurrences}
                recurrencesHeld={snapshot.day.recurrencesHeld}
                loading={false}
                busy={snapshot.busy}
                now={null}
                hintStart={null}
                drop={null}
                editing={editing}
                onMenuOpen={() => {
                    probe.onMenu();
                    editing.dismissMessage();
                }}
                menu={
                    <GridMenu
                        selection={editing.selection}
                        actions={editing.actions()}
                        mac={false}
                        onNewTicket={editing.newTicket}
                        onEditSelection={editing.editSelection}
                        onCopy={editing.copy}
                        onCut={editing.cut}
                        onPaste={editing.paste}
                        onPause={editing.convertToPause}
                        onFavorite={() => undefined}
                        onClear={editing.clear}
                        container={null}
                        returnFocus={returnFocus}
                    />
                }
            />
            <TicketWindow
                date={snapshot.day.date}
                today={probe.today}
                workingDays={snapshot.day.workingDays}
                window={editing.window}
                recurrence={editing.windowRecurrence}
                initialRecurrence={
                    editing.window === null ? null : initialRecurrence(editing.window.target, snapshot.day)
                }
                linked={editing.window === null ? null : linkedRecurrence(editing.window.target, snapshot.day)}
                ongoing={snapshot.day.ongoing}
                settledAhead={snapshot.day.settledAhead}
                onRecurrence={editing.setRecurrence}
                note={editing.windowNote}
                place={place}
                gridRef={laneRef}
                checkRef={editing.windowCheckRef}
                onDraft={editing.setDraft}
                onSave={editing.saveWindow}
                onCancel={editing.cancelWindow}
                onPause={editing.pauseWindow}
                onDelete={editing.deleteWindow}
                onChooseScope={editing.chooseScope}
                onCheckTicket={editing.checkTicket}
                returnFocus={returnFocus}
            />
        </>
    );
}

/**
 * La colonne des favoris, réduite à ses cartes et à celle qui suit le pointeur : ce que
 * useFavorites fait des gestes, sans l'apparence de FavoritesColumn.
 */
function FavoriteCards({
    list,
    editing,
    laneRef,
    scrollerRef,
    probe,
}: {
    list: FavoriteList;
    editing: GridEditing;
    laneRef: RefObject<HTMLElement | null>;
    scrollerRef: RefObject<HTMLElement | null>;
    probe: Probe;
}) {
    const blockDropRef = useRef<BlockDropTarget | null>(null);
    const beforeFormRef = useRef<(() => Promise<boolean>) | null>(null);
    const favorites = useFavorites({ list, editing, laneRef, scrollerRef, blockDropRef, beforeFormRef });
    // Comme FavoritesColumn : les références se lisent hors du rendu.
    const { snapshot, drag, columnRef, listRef, dragCardRef } = favorites;
    useLayoutEffect(() => {
        probe.onFavorites(drag, columnRef.current, scrollerRef.current);
    });
    useEffect(() => drawFavorites(() => laneRef.current), [laneRef]);

    return (
        <aside ref={columnRef} aria-label="Favoris">
            <ul ref={listRef}>
                {(snapshot.favorites ?? []).map((favorite) => (
                    <li key={favorite.id}>
                        <button
                            type="button"
                            data-favorite={favorite.id}
                            data-ticket={favorite.ticket}
                            onMouseDown={(event) => {
                                favorites.onCardMouseDown(event, favorite);
                            }}
                            onClick={(event) => {
                                favorites.onCardClick(event, favorite);
                            }}
                        >
                            {favorite.ticket}
                        </button>
                    </li>
                ))}
            </ul>
            {drag !== null && <div ref={dragCardRef} />}
        </aside>
    );
}
