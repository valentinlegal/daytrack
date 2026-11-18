import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { addDays, isoWeekday } from '../../../assets/day/calendar';
import { fill } from '../../../assets/grid/changes';
import { type Cell, Grid, linkedTo, PAUSE, sameContent, unlinked, work } from '../../../assets/grid/grid';
import * as Quarter from '../../../assets/grid/quarter';
import {
    dayIn,
    detach,
    earliestClash,
    fallsOn,
    firstClash,
    followRhythm,
    lastTime,
    LAST_WEEK,
    monthlyChoices,
    monthlyDate,
    monthlyWeekday,
    nextTimes,
    occurrenceIn,
    readRecurrences,
    type Recurrence,
    type Rhythm,
    ruleOf,
    type Schedule,
    type TimedSchedule,
    timeline,
    weekly,
} from '../../../assets/grid/recurrence';
import { bruteClash } from './clashOracle';
import { gridOf, linkedCellArbitrary, linkedGridArbitrary, minutes, quarterArbitrary, readCases } from './support';

interface SharedCase {
    readonly name: string;
    readonly rhythm: Rhythm;
    readonly firstDay: string;
    readonly until: string | null;
    readonly after: string;
    readonly workingDays: readonly number[];
    readonly count: number;
    readonly times: readonly string[];
}

/** Une récurrence d'un conflit partagé : son rythme, sa période, sa plage en heures. */
interface SharedTimed {
    readonly rhythm: Rhythm;
    readonly firstDay: string;
    readonly until: string | null;
    readonly start: string;
    readonly end: string;
}

interface ConflictCase {
    readonly name: string;
    readonly a: SharedTimed;
    readonly b: SharedTimed;
    /** Les jours envoyés, qui ne comptent pour aucune. */
    readonly closed?: readonly string[];
    readonly clash: string | null;
}

const WEEK = [1, 2, 3, 4, 5];

function schedule(rhythm: Rhythm, firstDay: string, until: string | null = null): Schedule {
    return { rhythm, firstDay, until };
}

function timed(shared: SharedTimed): TimedSchedule {
    return { ...shared, start: minutes(shared.start), end: minutes(shared.end) };
}

/** Une récurrence de 14:00 à 15:00, ou sur cette plage. */
function recurrence(
    id: string,
    rhythm: Rhythm,
    firstDay: string,
    until: string | null = null,
    [start, end] = ['14:00', '15:00'],
): Recurrence {
    return {
        id,
        rhythm,
        firstDay,
        until,
        start: minutes(start),
        end: minutes(end),
        content: { kind: 'work', ticket: 'OPS-7', comment: id },
    };
}

describe('les cas partagés avec le serveur', () => {
    const cases = readCases('recurrences.json') as SharedCase[];

    it.each(cases)('$name', ({ rhythm, firstDay, until, after, workingDays, count, times }) => {
        const shared = schedule(rhythm, firstDay, until);

        expect(nextTimes(shared, after, workingDays, count)).toEqual(times);
        // Chaque jour d'ici la dernière fois : une fois s'il tombe et qu'il est travaillé, et
        // seulement alors.
        const last = times.at(-1);
        for (let date = addDays(after, 1); last !== undefined && date <= last; date = addDays(date, 1)) {
            expect(times.includes(date)).toBe(workingDays.includes(isoWeekday(date)) && fallsOn(shared, date));
        }
    });
});

describe('les conflits partagés avec le serveur', () => {
    const conflicts = readCases('recurrences.json', 'conflicts') as ConflictCase[];

    it.each(conflicts)('$name', ({ a, b, closed = [], clash }) => {
        expect(firstClash(timed(a), timed(b), null, closed)).toBe(clash);
        expect(firstClash(timed(b), timed(a), null, closed)).toBe(clash);
        // L'étalon, jour après jour, dit la même chose : les cas ne se trompent pas eux-mêmes.
        expect(bruteClash(timed(a), timed(b), null, closed)).toBe(clash);
    });

    it.each(conflicts.filter(({ clash }) => clash !== null))(
        '$name : rien le jour même ni avant, ce jour-là encore la veille',
        ({ a, b, closed = [], clash }) => {
            const day = clash ?? '';

            expect(firstClash(timed(a), timed(b), addDays(day, -1), closed)).toBe(day);
            expect(firstClash(timed(b), timed(a), addDays(day, -1), closed)).toBe(day);
            const later = firstClash(timed(a), timed(b), day, closed);
            expect(later === null || later > day).toBe(true);
            expect(later).toBe(bruteClash(timed(a), timed(b), day, closed));
            expect(firstClash(timed(b), timed(a), day, closed)).toBe(later);
        },
    );
});

describe('firstClash après aujourd’hui', () => {
    // Le jeudi du 22 octobre au 29, et un jeudi sur deux depuis le 15 : le 29 seulement.
    const thursdays = timed({
        rhythm: weekly([4]),
        firstDay: '2026-10-22',
        until: '2026-10-29',
        start: '14:00',
        end: '15:00',
    });
    const fortnight = timed({
        rhythm: weekly([4], 2),
        firstDay: '2026-10-15',
        until: null,
        start: '14:00',
        end: '15:00',
    });

    it('ne compte pas un conflit qui ne tombe que ce jour-là ou avant : un jour déjà venu ne reçoit plus rien', () => {
        expect(firstClash(thursdays, fortnight)).toBe('2026-10-29');
        expect(firstClash(thursdays, fortnight, '2026-10-28')).toBe('2026-10-29');
        expect(firstClash(thursdays, fortnight, '2026-10-29')).toBeNull();
        expect(firstClash(fortnight, thursdays, '2026-11-02')).toBeNull();
    });

    it('part de leur premier jour commun quand aujourd’hui est avant', () => {
        expect(firstClash(thursdays, fortnight, '2026-01-01')).toBe('2026-10-29');
    });

    it('cherche un rythme mensuel après aujourd’hui : le 3e vendredi suivant', () => {
        const third = timed({
            rhythm: monthlyWeekday(5, 3),
            firstDay: '2026-10-16',
            until: null,
            start: '14:00',
            end: '15:00',
        });
        const fridays = timed({
            rhythm: weekly([5]),
            firstDay: '2026-11-01',
            until: null,
            start: '14:00',
            end: '15:00',
        });

        expect(firstClash(third, fridays, '2026-11-19')).toBe('2026-11-20');
        expect(firstClash(third, fridays, '2026-11-20')).toBe('2026-12-18');
        expect(firstClash(fridays, third, '2026-11-20')).toBe('2026-12-18');
        expect(firstClash({ ...third, until: '2026-12-17' }, fridays, '2026-11-20')).toBeNull();
    });
});

