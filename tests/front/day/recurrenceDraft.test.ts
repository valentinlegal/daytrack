import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { addDays } from '../../../assets/day/calendar';
import {
    alternatingWith,
    draftClash,
    draftRhythm,
    draftSkipped,
    draftUntil,
    eraseAction,
    initialRecurrence,
    linkedRecurrence,
    monthChoices,
    noDayChosen,
    readRule,
    type RecurrenceDraft,
    recurrenceAction,
    recurrenceChanged,
    recurrenceFirstDay,
    recurrenceStart,
    saveBlocked,
    seenAgain,
    selectionErase,
    sentUntil,
    shownUntil,
    toggleDay,
    untilMinimum,
    type SeenDay,
} from '../../../assets/day/recurrenceDraft';
import { INCOMPLETE_DATE_REFUSAL, NO_DAY_REFUSAL, readDate, takenRefusal } from '../../../assets/day/recurrenceText';
import { fill } from '../../../assets/grid/changes';
import type { DayState } from '../../../assets/grid/day';
import {
    deleteEntry,
    draftOf,
    type EntryAction,
    type EntryTarget,
    pauseEntry,
    saveEntry,
    targetAt,
} from '../../../assets/grid/entry';
import { type Grid, PAUSE, work } from '../../../assets/grid/grid';
import * as Quarter from '../../../assets/grid/quarter';
import {
    LAST_WEEK,
    monthlyDate,
    monthlyWeekday,
    type Recurrence,
    type RecurrenceRule,
    type Rhythm,
    sameRhythm,
    type SeenRecurrence,
    type TimedSchedule,
    weekly,
} from '../../../assets/grid/recurrence';
import { NOTHING_SENT } from '../../../assets/grid/send';
import { bruteClash, bruteEarliest } from '../grid/clashOracle';
import { gridOf, minutes } from '../grid/support';

/** Mardi 6 octobre 2026, et le samedi 10. */
const TUESDAY = '2026-10-06';
const SATURDAY = '2026-10-10';
const WEEK = [1, 2, 3, 4, 5];
/** Le mercredi décoché depuis dans les réglages : la case ne le montre plus. */
const NO_WEDNESDAY = [1, 2, 4, 5];

/** Le Daily, chaque jour ouvré jusqu'au 4 novembre ; le déjeuner, chaque jour, sans fin. */
const DAILY: Recurrence = {
    id: 'daily',
    start: minutes('09:15'),
    end: minutes('09:30'),
    rhythm: weekly(WEEK),
    firstDay: '2026-10-05',
    until: '2026-11-04',
    content: { kind: 'work', ticket: 'OPS-12', comment: 'Daily' },
};
const LUNCH: Recurrence = {
    id: 'lunch',
    start: minutes('12:30'),
    end: minutes('13:30'),
    rhythm: weekly([1, 2, 4]),
    firstDay: '2026-10-05',
    until: null,
    content: { kind: 'pause' },
};

/** Ce qu'une fenêtre ouverte sur leur bloc en voit. */
const SEEN_DAILY: SeenRecurrence = { id: 'daily', weekdays: WEEK, until: '2026-11-04' };
const SEEN_LUNCH: SeenRecurrence = { id: 'lunch', weekdays: [1, 2, 4], until: null };

const GRID = gridOf([
    ['09:15', '09:30', 'work', 'OPS-12', 'Daily', 'daily'],
    ['10:00', '11:00', 'work', 'SHOP-482', null],
    ['11:00', '11:30', 'pause', null, null],
    ['12:30', '13:30', 'pause', null, null, 'lunch'],
]);

function dayOf(grid: Grid = GRID, date = TUESDAY, recurrences: readonly Recurrence[] = [DAILY, LUNCH]): DayState {
    return {
        date,
        version: 3,
        objective: 450,
        habitualObjective: 450,
        working: true,
        declaredOff: false,
        workingDays: WEEK,
        grid,
        send: NOTHING_SENT,
        recurrences: new Map(recurrences.map((recurrence) => [recurrence.id, recurrence])),
        recurrencesHeld: false,
        ongoing: new Map(recurrences.map((recurrence) => [recurrence.id, recurrence])),
        settledAhead: new Set(),
    };
}

function editAt(time: string, grid: Grid = GRID): EntryTarget {
    const target = targetAt(grid, minutes(time));
    if (target.kind !== 'edit') {
        throw new Error(`Aucun bloc à ${time}.`);
    }

    return target;
}

const daily = editAt('09:15');
const lunch = editAt('12:30');
const shop = editAt('10:00');
const pause = editAt('11:00');
const fresh: EntryTarget = { kind: 'new', quarters: [minutes('14:00'), minutes('14:15')] };

/** La case cochée, chaque semaine, ces jours-là ; « une semaine sur » et le jour du mois, tels qu'à l'ouverture d'un mardi. */
function on(weekdays: readonly number[], until = ''): RecurrenceDraft {
    return { on: true, pace: 'week', weekdays, everyWeeks: 2, month: 'rank', until };
}

function off(weekdays: readonly number[], until = ''): RecurrenceDraft {
    return { ...on(weekdays, until), on: false };
}

/** La règle que la fenêtre envoie : chaque semaine, ces jours-là. */
function ruleOf(weekdays: readonly number[], until: string | null = null): RecurrenceRule {
    return { ...weekly(weekdays), until };
}

const OFF: RecurrenceDraft = off([2], '');

/** Ce que fait « Enregistrer », la case réglée ainsi, sur la journée du mardi, ce mardi. */
function action(base: EntryAction, target: EntryTarget, draft: RecurrenceDraft | null): EntryAction {
    return recurrenceAction(base, target, draft, initialRecurrence(target, dayOf()), dayOf(), TUESDAY);
}

describe('linkedRecurrence', () => {
    it('rend la récurrence du bloc de Modifier le ticket, et aucune ailleurs', () => {
        expect(linkedRecurrence(daily, dayOf())).toBe(DAILY);
        expect(linkedRecurrence(lunch, dayOf())).toBe(LUNCH);
        expect(linkedRecurrence(shop, dayOf())).toBeNull();
        // Nouveau ticket par-dessus un bloc qui revient ne le modifie pas : il le remplace.
        expect(linkedRecurrence({ kind: 'new', quarters: [minutes('09:15')] }, dayOf())).toBeNull();
    });

    it('n’en rend aucune quand la journée ne la décrit pas', () => {
        expect(linkedRecurrence(daily, dayOf(GRID, TUESDAY, []))).toBeNull();
    });
});

describe('initialRecurrence', () => {
    it('coche la case d’un bloc qui revient, à son rythme et jusqu’à sa fin', () => {
        expect(initialRecurrence(daily, dayOf())).toEqual({
            ...on(WEEK, '2026-11-04'),
            seen: SEEN_DAILY,
            seenRhythm: weekly(WEEK),
            seenUntil: '2026-11-04',
        });
        expect(initialRecurrence(lunch, dayOf())).toEqual({
            ...on([1, 2, 4]),
            seen: SEEN_LUNCH,
            seenRhythm: weekly([1, 2, 4]),
            seenUntil: '',
        });
    });

    it('la décoche ailleurs, le jour du bloc choisi s’il est travaillé', () => {
        expect(initialRecurrence(shop, dayOf())).toEqual(off([2], ''));
        expect(initialRecurrence(pause, dayOf())).toEqual(off([2], ''));
        expect(initialRecurrence(fresh, dayOf())).toEqual(off([2], ''));
        // Un samedi non travaillé : « Chaque mois » n'y proposerait que sa date.
        expect(initialRecurrence(fresh, dayOf(GRID, SATURDAY))).toEqual({ ...off([]), month: 'date' });
    });

    it('n’a pas de case sur Modifier la sélection, ni sur une sélection en plusieurs morceaux', () => {
        expect(
            initialRecurrence(
                {
                    kind: 'part',
                    quarters: [minutes('10:00')],
                    content: { kind: 'work', ticket: 'SHOP-482', comment: null, recurrence: null },
                    beyond: true,
                },
                dayOf(),
            ),
        ).toBeNull();
        expect(initialRecurrence({ kind: 'new', quarters: [minutes('14:00'), minutes('15:00')] }, dayOf())).toBeNull();
        expect(initialRecurrence({ kind: 'new', quarters: [] }, dayOf())).toBeNull();
    });

    it('en a une sur toute une journée d’un seul tenant, jusqu’à 20:00', () => {
        expect(initialRecurrence({ kind: 'new', quarters: Quarter.all() }, dayOf())?.on).toBe(false);
    });
});

describe('readRule', () => {
    it('rend la règle à envoyer, ses jours dans l’ordre et sa fin en jour du calendrier', () => {
        expect(readRule(on([5, 1, 3], '2026-11-04'), TUESDAY, TUESDAY, WEEK, TUESDAY)).toEqual({
            rule: ruleOf([1, 3, 5], '2026-11-04'),
        });
        expect(readRule(on([2]), TUESDAY, TUESDAY, WEEK, TUESDAY)).toEqual({ rule: ruleOf([2]) });
    });

    it('accepte une fin le premier jour permis', () => {
        expect(readRule(on([2], TUESDAY), TUESDAY, TUESDAY, WEEK, TUESDAY)).toEqual({ rule: ruleOf([2], TUESDAY) });
    });

    it('refuse sous « Jours » et sous « Jusqu’au », les deux à la fois', () => {
        expect(readRule(on([]), TUESDAY, TUESDAY, WEEK, TUESDAY)).toEqual({ weekdays: NO_DAY_REFUSAL, until: null });
        expect(readRule(on([], '2026-10-05'), TUESDAY, TUESDAY, WEEK, TUESDAY)).toEqual({
            weekdays: NO_DAY_REFUSAL,
            until: 'Choisissez un jour à partir du mardi 6 octobre.',
        });
        expect(readRule(on([2], '2026-10-07'), '2026-10-08', TUESDAY, WEEK, TUESDAY)).toEqual({
            weekdays: null,
            until: 'Choisissez un jour à partir du jeudi 8 octobre.',
        });
    });

    it('dit l’année du premier jour possible quand elle n’est pas celle d’aujourd’hui', () => {
        expect(readRule(on([2], '2026-12-30'), '2027-01-05', '2027-01-05', WEEK, '2026-12-28')).toEqual({
            weekdays: null,
            until: 'Choisissez un jour à partir du mardi 5 janvier 2027.',
        });
    });

    it('garde un jour décoché depuis dans les réglages, sans qu’il suffise à faire une règle', () => {
        expect(readRule(on([2, 3]), TUESDAY, TUESDAY, NO_WEDNESDAY, TUESDAY)).toEqual({ rule: ruleOf([2, 3]) });
        expect(readRule(on([3]), TUESDAY, TUESDAY, NO_WEDNESDAY, TUESDAY)).toEqual({
            weekdays: NO_DAY_REFUSAL,
            until: null,
        });
    });

    it('refuse une date commencée, que le champ ne donne pas encore : jamais lue comme « sans fin »', () => {
        expect(readRule({ ...on([2]), incomplete: true }, TUESDAY, TUESDAY, WEEK, TUESDAY)).toEqual({
            weekdays: null,
            until: INCOMPLETE_DATE_REFUSAL,
        });
        expect(readRule(on([2], '20266-11-04'), TUESDAY, TUESDAY, WEEK, TUESDAY)).toEqual({
            weekdays: null,
            until: INCOMPLETE_DATE_REFUSAL,
        });
    });
});

describe('untilMinimum', () => {
    const wednesday = '2026-10-07';

    it('part du jour du bloc pour une récurrence qu’on crée, ou d’un bloc d’aujourd’hui ou à venir', () => {
        expect(untilMinimum(on([2]), null, TUESDAY, wednesday, WEEK)).toBe(TUESDAY);
        expect(untilMinimum(on([1]), DAILY, TUESDAY, TUESDAY, WEEK)).toBe(TUESDAY);
        expect(untilMinimum(on([1]), DAILY, SATURDAY, TUESDAY, WEEK)).toBe(SATURDAY);
    });

    it('d’un jour passé, va jusqu’à aujourd’hui pour une fin seule, et part de demain pour un rythme changé', () => {
        expect(untilMinimum(on(WEEK, '2026-11-20'), DAILY, TUESDAY, wednesday, WEEK)).toBe(wednesday);
        expect(untilMinimum(on([5, 1], '2026-11-04'), DAILY, TUESDAY, wednesday, WEEK)).toBe('2026-10-08');
        // Rien de changé : sa fin d'avant reste la sienne, même passée.
        expect(untilMinimum(on(WEEK, '2026-11-04'), DAILY, TUESDAY, '2026-11-10', WEEK)).toBe(TUESDAY);
    });
});

