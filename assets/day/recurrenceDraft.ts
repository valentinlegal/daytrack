import { fill, type QuarterChanges } from '../grid/changes';
import { copyQuarters, cutRecurrence } from '../grid/clipboard';
import type { DayState } from '../grid/day';
import {
    deleteEntry,
    type EntryAction,
    type EntryDraft,
    type EntryTarget,
    quartersOf,
    type RecurrenceAction,
    saveDisabled,
    type ScopeQuestion,
    targetAt,
    type WriteAction,
} from '../grid/entry';
import { normalizeComment, sameContent, type SlotContent, unlinked } from '../grid/grid';
import * as Quarter from '../grid/quarter';
import {
    earliestClash,
    fallsOn,
    LAST_WEEK,
    lastTime,
    monthlyChoices,
    occurrenceIn,
    reaches,
    type Recurrence,
    type RecurrenceRule,
    ruleOf,
    type Rhythm,
    sameRhythm,
    type Schedule,
    type SeenRecurrence,
    seenOf,
    takesOn,
    type TimedSchedule,
    weekly,
} from '../grid/recurrence';
import { addDays, isoWeekday } from './calendar';
import {
    INCOMPLETE_DATE_REFUSAL,
    NO_DAY_REFUSAL,
    readDate,
    type Start,
    startOf,
    takenRefusal,
    untilRefusal,
} from './recurrenceText';

/**
 * La case « Récurrence » d'une fenêtre de ticket ou de pause, et ce qu'elle fait de son
 * enregistrement : créer la récurrence du bloc, la changer, ou l'arrêter. Sur un bloc qui
 * revient, aujourd'hui ou un jour à venir, changer son ticket ou son commentaire, décocher la
 * case ou l'effacer en entier — la corbeille, le ticket vidé, Suppr et « Effacer » du menu —
 * demandent quelles fois le geste change : cette fois seulement, ou cette fois et les
 * suivantes. Changer ses jours ou sa fin vaut pour la série, sans question ; convertir en
 * pause, remplacer, coller ou glisser par-dessus ne changent que cette fois, comme tout geste
 * d'un jour passé.
 */

/** Les trois cartes du rythme : chaque semaine, une semaine sur n, chaque mois. */
export type Pace = 'week' | 'every' | 'month';

/**
 * Le choix de « Jour du mois », relatif au jour du bloc : son rang dans le mois (le 3e
 * vendredi), sa date (le 16), ou « le dernier » vendredi.
 */
export type MonthChoice = 'rank' | 'date' | 'last';

/** Ce que la case et ce qu'elle déplie montrent, tel qu'on l'a réglé. */
export interface RecurrenceDraft {
    readonly on: boolean;
    readonly pace: Pace;
    /**
     * En jours de la semaine ISO, dans l'ordre. Gardés quand on passe à « Chaque mois », qui
     * ne les montre pas : revenir à la semaine les retrouve.
     */
    readonly weekdays: readonly number[];
    /** Une semaine sur 2, 3 ou 4 ; gardé de même quand on change de carte. */
    readonly everyWeeks: number;
    readonly month: MonthChoice;
    /** « Jusqu'au », tel que le champ date le donne : « AAAA-MM-JJ », ou vide. */
    readonly until: string;
    /** « Jusqu'au » commencé sans être complet : le champ n'en donne pas encore la valeur. */
    readonly incomplete?: boolean;
    /**
     * La récurrence du bloc qui revient, telle que la case l'a montrée avant qu'on la règle :
     * ce qu'on règle la remplace, et le serveur refuse si elle a changé ailleurs depuis.
     */
    readonly seen?: SeenRecurrence;
    /** Son rythme, tel que la case l'a montré avec `seen` : ce qu'on n'a pas retouché le suit après un refus. */
    readonly seenRhythm?: Rhythm;
    /**
     * « Jusqu'au », tel que la case l'a montré avec `seen` : sa dernière fois (shownUntil), ou vide.
     * Laissé tel quel, il suit la récurrence relue après un refus.
     */
    readonly seenUntil?: string;
}

/**
 * Le rythme que la case règle. Celui du mois se lit sur le jour du bloc : seuls ceux qu'il
 * permet se proposent (monthChoices), et un choix qu'il ne permet plus prend le premier.
 */
export function draftRhythm(draft: RecurrenceDraft, date: string, workingDays: readonly number[]): Rhythm {
    switch (draft.pace) {
        case 'week':
            return weekly(draft.weekdays);
        case 'every':
            return weekly(draft.weekdays, draft.everyWeeks);
        case 'month': {
            const choices = monthChoices(draft, date, workingDays);
            const chosen = choices.find((rhythm) => monthChoiceOf(rhythm) === draft.month) ?? choices[0];

            return chosen ?? weekly(draft.weekdays);
        }
    }
}

/**
 * Les choix de « Jour du mois » que la case propose : ceux que permet le jour du bloc, et le
 * rythme de la récurrence du bloc, gardé même si son jour n'est plus travaillé.
 */
export function monthChoices(draft: RecurrenceDraft, date: string, workingDays: readonly number[]): Rhythm[] {
    return monthlyChoices(date, workingDays, draft.seenRhythm ?? null);
}

