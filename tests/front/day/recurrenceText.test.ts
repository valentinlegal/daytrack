import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { addDays } from '../../../assets/day/calendar';
import {
    alternateLabel,
    alternationNote,
    INCOMPLETE_DATE_REFUSAL,
    monthChoiceLabel,
    monthNote,
    NO_DAY_REFUSAL,
    readDate,
    recurrenceLabel,
    recurrenceMention,
    recurrenceSentence,
    rhythmPhrase,
    startOf,
    takenRefusal,
    timeLabel,
    timeTile,
    untilRefusal,
    weekdayLetter,
    weekdayTitle,
    weekdayWord,
    withdrawalNote,
} from '../../../assets/day/recurrenceText';
import type { DayState } from '../../../assets/grid/day';
import { LAST_WEEK, type Recurrence, type Rhythm, weekly } from '../../../assets/grid/recurrence';
import { NOTHING_SENT } from '../../../assets/grid/send';
import { gridOf, minutes, type Range } from '../grid/support';

/** L'espace insécable qui tient « de 09:15 » sur une ligne. */
const NBSP = '\u{a0}';

function everyWeeks(weekdays: number[], count: number): Rhythm {
    return { ...weekly(weekdays), everyWeeks: count };
}

function monthlyWeekday(weekday: number, monthWeek: number): Rhythm {
    return { kind: 'monthly_weekday', weekdays: [weekday], everyWeeks: 1, monthWeek, monthDay: null };
}

function monthlyDate(monthDay: number): Rhythm {
    return { kind: 'monthly_date', weekdays: [], everyWeeks: 1, monthWeek: null, monthDay };
}

describe('les jours de la semaine', () => {
    it('se disent en toutes lettres, en initiale sur leur bouton, et avec une majuscule pour le lecteur d’écran', () => {
        expect([1, 2, 3, 4, 5, 6, 7].map(weekdayWord)).toEqual([
            'lundi',
            'mardi',
            'mercredi',
            'jeudi',
            'vendredi',
            'samedi',
            'dimanche',
        ]);
        expect([1, 2, 3, 4, 5, 6, 7].map(weekdayLetter).join('')).toBe('LMMJVSD');
        expect(weekdayTitle(3)).toBe('Mercredi');
        expect(weekdayWord(0)).toBe('');
        expect(weekdayWord(8)).toBe('');
    });
});

describe('rhythmPhrase', () => {
    it.each([
        [[2], 'chaque mardi'],
        [[1, 2, 3, 4, 5], 'chaque semaine, du lundi au vendredi'],
        [[5, 3, 1], 'chaque semaine, lundi, mercredi et vendredi'],
        [[1, 2], 'chaque semaine, lundi et mardi'],
        [[3, 4, 5], 'chaque semaine, du mercredi au vendredi'],
        [[1, 2, 3, 4, 5, 6, 7], 'chaque semaine, du lundi au dimanche'],
        [[1, 2, 4, 5], 'chaque semaine, lundi, mardi, jeudi et vendredi'],
        [[6, 7], 'chaque semaine, samedi et dimanche'],
    ])('chaque semaine, les jours %j : « %s »', (weekdays, phrase) => {
        expect(rhythmPhrase(weekly(weekdays))).toBe(phrase);
    });

    it('dit une semaine sur deux, trois ou quatre', () => {
        expect(rhythmPhrase(everyWeeks([4], 2))).toBe('un jeudi sur deux');
        expect(rhythmPhrase(everyWeeks([1, 3], 3))).toBe('une semaine sur trois, lundi et mercredi');
        expect(rhythmPhrase(everyWeeks([1, 2, 3], 4))).toBe('une semaine sur quatre, du lundi au mercredi');
    });

    it('dit les rythmes au mois', () => {
        expect(rhythmPhrase(monthlyWeekday(5, 3))).toBe('le 3e vendredi du mois');
        expect(rhythmPhrase(monthlyWeekday(1, 1))).toBe('le 1er lundi du mois');
        expect(rhythmPhrase(monthlyWeekday(5, LAST_WEEK))).toBe('le dernier vendredi du mois');
        expect(rhythmPhrase(monthlyDate(1))).toBe('le 1er de chaque mois');
        expect(rhythmPhrase(monthlyDate(31))).toBe('le 31 de chaque mois');
    });
});