describe('recurrenceStart', () => {
    it('dit d’où part ce qu’on crée, et le rythme changé d’un bloc passé, de demain', () => {
        expect(recurrenceStart(on([2]), null, TUESDAY, TUESDAY, WEEK)).toBe('today');
        expect(recurrenceStart(on([2]), null, TUESDAY, '2026-10-07', WEEK)).toBe('tomorrow');
        // D'un jour passé, une fin avant demain : elle ne part de nulle part.
        expect(recurrenceStart(on([2], '2026-10-07'), null, TUESDAY, '2026-10-07', WEEK)).toBeNull();
        expect(recurrenceStart(on([2], '2026-10-08'), null, TUESDAY, '2026-10-07', WEEK)).toBe('tomorrow');
        expect(recurrenceStart(on([2]), null, SATURDAY, TUESDAY, WEEK)).toEqual({ from: SATURDAY });
        expect(recurrenceStart(on(WEEK), DAILY, TUESDAY, TUESDAY, WEEK)).toBeNull();
        expect(recurrenceStart(on([1]), DAILY, TUESDAY, TUESDAY, WEEK)).toBeNull();
        expect(recurrenceStart(on(WEEK, '2026-12-01'), DAILY, TUESDAY, '2026-10-07', WEEK)).toBeNull();
        expect(recurrenceStart(on([1]), DAILY, TUESDAY, '2026-10-07', WEEK)).toBe('tomorrow');
    });
});

describe('noDayChosen', () => {
    it('ne grise « Enregistrer » que la case cochée sans jour', () => {
        expect(noDayChosen(on([]), WEEK)).toBe(true);
        expect(noDayChosen(on([2]), WEEK)).toBe(false);
        expect(noDayChosen(off([], ''), WEEK)).toBe(false);
        expect(noDayChosen(null, WEEK)).toBe(false);
    });

    it('ne compte que les jours montrés : un jour décoché depuis dans les réglages ne suffit pas', () => {
        expect(noDayChosen(on([3]), NO_WEDNESDAY)).toBe(true);
        expect(noDayChosen(on([3, 4]), NO_WEDNESDAY)).toBe(false);
    });
});

describe('toggleDay', () => {
    it('presse ou relâche un jour, dans l’ordre de la semaine', () => {
        expect(toggleDay(on([4, 1]), 2, WEEK)).toEqual(on([1, 2, 4]));
        expect(toggleDay(on([1, 2, 4], '2026-11-04'), 2, WEEK)).toEqual(on([1, 4], '2026-11-04'));
        expect(toggleDay(on([2]), 2, WEEK)).toEqual(on([]));
    });

    it('retire au premier geste un jour décoché depuis dans les réglages, que la case ne montre pas', () => {
        const draft: RecurrenceDraft = { ...on(WEEK), seen: SEEN_DAILY };

        // Relâcher le vendredi, ou presser un jour qui ne l'était pas : le mercredi sort.
        expect(toggleDay(draft, 5, NO_WEDNESDAY)).toEqual({ ...on([1, 2, 4]), seen: SEEN_DAILY });
        expect(toggleDay(on([3, 5]), 1, NO_WEDNESDAY)).toEqual(on([1, 5]));
        // Seul jour montré relâché : il n'en reste aucun.
        expect(toggleDay(on([2, 3]), 2, NO_WEDNESDAY)).toEqual(on([]));
    });
});

describe('saveBlocked', () => {
    const initial = initialRecurrence(pause, dayOf());

    it('grise « Enregistrer » sur une pause sans ticket, sauf pour régler sa case', () => {
        expect(saveBlocked(pause, { ticket: '', comment: '' }, initial, initial, TUESDAY, WEEK)).toBe(true);
        expect(saveBlocked(pause, { ticket: '', comment: '' }, on([2]), initial, TUESDAY, WEEK)).toBe(false);
        expect(saveBlocked(pause, { ticket: 'OPS-7', comment: 'Revue' }, initial, initial, TUESDAY, WEEK)).toBe(false);
    });

    it('le grise tant qu’un commentaire est tapé sans ticket sur une pause, case cochée ou non', () => {
        expect(saveBlocked(pause, { ticket: '', comment: 'Revue' }, initial, initial, TUESDAY, WEEK)).toBe(true);
        expect(saveBlocked(pause, { ticket: ' ', comment: 'Revue' }, on([2]), initial, TUESDAY, WEEK)).toBe(true);
        expect(
            saveBlocked(
                lunch,
                { ticket: '', comment: 'Revue' },
                initialRecurrence(lunch, dayOf()),
                null,
                TUESDAY,
                WEEK,
            ),
        ).toBe(true);
        // Que des espaces : rien n'est tapé.
        expect(saveBlocked(pause, { ticket: '', comment: '   ' }, on([2]), initial, TUESDAY, WEEK)).toBe(false);
        // Un ticket sans ticket tapé se supprime : rien ne le grise.
        expect(saveBlocked(shop, { ticket: '', comment: 'Revue' }, OFF, OFF, TUESDAY, WEEK)).toBe(false);
    });

    it('le grise sans jour choisi, la case cochée', () => {
        expect(saveBlocked(shop, draftOf(shop), on([]), OFF, TUESDAY, WEEK)).toBe(true);
    });

    it('le grise quand il ne reste qu’un jour décoché depuis dans les réglages', () => {
        expect(saveBlocked(daily, draftOf(daily), on([3]), OFF, TUESDAY, NO_WEDNESDAY)).toBe(true);
        expect(saveBlocked(daily, draftOf(daily), on([2, 3]), OFF, TUESDAY, NO_WEDNESDAY)).toBe(false);
    });
});

describe('recurrenceChanged', () => {
    const initial = on([1, 2, 3], '2026-11-04');

    it('ne voit rien de changé sans case, ou réglée comme à l’ouverture', () => {
        expect(recurrenceChanged(null, initial, TUESDAY, WEEK)).toBe(false);
        expect(recurrenceChanged(initial, null, TUESDAY, WEEK)).toBe(false);
        expect(recurrenceChanged(on([1, 2, 3], '2026-11-04'), on([3, 1, 2], '2026-11-04'), TUESDAY, WEEK)).toBe(false);
    });

    it('voit la case cochée ou décochée, un jour, une fin, une date commencée', () => {
        expect(recurrenceChanged({ ...initial, on: false }, initial, TUESDAY, WEEK)).toBe(true);
        expect(recurrenceChanged(on([2]), OFF, TUESDAY, WEEK)).toBe(true);
        expect(recurrenceChanged(on([1, 2]), initial, TUESDAY, WEEK)).toBe(true);
        expect(recurrenceChanged(on([1, 2, 3]), initial, TUESDAY, WEEK)).toBe(true);
        expect(recurrenceChanged({ ...on([1, 2, 3]), incomplete: true }, on([1, 2, 3]), TUESDAY, WEEK)).toBe(true);
    });

    it('ne regarde ni les jours ni la fin d’une case qui reste décochée', () => {
        expect(recurrenceChanged(off([1, 5], '2027-01-01'), OFF, TUESDAY, WEEK)).toBe(false);
    });
});