/** Ce que la case montre d'un rythme : sa carte, ses jours, son « une semaine sur », son jour du mois. */
function drafted(
    rhythm: Rhythm,
    date: string,
    workingDays: readonly number[],
): Pick<RecurrenceDraft, 'pace' | 'weekdays' | 'everyWeeks' | 'month'> {
    if (rhythm.kind === 'weekly') {
        return {
            pace: rhythm.everyWeeks > 1 ? 'every' : 'week',
            weekdays: rhythm.weekdays,
            everyWeeks: rhythm.everyWeeks > 1 ? rhythm.everyWeeks : 2,
            month: firstMonthChoice(date, workingDays),
        };
    }
    const weekday = isoWeekday(date);

    return {
        pace: 'month',
        weekdays: workingDays.includes(weekday) ? [weekday] : [],
        everyWeeks: 2,
        month: monthChoiceOf(rhythm),
    };
}

/** Le choix de « Jour du mois » qu'est ce rythme mensuel. */
export function monthChoiceOf(rhythm: Rhythm): MonthChoice {
    return rhythm.kind === 'monthly_date' ? 'date' : rhythm.monthWeek === LAST_WEEK ? 'last' : 'rank';
}

/** Le premier jour du mois que le jour du bloc propose, coché d'avance. */
function firstMonthChoice(date: string, workingDays: readonly number[]): MonthChoice {
    const first = monthlyChoices(date, workingDays)[0];

    return first === undefined ? 'date' : monthChoiceOf(first);
}

/**
 * La récurrence que porte le bloc d'une fenêtre, s'il en porte une qui va encore jusqu'à ce
 * jour : finie avant lui — annulée depuis un autre jour —, elle ne s'y change plus.
 */
export function linkedRecurrence(target: EntryTarget, day: DayState): Recurrence | null {
    const id = linkedId(target);
    const recurrence = id === null ? undefined : day.recurrences.get(id);

    return recurrence === undefined || !reaches(recurrence, day.date) ? null : recurrence;
}

function linkedId(target: EntryTarget): string | null {
    return target.kind === 'edit' ? target.block.content.recurrence : null;
}

/**
 * La case, à l'ouverture : celle du bloc qui revient, cochée, à son rythme — d'un jour passé
 * aussi, où elle change à partir de demain ; décochée ailleurs, le jour du bloc choisi s'il
 * est travaillé. Null quand la fenêtre n'en a pas : Modifier la sélection, une sélection en
 * plusieurs morceaux — une récurrence couvre une seule plage.
 */
export function initialRecurrence(target: EntryTarget, day: DayState): RecurrenceDraft | null {
    if (target.kind === 'part') {
        return null;
    }
    const quarters = quartersOf(target);
    const first = quarters[0];
    const last = quarters.at(-1);
    if (first === undefined || last === undefined || last - first !== (quarters.length - 1) * Quarter.MINUTES) {
        return null;
    }
    const linked = linkedRecurrence(target, day);
    if (linked !== null) {
        return {
            on: true,
            ...drafted(linked.rhythm, day.date, day.workingDays),
            until: shownUntil(linked, day.workingDays, day.date) ?? '',
            seen: seenOf(linked),
            seenRhythm: linked.rhythm,
            seenUntil: shownUntil(linked, day.workingDays, day.date) ?? '',
        };
    }
    const weekday = isoWeekday(day.date);

    return {
        on: false,
        pace: 'week',
        weekdays: day.workingDays.includes(weekday) ? [weekday] : [],
        everyWeeks: 2,
        month: firstMonthChoice(day.date, day.workingDays),
        until: '',
    };
}

/**
 * La fin que « Jusqu'au » montre d'une récurrence, dans la fenêtre d'un de ses blocs, ce jour-là :
 * sa dernière fois, un jour où elle se pose (lastTime), jamais la veille d'une coupe faite par
 * « Cette fois et les suivantes ». Jamais avant le jour du bloc, qui en est une, même décoché
 * des réglages depuis.
 */
export function shownUntil(recurrence: Recurrence, workingDays: readonly number[], date: string): string | null {
    const last = lastTime(recurrence, workingDays);

    return last !== null && last < date && recurrence.until !== null && date <= recurrence.until ? date : last;
}

/**
 * La fin qu'enregistrer envoie : celle qu'on a tapée. Laissée telle que « Jusqu'au » la montrait,
 * à son rythme — maintenant, ou quand la case a vu la récurrence (`seenUntil`), les jours
 * travaillés ayant pu changer depuis —, c'est la fin enregistrée de la récurrence du bloc : elles
 * ont les mêmes fois, et le serveur n'y voit rien de changé. Un autre rythme finit là où la
 * fenêtre l'a montré.
 */
export function sentUntil(
    rule: RecurrenceRule,
    linked: Recurrence | null,
    workingDays: readonly number[],
    date: string,
    seenUntil?: string,
): RecurrenceRule {
    const shown = linked === null ? null : shownUntil(linked, workingDays, date);

    return linked !== null &&
        sameRhythm(rule, linked.rhythm) &&
        (rule.until === shown || (seenUntil !== undefined && rule.until === readDate(seenUntil)))
        ? { ...rule, until: linked.until }
        : rule;
}

/**
 * Le premier jour que « Jusqu'au » accepte, comme le serveur le jugera. Une récurrence qu'on
 * crée ou qu'on change finit au plus tôt le jour du bloc. Depuis un jour passé, celle d'un
 * bloc qui revient change à partir de demain : sa fin seule changée va jusqu'à aujourd'hui
 * au moins, où elle s'est déjà posée, et un rythme changé part de demain. Rien de changé,
 * rien à juger : sa fin d'avant reste la sienne.
 */