describe('recurrenceLabel', () => {
    it('dit au lecteur d’écran ce que montre la flèche d’un bloc qui revient', () => {
        expect(recurrenceLabel(weekly([1, 2, 3, 4, 5]))).toBe('Revient chaque semaine, du lundi au vendredi');
        expect(recurrenceLabel(weekly([2]))).toBe('Revient chaque mardi');
    });

    it('dit une semaine sur n et les rythmes au mois, au survol comme au lecteur d’écran', () => {
        expect(recurrenceLabel(everyWeeks([2], 2))).toBe('Revient un mardi sur deux');
        expect(recurrenceLabel(monthlyWeekday(5, 3))).toBe('Revient le 3e vendredi du mois');
        expect(recurrenceLabel(monthlyDate(16))).toBe('Revient le 16 de chaque mois');
        expect(recurrenceLabel(monthlyWeekday(5, LAST_WEEK))).toBe('Revient le dernier vendredi du mois');
        expect(recurrenceMention(everyWeeks([1, 4], 2))).toBe('revient une semaine sur deux, lundi et jeudi');
    });
});

describe('monthChoiceLabel', () => {
    it('écrit chaque choix de « Jour du mois » avec sa majuscule', () => {
        expect(monthChoiceLabel(monthlyWeekday(5, 3))).toBe('Le 3e vendredi du mois');
        expect(monthChoiceLabel(monthlyDate(16))).toBe('Le 16 de chaque mois');
        expect(monthChoiceLabel(monthlyWeekday(5, LAST_WEEK))).toBe('Le dernier vendredi du mois');
        expect(monthChoiceLabel(monthlyDate(1))).toBe('Le 1er de chaque mois');
    });
});

describe('startOf', () => {
    it('part d’aujourd’hui, de demain pour un jour passé, ou du jour à venir lui-même', () => {
        expect(startOf('2026-10-06', '2026-10-06')).toBe('today');
        expect(startOf('2026-10-05', '2026-10-06')).toBe('tomorrow');
        expect(startOf('2026-10-08', '2026-10-06')).toEqual({ from: '2026-10-08' });
    });
});

