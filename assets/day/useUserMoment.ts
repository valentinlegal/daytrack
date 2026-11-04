import { useEffect, useState } from 'react';

import { momentAt, type UserMoment } from '../grid/clock';

const MINUTE = 60_000;

/**
 * Le jour et l'heure de l'utilisateur, remis à jour à chaque minute : la ligne
 * « maintenant », la fin prévue et le jour d'aujourd'hui suivent l'heure qui tourne,
 * minuit compris.
 *
 * Un ordinateur qui se réveille ne rattrape pas les minuteurs en retard : l'heure se
 * relit aussi quand la page redevient visible.
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
        const onVisible = () => {
            if (document.visibilityState === 'visible') {
                refresh();
            }
        };

        schedule(new Date());
        document.addEventListener('visibilitychange', onVisible);

        return () => {
            window.clearTimeout(timer);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [timeZone]);

    return moment;
}