export function untilMinimum(
    draft: RecurrenceDraft,
    linked: Recurrence | null,
    date: string,
    today: string,
    workingDays: readonly number[],
): string {
    if (linked === null || date >= today) {
        return date;
    }
    const same = sameRhythm(draftRhythm(draft, date, workingDays), linked.rhythm);
    if (same && (readDate(draft.until) === shownUntil(linked, workingDays, date) || draft.until === draft.seenUntil)) {
        return date;
    }

    return same ? today : addDays(today, 1);
}

/**
 * D'où part ce que la fenêtre enregistre, pour sa phrase : une récurrence qu'on crée part
 * de ce jour, ou de demain depuis un jour passé ; le rythme changé d'un bloc qui revient
 * d'un jour passé, de demain. Celle qui revient déjà ne le dit pas.
 */
export function recurrenceStart(
    draft: RecurrenceDraft,
    linked: Recurrence | null,
    date: string,
    today: string,
    workingDays: readonly number[],
): Start {
    if (linked === null) {
        // Créée d'un jour passé pour finir avant demain, elle ne part de nulle part.
        const until = readDate(draft.until);
        return date < today && typeof until === 'string' && until <= today ? null : startOf(date, today);
    }

    return date < today && !sameRhythm(draftRhythm(draft, date, workingDays), linked.rhythm) ? 'tomorrow' : null;
}

/**
 * Le premier jour de ce qu'on enregistre, comme le serveur le posera : une récurrence qu'on
 * crée part du jour du bloc ; changée d'un jour passé, de demain ; changée dans son rythme,
 * de ce jour ; sa fin seule changée, elle garde le sien. C'est de lui que « une semaine sur
 * n » compte ses semaines.
 */
export function recurrenceFirstDay(
    draft: RecurrenceDraft,
    linked: Recurrence | null,
    date: string,
    today: string,
    workingDays: readonly number[],
): string {
    if (linked === null) {
        return date;
    }
    if (sameRhythm(draftRhythm(draft, date, workingDays), linked.rhythm)) {
        return linked.firstDay;
    }

    return date < today ? addDays(today, 1) : date;
}

/**
 * Les fois sautées de ce qu'on enregistre : celles de la récurrence du bloc tant que son
 * rythme ne change pas — sa fin seule changée, elle reste la même ; un autre ticket ou
 * commentaire la coupe, et la nouvelle les reprend (src/Day/DayWriter.php) —, aucune sinon : un
 * rythme changé en fait naître une autre, que rien n'a sautée.
 */
export function draftSkipped(rhythm: Rhythm, linked: Recurrence | null): readonly string[] {
    return linked !== null && sameRhythm(rhythm, linked.rhythm) ? (linked.skipped ?? []) : [];
}

/**
 * Ce qu'une fenêtre sait de sa journée pour juger un créneau : son jour, ses jours travaillés, les
 * récurrences lues, et les jours à venir déjà envoyés, où aucune ne prend plus de créneau.
 */
export type SeenDay = Pick<DayState, 'date' | 'workingDays' | 'ongoing' | 'settledAhead'>;

/** Ce qui prend déjà le créneau qu'on règle, et ce que la fenêtre propose pour le libérer. */
export interface DraftClash {
    /** La première autre récurrence à le prendre (earliestClash), que le refus nomme. */
    readonly recurrence: Recurrence;
    /**
     * Toutes celles qui le prennent, pour marquer « Pris » chaque prochaine fois concernée :
     * la première qui y tombe, par jour.
     */
    readonly takenOn: (date: string) => Recurrence | null;
    /**
     * « Alterner » : la même chose une semaine sur n, n celui de l'autre, comptée depuis la
     * semaine du bloc ; null si ce n'est pas proposé : face à une autre de chaque semaine,
     * au mois, ou si l'alternance tomberait sur une troisième.
     */
    readonly alternate: RecurrenceDraft | null;
}

/**
 * Le créneau que la case règle est-il déjà pris par une autre récurrence ? Jugé comme le
 * serveur le jugera, sur celles que la journée a lues (DayState.ongoing) : ce qu'on crée, ce
 * qu'on change dans son rythme, ou une fin repoussée — une fin avancée ne prend rien de plus.
 * Null quand rien n'est à juger ou que le créneau est libre.
 */
/**
 * La fin que la fenêtre lit — sa phrase, ses prochaines fois, le créneau pris, l'alternance :
 * la date de « Jusqu'au » telle qu'elle est tapée, même avant le premier jour accepté ; vide,
 * commencée ou illisible, aucune, comme une récurrence sans fin. Enregistrer refuse sous le
 * champ une date commencée, illisible ou trop tôt (readRule) : la fenêtre ne juge jamais une
 * date autrement qu'elle la montre.
 */
export function draftUntil(draft: RecurrenceDraft): string | null {
    return draft.incomplete === true ? null : (readDate(draft.until) ?? null);
}

/**
 * « Jusqu'au » commencé ou illisible : lu sans fin, il peut tomber sur le créneau d'une autre,
 * mais c'est « Complétez la date. » qu'Enregistrer dit d'abord — la fenêtre ne se grise pas.
 */
export function untilUnfinished(draft: RecurrenceDraft): boolean {
    return draft.incomplete === true || readDate(draft.until) === undefined;
}