describe('recurrenceSentence', () => {
    const start = minutes('09:15');
    const end = minutes('09:30');
    const week = weekly([1, 2, 3, 4, 5]);
    /** Un mardi, d'où « aujourd'hui » et « demain » partent. */
    const today = '2026-10-06';

    it('dit le rythme, la plage et le départ, comme la fenêtre', () => {
        expect(recurrenceSentence(week, start, end, null, 'today', today)).toBe(
            `Chaque semaine, du lundi au vendredi, de${NBSP}09:15 à${NBSP}09:30, à partir d'aujourd'hui.`,
        );
    });

    it('dit sa fin, et le jour d’où elle part', () => {
        expect(recurrenceSentence(weekly([2]), start, end, '2026-11-04', 'tomorrow', today)).toBe(
            `Chaque mardi, de${NBSP}09:15 à${NBSP}09:30, de demain au mercredi 4 novembre.`,
        );
        expect(recurrenceSentence(week, start, end, '2026-10-01', { from: '2026-10-01' }, today)).toBe(
            `Chaque semaine, du lundi au vendredi, de${NBSP}09:15 à${NBSP}09:30, le jeudi 1er octobre.`,
        );
        expect(recurrenceSentence(weekly([3]), start, end, '2026-12-09', { from: '2026-11-18' }, today)).toBe(
            `Chaque mercredi, de${NBSP}09:15 à${NBSP}09:30, du mercredi 18 novembre au mercredi 9 décembre.`,
        );
        expect(recurrenceSentence(weekly([3]), start, end, '2026-12-09', 'today', today)).toBe(
            `Chaque mercredi, de${NBSP}09:15 à${NBSP}09:30, d'aujourd'hui au mercredi 9 décembre.`,
        );
    });

    it('dit l’année d’une date qui n’est pas celle d’aujourd’hui, au départ comme à la fin', () => {
        expect(recurrenceSentence(weekly([3]), start, end, '2027-12-29', { from: '2026-12-02' }, today)).toBe(
            `Chaque mercredi, de${NBSP}09:15 à${NBSP}09:30, du mercredi 2 décembre au mercredi 29 décembre 2027.`,
        );
        expect(recurrenceSentence(weekly([1]), start, end, null, { from: '2027-01-04' }, today)).toBe(
            `Chaque lundi, de${NBSP}09:15 à${NBSP}09:30, à partir du lundi 4 janvier 2027.`,
        );
        expect(recurrenceSentence(weekly([1]), start, end, '2027-01-04', { from: '2027-01-04' }, today)).toBe(
            `Chaque lundi, de${NBSP}09:15 à${NBSP}09:30, le lundi 4 janvier 2027.`,
        );
        expect(recurrenceSentence(weekly([1]), start, end, '2027-01-11', 'today', today)).toBe(
            `Chaque lundi, de${NBSP}09:15 à${NBSP}09:30, d'aujourd'hui au lundi 11 janvier 2027.`,
        );
        // Une fin de l'année en cours ne dit pas la sienne, vue de n'importe quel jour de cette année.
        expect(recurrenceSentence(weekly([1]), start, end, '2026-01-12', null, '2026-01-05')).toBe(
            `Chaque lundi, de${NBSP}09:15 à${NBSP}09:30, jusqu'au lundi 12 janvier.`,
        );
    });

    it('dit un seul jour par sa date, qu’il parte d’aujourd’hui, de demain ou d’un jour daté', () => {
        expect(recurrenceSentence(week, start, end, today, 'today', today)).toBe(
            `Chaque semaine, du lundi au vendredi, de${NBSP}09:15 à${NBSP}09:30, le mardi 6 octobre.`,
        );
        expect(recurrenceSentence(week, start, end, '2026-10-07', 'tomorrow', today)).toBe(
            `Chaque semaine, du lundi au vendredi, de${NBSP}09:15 à${NBSP}09:30, le mercredi 7 octobre.`,
        );
        // Le lendemain du départ, ce sont deux jours.
        expect(recurrenceSentence(week, start, end, '2026-10-07', 'today', today)).toBe(
            `Chaque semaine, du lundi au vendredi, de${NBSP}09:15 à${NBSP}09:30, d'aujourd'hui au mercredi 7 octobre.`,
        );
        expect(recurrenceSentence(week, start, end, '2026-10-08', 'tomorrow', today)).toBe(
            `Chaque semaine, du lundi au vendredi, de${NBSP}09:15 à${NBSP}09:30, de demain au jeudi 8 octobre.`,
        );
    });

    it('dit une semaine sur deux, à un jour et à plusieurs, et une date au 1er', () => {
        expect(recurrenceSentence(everyWeeks([2], 2), minutes('13:30'), minutes('14:00'), null, null, today)).toBe(
            `Un mardi sur deux, de${NBSP}13:30 à${NBSP}14:00.`,
        );
        expect(recurrenceSentence(everyWeeks([1, 4], 2), start, end, null, null, today)).toBe(
            `Une semaine sur deux, lundi et jeudi, de${NBSP}09:15 à${NBSP}09:30.`,
        );
        expect(recurrenceSentence(monthlyDate(1), start, end, null, 'today', today)).toBe(
            `Le 1er de chaque mois, de${NBSP}09:15 à${NBSP}09:30, à partir d'aujourd'hui.`,
        );
    });

    it('ne dit pas d’où part une récurrence qu’on modifie, et va jusqu’à 20:00', () => {
        expect(recurrenceSentence(week, minutes('19:45'), minutes('20:00'), null, null, today)).toBe(
            `Chaque semaine, du lundi au vendredi, de${NBSP}19:45 à${NBSP}20:00.`,
        );
        // Sa fin seule, même le jour même : rien ne dit d'où elle part.
        expect(recurrenceSentence(week, start, end, today, null, today)).toBe(
            `Chaque semaine, du lundi au vendredi, de${NBSP}09:15 à${NBSP}09:30, jusqu'au mardi 6 octobre.`,
        );
    });
});

