import { type RefObject, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { type Address, currentAddress, dayAddress, followArrow, refuseArrow, showAddress } from '../address';
import type { DaySession, SessionSnapshot } from '../grid/daySession';
import type { DaySessions } from '../grid/daySessions';
import { useReturns } from '../useReturns';

/** Ce que l'ouverture d'un jour a donné : sa session, ou l'échec de sa lecture. */
export type Opened = { readonly date: string } & (
    | {
          readonly session: DaySession;
          /** L'heure en haut de la vue quand la journée s'est ouverte : le message d'une journée vide s'y place. */
          readonly top: number;
      }
    | { readonly failed: true }
);

export interface DayNavigation {
    /** Le jour affiché, celui de l'adresse. */
    readonly date: string;
    /** Le jour affiché au moment où on l'appelle : relu une fois les fenêtres enregistrées. */
    readonly currentDate: () => string;
    /** Ce que l'ouverture du jour affiché a donné, null pendant sa lecture. */
    readonly shown: Opened | null;
    readonly session: DaySession | null;
    /** L'état de la journée affichée, suivi geste après geste. */
    readonly snapshot: SessionSnapshot | null;
    /**
     * Change de jour, une fois les fenêtres enregistrées.
     *
     * @param left ce qui ne doit arriver que si on quitte vraiment les fenêtres : refusée, une
     *             fenêtre garde le jour affiché, et ce qui l'entoure
     */
    readonly go: (next: string, left?: () => void) => void;
}

/**
 * Le jour affiché et sa journée. Changer de jour l'écrit dans l'adresse, et les flèches du
 * navigateur y ramènent (arrowsRef), ou mènent aux réglages (toSettings). Les fenêtres
 * ouvertes s'enregistrent d'abord, comme sur un clic à côté : refusée, une fenêtre reste
 * ouverte, et le jour aussi. Un envoi en cours retient de même la journée. Une flèche qui ne
 * quitte pas la journée laisse l'historique tel qu'il était (refuseArrow).
 *
 * Tout ce qui lit la journée passe par sa session : une réponse arrivée après un
 * changement de jour ne touche jamais la journée affichée. Elle se relit au retour sur la
 * page (useReturns), comme le calendrier et les favoris.
 */
export function useDayNavigation({
    initial,
    last,
    sessions,
    visibleTop,
    flush,
    held,
    arrowsRef,
    toSettings,
}: {
    /** Le jour de l'adresse au chargement. */
    initial: string;
    /** Le dernier jour qui s'ouvre. */
    last: string;
    sessions: DaySessions;
    /** L'heure en haut de la vue, lue quand la journée s'ouvre. */
    visibleTop: () => number;
    /** Enregistre les fenêtres ouvertes ; la promesse dit si elles se sont fermées. */
    flush: () => Promise<boolean>;
    /** Un envoi sur Jira en cours retient la journée : les flèches du navigateur ne la quittent pas. */
    held: () => boolean;
    /** Ce que la journée fait des flèches du navigateur, que l'application écoute (useBrowserArrows). */
    arrowsRef?: RefObject<((address: Address) => void) | null> | undefined;
    /**
     * Une flèche du navigateur mène aux réglages, et les fenêtres se sont enregistrées :
     * l'application les ouvre, sur le jour qu'on quitte. Sans elle, la page se recharge.
     */
    toSettings?: ((back: string) => void) | undefined;
}): DayNavigation {
    const [date, setDate] = useState(initial);
    const [opened, setOpened] = useState<Opened | null>(null);
    const dateRef = useRef(date);
    useEffect(() => {
        dateRef.current = date;
    }, [date]);
    const currentDate = useCallback(() => dateRef.current, []);

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
        if (arrowsRef === undefined) {
            return;
        }
        arrowsRef.current = (address) => {
            // Le même jour — une ancre ajoutée à l'adresse — : rien ne change.
            if (address.screen === 'day' && address.date === dateRef.current) {
                followArrow();

                return;
            }
            // Un envoi en cours retient la journée, comme une fenêtre refusée : l'adresse
            // revient au jour qu'il envoie, sans rien recharger.
            if (held()) {
                refuseArrow(dayAddress(dateRef.current));

                return;
            }
            const settings = address.screen === 'settings' && toSettings !== undefined;
            if (address.screen !== 'day' && !settings) {
                // Ce que seul le serveur sait lire : la page se recharge, et demande avant de
                // partir si une fenêtre a reçu ce qui n'est pas enregistré.
                window.location.reload();

                return;
            }
            // Comme les flèches de la barre et le bouton Réglages : les fenêtres ouvertes
            // s'enregistrent d'abord. Refusée, une fenêtre reste ouverte, et l'adresse revient
            // au jour qu'elle montre encore.
            void flush().then((closed) => {
                // Revenu entre-temps ailleurs par les flèches : c'est la dernière qui compte.
                const here = currentAddress();
                const still =
                    address.screen === 'day'
                        ? here.screen === 'day' && here.date === address.date
                        : here.screen === address.screen;
                if (!still) {
                    return;
                }
                if (!closed) {
                    refuseArrow(dayAddress(dateRef.current));
                } else if (address.screen === 'day') {
                    followArrow();
                    setDate(address.date);
                    setOpened(null);
                } else {
                    toSettings?.(dateRef.current);
                }
            });
        };

        return () => {
            arrowsRef.current = null;
        };
    }, [arrowsRef, flush, held, toSettings]);

    // Ce qui vient d'un autre jour que celui affiché ne s'affiche pas.
    const shown = opened?.date === date ? opened : null;
    const session = shown !== null && 'session' in shown ? shown.session : null;
    const snapshot = useSnapshot(session);

    // Au retour sur la page, la journée affichée se relit : un autre onglet a pu l'écrire, ou
    // l'envoyer. La relecture prend son tour dans la file de la session, derrière les gestes
    // déjà partis. Un retour pendant qu'un jour s'ouvre attend sa session.
    const returns = useReturns();
    const refreshedRef = useRef(returns);
    useEffect(() => {
        if (session === null || refreshedRef.current === returns) {
            return;
        }
        refreshedRef.current = returns;
        void session.refresh();
    }, [session, returns]);

    const go = (next: string, left?: () => void) => {
        if (next > last || (next === date && left === undefined)) {
            return;
        }
        void flush().then((closed) => {
            if (!closed) {
                return;
            }
            left?.();
            if (dateRef.current === next) {
                return;
            }
            showAddress(dayAddress(next));
            setDate(next);
            // La session du jour qu'on quitte se ferme : revenir dessus avant que
            // l'autre jour ne soit lu ne doit pas la remontrer.
            setOpened(null);
        });
    };

    return { date, currentDate, shown, session, snapshot, go };
}

function useSnapshot(session: DaySession | null): SessionSnapshot | null {
    const subscribe = useCallback(
        (listener: () => void) => session?.subscribe(listener) ?? (() => undefined),
        [session],
    );

    return useSyncExternalStore(subscribe, () => session?.current() ?? null);
}