describe('recurrenceAction', () => {
    const rule = ruleOf([1, 3]);

    it('laisse l’enregistrement tel quel sans case, ou la case décochée sur un bloc qui ne revient pas', () => {
        const base = saveEntry(shop, { ticket: 'SHOP-483', comment: '' });

        expect(action(base, shop, null)).toBe(base);
        expect(action(base, shop, OFF)).toBe(base);
    });

    it('crée la récurrence du bloc écrit, la case cochée', () => {
        const base = saveEntry(shop, { ticket: 'SHOP-483', comment: 'Revue' });
        if (base.kind !== 'write') {
            throw new Error('Le bloc ne s’écrit pas.');
        }

        expect(action(base, shop, on([3, 1]))).toEqual({
            kind: 'recurrence',
            changes: base.changes,
            rule,
            replaces: null,
            gesture: null,
        });
    });

    it('crée la récurrence de Nouveau ticket, en disant ce qu’il remplace', () => {
        const base = saveEntry(fresh, { ticket: 'OPS-12', comment: 'Daily' });

        expect(action(base, fresh, on([1, 3]))).toEqual({
            kind: 'recurrence',
            changes: fill(fresh.quarters, work('OPS-12', 'Daily')),
            rule,
            replaces: null,
            gesture: 'replace',
        });
    });

    it('crée une pause qui revient, depuis « Pause » de Nouveau ticket', () => {
        expect(action(pauseEntry(fresh), fresh, on([1, 3]))).toEqual({
            kind: 'recurrence',
            changes: fill(fresh.quarters, PAUSE),
            rule,
            replaces: null,
            gesture: 'pause',
        });
    });

    it('crée la récurrence d’un bloc qui ne change pas, une pause comprise', () => {
        const unchanged = saveEntry(pause, draftOf(pause));
        expect(unchanged).toEqual({ kind: 'close' });

        expect(action(unchanged, pause, on([1, 3]))).toEqual({
            kind: 'recurrence',
            changes: fill([minutes('11:00'), minutes('11:15')], PAUSE),
            rule,
            replaces: null,
            gesture: null,
        });
    });

    it('ne crée rien sur Nouveau ticket où rien n’est tapé', () => {
        expect(action({ kind: 'close' }, fresh, on([2]))).toEqual({ kind: 'close' });
    });

    it('refuse sous ses champs une case cochée sans jour, ou une fin de travers, sans rien envoyer', () => {
        expect(action(saveEntry(shop, draftOf(shop)), shop, on([]))).toEqual({
            kind: 'refuse',
            weekdays: NO_DAY_REFUSAL,
            until: null,
            rhythm: null,
        });
        expect(action(saveEntry(daily, draftOf(daily)), daily, { ...on([2]), incomplete: true })).toEqual({
            kind: 'refuse',
            weekdays: null,
            until: INCOMPLETE_DATE_REFUSAL,
            rhythm: null,
        });
    });

    it('envoie un jour décoché depuis dans les réglages tant qu’on n’a pas touché aux jours, jamais seul', () => {
        const noWednesday: DayState = { ...dayOf(), workingDays: NO_WEDNESDAY };
        const base = saveEntry(daily, { ticket: 'OPS-13', comment: 'Daily' });
        const initial = initialRecurrence(daily, noWednesday);

        expect(recurrenceAction(base, daily, initial, initial, noWednesday, TUESDAY)).toMatchObject({
            kind: 'ask',
            question: 'modify',
            following: { kind: 'recurrence', rule: ruleOf(WEEK, '2026-11-04'), replaces: SEEN_DAILY },
        });
        expect(recurrenceAction(base, daily, on([3]), initial, noWednesday, TUESDAY)).toEqual({
            kind: 'refuse',
            weekdays: NO_DAY_REFUSAL,
            until: null,
            rhythm: null,
        });
    });

    it('ferme la fenêtre d’un bloc qui revient quand rien n’a changé', () => {
        const initial = initialRecurrence(daily, dayOf());

        expect(action(saveEntry(daily, draftOf(daily)), daily, initial)).toEqual({ kind: 'close' });
        expect(action(saveEntry(lunch, draftOf(lunch)), lunch, initialRecurrence(lunch, dayOf()))).toEqual({
            kind: 'close',
        });
    });

    it('demande quelles fois changer quand le ticket change : cette fois seule, ou la récurrence coupée', () => {
        const base = saveEntry(daily, { ticket: 'OPS-13', comment: 'Daily' });
        const changes = fill([minutes('09:15')], work('OPS-13', 'Daily'));

        expect(action(base, daily, initialRecurrence(daily, dayOf()))).toEqual({
            kind: 'ask',
            question: 'modify',
            once: { kind: 'write', changes, gesture: null },
            following: {
                kind: 'recurrence',
                changes,
                rule: ruleOf(WEEK, '2026-11-04'),
                replaces: SEEN_DAILY,
                gesture: null,
            },
        });
    });

    it('change ses jours ou sa fin, le bloc écrit sans lien', () => {
        const base = saveEntry(daily, draftOf(daily));

        expect(action(base, daily, on([2, 4], '2026-11-04'))).toEqual({
            kind: 'recurrence',
            changes: fill([minutes('09:15')], work('OPS-12', 'Daily')),
            rule: ruleOf([2, 4], '2026-11-04'),
            replaces: SEEN_DAILY,
            gesture: null,
        });
        expect(action(base, daily, on(WEEK))).toMatchObject({ rule: ruleOf(WEEK) });
    });

    it('demande quelles fois arrêter, la case décochée : le bloc reste, sans lien, cette fois ou à partir d’elle', () => {
        const changes = fill([minutes('09:15')], work('OPS-12', 'Daily'));

        expect(action(saveEntry(daily, draftOf(daily)), daily, { ...on(WEEK), on: false })).toEqual({
            kind: 'ask',
            question: 'stop',
            once: { kind: 'write', changes, gesture: null },
            following: { kind: 'recurrence', changes, rule: null, replaces: SEEN_DAILY, gesture: null },
        });
    });

    it('demande quelles fois arrêter une pause qui revient, que « Enregistrer » laisserait fermer', () => {
        const unchanged = saveEntry(lunch, draftOf(lunch));
        expect(unchanged).toEqual({ kind: 'close' });
        const changes = fill(Quarter.between(minutes('12:30'), minutes('13:30')), PAUSE);

        expect(action(unchanged, lunch, { ...on([1, 2, 4]), on: false })).toEqual({
            kind: 'ask',
            question: 'stop',
            once: { kind: 'write', changes, gesture: null },
            following: { kind: 'recurrence', changes, rule: null, replaces: SEEN_LUNCH, gesture: null },
        });
    });

    it('remplace la récurrence telle que la case l’a montrée, même changée depuis', () => {
        // La case a été réglée quand le Daily n'avait pas de fin ; un autre onglet lui en a donné une.
        const draft: RecurrenceDraft = { ...on([2, 4], '2026-11-04'), seen: { ...SEEN_DAILY, until: null } };

        expect(action(saveEntry(daily, draftOf(daily)), daily, draft)).toMatchObject({
            kind: 'recurrence',
            replaces: { id: 'daily', weekdays: WEEK, until: null },
        });
    });

    it('revoit la récurrence sur la journée à jour après un refus, ce qu’on a réglé gardé', () => {
        const draft: RecurrenceDraft = { ...on([2, 4], '2026-11-04'), seen: { ...SEEN_DAILY, until: null } };

        expect(seenAgain(draft, daily, dayOf())).toEqual({
            ...on([2, 4], '2026-11-04'),
            seen: SEEN_DAILY,
            seenRhythm: weekly(WEEK),
            seenUntil: '2026-11-04',
        });
        expect(seenAgain(undefined, daily, dayOf())).toBeUndefined();
        // Le bloc ne revient plus : il n'y a rien à revoir.
        expect(seenAgain(draft, daily, dayOf(GRID, TUESDAY, []))).toBe(draft);
    });

    it('reprend après un refus la fin et les jours posés ailleurs, là où on ne les a pas touchés', () => {
        // Le vendredi relâché quand le Daily n'avait pas de fin ; un autre onglet lui en a donné une.
        const days: RecurrenceDraft = { ...on([1, 2, 3, 4]), seen: { ...SEEN_DAILY, until: null } };
        expect(seenAgain(days, daily, dayOf())).toEqual({
            ...on([1, 2, 3, 4], '2026-11-04'),
            seen: SEEN_DAILY,
            seenRhythm: weekly(WEEK),
            seenUntil: '2026-11-04',
        });

        // Sa fin réglée quand il revenait le lundi et le mardi ; un autre onglet lui a rendu sa semaine.
        const until: RecurrenceDraft = {
            ...on([2, 1], '2026-12-01'),
            seen: { id: 'daily', weekdays: [1, 2], until: '2026-11-04' },
            seenRhythm: weekly([1, 2]),
        };
        expect(seenAgain(until, daily, dayOf())).toEqual({
            ...on(WEEK, '2026-12-01'),
            seen: SEEN_DAILY,
            seenRhythm: weekly(WEEK),
            seenUntil: '2026-11-04',
        });

        // Rien de touché : la case est celle de la récurrence à jour.
        const untouched: RecurrenceDraft = {
            ...on([1, 2]),
            seen: { id: 'daily', weekdays: [1, 2], until: null },
            seenRhythm: weekly([1, 2]),
        };
        expect(seenAgain(untouched, daily, dayOf())).toEqual(initialRecurrence(daily, dayOf()));
    });

    it('garde après un refus une date commencée, et la case qu’on a décochée', () => {
        const typing: RecurrenceDraft = { ...on(WEEK), incomplete: true, seen: { ...SEEN_DAILY, until: null } };
        expect(seenAgain(typing, daily, dayOf())).toEqual({
            ...on(WEEK),
            incomplete: true,
            seen: SEEN_DAILY,
            seenRhythm: weekly(WEEK),
            seenUntil: '2026-11-04',
        });

        const stopped: RecurrenceDraft = { ...on(WEEK), on: false, seen: { ...SEEN_DAILY, until: null } };
        expect(seenAgain(stopped, daily, dayOf())).toEqual({
            ...on(WEEK, '2026-11-04'),
            on: false,
            seen: SEEN_DAILY,
            seenRhythm: weekly(WEEK),
            seenUntil: '2026-11-04',
        });
    });

    it('ne fait que revoir la récurrence quand la case ne l’avait pas vue', () => {
        expect(seenAgain(on([2]), daily, dayOf())).toEqual({ ...on([2]), seen: SEEN_DAILY, seenUntil: '2026-11-04' });
    });

    it('demande quelles fois effacer en vidant le ticket, la case comme on l’a laissée', () => {
        const emptied = saveEntry(daily, { ticket: '', comment: 'Daily' });
        const erased = fill([minutes('09:15')], null);
        const ask = {
            kind: 'ask',
            question: 'erase',
            once: { kind: 'write', changes: erased, gesture: 'delete' },
            following: { kind: 'recurrence', changes: erased, rule: null, replaces: SEEN_DAILY, gesture: 'delete' },
        };

        expect(emptied).toEqual(deleteEntry(daily));
        expect(action(emptied, daily, initialRecurrence(daily, dayOf()))).toEqual(ask);
        // Décochée, ou sans jour : effacer n'a rien à refuser de la case.
        expect(action(emptied, daily, { ...on(WEEK), on: false })).toEqual(ask);
        expect(action(emptied, daily, on([]))).toEqual(ask);
        // Une autre fin réglée avant de vider le ticket n'y change rien : la fois s'efface.
        expect(action(emptied, daily, on(WEEK, '2026-12-31'))).toEqual(ask);
    });

    describe('sur un jour passé', () => {
        const wednesday = '2026-10-07';
        const past = (base: EntryAction, target: EntryTarget, draft: RecurrenceDraft | null): EntryAction =>
            recurrenceAction(base, target, draft, initialRecurrence(target, dayOf()), dayOf(), wednesday);

        it('garde la case d’un bloc qui revient, à son rythme', () => {
            expect(initialRecurrence(daily, dayOf())).toEqual({
                ...on(WEEK, '2026-11-04'),
                seen: SEEN_DAILY,
                seenRhythm: weekly(WEEK),
                seenUntil: '2026-11-04',
            });
        });

        it('n’écrit rien quand rien n’a changé', () => {
            const draft = initialRecurrence(daily, dayOf());
            // Enregistrer — ou un clic à côté — ne doit pas détacher la fois qu'on regardait.
            expect(past(saveEntry(daily, draftOf(daily)), daily, draft)).toEqual({ kind: 'close' });
        });

        it('change le rythme à partir de demain, sa fin au moins demain', () => {
            const base = saveEntry(daily, draftOf(daily));
            expect(past(base, daily, on([1, 3], '2026-11-04'))).toMatchObject({
                kind: 'recurrence',
                rule: ruleOf([1, 3], '2026-11-04'),
                replaces: SEEN_DAILY,
            });
            expect(past(base, daily, on([1, 3], wednesday))).toEqual({
                kind: 'refuse',
                weekdays: null,
                until: 'Choisissez un jour à partir du jeudi 8 octobre.',
                rhythm: null,
            });
            // Sa fin seule va jusqu'à aujourd'hui au moins.
            expect(past(base, daily, on(WEEK, TUESDAY))).toEqual({
                kind: 'refuse',
                weekdays: null,
                until: 'Choisissez un jour à partir du mercredi 7 octobre.',
                rhythm: null,
            });
            expect(past(base, daily, on(WEEK, wednesday))).toMatchObject({ kind: 'recurrence', replaces: SEEN_DAILY });
        });

        it('l’arrête, la case décochée, sans rien demander', () => {
            expect(past(saveEntry(daily, draftOf(daily)), daily, { ...on(WEEK, '2026-11-04'), on: false })).toEqual({
                kind: 'recurrence',
                changes: fill([minutes('09:15')], work('OPS-12', 'Daily')),
                rule: null,
                replaces: SEEN_DAILY,
                gesture: null,
            });
        });

        it('change un autre ticket sans rien demander : le serveur ne détache que cette fois', () => {
            const changes = fill([minutes('09:15')], work('OPS-13', 'Daily'));

            expect(
                past(
                    saveEntry(daily, { ticket: 'OPS-13', comment: 'Daily' }),
                    daily,
                    initialRecurrence(daily, dayOf()),
                ),
            ).toEqual({
                kind: 'recurrence',
                changes,
                rule: ruleOf(WEEK, '2026-11-04'),
                replaces: SEEN_DAILY,
                gesture: null,
            });
        });

        it('efface cette fois seulement en vidant le ticket, sans rien demander', () => {
            const emptied = saveEntry(daily, { ticket: '', comment: '' });

            expect(past(emptied, daily, initialRecurrence(daily, dayOf()))).toBe(emptied);
            expect(past(emptied, daily, { ...on(WEEK), on: false })).toBe(emptied);
        });
    });

    it('laisse passer un refus, une récurrence ou une question déjà décidés', () => {
        const refused: EntryAction = { kind: 'refuse', weekdays: NO_DAY_REFUSAL, until: null, rhythm: null };
        const decided: EntryAction = {
            kind: 'recurrence',
            changes: fill([minutes('09:15')], null),
            rule: null,
            replaces: SEEN_DAILY,
            gesture: null,
        };
        const asked: EntryAction = {
            kind: 'ask',
            question: 'erase',
            once: { kind: 'write', changes: fill([minutes('09:15')], null), gesture: 'delete' },
            following: { ...decided, gesture: 'delete' },
        };

        expect(action(refused, daily, on(WEEK))).toBe(refused);
        expect(action(decided, shop, on(WEEK))).toBe(decided);
        expect(action(asked, daily, initialRecurrence(daily, dayOf()))).toBe(asked);
    });
});

/** Le mercredi, à venir : ses blocs qui reviennent n'y sont que prévus, montrés comme les autres. */
const WEDNESDAY = '2026-10-07';

/** Le stand-up, de 15:00 à 16:00, chaque jour ouvré, sans fin. */
const STANDUP: Recurrence = {
    id: 'standup',
    start: minutes('15:00'),
    end: minutes('16:00'),
    rhythm: weekly(WEEK),
    firstDay: '2026-10-05',
    until: null,
    content: { kind: 'work', ticket: 'OPS-12', comment: 'Stand-up' },
};
/** Les bornes de la journée : une pause de 07:00 à 07:15, et le point du soir de 19:45 à 20:00. */
const EARLY: Recurrence = { ...STANDUP, id: 'early', start: Quarter.FIRST, end: Quarter.FIRST + Quarter.MINUTES };
const LATE: Recurrence = { ...STANDUP, id: 'late', start: Quarter.DAY_END - Quarter.MINUTES, end: Quarter.DAY_END };
const SEEN_STANDUP: SeenRecurrence = { id: 'standup', weekdays: WEEK, until: null };

/**
 * Le stand-up posé en partie, en deux morceaux autour d'un quart d'heure saisi avant lui ; et
 * les deux bornes.
 */
const EDGES = gridOf([
    ['07:00', '07:15', 'pause', null, null, 'early'],
    ['15:00', '15:30', 'work', 'OPS-12', 'Stand-up', 'standup'],
    ['15:30', '15:45', 'work', 'SHOP-482', null],
    ['15:45', '16:00', 'work', 'OPS-12', 'Stand-up', 'standup'],
    ['19:45', '20:00', 'work', 'OPS-7', 'Soir', 'late'],
]);

function edgesOn(date = TUESDAY): DayState {
    return dayOf(EDGES, date, [STANDUP, EARLY, LATE]);
}

/**
 * Ce que demande effacer : les deux réponses effacent les mêmes quarts d'heure — la fois entière
 * de ce jour, tous ses morceaux, et ceux qu'on visait.
 */
function askErase(
    quarters: readonly number[],
    replaces: SeenRecurrence,
    gesture: 'delete' | 'clear' = 'delete',
): EntryAction {
    return {
        kind: 'ask',
        question: 'erase',
        once: { kind: 'write', changes: fill(quarters, null), gesture },
        following: { kind: 'recurrence', changes: fill(quarters, null), rule: null, replaces, gesture },
    };
}

