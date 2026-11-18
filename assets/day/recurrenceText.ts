import type { DayState } from '../grid/day';
import { LAST_WEEK, reaches, type Recurrence, type Rhythm } from '../grid/recurrence';
import * as Quarter from '../grid/quarter';
import { addDays, dayLabel, isoWeekday } from './calendar';

/**
 * Ce que l'écran dit d'une récurrence : son rythme en toutes lettres — la phrase de la
 * fenêtre, le libellé de la flèche d'un bloc —, ses prochaines fois, et ce qu'on écrit
 * dans « Jusqu'au ». Rien sur le bloc : on lit le rythme dans la fenêtre.
 */

const DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const SHORT_DAYS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
const LETTERS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const SHORT_MONTHS = [
    'janv.',
    'févr.',
    'mars',
    'avr.',
    'mai',
    'juin',
    'juil.',
    'août',
    'sept.',
    'oct.',
    'nov.',
    'déc.',
];
const TIMES = ['', '', 'deux', 'trois', 'quatre'];

/** « lundi », d'un jour ISO. */
export function weekdayWord(weekday: number): string {
    return DAYS[weekday - 1] ?? '';
}

/** La lettre d'un jour sur son bouton, « L ». */
export function weekdayLetter(weekday: number): string {
    return LETTERS[weekday - 1] ?? '';
}

/** « Lundi », le nom d'un bouton de jour pour le lecteur d'écran. */
export function weekdayTitle(weekday: number): string {
    return capitalized(weekdayWord(weekday));
}

/**
 * Le rythme, en minuscules : « chaque mardi », « chaque semaine, du lundi au vendredi »,
 * « chaque semaine, lundi, mercredi et vendredi », « un jeudi sur deux », « le 3e vendredi
 * du mois », « le 31 de chaque mois ».
 */
export function rhythmPhrase(rhythm: Rhythm): string {
    switch (rhythm.kind) {
        case 'weekly': {
            const days = daysPhrase(rhythm.weekdays);
            if (rhythm.everyWeeks > 1) {
                const times = TIMES[rhythm.everyWeeks] ?? String(rhythm.everyWeeks);

                return rhythm.weekdays.length === 1 ? `un ${days} sur ${times}` : `une semaine sur ${times}, ${days}`;
            }

            return rhythm.weekdays.length === 1 ? `chaque ${days}` : `chaque semaine, ${days}`;
        }
        case 'monthly_weekday': {
            const rank =
                rhythm.monthWeek === LAST_WEEK
                    ? 'dernier'
                    : rhythm.monthWeek === 1
                      ? '1er'
                      : `${String(rhythm.monthWeek)}e`;

            return `le ${rank} ${weekdayWord(rhythm.weekdays[0] ?? 1)} du mois`;
        }
        case 'monthly_date':
            return `le ${rhythm.monthDay === 1 ? '1er' : String(rhythm.monthDay)} de chaque mois`;
    }
}

/** Un choix de « Jour du mois » : « Le 3e vendredi du mois », « Le 16 de chaque mois ». */
export function monthChoiceLabel(rhythm: Rhythm): string {
    return capitalized(rhythmPhrase(rhythm));
}

/** Ce que le lecteur d'écran lit de la flèche d'un bloc : « Revient chaque semaine, du lundi au vendredi ». */
export function recurrenceLabel(rhythm: Rhythm): string {
    return `Revient ${rhythmPhrase(rhythm)}`;
}

/**
 * Ce qu'il lit à la suite d'un créneau d'un bloc qui revient, comme la flèche le dit :
 * « 09:15, OPS-12, Daily, revient chaque semaine, du lundi au vendredi ».
 */
export function recurrenceMention(rhythm: Rhythm): string {
    return `revient ${rhythmPhrase(rhythm)}`;
}

/** D'où part une récurrence qu'on crée : la phrase de la fenêtre le dit. */
export type Start = 'today' | 'tomorrow' | { readonly from: string } | null;

/** Ce qu'on crée depuis ce jour part de lui ; depuis un jour passé, de demain. */
export function startOf(date: string, today: string): Start {
    return date === today ? 'today' : date < today ? 'tomorrow' : { from: date };
}

/**
 * La phrase sous les prochaines fois : « Chaque semaine, du lundi au vendredi, de 09:15 à
 * 09:30, à partir d'aujourd'hui. ». Une fin et un départ se disent ensemble : « du mercredi
 * 18 novembre au mercredi 9 décembre », « d'aujourd'hui au mercredi 9 décembre », et un seul
 * jour, « le mardi 6 octobre ». Une date d'une autre année dit son année. Sans nom de
 * ticket : la fenêtre le montre déjà.
 *
 * @param today « AAAA-MM-JJ » : le jour que désignent « aujourd'hui » et « demain »
 */
