import { describe, expect, it } from 'vitest';

import { gestureExtension, selectionCut, selectionErase, selectionShorten } from '../../../assets/day/recurrenceDraft';
import type { SlotChange } from '../../../assets/grid/changes';
import { type DayApi, DaySession, type Outcome, type TabMemory, tabMemory } from '../../../assets/grid/daySession';
import type { EntryAction } from '../../../assets/grid/entry';
import { work } from '../../../assets/grid/grid';
import * as Quarter from '../../../assets/grid/quarter';
import { LAST_WEEK, monthlyDate, monthlyWeekday, type RecurrenceRule, weekly } from '../../../assets/grid/recurrence';
import { selectQuarter, selectQuarters } from '../../../assets/grid/selection';
import { FakeDayServer } from './fakeDayServer';
import { memoryStorage, minutes, type Range, rangesOf, weeklyRule } from './support';

/**
 * Couper avec les suivantes puis coller, allonger, raccourcir, joués comme l'écran les jouera :
 * la question décidée par le moteur (assets/day/recurrenceDraft.ts), la réponse par la session
 * — cette fois seulement par apply, avec les suivantes par saveRecurrence —, contre le faux
 * serveur, aussi strict que le vrai (tests/Api/RecurrenceHoursTest.php). Le presse-papier ne
 * prend ce qu'une coupe emporte qu'une fois l'écriture passée ; une récurrence coupée repart
 * du jour où on la colle, une seule fois ; annuler et rétablir défont et refont chaque geste,
 * récurrence comprise.
 */

const MONDAY = '2026-10-05';
const TUESDAY = '2026-10-06';
/** Le mercredi 21 octobre, où l'on colle le poker planning ; le jeudi 22 ; le samedi 10. */
const WEDNESDAY_21 = '2026-10-21';
const THURSDAY_22 = '2026-10-22';
const SATURDAY = '2026-10-10';
/** La semaine du mardi 6 : le mercredi 7, le jeudi 8, le vendredi 9. */
const WEDNESDAY = '2026-10-07';
const THURSDAY = '2026-10-08';
const FRIDAY = '2026-10-09';
const WEEK = [1, 2, 3, 4, 5];

const NINE = minutes('09:00');
const TEN = minutes('10:00');

/** Le Daily, de 09:00 à 09:15, chaque jour ouvré. */
const DAILY: SlotChange = { start: '09:00', end: '09:15', kind: 'work', ticket: 'OPS-12', comment: 'Daily' };
/** Le poker planning, un mardi sur deux, de 09:00 à 09:30, sans commentaire. */
const POKER: SlotChange = { start: '09:00', end: '09:30', kind: 'work', ticket: 'SHOP-519', comment: null };
const POKER_RULE: RecurrenceRule = weeklyRule([2], null, 2);
const SHOP_519 = work('SHOP-519');

/**
 * Le serveur un mardi : ces récurrences nées lundi — le poker planning, un mardi sur deux, par
 * défaut —, posées ce mardi. Leurs identifiants, dans l'ordre.
 */
function tuesday(
    seeds: readonly (readonly [SlotChange, RecurrenceRule])[] = [[POKER, POKER_RULE]],
    born = MONDAY,
): { server: FakeDayServer; ids: string[] } {
    const server = new FakeDayServer(born);
    for (const [change, rule] of seeds) {
        const created = server.saveRecurrence(born, server.read(born).version, [change], rule, null);
        if (created.status !== 'saved') {
            throw new Error(`La récurrence de ${change.start} n'est pas née : ${JSON.stringify(created)}.`);
        }
    }
    server.setToday(TUESDAY);
    server.pose(TUESDAY);

    return { server, ids: server.allRecurrences().map((recurrence) => recurrence.id) };
}

/** Une journée ouverte dans l'onglet ; les journées d'un même onglet partagent sa mémoire. */
function open(server: FakeDayServer, date: string, memory: TabMemory): DaySession {
    return new DaySession(server.read(date), server.api(), memory);
}

function shown(session: DaySession): Range[] {
    return rangesOf(session.current().day.grid);
}

type Ask = Extract<EntryAction, { readonly kind: 'ask' }>;

function asked(found: { readonly action: Ask } | null): Ask {
    if (found === null) {
        throw new Error('La question n’est pas posée.');
    }

    return found.action;
}

/** La réponse, comme l'écran la joue : cette fois seulement par apply, avec les suivantes par saveRecurrence. */
function answer(session: DaySession, action: Ask, scope: 'once' | 'following'): Promise<Outcome> {
    if (scope === 'once') {
        return session.apply(action.once.changes, session.seen(), action.once.cuts ?? null);
    }
    const { changes, rule, replaces, cuts } = action.following;

    return session.saveRecurrence(changes, rule, replaces, session.seen(), cuts ?? null);
}

/** Coupe le poker planning du mardi avec les suivantes : la session du mardi, et la mémoire de l'onglet. */
async function cutPoker(server: FakeDayServer): Promise<{ memory: TabMemory; session: DaySession }> {
    const memory = tabMemory(memoryStorage());
    const session = open(server, TUESDAY, memory);
    const outcome = await answer(
        session,
        asked(selectionCut(session.current().day, [NINE, NINE + 15], TUESDAY)),
        'following',
    );
    expect(outcome.kind).toBe('saved');

    return { memory, session };
}

