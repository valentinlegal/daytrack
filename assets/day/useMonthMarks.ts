import { useEffect, useState } from 'react';

import { useReturns } from '../useReturns';
import { monthOf, monthWeeks } from './calendar';
import type { CalendarApi, CalendarMonth, DayMark } from './calendarApi';

/**
 * Le mois du calendrier et ses marques. Il suit le jour affiché ; ses flèches le
 * changent sans changer de jour. Les marques se relisent à chaque changement de mois,
 * après chaque écriture de la journée, à minuit, et au retour sur la page (useReturns),
 * qu'un autre onglet a pu changer. Une réponse arrivée après un autre mois ne s'affiche pas.
 */
export function useMonthMarks(
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
    const returns = useReturns();

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
    }, [api, month, today, version, returns]);

    return {
        month,
        setMonth,
        marks: read?.month === month ? read.read.marks : null,
        daysOff: read?.month === month ? read.read.daysOff : null,
        monthDaysOff: read?.read.daysOff ?? null,
        monthWorkingDays: read?.read.workingDays ?? null,
    };
}