describe('timeTile', () => {
    it('écrit le jour et le mois courts sur la tuile, et le jour entier pour le lecteur d’écran', () => {
        expect(timeTile('2026-10-07')).toEqual({ day: `7${NBSP}oct.`, weekday: 'mer.', label: 'Mercredi 7 octobre' });
        expect(timeTile('2026-10-01')).toEqual({ day: `1er${NBSP}oct.`, weekday: 'jeu.', label: 'Jeudi 1er octobre' });
        expect(timeTile('2027-02-14').day).toBe(`14${NBSP}févr.`);
        expect(timeTile('2026-08-31')).toEqual({ day: `31${NBSP}août`, weekday: 'lun.', label: 'Lundi 31 août' });
        expect(timeTile('2026-12-27').weekday).toBe('dim.');
    });
});

describe('« Jusqu’au », tel que le champ date le donne', () => {
    it('vaut le jour du calendrier, ou null vide', () => {
        expect(readDate('2026-11-04')).toBe('2026-11-04');
        expect(readDate('2028-02-29')).toBe('2028-02-29');
        expect(readDate('')).toBeNull();
    });

    it('ne lit pas ce qui n’est pas un jour du calendrier à quatre chiffres d’année', () => {
        for (const value of ['2026-02-31', '2027-02-29', '2026-13-04', '20266-11-04', '04/11/2026', ' 2026-11-04']) {
            expect(readDate(value)).toBeUndefined();
        }
    });

    it('relit chaque jour', () => {
        fc.assert(
            fc.property(fc.integer({ min: -400, max: 4000 }), (offset) => {
                const date = addDays('2026-10-06', offset);

                expect(readDate(date)).toBe(date);
            }),
        );
    });
});

describe('les refus de la récurrence', () => {
    it('disent le premier jour possible, comme le serveur, et son année quand ce n’est pas celle d’aujourd’hui', () => {
        expect(untilRefusal('2026-10-06', '2026-10-06')).toBe('Choisissez un jour à partir du mardi 6 octobre.');
        expect(untilRefusal('2026-10-01', '2026-10-06')).toBe('Choisissez un jour à partir du jeudi 1er octobre.');
        // D'une autre année que celle d'aujourd'hui, avec la sienne, comme la phrase au-dessus.
        expect(untilRefusal('2027-01-05', '2026-12-28')).toBe('Choisissez un jour à partir du mardi 5 janvier 2027.');
        expect(NO_DAY_REFUSAL).toBe('Choisissez au moins un jour.');
        expect(INCOMPLETE_DATE_REFUSAL).toBe('Complétez la date.');
    });
});

