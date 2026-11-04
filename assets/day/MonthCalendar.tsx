import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';

import { Button } from '../components/Button';
import { ChevronLeft, ChevronRight } from '../components/icons';
import { Tooltip } from '../components/Tooltip';
import {
    addMonths,
    calendarKeyTarget,
    dayOfMonthLabel,
    isWorkingDay,
    monthOf,
    monthTitle,
    monthWeeks,
} from './calendar';
import type { DayMark } from './calendarApi';

const WEEKDAYS = [
    ['L', 'lundi'],
    ['M', 'mardi'],
    ['M', 'mercredi'],
    ['J', 'jeudi'],
    ['V', 'vendredi'],
    ['S', 'samedi'],
    ['D', 'dimanche'],
] as const;

const MARK_LABELS: Record<DayMark, string> = {
    incomplete: 'incomplet',
    unsent: 'non envoyé',
    sent: 'envoyé',
    modified: "modifié depuis l'envoi",
};

/**
 * Le calendrier du mois, sous les favoris : un clic ouvre un jour, chaque jour porte sa
 * marque, la légende reste dessous.
 *
 * Au clavier, une seule étape de tabulation : les flèches vont de jour en jour et de
 * semaine en semaine, Début et Fin au bout de la semaine, Page précédente et suivante
 * de mois en mois, Entrée ouvre le jour (motif « grille » de l'APG).
 */
export function MonthCalendar({
    month,
    shown,
    today,
    last,
    workingDays,
    marks,
    daysOff = null,
    onMonth,
    onOpen,
}: {
    /** Le mois affiché, « AAAA-MM ». */
    month: string;
    /** Le jour affiché par l'écran. */
    shown: string;
    today: string;
    /** Le dernier jour qui s'ouvre : au-delà, un jour ne se clique pas. */
    last: string;
    workingDays: readonly number[];
    /** null tant qu'elles ne sont pas lues : aucun jour n'est marqué. */
    marks: ReadonlyMap<string, DayMark> | null;
    /** Les jours mis à 0h00, grisés comme un samedi ; null tant qu'ils ne sont pas lus. */
    daysOff?: ReadonlySet<string> | null;
    onMonth: (month: string) => void;
    onOpen: (date: string) => void;
}) {
    const titleId = useId();
    const gridRef = useRef<HTMLDivElement>(null);
    const weeks = monthWeeks(month);
    const days = weeks.flat();
    // Le jour où est le curseur du clavier ; il revient au jour affiché quand celui-ci change.
    const [cursor, setCursor] = useState<string | null>(null);
    const [cursorOf, setCursorOf] = useState(shown);
    if (cursorOf !== shown) {
        setCursorOf(shown);
        setCursor(null);
    }
    const focusRef = useRef(false);
    const tabbable =
        cursor !== null && days.includes(cursor)
            ? cursor
            : monthOf(shown) === month
              ? shown
              : monthOf(today) === month
                ? today
                : `${month}-01`;
    const canGoNext = `${addMonths(month, 1)}-01` <= last;

    // Le clavier a changé de mois : le jour visé n'existe qu'une fois le mois rendu.
    useEffect(() => {
        if (focusRef.current) {
            focusRef.current = false;
            gridRef.current?.querySelector<HTMLElement>(`[data-date="${tabbable}"]`)?.focus();
        }
    }, [tabbable]);

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const from = event.target instanceof HTMLElement ? event.target.dataset.date : undefined;
        if (from === undefined || event.altKey || event.ctrlKey || event.metaKey) {
            return;
        }
        const aimed = calendarKeyTarget(from, event.key);
        if (aimed === null) {
            return;
        }
        // Pas plus loin que le dernier jour qui s'ouvre, comme « Mois suivant ».
        const target = aimed > last ? last : aimed;
        event.preventDefault();
        setCursor(target);
        // Page précédente et suivante changent toujours de mois, même vers un jour déjà
        // visible dans une semaine d'à côté ; une flèche, seulement pour quitter la grille.
        const paging = event.key === 'PageUp' || event.key === 'PageDown';
        if (monthOf(target) !== month && (paging || !days.includes(target))) {
            onMonth(monthOf(target));
        }
        if (target === tabbable) {
            gridRef.current?.querySelector<HTMLElement>(`[data-date="${target}"]`)?.focus();
        } else {
            // Le jour visé n'a le curseur qu'au rendu d'après : un geste sans effet ne laisse
            // pas de focus en attente, que le prochain changement de jour déplacerait.
            focusRef.current = true;
        }
    };

    return (
        <section aria-labelledby={titleId} className="mt-4 flex-none border-t border-line px-4 pb-4" data-calendar>
            <div className="flex h-7 items-center justify-between pl-1">
                <h2 id={titleId} className="text-sm font-semibold text-ink-2" aria-live="polite">
                    {monthTitle(month)}
                </h2>
                <div className="flex gap-1">
                    <Tooltip label={monthTitle(addMonths(month, -1))}>
                        <Button
                            variant="ghost"
                            size="sm"
                            iconOnly
                            aria-label="Mois précédent"
                            onClick={() => {
                                setCursor(null);
                                onMonth(addMonths(month, -1));
                            }}
                        >
                            <ChevronLeft />
                        </Button>
                    </Tooltip>
                    {/* Éteinte, elle n'a pas d'infobulle : elle nommerait un mois où l'on ne va pas. */}
                    <Tooltip label={monthTitle(addMonths(month, 1))} open={canGoNext ? undefined : false}>
                        <Button
                            variant="ghost"
                            size="sm"
                            iconOnly
                            aria-label="Mois suivant"
                            aria-disabled={!canGoNext}
                            onClick={
                                canGoNext
                                    ? () => {
                                          setCursor(null);
                                          onMonth(addMonths(month, 1));
                                      }
                                    : undefined
                            }
                        >
                            <ChevronRight />
                        </Button>
                    </Tooltip>
                </div>
            </div>
            <div
                ref={gridRef}
                role="grid"
                aria-labelledby={titleId}
                // Le curseur va à un jour, jamais à la grille elle-même.
                tabIndex={-1}
                className="grid grid-cols-7 gap-x-1 gap-y-2"
                onKeyDown={onKeyDown}
            >
                <div role="row" className="contents">
                    {WEEKDAYS.map(([letter, name]) => (
                        <span
                            key={name}
                            role="columnheader"
                            aria-label={name}
                            className="flex h-5 items-center justify-center text-xs text-ink-3"
                        >
                            {letter}
                        </span>
                    ))}
                </div>
                {weeks.map((week) => (
                    <div key={week[0]} role="row" className="contents">
                        {week.map((date) => (
                            <div key={date} role="gridcell" className="contents">
                                <CalendarDay
                                    date={date}
                                    outside={monthOf(date) !== month}
                                    shown={date === shown}
                                    today={date === today}
                                    working={isWorkingDay(date, workingDays) && daysOff?.has(date) !== true}
                                    disabled={date > last}
                                    mark={marks?.get(date) ?? null}
                                    tabbable={date === tabbable}
                                    onOpen={onOpen}
                                />
                            </div>
                        ))}
                    </div>
                ))}
            </div>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-2 px-1 pt-4 text-xs text-ink-2">
                <LegendItem mark="sent">Envoyé</LegendItem>
                <LegendItem mark="unsent">Non envoyé</LegendItem>
                <LegendItem mark="modified">Modifié</LegendItem>
                <LegendItem mark="incomplete">Incomplet</LegendItem>
            </ul>
        </section>
    );
}