describe('earliestClash', () => {
    const candidate = timed({
        rhythm: weekly([2, 4]),
        firstDay: '2026-11-10',
        until: null,
        start: '14:00',
        end: '15:00',
    });

    it('nomme celle qui prend le créneau le plus tôt, et ce jour-là', () => {
        const thursday = recurrence('b-jeudi', weekly([4]), '2026-11-01');
        const tuesday = recurrence('c-mardi', weekly([2]), '2026-11-01');

        expect(earliestClash(candidate, [thursday, tuesday])).toEqual({ recurrence: tuesday, date: '2026-11-10' });
        expect(earliestClash(candidate, [tuesday, thursday])).toEqual({ recurrence: tuesday, date: '2026-11-10' });
        // Après aujourd'hui, le mardi 10 ne compte plus : le jeudi 12 vient avant le mardi 17.
        expect(earliestClash(candidate, [tuesday, thursday], '2026-11-10')).toEqual({
            recurrence: thursday,
            date: '2026-11-12',
        });
    });

    it('nomme la plus ancienne quand deux le prennent le même jour', () => {
        const older = recurrence('01900000-0000-7000-8000-000000000001', weekly([2]), '2026-11-01');
        const newer = recurrence('01900000-0000-7000-8000-000000000002', weekly([2], 2), '2026-11-02', null, [
            '14:30',
            '15:30',
        ]);

        expect(earliestClash(candidate, [newer, older])?.recurrence).toBe(older);
        expect(earliestClash(candidate, [older, newer])?.recurrence).toBe(older);
    });

    it('ne nomme personne quand le créneau est libre : d’autres heures, d’autres jours, une autre période', () => {
        expect(
            earliestClash(candidate, [
                recurrence('a', weekly([2, 4]), '2026-11-01', null, ['15:00', '16:00']),
                recurrence('b', weekly([1, 3, 5]), '2026-11-01'),
                recurrence('c', weekly([2]), '2026-10-01', '2026-11-09'),
                recurrence('d', weekly([2]), '2026-11-10', '2026-11-09'),
            ]),
        ).toBeNull();
        expect(earliestClash(candidate, [])).toBeNull();
    });
});

/** Un jour du calendrier tiré entre 2023 et 2031 : des années bissextiles, et chaque fin d'année. */
const dayArbitrary = fc.oneof(
    { arbitrary: fc.integer({ min: 0, max: 3286 }).map((offset) => addDays('2023-01-01', offset)), weight: 4 },
    {
        arbitrary: fc.constantFrom('2024-02-29', '2028-02-29', '2025-12-29', '2026-12-31', '2027-01-01', '2028-12-25'),
        weight: 1,
    },
);

/** Chaque genre de rythme : une semaine sur 1 à 4, le 1er au 4e ou le dernier d'un jour, une date du 1er au 31. */
const rhythmArbitrary: fc.Arbitrary<Rhythm> = fc.oneof(
    fc
        .tuple(
            fc.uniqueArray(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 7 }),
            fc.integer({ min: 1, max: 4 }),
        )
        .map(([days, every]) => weekly(days, every)),
    fc
        .tuple(fc.integer({ min: 1, max: 7 }), fc.constantFrom(1, 2, 3, 4, LAST_WEEK))
        .map(([weekday, week]) => monthlyWeekday(weekday, week)),
    fc.integer({ min: 1, max: 31 }).map(monthlyDate),
);

/**
 * Une récurrence : son rythme, son premier jour, une fin — aucune, plus tard, ou la veille de
 * son premier jour, retirée —, et une plage autour de 14:00 qui touche ou croise celle d'une
 * autre d'un quart d'heure.
 */
const timedArbitrary: fc.Arbitrary<TimedSchedule> = fc
    .tuple(
        rhythmArbitrary,
        dayArbitrary,
        fc.oneof(fc.constant(null), fc.integer({ min: -1, max: 900 })),
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 1, max: 4 }),
    )
    .map(([rhythm, firstDay, length, start, quarters]) => ({
        rhythm,
        firstDay,
        until: length === null ? null : addDays(firstDay, length),
        start: minutes('14:00') + start * 15,
        end: minutes('14:00') + (start + quarters) * 15,
    }));

/** Les suites qui tirent des paires : FC_RUNS en tire davantage. */
const CLASH_RUNS = Number(process.env.FC_RUNS ?? 2000);

describe('firstClash, comparé jour après jour à la force brute', () => {
    it(
        'trouve la même première date, dans les deux sens, aujourd’hui compris ou non',
        () => {
            let found = 0;
            fc.assert(
                fc.property(timedArbitrary, timedArbitrary, fc.option(dayArbitrary, { nil: null }), (a, b, after) => {
                    const expected = bruteClash(a, b, after);
                    found += expected === null ? 0 : 1;

                    expect(firstClash(a, b, after)).toBe(expected);
                    expect(firstClash(b, a, after)).toBe(expected);
                }),
                { numRuns: CLASH_RUNS },
            );
            // Des paires qui se croisent vraiment, pas seulement des créneaux libres.
            expect(found).toBeGreaterThan(CLASH_RUNS / 20);
        },
        Math.max(30_000, CLASH_RUNS * 30),
    );

    it(
        'trouve la même première date entre deux récurrences d’une même plage, nées près l’une de l’autre',
        () => {
            let found = 0;
            // Des paires qui se croisent souvent : même plage, premiers jours à moins de huit semaines.
            fc.assert(
                fc.property(
                    timedArbitrary,
                    rhythmArbitrary,
                    fc.integer({ min: -56, max: 56 }),
                    fc.option(fc.integer({ min: 0, max: 400 }), { nil: null }),
                    (a, rhythm, shift, length) => {
                        const firstDay = addDays(a.firstDay, shift);
                        const b: TimedSchedule = {
                            ...a,
                            rhythm,
                            firstDay,
                            until: length === null ? null : addDays(firstDay, length),
                        };
                        const expected = bruteClash(a, b);
                        found += expected === null ? 0 : 1;

                        expect(firstClash(a, b)).toBe(expected);
                        expect(firstClash(b, a)).toBe(expected);
                    },
                ),
                { numRuns: CLASH_RUNS },
            );
            expect(found).toBeGreaterThan(CLASH_RUNS / 4);
        },
        Math.max(30_000, CLASH_RUNS * 30),
    );
});

