import {
    type KeyboardEvent,
    type MouseEvent,
    type RefObject,
    useCallback,
    useEffect,
    useEffectEvent,
    useLayoutEffect,
    useRef,
    useState,
    useSyncExternalStore,
} from 'react';

import { tokenPixels } from '../components/tokenPixels';
import type { Favorite } from '../favorites/favorites';
import type { FavoriteList, FavoriteOutcome, FavoritesSnapshot, Removed } from '../favorites/favoriteList';
import { hasTicketShape, typedTicket } from '../grid/entry';
import { TICKET_NOT_FOUND } from '../jira/lookupMessages';
import { NO_CHECK, type TicketCheck } from '../jira/useTicketLookup';
import * as Quarter from '../grid/quarter';
import { TICKET_SHAPE_REFUSAL } from './messages';
import { shortcutAria, shortcutLabel } from './shortcuts';
import { setPointerLength } from './pointerLength';
import { rewrite } from './rewrite';
import { type BlockDropTarget, type GridEditing, quarterAt } from './useGridEditing';

/** Le formulaire en tête de liste, ou à la place d'un favori qu'on renomme. */
export interface FavoriteForm {
    /** Change à chaque ouverture : un nouveau formulaire repart de son contenu. */
    readonly key: number;
    /** Le favori renommé ; null pour un ajout. */
    readonly favorite: Favorite | null;
    readonly draft: string;
    /** Le refus, sous le champ. */
    readonly error: string | null;
    /**
     * Change à chaque enregistrement refusé : le curseur revient au champ, où est le
     * message. Zéro sinon.
     */
    readonly refused: number;
    /** Un enregistrement attend sa réponse. */
    readonly sending: boolean;
}

/**
 * Ce qu'on glisse : un favori, vers une autre place de la liste ou un quart d'heure de
 * la grille ; ou un bloc de la grille, vers une place de la liste. Un bloc dont le ticket
 * est déjà en favori se montre comme ce favori qu'on glisserait dans la liste.
 */
export type FavoriteDrag =
    | {
          readonly kind: 'favorite';
          readonly favorite: Favorite;
          /** Sa place dans la liste sans lui, si on le lâchait là ; null hors de la liste. */
          readonly index: number | null;
          /** Le quart d'heure où il tomberait ; null hors de la grille. */
          readonly quarter: number | null;
      }
    | {
          readonly kind: 'block';
          readonly ticket: string;
          /** Sa place dans la liste, si on le lâchait là ; null au-dessus de la colonne des heures. */
          readonly index: number | null;
      };

export interface Favorites {
    readonly snapshot: FavoritesSnapshot;
    readonly form: FavoriteForm | null;
    readonly drag: FavoriteDrag | null;
    readonly mac: boolean;
    /** La colonne : un glisser qui y passe vise la liste. */
    readonly columnRef: RefObject<HTMLElement | null>;
    /** La liste qui défile, où les cartes se mesurent. */
    readonly listRef: RefObject<HTMLUListElement | null>;
    /** La carte qui suit le pointeur pendant un glisser. */
    readonly dragCardRef: RefObject<HTMLDivElement | null>;
    /** Le bouton + de l'en-tête, où le curseur revient après l'ajout. */
    readonly addButtonRef: RefObject<HTMLButtonElement | null>;
    /** Ce que Jira sait du ticket tapé dans le formulaire d'ajout, qui le tient à jour. */
    readonly formCheckRef: RefObject<TicketCheck>;
    readonly openAdd: () => void;
    readonly openRename: (favorite: Favorite) => void;
    readonly setDraft: (field: HTMLInputElement) => void;
    /** On quitte le champ d'un ajout : sa forme se juge, comme dans la fenêtre Nouveau ticket. */
    readonly checkDraft: () => void;
    readonly submit: () => void;
    /**
     * Enregistre le formulaire ouvert avant un geste qui ouvre autre chose, comme sur un clic
     * à côté. La promesse dit s'il s'est fermé ; refusé, il reste ouvert avec son message,
     * le curseur dans son champ.
     */
    readonly leave: () => Promise<boolean>;
    readonly cancel: () => void;
    readonly copy: (favorite: Favorite) => void;
    readonly move: (favorite: Favorite, delta: -1 | 1) => void;
    readonly remove: (favorite: Favorite) => void;
    /** Un ticket de la grille ajouté à cette place : par son bloc glissé sur la liste, ou par le menu de la grille. */
    readonly addTicket: (ticket: string, index: number) => void;
    /** Ce ticket est-il déjà en favori ? Il n'y est jamais ajouté deux fois. */
    readonly has: (ticket: string) => boolean;
    readonly onCardMouseDown: (event: MouseEvent<HTMLElement>, favorite: Favorite) => void;
    readonly onCardClick: (event: MouseEvent<HTMLElement>, favorite: Favorite) => void;
    readonly onCardKeyDown: (event: KeyboardEvent<HTMLElement>, favorite: Favorite) => void;
}