export function recurrenceSentence(
    rhythm: Rhythm,
    start: number,
    end: number,
    until: string | null,
    from: Start,
    today: string,
): string {
    const named = (date: string) => dayIn(date, today);
    const last = until === null ? null : named(until);
    const first =
        from === null
            ? null
            : from === 'today'
              ? { day: today, alone: "à partir d'aujourd'hui", span: "d'aujourd'hui" }
              : from === 'tomorrow'
                ? { day: addDays(today, 1), alone: 'à partir de demain', span: 'de demain' }
                : {
                      day: from.from,
                      alone: `à partir du ${named(from.from)}`,
                      span: `du ${named(from.from)}`,
                  };
    const span =
        first === null
            ? last === null
                ? []
                : [`jusqu'au ${last}`]
            : // Un seul jour : « le jeudi 1er octobre », pas « du jeudi au même jeudi ».
              [last === null ? first.alone : first.day === until ? `le ${last}` : `${first.span} au ${last}`];
    const parts = [
        capitalized(rhythmPhrase(rhythm)),
        `de\u{a0}${Quarter.format(start)} à\u{a0}${Quarter.format(end)}`,
        ...span,
    ];

    return `${parts.join(', ')}.`;
}

/** Une prochaine fois, sur sa tuile : « 7 oct. », « mer. », et pour le lecteur d'écran « Mercredi 7 octobre ». */
export function timeTile(date: string): { readonly day: string; readonly weekday: string; readonly label: string } {
    const number = Number(date.slice(8, 10));

    return {
        day: `${number === 1 ? '1er' : String(number)}\u{a0}${SHORT_MONTHS[Number(date.slice(5, 7)) - 1] ?? ''}`,
        weekday: SHORT_DAYS[isoWeekday(date) - 1] ?? '',
        label: dayLabel(date),
    };
}

/**
 * Ce que donne le champ date de « Jusqu'au », en jour du calendrier : « AAAA-MM-JJ », null
 * s'il est vide, undefined s'il ne s'y lit pas — une année de plus de quatre chiffres.
 */
export function readDate(value: string): string | null | undefined {
    if (value === '') {
        return null;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return undefined;
    }
    try {
        // addDays lève sur un jour qui n'existe pas au calendrier : le 31 février.
        return addDays(value, 0) === value ? value : undefined;
    } catch {
        return undefined;
    }
}

/** Le refus d'une date commencée sans être complète, que le champ date ne donne pas. */
export const INCOMPLETE_DATE_REFUSAL = 'Complétez la date.';

/**
 * Un jour dans une phrase de la fenêtre, « mardi 6 octobre » ; d'une autre année que celle
 * d'aujourd'hui, avec la sienne, comme le titre de la journée : « mercredi 29 décembre 2027 »
 * ne se lit pas comme un jour dans quatre semaines.
 */
function dayIn(date: string, today: string): string {
    return `${lowered(dayLabel(date))}${date.slice(0, 4) === today.slice(0, 4) ? '' : ` ${date.slice(0, 4)}`}`;
}

/** Le refus d'une fin avant le premier jour qu'elle accepte : le jour du bloc, aujourd'hui ou demain. */
export function untilRefusal(date: string, today: string): string {
    return `Choisissez un jour à partir du ${dayIn(date, today)}.`;
}

export const NO_DAY_REFUSAL = 'Choisissez au moins un jour.';

/**
 * Le nom d'une autre récurrence, dans la fenêtre d'une qui voudrait son créneau : « la
 * récurrence « Rétrospective » » par son commentaire, sinon son ticket ; « la pause ».
 */
function nameOf(recurrence: Recurrence): { readonly quoted: string; readonly plain: string } {
    if (recurrence.content.kind === 'pause') {
        return { quoted: PAUSE_NAME, plain: PAUSE_NAME };
    }
    const name = recurrence.content.comment ?? recurrence.content.ticket;

    // Les guillemets tiennent au nom : jamais seuls en début ou en fin de ligne.
    return { quoted: `«\u{a0}${name}\u{a0}»`, plain: name };
}

/**
 * Le refus d'un créneau déjà pris, sous les prochaines fois : « Un jeudi sur deux, ce
 * créneau est déjà pris par la récurrence « Rétrospective ». », ou « … par la pause. ».
 */
export function takenRefusal(other: Recurrence): string {
    const by = other.content.kind === 'pause' ? PAUSE_NAME : `la récurrence ${nameOf(other).quoted}`;

    return `${capitalized(rhythmPhrase(other.rhythm))}, ce créneau est déjà pris par ${by}.`;
}

/** Le lien qui règle le refus : « Alterner avec « Rétrospective » », « Alterner avec la pause ». */
export function alternateLabel(other: Recurrence): string {
    return `Alterner avec ${nameOf(other).quoted}`;
}