describe('un créneau déjà pris', () => {
    /** « « Rétrospective » », ses guillemets tenus à leur mot. */
    const quoted = (name: string) => `«${NBSP}${name}${NBSP}»`;
    const other = (rhythm: Rhythm, content: Recurrence['content']): Recurrence => ({
        id: 'autre',
        start: minutes('14:00'),
        end: minutes('15:00'),
        rhythm,
        firstDay: '2026-10-15',
        until: null,
        content,
    });
    const retro = other(everyWeeks([4], 2), { kind: 'work', ticket: 'OPS-7', comment: 'Rétrospective' });
    const dependencies = other(monthlyWeekday(5, 3), { kind: 'work', ticket: 'OPS-9', comment: 'Dépendances' });
    const unnamed = other(everyWeeks([4], 2), { kind: 'work', ticket: 'OPS-12', comment: null });
    const lunch = other(weekly([1, 2, 3, 4, 5]), { kind: 'pause' });

    it('se refuse sous les prochaines fois, par le rythme de l’autre et son nom', () => {
        expect(takenRefusal(retro)).toBe(
            `Un jeudi sur deux, ce créneau est déjà pris par la récurrence ${quoted('Rétrospective')}.`,
        );
        expect(takenRefusal(dependencies)).toBe(
            `Le 3e vendredi du mois, ce créneau est déjà pris par la récurrence ${quoted('Dépendances')}.`,
        );
        expect(takenRefusal(lunch)).toBe(
            'Chaque semaine, du lundi au vendredi, ce créneau est déjà pris par la pause.',
        );
    });

    it('nomme une récurrence sans commentaire par son ticket', () => {
        expect(takenRefusal(unnamed)).toBe(
            `Un jeudi sur deux, ce créneau est déjà pris par la récurrence ${quoted('OPS-12')}.`,
        );
        expect(alternateLabel(unnamed)).toBe(`Alterner avec ${quoted('OPS-12')}`);
    });

    it('propose d’alterner, puis dit l’alternance, avec une récurrence ou une pause', () => {
        expect(alternateLabel(retro)).toBe(`Alterner avec ${quoted('Rétrospective')}`);
        expect(alternateLabel(lunch)).toBe('Alterner avec la pause');
        expect(alternationNote(retro, [4])).toBe(
            `En alternance avec ${quoted('Rétrospective')}, qui revient les autres jeudis.`,
        );
        expect(alternationNote(lunch, [4])).toBe('En alternance avec la pause, qui revient les autres jeudis.');
        expect(alternationNote(retro, [4, 1])).toBe(
            `En alternance avec ${quoted('Rétrospective')}, qui revient les autres lundis et jeudis.`,
        );
        expect(alternationNote(retro, [1, 3, 5])).toBe(
            `En alternance avec ${quoted('Rétrospective')}, qui revient les autres lundis, mercredis et vendredis.`,
        );
    });

    it('se lit sur chaque tuile : prise par l’autre, sans rien une semaine sans, ou libre', () => {
        expect(timeLabel('2026-10-22', true, retro)).toBe('Jeudi 22 octobre, déjà pris par Rétrospective');
        expect(timeLabel('2026-10-22', true, lunch)).toBe('Jeudi 22 octobre, déjà pris par la pause');
        expect(timeLabel('2026-10-22', true, unnamed)).toBe('Jeudi 22 octobre, déjà pris par OPS-12');
        expect(timeLabel('2026-10-27', false, null)).toBe('Mardi 27 octobre, rien ce jour-là');
        expect(timeLabel('2026-10-29', true, null)).toBe('Jeudi 29 octobre');
    });
});

describe('monthNote', () => {
    it('dit sous les prochaines fois les mois qui n’ont pas la date', () => {
        expect(monthNote(monthlyDate(31), [1, 2, 3, 4, 5])).toBe(
            "Les mois sans 31, et ceux où il tombe un jour non travaillé, n'en ont pas.",
        );
        expect(monthNote(monthlyDate(16), [1, 2, 3, 4, 5])).toBe(
            "Les mois où le 16 tombe un jour non travaillé n'en ont pas.",
        );
        expect(monthNote(monthlyDate(1), [1, 2, 3, 4, 5])).toBe(
            "Les mois où le 1er tombe un jour non travaillé n'en ont pas.",
        );
        expect(monthNote(monthlyDate(29), [1, 2, 3, 4, 5, 6, 7])).toBe("Les mois sans 29 n'en ont pas.");
    });

    it('ne dit rien quand chaque mois l’a, un jour travaillé, ni d’un autre rythme', () => {
        expect(monthNote(monthlyDate(16), [1, 2, 3, 4, 5, 6, 7])).toBeNull();
        expect(monthNote(monthlyWeekday(5, 3), [1, 2, 3, 4, 5])).toBeNull();
        expect(monthNote(everyWeeks([2], 2), [1, 2, 3, 4, 5])).toBeNull();
    });
});