describe('firstClash, des fois sautées', () => {
    it(
        'trouve la même première date que la force brute quand leurs premières fois communes sont sautées, la même phase plus loin comprise',
        () => {
            let skipping = 0;
            fc.assert(
                fc.property(
                    timedArbitrary,
                    rhythmArbitrary,
                    fc.integer({ min: -56, max: 56 }),
                    fc.array(fc.boolean(), { maxLength: 4 }),
                    (a, rhythm, shift, sides) => {
                        const b: TimedSchedule = { ...a, rhythm, firstDay: addDays(a.firstDay, shift), until: null };
                        // Leurs premières fois communes sautées une à une, chacune d'un côté tiré.
                        const skipped: { a: string[]; b: string[] } = { a: [], b: [] };
                        for (const onA of sides) {
                            const next = bruteClash({ ...a, skipped: skipped.a }, { ...b, skipped: skipped.b });
                            if (next === null) {
                                break;
                            }
                            skipped[onA ? 'a' : 'b'].push(next);
                        }
                        skipping += skipped.a.length + skipped.b.length > 0 ? 1 : 0;
                        const left = { ...a, skipped: skipped.a };
                        const right = { ...b, skipped: skipped.b };
                        const expected = bruteClash(left, right);

                        expect(firstClash(left, right)).toBe(expected);
                        expect(firstClash(right, left)).toBe(expected);
                    },
                ),
                { numRuns: CLASH_RUNS / 4 },
            );
            expect(skipping).toBeGreaterThan(CLASH_RUNS / 40);
        },
        Math.max(30_000, CLASH_RUNS * 60),
    );
});

describe('firstClash, des jours envoyés', () => {
    it(
        'trouve la même première date que la force brute quand leurs premières fois communes tombent sur des jours envoyés',
        () => {
            let closing = 0;
            fc.assert(
                fc.property(
                    timedArbitrary,
                    rhythmArbitrary,
                    fc.integer({ min: -56, max: 56 }),
                    fc.integer({ min: 0, max: 3 }),
                    (a, rhythm, shift, count) => {
                        const b: TimedSchedule = { ...a, rhythm, firstDay: addDays(a.firstDay, shift), until: null };
                        // Leurs premières fois communes envoyées une à une : elles ne comptent pour aucune.
                        const closed: string[] = [];
                        for (let sent = 0; sent < count; sent += 1) {
                            const next = bruteClash(a, b, null, closed);
                            if (next === null) {
                                break;
                            }
                            closed.push(next);
                        }
                        closing += closed.length > 0 ? 1 : 0;
                        const expected = bruteClash(a, b, null, closed);

                        expect(firstClash(a, b, null, closed)).toBe(expected);
                        expect(firstClash(b, a, null, closed)).toBe(expected);
                    },
                ),
                { numRuns: CLASH_RUNS / 4 },
            );
            expect(closing).toBeGreaterThan(CLASH_RUNS / 40);
        },
        Math.max(30_000, CLASH_RUNS * 60),
    );
});

describe('dayIn', () => {
    it('trouve le n-ième jour de la semaine du mois, et le dernier', () => {
        expect(dayIn(monthlyWeekday(5, 3), '2026-10')).toBe('2026-10-16');
        expect(dayIn(monthlyWeekday(1, 1), '2026-06')).toBe('2026-06-01');
        expect(dayIn(monthlyWeekday(5, 4), '2026-10')).toBe('2026-10-23');
        expect(dayIn(monthlyWeekday(5, LAST_WEEK), '2026-10')).toBe('2026-10-30');
        expect(dayIn(monthlyWeekday(5, LAST_WEEK), '2027-01')).toBe('2027-01-29');
        // Un mois qui finit ce jour-là : le dernier est le 31.
        expect(dayIn(monthlyWeekday(4, LAST_WEEK), '2026-12')).toBe('2026-12-31');
        expect(dayIn(monthlyWeekday(7, LAST_WEEK), '2026-02')).toBe('2026-02-22');
    });

    it('trouve une date du mois, et rien un mois qui ne l’a pas', () => {
        expect(dayIn(monthlyDate(16), '2026-11')).toBe('2026-11-16');
        expect(dayIn(monthlyDate(31), '2027-01')).toBe('2027-01-31');
        expect(dayIn(monthlyDate(31), '2026-04')).toBeNull();
        expect(dayIn(monthlyDate(29), '2028-02')).toBe('2028-02-29');
        expect(dayIn(monthlyDate(29), '2027-02')).toBeNull();
        expect(dayIn(monthlyDate(1), '2027-01')).toBe('2027-01-01');
    });

    it('ne trouve rien à un rythme à la semaine', () => {
        expect(dayIn(weekly([2]), '2026-10')).toBeNull();
    });

    it('rend un jour où le rythme tombe, chaque mois de 2023 à 2031', () => {
        for (let month = '2023-01'; month <= '2031-12'; month = addDays(`${month}-28`, 7).slice(0, 7)) {
            for (const rhythm of [monthlyWeekday(3, 2), monthlyWeekday(5, LAST_WEEK), monthlyDate(30)]) {
                const day = dayIn(rhythm, month);
                if (day !== null) {
                    expect(day.slice(0, 7)).toBe(month);
                    expect(fallsOn(schedule(rhythm, '2023-01-01'), day)).toBe(true);
                }
            }
        }
    });
});

describe('monthlyChoices', () => {
    it('propose le rang du jour, du 1er au 4e, puis sa date', () => {
        expect(monthlyChoices('2026-10-02', WEEK)).toEqual([monthlyWeekday(5, 1), monthlyDate(2)]);
        expect(monthlyChoices('2026-10-16', WEEK)).toEqual([monthlyWeekday(5, 3), monthlyDate(16)]);
        expect(monthlyChoices('2026-10-23', WEEK)).toEqual([monthlyWeekday(5, 4), monthlyDate(23)]);
    });

    it('propose aussi « le dernier » quand il l’est : un 4e qui l’est, en trois choix', () => {
        expect(monthlyChoices('2026-11-27', WEEK)).toEqual([
            monthlyWeekday(5, 4),
            monthlyDate(27),
            monthlyWeekday(5, LAST_WEEK),
        ]);
    });

    it('ne propose jamais un 5e jour de la semaine : sa date, et le dernier', () => {
        expect(monthlyChoices('2026-10-29', WEEK)).toEqual([monthlyDate(29), monthlyWeekday(4, LAST_WEEK)]);
        expect(monthlyChoices('2026-10-30', WEEK)).toEqual([monthlyDate(30), monthlyWeekday(5, LAST_WEEK)]);
        expect(monthlyChoices('2026-12-31', WEEK)).toEqual([monthlyDate(31), monthlyWeekday(4, LAST_WEEK)]);
    });

    it('ne propose que la date un jour non travaillé : un rang y tomberait toujours un jour non travaillé', () => {
        expect(monthlyChoices('2026-10-10', WEEK)).toEqual([monthlyDate(10)]);
        expect(monthlyChoices('2026-10-31', WEEK)).toEqual([monthlyDate(31)]);
        // Travaillé selon les réglages, le samedi a son rang.
        expect(monthlyChoices('2026-10-10', [...WEEK, 6])).toEqual([monthlyWeekday(6, 2), monthlyDate(10)]);
    });

    it('ne propose que des rythmes qui tombent le jour même', () => {
        for (let day = '2026-01-01'; day <= '2028-12-31'; day = addDays(day, 1)) {
            for (const rhythm of monthlyChoices(day, [1, 2, 3, 4, 5, 6, 7])) {
                expect(fallsOn(schedule(rhythm, day), day)).toBe(true);
            }
        }
    });
});