/** Effacer depuis la grille : le message de Suppr, « … effacé ». */
function askClear(quarters: readonly number[], replaces: SeenRecurrence): EntryAction {
    return askErase(quarters, replaces, 'clear');
}

describe('recurrenceAction, cette fois ou les suivantes', () => {
    /** La case telle qu'elle s'ouvre, sur cette journée, ce mardi. */
    function onDay(base: EntryAction, target: EntryTarget, day: DayState, draft = initialRecurrence(target, day)) {
        return recurrenceAction(base, target, draft, initialRecurrence(target, day), day, TUESDAY);
    }

    it('demande quelles fois changer un autre commentaire, aujourd’hui comme un jour à venir où la fois n’est que prévue', () => {
        const base = saveEntry(daily, { ticket: 'OPS-12', comment: 'Rétro' });
        const changes = fill([minutes('09:15')], work('OPS-12', 'Rétro'));
        const asked = {
            kind: 'ask',
            question: 'modify',
            once: { kind: 'write', changes, gesture: null },
            following: {
                kind: 'recurrence',
                changes,
                rule: ruleOf(WEEK, '2026-11-04'),
                replaces: SEEN_DAILY,
                gesture: null,
            },
        };

        expect(onDay(base, daily, dayOf())).toEqual(asked);
        expect(onDay(base, daily, dayOf(GRID, WEDNESDAY))).toEqual(asked);
    });

    it('demande quelles fois arrêter la case décochée sur un autre ticket : les deux écrivent le ticket tapé, sans lien', () => {
        const base = saveEntry(daily, { ticket: 'OPS-13', comment: '' });
        const changes = fill([minutes('09:15')], work('OPS-13'));

        expect(onDay(base, daily, dayOf(), { ...on(WEEK, '2026-11-04'), on: false })).toEqual({
            kind: 'ask',
            question: 'stop',
            once: { kind: 'write', changes, gesture: null },
            following: { kind: 'recurrence', changes, rule: null, replaces: SEEN_DAILY, gesture: null },
        });
    });

    it('ne demande rien quand ses jours ou sa fin changent, un autre commentaire compris : la récurrence change à partir de cette fois', () => {
        const base = saveEntry(daily, { ticket: 'OPS-12', comment: 'Rétro' });
        const changes = fill([minutes('09:15')], work('OPS-12', 'Rétro'));

        expect(onDay(base, daily, dayOf(), on([2, 4], '2026-11-04'))).toEqual({
            kind: 'recurrence',
            changes,
            rule: ruleOf([2, 4], '2026-11-04'),
            replaces: SEEN_DAILY,
            gesture: null,
        });
        expect(onDay(base, daily, dayOf(GRID, WEDNESDAY), on(WEEK, '2026-12-31'))).toEqual({
            kind: 'recurrence',
            changes,
            rule: ruleOf(WEEK, '2026-12-31'),
            replaces: SEEN_DAILY,
            gesture: null,
        });
        // Sa fin seule, sur le même bloc.
        expect(onDay(saveEntry(daily, draftOf(daily)), daily, dayOf(), on(WEEK))).toEqual({
            kind: 'recurrence',
            changes: fill([minutes('09:15')], work('OPS-12', 'Daily')),
            rule: ruleOf(WEEK),
            replaces: SEEN_DAILY,
            gesture: null,
        });
    });

    it('remplace avec les suivantes la récurrence telle que la case l’a montrée, même changée depuis', () => {
        const draft: RecurrenceDraft = { ...on(WEEK, '2026-11-04'), seen: { ...SEEN_DAILY, until: null } };
        const asked = onDay(saveEntry(daily, { ticket: 'OPS-13', comment: 'Daily' }), daily, dayOf(), draft);

        expect(asked).toMatchObject({
            kind: 'ask',
            question: 'modify',
            following: { replaces: { id: 'daily', weekdays: WEEK, until: null } },
        });
    });

    it('change la fois entière d’une fois posée en partie, quelle que soit la réponse : avec les suivantes, le serveur emporte l’autre morceau', () => {
        const piece = editAt('15:00', EDGES);
        const opened = fill([minutes('15:00'), minutes('15:15')], work('OPS-12', 'Rétro'));
        const whole = fill([minutes('15:00'), minutes('15:15'), minutes('15:45')], work('OPS-12', 'Rétro'));

        expect(onDay(saveEntry(piece, { ticket: 'OPS-12', comment: 'Rétro' }), piece, edgesOn())).toEqual({
            kind: 'ask',
            question: 'modify',
            once: { kind: 'write', changes: whole, gesture: null },
            following: {
                kind: 'recurrence',
                changes: opened,
                rule: ruleOf(WEEK),
                replaces: SEEN_STANDUP,
                gesture: null,
            },
        });
        // Depuis l'autre morceau, un jour à venir : la même fois.
        const other = editAt('15:45', EDGES);
        expect(
            onDay(saveEntry(other, { ticket: 'OPS-12', comment: 'Rétro' }), other, edgesOn(WEDNESDAY)),
        ).toMatchObject({ kind: 'ask', question: 'modify', once: { changes: whole } });
    });

    it('arrête seulement le morceau ouvert, cette fois : le serveur détache déjà la fois entière', () => {
        const piece = editAt('15:45', EDGES);
        const changes = fill([minutes('15:45')], work('OPS-12', 'Stand-up'));

        expect(onDay(saveEntry(piece, draftOf(piece)), piece, edgesOn(), { ...on(WEEK), on: false })).toEqual({
            kind: 'ask',
            question: 'stop',
            once: { kind: 'write', changes, gesture: null },
            following: { kind: 'recurrence', changes, rule: null, replaces: SEEN_STANDUP, gesture: null },
        });
    });

    it('efface la fois entière en vidant le ticket d’un morceau', () => {
        const piece = editAt('15:45', EDGES);

        expect(onDay(saveEntry(piece, { ticket: '', comment: '' }), piece, edgesOn())).toEqual(
            askErase([minutes('15:00'), minutes('15:15'), minutes('15:45')], SEEN_STANDUP),
        );
    });

    it('demande aussi aux bornes de la journée, à 07:00 et de 19:45 à 20:00', () => {
        const early = editAt('07:00', EDGES);
        const late = editAt('19:45', EDGES);
        const seenEdge = (id: string): SeenRecurrence => ({ id, weekdays: WEEK, until: null });

        expect(onDay(saveEntry(early, draftOf(early)), early, edgesOn(), { ...on(WEEK), on: false })).toEqual({
            kind: 'ask',
            question: 'stop',
            once: { kind: 'write', changes: fill([Quarter.FIRST], PAUSE), gesture: null },
            following: {
                kind: 'recurrence',
                changes: fill([Quarter.FIRST], PAUSE),
                rule: null,
                replaces: seenEdge('early'),
                gesture: null,
            },
        });
        const evening = fill([Quarter.LAST], work('OPS-7', 'Revue'));
        expect(onDay(saveEntry(late, { ticket: 'OPS-7', comment: 'Revue' }), late, edgesOn(WEDNESDAY))).toEqual({
            kind: 'ask',
            question: 'modify',
            once: { kind: 'write', changes: evening, gesture: null },
            following: {
                kind: 'recurrence',
                changes: evening,
                rule: ruleOf(WEEK),
                replaces: seenEdge('late'),
                gesture: null,
            },
        });
        expect(onDay(saveEntry(late, { ticket: '', comment: '' }), late, edgesOn())).toEqual(
            askErase([Quarter.LAST], seenEdge('late')),
        );
    });

    it('ne demande rien sur un bloc dont la récurrence ne va plus jusqu’à ce jour', () => {
        // Arrêtée la veille depuis un autre onglet, pas encore relue sans son lien.
        const ended = dayOf(GRID, TUESDAY, [{ ...DAILY, until: '2026-10-05' }, LUNCH]);
        const other = saveEntry(daily, { ticket: 'OPS-13', comment: 'Daily' });
        const emptied = saveEntry(daily, { ticket: '', comment: '' });

        expect(initialRecurrence(daily, ended)?.on).toBe(false);
        expect(onDay(other, daily, ended)).toBe(other);
        expect(onDay(emptied, daily, ended)).toBe(emptied);
    });
});

describe('eraseAction', () => {
    it('demande quelles fois effacer un bloc qui revient, aujourd’hui comme un jour à venir', () => {
        const asked = askErase([minutes('09:15')], SEEN_DAILY);

        expect(eraseAction(daily, dayOf(), TUESDAY)).toEqual(asked);
        expect(eraseAction(daily, dayOf(GRID, WEDNESDAY), TUESDAY)).toEqual(asked);
    });

    it('efface une pause qui revient en entier, ses quatre quarts d’heure', () => {
        const lunchQuarters = Quarter.between(minutes('12:30'), minutes('13:30'));

        expect(eraseAction(lunch, dayOf(), TUESDAY)).toEqual(askErase(lunchQuarters, SEEN_LUNCH));
    });

    it('efface la fois entière, ses deux morceaux, quelle que soit la réponse', () => {
        const occurrence = [minutes('15:00'), minutes('15:15'), minutes('15:45')];

        expect(eraseAction(editAt('15:45', EDGES), edgesOn(), TUESDAY)).toEqual(askErase(occurrence, SEEN_STANDUP));
        expect(eraseAction(editAt('15:00', EDGES), edgesOn(WEDNESDAY), TUESDAY)).toEqual(
            askErase(occurrence, SEEN_STANDUP),
        );
    });

    it('demande aussi aux bornes de la journée, à 07:00 et de 19:45 à 20:00', () => {
        expect(eraseAction(editAt('07:00', EDGES), edgesOn(WEDNESDAY), TUESDAY)).toEqual(
            askErase([Quarter.FIRST], { id: 'early', weekdays: WEEK, until: null }),
        );
        expect(eraseAction(editAt('19:45', EDGES), edgesOn(), TUESDAY)).toEqual(
            askErase([Quarter.LAST], { id: 'late', weekdays: WEEK, until: null }),
        );
    });

    it('efface cette fois seulement d’un jour passé, un bloc ordinaire, Nouveau ticket, ou un bloc dont la récurrence a fini', () => {
        const ended = dayOf(GRID, TUESDAY, [{ ...DAILY, until: '2026-10-05' }, LUNCH]);

        expect(eraseAction(daily, dayOf(), WEDNESDAY)).toEqual(deleteEntry(daily));
        expect(eraseAction(shop, dayOf(), TUESDAY)).toEqual(deleteEntry(shop));
        expect(eraseAction(pause, dayOf(), TUESDAY)).toEqual(deleteEntry(pause));
        expect(eraseAction(fresh, dayOf(), TUESDAY)).toEqual(deleteEntry(fresh));
        expect(eraseAction(daily, ended, TUESDAY)).toEqual(deleteEntry(daily));
    });
});