describe('couper avec les suivantes', () => {
    it('arrête la récurrence à partir de cette fois, et le presse-papier emporte son bloc et son rythme', async () => {
        const { server, ids } = tuesday();
        const { session } = await cutPoker(server);

        expect(shown(session)).toEqual([]);
        expect(server.recurrence(ids[0] ?? '')?.until).toBe(MONDAY);
        expect(session.clipboard()).toEqual({
            cells: [
                { offset: 0, content: SHOP_519 },
                { offset: 1, content: SHOP_519 },
            ],
            recurrence: POKER_RULE,
            source: { id: ids[0], date: TUESDAY },
        });
    });

    it('cette fois seulement : la coupe ordinaire, sans récurrence, qui continue', async () => {
        const { server, ids } = tuesday();
        const session = open(server, TUESDAY, tabMemory(memoryStorage()));
        const action = asked(selectionCut(session.current().day, [NINE, NINE + 15], TUESDAY));
        await answer(session, action, 'once');

        expect(shown(session)).toEqual([]);
        expect(server.recurrence(ids[0] ?? '')?.until).toBeNull();
        expect(server.isSkipped(ids[0] ?? '', TUESDAY)).toBe(true);
        expect(session.clipboard()?.recurrence).toBeUndefined();
    });

    it.each(['once', 'following'] as const)(
        'refusée (%s) — un onglet resté ouvert sur une journée changée ailleurs —, ne touche pas au presse-papier',
        async (scope) => {
            const { server, ids } = tuesday();
            const memory = tabMemory(memoryStorage());
            const session = open(server, TUESDAY, memory);
            const action = asked(selectionCut(session.current().day, [NINE, NINE + 15], TUESDAY));
            // Un autre onglet écrit l'après-midi : la version de la journée change.
            server.changeSlots(TUESDAY, server.read(TUESDAY).version, [
                { start: '14:00', end: '14:15', kind: 'work', ticket: 'OPS-9', comment: null },
            ]);

            const outcome = await answer(session, action, scope);
            expect(outcome.kind).toBe('stale');
            expect(session.clipboard()).toBeNull();
            expect(server.recurrence(ids[0] ?? '')?.until).toBeNull();
            expect(rangesOf(server.read(TUESDAY).grid)).toContainEqual([
                '09:00',
                '09:30',
                'work',
                'SHOP-519',
                null,
                ids[0],
            ]);
        },
    );

    it('annuler la rend, avec sa fois, et le presse-papier ne garde que son bloc ; rétablir la coupe de nouveau, sans la lui remettre', async () => {
        const { server, ids } = tuesday();
        const { memory, session } = await cutPoker(server);
        const cells = session.clipboard()?.cells;

        expect((await session.undo()).kind).toBe('saved');
        expect(shown(session)).toEqual([['09:00', '09:30', 'work', 'SHOP-519', null, ids[0]]]);
        expect(server.recurrence(ids[0] ?? '')?.until).toBeNull();
        expect(session.clipboard()).toEqual({ cells });

        expect((await session.redo()).kind).toBe('saved');
        expect(shown(session)).toEqual([]);
        expect(server.recurrence(ids[0] ?? '')?.until).toBe(MONDAY);
        expect(session.clipboard()).toEqual({ cells });

        // Collée ensuite, elle ne revient pas une seconde fois : le bloc se colle seul.
        const wednesday = open(server, WEDNESDAY_21, memory);
        expect((await wednesday.paste(selectQuarter(TEN), TUESDAY)).outcome.kind).toBe('saved');
        expect(shown(wednesday)).toEqual([['10:00', '10:30', 'work', 'SHOP-519', null]]);
        expect(server.allRecurrences()).toHaveLength(ids.length);
    });

    it('annuler refusé — la journée changée ailleurs — lui laisse la récurrence', async () => {
        const { server } = tuesday();
        const { session } = await cutPoker(server);
        const kept = session.clipboard();
        server.changeSlots(TUESDAY, server.read(TUESDAY).version, [
            { start: '14:00', end: '14:15', kind: 'work', ticket: 'OPS-9', comment: null },
        ]);

        expect((await session.undo()).kind).toBe('stale');
        expect(session.clipboard()).toBe(kept);
    });

    it('annuler un autre geste ne lui retire rien', async () => {
        const { server } = tuesday();
        const { session } = await cutPoker(server);
        const kept = session.clipboard();
        await session.apply(new Map([[minutes('14:00'), work('OPS-9')]]));

        expect((await session.undo()).kind).toBe('saved');
        expect(session.clipboard()).toBe(kept);
    });
});