export function draftClash(
    draft: RecurrenceDraft,
    linked: Recurrence | null,
    day: SeenDay,
    today: string,
    start: number,
    end: number,
): DraftClash | null {
    const until = draftUntil(draft);
    if (!draft.on || noDayChosen(draft, day.workingDays)) {
        return null;
    }
    const rhythm = draftRhythm(draft, day.date, day.workingDays);
    if (
        linked !== null &&
        sameRhythm(rhythm, linked.rhythm) &&
        (linked.until === null || (until !== null && until <= linked.until))
    ) {
        return null;
    }
    const others = [...day.ongoing.values()].filter((other) => other.id !== linked?.id);
    const timed = (drafted: RecurrenceDraft): TimedSchedule => {
        const its = draftRhythm(drafted, day.date, day.workingDays);

        return {
            rhythm: its,
            firstDay: recurrenceFirstDay(drafted, linked, day.date, today, day.workingDays),
            until,
            start,
            end,
            skipped: draftSkipped(its, linked),
        };
    };
    // Après aujourd'hui, comme le serveur : un jour déjà venu ne reçoit plus rien d'aucune, ni un
    // jour à venir déjà envoyé. Une fois détachée ou effacée, de part ou d'autre, ne prend pas le
    // créneau.
    const clash = earliestClash(timed(draft), others, today, day.settledAhead);
    if (clash === null) {
        return null;
    }
    const taking = others.filter((other) => other.start < end && start < other.end);
    const other = clash.recurrence.rhythm;
    const alternate: RecurrenceDraft | null =
        rhythm.kind === 'weekly' && other.kind === 'weekly' && other.everyWeeks > 1
            ? { ...draft, pace: 'every', everyWeeks: other.everyWeeks }
            : null;
    // L'alternance compte ses semaines depuis son propre premier jour : une fin repoussée qui
    // devient une semaine sur n en fait naître une autre, à partir de ce jour.
    const free = alternate !== null && earliestClash(timed(alternate), others, today, day.settledAhead) === null;

    return {
        recurrence: clash.recurrence,
        takenOn: (date) =>
            day.settledAhead.has(date) ? null : (taking.find((recurrence) => takesOn(recurrence, date)) ?? null),
        alternate: free ? alternate : null,
    };
}

/**
 * Une autre récurrence qui revient au même créneau les autres semaines : la fenêtre le dit,
 * « En alternance avec « Rétrospective », qui revient les autres jeudis. ». Seulement pour une
 * semaine sur n, face à une autre du même n qui partage un de ses jours, sans conflit, et
 * qui revient vraiment en alternance : une de ses fois après aujourd'hui, dans la période de
 * celle qu'on règle, une semaine où celle-ci ne tombe pas.
 */
export function alternatingWith(
    draft: RecurrenceDraft,
    linked: Recurrence | null,
    day: SeenDay,
    today: string,
    start: number,
    end: number,
): { readonly recurrence: Recurrence; readonly weekdays: readonly number[] } | null {
    const rhythm = draftRhythm(draft, day.date, day.workingDays);
    const until = draftUntil(draft);
    if (!draft.on || rhythm.kind !== 'weekly' || rhythm.everyWeeks === 1) {
        return null;
    }
    const own: Schedule = {
        rhythm,
        firstDay: recurrenceFirstDay(draft, linked, day.date, today, day.workingDays),
        until,
        skipped: draftSkipped(rhythm, linked),
    };
    for (const other of day.ongoing.values()) {
        const shared = rhythm.weekdays.filter((weekday) => other.rhythm.weekdays.includes(weekday));
        if (
            other.id !== linked?.id &&
            other.rhythm.kind === 'weekly' &&
            other.rhythm.everyWeeks === rhythm.everyWeeks &&
            other.start < end &&
            start < other.end &&
            shared.length > 0 &&
            alternates(own, other, shared, today, day.settledAhead)
        ) {
            return { recurrence: other, weekdays: shared };
        }
    }

    return null;
}

/**
 * L'autre se pose, après aujourd'hui et dans la période de la sienne, un de leurs jours
 * communs d'une semaine où la sienne ne tombe pas — ni sur un jour à venir déjà envoyé, où rien
 * ne se pose plus. Du même « une semaine sur n », leurs semaines se répètent ensemble en n
 * semaines : n + 1 suffisent, comptées après la dernière fois sautée de l'autre.
 */
function alternates(
    own: Schedule,
    other: Recurrence,
    shared: readonly number[],
    today: string,
    closed: ReadonlySet<string>,
): boolean {
    const from = [addDays(today, 1), own.firstDay, other.firstDay].reduce((last, date) => (date > last ? date : last));
    const skipped = [...(other.skipped ?? []), ...closed].filter((date) => date >= from).sort();
    const base = skipped.at(-1) ?? from;
    const limit = addDays(base, 7 * (other.rhythm.everyWeeks + 1));
    for (let date = from; date <= limit && (own.until === null || date <= own.until); date = addDays(date, 1)) {
        if (shared.includes(isoWeekday(date)) && takesOn(other, date) && !closed.has(date) && !fallsOn(own, date)) {
            return true;
        }
    }

    return false;
}

/**
 * Ce que la case règle, lu et jugé comme le serveur le jugera : la règle à envoyer, ou les
 * refus à dire sous « Jours » et « Jusqu'au ». `minimum` vient d'untilMinimum. Un jour que
 * les réglages ne travaillent plus part avec la règle tant qu'on n'a pas touché aux jours,
 * mais ne suffit pas à en faire une (noDayChosen).
 */
export function readRule(
    draft: RecurrenceDraft,
    minimum: string,
    date: string,
    workingDays: readonly number[],
    today: string,
): { readonly rule: RecurrenceRule } | { readonly weekdays: string | null; readonly until: string | null } {
    const until = draft.incomplete === true ? undefined : readDate(draft.until);
    const weekdays = noDayChosen(draft, workingDays) ? NO_DAY_REFUSAL : null;
    const untilError =
        until === undefined
            ? INCOMPLETE_DATE_REFUSAL
            : until !== null && until < minimum
              ? untilRefusal(minimum, today)
              : null;
    if (weekdays !== null || untilError !== null || until === undefined) {
        return { weekdays, until: untilError };
    }

    return { rule: { ...draftRhythm(draft, date, workingDays), until } };
}

