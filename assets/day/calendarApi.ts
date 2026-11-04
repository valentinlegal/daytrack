import { readWeekdays } from '../grid/day';
import { isRecord } from '../grid/json';
import { isDate } from './calendar';

/**
 * La marque d'un jour dans le calendrier (src/Day/DayMark.php) : le serveur la calcule,
 * et c'est la seule définition d'« incomplet ». Les autres disent où en est son envoi
 * sur Jira, comme son bouton.
 */
export type DayMark = 'incomplete' | 'unsent' | 'sent' | 'modified';

const MARKS: readonly string[] = ['incomplete', 'unsent', 'sent', 'modified'] satisfies DayMark[];

/**
 * Ce que le calendrier lit d'un coup : les marques, les jours mis à 0h00, et les jours
 * travaillés qui ont décidé des marques.
 */
export interface CalendarMonth {
    /** Les jours marqués ; un jour absent n'a pas de marque. */
    readonly marks: ReadonlyMap<string, DayMark>;
    /** Les jours dont l'objectif du jour est à 0h00, saisis ou non : grisés comme un samedi. */
    readonly daysOff: ReadonlySet<string>;
    /** En jours de la semaine ISO, de 1 pour lundi à 7 pour dimanche. */
    readonly workingDays: readonly number[];
}

/** Les marques du calendrier (src/Controller/Api/CalendarController.php), lues sans rien écrire. */
export interface CalendarApi {
    /** Les marques de `from` à `to` compris. */
    marks(from: string, to: string): Promise<CalendarMonth>;
}

export function httpCalendarApi(fetcher: typeof fetch = (input, init) => fetch(input, init)): CalendarApi {
    return {
        async marks(from, to) {
            const response = await fetcher(`/api/calendar/${encodeURIComponent(from)}/${encodeURIComponent(to)}`, {
                headers: { Accept: 'application/json' },
            });
            if (response.status !== 200) {
                throw new Error(`L'API a répondu ${String(response.status)} pour le calendrier.`);
            }

            return readMonth(await response.json());
        },
    };
}

/** Une réponse qui n'en a pas la forme lève : le calendrier reste sans marque plutôt que de travers. */
export function readMonth(json: unknown): CalendarMonth {
    if (!isRecord(json) || !isRecord(json.marks)) {
        throw new TypeError("L'API n'a pas rendu les marques du calendrier.");
    }

    return {
        marks: readMarks(json.marks),
        daysOff: readDates(json.daysOff),
        workingDays: readWeekdays(json.workingDays),
    };
}

function readDates(json: unknown): Set<string> {
    if (!Array.isArray(json)) {
        throw new TypeError("L'API n'a pas rendu les jours mis à 0h00.");
    }

    return new Set(
        json.map((date: unknown) => {
            if (typeof date !== 'string' || !isDate(date)) {
                throw new TypeError("L'API n'a pas rendu les jours mis à 0h00.");
            }

            return date;
        }),
    );
}

function readMarks(json: Record<string, unknown>): Map<string, DayMark> {
    return new Map(
        Object.entries(json).map(([date, mark]) => {
            if (!isDate(date) || typeof mark !== 'string' || !MARKS.includes(mark)) {
                throw new TypeError(`« ${date} » n'a pas de marque lisible.`);
            }

            return [date, mark as DayMark];
        }),
    );
}