describe('coller une récurrence coupée', () => {
    it('la fait repartir du jour du collage, à son rythme suivi, son bloc à sa longueur ; le collage suivant colle le bloc seul', async () => {
        const { server, ids } = tuesday();
        const { memory } = await cutPoker(server);
        const wednesday = open(server, WEDNESDAY_21, memory);

        // Collé le mercredi 21 à 10:00, sur une sélection plus longue que le bloc.
        const first = await wednesday.paste(selectQuarters([TEN, TEN + 15, TEN + 30, TEN + 45]), TUESDAY);
        expect(first.outcome.kind).toBe('saved');
        expect(first.pasted).toEqual([TEN, TEN + 15]);
        const born = server.allRecurrences().find((recurrence) => !ids.includes(recurrence.id));
        // Un mercredi sur deux, de 10:00 à 10:30.
        expect(born).toMatchObject({
            ...weekly([3], 2),
            start: '10:00',
            end: '10:30',
            firstDay: WEDNESDAY_21,
            until: null,
        });
        expect(shown(wednesday)).toEqual([['10:00', '10:30', 'work', 'SHOP-519', null, born?.id]]);
        expect(wednesday.clipboard()?.recurrence).toBeUndefined();
        // Il revient deux semaines plus tard, pas la suivante.
        expect(rangesOf(server.read('2026-11-04').grid)).toEqual([
            ['10:00', '10:30', 'work', 'SHOP-519', null, born?.id],
        ]);
        expect(rangesOf(server.read('2026-10-28').grid)).toEqual([]);

        const second = await wednesday.paste(selectQuarter(minutes('15:00')), TUESDAY);
        expect(second.outcome.kind).toBe('saved');
        expect(shown(wednesday)).toContainEqual(['15:00', '15:30', 'work', 'SHOP-519', null]);
        expect(server.allRecurrences()).toHaveLength(ids.length + 1);
    });

    it('collé aujourd’hui, ailleurs dans la journée : elle en repart, le même jour de la semaine', async () => {
        const { server, ids } = tuesday();
        const { session } = await cutPoker(server);
        const result = await session.paste(selectQuarter(minutes('15:00')), TUESDAY);

        expect(result.outcome.kind).toBe('saved');
        const born = server.allRecurrences().find((recurrence) => !ids.includes(recurrence.id));
        expect(born).toMatchObject({ ...weekly([2], 2), start: '15:00', end: '15:30', firstDay: TUESDAY });
        expect(shown(session)).toEqual([['15:00', '15:30', 'work', 'SHOP-519', null, born?.id]]);
    });

    it.each([
        ['un jour passé', '2026-10-02'],
        ['un samedi, non travaillé', SATURDAY],
    ])('%s : le bloc se colle seul, et la récurrence attend un autre collage', async (_, date) => {
        const { server, ids } = tuesday();
        const { memory } = await cutPoker(server);
        const day = open(server, date, memory);
        const result = await day.paste(selectQuarter(TEN), TUESDAY);

        expect(result.outcome.kind).toBe('saved');
        expect(shown(day)).toEqual([['10:00', '10:30', 'work', 'SHOP-519', null]]);
        expect(server.allRecurrences()).toHaveLength(ids.length);
        expect(day.clipboard()?.recurrence).toEqual(POKER_RULE);
    });

    it('un jour mis à 0h00 : le bloc se colle seul, et la récurrence attend', async () => {
        const { server, ids } = tuesday();
        const { memory } = await cutPoker(server);
        const off = open(server, THURSDAY_22, memory);
        expect((await off.setObjective(0)).kind).toBe('saved');
        expect(off.current().day.declaredOff).toBe(true);

        await off.paste(selectQuarter(TEN), TUESDAY);
        expect(shown(off)).toEqual([['10:00', '10:30', 'work', 'SHOP-519', null]]);
        expect(server.allRecurrences()).toHaveLength(ids.length);
        expect(off.clipboard()?.recurrence).toEqual(POKER_RULE);
    });

    it('après sa fin : le bloc se colle seul, et la récurrence attend', async () => {
        const { server, ids } = tuesday([[POKER, { ...POKER_RULE, until: '2026-10-20' }]]);
        const { memory } = await cutPoker(server);
        const wednesday = open(server, WEDNESDAY_21, memory);
        await wednesday.paste(selectQuarter(TEN), TUESDAY);

        expect(shown(wednesday)).toEqual([['10:00', '10:30', 'work', 'SHOP-519', null]]);
        expect(server.allRecurrences()).toHaveLength(ids.length);
        expect(wednesday.clipboard()?.recurrence).toEqual({ ...POKER_RULE, until: '2026-10-20' });
    });

    it('sans la date d’aujourd’hui, elle ne repart pas', async () => {
        const { server, ids } = tuesday();
        const { memory } = await cutPoker(server);
        const wednesday = open(server, WEDNESDAY_21, memory);
        await wednesday.paste(selectQuarter(TEN));

        expect(server.allRecurrences()).toHaveLength(ids.length);
        expect(wednesday.clipboard()?.recurrence).toEqual(POKER_RULE);
    });

    it('sur un créneau qu’une autre prend : rien n’est collé, le refus le dit, et la récurrence reste dans le presse-papier', async () => {
        const retro: SlotChange = {
            start: '10:15',
            end: '11:00',
            kind: 'work',
            ticket: 'OPS-3',
            comment: 'Rétrospective',
        };
        const { server, ids } = tuesday([
            [POKER, POKER_RULE],
            [retro, weeklyRule([3])],
        ]);
        const { memory } = await cutPoker(server);
        const wednesday = open(server, WEDNESDAY_21, memory);
        const before = server.read(WEDNESDAY_21);

        const result = await wednesday.paste(selectQuarter(TEN), TUESDAY);
        expect(result).toEqual({
            outcome: {
                kind: 'invalid',
                violations: [
                    {
                        field: 'recurrence.rhythm',
                        message: 'Ce créneau est déjà pris par la récurrence «\u{a0}Rétrospective\u{a0}».',
                    },
                ],
            },
            pasted: [],
        });
        expect(server.read(WEDNESDAY_21)).toEqual(before);
        expect(server.allRecurrences()).toHaveLength(ids.length);
        expect(wednesday.clipboard()?.recurrence).toEqual(POKER_RULE);

        // Ailleurs, elle repart.
        expect((await wednesday.paste(selectQuarter(minutes('15:00')), TUESDAY)).outcome.kind).toBe('saved');
        expect(wednesday.clipboard()?.recurrence).toBeUndefined();
    });

    it('un collage qui déborde après 20:00 ne colle rien, et la garde', async () => {
        const { server } = tuesday();
        const { memory } = await cutPoker(server);
        const wednesday = open(server, WEDNESDAY_21, memory);

        expect((await wednesday.paste(selectQuarter(Quarter.LAST), TUESDAY)).outcome.kind).toBe('overflow');
        expect(wednesday.clipboard()?.recurrence).toEqual(POKER_RULE);
        // Jusqu'à 20:00 pile, elle repart.
        const result = await wednesday.paste(selectQuarter(Quarter.LAST - Quarter.MINUTES), TUESDAY);
        expect(result.pasted).toEqual([Quarter.LAST - Quarter.MINUTES, Quarter.LAST]);
        expect(shown(wednesday)).toEqual([['19:30', '20:00', 'work', 'SHOP-519', null, expect.any(String)]]);
    });

    it('le n-ième jour du mois prend le rang du jour du collage ; une date du mois, sa date', async () => {
        for (const [rule, date, expected] of [
            // Le 1er mardi, collé le jeudi 22 : le 4e jeudi du mois.
            [{ ...monthlyWeekday(2, 1), until: null }, THURSDAY_22, monthlyWeekday(4, 4)],
            // Collé le jeudi 29, le dernier du mois.
            [{ ...monthlyWeekday(2, 1), until: null }, '2026-10-29', monthlyWeekday(4, LAST_WEEK)],
            // Le 6, collé le 21 : le 21.
            [{ ...monthlyDate(6), until: null }, WEDNESDAY_21, monthlyDate(21)],
        ] as const) {
            // Né ce mardi : un rythme du mois ne naît que d'un jour où il tombe.
            const { server, ids } = tuesday([[POKER, rule]], TUESDAY);
            const { memory } = await cutPoker(server);
            const day = open(server, date, memory);
            expect((await day.paste(selectQuarter(TEN), TUESDAY)).outcome.kind).toBe('saved');

            const born = server.allRecurrences().find((recurrence) => !ids.includes(recurrence.id));
            expect(born).toMatchObject({ ...expected, firstDay: date, start: '10:00', end: '10:30' });
            expect(shown(day)).toEqual([['10:00', '10:30', 'work', 'SHOP-519', null, born?.id]]);
        }
    });

    it('collée avant le jour de la coupe, elle ne repart pas : le bloc se colle seul, et elle attend', async () => {
        // Le Daily, coupé avec les suivantes le jeudi 8, où il n'est que prévu.
        const { server, ids } = tuesday([[DAILY, weeklyRule(WEEK)]]);
        const memory = tabMemory(memoryStorage());
        const thursday = open(server, THURSDAY, memory);
        await answer(thursday, asked(selectionCut(thursday.current().day, [NINE], TUESDAY)), 'following');
        expect(server.recurrence(ids[0] ?? '')?.until).toBe(WEDNESDAY);

        // Le mercredi, et aujourd'hui : avant la coupe.
        for (const date of [WEDNESDAY, TUESDAY]) {
            const day = open(server, date, memory);
            expect((await day.paste(selectQuarter(TEN), TUESDAY)).outcome.kind).toBe('saved');
            expect(shown(day)).toEqual([
                ['09:00', '09:15', 'work', 'OPS-12', 'Daily', ids[0]],
                ['10:00', '10:15', 'work', 'OPS-12', 'Daily'],
            ]);
            expect(server.allRecurrences()).toHaveLength(ids.length);
            expect(day.clipboard()?.recurrence).toEqual(weeklyRule(WEEK));
        }

        // Le jour de la coupe, elle repart.
        expect((await thursday.paste(selectQuarter(TEN), TUESDAY)).outcome.kind).toBe('saved');
        const born = server.allRecurrences().find((recurrence) => !ids.includes(recurrence.id));
        expect(born).toMatchObject({ firstDay: THURSDAY, start: '10:00', end: '10:15', weekdays: WEEK });
    });

    it('un jour décoché depuis dans les réglages : elle repart sans lui ; sans aucun jour travaillé, le bloc se colle seul', async () => {
        // Le Daily du lundi au vendredi, et la revue du mardi et du jeudi, coupés ce mardi.
        const review: SlotChange = { start: '11:00', end: '11:15', kind: 'work', ticket: 'OPS-7', comment: 'Revue' };
        const { server, ids } = tuesday([
            [DAILY, weeklyRule(WEEK)],
            [review, weeklyRule([2, 4])],
        ]);
        const daily = tabMemory(memoryStorage());
        const reviewed = tabMemory(memoryStorage());
        const today = open(server, TUESDAY, daily);
        await answer(today, asked(selectionCut(today.current().day, [NINE], TUESDAY)), 'following');
        const again = open(server, TUESDAY, reviewed);
        await answer(again, asked(selectionCut(again.current().day, [minutes('11:00')], TUESDAY)), 'following');
        // Puis le mardi et le jeudi décochés dans un autre onglet.
        server.setWorkingDays([1, 3, 5]);

        const wednesday = open(server, WEDNESDAY, daily);
        expect((await wednesday.paste(selectQuarter(TEN), TUESDAY)).outcome.kind).toBe('saved');
        const born = server.allRecurrences().find((recurrence) => !ids.includes(recurrence.id));
        expect(born).toMatchObject({ firstDay: WEDNESDAY, start: '10:00', weekdays: [1, 3, 5] });

        // La revue ne garde aucun jour : elle attend.
        const other = open(server, WEDNESDAY, reviewed);
        expect((await other.paste(selectQuarter(minutes('15:00')), TUESDAY)).outcome.kind).toBe('saved');
        expect(shown(other)).toContainEqual(['15:00', '15:15', 'work', 'OPS-7', 'Revue']);
        expect(server.allRecurrences()).toHaveLength(ids.length + 1);
        expect(other.clipboard()?.recurrence).toEqual(weeklyRule([2, 4]));
    });

    it('annuler le collage retire la récurrence collée ; annuler la coupe, sur son jour, la rend à sa place', async () => {
        const { server, ids } = tuesday();
        const { memory, session } = await cutPoker(server);
        const wednesday = open(server, WEDNESDAY_21, memory);
        await wednesday.paste(selectQuarter(TEN), TUESDAY);
        const born = server.allRecurrences().find((recurrence) => !ids.includes(recurrence.id))?.id ?? '';

        expect((await wednesday.undo()).kind).toBe('saved');
        expect(shown(wednesday)).toEqual([]);
        const withdrawn = server.recurrence(born);
        expect(withdrawn?.until !== null && (withdrawn?.until ?? '') < (withdrawn?.firstDay ?? '')).toBe(true);
        expect(rangesOf(server.read('2026-11-04').grid)).toEqual([]);

        expect((await wednesday.redo()).kind).toBe('saved');
        expect(shown(wednesday)).toEqual([['10:00', '10:30', 'work', 'SHOP-519', null, born]]);
        expect((await wednesday.undo()).kind).toBe('saved');

        // La coupe, annulée sur son jour : la récurrence revient, tous les quinze jours.
        expect((await session.undo()).kind).toBe('saved');
        expect(shown(session)).toEqual([['09:00', '09:30', 'work', 'SHOP-519', null, ids[0]]]);
        expect(server.recurrence(ids[0] ?? '')?.until).toBeNull();
        expect(rangesOf(server.read('2026-10-20').grid)).toEqual([
            ['09:00', '09:30', 'work', 'SHOP-519', null, ids[0]],
        ]);
    });
});