describe('timeline', () => {
    it('ne montre pas ses fois détachées ou effacées, ni leur semaine en pointillé', () => {
        const poker = { ...schedule(weekly([2], 2), '2026-10-20'), skipped: ['2026-11-03'] };

        expect(timeline(poker, '2026-10-20', WEEK, 3)).toEqual([
            { date: '2026-10-27', falls: false },
            { date: '2026-11-10', falls: false },
            { date: '2026-11-17', falls: true },
        ]);
        expect(
            timeline({ ...schedule(weekly([2]), '2026-10-20'), skipped: ['2026-10-27'] }, '2026-10-20', WEEK, 2),
        ).toEqual([
            { date: '2026-11-03', falls: true },
            { date: '2026-11-10', falls: true },
        ]);
    });

    it('une semaine sur deux, un jour : chaque semaine, celles sans en pointillé', () => {
        const poker = schedule(weekly([2], 2), '2026-10-20');

        expect(timeline(poker, '2026-10-20', WEEK)).toEqual([
            { date: '2026-10-27', falls: false },
            { date: '2026-11-03', falls: true },
            { date: '2026-11-10', falls: false },
            { date: '2026-11-17', falls: true },
            { date: '2026-11-24', falls: false },
        ]);
    });

    it('une semaine sur deux à plusieurs jours : chaque jour d’une semaine où elle revient, une tuile par semaine sans', () => {
        const twice = schedule(weekly([1, 4], 2), '2026-11-12');

        expect(timeline(twice, '2026-11-11', WEEK)).toEqual([
            { date: '2026-11-12', falls: true },
            { date: '2026-11-16', falls: false },
            { date: '2026-11-23', falls: true },
            { date: '2026-11-26', falls: true },
            { date: '2026-11-30', falls: false },
        ]);
    });

    it('une semaine sur trois : deux semaines sans entre deux fois', () => {
        expect(timeline(schedule(weekly([3], 3), '2026-11-04'), '2026-11-04', WEEK, 4)).toEqual([
            { date: '2026-11-11', falls: false },
            { date: '2026-11-18', falls: false },
            { date: '2026-11-25', falls: true },
            { date: '2026-12-02', falls: false },
        ]);
    });

    it('ne finit pas sur une semaine sans quand la série s’arrête', () => {
        const ending = schedule(weekly([2], 2), '2026-11-10', '2026-12-01');

        expect(timeline(ending, '2026-11-10', WEEK)).toEqual([
            { date: '2026-11-17', falls: false },
            { date: '2026-11-24', falls: true },
        ]);
    });

    it('ne finit pas sur une semaine sans quand sa fin tombe la cinquième tuile', () => {
        // Mardi 7 novembre 2017, une semaine sur deux jusqu'au mardi 12 décembre, une semaine sans.
        const ending = schedule(weekly([2], 2), '2017-11-07', '2017-12-12');

        expect(timeline(ending, '2017-11-07', WEEK)).toEqual([
            { date: '2017-11-14', falls: false },
            { date: '2017-11-21', falls: true },
            { date: '2017-11-28', falls: false },
            { date: '2017-12-05', falls: true },
        ]);
    });

    it('ne montre rien quand plus aucune fois ne vient, même une semaine sans', () => {
        expect(timeline(schedule(weekly([2], 2), '2026-11-10', '2026-11-20'), '2026-11-10', WEEK)).toEqual([]);
        expect(timeline(schedule(weekly([2], 2), '2026-11-10', '2026-11-09'), '2026-11-01', WEEK)).toEqual([]);
        // Ses jours ne sont plus travaillés.
        expect(timeline(schedule(weekly([2], 2), '2026-11-10'), '2026-11-10', [1, 3, 4, 5])).toEqual([]);
    });

    it('montre les seules fois de chaque semaine et d’un rythme mensuel, comme nextTimes', () => {
        for (const shown of [
            schedule(weekly([1, 3]), '2026-11-02'),
            schedule(monthlyWeekday(5, 3), '2026-10-16'),
            schedule(monthlyDate(31), '2026-10-31', '2027-12-31'),
        ]) {
            expect(timeline(shown, '2026-11-02', WEEK)).toEqual(
                nextTimes(shown, '2026-11-02', WEEK).map((date) => ({ date, falls: true })),
            );
        }
    });

    it('ne rend que des fois où elle tombe, des semaines sans où elle ne tombe pas, croissantes, au plus `count`', () => {
        fc.assert(
            fc.property(
                fc.uniqueArray(fc.integer({ min: 1, max: 5 }), { minLength: 1, maxLength: 5 }),
                fc.integer({ min: 2, max: 4 }),
                dayArbitrary,
                fc.option(fc.integer({ min: 0, max: 120 }), { nil: null }),
                fc.integer({ min: -10, max: 30 }),
                fc.integer({ min: 0, max: 8 }),
                (days, every, firstDay, length, shift, count) => {
                    const shown = schedule(
                        weekly(days, every),
                        firstDay,
                        length === null ? null : addDays(firstDay, length),
                    );
                    const after = addDays(firstDay, shift);
                    const tiles = timeline(shown, after, WEEK, count);

                    expect(tiles.length).toBeLessThanOrEqual(count);
                    expect(tiles.length === 0 || tiles.some((tile) => tile.falls)).toBe(true);
                    tiles.forEach((tile, index) => {
                        expect(tile.date > after).toBe(true);
                        expect(fallsOn(shown, tile.date)).toBe(tile.falls);
                        expect(days.includes(isoWeekday(tile.date))).toBe(true);
                        expect(index === 0 || tile.date > (tiles[index - 1]?.date ?? '')).toBe(true);
                    });
                    // Ses fois sont celles de nextTimes, dans l'ordre.
                    const falling = tiles.filter((tile) => tile.falls).map((tile) => tile.date);
                    expect(falling).toEqual(nextTimes(shown, after, WEEK, falling.length));
                    // Une série qui s'arrête ne finit pas sur une semaine sans.
                    if (shown.until !== null && tiles.length < count) {
                        expect(tiles.at(-1)?.falls ?? true).toBe(true);
                    }
                },
            ),
        );
    });
});