/**
 * Aucun jour choisi, la case cochée : « Enregistrer » est grisé, comme pour une pause sans
 * ticket. Seuls comptent les jours que la case montre, ceux que les réglages travaillent.
 */
export function noDayChosen(draft: RecurrenceDraft | null, workingDays: readonly number[]): boolean {
    return (
        draft !== null &&
        draft.on &&
        draft.pace !== 'month' &&
        !draft.weekdays.some((chosen) => workingDays.includes(chosen))
    );
}

/**
 * Un jour pressé ou relâché dans la case. Un jour que la récurrence avait et que les réglages
 * ne travaillent plus n'y est pas montré : il ne reste que tant qu'on ne touche pas aux jours,
 * et sort au premier pressé ou relâché, sans quoi on ne pourrait plus le retirer.
 */
export function toggleDay(draft: RecurrenceDraft, day: number, workingDays: readonly number[]): RecurrenceDraft {
    const shown = draft.weekdays.filter((chosen) => workingDays.includes(chosen));

    return {
        ...draft,
        weekdays: shown.includes(day)
            ? shown.filter((chosen) => chosen !== day)
            : [...shown, day].sort((a, b) => a - b),
    };
}

/**
 * « Enregistrer » grisé, et Entrée sans effet : une récurrence sans jour, et une pause sans
 * ticket — sauf pour régler sa seule case. Un commentaire tapé sur une pause sans ticket la
 * grise, case cochée ou non : une pause n'en porte pas.
 */
export function saveBlocked(
    target: EntryTarget,
    draft: EntryDraft,
    recurrence: RecurrenceDraft | null,
    initial: RecurrenceDraft | null,
    date: string,
    workingDays: readonly number[],
): boolean {
    if (noDayChosen(recurrence, workingDays)) {
        return true;
    }

    return (
        saveDisabled(target, draft) &&
        (normalizeComment(draft.comment) !== null || !recurrenceChanged(recurrence, initial, date, workingDays))
    );
}

/**
 * La case telle qu'on l'a réglée, revue sur la journée à jour après un refus : la fenêtre a
 * dit que la journée avait changé, et le prochain enregistrement remplace la récurrence
 * telle qu'elle est désormais. Ce qu'on n'a pas touché — la fin, les jours, encore tels que
 * la case les avait vus — prend la valeur posée ailleurs, sans quoi l'enregistrement
 * suivant l'écraserait ; ce qu'on a réglé soi-même reste.
 */
export function seenAgain(
    draft: RecurrenceDraft | undefined,
    target: EntryTarget,
    day: DayState,
): RecurrenceDraft | undefined {
    const linked = linkedRecurrence(target, day);
    if (draft === undefined || linked === null) {
        return draft;
    }
    const seen = seenOf(linked);
    const before = draft.seen;
    const shown = shownUntil(linked, day.workingDays, day.date) ?? '';
    if (before === undefined) {
        return { ...draft, seen, seenUntil: shown };
    }
    // Une date commencée est une fin qu'on règle : elle reste. Sinon, « Jusqu'au » est touché
    // s'il n'est plus ce que la case montrait — la dernière fois de la récurrence d'alors, même
    // si le bloc en porte désormais une autre.
    const untilTouched = draft.incomplete === true || draft.until !== (draft.seenUntil ?? before.until ?? '');
    const rhythmTouched =
        draft.seenRhythm === undefined || !sameRhythm(draftRhythm(draft, day.date, day.workingDays), draft.seenRhythm);

    return {
        ...draft,
        ...(rhythmTouched ? {} : drafted(linked.rhythm, day.date, day.workingDays)),
        until: untilTouched ? draft.until : shown,
        seen,
        seenRhythm: linked.rhythm,
        seenUntil: shown,
    };
}

/** La case a changé depuis l'ouverture : la fenêtre a quelque chose à enregistrer. */
export function recurrenceChanged(
    draft: RecurrenceDraft | null,
    initial: RecurrenceDraft | null,
    date: string,
    workingDays: readonly number[],
): boolean {
    return (
        draft !== null &&
        initial !== null &&
        (draft.on !== initial.on ||
            (draft.on &&
                (draft.incomplete === true ||
                    // « Jusqu'au » laissé tel que la case l'a montré n'est pas une fin réglée, même
                    // si les jours travaillés ont changé depuis.
                    (readDate(draft.until) !== readDate(initial.until) && draft.until !== draft.seenUntil) ||
                    !sameRhythm(draftRhythm(draft, date, workingDays), draftRhythm(initial, date, workingDays)))))
    );
}

/**
 * Ce que fait l'enregistrement de la fenêtre, la case comprise. `base` est ce qu'il ferait
 * sans elle (saveEntry, pauseEntry).
 *
 * - Sans récurrence, la case décochée : `base`, tel quel.
 * - La case cochée sur un bloc qui n'en a pas : le bloc écrit, et sa récurrence créée.
 * - Sur un bloc qui revient : rien de changé, rien ne part. Changer son ticket ou son
 *   commentaire, décocher la case, vider son ticket demandent quelles fois le geste change :
 *   l'action `ask`, qui porte les deux réponses ; vider son ticket, comme la corbeille
 *   (eraseAction). Changer ses jours ou sa fin change la récurrence à partir de cette fois,
 *   sans question : « cette fois seulement » n'y a pas de sens.
 * - D'un jour passé, jamais de question : les fois passées ne changent jamais, et la
 *   récurrence change à partir de demain (src/Day/DayWriter.php, changePast).
 */
