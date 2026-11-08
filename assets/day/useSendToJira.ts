import { type RefObject, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';

import type { DayState } from '../grid/day';
import type { DaySession, ShownDay } from '../grid/daySession';
import { recap } from '../grid/recap';
import { NOTHING_SENT, type SendFailure, type SendStatus } from '../grid/send';
import { celebrate } from './confetti';
import { notice } from './messages';
import { afterSend, sendButton, type SendButtonView, type SendRow, sendRows, type SendWindowKind } from './sendView';
import type { GridEditing } from './useGridEditing';

/** Le temps entre deux lectures d'une journée qu'un autre onglet envoie. */
const SENDING_POLL = 2000;

export interface SendToJira {
    /** Un envoi est parti de cet onglet, et attend sa réponse : le voile bloque l'écran. */
    readonly sending: boolean;
    /** L'état d'envoi de la journée affichée. */
    readonly status: SendStatus;
    /** Le bouton Jira de la barre. */
    readonly view: SendButtonView;
    /** La fenêtre du bouton ouverte sur le jour affiché, null si elle est fermée. */
    readonly openKind: SendWindowKind | null;
    /** Ses lignes, ticket par ticket. */
    readonly rows: readonly SendRow[];
    /** Le bouton Jira : la fenêtre que son état ouvre, ou la referme. */
    readonly onButton: () => void;
    /** Envoie la journée affichée. */
    readonly start: () => void;
    readonly closeWindow: () => void;
}

/**
 * L'envoi sur Jira de la journée affichée : le bouton, sa fenêtre, le voile pendant
 * l'envoi, et ce qui suit sa réponse (afterSend). Une journée qu'un autre onglet envoie se
 * relit jusqu'à ce que l'envoi finisse.
 */
export function useSendToJira({
    currentDate,
    session,
    day,
    buttonRef,
    confettiRef,
    notify,
    flush,
    onWindowOpen,
    onJiraRefusal,
    onSendingChange,
}: {
    /** Le jour affiché au moment où on l'appelle. */
    currentDate: () => string;
    session: DaySession | null;
    day: DayState | null;
    /** Le bouton Jira de la barre, d'où partent les confettis. */
    buttonRef: RefObject<HTMLButtonElement | null>;
    /** La toile où partent les confettis d'un envoi réussi. */
    confettiRef: RefObject<HTMLCanvasElement | null>;
    /** Où la réponse de l'envoi se dit : le message de la grille. */
    notify: GridEditing['notify'];
    /** Enregistre les fenêtres ouvertes ; la promesse dit si elles se sont fermées. */
    flush: () => Promise<boolean>;
    /** La fenêtre du bouton s'ouvre. */
    onWindowOpen: () => void;
    /** Un envoi a appris que Jira refuse le jeton : le bandeau le dit. */
    onJiraRefusal?: ((refusal: Extract<SendFailure, 'refused' | 'missing_scope'>) => void) | undefined;
    /** Un envoi part, ou finit : ce qui est hors de l'écran passe sous le voile. */
    onSendingChange?: ((sending: boolean) => void) | undefined;
}): SendToJira {
    // La fenêtre du bouton Jira, et l'envoi parti de cet onglet. La fenêtre ne vaut que pour
    // la session où elle s'est ouverte : un autre jour, ou le même retrouvé par les flèches du
    // navigateur, ne la remontre pas. Elle retient la journée qu'elle montrait en s'ouvrant
    // (DaySession.seen) : relue changée depuis, au retour sur la page, la confirmation
    // n'envoie rien, comme le serveur l'aurait refusé, et le détail d'un envoi ou son
    // résultat, qui décrivent un envoi passé, se ferment plutôt que de dire faux.
    const [sendWindow, setSendWindow] = useState<{ kind: SendWindowKind; opened: Opened } | null>(null);
    const [sending, setSending] = useState(false);
    /** L'ouverture qui attend les fenêtres et la relecture en route ; Échap ou un appui ailleurs y renoncent. */
    const openingRef = useRef<object | null>(null);

    const status = day?.send ?? NOTHING_SENT;
    const view = sendButton(sending ? { ...status, state: 'sending' } : status);
    const stillShown =
        sendWindow !== null &&
        sendWindow.opened.session === session &&
        (sendWindow.kind === 'confirm' || sendWindow.opened.session.seen() === sendWindow.opened.seen);
    if (sendWindow !== null && !stillShown) {
        setSendWindow(null);
    }
    const openKind = stillShown ? sendWindow.kind : null;
    const rows = useMemo(
        () => (day === null || openKind === null ? [] : sendRows(recap(day.grid), day.send, openKind)),
        [day, openKind],
    );

    // Une journée qu'un autre onglet envoie se relit jusqu'à ce que l'envoi finisse, même
    // quand une lecture échoue et ne change rien.
    const sendingElsewhere = !sending && status.state === 'sending';
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

    const onButton = () => {
        const opens = view.opens;
        if (opens === null) {
            return;
        }
        if (openKind !== null) {
            setSendWindow(null);

            return;
        }
        // Une fenêtre de ticket ouverte s'enregistre d'abord, comme sur un clic à côté, et la
        // relecture en route arrive : la confirmation montre la journée telle qu'elle partira.
        // Échap, ou un appui ailleurs pendant cette attente, y renoncent, comme pour une
        // fenêtre de ticket demandée pendant un geste.
        const from = session;
        if (from === null) {
            return;
        }
        const opening = {};
        openingRef.current = opening;
        const listening = new AbortController();
        const renounce = (event: Event) => {
            if (event.type === 'pointerdown' || (event instanceof KeyboardEvent && event.key === 'Escape')) {
                listening.abort();
                if (openingRef.current === opening) {
                    openingRef.current = null;
                }
            }
        };
        window.addEventListener('pointerdown', renounce, { capture: true, signal: listening.signal });
        window.addEventListener('keydown', renounce, { capture: true, signal: listening.signal });
        void flush()
            .then(async (closed) => {
                await from.settled();

                return closed;
            })
            .then((closed) => {
                listening.abort();
                if (openingRef.current !== opening) {
                    return;
                }
                openingRef.current = null;
                if (closed) {
                    onWindowOpen();
                    setSendWindow({ kind: opens, opened: openedOn(from) });
                }
            });
    };

    /**
     * Le voile bloque l'écran jusqu'à la réponse : la journée envoyée est celle qu'on voit.
     * Ce qui suit — confettis, fenêtre, message, bandeau du jeton —, afterSend le décide.
     */
    const start = () => {
        if (session === null || sending) {
            return;
        }
        const sent = session;
        // La journée que la fenêtre montrait part avec l'envoi : changée depuis, rien ne part.
        const shown = sendWindow?.opened.session === sent ? sendWindow.opened : undefined;
        setSendWindow(null);
        setSending(true);
        void sent.sendToJira(shown).then((outcome) => {
            setSending(false);
            if (currentDate() !== sent.date) {
                return;
            }
            const next = afterSend(outcome, sent.current().day.send);
            if (next.tokenRefusal !== null) {
                onJiraRefusal?.(next.tokenRefusal);
            }
            if (next.notice !== null) {
                notify(notice(next.notice));
            }
            if (next.window !== null) {
                setSendWindow({ kind: next.window, opened: openedOn(sent) });
            }
            const button = buttonRef.current;
            const canvas = confettiRef.current;
            if (next.confetti && button !== null && canvas !== null) {
                celebrate(canvas, button.getBoundingClientRect());
            }
        });
    };

    return {
        sending,
        status,
        view,
        openKind,
        rows,
        onButton,
        start,
        closeWindow: () => {
            setSendWindow(null);
        },
    };
}

/** La journée qu'une fenêtre d'envoi montrait en s'ouvrant, dans sa session. */
interface Opened extends ShownDay {
    readonly session: DaySession;
}

function openedOn(session: DaySession): Opened {
    return { session, version: session.current().day.version, seen: session.seen() };
}