describe('déplacer une récurrence garde ses fois effacées ou détachées', () => {
    /** Le Daily, coupé ce mardi avec les suivantes, une fois sa fois de jeudi détachée et celle de vendredi effacée. */
    async function skippedThenCut(): Promise<{ server: FakeDayServer; ids: string[]; memory: TabMemory }> {
        const { server, ids } = tuesday([[DAILY, weeklyRule(WEEK)]]);
        const memory = tabMemory(memoryStorage());
        const thursday = open(server, THURSDAY, memory);
        expect((await thursday.apply(new Map([[NINE, work('OPS-7')]]))).kind).toBe('saved');
        const friday = open(server, FRIDAY, memory);
        await answer(friday, asked(selectionErase(friday.current().day, [NINE], TUESDAY)), 'once');
        expect(server.recurrence(ids[0] ?? '')?.skipped).toEqual([THURSDAY, FRIDAY]);
        const today = open(server, TUESDAY, memory);
        await answer(today, asked(selectionCut(today.current().day, [NINE], TUESDAY)), 'following');

        return { server, ids, memory };
    }

    it('collée au même rythme, la nouvelle reprend les fois sautées après le jour du collage, et la coupée garde les siennes', async () => {
        const { server, ids, memory } = await skippedThenCut();
        const today = open(server, TUESDAY, memory);
        expect((await today.paste(selectQuarter(TEN), TUESDAY)).outcome.kind).toBe('saved');

        const born = server.allRecurrences().find((recurrence) => !ids.includes(recurrence.id));
        expect(born).toMatchObject({ firstDay: TUESDAY, start: '10:00', skipped: [THURSDAY, FRIDAY] });
        expect(server.recurrence(ids[0] ?? '')?.skipped).toEqual([THURSDAY, FRIDAY]);
        expect(rangesOf(server.read(WEDNESDAY).grid)).toEqual([
            ['10:00', '10:15', 'work', 'OPS-12', 'Daily', born?.id],
        ]);
        expect(rangesOf(server.read(THURSDAY).grid)).toEqual([['09:00', '09:15', 'work', 'OPS-7', null]]);
        expect(rangesOf(server.read(FRIDAY).grid)).toEqual([]);
        expect(rangesOf(server.read('2026-10-16').grid)).toEqual([
            ['10:00', '10:15', 'work', 'OPS-12', 'Daily', born?.id],
        ]);
    });

    it('collée le jour d’une fois effacée, elle s’y pose : ce jour-là, le collage la remet', async () => {
        const { server, ids, memory } = await skippedThenCut();
        const friday = open(server, FRIDAY, memory);
        expect((await friday.paste(selectQuarter(TEN), TUESDAY)).outcome.kind).toBe('saved');

        const born = server.allRecurrences().find((recurrence) => !ids.includes(recurrence.id));
        expect(born?.skipped).toBeUndefined();
        expect(shown(friday)).toEqual([['10:00', '10:15', 'work', 'OPS-12', 'Daily', born?.id]]);
        expect(server.isSkipped(born?.id ?? '', FRIDAY)).toBe(false);
    });

    it('à un autre rythme, elle n’en reprend rien', async () => {
        const { server, ids, memory } = await skippedThenCut();
        // Le lundi décoché depuis : du mardi au vendredi.
        server.setWorkingDays([2, 3, 4, 5]);
        const today = open(server, TUESDAY, memory);
        expect((await today.paste(selectQuarter(TEN), TUESDAY)).outcome.kind).toBe('saved');

        const born = server.allRecurrences().find((recurrence) => !ids.includes(recurrence.id));
        expect(born).toMatchObject({ weekdays: [2, 3, 4, 5] });
        expect(born?.skipped).toBeUndefined();
        expect(rangesOf(server.read(FRIDAY).grid)).toEqual([['10:00', '10:15', 'work', 'OPS-12', 'Daily', born?.id]]);
    });

    it('annuler le collage retire la nouvelle ; la coupée garde ses fois sautées', async () => {
        const { server, ids, memory } = await skippedThenCut();
        const today = open(server, TUESDAY, memory);
        await today.paste(selectQuarter(TEN), TUESDAY);
        const born = server.allRecurrences().find((recurrence) => !ids.includes(recurrence.id))?.id ?? '';

        expect((await today.undo()).kind).toBe('saved');
        const withdrawn = server.recurrence(born);
        expect((withdrawn?.until ?? '') < (withdrawn?.firstDay ?? '')).toBe(true);
        expect(server.recurrence(ids[0] ?? '')?.skipped).toEqual([THURSDAY, FRIDAY]);
        expect(rangesOf(server.read(WEDNESDAY).grid)).toEqual([]);
    });

    it('le serveur ne croit pas le navigateur : une source inconnue ne lui donne rien, une qui revient encore ce jour-là se refuse', () => {
        const { server, ids } = tuesday([[DAILY, weeklyRule(WEEK)]]);
        expect(
            server.changeSlots(FRIDAY, server.read(FRIDAY).version, [
                { start: '09:00', end: '09:15', kind: 'empty', ticket: null, comment: null },
            ]).status,
        ).toBe('saved');
        const pasted: SlotChange = { start: '10:00', end: '10:15', kind: 'work', ticket: 'OPS-12', comment: 'Daily' };
        const unknown = server.saveRecurrence(
            WEDNESDAY,
            server.read(WEDNESDAY).version,
            [pasted],
            weeklyRule(WEEK),
            null,
            '01900000-0000-7000-8000-00000000ffff',
        );
        expect(unknown.status).toBe('saved');
        // Encore là ce mercredi, sa coupe a été annulée : elle reviendrait deux fois.
        const versions = server.read(WEDNESDAY).version;
        expect(
            server.saveRecurrence(
                WEDNESDAY,
                versions,
                [{ ...pasted, start: '11:00', end: '11:15' }],
                weeklyRule(WEEK),
                null,
                ids[0] ?? '',
            ),
        ).toEqual({
            status: 'invalid',
            violations: [
                { field: 'follows', message: "La coupe de cette récurrence a été annulée. Rien n'est collé." },
            ],
        });
        expect(server.read(WEDNESDAY).version).toBe(versions);
        expect(server.allRecurrences().filter((recurrence) => recurrence.skipped !== undefined)).toEqual([
            expect.objectContaining({ id: ids[0], skipped: [FRIDAY] }),
        ]);
        expect(server.saveRecurrence(WEDNESDAY, 0, [pasted], weeklyRule(WEEK), null, 'daily')).toEqual({
            status: 'invalid',
            violations: [{ field: 'follows', message: 'Récurrence inconnue.' }],
        });
    });
});

