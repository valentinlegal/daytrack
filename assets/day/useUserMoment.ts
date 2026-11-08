import { useEffect, useState } from 'react';

import { momentAt, type UserMoment } from '../grid/clock';
import { watchReturns } from '../useReturns';

const MINUTE = 60_000;

/**
 * Le jour et l'heure de l'utilisateur, remis à jour à chaque minute : la ligne
 * « maintenant », la fin prévue et le jour d'aujourd'hui suivent l'heure qui tourne,
 * minuit compris.
 *
 * Un ordinateur qui se réveille ne rattrape pas les minuteurs en retard : l'heure se
 * relit aussi au retour sur la page, comme ce qu'un autre onglet a pu changer.
 */
export function useUserMoment(timeZone: string): UserMoment {
    const [moment, setMoment] = useState(() => momentAt(new Date(), timeZone));

    useEffect(() => {
        let timer: number | undefined;
        const schedule = (now: Date) => {
            window.clearTimeout(timer);
            timer = window.setTimeout(refresh, MINUTE - (now.getTime() % MINUTE));
        };
        const refresh = () => {
            const now = new Date();
            const next = momentAt(now, timeZone);
            setMoment((current) => (current.date === next.date && current.minute === next.minute ? current : next));
            schedule(now);
        };

        schedule(new Date());
        const stop = watchReturns(window, refresh);

        return () => {
            window.clearTimeout(timer);
            stop();
        };
    }, [timeZone]);

    return moment;
}