/** Ce que le pointeur doit parcourir avant qu'un appui devienne un glisser, et pas un clic. */
const DRAG_THRESHOLD = '--s-1';

/**
 * La liste des favoris et ses gestes : un clic copie, glisser pose sur un créneau,
 * double-clic renomme, glisser dans la liste change l'ordre, et un bloc glissé de la
 * grille sur la liste devient un favori. Chaque geste a aussi son chemin au clavier et
 * dans le menu du clic droit.
 *
 * Tout ce qui touche la grille passe par ses gestes (useGridEditing) : déposer un favori
 * s'y annule comme le reste. Ce que disent les gestes de la liste prend la place du
 * message de la grille.
 */
export function useFavorites({
    list,
    editing,
    laneRef,
    blockDropRef,
    beforeFormRef,
}: {
    list: FavoriteList;
    editing: GridEditing;
    /** La colonne des blocs : un favori qu'on glisse y vise un quart d'heure. */
    laneRef: RefObject<HTMLElement | null>;
    /** Ce que la grille appelle quand un bloc glissé en sort : la liste le prend. */
    blockDropRef: RefObject<BlockDropTarget | null>;
    /**
     * Ce qui enregistre les fenêtres ouvertes avant que le formulaire s'ouvre ; null quand
     * il n'y en a pas. Refusée, une fenêtre reste, et le formulaire ne s'ouvre pas : il lui
     * prendrait le curseur, qu'elle reprendrait aussitôt.
     */
    beforeFormRef: RefObject<(() => Promise<boolean>) | null>;
}): Favorites {
    const snapshot = useSyncExternalStore(
        useCallback((listener: () => void) => list.subscribe(listener), [list]),
        () => list.current(),
    );
    const [form, setForm] = useState<FavoriteForm | null>(null);
    const [drag, setDrag] = useState<FavoriteDrag | null>(null);
    const columnRef = useRef<HTMLElement>(null);
    const listRef = useRef<HTMLUListElement>(null);
    const dragCardRef = useRef<HTMLDivElement>(null);
    const addButtonRef = useRef<HTMLButtonElement>(null);
    const counterRef = useRef(0);
    /** Où est le pointeur, et où il tient la carte qui le suit. */
    const pointerRef = useRef({ x: 0, y: 0, grabX: 0, grabY: 0 });
    /** Un glisser vient de finir sur une carte : le clic qui suit n'est pas un clic. */
    const draggedRef = useRef(false);
    const stopRef = useRef<(() => void) | null>(null);
    /** Le favori à qui rendre le curseur une fois la liste redessinée, ou le + de l'en-tête (ADD_BUTTON). */
    const focusRef = useRef<string | null>(null);
    /** L'enregistrement du formulaire en route, que les autres gestes attendent. */
    const pendingRef = useRef<Promise<boolean> | null>(null);
    const formCheckRef = useRef(NO_CHECK);
    const mac = editing.mac;
    const favorites = snapshot.favorites ?? [];

    // Le favori qu'on renommait a été retiré dans un autre onglet, et la liste relue : son
    // formulaire n'a plus où s'afficher, il se ferme, comme sa carte a disparu.
    if (
        form?.favorite != null &&
        snapshot.favorites !== null &&
        !favorites.some((known) => known.id === form.favorite?.id)
    ) {
        setForm(null);
    }

    useEffect(() => {
        void list.load();
        // Un onglet qu'on retrouve relit la liste : un autre a pu la changer.
        const onVisible = () => {
            if (document.visibilityState === 'visible') {
                void list.load();
            }
        };
        document.addEventListener('visibilitychange', onVisible);

        return () => {
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [list]);

    useEffect(
        () => () => {
            stopRef.current?.();
        },
        [],
    );

    // Le curseur suit le favori déplacé ou renommé, ou revient où il s'était perdu. Un
    // favori qui n'est plus là le laisse au + de l'en-tête.
    useLayoutEffect(() => {
        const id = focusRef.current;
        if (id === null) {
            return;
        }
        const card = id === ADD_BUTTON ? null : cardOf(listRef.current, id);
        if (card !== null) {
            focusRef.current = null;
            card.focus();
        } else if (id === ADD_BUTTON || !favorites.some((favorite) => favorite.id === id)) {
            focusRef.current = null;
            addButtonRef.current?.focus();
        }
    });

    // La carte qui suit le pointeur se place dès qu'elle paraît.
    useLayoutEffect(() => {
        placeDragCard(dragCardRef.current, pointerRef.current);
    }, [drag]);

    const next = () => (counterRef.current += 1);

    /**
     * Ce que la liste dit d'un geste qui n'a pas fait ce qu'on attendait.
     *
     * @param stale ce qu'il dit quand la liste avait changé ailleurs ; rien sans lui,
     *              quand le geste voulait ce que l'autre onglet a fait
     */
    const report = (outcome: FavoriteOutcome, stale?: string) => {
        if (outcome.kind === 'stale' && stale !== undefined) {
            editing.notify({ content: stale });
        } else if (outcome.kind === 'failed') {
            editing.notify({ content: FAILED });
        } else if (outcome.kind === 'invalid') {
            editing.notify({ content: outcome.violations[0]?.message ?? FAILED });
        }
    };

    /**
     * Rend le curseur à cette carte, ou au + de l'en-tête, s'il était dans la colonne ou
     * s'est perdu ; posé ailleurs, il y reste.
     */
    const keepFocus = (id: string | null) => {
        const focused = document.activeElement;
        if (focused !== null && focused !== document.body && !(columnRef.current?.contains(focused) ?? false)) {
            return;
        }
        // La carte est peut-être déjà là : la liste a pu se redessiner avant la fin du
        // geste. Sinon, elle prendra le curseur au prochain rendu.
        const card = id === null ? null : cardOf(listRef.current, id);
        if (card !== null) {
            focusRef.current = null;
            card.focus();
        } else {
            focusRef.current = id ?? ADD_BUTTON;
        }
    };

    // Le formulaire.

    /** Les fenêtres ouvertes s'enregistrent d'abord ; le formulaire ne s'ouvre que si elles se ferment. */
    const afterWindows = (show: () => void) => {
        const before = beforeFormRef.current;
        if (before === null) {
            show();
        } else {
            void before().then((closed) => {
                if (closed) {
                    show();
                }
            });
        }
    };

    const openAdd = () => {
        afterWindows(() => {
            editing.notify(null);
            setForm({ key: next(), favorite: null, draft: '', error: null, refused: 0, sending: false });
        });
    };

    const showRename = (favorite: Favorite) => {
        afterWindows(() => {
            editing.notify(null);
            setForm({ key: next(), favorite, draft: favorite.name ?? '', error: null, refused: 0, sending: false });
        });
    };

    /**
     * Comme une fenêtre de ticket : un formulaire déjà ouvert s'enregistre d'abord, comme
     * sur un clic à côté. Refusé, il reste ouvert avec son message, et l'autre ne s'ouvre pas.
     */
    const openRename = (favorite: Favorite) => {
        if (form === null) {
            showRename(favorite);
        } else if (form.favorite?.id !== favorite.id) {
            void leaveForm().then((closed) => {
                if (closed) {
                    showRename(favorite);
                }
            });
        }
    };

    const close = (shown: FavoriteForm) => {
        setForm((open) => (open?.key === shown.key ? null : open));
    };

    /**
     * Enregistre le formulaire ; la promesse dit s'il s'est fermé. Un refus, ou un serveur
     * muet, le garde ouvert avec son message sous le champ, et rien de tapé ne se perd.
     */
    const submit = (): Promise<boolean> => {
        const shown = form;
        if (shown === null) {
            return Promise.resolve(true);
        }
        if (pendingRef.current !== null) {
            return pendingRef.current;
        }
        const renamed = shown.favorite;
        if (renamed === null && shown.draft.trim() === '') {
            setForm({ ...shown, error: 'Indiquez un ticket.', refused: next() });

            return Promise.resolve(false);
        }
        if (renamed === null && !hasTicketShape(shown.draft)) {
            setForm({ ...shown, error: TICKET_SHAPE_REFUSAL, refused: next() });

            return Promise.resolve(false);
        }
        // Le refus affiché vaut pour tous les gestes, et le serveur laisse passer un ticket
        // qu'une saisie porte déjà : il ne se refuserait pas tout seul.
        if (renamed === null && formCheckRef.current.refused) {
            setForm({ ...shown, error: TICKET_NOT_FOUND, refused: next() });

            return Promise.resolve(false);
        }
        setForm({ ...shown, sending: true, error: null, refused: 0 });
        const known = renamed === null ? formCheckRef.current.known() : undefined;
        const sent = (known ?? Promise.resolve(true)).then((exists): Promise<FavoriteOutcome> => {
            if (!exists) {
                return Promise.resolve({
                    kind: 'invalid',
                    violations: [{ field: 'ticket', message: TICKET_NOT_FOUND }],
                });
            }

            return renamed === null ? list.add(shown.draft) : list.rename(renamed.id, shown.draft);
        });

        const pending = sent.then((outcome) => {
            pendingRef.current = null;
            if (outcome.kind === 'invalid' || outcome.kind === 'failed') {
                const error = outcome.kind === 'failed' ? FAILED : (outcome.violations[0]?.message ?? FAILED);
                setForm((open) =>
                    open?.key === shown.key ? { ...open, sending: false, error, refused: next() } : open,
                );

                return false;
            }
            close(shown);
            keepFocus(renamed?.id ?? null);
            report(outcome, RENAME_STALE);

            return true;
        });
        pendingRef.current = pending;

        return pending;
    };

    const cancel = () => {
        if (form !== null && !form.sending) {
            close(form);
            keepFocus(form.favorite?.id ?? null);
        }
    };

    /**
     * Un clic à côté du formulaire l'enregistre, comme on quitte une cellule de tableur.
     * Un ajout encore vide n'a rien à enregistrer : le formulaire se ferme.
     */
    const leaveForm = (): Promise<boolean> => {
        if (form !== null && form.favorite === null && form.draft.trim() === '' && pendingRef.current === null) {
            close(form);

            return Promise.resolve(true);
        }

        return submit();
    };

    // Le + de l'en-tête ne compte pas : son propre clic fait de même (openAdd), sans rouvrir
    // aussitôt le formulaire qu'il vient de fermer.
    const onOutside = useEffectEvent((event: PointerEvent) => {
        const target = event.target;
        if (
            form === null ||
            !(target instanceof Node) ||
            document.querySelector('[data-favorite-form]')?.contains(target) === true ||
            addButtonRef.current?.contains(target) === true
        ) {
            return;
        }
        void leaveForm();
    });
    const formOpen = form !== null;
    useEffect(() => {
        if (!formOpen) {
            return;
        }
        const listener = (event: PointerEvent) => {
            onOutside(event);
        };
        document.addEventListener('pointerdown', listener);

        return () => {
            document.removeEventListener('pointerdown', listener);
        };
    }, [formOpen]);

    // Les gestes d'un favori.

    const copy = (favorite: Favorite) => {
        editing.copyTicket(favorite.ticket);
    };

    const move = (favorite: Favorite, delta: -1 | 1) => {
        editing.notify(null);
        // Le décalage se compte sur la liste laissée par le geste d'avant : deux Alt+↓
        // rapides déplacent de deux places.
        void list.shift(favorite.id, delta).then((outcome) => {
            keepFocus(favorite.id);
            report(outcome, MOVE_STALE);
        });
    };

    const remove = (favorite: Favorite) => {
        const index = favorites.findIndex((known) => known.id === favorite.id);
        // Le curseur ira au favori qui prend sa place, sinon à celui d'au-dessus.
        const neighbour = favorites[index + 1] ?? favorites[index - 1] ?? null;
        editing.notify(null);
        void list.remove(favorite.id).then(({ outcome, removed }) => {
            keepFocus(neighbour?.id ?? null);
            if (removed !== null) {
                announceRemoved(removed);
            } else if (outcome.kind !== 'stale') {
                report(outcome);
            }
        });
    };

    /**
     * Un ticket de la grille posé dans la liste : ajouté, « SHOP-482 ajouté aux
     * favoris », avec de quoi le retirer — « Annuler », que Ctrl/⌘+Z double tant que le
     * message est affiché. Déjà en favori, ce favori est déplacé à cette place, sans
     * message : un ticket n'y est jamais deux fois.
     */
    const addTicket = (ticket: string, index: number) => {
        editing.notify(null);
        void list.place(ticket, index).then(({ outcome, added }) => {
            if (added === null) {
                report(outcome, MOVE_STALE);

                return;
            }
            editing.notify({
                content: (
                    <>
                        <b className="font-mono font-semibold whitespace-nowrap">{added.ticket}</b> ajouté aux favoris
                    </>
                ),
                action: {
                    label: 'Annuler',
                    title: `Annuler (${shortcutLabel('Z', mac)})`,
                    keyShortcuts: shortcutAria('Z', mac),
                    onAction: () => {
                        editing.notify(null);
                        void list.remove(added.id).then(({ outcome: removal }) => {
                            report(removal);
                        });
                    },
                },
            });
        });
    };

    /**
     * « SHOP-482 retiré des favoris », et de quoi le remettre : « Annuler », que Ctrl/⌘+Z
     * double tant que le message est affiché, comme celui de la grille. Le curseur que le
     * message rend revient à la liste, et suit le favori remis.
     */
    const announceRemoved = (removed: Removed) => {
        editing.notify({
            content: (
                <>
                    <b className="font-mono font-semibold whitespace-nowrap">{removed.favorite.ticket}</b> retiré des
                    favoris
                </>
            ),
            action: {
                label: 'Annuler',
                title: `Annuler (${shortcutLabel('Z', mac)})`,
                keyShortcuts: shortcutAria('Z', mac),
                onAction: () => {
                    editing.notify(null);
                    void list.restore(removed).then((outcome) => {
                        const back = list
                            .current()
                            .favorites?.find((favorite) => favorite.ticket === removed.favorite.ticket);
                        keepFocus(back?.id ?? null);
                        report(outcome);
                    });
                },
            },
            returnFocus: () => {
                addButtonRef.current?.focus();
            },
        });
    };

    // Le glisser d'un favori : il suit le pointeur jusqu'au relâcher. Ses écouteurs se
    // posent à l'appui, pas au rendu d'après : un geste rapide relâcherait avant eux.

    /** Où tomberait ce qu'on glisse, le pointeur ici. */
    const targetAt = (clientX: number, clientY: number, exclude: string | null) => {
        const column = columnRef.current?.getBoundingClientRect();
        if (column !== undefined && within(column, clientX, clientY)) {
            return { index: indexAt(listRef.current, clientY, exclude), quarter: null };
        }
        const lane = laneRef.current;
        const frame = lane?.closest('[role="region"]')?.getBoundingClientRect();
        const rect = lane?.getBoundingClientRect();
        // La grille, si rien n'est posé sur elle à cet endroit : sous 1280 px, le
        // récapitulatif ouvert la couvre, et un favori lâché dessus n'y tombe pas.
        if (
            rect !== undefined &&
            frame !== undefined &&
            clientX >= rect.left &&
            clientX <= rect.right &&
            within(frame, clientX, clientY) &&
            lane?.contains(document.elementFromPoint(clientX, clientY)) === true
        ) {
            // Fermée à la saisie, la grille ne prend rien : le favori lâché n'y tombe pas.
            return { index: null, quarter: editing.closed ? null : quarterAt(lane, clientY) };
        }

        return { index: null, quarter: null };
    };

    const dragMove = (favorite: Favorite, clientX: number, clientY: number) => {
        const { index, quarter } = targetAt(clientX, clientY, favorite.id);
        setDrag((shown) =>
            shown?.kind === 'favorite' && shown.index === index && shown.quarter === quarter
                ? shown
                : { kind: 'favorite', favorite, index, quarter },
        );
    };

    const dragEnd = (favorite: Favorite, clientX: number, clientY: number) => {
        const { index, quarter } = targetAt(clientX, clientY, favorite.id);
        setDrag(null);
        if (index !== null) {
            void list.move(favorite.id, index).then((outcome) => {
                report(outcome, MOVE_STALE);
            });
        } else if (quarter !== null) {
            editing.dropTicket(favorite.ticket, quarter);
        }
    };

    const handlersRef = useRef({ move: dragMove, end: dragEnd });
    useLayoutEffect(() => {
        handlersRef.current = { move: dragMove, end: dragEnd };
    });

    const startDrag = (favorite: Favorite, card: DOMRect, startX: number, startY: number) => {
        stopRef.current?.();
        const threshold = tokenPixels(DRAG_THRESHOLD);
        let started = false;
        let frame = 0;
        const pointer = pointerRef.current;
        pointer.grabX = startX - card.left;
        pointer.grabY = startY - card.top;

        const onMove = (event: globalThis.MouseEvent) => {
            pointer.x = event.clientX;
            pointer.y = event.clientY;
            if (!started) {
                if (Math.hypot(event.clientX - startX, event.clientY - startY) < threshold) {
                    return;
                }
                started = true;
                editing.notify(null);
                frame = requestAnimationFrame(scroll);
            }
            placeDragCard(dragCardRef.current, pointer);
            handlersRef.current.move(favorite, event.clientX, event.clientY);
        };
        const onUp = (event: globalThis.MouseEvent) => {
            stop();
            if (started) {
                draggedRef.current = true;
                handlersRef.current.end(favorite, event.clientX, event.clientY);
            }
        };
        const onKey = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape' && started) {
                event.preventDefault();
                stop();
                setDrag(null);
                // Le relâcher sur la carte elle-même n'est pas un clic.
                draggedRef.current = true;
            }
        };
        // Près du bord haut ou bas de la grille, elle défile, comme pendant un glisser
        // sur elle.
        const scroll = () => {
            const lane = laneRef.current;
            const scroller = lane?.closest('[role="region"]');
            if (scroller instanceof HTMLElement && lane !== null) {
                const { top, bottom, left, right } = scroller.getBoundingClientRect();
                const edge = (lane.getBoundingClientRect().height / Quarter.COUNT) * 2;
                const { x, y } = pointer;
                if (x >= left && x <= right && y >= top && y <= bottom && (y < top + edge || y > bottom - edge)) {
                    scroller.scrollTop += (y < top + edge ? -edge : edge) / 8;
                    handlersRef.current.move(favorite, x, y);
                }
            }
            frame = requestAnimationFrame(scroll);
        };
        const stop = () => {
            cancelAnimationFrame(frame);
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.removeEventListener('keydown', onKey, true);
            stopRef.current = null;
        };
        stopRef.current = stop;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.addEventListener('keydown', onKey, true);
    };

    // Un bloc glissé de la grille : il se soulève dès qu'il quitte la colonne des blocs
    // par la gauche — une carte de son ticket suit le pointeur, comme un favori —, et la
    // liste le prend là où on le lâche. Revenu sur la grille, il redevient une sélection.
    // Un ticket déjà en favori n'y est jamais ajouté deux fois : c'est ce favori qui suit
    // le pointeur dans la liste, comme si on le glissait, et le lâcher l'y déplace, sans
    // message.
    useLayoutEffect(() => {
        const lifted = (clientX: number) => {
            const lane = laneRef.current?.getBoundingClientRect();

            return lane !== undefined && clientX < lane.left;
        };
        const existing = (ticket: string) => favorites.find((favorite) => favorite.ticket === ticket) ?? null;
        blockDropRef.current = {
            over: (ticket, clientX, clientY) => {
                if (!lifted(clientX)) {
                    setDrag(null);

                    return false;
                }
                const favorite = existing(ticket);
                const { index } = targetAt(clientX, clientY, favorite?.id ?? null);
                pointerRef.current = {
                    x: clientX,
                    y: clientY,
                    grabX: tokenPixels('--s-4'),
                    grabY: tokenPixels('--s-4'),
                };
                placeDragCard(dragCardRef.current, pointerRef.current);
                setDrag((shown) =>
                    favorite !== null
                        ? shown?.kind === 'favorite' && shown.favorite.id === favorite.id && shown.index === index
                            ? shown
                            : { kind: 'favorite', favorite, index, quarter: null }
                        : shown?.kind === 'block' && shown.index === index && shown.ticket === ticket
                          ? shown
                          : { kind: 'block', ticket, index },
                );

                return true;
            },
            drop: (ticket, clientX, clientY) => {
                setDrag(null);
                if (!lifted(clientX)) {
                    return false;
                }
                // Lâché sur la colonne des heures, il ne fait rien.
                const { index } = targetAt(clientX, clientY, existing(ticket)?.id ?? null);
                if (index !== null) {
                    addTicket(ticket, index);
                }

                return true;
            },
            cancel: () => {
                setDrag(null);
            },
        };
    });

    return {
        snapshot,
        form,
        drag,
        mac,
        columnRef,
        listRef,
        dragCardRef,
        addButtonRef,
        formCheckRef,
        openAdd: () => {
            if (form === null) {
                openAdd();
            } else {
                void leaveForm();
            }
        },
        openRename,
        setDraft: (field) => {
            const shown = form;
            if (shown === null || shown.sending) {
                return;
            }
            const draft = shown.favorite === null ? rewrite(field, typedTicket) : field.value;
            setForm({ ...shown, draft, error: null, refused: 0 });
        },
        checkDraft: () => {
            setForm((open) =>
                open?.favorite !== null || open.sending || hasTicketShape(open.draft)
                    ? open
                    : { ...open, error: TICKET_SHAPE_REFUSAL, refused: 0 },
            );
        },
        submit: () => {
            void submit();
        },
        leave: leaveForm,
        cancel,
        copy,
        move,
        remove,
        addTicket,
        has: (ticket) => favorites.some((favorite) => favorite.ticket === ticket),
        onCardMouseDown: (event, favorite) => {
            if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
                return;
            }
            draggedRef.current = false;
            startDrag(favorite, event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY);
        },
        onCardClick: (event, favorite) => {
            // Safari et Firefox, sur Mac, ne donnent pas le curseur à un bouton qu'on clique :
            // le favori le prend ici, pour qu'on voie à qui s'adressent Suppr, ⌥↑ et F2. Sans
            // anneau : il reste au clavier.
            if (document.activeElement !== event.currentTarget) {
                event.currentTarget.focus({ preventScroll: true, focusVisible: false });
            }
            // Le second clic d'un double-clic renomme : il ne copie pas une seconde fois.
            if (draggedRef.current || event.detail > 1) {
                draggedRef.current = false;

                return;
            }
            copy(favorite);
        },
        onCardKeyDown: (event, favorite) => {
            const key = event.key;
            if (event.altKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
                event.preventDefault();
                move(favorite, key === 'ArrowUp' ? -1 : 1);
            } else if ((event.ctrlKey || event.metaKey) && !event.altKey && key.toLowerCase() === 'v') {
                // Un favori vient d'être copié, la sélection de la grille attend : on y colle,
                // et le curseur va où le geste a porté. Fermée à la saisie, la grille ne prend
                // ni le collage ni le curseur, qui reste sur le favori.
                event.preventDefault();
                if (!editing.closed) {
                    editing.paste();
                    editing.focusGrid();
                }
            } else if ((event.ctrlKey || event.metaKey) && !event.altKey && key.toLowerCase() === 'c') {
                event.preventDefault();
                copy(favorite);
            } else if (key === 'F2') {
                event.preventDefault();
                openRename(favorite);
            } else if (key === 'Delete' || key === 'Backspace') {
                event.preventDefault();
                // Une touche tenue ne retire pas les voisins l'un après l'autre.
                if (!event.repeat) {
                    remove(favorite);
                }
            } else if (key === 'ContextMenu' || (key === 'F10' && event.shiftKey)) {
                // Le menu s'ouvre sous la carte, pas là où le navigateur le poserait.
                event.preventDefault();
                openMenuUnder(event.currentTarget);
            }
        },
    };
}

