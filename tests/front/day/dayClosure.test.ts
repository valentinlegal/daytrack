import { describe, expect, it } from 'vitest';

import { type ClosureFacts, closureReason, staysOpen } from '../../../assets/day/dayClosure';
import type { DayState } from '../../../assets/grid/day';
import { Grid } from '../../../assets/grid/grid';
import { NOTHING_SENT } from '../../../assets/grid/send';
import { gridOf } from '../grid/support';

/** Lundi 6 octobre 2025, et le samedi 11. */
const MONDAY = '2025-10-06';
const SATURDAY = '2025-10-11';
const WEEK = [1, 2, 3, 4, 5];

function dayOf(date: string, overrides: Partial<DayState> = {}): DayState {
    return {
        date,
        version: 1,
        objective: 450,
        habitualObjective: 450,
        working: true,
        declaredOff: false,
        workingDays: WEEK,
        grid: Grid.empty(),
        send: NOTHING_SENT,
        ...overrides,
    };
}

function facts(overrides: Partial<ClosureFacts>): ClosureFacts {
    return { date: MONDAY, day: null, workingDays: WEEK, daysOff: null, openedAnyway: null, ...overrides };
}

const FILLED = gridOf([['09:00', '10:00', 'work', 'SHOP-482', null]]);

describe('closureReason', () => {
    it('laisse ouvert un jour travaillé, lu ou pas encore', () => {
        expect(closureReason(facts({}))).toBeNull();
        expect(closureReason(facts({ day: dayOf(MONDAY) }))).toBeNull();
    });

    it('ferme un jour que les réglages ne travaillent pas, dès la lecture, et dit lequel', () => {
        const reason = "Samedi n'est pas un jour travaillé.";
        expect(closureReason(facts({ date: SATURDAY }))).toBe(reason);
        expect(closureReason(facts({ date: SATURDAY, day: dayOf(SATURDAY, { working: false, objective: 0 }) }))).toBe(
            reason,
        );
    });

    it('suit la journée lue plutôt que les réglages du chargement : un autre onglet a pu les changer', () => {
        expect(closureReason(facts({ date: SATURDAY, day: dayOf(SATURDAY, { working: true }) }))).toBeNull();
        expect(closureReason(facts({ day: dayOf(MONDAY, { working: false, objective: 0 }) }))).toBe(
            "Lundi n'est pas un jour travaillé.",
        );
    });

    it('ferme un jour mis à 0h00, déjà pendant la lecture quand le calendrier le sait', () => {
        const reason = "Avec un objectif à 0h00, ce jour n'est pas travaillé.";
        expect(closureReason(facts({ daysOff: new Set([MONDAY]) }))).toBe(reason);
        expect(closureReason(facts({ day: dayOf(MONDAY, { declaredOff: true, objective: 0 }) }))).toBe(reason);
        // La journée lue a le dernier mot : remise à 7h30 ailleurs, elle s'ouvre.
        expect(closureReason(facts({ daysOff: new Set([MONDAY]), day: dayOf(MONDAY) }))).toBeNull();
    });

    it('dit le jour non travaillé avant l’objectif à 0h00 quand les deux valent', () => {
        expect(
            closureReason(facts({ date: SATURDAY, day: dayOf(SATURDAY, { working: false, declaredOff: true }) })),
        ).toBe("Samedi n'est pas un jour travaillé.");
    });

    it('laisse ouvert un jour non travaillé qui a une saisie', () => {
        expect(
            closureReason(facts({ date: SATURDAY, day: dayOf(SATURDAY, { working: false, grid: FILLED }) })),
        ).toBeNull();
        expect(closureReason(facts({ day: dayOf(MONDAY, { declaredOff: true, grid: FILLED }) }))).toBeNull();
    });

    it('ouvre « Saisir quand même » pour ce jour-là seulement', () => {
        expect(closureReason(facts({ date: SATURDAY, openedAnyway: SATURDAY }))).toBeNull();
        expect(closureReason(facts({ date: SATURDAY, openedAnyway: '2025-10-12' }))).toBe(
            "Samedi n'est pas un jour travaillé.",
        );
    });

    it('ferme un jour sans réglages qui le travaillent tant qu’il se lit, puis suit la journée lue', () => {
        expect(closureReason(facts({ workingDays: [] }))).toBe("Lundi n'est pas un jour travaillé.");
        expect(closureReason(facts({ workingDays: [], day: dayOf(MONDAY) }))).toBeNull();
    });
});

describe('staysOpen', () => {
    it('garde ouvert un jour vu avec une saisie, pas un jour vide ni en lecture', () => {
        expect(staysOpen(null)).toBe(false);
        expect(staysOpen(dayOf(MONDAY))).toBe(false);
        expect(staysOpen(dayOf(MONDAY, { grid: gridOf([['19:45', '20:00', 'pause', null, null]]) }))).toBe(true);
        expect(staysOpen(dayOf(MONDAY, { grid: FILLED }))).toBe(true);
    });
});