describe('weekly', () => {
    it('range ses jours dans l’ordre, chacun une fois, chaque semaine', () => {
        expect(weekly([5, 1, 3, 1])).toEqual({
            kind: 'weekly',
            weekdays: [1, 3, 5],
            everyWeeks: 1,
            monthWeek: null,
            monthDay: null,
        });
    });
});

describe('fallsOn', () => {
    // Mardi 6 octobre 2026.
    const daily = schedule(weekly(WEEK), '2026-10-06', '2026-10-09');

    it('tombe dès son premier jour et jusqu’à sa fin, le jour même compris', () => {
        expect(fallsOn(daily, '2026-10-05')).toBe(false);
        expect(fallsOn(daily, '2026-10-06')).toBe(true);
        expect(fallsOn(daily, '2026-10-09')).toBe(true);
        expect(fallsOn(daily, '2026-10-12')).toBe(false);
    });

    it('ne tombe jamais une fois retirée, la veille de son premier jour pour fin', () => {
        const withdrawn = schedule(weekly(WEEK), '2026-10-06', '2026-10-05');

        for (let date = '2026-10-01'; date < '2026-12-31'; date = addDays(date, 1)) {
            expect(fallsOn(withdrawn, date)).toBe(false);
        }
        expect(nextTimes(withdrawn, '2026-10-01', WEEK)).toEqual([]);
    });

    it('ne tombe que ses jours de la semaine, que les réglages les travaillent ou non', () => {
        const weekend = schedule(weekly([6, 7]), '2026-10-06');

        expect(fallsOn(weekend, '2026-10-10')).toBe(true);
        expect(fallsOn(weekend, '2026-10-12')).toBe(false);
        expect(nextTimes(weekend, '2026-10-06', WEEK)).toEqual([]);
        expect(nextTimes(weekend, '2026-10-06', [6], 2)).toEqual(['2026-10-10', '2026-10-17']);
    });

    it('compte le dernier jour de la semaine du mois, et le 1er', () => {
        const lastFriday = schedule(
            { kind: 'monthly_weekday', weekdays: [5], everyWeeks: 1, monthWeek: LAST_WEEK, monthDay: null },
            '2026-01-01',
        );
        const first = schedule(
            { kind: 'monthly_date', weekdays: [], everyWeeks: 1, monthWeek: null, monthDay: 1 },
            '2026-01-01',
        );

        expect(fallsOn(lastFriday, '2026-10-30')).toBe(true);
        expect(fallsOn(lastFriday, '2026-10-23')).toBe(false);
        expect(fallsOn(first, '2026-11-01')).toBe(true);
        expect(fallsOn(first, '2026-11-02')).toBe(false);
    });
});

describe('nextTimes', () => {
    it('saute ses fois détachées ou effacées', () => {
        const daily = { ...schedule(weekly(WEEK), '2026-10-06'), skipped: ['2026-10-08', '2026-10-09'] };

        expect(nextTimes(daily, '2026-10-06', WEEK, 3)).toEqual(['2026-10-07', '2026-10-12', '2026-10-13']);
    });

    it('commence au lendemain, ou au premier jour s’il est à venir, le premier jour compris', () => {
        const daily = schedule(weekly(WEEK), '2026-10-06');

        expect(nextTimes(daily, '2026-10-06', WEEK, 1)).toEqual(['2026-10-07']);
        expect(nextTimes(daily, '2026-10-01', WEEK, 1)).toEqual(['2026-10-06']);
        expect(nextTimes(daily, '2026-10-05', WEEK, 1)).toEqual(['2026-10-06']);
    });

    it('n’en rend aucune pour zéro, et cinq par défaut', () => {
        const daily = schedule(weekly(WEEK), '2026-10-06');

        expect(nextTimes(daily, '2026-10-06', WEEK, 0)).toEqual([]);
        expect(nextTimes(daily, '2026-10-06', WEEK)).toHaveLength(5);
    });

    it('ne cherche pas au-delà de deux ans quand aucun jour travaillé ne vient', () => {
        const never = schedule(weekly([7]), '2026-10-06');

        expect(nextTimes(never, '2026-10-06', WEEK, 5)).toEqual([]);
        expect(nextTimes(never, '2026-10-06', [], 5)).toEqual([]);
    });

    it('rend des jours croissants, après `after`, qui tombent et sont travaillés, jusqu’à sa fin', () => {
        const day = fc.integer({ min: 0, max: 400 }).map((offset) => addDays('2026-01-01', offset));
        const weekdays = fc.uniqueArray(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 7 });
        fc.assert(
            fc.property(
                weekdays,
                day,
                fc.option(day),
                day,
                weekdays,
                fc.integer({ min: 0, max: 8 }),
                (days, firstDay, until, after, working, count) => {
                    const shared = schedule(weekly(days), firstDay, until);
                    const times = nextTimes(shared, after, working, count);

                    expect(times.length).toBeLessThanOrEqual(count);
                    times.forEach((date, index) => {
                        expect(date > after).toBe(true);
                        expect(date >= firstDay).toBe(true);
                        expect(until === null || date <= until).toBe(true);
                        expect(fallsOn(shared, date)).toBe(true);
                        expect(working.includes(isoWeekday(date))).toBe(true);
                        expect(index === 0 || date > (times[index - 1] ?? '')).toBe(true);
                    });
                },
            ),
        );
    });
});