/** « En alternance avec « Rétrospective », qui revient les autres jeudis. » */
export function alternationNote(other: Recurrence, weekdays: readonly number[]): string {
    const days = [...weekdays].sort((a, b) => a - b).map((weekday) => `${weekdayWord(weekday)}s`);
    const listed = days.length <= 1 ? (days[0] ?? '') : `${days.slice(0, -1).join(', ')} et ${days.at(-1) ?? ''}`;

    return `En alternance avec ${nameOf(other).quoted}, qui revient les autres ${listed}.`;
}

/**
 * Ce que la fenêtre dit d'une date du mois sous les prochaines fois : « Les mois sans 31, et
 * ceux où il tombe un jour non travaillé, n'en ont pas. », « Les mois où le 16 tombe un jour
 * non travaillé n'en ont pas. » ; rien quand chaque jour est travaillé, ni pour un autre rythme.
 */
export function monthNote(rhythm: Rhythm, workingDays: readonly number[]): string | null {
    if (rhythm.kind !== 'monthly_date' || rhythm.monthDay === null) {
        return null;
    }
    const date = rhythm.monthDay === 1 ? '1er' : String(rhythm.monthDay);
    const offDays = workingDays.length < 7;
    if (rhythm.monthDay > 28) {
        return offDays
            ? `Les mois sans ${date}, et ceux où il tombe un jour non travaillé, n'en ont pas.`
            : `Les mois sans ${date} n'en ont pas.`;
    }

    return offDays ? `Les mois où le ${date} tombe un jour non travaillé n'en ont pas.` : null;
}

/**
 * Une tuile des prochaines fois, pour le lecteur d'écran : « Mardi 27 octobre, rien ce
 * jour-là » pour une semaine sans, « Jeudi 29 octobre, déjà pris par Rétrospective » pour
 * une fois qu'une autre récurrence prend déjà.
 */
export function timeLabel(date: string, falls: boolean, takenBy: Recurrence | null): string {
    const label = dayLabel(date);
    if (!falls) {
        return `${label}, rien ce jour-là`;
    }

    return takenBy === null ? label : `${label}, déjà pris par ${nameOf(takenBy).plain}`;
}

/** « du lundi au vendredi » pour trois jours ou plus qui se suivent, « lundi, mercredi et vendredi » sinon. */
function daysPhrase(weekdays: readonly number[]): string {
    const days = [...weekdays].sort((a, b) => a - b);
    const first = days[0];
    const last = days.at(-1);
    if (first !== undefined && last !== undefined && days.length >= 3 && last - first === days.length - 1) {
        return `du ${weekdayWord(first)} au ${weekdayWord(last)}`;
    }
    const words = days.map(weekdayWord);

    return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} et ${words.at(-1) ?? ''}`;
}

function capitalized(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function lowered(text: string): string {
    return text.charAt(0).toLowerCase() + text.slice(1);
}

/** Une pause n'a pas de commentaire : elle se nomme ainsi. */
const PAUSE_NAME = 'la pause';

/**
 * Ce que la fenêtre Objectif du jour annonce quand on met le jour à 0h00 : les blocs que
 * ses récurrences y ont posés, ou y prévoient un jour à venir — ceux qui portent leur
 * flèche —, seront retirés, et ses autres saisies restent (src/Day/DayWriter.php,
 * holdOccurrences). Chaque bloc se nomme par son commentaire, sinon par son ticket ; une
 * pause, qui n'a pas de commentaire, « la pause ». Null quand aucune récurrence n'y a rien.
 *
 * « Daily, Déjeuner et Poker planning, posés par vos récurrences, seront retirés. Vos
 * autres tickets restent. »
 */
export function withdrawalNote(day: DayState): string | null {
    const names: string[] = [];
    let others = false;
    for (const block of day.grid.blocks()) {
        const id = block.content.recurrence;
        const recurrence = id === null ? undefined : day.recurrences.get(id);
        if (recurrence === undefined || !reaches(recurrence, day.date)) {
            others = true;
            continue;
        }
        const name = block.content.kind === 'pause' ? PAUSE_NAME : (block.content.comment ?? block.content.ticket);
        if (!names.includes(name)) {
            names.push(name);
        }
    }
    const [first, ...rest] = names;
    if (first === undefined) {
        return null;
    }
    const removed =
        rest.length === 0
            ? first === PAUSE_NAME
                ? `${first}, posée par une récurrence, sera retirée.`
                : `${first}, posé par une récurrence, sera retiré.`
            : `${[first, ...rest.slice(0, -1)].join(', ')} et ${rest.at(-1) ?? ''}, posés par vos récurrences, seront retirés.`;

    return `${removed.charAt(0).toUpperCase()}${removed.slice(1)}${others ? ' Vos autres tickets restent.' : ''}`;
}