describe('selectionErase', () => {
    it('demande quelles fois effacer quand la sélection couvre une fois entière, et rien d’autre', () => {
        expect(selectionErase(dayOf(), [minutes('09:15')], TUESDAY)).toEqual({
            target: daily,
            action: askClear([minutes('09:15')], SEEN_DAILY),
        });
        const lunchQuarters = Quarter.between(minutes('12:30'), minutes('13:30'));
        expect(selectionErase(dayOf(GRID, WEDNESDAY), lunchQuarters, TUESDAY)).toEqual({
            target: lunch,
            action: askClear(lunchQuarters, SEEN_LUNCH),
        });
    });

    it('la demande avec des créneaux vides en plus, qui s’effacent avec elle sans rien changer', () => {
        const quarters = [minutes('09:00'), minutes('09:15'), minutes('09:30'), minutes('09:45')];

        expect(selectionErase(dayOf(), quarters, TUESDAY)).toEqual({
            target: daily,
            action: askClear(quarters, SEEN_DAILY),
        });
    });

    it('ne demande rien pour une partie de la fois, un bloc ordinaire en plus, deux récurrences, ou rien de saisi', () => {
        const day = dayOf();

        expect(selectionErase(day, [minutes('12:30'), minutes('12:45')], TUESDAY)).toBeNull();
        expect(selectionErase(day, [minutes('09:15'), minutes('10:00')], TUESDAY)).toBeNull();
        expect(selectionErase(day, [minutes('10:00'), minutes('09:15')], TUESDAY)).toBeNull();
        expect(
            selectionErase(day, [minutes('09:15'), ...Quarter.between(minutes('12:30'), minutes('13:30'))], TUESDAY),
        ).toBeNull();
        expect(selectionErase(day, [minutes('10:00')], TUESDAY)).toBeNull();
        expect(selectionErase(day, [minutes('09:00'), minutes('14:00')], TUESDAY)).toBeNull();
        expect(selectionErase(day, [], TUESDAY)).toBeNull();
    });

    it('ne demande rien d’un jour passé, ni sur un bloc dont la récurrence ne va plus jusqu’à ce jour', () => {
        const ended = dayOf(GRID, TUESDAY, [{ ...DAILY, until: '2026-10-05' }, LUNCH]);

        expect(selectionErase(dayOf(), [minutes('09:15')], WEDNESDAY)).toBeNull();
        expect(selectionErase(ended, [minutes('09:15')], TUESDAY)).toBeNull();
    });

    it('couvre une fois posée en deux morceaux, sélectionnés sans le quart d’heure saisi entre eux', () => {
        const occurrence = [minutes('15:00'), minutes('15:15'), minutes('15:45')];

        expect(selectionErase(edgesOn(), occurrence, TUESDAY)).toEqual({
            target: editAt('15:00', EDGES),
            action: askClear(occurrence, SEEN_STANDUP),
        });
        // Le quart d'heure saisi entre eux en plus, ou un seul morceau : cette fois seulement.
        expect(selectionErase(edgesOn(), Quarter.between(minutes('15:00'), minutes('16:00')), TUESDAY)).toBeNull();
        expect(selectionErase(edgesOn(), [minutes('15:00'), minutes('15:15')], TUESDAY)).toBeNull();
        expect(selectionErase(edgesOn(), [minutes('15:45')], TUESDAY)).toBeNull();
    });

    it('demande aussi aux bornes de la journée, à 07:00 et de 19:45 à 20:00', () => {
        expect(selectionErase(edgesOn(), [Quarter.FIRST], TUESDAY)).toEqual({
            target: editAt('07:00', EDGES),
            action: askClear([Quarter.FIRST], { id: 'early', weekdays: WEEK, until: null }),
        });
        // Le créneau vide d'avant, en plus.
        const evening = [Quarter.LAST - Quarter.MINUTES, Quarter.LAST];
        expect(selectionErase(edgesOn(WEDNESDAY), evening, TUESDAY)).toEqual({
            target: editAt('19:45', EDGES),
            action: askClear(evening, { id: 'late', weekdays: WEEK, until: null }),
        });
    });
});

/** Le Daily du mardi, à un autre rythme : ce que la case montre à l'ouverture de son bloc. */
function dailyAt(rhythm: Rhythm, date = TUESDAY): DayState {
    return dayOf(GRID, date, [{ ...DAILY, rhythm }, LUNCH]);
}

describe('la case, à chaque rythme', () => {
    const seenAs = (weekdays: readonly number[]): SeenRecurrence => ({ ...SEEN_DAILY, weekdays });

    it('s’ouvre sur la carte du bloc qui revient : une semaine sur n, ses jours et son n', () => {
        // « Jusqu'au » montre sa dernière fois avant le 4 novembre : le jeudi 29 octobre.
        expect(initialRecurrence(daily, dailyAt(weekly([2, 4], 3)))).toEqual({
            ...on([2, 4], '2026-10-29'),
            pace: 'every',
            everyWeeks: 3,
            seen: seenAs([2, 4]),
            seenRhythm: weekly([2, 4], 3),
            seenUntil: '2026-10-29',
        });
    });

    it('s’ouvre sur « Chaque mois », le choix du bloc coché : son rang, sa date, ou le dernier', () => {
        const monthly = (rhythm: Rhythm, date = TUESDAY) => initialRecurrence(daily, dailyAt(rhythm, date));

        // Le premier mardi : sa dernière fois avant le 4 novembre est le 3.
        expect(monthly(monthlyWeekday(2, 1))).toEqual({
            ...on([2], '2026-11-03'),
            pace: 'month',
            month: 'rank',
            seen: seenAs([2]),
            seenRhythm: monthlyWeekday(2, 1),
            seenUntil: '2026-11-03',
        });
        expect(monthly(monthlyDate(6))).toMatchObject({ pace: 'month', month: 'date', weekdays: [2] });
        // Le mardi 27 octobre est le dernier du mois.
        expect(monthly(monthlyWeekday(2, LAST_WEEK), '2026-10-27')).toMatchObject({
            pace: 'month',
            month: 'last',
            weekdays: [2],
        });
        // Un samedi non travaillé : sa date seule, et aucun jour coché pour la semaine.
        expect(monthly(monthlyDate(10), SATURDAY)).toMatchObject({ pace: 'month', month: 'date', weekdays: [] });
    });

    it('passe d’une carte à l’autre sans perdre les jours ni le « une semaine sur »', () => {
        const every = initialRecurrence(daily, dailyAt(weekly([2, 4], 3)));
        if (every === null) {
            throw new Error('Le bloc a sa case.');
        }
        const monthly: RecurrenceDraft = { ...every, pace: 'month' };

        expect(draftRhythm(monthly, TUESDAY, WEEK)).toEqual(monthlyWeekday(2, 1));
        expect(draftRhythm({ ...monthly, pace: 'week' }, TUESDAY, WEEK)).toEqual(weekly([2, 4]));
        expect(draftRhythm({ ...monthly, pace: 'every' }, TUESDAY, WEEK)).toEqual(weekly([2, 4], 3));
        // Chaque changement de carte est un rythme changé, et revenir à la sienne n'en est plus un.
        expect(recurrenceChanged(monthly, every, TUESDAY, WEEK)).toBe(true);
        expect(recurrenceChanged({ ...monthly, pace: 'week' }, every, TUESDAY, WEEK)).toBe(true);
        expect(recurrenceChanged({ ...monthly, pace: 'every' }, every, TUESDAY, WEEK)).toBe(false);
    });

    it('coche d’avance le premier jour du mois proposé : le rang, ou la date au 5e jour de la semaine', () => {
        expect(initialRecurrence(fresh, dayOf(GRID, TUESDAY))?.month).toBe('rank');
        // Le mardi 27, 4e et dernier : le rang d'abord.
        expect(initialRecurrence(fresh, dayOf(GRID, '2026-10-27'))?.month).toBe('rank');
        // Le jeudi 29, 5e : sa date, le dernier restant proposé.
        expect(initialRecurrence(fresh, dayOf(GRID, '2026-10-29'))?.month).toBe('date');
        expect(draftRhythm({ ...on([]), pace: 'month', month: 'date' }, '2026-10-29', WEEK)).toEqual(monthlyDate(29));
        expect(draftRhythm({ ...on([]), pace: 'month', month: 'last' }, '2026-10-29', WEEK)).toEqual(
            monthlyWeekday(4, LAST_WEEK),
        );
    });

    it('prend le premier choix quand le jour du bloc ne permet pas celui de la case', () => {
        // Le mardi 6 n'est pas le dernier du mois ; le jeudi 29 n'a pas de rang.
        expect(draftRhythm({ ...on([2]), pace: 'month', month: 'last' }, TUESDAY, WEEK)).toEqual(monthlyWeekday(2, 1));
        expect(draftRhythm({ ...on([4]), pace: 'month', month: 'rank' }, '2026-10-29', WEEK)).toEqual(monthlyDate(29));
    });

    it('garde le rang ou « le dernier » d’une récurrence dont le jour n’est plus travaillé, tant qu’on ne le change pas', () => {
        // Le 1er mardi du mois, puis le mardi décoché des réglages : la case ne propose plus que
        // la date, mais la récurrence garde son rythme, comme ses jours de la semaine gardés.
        const noTuesday = [1, 3, 4, 5];
        const firstTuesday = { ...dailyAt(monthlyWeekday(2, 1)), workingDays: noTuesday };
        const draft = initialRecurrence(daily, firstTuesday);
        if (draft === null) {
            throw new Error('Le bloc a sa case.');
        }

        expect(draft).toMatchObject({ pace: 'month', month: 'rank' });
        expect(draftRhythm(draft, TUESDAY, noTuesday)).toEqual(monthlyWeekday(2, 1));
        expect(monthChoices(draft, TUESDAY, noTuesday)).toEqual([monthlyWeekday(2, 1), monthlyDate(6)]);
        expect(recurrenceChanged(draft, draft, TUESDAY, noTuesday)).toBe(false);
        expect(recurrenceAction(saveEntry(daily, draftOf(daily)), daily, draft, draft, firstTuesday, TUESDAY)).toEqual({
            kind: 'close',
        });
        // Choisir la date, puis revenir au rang : il reste proposé, puisque c'est le sien.
        expect(draftRhythm({ ...draft, month: 'date' }, TUESDAY, noTuesday)).toEqual(monthlyDate(6));
        expect(draftRhythm({ ...draft, month: 'date' }, TUESDAY, noTuesday)).not.toEqual(draft.seenRhythm);

        // Le dernier mardi, le 27 octobre : gardé de même.
        const lastTuesday = { ...dailyAt(monthlyWeekday(2, LAST_WEEK), '2026-10-27'), workingDays: noTuesday };
        const last = initialRecurrence(daily, lastTuesday);
        expect(last === null ? null : draftRhythm(last, '2026-10-27', noTuesday)).toEqual(monthlyWeekday(2, LAST_WEEK));
        // Une récurrence qu'on crée ce jour-là n'a que sa date : un rang y tomberait un jour non travaillé.
        expect(monthChoices({ ...on([]), pace: 'month' }, TUESDAY, noTuesday)).toEqual([monthlyDate(6)]);
    });

    it('ne grise rien sans jour en « Chaque mois » : la date décide, les jours ne s’y montrent pas', () => {
        const monthly: RecurrenceDraft = { ...on([]), pace: 'month' };

        expect(noDayChosen(monthly, WEEK)).toBe(false);
        expect(noDayChosen({ ...monthly, pace: 'every' }, WEEK)).toBe(true);
        expect(saveBlocked(shop, draftOf(shop), monthly, OFF, TUESDAY, WEEK)).toBe(false);
        expect(readRule(monthly, TUESDAY, TUESDAY, WEEK, TUESDAY)).toEqual({
            rule: { ...monthlyWeekday(2, 1), until: null },
        });
    });

    it('rend la règle entière à envoyer, quel que soit le rythme', () => {
        const read = (draft: RecurrenceDraft, date = TUESDAY) => readRule(draft, date, date, WEEK, TUESDAY);

        expect(read({ ...on([4, 2], '2026-12-31'), pace: 'every', everyWeeks: 3 })).toEqual({
            rule: { ...weekly([2, 4], 3), until: '2026-12-31' },
        });
        // « Chaque semaine » ne garde pas le « une semaine sur » d'une autre carte.
        expect(read({ ...on([2]), everyWeeks: 3 })).toEqual({ rule: ruleOf([2]) });
        expect(read({ ...on([2]), pace: 'month', month: 'date' })).toEqual({
            rule: { ...monthlyDate(6), until: null },
        });
        expect(read({ ...on([2]), pace: 'month', month: 'last' }, '2026-10-27')).toEqual({
            rule: { ...monthlyWeekday(2, LAST_WEEK), until: null },
        });
        expect(read({ ...on([2]), pace: 'month', month: 'date', until: '2026-10-05' })).toEqual({
            weekdays: null,
            until: 'Choisissez un jour à partir du mardi 6 octobre.',
        });
    });

    it('reprend après un refus le rythme posé ailleurs quand on ne l’a pas retouché, et garde celui qu’on a réglé', () => {
        // La case montrait un mardi sur deux ; la récurrence revient désormais le mardi et le jeudi.
        const untouched: RecurrenceDraft = {
            ...on([2], '2026-11-04'),
            pace: 'every',
            seen: seenAs([2]),
            seenRhythm: weekly([2], 2),
        };
        // « Jusqu'au » non touché suit la récurrence : sa dernière fois, le mardi 3 novembre.
        expect(seenAgain(untouched, daily, dailyAt(weekly([2, 4])))).toEqual({
            ...on([2, 4], '2026-11-03'),
            seen: seenAs([2, 4]),
            seenRhythm: weekly([2, 4]),
            seenUntil: '2026-11-03',
        });

        // Passée à « Chaque mois » : ce qu'on a réglé reste.
        const touched: RecurrenceDraft = { ...untouched, pace: 'month', month: 'date' };
        expect(seenAgain(touched, daily, dailyAt(weekly([2, 4])))).toEqual({
            ...touched,
            // Sa fin, elle, n'a pas été touchée : elle suit.
            until: '2026-11-03',
            seen: seenAs([2, 4]),
            seenRhythm: weekly([2, 4]),
            seenUntil: '2026-11-03',
        });
    });
});

