import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    addDays,
    addMonths,
    calendarKeyTarget,
    dayLabel,
    dayOfMonthLabel,
    dayTitle,
    isDate,
    isoWeekday,
    isWorkingDay,
    lastOpenDay,
    monthOf,
    monthTitle,
    monthWeeks,
    nextWorkingDay,
    tenseOf,
    weekdayName,
} from '../../../assets/day/calendar';

const dates = fc
    .date({ min: new Date('1970-01-01T00:00:00Z'), max: new Date('2099-12-31T00:00:00Z'), noInvalidDate: true })
    .map(
        (date) =>
            `${String(date.getUTCFullYear())}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`,
    );

describe('addDays', () => {
    it.each([
        ['2026-10-06', 1, '2026-10-07'],
        ['2026-10-31', 1, '2026-11-01'],
        ['2026-12-31', 1, '2027-01-01'],
        ['2028-02-28', 1, '2028-02-29'],
        ['2027-02-28', 1, '2027-03-01'],
        ['2026-03-01', -1, '2026-02-28'],
        // Les nuits du changement d'heure, à Paris : un jour reste un jour.
        ['2026-03-28', 1, '2026-03-29'],
        ['2026-03-29', 1, '2026-03-30'],
        ['2026-10-25', -1, '2026-10-24'],
        ['2026-10-06', 30, '2026-11-05'],
        ['0099-12-31', 1, '0100-01-01'],
    ])('%s %i → %s', (date, days, expected) => {
        expect(addDays(date, days)).toBe(expected);
    });

    it('un jour en avant puis un en arrière ramène au même jour, toujours un jour du calendrier', () => {
        fc.assert(
            fc.property(dates, fc.integer({ min: -400, max: 400 }), (date, days) => {
                const moved = addDays(date, days);

                expect(isDate(moved)).toBe(true);
                expect(addDays(moved, -days)).toBe(date);
                expect(Math.sign(moved.localeCompare(date))).toBe(Math.sign(days));
            }),
        );
    });

    it('refuse ce qui n’est pas un jour', () => {
        expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
        expect(() => addDays('demain', 1)).toThrow(RangeError);
    });
});

describe('isDate', () => {
    it.each(['2026-10-06', '2028-02-29', '2000-02-29'])('%s est un jour', (date) => {
        expect(isDate(date)).toBe(true);
    });

    it.each([
        '2026-02-30',
        '2027-02-29',
        '1900-02-29',
        '2026-13-01',
        '2026-00-10',
        '2026-10-6',
        '2026-10-06T00:00',
        '',
    ])('« %s » n’en est pas un', (date) => {
        expect(isDate(date)).toBe(false);
    });
});

describe('tenseOf', () => {
    it('place un jour par rapport à aujourd’hui', () => {
        expect(tenseOf('2026-10-06', '2026-10-06')).toBe('today');
        expect(tenseOf('2026-10-05', '2026-10-06')).toBe('past');
        expect(tenseOf('2025-12-31', '2026-01-01')).toBe('past');
        expect(tenseOf('2026-10-07', '2026-10-06')).toBe('future');
    });
});

describe('lastOpenDay', () => {
    it('s’arrête trente jours devant aujourd’hui, comme le serveur', () => {
        expect(lastOpenDay('2026-10-06', 30)).toBe('2026-11-05');
    });
});

describe('dayTitle', () => {
    it.each([
        ['2026-10-06', 'Mardi 6 octobre 2026'],
        ['2026-10-02', 'Vendredi 2 octobre 2026'],
        ['2026-10-01', 'Jeudi 1er octobre 2026'],
        ['2026-02-01', 'Dimanche 1er février 2026'],
        ['2026-08-15', 'Samedi 15 août 2026'],
        ['2026-12-31', 'Jeudi 31 décembre 2026'],
    ])('%s → %s', (date, title) => {
        expect(dayTitle(date)).toBe(title);
    });

    it('ne dépend pas du fuseau du poste', () => {
        fc.assert(
            fc.property(dates, (date) => {
                const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
                const names = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

                expect(dayTitle(date).startsWith(`${names[weekday] ?? ''} `)).toBe(true);
                expect(dayTitle(date).endsWith(` ${date.slice(0, 4)}`)).toBe(true);
            }),
        );
    });
});

describe('les infobulles des flèches', () => {
    it('nomment le jour visé sans l’année, « 1er » compris', () => {
        expect(dayLabel('2026-10-23')).toBe('Vendredi 23 octobre');
        expect(dayLabel('2026-11-01')).toBe('Dimanche 1er novembre');
    });
});

const WEEK = [1, 2, 3, 4, 5];

describe('isoWeekday', () => {
    it.each([
        ['2026-10-05', 1],
        ['2026-10-03', 6],
        ['2026-10-04', 7],
        ['2027-01-01', 5],
    ])('%s → %i', (date, day) => {
        expect(isoWeekday(date)).toBe(day);
        expect(weekdayName(date)).toBe(
            ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'][day],
        );
    });
});