describe('un seul collage emporte la récurrence coupée', () => {
    /** Une réponse retenue jusqu'à ce qu'on la lâche : le serveur a déjà écrit. */
    function held(server: FakeDayServer): { api: DayApi; release: () => void } {
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });

        return {
            api: server.api(async (request, handle) => {
                const result = handle();
                if (request.kind === 'saveRecurrence') {
                    await gate;
                }

                return result;
            }),
            release,
        };
    }

    it('un collage lancé sur un autre jour pendant qu’un premier attend sa réponse colle le bloc seul', async () => {
        const { server, ids } = tuesday();
        const { memory } = await cutPoker(server);
        const slow = held(server);
        const wednesday = new DaySession(server.read(WEDNESDAY_21), slow.api, memory);
        const pasting = wednesday.paste(selectQuarter(TEN), TUESDAY);
        await Promise.resolve();
        // Le presse-papier l'a déjà quittée.
        expect(memory.clipboard.read()?.recurrence).toBeUndefined();

        const thursday = open(server, THURSDAY_22, memory);
        expect((await thursday.paste(selectQuarter(minutes('14:00')), TUESDAY)).outcome.kind).toBe('saved');
        slow.release();
        expect((await pasting).outcome.kind).toBe('saved');

        expect(server.allRecurrences()).toHaveLength(ids.length + 1);
        expect(shown(thursday)).toEqual([['14:00', '14:30', 'work', 'SHOP-519', null]]);
        expect(memory.clipboard.read()?.recurrence).toBeUndefined();
    });

    it('refusée — un créneau pris, une journée changée ailleurs —, elle revient dans le presse-papier', async () => {
        const retro: SlotChange = { start: '10:15', end: '11:00', kind: 'work', ticket: 'OPS-3', comment: 'Rétro' };
        const { server } = tuesday([
            [POKER, POKER_RULE],
            [retro, weeklyRule([3])],
        ]);
        const { memory } = await cutPoker(server);
        const kept = memory.clipboard.read();
        const wednesday = open(server, WEDNESDAY_21, memory);
        expect((await wednesday.paste(selectQuarter(TEN), TUESDAY)).outcome.kind).toBe('invalid');
        expect(memory.clipboard.read()).toBe(kept);

        server.changeSlots(WEDNESDAY_21, server.read(WEDNESDAY_21).version, [
            { start: '16:00', end: '16:15', kind: 'work', ticket: 'OPS-9', comment: null },
        ]);
        expect((await wednesday.paste(selectQuarter(minutes('15:00')), TUESDAY)).outcome.kind).toBe('stale');
        expect(memory.clipboard.read()).toBe(kept);
    });

    it('sans réponse, l’écriture a pu passer : elle ne revient pas, et le collage suivant colle le bloc seul', async () => {
        for (const passes of [true, false]) {
            const { server, ids } = tuesday();
            const { memory } = await cutPoker(server);
            const lost = server.api((request, handle) => {
                if (request.kind === 'saveRecurrence' && passes) {
                    handle();
                }

                return request.kind === 'saveRecurrence'
                    ? Promise.reject(new TypeError('Failed to fetch'))
                    : Promise.resolve(handle());
            });
            const wednesday = new DaySession(server.read(WEDNESDAY_21), lost, memory);
            expect((await wednesday.paste(selectQuarter(TEN), TUESDAY)).outcome.kind).toBe('failed');
            expect(server.allRecurrences()).toHaveLength(ids.length + (passes ? 1 : 0));
            expect(memory.clipboard.read()).toEqual({
                cells: [
                    { offset: 0, content: SHOP_519 },
                    { offset: 1, content: SHOP_519 },
                ],
            });

            const thursday = open(server, THURSDAY_22, memory);
            await thursday.paste(selectQuarter(TEN), TUESDAY);
            expect(server.allRecurrences()).toHaveLength(ids.length + (passes ? 1 : 0));
        }
    });

    it('une copie faite pendant que le collage attend sa réponse n’est pas écrasée par son refus', async () => {
        const retro: SlotChange = { start: '10:15', end: '11:00', kind: 'work', ticket: 'OPS-3', comment: 'Rétro' };
        const { server } = tuesday([
            [POKER, POKER_RULE],
            [retro, weeklyRule([3])],
        ]);
        const { memory } = await cutPoker(server);
        const slow = held(server);
        const wednesday = new DaySession(server.read(WEDNESDAY_21), slow.api, memory);
        const pasting = wednesday.paste(selectQuarter(TEN), TUESDAY);
        await Promise.resolve();

        // Un autre jour, on copie la rétrospective.
        const thursday = open(server, THURSDAY_22, memory);
        await thursday.copy(selectQuarters([minutes('15:00')]));
        const other = open(server, '2026-10-28', memory);
        const copied = await other.copy(selectQuarters([minutes('10:15')]));
        slow.release();
        expect((await pasting).outcome.kind).toBe('invalid');

        expect(memory.clipboard.read()).toBe(copied);
        expect(copied?.recurrence).toBeUndefined();
    });
});