describe('recurrenceFirstDay', () => {
    const thursday = '2026-10-08';

    it('part du jour du bloc pour une récurrence qu’on crée, même d’un jour passé', () => {
        expect(recurrenceFirstDay(on([2]), null, TUESDAY, TUESDAY, WEEK)).toBe(TUESDAY);
        expect(recurrenceFirstDay(on([2]), null, TUESDAY, thursday, WEEK)).toBe(TUESDAY);
    });

    it('part du jour du bloc pour un rythme changé, ou de demain d’un jour passé', () => {
        expect(recurrenceFirstDay(on([2, 4]), DAILY, TUESDAY, TUESDAY, WEEK)).toBe(TUESDAY);
        expect(recurrenceFirstDay({ ...on(WEEK), pace: 'every' }, DAILY, TUESDAY, TUESDAY, WEEK)).toBe(TUESDAY);
        expect(recurrenceFirstDay(on([2, 4]), DAILY, TUESDAY, thursday, WEEK)).toBe('2026-10-09');
    });

    it('garde le sien quand seule sa fin change', () => {
        expect(recurrenceFirstDay(on(WEEK, '2026-12-31'), DAILY, TUESDAY, TUESDAY, WEEK)).toBe('2026-10-05');
        expect(recurrenceFirstDay(on(WEEK), DAILY, TUESDAY, thursday, WEEK)).toBe('2026-10-05');
    });
});

/** Jeudi 22 octobre 2026 : la démo de sprint s'y règle, de 14:00 à 15:00. */
const THURSDAY = '2026-10-22';
const AFTERNOON = { start: minutes('14:00'), end: minutes('15:00') };

function other(id: string, rhythm: Rhythm, firstDay: string, comment: string, until: string | null = null): Recurrence {
    return {
        id,
        ...AFTERNOON,
        rhythm,
        firstDay,
        until,
        content: { kind: 'work', ticket: 'OPS-7', comment },
    };
}

/** La rétrospective, un jeudi sur deux depuis le 15 : le 29, le 12 novembre… */
const RETRO = other('r-retro', weekly([4], 2), '2026-10-15', 'Rétrospective');
/** Une autre, les jeudis où la rétrospective ne revient pas, à partir du 5 novembre. */
const THIRD = other('r-tiers', weekly([4], 2), '2026-11-05', 'Revue');
const EVERY_THURSDAY = other('r-jeudi', weekly([4]), '2026-10-01', 'Point');
const DEPENDENCIES = other('r-dependances', monthlyWeekday(4, 4), '2026-10-22', 'Dépendances');

/** Ce que la fenêtre du jeudi sait : son jour, les jours travaillés, les récurrences lues. */
function thursdayWith(...ongoing: Recurrence[]): DayState {
    return {
        ...dayOf(gridOf([['14:00', '15:00', 'work', 'OPS-9', 'Démo']]), THURSDAY, []),
        ongoing: new Map(ongoing.map((recurrence) => [recurrence.id, recurrence])),
    };
}

function clashOf(draft: RecurrenceDraft, day: DayState, linked: Recurrence | null = null, today = THURSDAY) {
    return draftClash(draft, linked, day, today, AFTERNOON.start, AFTERNOON.end);
}

describe('draftClash', () => {
    it('refuse chaque jeudi face à un jeudi sur deux, et propose d’alterner les semaines libres', () => {
        const clash = clashOf(on([4]), thursdayWith(RETRO));

        expect(clash?.recurrence).toBe(RETRO);
        expect(clash?.alternate).toEqual({ ...on([4]), pace: 'every', everyWeeks: 2 });
        // Alternée, elle ne prend plus rien.
        expect(clashOf(clash?.alternate ?? on([4]), thursdayWith(RETRO))).toBeNull();
    });

    it('marque « Pris » chaque fois que l’autre prend, et seulement elles', () => {
        const clash = clashOf(on([4]), thursdayWith(RETRO, EVERY_THURSDAY));
        const quarterPast = other('r-tard', weekly([4]), '2026-10-01', 'Tard');

        expect(clash?.takenOn('2026-10-29')).toBe(RETRO);
        expect(clash?.takenOn('2026-11-05')).toBe(EVERY_THURSDAY);
        expect(clashOf(on([4]), thursdayWith(RETRO))?.takenOn('2026-11-05')).toBeNull();
        expect(clashOf(on([4]), thursdayWith(RETRO))?.takenOn('2026-11-12')).toBe(RETRO);
        // Une autre plage ne prend rien de ce créneau.
        expect(
            clashOf(
                on([4]),
                thursdayWith(RETRO, { ...quarterPast, start: minutes('15:00'), end: minutes('16:00') }),
            )?.takenOn('2026-11-05'),
        ).toBeNull();
    });

    it('nomme celle qui prend le créneau le plus tôt après aujourd’hui', () => {
        expect(clashOf(on([4]), thursdayWith(THIRD, RETRO))?.recurrence).toBe(RETRO);
        // Le 29 octobre passé, la revue du 5 novembre vient d'abord.
        expect(clashOf(on([4]), thursdayWith(THIRD, RETRO), null, '2026-10-29')?.recurrence).toBe(THIRD);
    });

    it('ne propose pas d’alterner face à une récurrence de chaque semaine', () => {
        const clash = clashOf(on([4]), thursdayWith(EVERY_THURSDAY));

        expect(clash?.recurrence).toBe(EVERY_THURSDAY);
        expect(clash?.alternate).toBeNull();
    });

    it('ne propose pas d’alterner face à un rythme mensuel, ni depuis « Chaque mois »', () => {
        const facing = clashOf(on([4]), thursdayWith(DEPENDENCIES));
        expect(facing?.recurrence).toBe(DEPENDENCIES);
        expect(facing?.alternate).toBeNull();

        const monthly = clashOf({ ...on([4]), pace: 'month', month: 'rank' }, thursdayWith(RETRO));
        // Le 4e jeudi de novembre, le 26, est un jeudi de la rétrospective.
        expect(monthly?.recurrence).toBe(RETRO);
        expect(monthly?.alternate).toBeNull();
    });

    it('ne propose pas d’alterner si l’alternance tomberait sur une troisième', () => {
        const clash = clashOf(on([4]), thursdayWith(RETRO, THIRD));

        expect(clash?.recurrence).toBe(RETRO);
        expect(clash?.alternate).toBeNull();
    });

    it('ne propose pas d’alterner quand l’autre revient la semaine du bloc', () => {
        // Le bloc est le jeudi 29, un jeudi de la rétrospective : alternée, elle compterait depuis lui.
        const day = { ...thursdayWith(RETRO), date: '2026-10-29' };

        expect(draftClash(on([4]), null, day, '2026-10-28', AFTERNOON.start, AFTERNOON.end)?.alternate).toBeNull();
    });

    it('propose d’alterner une semaine sur deux à plusieurs jours, ses jours gardés', () => {
        const clash = clashOf({ ...on([1, 4]), pace: 'every', everyWeeks: 3 }, thursdayWith(RETRO));

        expect(clash?.recurrence).toBe(RETRO);
        expect(clash?.alternate).toEqual({ ...on([1, 4]), pace: 'every', everyWeeks: 2 });
    });

    it('ne dit rien quand le créneau est libre, ou que l’autre y revient d’autres heures ou d’autres jours', () => {
        expect(clashOf(on([4]), thursdayWith())).toBeNull();
        expect(clashOf(on([1, 3]), thursdayWith(RETRO, EVERY_THURSDAY))).toBeNull();
        expect(clashOf(on([4]), thursdayWith({ ...RETRO, start: minutes('15:00'), end: minutes('15:15') }))).toBeNull();
        expect(clashOf(on([4], '2026-10-28'), thursdayWith(RETRO))).toBeNull();
    });

    it('ne compte pas un conflit qui ne tomberait que ce jour-là ou avant', () => {
        // Le point de chaque jeudi revient aujourd'hui même : une récurrence d'un seul jour ne prend rien après.
        expect(clashOf(on([4], THURSDAY), thursdayWith(EVERY_THURSDAY))).toBeNull();
        expect(clashOf(on([4], '2026-10-29'), thursdayWith(EVERY_THURSDAY))?.recurrence).toBe(EVERY_THURSDAY);
    });

    it('ne juge rien d’une case décochée ou sans jour', () => {
        const day = thursdayWith(RETRO);

        expect(clashOf(off([4]), day)).toBeNull();
        expect(clashOf(on([]), day)).toBeNull();
    });

    it('lit une date commencée ou illisible comme la phrase et les prochaines fois : sans fin', () => {
        const day = thursdayWith(RETRO);

        expect(draftUntil({ ...on([4], '2026-11-04'), incomplete: true })).toBeNull();
        expect(draftUntil(on([4], '20266-12-31'))).toBeNull();
        expect(draftUntil(on([4], '2026-10-01'))).toBe('2026-10-01');
        expect(clashOf({ ...on([4]), incomplete: true }, day)?.recurrence).toBe(RETRO);
        expect(clashOf(on([4], '20266-12-31'), day)?.recurrence).toBe(RETRO);
        // Avant le premier jour, telle qu'elle est tapée : aucune fois, rien de pris.
        expect(clashOf(on([4], '2026-10-01'), day)).toBeNull();
    });

    it('ne compte pas une fois détachée ou effacée de l’autre, mais la même phase plus loin, si', () => {
        // Un jeudi sur deux jusqu'au 29 octobre, sa fois du 29 effacée : plus rien ne prend le créneau.
        const ending = {
            ...other('r-fin', weekly([4], 2), '2026-10-15', 'Fin', '2026-10-29'),
            skipped: ['2026-10-29'],
        };
        expect(clashOf(on([4]), thursdayWith(ending))).toBeNull();
        expect(clashOf(on([4]), thursdayWith({ ...ending, skipped: [] }))?.recurrence.id).toBe('r-fin');

        // Sans fin, sa fois du 29 effacée : celle du 12 novembre prend encore le créneau.
        const skipping = { ...RETRO, skipped: ['2026-10-29'] };
        const clash = clashOf(on([4]), thursdayWith(skipping));
        expect(clash?.recurrence).toBe(skipping);
        expect(clash?.takenOn('2026-10-29')).toBeNull();
        expect(clash?.takenOn('2026-11-12')).toBe(skipping);
    });

    describe('sur le bloc d’une récurrence', () => {
        /** La démo, chaque jeudi jusqu'au 31 décembre : née avant le refus, elle croise la rétrospective. */
        const DEMO = other('r-demo', weekly([4]), '2026-10-01', 'Démo', '2026-12-31');
        const day = { ...thursdayWith(DEMO, RETRO), recurrences: new Map([[DEMO.id, DEMO]]) };

        it('ne dit rien quand seule sa fin avance, ou ne change pas', () => {
            expect(clashOf(on([4], '2026-12-31'), day, DEMO)).toBeNull();
            expect(clashOf(on([4], '2026-11-30'), day, DEMO)).toBeNull();
        });

        it('juge une fin repoussée, ou retirée, sur ce qu’elle prendrait de plus', () => {
            expect(clashOf(on([4], '2027-01-31'), day, DEMO)?.recurrence).toBe(RETRO);
            expect(clashOf(on([4]), day, DEMO)?.recurrence).toBe(RETRO);
        });

        it('juge une fin repoussée avec ses propres fois sautées, qui ne prennent rien', () => {
            // Une revue d'un seul jeudi, le 7 janvier ; la démo, sa fois du 7 janvier effacée.
            const january = other('r-janvier', weekly([4]), '2027-01-07', 'Janvier', '2027-01-07');
            const skipping = { ...DEMO, skipped: ['2027-01-07'] };
            const days = (demo: Recurrence) => ({
                ...thursdayWith(demo, january),
                recurrences: new Map([[demo.id, demo]]),
            });

            expect(clashOf(on([4], '2027-01-31'), days(DEMO), DEMO)?.recurrence).toBe(january);
            expect(clashOf(on([4], '2027-01-31'), days(skipping), skipping)).toBeNull();
            // Un rythme changé en fait naître une autre, sans ses fois sautées.
            expect(clashOf(on([1, 4], '2027-01-31'), days(skipping), skipping)?.recurrence).toBe(january);
        });

        it('propose d’alterner une fin repoussée, ses semaines comptées depuis le bloc', () => {
            // Chaque jeudi depuis le 1er octobre, une semaine sur deux compterait les jeudis de la
            // rétrospective ; depuis le bloc, le 22, ce sont les autres.
            const clash = clashOf(on([4], '2027-01-31'), day, DEMO);

            expect(clash?.recurrence).toBe(RETRO);
            expect(clash?.alternate).toEqual({ ...on([4], '2027-01-31'), pace: 'every', everyWeeks: 2 });
            expect(clashOf(clash?.alternate ?? on([4]), day, DEMO)).toBeNull();
        });

        it('juge un rythme changé, sans compter la récurrence qu’il remplace', () => {
            // Un jeudi sur deux, depuis le 22 : les jeudis où la rétrospective ne revient pas.
            expect(clashOf({ ...on([4]), pace: 'every' }, day, DEMO)).toBeNull();
            expect(clashOf({ ...on([4]), pace: 'every' }, thursdayWith(DEMO, THIRD), DEMO)?.recurrence).toBe(THIRD);
            expect(clashOf({ ...on([3, 4], '2026-12-31') }, thursdayWith(DEMO), DEMO)).toBeNull();
        });
    });
});