describe('nextWorkingDay', () => {
    it.each([
        // Les flèches sautent le week-end : l'erreur du lundi matin ne se fait plus.
        ['2026-10-02', 1, WEEK, '2026-10-05'],
        ['2026-10-05', -1, WEEK, '2026-10-02'],
        ['2026-10-03', 1, WEEK, '2026-10-05'],
        ['2026-10-03', -1, WEEK, '2026-10-02'],
        ['2026-10-06', 1, WEEK, '2026-10-07'],
        ['2026-12-31', 1, WEEK, '2027-01-01'],
        // Un samedi travaillé n'est plus sauté.
        ['2026-10-02', 1, [1, 2, 3, 4, 5, 6], '2026-10-03'],
        // Un seul jour travaillé : d'un mercredi à l'autre.
        ['2026-10-07', 1, [3], '2026-10-14'],
        ['2026-10-07', -1, [3], '2026-09-30'],
        // Aucun : de jour en jour.
        ['2026-10-02', 1, [], '2026-10-03'],
        ['2026-10-05', -1, [], '2026-10-04'],
    ] as const)('%s %i %j → %s', (date, step, days, expected) => {
        expect(nextWorkingDay(date, step, days)).toBe(expected);
    });

    it('rend toujours un jour travaillé, au plus une semaine plus loin', () => {
        fc.assert(
            fc.property(
                dates,
                fc.constantFrom(1 as const, -1 as const),
                fc.uniqueArray(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 7 }),
                (date, step, days) => {
                    const next = nextWorkingDay(date, step, days);
                    expect(isWorkingDay(next, days)).toBe(true);
                    for (let day = addDays(date, step); day !== next; day = addDays(day, step)) {
                        expect(isWorkingDay(day, days)).toBe(false);
                    }
                    expect(step === 1 ? next > date : next < date).toBe(true);
                    expect(Math.abs(Date.parse(next) - Date.parse(date))).toBeLessThanOrEqual(7 * 86_400_000);
                },
            ),
        );
    });
});

describe('monthWeeks', () => {
    it('octobre 2026 tient en cinq semaines, du lundi 28 septembre au dimanche 1er novembre', () => {
        const weeks = monthWeeks('2026-10');

        expect(weeks).toHaveLength(5);
        expect(weeks[0]?.[0]).toBe('2026-09-28');
        expect(weeks.at(-1)?.[6]).toBe('2026-11-01');
    });

    it.each([
        // Commence un samedi, 31 jours : six semaines.
        ['2026-08', 6],
        // Février qui commence un lundi, sans 29 : quatre.
        ['2027-02', 4],
        ['2026-02', 5],
        ['2028-02', 5],
        ['2027-05', 6],
    ])('%s : %i semaines', (month, count) => {
        expect(monthWeeks(month)).toHaveLength(count);
    });

    it('chaque semaine va du lundi au dimanche et le mois y est en entier, sans semaine de trop', () => {
        fc.assert(
            fc.property(dates, (date) => {
                const month = monthOf(date);
                const weeks = monthWeeks(month);
                const days = weeks.flat();

                expect(weeks.length).toBeGreaterThanOrEqual(4);
                expect(weeks.length).toBeLessThanOrEqual(6);
                for (const week of weeks) {
                    expect(week.map(isoWeekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
                    expect(week.some((day) => monthOf(day) === month)).toBe(true);
                }
                for (let index = 1; index < days.length; index += 1) {
                    expect(days[index]).toBe(addDays(days[index - 1] ?? '', 1));
                }
                expect(days).toContain(`${month}-01`);
                expect(days).toContain(addDays(`${addMonths(month, 1)}-01`, -1));
            }),
        );
    });
});

describe('les mois', () => {
    it.each([
        ['2026-10', 1, '2026-11'],
        ['2026-12', 1, '2027-01'],
        ['2026-01', -1, '2025-12'],
        ['0100-01', -1, '0099-12'],
    ])('%s %i → %s', (month, months, expected) => {
        expect(addMonths(month, months)).toBe(expected);
    });

    it('s’écrivent comme le titre du calendrier', () => {
        expect(monthTitle('2026-10')).toBe('Octobre 2026');
        expect(monthTitle('2027-08')).toBe('Août 2027');
        expect(dayOfMonthLabel('2026-10-02')).toBe('2 octobre');
        // Le chiffre affiché, jamais « 1er » : le nom d'un bouton contient son texte visible.
        expect(dayOfMonthLabel('2026-11-01')).toBe('1 novembre');
    });
});

describe('calendarKeyTarget', () => {
    it.each([
        ['ArrowRight', '2026-10-07'],
        ['ArrowLeft', '2026-10-05'],
        ['ArrowDown', '2026-10-13'],
        ['ArrowUp', '2026-09-29'],
        ['Home', '2026-10-05'],
        ['End', '2026-10-11'],
        ['PageDown', '2026-11-06'],
        ['PageUp', '2026-09-06'],
        ['Enter', null],
        ['a', null],
    ])('depuis le mardi 6 octobre, %s → %s', (key, expected) => {
        expect(calendarKeyTarget('2026-10-06', key)).toBe(expected);
    });

    it('ramène au dernier jour d’un mois plus court', () => {
        expect(calendarKeyTarget('2026-01-31', 'PageDown')).toBe('2026-02-28');
        expect(calendarKeyTarget('2028-03-31', 'PageUp')).toBe('2028-02-29');
        expect(calendarKeyTarget('2026-12-31', 'PageDown')).toBe('2027-01-31');
    });
});