describe('detach', () => {
    const nine = minutes('09:00');
    const ten = minutes('10:00');
    /** Le Daily de la récurrence « a », de 09:00 à 09:30 ; le déjeuner de « b », de 12:30 à 13:30. */
    const day = gridOf([
        ['09:00', '09:30', 'work', 'OPS-12', 'Daily', 'a'],
        ['09:30', '10:00', 'work', 'OPS-12', 'Daily'],
        ['10:00', '10:15', 'work', 'OPS-12', 'Daily', 'a'],
        ['12:30', '13:30', 'pause', null, null, 'b'],
    ]);
    const daily = work('OPS-12', 'Daily');

    it('laisse le geste tel quel quand il ne prend rien à une récurrence', () => {
        const changes = fill([minutes('11:00'), minutes('09:30')], PAUSE);

        expect(detach(day, changes)).toBe(changes);
    });

    it('détache la fois entière, ses morceaux compris, quand un geste lui prend un quart d’heure', () => {
        const changes = fill([minutes('09:15')], null);

        expect(detach(day, changes)).toEqual(
            new Map<number, Cell>([
                [minutes('09:15'), null],
                [nine, daily],
                [ten, daily],
            ]),
        );
    });

    it('détache aussi quand le geste pose le même contenu à la main, et laisse l’autre récurrence', () => {
        const changes = fill([minutes('12:30')], PAUSE);

        expect(detach(day, changes)).toEqual(
            new Map<number, Cell>([
                [minutes('12:30'), PAUSE],
                [minutes('12:45'), PAUSE],
                [minutes('13:00'), PAUSE],
                [minutes('13:15'), PAUSE],
            ]),
        );
    });

    it('ne détache rien quand annuler rend un quart d’heure à sa récurrence', () => {
        const changes = fill([nine, minutes('09:15')], work('OPS-12', 'Daily', 'a'));

        expect(detach(day, changes)).toBe(changes);
    });

    it('détache la récurrence qu’un quart d’heure quitte pour une autre', () => {
        const changes = fill([minutes('12:30')], linkedTo(PAUSE, 'c'));

        expect(detach(day, changes).get(minutes('13:15'))).toEqual(PAUSE);
    });

    it('détache deux récurrences touchées par le même geste, sans réécrire ce que le geste nomme', () => {
        const changes = new Map<number, Cell>([
            [ten, work('SHOP-482')],
            [minutes('13:00'), null],
            [nine, null],
        ]);
        const all = detach(day, changes);

        expect(all.get(nine)).toBeNull();
        expect(all.get(ten)).toEqual(work('SHOP-482'));
        expect(all.get(minutes('09:15'))).toEqual(daily);
        expect(all.get(minutes('12:30'))).toEqual(PAUSE);
        expect(all.has(minutes('09:30'))).toBe(false);
        expect(occurrenceIn(day.with(all), 'a')).toEqual([]);
        expect(occurrenceIn(day.with(all), 'b')).toEqual([]);
    });

    it('ne laisse jamais une fois à moitié liée : ce qu’elle garde, le geste le lui a rendu', () => {
        fc.assert(
            fc.property(
                linkedGridArbitrary,
                fc.array(fc.tuple(quarterArbitrary, linkedCellArbitrary), { minLength: 1 }),
                (grid, pairs) => {
                    const changes = new Map(pairs);
                    const all = detach(grid, changes);
                    const after = grid.with(all);
                    const lost = new Set(
                        [...changes].flatMap(([quarter, cell]) => {
                            const before = grid.at(quarter)?.recurrence ?? null;

                            return before !== null && before !== (cell?.recurrence ?? null) ? [before] : [];
                        }),
                    );
                    for (const [quarter, cell] of changes) {
                        expect(all.get(quarter)).toBe(cell);
                    }
                    for (const quarter of Quarter.all()) {
                        const before = grid.at(quarter);
                        if (changes.has(quarter)) {
                            continue;
                        }
                        // Hors du geste, un quart d'heure garde ce qu'il montre ; seul son lien part.
                        const now = after.at(quarter);
                        if (before === null || now === null) {
                            expect(now).toBe(before);
                            continue;
                        }
                        expect(sameContent(now, before)).toBe(true);
                        expect(now.recurrence).toBe(
                            before.recurrence !== null && lost.has(before.recurrence) ? null : before.recurrence,
                        );
                    }
                    for (const recurrence of lost) {
                        for (const quarter of occurrenceIn(after, recurrence)) {
                            expect(changes.get(quarter)?.recurrence).toBe(recurrence);
                        }
                    }
                },
            ),
        );
    });
});

describe('occurrenceIn', () => {
    it('rend les quarts d’heure qu’elle a posés ce jour-là, dans l’ordre, et rien pour une autre', () => {
        const grid = Grid.of([
            [minutes('10:00'), work('OPS-12', null, 'a')],
            [minutes('09:00'), work('OPS-12', null, 'a')],
            [minutes('09:15'), work('OPS-12')],
        ]);

        expect(occurrenceIn(grid, 'a')).toEqual([minutes('09:00'), minutes('10:00')]);
        expect(occurrenceIn(grid, 'b')).toEqual([]);
        expect(occurrenceIn(Grid.empty(), 'a')).toEqual([]);
    });

    it('ne compte jamais un quart d’heure à la main', () => {
        expect(occurrenceIn(gridOf([['09:00', '10:00', 'work', 'OPS-12', null]]), 'a')).toEqual([]);
        expect(unlinked(work('OPS-12', null, 'a')).recurrence).toBeNull();
    });
});