describe('une récurrence déplacée ne revit jamais à ses deux places', () => {
    const RETRO: SlotChange = { start: '10:15', end: '11:00', kind: 'work', ticket: 'OPS-3', comment: 'Rétro' };

    /** Une réponse de collage retenue jusqu'à ce qu'on la lâche : le serveur a déjà jugé. */
    function heldPaste(server: FakeDayServer): { api: DayApi; release: () => void } {
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });

        return {
            api: server.api(async (request, handle) => {
                const result = handle();
                if (request.kind === 'saveRecurrence') {
                    await gate;
                }

                return result;
            }),
            release,
        };
    }

    it('annuler la coupe pendant que son collage attend un refus : le refus ne la rend pas, et le collage suivant pose le bloc seul', async () => {
        const { server, ids } = tuesday([
            [POKER, POKER_RULE],
            [RETRO, weeklyRule([3])],
        ]);
        const { memory, session: tue } = await cutPoker(server);
        const slow = heldPaste(server);
        const wednesday = new DaySession(server.read(WEDNESDAY_21), slow.api, memory);
        // Sur la rétrospective : refusé, mais la réponse tarde.
        const pasting = wednesday.paste(selectQuarter(minutes('10:15')), TUESDAY);
        await Promise.resolve();

        expect((await tue.undo()).kind).toBe('saved');
        expect(server.recurrence(ids[0] ?? '')?.until).toBeNull();
        slow.release();
        expect((await pasting).outcome.kind).toBe('invalid');
        expect(memory.clipboard.read()?.recurrence).toBeUndefined();

        const thursday = open(server, THURSDAY_22, memory);
        expect((await thursday.paste(selectQuarter(minutes('14:00')), TUESDAY)).outcome.kind).toBe('saved');
        expect(shown(thursday)).toEqual([['14:00', '14:30', 'work', 'SHOP-519', null]]);
        expect(server.allRecurrences()).toHaveLength(ids.length);
    });

    it('rétablir son collage, sa coupe annulée, se refuse et dit de rétablir la coupe d’abord', async () => {
        const { server, ids } = tuesday();
        const { memory, session: tue } = await cutPoker(server);
        const wednesday = open(server, WEDNESDAY_21, memory);
        expect((await wednesday.paste(selectQuarter(TEN), TUESDAY)).outcome.kind).toBe('saved');
        expect((await wednesday.undo()).kind).toBe('saved');
        expect((await tue.undo()).kind).toBe('saved');
        const before = server.allRecurrences();

        expect(await wednesday.redo()).toEqual({
            kind: 'invalid',
            violations: [{ field: 'recurrences', message: "Rétablissez d'abord la coupe du mardi 6 octobre." }],
        });
        expect(server.allRecurrences()).toEqual(before);
        expect(shown(wednesday)).toEqual([]);
        expect(wednesday.current().canRedo).toBe(true);

        // La coupe rétablie, le collage se rétablit : elle est de nouveau déplacée.
        expect((await tue.redo()).kind).toBe('saved');
        expect((await wednesday.redo()).kind).toBe('saved');
        expect(server.recurrence(ids[0] ?? '')?.until).toBe(MONDAY);
        expect(rangesOf(server.read('2026-10-20').grid)).toEqual([]);
        expect(rangesOf(server.read('2026-11-04').grid)).toEqual([
            ['10:00', '10:30', 'work', 'SHOP-519', null, expect.any(String)],
        ]);
    });

    it('annuler sa coupe, son collage encore là, se refuse et dit d’annuler le collage d’abord', async () => {
        const { server, ids } = tuesday();
        const { memory, session: tue } = await cutPoker(server);
        const wednesday = open(server, WEDNESDAY_21, memory);
        expect((await wednesday.paste(selectQuarter(TEN), TUESDAY)).outcome.kind).toBe('saved');
        const before = server.allRecurrences();

        expect(await tue.undo()).toEqual({
            kind: 'invalid',
            violations: [{ field: 'recurrences', message: "Annulez d'abord le collage du mercredi 21 octobre." }],
        });
        expect(server.allRecurrences()).toEqual(before);
        expect(tue.current().canUndo).toBe(true);
        expect(memory.clipboard.read()?.recurrence).toBeUndefined();

        // Le collage annulé, la coupe s'annule : elle revient à sa place, et seulement là.
        expect((await wednesday.undo()).kind).toBe('saved');
        expect((await tue.undo()).kind).toBe('saved');
        expect(server.recurrence(ids[0] ?? '')?.until).toBeNull();
        expect(rangesOf(server.read('2026-10-20').grid)).toEqual([
            ['09:00', '09:30', 'work', 'SHOP-519', null, ids[0]],
        ]);
        expect(rangesOf(server.read('2026-11-04').grid)).toEqual([]);
    });

    it('deux onglets ne collent pas la même coupe : le second est refusé, et colle ensuite le bloc seul', async () => {
        const { server, ids } = tuesday();
        const { memory } = await cutPoker(server);
        const twin = tabMemory(memoryStorage());
        const cut = memory.clipboard.read();
        if (cut === null) {
            throw new Error('Rien n’est coupé.');
        }
        twin.clipboard.write(cut);
        expect((await open(server, WEDNESDAY_21, memory).paste(selectQuarter(TEN), TUESDAY)).outcome.kind).toBe(
            'saved',
        );

        const thursday = open(server, THURSDAY_22, twin);
        expect((await thursday.paste(selectQuarter(TEN), TUESDAY)).outcome).toEqual({
            kind: 'invalid',
            violations: [
                {
                    field: 'follows',
                    message: "Cette récurrence a déjà été collée le mercredi 21 octobre. Rien n'est collé.",
                },
            ],
        });
        expect(twin.clipboard.read()?.recurrence).toBeUndefined();
        expect((await thursday.paste(selectQuarter(TEN), TUESDAY)).outcome.kind).toBe('saved');
        expect(shown(thursday)).toEqual([['10:00', '10:30', 'work', 'SHOP-519', null]]);
        expect(server.allRecurrences()).toHaveLength(ids.length + 1);
    });

    it('déplacée deux fois, sa première coupe ne s’annule pas tant que le dernier collage est là', async () => {
        const { server } = tuesday();
        const { memory, session: tue } = await cutPoker(server);
        const wednesday = open(server, WEDNESDAY_21, memory);
        expect((await wednesday.paste(selectQuarter(TEN), TUESDAY)).outcome.kind).toBe('saved');
        // Recoupée le jour même de ce collage, puis collée le jeudi.
        expect(
            (
                await answer(
                    wednesday,
                    asked(selectionCut(wednesday.current().day, [TEN, TEN + 15], TUESDAY)),
                    'following',
                )
            ).kind,
        ).toBe('saved');
        const thursday = open(server, THURSDAY_22, memory);
        expect((await thursday.paste(selectQuarter(TEN), TUESDAY)).outcome.kind).toBe('saved');

        expect(await tue.undo()).toEqual({
            kind: 'invalid',
            violations: [{ field: 'recurrences', message: "Annulez d'abord le collage du jeudi 22 octobre." }],
        });
    });

    it('sa fenêtre ne repousse pas « Jusqu’au » au-delà du collage', () => {
        const server = new FakeDayServer(MONDAY);
        server.saveRecurrence(MONDAY, server.read(MONDAY).version, [POKER], weeklyRule([2]), null);
        server.setToday(MONDAY);
        const poker = server.allRecurrences()[0]?.id ?? '';
        // Coupé avec les suivantes le mardi 13, collé le mercredi 14, chaque mercredi.
        const cut = server.saveRecurrence(
            '2026-10-13',
            server.read('2026-10-13').version,
            [{ ...POKER, kind: 'empty', ticket: null }],
            null,
            {
                id: poker,
                weekdays: [2],
                until: null,
            },
        );
        expect(cut.status).toBe('saved');
        const pasted = server.saveRecurrence(
            '2026-10-14',
            server.read('2026-10-14').version,
            [POKER],
            weeklyRule([3]),
            null,
            poker,
        );
        expect(pasted.status).toBe('saved');

        const before = server.allRecurrences();
        expect(
            server.saveRecurrence(TUESDAY, server.read(TUESDAY).version, [POKER], weeklyRule([2]), {
                id: poker,
                weekdays: [2],
                until: '2026-10-12',
            }),
        ).toEqual({
            status: 'invalid',
            violations: [{ field: 'recurrence.until', message: "Annulez d'abord le collage du mercredi 14 octobre." }],
        });
        expect(server.allRecurrences()).toEqual(before);
    });

    it('sa fenêtre, quand elle change autre chose, ne la fait pas non plus revenir au-delà du collage', () => {
        const server = new FakeDayServer(MONDAY);
        server.saveRecurrence(MONDAY, server.read(MONDAY).version, [POKER], weeklyRule([2]), null);
        server.setToday(MONDAY);
        const poker = server.allRecurrences()[0]?.id ?? '';
        const seen = { id: poker, weekdays: [2], until: '2026-10-12' };
        // Coupé avec les suivantes le mardi 13, collé le mercredi 14, chaque mercredi.
        const cut = server.saveRecurrence(
            '2026-10-13',
            server.read('2026-10-13').version,
            [{ ...POKER, kind: 'empty', ticket: null }],
            null,
            { ...seen, until: null },
        );
        expect(cut.status).toBe('saved');
        const pasted = server.saveRecurrence(
            '2026-10-14',
            server.read('2026-10-14').version,
            [POKER],
            weeklyRule([3]),
            null,
            poker,
        );
        expect(pasted.status).toBe('saved');
        const refused = {
            status: 'invalid',
            violations: [{ field: 'recurrence.until', message: "Annulez d'abord le collage du mercredi 14 octobre." }],
        };
        const before = server.allRecurrences();

        // Le mardi 6, un autre commentaire et « Jusqu'au » vidé : la nouvelle reviendrait chaque mardi, sans fin.
        expect(
            server.saveRecurrence(
                TUESDAY,
                server.read(TUESDAY).version,
                [{ ...POKER, comment: 'Planning' }],
                weeklyRule([2]),
                seen,
            ),
        ).toEqual(refused);
        expect(server.allRecurrences()).toEqual(before);

        // Le mardi 6 passé, un autre rythme partirait de demain, sans fin.
        server.setToday(WEDNESDAY);
        server.pose(WEDNESDAY);
        expect(server.saveRecurrence(TUESDAY, server.read(TUESDAY).version, [POKER], weeklyRule([2, 4]), seen)).toEqual(
            refused,
        );
        expect(server.allRecurrences()).toEqual(before);

        // Jusqu'au mardi 13, la veille du collage : la nouvelle revient le jeudi 8 et le mardi 13, pas au-delà.
        expect(
            server.saveRecurrence(
                TUESDAY,
                server.read(TUESDAY).version,
                [POKER],
                weeklyRule([2, 4], '2026-10-13'),
                seen,
            ).status,
        ).toBe('saved');
        expect(rangesOf(server.read(THURSDAY).grid)).toEqual([
            ['09:00', '09:30', 'work', 'SHOP-519', null, expect.any(String)],
        ]);
        expect(rangesOf(server.read('2026-10-15').grid)).toEqual([]);
    });

    it('rétablir son collage, recollée ailleurs entre-temps par un onglet dupliqué, se refuse et dit d’annuler l’autre collage d’abord', async () => {
        const { server } = tuesday();
        const { memory } = await cutPoker(server);
        const twin = tabMemory(memoryStorage());
        const cut = memory.clipboard.read();
        if (cut === null) {
            throw new Error('Rien n’est coupé.');
        }
        twin.clipboard.write(cut);
        const wednesday = open(server, WEDNESDAY_21, memory);
        expect((await wednesday.paste(selectQuarter(TEN), TUESDAY)).outcome.kind).toBe('saved');
        expect((await wednesday.undo()).kind).toBe('saved');
        // Le collage du mercredi annulé, l'onglet dupliqué colle la même coupe le vendredi.
        const friday = open(server, '2026-10-23', twin);
        expect((await friday.paste(selectQuarter(TEN), TUESDAY)).outcome.kind).toBe('saved');
        const before = server.allRecurrences();

        expect(await wednesday.redo()).toEqual({
            kind: 'invalid',
            violations: [{ field: 'recurrences', message: "Annulez d'abord le collage du vendredi 23 octobre." }],
        });
        expect(server.allRecurrences()).toEqual(before);
        expect(shown(wednesday)).toEqual([]);
        expect(wednesday.current().canRedo).toBe(true);

        // Le collage du vendredi annulé, celui du mercredi se rétablit, seul.
        expect((await friday.undo()).kind).toBe('saved');
        expect((await wednesday.redo()).kind).toBe('saved');
        expect(rangesOf(server.read('2026-11-04').grid)).toEqual([
            ['10:00', '10:30', 'work', 'SHOP-519', null, expect.any(String)],
        ]);
        expect(rangesOf(server.read('2026-11-06').grid)).toEqual([]);
    });

    it('sa collée remplacée le jour même du collage passe la main : la coupe ne s’annule pas tant que la remplaçante est là', async () => {
        const { server } = tuesday();
        const { memory, session: tue } = await cutPoker(server);
        const wednesday = open(server, WEDNESDAY_21, memory);
        expect((await wednesday.paste(selectQuarter(TEN), TUESDAY)).outcome.kind).toBe('saved');
        const moved = server.allRecurrences().at(-1);
        // Le jour même, elle change de commentaire avec les suivantes : retirée, une autre la remplace.
        expect(
            (
                await wednesday.saveRecurrence(
                    new Map([
                        [TEN, work('SHOP-519', 'Planning')],
                        [TEN + 15, work('SHOP-519', 'Planning')],
                    ]),
                    weeklyRule([3], null, 2),
                    { id: moved?.id ?? '', weekdays: [3], until: null },
                )
            ).kind,
        ).toBe('saved');

        expect(await tue.undo()).toEqual({
            kind: 'invalid',
            violations: [{ field: 'recurrences', message: "Annulez d'abord le collage du mercredi 21 octobre." }],
        });
    });

    it('un onglet dupliqué avant qu’on annule la coupe ne la colle pas une seconde fois : refusé, il colle ensuite le bloc seul', async () => {
        const { server, ids } = tuesday();
        const { memory, session: tue } = await cutPoker(server);
        const twin = tabMemory(memoryStorage());
        const cut = memory.clipboard.read();
        if (cut === null) {
            throw new Error('Rien n’est coupé.');
        }
        twin.clipboard.write(cut);
        expect((await tue.undo()).kind).toBe('saved');

        const wednesday = open(server, WEDNESDAY_21, twin);
        expect((await wednesday.paste(selectQuarter(TEN), TUESDAY)).outcome).toEqual({
            kind: 'invalid',
            violations: [
                { field: 'follows', message: "La coupe de cette récurrence a été annulée. Rien n'est collé." },
            ],
        });
        expect(twin.clipboard.read()?.recurrence).toBeUndefined();
        expect((await wednesday.paste(selectQuarter(TEN), TUESDAY)).outcome.kind).toBe('saved');
        expect(shown(wednesday)).toEqual([['10:00', '10:30', 'work', 'SHOP-519', null]]);
        expect(server.allRecurrences()).toHaveLength(ids.length);
    });
});