describe('draftSkipped', () => {
    it('garde les fois sautées de la récurrence du bloc tant que son rythme ne change pas', () => {
        const skipping = { ...DAILY, skipped: ['2026-10-08'] };

        expect(draftSkipped(weekly(WEEK), skipping)).toEqual(['2026-10-08']);
        // Un rythme changé en fait naître une autre, qui n'en a pas.
        expect(draftSkipped(weekly([1, 2]), skipping)).toEqual([]);
        expect(draftSkipped(weekly(WEEK), DAILY)).toEqual([]);
        expect(draftSkipped(weekly(WEEK), null)).toEqual([]);
    });
});

describe('alternatingWith', () => {
    const fortnight: RecurrenceDraft = { ...on([4]), pace: 'every', everyWeeks: 2 };
    const alternating = (draft: RecurrenceDraft, ...ongoing: Recurrence[]) =>
        alternatingWith(draft, null, thursdayWith(...ongoing), THURSDAY, AFTERNOON.start, AFTERNOON.end);

    it('dit l’autre qui revient au même créneau les autres semaines, et leurs jours communs', () => {
        expect(alternating(fortnight, RETRO)).toEqual({ recurrence: RETRO, weekdays: [4] });
        expect(alternating({ ...fortnight, weekdays: [1, 4] }, RETRO)).toEqual({ recurrence: RETRO, weekdays: [4] });
    });

    it('se dit aussi dans la fenêtre de l’autre, qui ne se compte pas elle-même', () => {
        const day = thursdayWith(RETRO, THIRD);

        expect(alternatingWith(fortnight, THIRD, day, THURSDAY, AFTERNOON.start, AFTERNOON.end)).toEqual({
            recurrence: RETRO,
            weekdays: [4],
        });
        expect(
            alternatingWith(fortnight, RETRO, thursdayWith(RETRO), THURSDAY, AFTERNOON.start, AFTERNOON.end),
        ).toBeNull();
    });

    it('ne dit rien quand l’autre ne revient pas les autres semaines de sa période, après aujourd’hui', () => {
        // Finie avant : la rétrospective du 15 octobre ne revient plus.
        expect(alternating(fortnight, { ...RETRO, until: '2026-10-21' })).toBeNull();
        // Arrêtée le 28 octobre, la démo ne vit qu'aujourd'hui : aucun jeudi de l'autre dans sa période.
        expect(alternating({ ...fortnight, until: '2026-10-28' }, RETRO)).toBeNull();
        // Les mêmes semaines qu'elle : ce n'est pas une alternance.
        expect(alternating(fortnight, other('r-meme', weekly([4], 2), '2026-10-08', 'Même'))).toBeNull();
        // Sa seule autre fois effacée : elle ne revient plus.
        expect(alternating(fortnight, { ...RETRO, until: '2026-10-29', skipped: ['2026-10-29'] })).toBeNull();
        // Une seule fois de l'autre, la semaine d'après, suffit.
        expect(alternating(fortnight, { ...RETRO, until: '2026-10-29' })).toEqual({
            recurrence: { ...RETRO, until: '2026-10-29' },
            weekdays: [4],
        });
    });

    it('ne dit rien de chaque semaine, d’un autre n, d’autres heures, d’autres jours, d’un mois, ni décochée', () => {
        expect(alternating(on([4]), RETRO)).toBeNull();
        expect(alternating({ ...fortnight, everyWeeks: 3 }, RETRO)).toBeNull();
        expect(alternating(fortnight, { ...RETRO, start: minutes('15:00'), end: minutes('16:00') })).toBeNull();
        expect(alternating({ ...fortnight, weekdays: [1, 3] }, RETRO)).toBeNull();
        expect(alternating(fortnight, EVERY_THURSDAY)).toBeNull();
        expect(alternating(fortnight, DEPENDENCIES)).toBeNull();
        expect(alternating({ ...fortnight, pace: 'month' }, RETRO)).toBeNull();
        expect(alternating({ ...fortnight, on: false }, RETRO)).toBeNull();
    });
});

describe('recurrenceAction, un créneau déjà pris', () => {
    const day = thursdayWith(RETRO);
    const demo = targetAt(day.grid, minutes('14:00'));
    const taken: EntryAction = { kind: 'refuse', weekdays: null, until: null, rhythm: takenRefusal(RETRO) };
    const thursdayAction = (base: EntryAction, target: EntryTarget, draft: RecurrenceDraft, today = THURSDAY) =>
        recurrenceAction(base, target, draft, initialRecurrence(target, day), day, today);

    it('refuse d’enregistrer, sans rien envoyer, sur le bloc comme sur Nouveau ticket', () => {
        const blank: EntryTarget = { kind: 'new', quarters: Quarter.between(AFTERNOON.start, AFTERNOON.end) };
        const empty = thursdayWith(RETRO);

        expect(thursdayAction(saveEntry(demo, draftOf(demo)), demo, on([4]))).toEqual(taken);
        expect(
            recurrenceAction(
                saveEntry(blank, { ticket: 'OPS-9', comment: 'Démo' }),
                blank,
                on([4]),
                initialRecurrence(blank, { ...empty, grid: gridOf([]) }),
                { ...empty, grid: gridOf([]) },
                THURSDAY,
            ),
        ).toEqual(taken);
        expect(thursdayAction(pauseEntry(demo), demo, on([4]))).toEqual(taken);
    });

    it('dit d’abord une fin de travers, sous « Jusqu’au »', () => {
        expect(thursdayAction(saveEntry(demo, draftOf(demo)), demo, on([4], '2026-10-01'))).toEqual({
            kind: 'refuse',
            weekdays: null,
            until: 'Choisissez un jour à partir du jeudi 22 octobre.',
            rhythm: null,
        });
    });

    it('enregistre l’alternance proposée : une semaine sur deux', () => {
        const alternate = clashOf(on([4]), day)?.alternate;
        if (alternate === null || alternate === undefined) {
            throw new Error('L’alternance est proposée.');
        }

        expect(thursdayAction(saveEntry(demo, draftOf(demo)), demo, alternate)).toMatchObject({
            kind: 'recurrence',
            rule: { ...weekly([4], 2), until: null },
            replaces: null,
        });
    });

    it('refuse un rythme changé qui prendrait le créneau, sans rien demander', () => {
        const demoRecurrence = other('r-demo', weekly([4], 2), '2026-10-22', 'Démo');
        const linkedDay: DayState = {
            ...dayOf(gridOf([['14:00', '15:00', 'work', 'OPS-9', 'Démo', 'r-demo']]), THURSDAY, [demoRecurrence]),
            ongoing: new Map([
                [demoRecurrence.id, demoRecurrence],
                [RETRO.id, RETRO],
            ]),
        };
        const block = targetAt(linkedDay.grid, minutes('14:00'));
        const initial = initialRecurrence(block, linkedDay);

        // Chaque jeudi, et plus un sur deux.
        const everyThursday: RecurrenceDraft = { ...(initial ?? on([4])), pace: 'week' };

        expect(
            recurrenceAction(saveEntry(block, draftOf(block)), block, everyThursday, initial, linkedDay, THURSDAY),
        ).toEqual(taken);
        // Avec un autre commentaire, pas de question : le refus d'abord.
        expect(
            recurrenceAction(
                saveEntry(block, { ticket: 'OPS-9', comment: 'Revue' }),
                block,
                everyThursday,
                initial,
                linkedDay,
                THURSDAY,
            ),
        ).toEqual(taken);
        // Décochée, elle s'arrête : rien n'est pris.
        expect(
            recurrenceAction(
                saveEntry(block, draftOf(block)),
                block,
                initial === null ? null : { ...initial, on: false },
                initial,
                linkedDay,
                THURSDAY,
            ),
        ).toMatchObject({ kind: 'ask', question: 'stop' });
    });
});

/** Une récurrence tirée au hasard autour du jeudi : son rythme, ses jours, sa plage. */
const recurrenceArbitrary = (id: string): fc.Arbitrary<Recurrence> =>
    fc
        .record({
            rhythm: fc.oneof(
                fc
                    .tuple(
                        fc.uniqueArray(fc.integer({ min: 1, max: 5 }), { minLength: 1, maxLength: 3 }),
                        fc.integer({ min: 1, max: 4 }),
                    )
                    .map(([days, every]) => weekly(days, every)),
                fc
                    .tuple(fc.integer({ min: 1, max: 5 }), fc.constantFrom(1, 2, 3, 4, LAST_WEEK))
                    .map(([weekday, week]) => monthlyWeekday(weekday, week)),
                fc.integer({ min: 1, max: 31 }).map(monthlyDate),
            ),
            firstDay: fc.integer({ min: -60, max: 60 }).map((shift) => addDays(THURSDAY, shift)),
            length: fc.option(fc.integer({ min: -1, max: 300 }), { nil: null }),
            start: fc.integer({ min: 0, max: 3 }),
            quarters: fc.integer({ min: 1, max: 4 }),
        })
        .map(({ rhythm, firstDay, length, start, quarters }) => ({
            id,
            rhythm,
            firstDay,
            until: length === null ? null : addDays(firstDay, length),
            start: minutes('14:00') + start * 15,
            end: minutes('14:00') + (start + quarters) * 15,
            content: { kind: 'work', ticket: 'OPS-7', comment: id },
        }));

const draftArbitrary: fc.Arbitrary<RecurrenceDraft> = fc.record({
    on: fc.boolean(),
    pace: fc.constantFrom('week' as const, 'every' as const, 'month' as const),
    weekdays: fc
        .uniqueArray(fc.integer({ min: 1, max: 5 }), { maxLength: 3 })
        .map((days) => days.sort((a, b) => a - b)),
    everyWeeks: fc.integer({ min: 2, max: 4 }),
    month: fc.constantFrom('rank' as const, 'date' as const, 'last' as const),
    until: fc.oneof(
        fc.constant(''),
        fc.integer({ min: -3, max: 200 }).map((shift) => addDays(THURSDAY, shift)),
    ),
});

describe('draftClash, comparé à la force brute', () => {
    it('ne laisse jamais enregistrer ce qui croise une autre récurrence lue, et nomme la première', () => {
        const seen = { clashes: 0, alternates: 0 };
        fc.assert(
            fc.property(
                draftArbitrary,
                fc.tuple(recurrenceArbitrary('r-1'), recurrenceArbitrary('r-2'), recurrenceArbitrary('r-3')),
                fc.constantFrom(null, 0, 1, 2),
                fc.integer({ min: -2, max: 2 }),
                fc.integer({ min: 0, max: 3 }),
                fc.integer({ min: 1, max: 4 }),
                // Des jours à venir déjà envoyés, où aucune ne prend plus de créneau.
                fc.uniqueArray(fc.integer({ min: 1, max: 60 }), { maxLength: 4 }),
                (draft, ongoing, linkedAt, shift, start, quarters, sent) => {
                    const today = addDays(THURSDAY, shift);
                    const linked = linkedAt === null ? null : ongoing[linkedAt];
                    const closed = sent.map((ahead) => addDays(THURSDAY, ahead)).filter((date) => date > today);
                    const day: SeenDay = {
                        date: THURSDAY,
                        workingDays: WEEK,
                        ongoing: new Map(ongoing.map((recurrence) => [recurrence.id, recurrence])),
                        settledAhead: new Set(closed),
                    };
                    const range =
                        linked === null
                            ? { start: minutes('14:00') + start * 15, end: minutes('14:00') + (start + quarters) * 15 }
                            : { start: linked.start, end: linked.end };
                    const clash = draftClash(draft, linked, day, today, range.start, range.end);
                    const until = readDate(draft.until);
                    const rhythm = draftRhythm(draft, THURSDAY, WEEK);
                    const others = ongoing.filter((recurrence) => recurrence.id !== linked?.id);
                    const candidate = (judged: RecurrenceDraft): TimedSchedule => ({
                        rhythm: draftRhythm(judged, THURSDAY, WEEK),
                        firstDay: recurrenceFirstDay(judged, linked, THURSDAY, today, WEEK),
                        until: until ?? null,
                        ...range,
                    });
                    // Rien n'est à juger : décochée, sans jour, ou sur son bloc, sa fin seule avancée.
                    const unjudged =
                        !draft.on ||
                        noDayChosen(draft, WEEK) ||
                        (linked !== null &&
                            sameRhythm(rhythm, linked.rhythm) &&
                            (linked.until === null ||
                                (until !== null && until !== undefined && until <= linked.until)));
                    const expected = unjudged ? null : bruteEarliest(candidate(draft), others, today, closed);

                    expect(clash?.recurrence.id ?? null).toBe(expected?.recurrence.id ?? null);
                    if (clash === null) {
                        return;
                    }
                    seen.clashes += 1;
                    seen.alternates += clash.alternate === null ? 0 : 1;
                    // Alterner n'est proposé qu'à une semaine, face à une semaine sur n, et libère le créneau.
                    if (clash.alternate !== null) {
                        expect(rhythm.kind).toBe('weekly');
                        expect(clash.recurrence.rhythm.kind).toBe('weekly');
                        expect(clash.recurrence.rhythm.everyWeeks).toBeGreaterThan(1);
                        expect(draftRhythm(clash.alternate, THURSDAY, WEEK).everyWeeks).toBe(
                            clash.recurrence.rhythm.everyWeeks,
                        );
                        expect(
                            others.filter(
                                (recurrence) =>
                                    bruteClash(candidate(clash.alternate ?? draft), recurrence, today, closed) !== null,
                            ),
                        ).toEqual([]);
                    } else if (
                        clash.recurrence.rhythm.kind === 'weekly' &&
                        rhythm.kind === 'weekly' &&
                        clash.recurrence.rhythm.everyWeeks > 1
                    ) {
                        // Pas proposé face à une semaine sur n : l'alternance prendrait encore un créneau.
                        const alternate: RecurrenceDraft = {
                            ...draft,
                            pace: 'every',
                            everyWeeks: clash.recurrence.rhythm.everyWeeks,
                        };
                        expect(
                            others.some(
                                (recurrence) => bruteClash(candidate(alternate), recurrence, today, closed) !== null,
                            ),
                        ).toBe(true);
                    }
                },
            ),
            { numRuns: 1000 },
        );
        // Des créneaux vraiment pris, et des alternances vraiment proposées.
        expect(seen.clashes).toBeGreaterThan(50);
        expect(seen.alternates).toBeGreaterThan(0);
    });
});