describe('readRecurrences', () => {
    const daily = {
        start: '09:15',
        end: '09:30',
        kind: 'weekly',
        weekdays: [1, 2, 3, 4, 5],
        everyWeeks: 1,
        monthWeek: null,
        monthDay: null,
        firstDay: '2026-10-06',
        until: null,
        slot: { kind: 'work', ticket: 'OPS-12', comment: 'Daily' },
    };

    it('lit chaque récurrence par son identifiant, et ce qu’elle pose', () => {
        const read = readRecurrences({
            a: daily,
            b: { ...daily, until: '2026-12-31', weekdays: [2], slot: { kind: 'pause', ticket: null, comment: null } },
            c: { ...daily, slot: { kind: 'work', ticket: 'OPS-12', comment: null } },
        });

        expect(read.get('a')).toEqual({
            id: 'a',
            start: minutes('09:15'),
            end: minutes('09:30'),
            rhythm: weekly([1, 2, 3, 4, 5]),
            firstDay: '2026-10-06',
            until: null,
            content: { kind: 'work', ticket: 'OPS-12', comment: 'Daily' },
        });
        expect(read.get('b')?.content).toEqual({ kind: 'pause' });
        expect(read.get('c')?.content).toEqual({ kind: 'work', ticket: 'OPS-12', comment: null });
        expect(read.get('b')?.until).toBe('2026-12-31');
        expect(read.get('b')?.rhythm.weekdays).toEqual([2]);
        expect(readRecurrences({}).size).toBe(0);
    });

    it('lit ses fois détachées ou effacées à venir, et refuse ce qui n’en a pas la forme', () => {
        const read = readRecurrences({ a: { ...daily, skipped: ['2026-10-13', '2026-10-20'] }, b: daily });

        expect(read.get('a')?.skipped).toEqual(['2026-10-13', '2026-10-20']);
        expect(read.get('b')?.skipped).toBeUndefined();
        expect(() => readRecurrences({ a: { ...daily, skipped: '2026-10-13' } })).toThrow(TypeError);
        expect(() => readRecurrences({ a: { ...daily, skipped: ['13/10/2026'] } })).toThrow(TypeError);
    });

    it('lit une semaine sur n, et les rythmes au mois', () => {
        const read = readRecurrences({
            a: { ...daily, kind: 'monthly_weekday', weekdays: [5], monthWeek: -1 },
            b: { ...daily, kind: 'monthly_date', weekdays: [], monthDay: 31 },
            c: { ...daily, weekdays: [1, 4], everyWeeks: 3 },
        });

        expect(read.get('c')?.rhythm).toEqual(weekly([1, 4], 3));

        expect(read.get('a')?.rhythm).toEqual({
            kind: 'monthly_weekday',
            weekdays: [5],
            everyWeeks: 1,
            monthWeek: LAST_WEEK,
            monthDay: null,
        });
        expect(read.get('b')?.rhythm.monthDay).toBe(31);
    });

    it.each([
        ['un tableau', []],
        ['rien', null],
        ['un texte', 'a'],
    ])('refuse %s au lieu d’un objet', (_, json) => {
        expect(() => readRecurrences(json)).toThrow(TypeError);
    });

    it.each([
        ['une récurrence qui n’est pas un objet', 'chaque jour'],
        ['une heure de travers', { ...daily, start: '9:15' }],
        ['une fin absente', { ...daily, end: undefined }],
        ['un rythme inconnu', { ...daily, kind: 'daily' }],
        ['des jours qui ne sont pas une liste', { ...daily, weekdays: '1,2' }],
        ['un jour 0', { ...daily, weekdays: [0, 1] }],
        ['un jour 8', { ...daily, weekdays: [8] }],
        ['un jour à virgule', { ...daily, weekdays: [1.5] }],
        ['un jour écrit en texte', { ...daily, weekdays: ['1'] }],
        ['une semaine sur zéro', { ...daily, everyWeeks: 0 }],
        ['une semaine sur 1,5', { ...daily, everyWeeks: 1.5 }],
        ['une semaine du mois en texte', { ...daily, monthWeek: 'dernière' }],
        ['une semaine du mois absente', { ...daily, monthWeek: undefined }],
        ['une date du mois en texte', { ...daily, monthDay: '31' }],
        ['un premier jour qui n’existe pas', { ...daily, firstDay: '2026-02-30' }],
        ['un premier jour absent', { ...daily, firstDay: undefined }],
        ['une fin qui n’est pas une date', { ...daily, until: '31/12/2026' }],
        ['une fin absente du jour', { ...daily, until: undefined }],
        ['ce qu’elle pose, absent', { ...daily, slot: undefined }],
        ['ce qu’elle pose, d’une nature inconnue', { ...daily, slot: { kind: 'empty', ticket: null, comment: null } }],
        ['un ticket absent de ce qu’elle pose', { ...daily, slot: { kind: 'work', ticket: null, comment: null } }],
        ['un commentaire qui n’est pas un texte', { ...daily, slot: { kind: 'work', ticket: 'OPS-12', comment: 7 } }],
    ])('refuse %s', (_, recurrence) => {
        expect(() => readRecurrences({ a: recurrence })).toThrow(TypeError);
    });
});

describe('followRhythm : le rythme d’une récurrence coupée, collé un autre jour', () => {
    /** Le mercredi 21 octobre 2026, le jeudi 22, le mardi 27 et le jeudi 29. */
    const WEDNESDAY_21 = '2026-10-21';
    const THURSDAY_22 = '2026-10-22';
    const TUESDAY_27 = '2026-10-27';
    const THURSDAY_29 = '2026-10-29';
    /** Les jours que les réglages travaillent : du lundi au vendredi. */
    const WEEK = [1, 2, 3, 4, 5];

    it('un seul jour par semaine prend celui du collage, à la même cadence', () => {
        // Le poker planning, un mardi sur deux, collé le mercredi 21 : un mercredi sur deux.
        expect(followRhythm(weekly([2], 2), WEDNESDAY_21, WEEK)).toEqual(weekly([3], 2));
        expect(followRhythm(weekly([5]), THURSDAY_22, WEEK)).toEqual(weekly([4]));
        expect(followRhythm(weekly([1], 4), TUESDAY_27, WEEK)).toEqual(weekly([2], 4));
    });

    it('plusieurs jours par semaine restent les mêmes : seules ses heures changent', () => {
        // Le Daily, du lundi au vendredi.
        expect(followRhythm(weekly([1, 2, 3, 4, 5]), WEDNESDAY_21, WEEK)).toEqual(weekly([1, 2, 3, 4, 5]));
        expect(followRhythm(weekly([2, 4], 2), WEDNESDAY_21, WEEK)).toEqual(weekly([2, 4], 2));
    });

    it('plusieurs jours par semaine perdent ceux que les réglages ne travaillent plus ; sans aucun, rien', () => {
        // Le vendredi décoché depuis la coupe du Daily : du lundi au jeudi.
        expect(followRhythm(weekly([1, 2, 3, 4, 5]), WEDNESDAY_21, [1, 2, 3, 4])).toEqual(weekly([1, 2, 3, 4]));
        expect(followRhythm(weekly([2, 4], 2), WEDNESDAY_21, [1, 3, 4, 5])).toEqual(weekly([4], 2));
        expect(followRhythm(weekly([2, 4], 2), WEDNESDAY_21, [1, 3, 5])).toBeNull();
        // Un seul jour prend celui du collage, que les réglages travaillent.
        expect(followRhythm(weekly([5]), WEDNESDAY_21, [1, 2, 3])).toEqual(weekly([3]));
    });

    it('un n-ième jour du mois prend celui du collage, à son rang', () => {
        // Le 3e vendredi, collé le jeudi 22 : le 4e jeudi du mois.
        expect(followRhythm(monthlyWeekday(5, 3), THURSDAY_22, WEEK)).toEqual(monthlyWeekday(4, 4));
        expect(followRhythm(monthlyWeekday(2, 1), WEDNESDAY_21, WEEK)).toEqual(monthlyWeekday(3, 3));
    });

    it('un 5e, qui n’existe pas tous les mois, devient le dernier', () => {
        expect(followRhythm(monthlyWeekday(5, 3), THURSDAY_29, WEEK)).toEqual(monthlyWeekday(4, LAST_WEEK));
    });

    it('le dernier le reste sur un dernier, et prend son rang ailleurs', () => {
        expect(followRhythm(monthlyWeekday(5, LAST_WEEK), TUESDAY_27, WEEK)).toEqual(monthlyWeekday(2, LAST_WEEK));
        expect(followRhythm(monthlyWeekday(5, LAST_WEEK), THURSDAY_22, WEEK)).toEqual(monthlyWeekday(4, 4));
        // Un 2e collé sur le dernier mardi, qui est aussi le 4e : il garde son rang.
        expect(followRhythm(monthlyWeekday(5, 2), TUESDAY_27, WEEK)).toEqual(monthlyWeekday(2, 4));
    });

    it('une date du mois devient celle du collage', () => {
        // Le 16, collé le 21 : le 21.
        expect(followRhythm(monthlyDate(16), WEDNESDAY_21, WEEK)).toEqual(monthlyDate(21));
        expect(followRhythm(monthlyDate(31), '2026-11-02', WEEK)).toEqual(monthlyDate(2));
    });

    it('tombe toujours le jour du collage, sauf plusieurs jours par semaine, qui restent ce qu’ils étaient', () => {
        const rhythms = fc.oneof(
            fc
                .tuple(
                    fc.uniqueArray(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 7 }),
                    fc.integer({ min: 1, max: 4 }),
                )
                .map(([days, every]) => weekly(days, every)),
            fc
                .tuple(fc.integer({ min: 1, max: 7 }), fc.constantFrom(1, 2, 3, 4, LAST_WEEK))
                .map(([day, week]) => monthlyWeekday(day, week)),
            fc.integer({ min: 1, max: 31 }).map((day) => monthlyDate(day)),
        );
        const dates = fc.integer({ min: 0, max: 800 }).map((offset) => addDays('2026-01-01', offset));
        fc.assert(
            fc.property(rhythms, dates, (rhythm, date) => {
                // Chaque jour travaillé : il lui en reste toujours un.
                const followed = followRhythm(rhythm, date, [1, 2, 3, 4, 5, 6, 7]);
                if (followed === null) {
                    throw new Error(`${JSON.stringify(rhythm)} ne suit rien le ${date}.`);
                }
                expect(followed.kind).toBe(rhythm.kind);
                if (rhythm.kind === 'weekly' && rhythm.weekdays.length > 1) {
                    expect(followed).toEqual(rhythm);

                    return;
                }
                expect(fallsOn({ rhythm: followed, firstDay: date, until: null }, date)).toBe(true);
                if (rhythm.kind === 'weekly') {
                    expect(followed.everyWeeks).toBe(rhythm.everyWeeks);
                }
            }),
        );
    });
});