export function recurrenceAction(
    base: EntryAction,
    target: EntryTarget,
    draft: RecurrenceDraft | null,
    initial: RecurrenceDraft | null,
    day: DayState,
    today: string,
): EntryAction {
    // Rien de tapé sur un bloc qui revient, la case comme à l'ouverture : rien ne part, et il
    // garde sa récurrence.
    const block = target.kind === 'edit' ? target.block.content : null;
    if (
        block !== null &&
        block.recurrence !== null &&
        base.kind === 'write' &&
        [...base.changes.values()].every((cell) => cell !== null && sameContent(cell, block)) &&
        !recurrenceChanged(draft, initial, day.date, day.workingDays)
    ) {
        return { kind: 'close' };
    }
    const linked = linkedRecurrence(target, day);
    if (
        draft === null ||
        (!draft.on && linked === null) ||
        base.kind === 'refuse' ||
        base.kind === 'recurrence' ||
        base.kind === 'ask'
    ) {
        return base;
    }
    // La corbeille, ou un ticket vidé : effacer.
    if (base.kind === 'write' && [...base.changes.values()].some((cell) => cell === null)) {
        return eraseAction(target, day, today, base);
    }
    const past = day.date < today;
    const read = draft.on
        ? readRule(
              draft,
              untilMinimum(draft, linked, day.date, today, day.workingDays),
              day.date,
              day.workingDays,
              today,
          )
        : null;
    if (read !== null && !('rule' in read)) {
        return { kind: 'refuse', weekdays: read.weekdays, until: read.until, rhythm: null };
    }
    // Un créneau qu'une autre récurrence prend déjà : la fenêtre le dit déjà sous les prochaines
    // fois, et Enregistrer ne part pas.
    const quarters = quartersOf(target);
    const clash = draftClash(
        draft,
        linked,
        day,
        today,
        linked?.start ?? quarters[0] ?? Quarter.FIRST,
        linked?.end ?? (quarters.at(-1) ?? Quarter.FIRST) + Quarter.MINUTES,
    );
    if (clash !== null) {
        return { kind: 'refuse', weekdays: null, until: null, rhythm: takenRefusal(clash.recurrence) };
    }
    // Laissée telle que la case la montrait, la fin reste celle de la récurrence.
    const rule = read === null ? null : sentUntil(read.rule, linked, day.workingDays, day.date, draft.seenUntil);
    if (linked === null) {
        // Un bloc qui ne change pas, la case cochée — une pause, qui n'a rien à taper — : sa
        // récurrence naît telle quelle.
        const born: WriteAction | null =
            base.kind === 'write'
                ? base
                : target.kind === 'edit'
                  ? { kind: 'write', changes: fill(quartersOf(target), unlinked(target.block.content)), gesture: null }
                  : null;
        if (born === null) {
            return base;
        }
        // Au bord d'un bloc qui revient, la même récurrence l'allonge, au lieu d'en créer une
        // seconde collée à la première : même contenu, même rythme, même fin.
        const extended = rule === null ? null : extension(day, born.changes, today);
        if (
            extended !== null &&
            rule !== null &&
            sameRhythm(rule, extended.linked.rhythm) &&
            (rule.until === extended.linked.until ||
                rule.until === shownUntil(extended.linked, day.workingDays, day.date))
        ) {
            return extending(extended, born, sentUntil(rule, extended.linked, day.workingDays, day.date));
        }

        return { kind: 'recurrence', changes: born.changes, rule, replaces: null, gesture: born.gesture };
    }
    const content = target.kind === 'edit' ? target.block.content : null;
    const written = base.kind === 'write' ? (base.changes.values().next().value ?? null) : null;
    const sameBlock = written === null || (content !== null && sameContent(written, content));
    const ruleChanged = recurrenceChanged(draft, initial, day.date, day.workingDays);
    if (sameBlock && !ruleChanged) {
        return { kind: 'close' };
    }
    const changes =
        base.kind === 'write' ? base.changes : fill(quartersOf(target), content === null ? null : unlinked(content));
    // Ce que la case montrait quand on a commencé à la régler : la récurrence du bloc doit
    // l'être encore.
    const seen = draft.seen ?? seenOf(linked);
    const following: RecurrenceAction = {
        kind: 'recurrence',
        changes,
        rule,
        replaces: { ...seen, id: linked.id },
        gesture: null,
    };
    // Décochée, la case arrête la récurrence ; cochée, un autre ticket ou commentaire la
    // modifie. Ses jours ou sa fin changés valent pour la série, sans question.
    const question: ScopeQuestion | null = !draft.on ? 'stop' : !sameBlock && !ruleChanged ? 'modify' : null;
    if (past || question === null) {
        return following;
    }
    // Les deux réponses changent la même fois : posée en deux morceaux autour d'une autre
    // saisie, elle change entière, comme avec les suivantes (src/Day/DayWriter.php).
    const once =
        question === 'modify' && written !== null
            ? new Map([...fill(occurrenceIn(day.grid, linked.id), written), ...changes])
            : changes;

    return { kind: 'ask', question, once: { kind: 'write', changes: once, gesture: null }, following };
}

/**
 * Effacer un bloc, par la corbeille de sa fenêtre ou en vidant son ticket. Sur un bloc qui
 * revient, d'aujourd'hui ou d'un jour à venir, la question demande quelles fois effacer ;
 * d'un jour passé, ou sur un bloc qui ne revient pas, il s'efface cette fois seulement.
 */