describe('allonger avec les suivantes', () => {
    it('donne à la récurrence ses nouvelles heures à partir de cette fois ; annuler et rétablir les défont et les refont', async () => {
        const { server, ids } = tuesday();
        const session = open(server, TUESDAY, tabMemory(memoryStorage()));
        const action = asked(
            gestureExtension(session.current().day, new Map([[NINE + 30, SHOP_519]]), TUESDAY, 'paste'),
        );
        expect(action.reshapes).toMatchObject({ start: NINE, end: NINE + 45 });

        expect((await answer(session, action, 'following')).kind).toBe('saved');
        const born = server.allRecurrences().find((recurrence) => !ids.includes(recurrence.id));
        expect(born).toMatchObject({ ...weekly([2], 2), start: '09:00', end: '09:45' });
        expect(shown(session)).toEqual([['09:00', '09:45', 'work', 'SHOP-519', null, born?.id]]);
        expect(server.recurrence(ids[0] ?? '')?.until).toBe(MONDAY);
        expect(rangesOf(server.read('2026-10-20').grid)).toEqual([
            ['09:00', '09:45', 'work', 'SHOP-519', null, born?.id],
        ]);

        expect((await session.undo()).kind).toBe('saved');
        expect(shown(session)).toEqual([['09:00', '09:30', 'work', 'SHOP-519', null, ids[0]]]);
        expect(rangesOf(server.read('2026-10-20').grid)).toEqual([
            ['09:00', '09:30', 'work', 'SHOP-519', null, ids[0]],
        ]);

        expect((await session.redo()).kind).toBe('saved');
        expect(shown(session)).toEqual([['09:00', '09:45', 'work', 'SHOP-519', null, born?.id]]);
    });

    it('cette fois seulement : le bloc allongé ce jour-là, d’un seul tenant, sans flèche ; annuler la rend', async () => {
        const { server, ids } = tuesday();
        const session = open(server, TUESDAY, tabMemory(memoryStorage()));
        const action = asked(
            gestureExtension(session.current().day, new Map([[NINE - 15, SHOP_519]]), TUESDAY, 'replace'),
        );

        expect((await answer(session, action, 'once')).kind).toBe('saved');
        expect(shown(session)).toEqual([['08:45', '09:30', 'work', 'SHOP-519', null]]);
        expect(server.recurrence(ids[0] ?? '')?.until).toBeNull();
        expect(server.isSkipped(ids[0] ?? '', TUESDAY)).toBe(true);

        await session.undo();
        expect(shown(session)).toEqual([['09:00', '09:30', 'work', 'SHOP-519', null, ids[0]]]);
        expect(server.isSkipped(ids[0] ?? '', TUESDAY)).toBe(false);
    });

    it('sur un créneau qu’une autre prend à partir de la semaine prochaine : refusé, rien ne change', async () => {
        const { server, ids } = tuesday();
        // La revue de 09:30 à 09:45, chaque mardi à partir du 13.
        const review: SlotChange = { start: '09:30', end: '09:45', kind: 'work', ticket: 'OPS-7', comment: 'Revue' };
        expect(
            server.saveRecurrence('2026-10-13', server.read('2026-10-13').version, [review], weeklyRule([2]), null)
                .status,
        ).toBe('saved');
        const session = open(server, TUESDAY, tabMemory(memoryStorage()));
        const before = server.read(TUESDAY);
        const action = asked(
            gestureExtension(session.current().day, new Map([[NINE + 30, SHOP_519]]), TUESDAY, 'paste'),
        );

        expect(await answer(session, action, 'following')).toEqual({
            kind: 'invalid',
            violations: [
                {
                    field: 'recurrence.rhythm',
                    message: 'Ce créneau est déjà pris par la récurrence «\u{a0}Revue\u{a0}».',
                },
            ],
        });
        expect(server.read(TUESDAY)).toEqual(before);
        expect(server.recurrence(ids[0] ?? '')?.until).toBeNull();
    });
});