describe('withdrawalNote', () => {
    const DAILY = 'r-daily';
    const LUNCH = 'r-dejeuner';
    const POKER = 'r-poker';
    const recurrence = (id: string, until: string | null = null): [string, Recurrence] => [
        id,
        {
            id,
            start: 540,
            end: 600,
            rhythm: weekly([1, 2, 3, 4, 5]),
            firstDay: '2026-10-01',
            until,
            content: { kind: 'work', ticket: 'OPS-12', comment: id },
        },
    ];
    const dayWith = (ranges: Range[], recurrences: [string, Recurrence][]): DayState => ({
        date: '2026-10-06',
        version: 3,
        objective: 450,
        habitualObjective: 450,
        working: true,
        declaredOff: false,
        workingDays: [1, 2, 3, 4, 5],
        grid: gridOf(ranges),
        send: NOTHING_SENT,
        recurrences: new Map(recurrences),
        recurrencesHeld: false,
        ongoing: new Map(recurrences),
        settledAhead: new Set(),
    });

    it('nomme les blocs flèchés dans l’ordre de la journée', () => {
        const day = dayWith(
            [
                ['09:15', '09:30', 'work', 'OPS-12', 'Daily', DAILY],
                ['10:00', '11:00', 'work', 'SHOP-482', null],
                ['12:30', '13:30', 'pause', null, null, LUNCH],
                ['13:30', '14:00', 'work', 'OPS-12', 'Poker planning', POKER],
            ],
            [recurrence(DAILY), recurrence(LUNCH), recurrence(POKER)],
        );

        expect(withdrawalNote(day)).toBe(
            'Daily, la pause et Poker planning, posés par vos récurrences, seront retirés. Vos autres tickets restent.',
        );
    });

    it('accorde un seul bloc, et tait les autres tickets quand il n’y en a pas', () => {
        const daily = dayWith([['09:15', '09:30', 'work', 'OPS-12', 'Daily', DAILY]], [recurrence(DAILY)]);
        const ticket = dayWith(
            [
                ['09:15', '09:30', 'work', 'OPS-12', null, DAILY],
                ['14:00', '15:00', 'work', 'SHOP-482', null],
            ],
            [recurrence(DAILY)],
        );
        const lunch = dayWith([['12:30', '13:30', 'pause', null, null, LUNCH]], [recurrence(LUNCH)]);

        expect(withdrawalNote(daily)).toBe('Daily, posé par une récurrence, sera retiré.');
        expect(withdrawalNote(ticket)).toBe(
            'OPS-12, posé par une récurrence, sera retiré. Vos autres tickets restent.',
        );
        expect(withdrawalNote(lunch)).toBe('La pause, posée par une récurrence, sera retirée.');
    });

    it('nomme une fois une récurrence coupée en deux par une saisie', () => {
        const day = dayWith(
            [
                ['09:00', '09:30', 'work', 'OPS-12', 'Daily', DAILY],
                ['09:30', '09:45', 'work', 'SHOP-482', null],
                ['09:45', '10:00', 'work', 'OPS-12', 'Daily', DAILY],
            ],
            [recurrence(DAILY)],
        );

        expect(withdrawalNote(day)).toBe('Daily, posé par une récurrence, sera retiré. Vos autres tickets restent.');
    });

    it('ne dit rien sans bloc flèché : ni saisie à la main, ni récurrence finie avant ce jour', () => {
        const manual = dayWith([['09:15', '09:30', 'work', 'OPS-12', 'Daily']], []);
        const ended = dayWith(
            [['09:15', '09:30', 'work', 'OPS-12', 'Daily', DAILY]],
            [recurrence(DAILY, '2026-10-05')],
        );

        expect(withdrawalNote(manual)).toBeNull();
        expect(withdrawalNote(ended)).toBeNull();
        expect(withdrawalNote(dayWith([], []))).toBeNull();
    });
});