function CalendarDay({
    date,
    outside,
    shown,
    today,
    working,
    disabled,
    mark,
    tabbable,
    onOpen,
}: {
    date: string;
    /** Du mois d'avant ou d'après. */
    outside: boolean;
    shown: boolean;
    today: boolean;
    working: boolean;
    disabled: boolean;
    mark: DayMark | null;
    tabbable: boolean;
    onOpen: (date: string) => void;
}) {
    // Le jour affiché l'emporte sur aujourd'hui ; un jour à part ne change que de teinte.
    const number = shown
        ? 'bg-btn font-semibold text-on-btn'
        : today
          ? 'bg-bg-press font-bold text-ink'
          : `${outside || !working ? 'text-ink-3' : ''} ${disabled ? '' : 'group-hover/day:bg-bg-hover'}`;
    const label = [
        dayOfMonthLabel(date),
        today ? "aujourd'hui" : null,
        shown ? 'jour affiché' : null,
        working ? null : 'non travaillé',
        mark === null ? null : MARK_LABELS[mark],
    ]
        .filter((part) => part !== null)
        .join(', ');

    return (
        <button
            type="button"
            data-date={date}
            tabIndex={tabbable ? 0 : -1}
            aria-label={label}
            aria-current={today ? 'date' : undefined}
            aria-disabled={disabled || undefined}
            // Un groupe nommé : l'écran entier est déjà un groupe, et son survol allumerait tous les jours.
            className="group/day flex h-ctl min-w-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-2 border-none bg-transparent p-0 text-ink aria-disabled:cursor-default aria-disabled:opacity-(--o-disabled)"
            onClick={
                disabled
                    ? undefined
                    : () => {
                          onOpen(date);
                      }
            }
        >
            <span className={`flex h-row w-6 items-center justify-center rounded-pill text-sm tabular-nums ${number}`}>
                {Number(date.slice(8))}
            </span>
            <span aria-hidden="true" className="day-mark" data-mark={mark ?? undefined} />
        </button>
    );
}

function LegendItem({ mark, children }: { mark: string; children: string }) {
    return (
        <li className="flex items-center gap-2">
            <span aria-hidden="true" className="day-mark" data-mark={mark} />
            {children}
        </li>
    );
}