describe('raccourcir avec les suivantes', () => {
    it('garde à la récurrence les heures qui restent ; annuler et rétablir', async () => {
        const { server, ids } = tuesday();
        const session = open(server, TUESDAY, tabMemory(memoryStorage()));
        const action = asked(selectionShorten(session.current().day, [NINE + 15], TUESDAY));

        expect((await answer(session, action, 'following')).kind).toBe('saved');
        const born = server.allRecurrences().find((recurrence) => !ids.includes(recurrence.id));
        expect(born).toMatchObject({ ...weekly([2], 2), start: '09:00', end: '09:15' });
        expect(shown(session)).toEqual([['09:00', '09:15', 'work', 'SHOP-519', null, born?.id]]);
        expect(rangesOf(server.read('2026-10-20').grid)).toEqual([
            ['09:00', '09:15', 'work', 'SHOP-519', null, born?.id],
        ]);

        await session.undo();
        expect(shown(session)).toEqual([['09:00', '09:30', 'work', 'SHOP-519', null, ids[0]]]);
        await session.redo();
        expect(shown(session)).toEqual([['09:00', '09:15', 'work', 'SHOP-519', null, born?.id]]);
    });

    it('cette fois seulement : ce qui reste perd sa flèche, la récurrence continue', async () => {
        const { server, ids } = tuesday();
        const session = open(server, TUESDAY, tabMemory(memoryStorage()));
        const action = asked(selectionShorten(session.current().day, [NINE], TUESDAY));

        await answer(session, action, 'once');
        expect(shown(session)).toEqual([['09:15', '09:30', 'work', 'SHOP-519', null]]);
        expect(server.recurrence(ids[0] ?? '')?.until).toBeNull();
        expect(rangesOf(server.read('2026-10-20').grid)).toEqual([
            ['09:00', '09:30', 'work', 'SHOP-519', null, ids[0]],
        ]);
    });
});

describe('le serveur juge les heures du geste', () => {
    it('refuse d’allonger et de raccourcir d’un même geste : la récurrence se déplacerait', () => {
        const { server, ids } = tuesday();
        const before = server.read(TUESDAY);
        const result = server.saveRecurrence(
            TUESDAY,
            before.version,
            [
                { start: '09:00', end: '09:15', kind: 'empty', ticket: null, comment: null },
                { start: '09:30', end: '09:45', kind: 'work', ticket: 'SHOP-519', comment: null },
            ],
            POKER_RULE,
            { id: ids[0] ?? '', weekdays: [2], until: null },
        );

        expect(result).toEqual({
            status: 'invalid',
            violations: [{ field: 'changes', message: "Une récurrence couvre une seule plage, d'un seul ticket." }],
        });
        expect(server.read(TUESDAY)).toEqual(before);
    });

    it.each([
        [
            'un autre contenu au bord',
            [{ start: '09:45', end: '10:00', kind: 'work', ticket: 'SHOP-520', comment: null }],
        ],
        [
            'un effacement hors de sa plage',
            [{ start: '09:45', end: '10:00', kind: 'empty', ticket: null, comment: null }],
        ],
        [
            'un effacement qui la coupe en deux',
            [{ start: '09:15', end: '09:30', kind: 'empty', ticket: null, comment: null }],
        ],
        [
            'un allongement qui laisse un trou',
            [{ start: '10:00', end: '10:15', kind: 'work', ticket: 'SHOP-519', comment: null }],
        ],
        [
            'un allongement d’un côté et un effacement de l’autre',
            [
                { start: '09:00', end: '09:15', kind: 'empty', ticket: null, comment: null },
                { start: '09:45', end: '10:00', kind: 'work', ticket: 'SHOP-519', comment: null },
            ],
        ],
    ] as const)('refuse %s', (_, changes) => {
        // Un poker planning de 09:00 à 09:45 : effacer 09:15 le couperait en deux.
        const { server, ids } = tuesday([[{ ...POKER, end: '09:45' }, POKER_RULE]]);
        const before = server.read(TUESDAY);
        const result = server.saveRecurrence(TUESDAY, before.version, changes, POKER_RULE, {
            id: ids[0] ?? '',
            weekdays: [2],
            until: null,
        });

        expect(result.status).toBe('invalid');
        expect(server.read(TUESDAY)).toEqual(before);
    });
});