describe('ruleOf', () => {
    it('rend son rythme et sa fin, tels que la fenêtre les enverrait', () => {
        const recurrence: Recurrence = {
            id: 'a',
            rhythm: weekly([2], 2),
            firstDay: '2026-10-06',
            until: '2026-11-04',
            start: minutes('09:00'),
            end: minutes('09:30'),
            content: work('OPS-12', 'Daily'),
        };

        expect(ruleOf(recurrence)).toEqual({ ...weekly([2], 2), until: '2026-11-04' });
    });
});

describe('lastTime', () => {
    it('rend sa dernière fois, au plus tard à sa fin : jamais la veille d’une coupe', () => {
        // Chaque mardi, coupée le mardi 1er décembre : sa fin est le lundi 30 novembre.
        expect(lastTime(schedule(weekly([2]), '2026-11-24', '2026-11-30'))).toBe('2026-11-24');
        // Finie un jour où elle tombe : ce jour-là.
        expect(lastTime(schedule(weekly([2]), '2026-11-24', '2026-12-08'))).toBe('2026-12-08');
        expect(lastTime(schedule(weekly([2]), '2026-11-24'))).toBeNull();
    });

    it('à chaque rythme : une semaine sur n, un rang ou une date du mois', () => {
        expect(lastTime(schedule(weekly([2, 4], 3), '2026-10-05', '2026-11-04'))).toBe('2026-10-29');
        expect(lastTime(schedule(monthlyWeekday(5, LAST_WEEK), '2026-01-01', '2026-12-24'))).toBe('2026-11-27');
        // Le 31 : ni novembre ni septembre n'en ont.
        expect(lastTime(schedule(monthlyDate(31), '2026-01-01', '2026-11-30'))).toBe('2026-10-31');
        expect(lastTime(schedule(monthlyDate(31), '2026-08-01', '2026-09-30'))).toBe('2026-08-31');
    });

    it('ne rend qu’une fois qui se pose : ni détachée ou effacée, ni un jour que les réglages ne travaillent pas', () => {
        const cut = { ...schedule(weekly([2]), '2026-11-03', '2026-12-07'), skipped: ['2026-12-01'] };
        expect(lastTime(cut)).toBe('2026-11-24');
        expect(lastTime({ ...cut, skipped: [] })).toBe('2026-12-01');
        // Le 14 de chaque mois, coupé le lundi 14 décembre : le samedi 14 novembre n'est pas travaillé.
        expect(lastTime(schedule(monthlyDate(14), '2026-06-01', '2026-12-13'), WEEK)).toBe('2026-10-14');
        expect(lastTime(schedule(monthlyDate(14), '2026-06-01', '2026-12-13'))).toBe('2026-11-14');
        // Toutes sautées : le dernier jour où son rythme tombe.
        expect(lastTime({ ...schedule(weekly([2]), '2026-11-24', '2026-11-30'), skipped: ['2026-11-24'] })).toBe(
            '2026-11-24',
        );
    });

    it('sans aucune fois avant sa fin, rend sa fin', () => {
        // Créée un vendredi pour chaque lundi, puis coupée le lundi suivant.
        expect(lastTime(schedule(weekly([1]), '2026-10-09', '2026-10-11'))).toBe('2026-10-11');
    });

    it('tombe toujours un jour où elle tombe, au plus tard à sa fin', () => {
        fc.assert(
            fc.property(
                fc.oneof(
                    fc
                        .tuple(
                            fc.uniqueArray(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 3 }),
                            fc.integer({ min: 1, max: 4 }),
                        )
                        .map(([days, every]) => weekly(days, every)),
                    fc
                        .tuple(fc.integer({ min: 1, max: 7 }), fc.constantFrom(1, 2, 3, 4, LAST_WEEK))
                        .map(([weekday, week]) => monthlyWeekday(weekday, week)),
                    fc.integer({ min: 1, max: 31 }).map(monthlyDate),
                ),
                fc.integer({ min: 0, max: 400 }),
                fc.integer({ min: 0, max: 400 }),
                (rhythm, start, length) => {
                    const firstDay = addDays('2026-01-01', start);
                    const until = addDays(firstDay, length);
                    const last = lastTime(schedule(rhythm, firstDay, until)) ?? '';
                    const falls = fallsOn(schedule(rhythm, firstDay, until), last);
                    expect(last <= until).toBe(true);
                    // Aucune fois entre elle et la fin.
                    for (let date = addDays(last, 1); date <= until; date = addDays(date, 1)) {
                        expect(fallsOn(schedule(rhythm, firstDay, until), date)).toBe(false);
                    }
                    expect(falls || last === until).toBe(true);
                },
            ),
        );
    });
});