export function eraseAction(
    target: EntryTarget,
    day: DayState,
    today: string,
    base = deleteEntry(target),
): EntryAction {
    const linked = linkedRecurrence(target, day);
    if (linked === null || day.date < today || base.kind !== 'write' || target.kind !== 'edit') {
        return base;
    }

    return erasing(base, fill(occurrenceIn(day.grid, linked.id), null), linked);
}

/**
 * Effacer la sélection — Suppr, « Effacer » du menu — : la question, si elle couvre un seul
 * bloc qui revient, d'aujourd'hui ou d'un jour à venir, en entier, et rien d'autre ; null
 * sinon, et la sélection s'efface cette fois seulement. Une partie de bloc, plusieurs blocs
 * qui reviennent, un bloc qui revient avec d'autres : une seule réponse serait ambiguë.
 */
export function selectionErase(
    day: DayState,
    quarters: readonly number[],
    today: string,
    aimed: number | null = null,
): { readonly target: EntryTarget; readonly action: AskAction } | null {
    if (day.date < today) {
        return null;
    }
    const filled = quarters.filter((quarter) => day.grid.at(quarter) !== null);
    const id = filled.length === 0 ? null : (day.grid.at(filled[0] ?? Quarter.FIRST)?.recurrence ?? null);
    if (id === null || !filled.every((quarter) => day.grid.at(quarter)?.recurrence === id)) {
        return null;
    }
    const occurrence = occurrenceIn(day.grid, id);
    // La question s'ouvre sous le quart d'heure visé, dans son bloc.
    const target = targetAt(
        day.grid,
        aimed !== null && occurrence.includes(aimed) ? aimed : (occurrence[0] ?? Quarter.FIRST),
    );
    const linked = linkedRecurrence(target, day);
    if (linked === null || !occurrence.every((quarter) => filled.includes(quarter))) {
        return null;
    }

    return {
        target,
        action: erasing(
            { kind: 'write', changes: fill(quarters, null), gesture: 'clear' },
            fill(occurrence, null),
            linked,
        ),
    };
}

type AskAction = Extract<EntryAction, { readonly kind: 'ask' }>;

function erasing(base: WriteAction, occurrence: QuarterChanges, linked: Recurrence): AskAction {
    // Ses autres morceaux ce jour-là s'effacent avec elle, quelle que soit la réponse : les deux
    // visent la même fois.
    const changes = new Map([...occurrence, ...base.changes]);
    const once: WriteAction = { ...base, changes };

    return {
        kind: 'ask',
        question: 'erase',
        once,
        following: {
            kind: 'recurrence',
            changes,
            rule: null,
            replaces: seenOf(linked),
            gesture: once.gesture,
        },
    };
}

/**
 * Couper la sélection — Ctrl/⌘+X, « Couper » du menu — : la question, là où Effacer la pose
 * (selectionErase), sur une fois entière ce jour-là, comme allonger et raccourcir ; null sinon,
 * et c'est la coupe ordinaire : une fois posée en partie ne déplace pas la série, qu'elle
 * raccourcirait.
 * « Cette fois seulement » est cette coupe ordinaire : le presse-papier ne garde pas la
 * récurrence. « Cette fois et les suivantes » l'arrête à partir de cette fois, comme l'effacer,
 * et son bloc emporte son rythme : le premier collage la fera repartir (followRhythm).
 */
export function selectionCut(
    day: DayState,
    quarters: readonly number[],
    today: string,
    aimed: number | null = null,
): { readonly target: EntryTarget; readonly action: AskAction } | null {
    const erase = selectionErase(day, quarters, today, aimed);
    const linked = erase === null ? null : linkedRecurrence(erase.target, day);
    if (erase === null || linked === null) {
        return null;
    }
    const occurrence = occurrenceIn(day.grid, linked.id);
    const plain = copyQuarters(day.grid, quarters);
    const moved = isWhole(linked, occurrence)
        ? cutRecurrence(day.grid, occurrence, ruleOf(linked), { id: linked.id, date: day.date })
        : null;
    if (plain === null || moved === null) {
        return null;
    }
    const { once, following } = erase.action;

    return {
        target: erase.target,
        action: {
            kind: 'ask',
            question: 'cut',
            once: { ...once, gesture: 'cut', cuts: plain },
            following: { ...following, gesture: 'cut', cuts: moved },
        },
    };
}

/**
 * Effacer le haut ou le bas d'un bloc qui revient — Suppr, « Effacer » du menu — : la question
 * « Raccourcir une récurrence », si la sélection ne touche qu'un bloc qui revient, entier ce
 * jour-là, d'aujourd'hui ou d'un jour à venir, et lui laisse un morceau d'un seul tenant ; null
 * sinon, et la sélection s'efface cette fois seulement — un effacement au milieu le coupe en
 * deux, sans question. Cette fois seulement, ce qui reste perd sa flèche ; avec les suivantes,
 * la récurrence garde les heures qui restent.
 */