describe('« Jusqu’au » d’une récurrence coupée plus loin', () => {
    /**
     * Le Daily du mardi, coupé par « Cette fois et les suivantes » le mardi 3 novembre : sa fin
     * est la veille, le lundi 2, que personne n'a saisie. Sa dernière fois est le mardi 27 octobre.
     */
    const CUT: Recurrence = { ...DAILY, rhythm: weekly([2]), until: '2026-11-02' };
    const cutDay = (date = TUESDAY): DayState => dayOf(GRID, date, [CUT, LUNCH]);
    const SEEN_CUT: SeenRecurrence = { id: 'daily', weekdays: [2], until: '2026-11-02' };
    const ask = (draft: RecurrenceDraft, day = cutDay(), today = TUESDAY) =>
        recurrenceAction(
            saveEntry(daily, { ticket: 'OPS-12', comment: 'Rétro' }),
            daily,
            draft,
            initialRecurrence(daily, day),
            day,
            today,
        );

    it('montre sa dernière fois, pas la veille de la coupe', () => {
        expect(shownUntil(CUT, WEEK, TUESDAY)).toBe('2026-10-27');
        expect(initialRecurrence(daily, cutDay())).toMatchObject({ until: '2026-10-27', seen: SEEN_CUT });
        // Sans fin, ou finie un jour où elle tombe, rien ne change.
        expect(shownUntil(DAILY, WEEK, TUESDAY)).toBe('2026-11-04');
        expect(shownUntil(LUNCH, WEEK, TUESDAY)).toBeNull();
    });

    it('laissée telle quelle, envoie la fin enregistrée : le serveur n’y voit rien de changé', () => {
        const opened = initialRecurrence(daily, cutDay());
        if (opened === null) {
            throw new Error('Le bloc a sa case.');
        }
        const following = { kind: 'recurrence', rule: { ...weekly([2]), until: '2026-11-02' }, replaces: SEEN_CUT };

        expect(ask(opened)).toMatchObject({ kind: 'ask', question: 'modify', following });
        // Rien de tapé, la case comme à l'ouverture : rien ne part.
        expect(
            recurrenceAction(
                saveEntry(daily, { ticket: 'OPS-12', comment: 'Daily' }),
                daily,
                opened,
                opened,
                cutDay(),
                TUESDAY,
            ),
        ).toEqual({ kind: 'close' });
    });

    it('une autre fin tapée part telle quelle ; un autre rythme finit là où la fenêtre l’a montré', () => {
        const opened = initialRecurrence(daily, cutDay());
        if (opened === null) {
            throw new Error('Le bloc a sa case.');
        }

        // Une fin changée vaut pour la suite, sans question.
        expect(ask({ ...opened, until: '2026-10-20' })).toMatchObject({
            kind: 'recurrence',
            rule: { until: '2026-10-20' },
        });
        expect(ask({ ...opened, weekdays: [2, 4] })).toMatchObject({
            kind: 'recurrence',
            rule: { ...weekly([2, 4]), until: '2026-10-27' },
        });
        expect(sentUntil({ ...weekly([2]), until: '2026-10-27' }, CUT, WEEK, TUESDAY).until).toBe('2026-11-02');
        expect(sentUntil({ ...weekly([2, 4]), until: '2026-10-27' }, CUT, WEEK, TUESDAY).until).toBe('2026-10-27');
        expect(sentUntil({ ...weekly([2]), until: '2026-10-27' }, null, WEEK, TUESDAY).until).toBe('2026-10-27');
    });

    it('d’un jour passé, sa dernière fois laissée telle quelle n’est pas une fin à juger', () => {
        const opened = initialRecurrence(daily, cutDay());
        if (opened === null) {
            throw new Error('Le bloc a sa case.');
        }
        // Le jeudi 29 octobre : sa dernière fois, le 27, est passée ; sa fin enregistrée aussi.
        expect(untilMinimum(opened, CUT, TUESDAY, '2026-10-29', WEEK)).toBe(TUESDAY);
        expect(ask(opened, cutDay(), '2026-10-29')).toMatchObject({
            kind: 'recurrence',
            rule: { until: '2026-11-02' },
            replaces: SEEN_CUT,
        });
    });

    it('montre une fois qui se pose : ni effacée cette fois seulement — ni le jour de la coupe —, ni un jour non travaillé', () => {
        // La coupe laisse un saut au jour coupé : repoussée au-delà, la récurrence n'y revient pas.
        const pushed: Recurrence = { ...CUT, until: '2026-11-10', skipped: ['2026-11-03'] };
        expect(shownUntil(pushed, WEEK, TUESDAY)).toBe('2026-11-10');
        expect(shownUntil({ ...pushed, until: '2026-11-08' }, WEEK, TUESDAY)).toBe('2026-10-27');
        // Le mardi décoché des réglages : sa dernière fois n'en est plus une.
        // Sans aucune fois un jour travaillé : le dernier jour où son rythme tombe.
        expect(shownUntil(CUT, [1, 3, 4, 5], TUESDAY)).toBe('2026-10-27');
        expect(shownUntil({ ...CUT, rhythm: weekly([1, 2]) }, [1, 3, 4, 5], TUESDAY)).toBe('2026-11-02');
        expect(shownUntil({ ...CUT, rhythm: weekly([1, 2]), until: '2026-11-01' }, [1, 3, 4, 5], TUESDAY)).toBe(
            '2026-10-26',
        );
    });

    it('d’un jour passé, un autre rythme finit là où la fenêtre l’a montré : passée, cette fin se refuse sous « Jusqu’au »', () => {
        const opened = initialRecurrence(daily, cutDay());
        if (opened === null) {
            throw new Error('Le bloc a sa case.');
        }
        // Le vendredi 30 octobre : sa dernière fois, le mardi 27, est passée ; un autre rythme part de demain.
        expect(untilMinimum({ ...opened, weekdays: [2, 4] }, CUT, TUESDAY, '2026-10-30', WEEK)).toBe('2026-10-31');
        expect(ask({ ...opened, weekdays: [2, 4] }, cutDay(), '2026-10-30')).toMatchObject({
            kind: 'refuse',
            until: 'Choisissez un jour à partir du samedi 31 octobre.',
        });
    });

    it('relue après un refus, le bloc portant une autre récurrence : « Jusqu’au » non touché prend la fin de celle-ci', () => {
        const opened = initialRecurrence(daily, cutDay());
        if (opened === null) {
            throw new Error('Le bloc a sa case.');
        }
        // Un autre onglet a changé le commentaire avec les suivantes, et la fin au mardi 15 décembre :
        // le bloc porte une autre récurrence, qui finit là.
        const other: Recurrence = { ...CUT, id: 'daily-bis', until: '2026-12-15' };
        const grid = gridOf([
            ['09:15', '09:30', 'work', 'OPS-12', 'Daily', 'daily-bis'],
            ['12:30', '13:30', 'pause', null, null, 'lunch'],
        ]);
        const later = dayOf(grid, TUESDAY, [other, LUNCH]);
        const target = editAt('09:15', grid);

        expect(seenAgain({ ...opened, weekdays: [2, 4] }, target, later)).toMatchObject({
            until: '2026-12-15',
            seenUntil: '2026-12-15',
            seen: { id: 'daily-bis', weekdays: [2], until: '2026-12-15' },
        });
        // Touché, il reste.
        expect(seenAgain({ ...opened, until: '2026-10-20' }, target, later)).toMatchObject({ until: '2026-10-20' });
    });

    it('ne montre jamais une fin avant le jour du bloc, même décoché des réglages depuis', () => {
        // Le Daily jusqu'au vendredi 9 octobre ; le vendredi décoché depuis. Sa fenêtre, ce vendredi-là.
        const friday = '2026-10-09';
        const daily9 = { ...DAILY, until: friday };
        const day: DayState = { ...dayOf(GRID, friday, [daily9, LUNCH]), workingDays: [1, 2, 3, 4] };
        const opened = initialRecurrence(daily, day);

        expect(opened).toMatchObject({ until: friday, seenUntil: friday });
        // Un autre commentaire : la question, sans refus sous « Jusqu'au ».
        expect(
            recurrenceAction(
                saveEntry(daily, { ticket: 'OPS-12', comment: 'Rétro' }),
                daily,
                opened,
                opened,
                day,
                friday,
            ),
        ).toMatchObject({ kind: 'ask', question: 'modify', following: { rule: { until: friday } } });
    });

    it('laissée telle quelle, garde la fin enregistrée même si les jours travaillés ont changé depuis l’ouverture', () => {
        // Ouverte le vendredi décoché : « Jusqu'au » montre le jeudi 29 octobre (le Daily va jusqu'au vendredi 30).
        const daily30 = { ...DAILY, until: '2026-10-30' };
        const before: DayState = { ...dayOf(GRID, TUESDAY, [daily30, LUNCH]), workingDays: [1, 2, 3, 4] };
        const opened = initialRecurrence(daily, before);
        expect(opened).toMatchObject({ until: '2026-10-29', seenUntil: '2026-10-29' });
        // Le vendredi rendu ailleurs, la journée relue : la case, elle, n'a pas bougé.
        const after = dayOf(GRID, TUESDAY, [daily30, LUNCH]);
        const reopened = initialRecurrence(daily, after);

        expect(recurrenceChanged(opened, reopened, TUESDAY, WEEK)).toBe(false);
        expect(
            recurrenceAction(
                saveEntry(daily, { ticket: 'OPS-12', comment: 'Rétro' }),
                daily,
                opened,
                reopened,
                after,
                TUESDAY,
            ),
        ).toMatchObject({ kind: 'ask', following: { rule: { until: '2026-10-30' } } });
    });

    it('relue après un refus, garde sa dernière fois si rien n’y a touché, et la fin posée ailleurs sinon', () => {
        const opened = initialRecurrence(daily, cutDay());
        if (opened === null) {
            throw new Error('Le bloc a sa case.');
        }
        // Un autre onglet repousse sa fin au lundi 16 novembre : sa dernière fois devient le 10.
        const later = dayOf(GRID, TUESDAY, [{ ...CUT, until: '2026-11-16' }, LUNCH]);

        expect(seenAgain(opened, daily, later)).toMatchObject({
            until: '2026-11-10',
            seen: { ...SEEN_CUT, until: '2026-11-16' },
        });
        expect(seenAgain({ ...opened, until: '2026-10-20' }, daily, later)).toMatchObject({
            until: '2026-10-20',
            seen: { ...SEEN_CUT, until: '2026-11-16' },
        });
    });
});
