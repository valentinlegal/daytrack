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

import { openMenuAt } from '../components/keyboardMenu';
import { tokenPixels } from '../components/tokenPixels';
import type { Favorite } from '../favorites/favorites';
import type { FavoriteList, FavoriteOutcome, FavoritesSnapshot, Removed } from '../favorites/favoriteList';
import { NO_CHECK, type TicketCheck } from '../jira/useTicketLookup';
import { firstRefusal, UNSAVED } from '../serverApi';
import { useReturns } from '../useReturns';
import { pointedQuarter } from './columnMeasure';
import { favoriteMessage, notice } from './messages';
import { startPointerDrag } from './pointerDrag';
import { setPointerLength } from './pointerLength';
import { FAVORITE_SHORTCUTS, shortcutOf } from './shortcuts';
import { ignoreHeldEnter } from './TicketField';
import { shapeRefusal, TicketSave } from './ticketSave';
import type { BlockDropTarget, GridEditing } from './useGridEditing';

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
    /** Ce qui est tapé : le ticket d'un ajout, récrit par son champ (TicketField), ou le nom d'un favori. */
    readonly setDraft: (draft: string) => void;
    /** On quitte le champ d'un ajout : sa forme se juge, comme dans la fenêtre Nouveau ticket. */
    readonly checkDraft: () => void;
    /** Enregistre, comme Entrée. */
    readonly submit: () => void;
    /**
     * Enregistre le formulaire ouvert avant un geste qui ouvre autre chose, comme sur un clic
     * à côté. La promesse dit s'il s'est fermé ; refusé, il reste ouvert avec son message,
     * le curseur dans son champ.
     */
    readonly leave: () => Promise<boolean>;
    readonly cancel: () => void;
    /**
     * Échap, d'où que soit le curseur, ferme le formulaire ouvert sans rien enregistrer —
     * sauf le temps d'un enregistrement, qui le retient. Faux s'il n'y en a pas.
     */
    readonly escape: () => boolean;
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
    scrollerRef,
    blockDropRef,
    beforeFormRef,
}: {
    list: FavoriteList;
    editing: GridEditing;
    /** La colonne des blocs : un favori qu'on glisse y vise un quart d'heure. */
    laneRef: RefObject<HTMLElement | null>;
    /** La zone qui fait défiler la grille : un favori n'y tombe que sur ce qu'elle montre. */
    scrollerRef: RefObject<HTMLElement | null>;
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
    /**
     * Un glisser vient de finir, posé ou abandonné : relâché sur une carte, le clic qui suit
     * n'est pas un clic.
     */
    const draggedRef = useRef(false);
    const stopRef = useRef<(() => void) | null>(null);
    /** Le favori à qui rendre le curseur une fois la liste redessinée, ou le + de l'en-tête (ADD_BUTTON). */
    const focusRef = useRef<string | null>(null);
    /** L'enregistrement du formulaire : un seul à la fois, que les autres gestes attendent. */
    const [save] = useState(() => new TicketSave());
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

    // La liste se relit au retour sur la page, sur l'onglet ou dans la fenêtre : un autre a
    // pu la changer.
    const returns = useReturns();
    useEffect(() => {
        void list.load();
    }, [list, returns]);

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
            editing.notify(notice(stale));
        } else if (outcome.kind === 'failed') {
            editing.notify(notice(UNSAVED));
        } else if (outcome.kind === 'invalid') {
            editing.notify(notice(firstRefusal(outcome.violations)));
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
     *
     * Un ajout passe par le chemin commun des champs Ticket (ticketSave.ts), comme la
     * fenêtre de ticket : un ticket manquant, mal formé ou que Jira ne connaît pas ne part
     * pas — le serveur laisse passer un ticket qu'une saisie porte déjà, il ne le refuserait
     * pas tout seul —, et l'ajout attend la réponse de Jira quand il cherche encore.
     */
    const submit = (): Promise<boolean> => {
        const shown = form;
        if (shown === null) {
            return Promise.resolve(true);
        }
        const renamed = shown.favorite;
        const refuse = (error: string) => {
            setForm((open) => (open?.key === shown.key ? { ...open, sending: false, error, refused: next() } : open));
        };

        return save.run({
            check: renamed === null ? formCheckRef.current : null,
            sending: shown.sending,
            refusal: renamed !== null ? null : shown.draft.trim() === '' ? MISSING_TICKET : shapeRefusal(shown.draft),
            refuse,
            start: () => {
                setForm({ ...shown, sending: true, error: null, refused: 0 });

                return () => (renamed === null ? list.add(shown.draft) : list.rename(renamed.id, shown.draft));
            },
            settle: (outcome: FavoriteOutcome) => {
                if (outcome.kind === 'invalid' || outcome.kind === 'failed') {
                    refuse(outcome.kind === 'failed' ? UNSAVED : firstRefusal(outcome.violations));

                    return false;
                }
                const focused = formHasFocus();
                close(shown);
                if (focused) {
                    keepFocus(renamed?.id ?? null);
                }
                report(outcome, RENAME_STALE);

                return true;
            },
        });
    };

    /**
     * « Annuler », ou Échap : le formulaire se ferme sans rien enregistrer. Le curseur qui y
     * était revient au favori renommé, ou au + de l'en-tête ; posé ailleurs, il y reste
     * (formHasFocus).
     */
    const cancel = (): boolean => {
        if (form === null) {
            return false;
        }
        if (!form.sending) {
            const focused = formHasFocus();
            close(form);
            if (focused) {
                keepFocus(form.favorite?.id ?? null);
            }
        }

        return true;
    };

    /**
     * Un clic à côté du formulaire l'enregistre, comme on quitte une cellule de tableur.
     * Un ajout encore vide n'a rien à enregistrer : le formulaire se ferme.
     */
    const leaveForm = (): Promise<boolean> => {
        if (form !== null && form.favorite === null && form.draft.trim() === '' && save.current === null) {
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
            editing.notify(favoriteMessage(added.ticket, 'added'), () => {
                editing.notify(null);
                void list.remove(added.id).then(({ outcome: removal }) => {
                    report(removal);
                });
            });
        });
    };

    /**
     * « SHOP-482 retiré des favoris », et de quoi le remettre : « Annuler », que Ctrl/⌘+Z
     * double tant que le message est affiché, comme celui de la grille. Le curseur que le
     * message rend revient à la liste, et suit le favori remis.
     */
    const announceRemoved = (removed: Removed) => {
        editing.notify(
            favoriteMessage(removed.favorite.ticket, 'removed'),
            () => {
                editing.notify(null);
                void list.restore(removed).then((outcome) => {
                    const back = list
                        .current()
                        .favorites?.find((favorite) => favorite.ticket === removed.favorite.ticket);
                    keepFocus(back?.id ?? null);
                    report(outcome);
                });
            },
            () => {
                addButtonRef.current?.focus();
            },
        );
    };

    // Le glisser d'un favori : il suit le pointeur jusqu'au relâcher, comme un glisser sur la
    // grille (pointerDrag.ts).

    /** Où tomberait ce qu'on glisse, le pointeur ici. */
    const targetAt = (clientX: number, clientY: number, exclude: string | null) => {
        const column = columnRef.current?.getBoundingClientRect();
        if (column !== undefined && within(column, clientX, clientY)) {
            return { index: indexAt(listRef.current, clientY, exclude), quarter: null };
        }
        const lane = laneRef.current;
        const frame = scrollerRef.current?.getBoundingClientRect();
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
            return { index: null, quarter: editing.closed ? null : pointedQuarter(lane, clientY) };
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
        const pointer = pointerRef.current;
        pointer.grabX = startX - card.left;
        pointer.grabY = startY - card.top;
        stopRef.current = startPointerDrag({
            start: { x: startX, y: startY },
            threshold: tokenPixels(DRAG_THRESHOLD),
            lane: () => laneRef.current,
            scroller: () => scrollerRef.current,
            onStart: () => {
                editing.notify(null);
            },
            onMove: (x, y) => {
                pointer.x = x;
                pointer.y = y;
                placeDragCard(dragCardRef.current, pointer);
                handlersRef.current.move(favorite, x, y);
            },
            onEnd: (x, y) => {
                stopRef.current = null;
                draggedRef.current = true;
                handlersRef.current.end(favorite, x, y);
            },
            // Échap n'abandonne que le glisser : une fenêtre de ticket restée ouverte, ou le
            // formulaire d'un favori, gardent leur saisie.
            onCancel: () => {
                stopRef.current = null;
                setDrag(null);
                // Le relâcher sur la carte elle-même n'est pas un clic.
                draggedRef.current = true;
            },
        });
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
        setDraft: (draft) => {
            const shown = form;
            if (shown === null || shown.sending) {
                return;
            }
            setForm({ ...shown, draft, error: null, refused: 0 });
        },
        checkDraft: () => {
            setForm((open) => {
                const refusal = open?.favorite !== null || open.sending ? null : shapeRefusal(open.draft);

                return open === null || refusal === null ? open : { ...open, error: refusal, refused: 0 };
            });
        },
        submit: () => {
            void submit();
        },
        leave: leaveForm,
        cancel: () => {
            cancel();
        },
        escape: cancel,
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
            // Le second clic d'un double-clic renomme : il ne copie pas une seconde fois. Entrée
            // ou Espace sur la carte, un clic sans pointeur, copient toujours : un glisser
            // relâché loin d'elle n'a pas laissé de clic à avaler.
            const dragged = draggedRef.current;
            draggedRef.current = false;
            if ((dragged && event.detail > 0) || event.detail > 1) {
                return;
            }
            copy(favorite);
        },
        onCardKeyDown: (event, favorite) => {
            ignoreHeldEnter(event);
            const shortcut = shortcutOf(event.nativeEvent, FAVORITE_SHORTCUTS);
            if (shortcut === null) {
                return;
            }
            event.preventDefault();
            switch (shortcut) {
                case 'moveUp':
                case 'moveDown':
                    move(favorite, shortcut === 'moveUp' ? -1 : 1);
                    break;
                case 'paste':
                    // Un favori vient d'être copié, la sélection de la grille attend : on y
                    // colle, et le curseur va où le geste a porté. Fermée à la saisie, la grille
                    // ne prend ni le collage ni le curseur, qui reste sur le favori.
                    if (!editing.closed) {
                        editing.paste();
                        editing.focusGrid();
                    }
                    break;
                case 'copy':
                    copy(favorite);
                    break;
                case 'edit':
                    openRename(favorite);
                    break;
                case 'delete':
                    // Une touche tenue ne retire pas les voisins l'un après l'autre.
                    if (!event.repeat) {
                        remove(favorite);
                    }
                    break;
                case 'menu': {
                    // Le menu s'ouvre sous la carte, pas là où le navigateur le poserait.
                    const card = event.currentTarget.getBoundingClientRect();
                    openMenuAt(event.currentTarget, card.left + card.width / 2, card.bottom);
                    break;
                }
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

/** Un ajout envoyé sans ticket. */
const MISSING_TICKET = 'Indiquez un ticket.';

/**
 * Le curseur est dans le formulaire, ou s'est perdu : le formulaire qui se ferme le rend au
 * favori renommé, ou au + de l'en-tête. Posé ailleurs — la grille, un favori cliqué —, il y
 * reste : l'application ne déplace jamais un curseur posé.
 */
function formHasFocus(): boolean {
    const focused = document.activeElement;

    return (
        focused === null ||
        focused === document.body ||
        document.querySelector('[data-favorite-form]')?.contains(focused) === true
    );
}

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