/** Ce que focusRef désigne pour le + de l'en-tête : aucun identifiant de favori ne lui ressemble. */
const ADD_BUTTON = '+';

/** Un favori renommé qu'un autre onglet a retiré. */
const RENAME_STALE = 'Ce favori a été retiré entre-temps.';

/** Un ordre qui partait d'une liste changée ailleurs : rien n'est déplacé. */
const MOVE_STALE = "La liste a changé entre-temps. Rien n'a été déplacé.";

const FAILED = "L'enregistrement n'a pas abouti. Réessayez.";

/** La carte d'un favori dans la liste. */
function cardOf(list: HTMLElement | null, id: string): HTMLElement | null {
    return list?.querySelector<HTMLElement>(`[data-favorite="${CSS.escape(id)}"]`) ?? null;
}

/**
 * La place où tomberait ce qu'on glisse, le pointeur à cette hauteur : après chaque
 * autre carte dont le milieu est au-dessus de lui. La carte qu'on glisse et la place
 * laissée en pointillé ne comptent pas.
 */
function indexAt(list: HTMLElement | null, clientY: number, exclude: string | null): number {
    const cards = [...(list?.querySelectorAll<HTMLElement>('[data-favorite]') ?? [])].filter(
        (card) => card.dataset.favorite !== exclude,
    );

    return cards.filter((card) => {
        const { top, height } = card.getBoundingClientRect();

        return top + height / 2 < clientY;
    }).length;
}

function within(rect: DOMRect, x: number, y: number): boolean {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function placeDragCard(card: HTMLElement | null, pointer: { x: number; y: number; grabX: number; grabY: number }) {
    setPointerLength(card, '--drag-x', pointer.x - pointer.grabX);
    setPointerLength(card, '--drag-y', pointer.y - pointer.grabY);
}

/** Ouvre le menu du clic droit sous une carte, comme si on l'y avait demandé à la souris. */
function openMenuUnder(card: HTMLElement): void {
    const rect = card.getBoundingClientRect();
    card.dispatchEvent(
        new globalThis.MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + rect.width / 2,
            clientY: rect.bottom,
        }),
    );
}