export function selectionShorten(
    day: DayState,
    quarters: readonly number[],
    today: string,
): { readonly target: EntryTarget; readonly action: AskAction } | null {
    if (day.date < today) {
        return null;
    }
    const filled = quarters.filter((quarter) => day.grid.at(quarter) !== null);
    const id = filled.length === 0 ? null : (day.grid.at(filled[0] ?? Quarter.FIRST)?.recurrence ?? null);
    const linked = id === null ? undefined : day.recurrences.get(id);
    if (
        id === null ||
        linked === undefined ||
        !reaches(linked, day.date) ||
        !filled.every((quarter) => day.grid.at(quarter)?.recurrence === id)
    ) {
        return null;
    }
    const occurrence = occurrenceIn(day.grid, id);
    const content = day.grid.at(occurrence[0] ?? Quarter.FIRST);
    const kept = occurrence.filter((quarter) => !filled.includes(quarter));
    const start = kept[0];
    const last = kept.at(-1);
    if (!isWhole(linked, occurrence) || content === null || start === undefined || last === undefined || !isRun(kept)) {
        return null;
    }

    return {
        // La question vise ce qu'on efface : la sélection reste dessus, sans s'étendre au bloc.
        target: { kind: 'new', quarters },
        action: {
            kind: 'ask',
            question: 'shorten',
            once: { kind: 'write', changes: fill(quarters, null), gesture: 'clear' },
            following: {
                kind: 'recurrence',
                changes: fill(filled, null),
                rule: ruleOf(linked),
                replaces: seenOf(linked),
                gesture: 'clear',
            },
            reshapes: { content, start, end: last + Quarter.MINUTES },
        },
    };
}

/** Un bloc qui revient qu'un geste allonge, et ses heures après lui. */
export interface Extension {
    readonly linked: Recurrence;
    /** Ce qu'il pose, tel que la grille le montre. */
    readonly content: SlotContent;
    /** Ses quarts d'heure ce jour-là. */
    readonly occurrence: readonly number[];
    readonly start: number;
    readonly end: number;
}

/**
 * Ce qu'écrit un geste allonge-t-il un bloc qui revient ? Le même contenu, qui le touche —
 * au-dessus, au-dessous, ou des deux côtés —, d'aujourd'hui ou d'un jour à venir, sur un bloc
 * entier ce jour-là : posé en deux morceaux autour d'une autre saisie, ses heures ne
 * s'allongeraient pas d'un seul tenant. Null sinon, ou si deux blocs qui reviennent s'y
 * prêtent : une seule réponse serait ambiguë.
 */
export function extension(day: DayState, changes: QuarterChanges, today: string): Extension | null {
    const cells = [...changes.values()];
    const first = cells[0] ?? null;
    if (day.date < today || first === null || !cells.every((cell) => cell !== null && sameContent(cell, first))) {
        return null;
    }
    const written = [...changes.keys()];
    const found: Extension[] = [];
    for (const linked of day.recurrences.values()) {
        const occurrence = occurrenceIn(day.grid, linked.id);
        const content = day.grid.at(occurrence[0] ?? Quarter.FIRST);
        if (
            !reaches(linked, day.date) ||
            !isWhole(linked, occurrence) ||
            content === null ||
            !sameContent(content, first)
        ) {
            continue;
        }
        const all = [...new Set([...occurrence, ...written])].sort((a, b) => a - b);
        const start = all[0];
        const last = all.at(-1);
        if (
            written.every((quarter) => occurrence.includes(quarter)) ||
            !isRun(all) ||
            start === undefined ||
            last === undefined
        ) {
            continue;
        }
        found.push({ linked, content, occurrence, start, end: last + Quarter.MINUTES });
    }

    return found.length === 1 ? (found[0] ?? null) : null;
}

/**
 * La question « Allonger une récurrence » : cette fois seulement, le bloc s'allonge ce jour-là,
 * détaché, en un seul bloc ; avec les suivantes, sa récurrence prend ses nouvelles heures à
 * partir de cette fois (le serveur les déduit du geste).
 *
 * @param rule le rythme et la fin qu'elle garde
 */
export function extending(extended: Extension, base: WriteAction, rule: RecurrenceRule): AskAction {
    const changes = new Map(
        [...base.changes].map(([quarter, cell]) => [quarter, cell === null ? null : unlinked(cell)]),
    );

    return {
        kind: 'ask',
        question: 'extend',
        once: { ...base, changes: new Map([...fill(extended.occurrence, unlinked(extended.content)), ...changes]) },
        following: {
            kind: 'recurrence',
            changes,
            rule,
            replaces: seenOf(extended.linked),
            gesture: base.gesture,
        },
        reshapes: { content: extended.content, start: extended.start, end: extended.end },
    };
}

/**
 * Coller ou déposer un favori au bord d'un bloc qui revient : la question, qui s'ouvre sur ce
 * qu'on y pose ; null quand le geste n'allonge rien, et il se fait sans question.
 */
export function gestureExtension(
    day: DayState,
    changes: QuarterChanges,
    today: string,
    gesture: WriteAction['gesture'],
): { readonly target: EntryTarget; readonly action: AskAction } | null {
    const extended = extension(day, changes, today);
    if (extended === null) {
        return null;
    }

    return {
        target: { kind: 'new', quarters: [...changes.keys()].sort((a, b) => a - b) },
        action: extending(extended, { kind: 'write', changes, gesture }, ruleOf(extended.linked)),
    };
}

/** Sa fois ce jour-là couvre toute sa plage, d'un seul tenant. */
function isWhole(recurrence: Recurrence, occurrence: readonly number[]): boolean {
    return (
        occurrence[0] === recurrence.start &&
        occurrence.length === (recurrence.end - recurrence.start) / Quarter.MINUTES &&
        isRun(occurrence)
    );
}

/** Des quarts d'heure qui se suivent, sans trou. */
function isRun(quarters: readonly number[]): boolean {
    const first = quarters[0];
    const last = quarters.at(-1);

    return first !== undefined && last !== undefined && last - first === (quarters.length - 1) * Quarter.MINUTES;
}
