import { type RefObject, useRef, useState } from 'react';

import type { OpenWindow } from './ObjectiveWindow';

export interface ObjectiveWindowState {
    /** Ouverte sur le jour affiché. */
    readonly open: boolean;
    /** L'écart qui aligne la fenêtre sur la date de la barre. */
    readonly alignOffset: number;
    /** Le bouton de l'objectif, sous lequel elle s'ouvre. */
    readonly buttonRef: RefObject<HTMLButtonElement | null>;
    /** La date de la barre, sur laquelle elle s'aligne. */
    readonly titleRef: RefObject<HTMLHeadingElement | null>;
    /** Ce qui l'enregistre quand elle est ouverte. */
    readonly flushRef: RefObject<OpenWindow | null>;
    /** Le bouton de l'objectif : ouvre la fenêtre, ou l'enregistre si elle l'est déjà. */
    readonly onButton: () => void;
    readonly close: () => void;
}

/** La fenêtre Objectif du jour, ouverte sur un jour : changer de jour la ferme. */
export function useObjectiveWindow({
    date,
    othersOpen,
    flush,
    onOpen,
}: {
    date: string;
    /** Une fenêtre de ticket ou le formulaire d'un favori est ouvert : il s'enregistre d'abord. */
    othersOpen: boolean;
    /** Enregistre les fenêtres ouvertes ; la promesse dit si elles se sont fermées. */
    flush: () => Promise<boolean>;
    /** Elle vient de s'ouvrir. */
    onOpen: () => void;
}): ObjectiveWindowState {
    const [objective, setObjective] = useState<{ date: string; alignOffset: number } | null>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const titleRef = useRef<HTMLHeadingElement>(null);
    const flushRef = useRef<OpenWindow | null>(null);
    const open = objective?.date === date;

    const onButton = () => {
        // Fenêtre ouverte, recliquer sur l'objectif est un clic à côté : elle s'enregistre,
        // et ne se ferme que si c'est accepté.
        if (open) {
            void flushRef.current?.save();

            return;
        }
        const show = () => {
            const button = buttonRef.current?.getBoundingClientRect().left ?? 0;
            const title = titleRef.current?.getBoundingClientRect().left ?? button;
            setObjective({ date, alignOffset: title - button });
            onOpen();
        };
        // Ce qui est ouvert s'enregistre d'abord. Refusé, il reprend le curseur, et cet
        // objectif, qui venait de le prendre, s'enregistrerait tout seul.
        if (!othersOpen) {
            show();
        } else {
            void flush().then((closed) => {
                if (closed) {
                    show();
                }
            });
        }
    };

    return {
        open,
        alignOffset: objective?.alignOffset ?? 0,
        buttonRef,
        titleRef,
        flushRef,
        onButton,
        close: () => {
            setObjective(null);
        },
    };
}
