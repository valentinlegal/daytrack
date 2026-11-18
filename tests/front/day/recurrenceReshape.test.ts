import { describe, expect, it } from 'vitest';

import {
    extension,
    gestureExtension,
    initialRecurrence,
    type RecurrenceDraft,
    recurrenceAction,
    selectionCut,
    selectionErase,
    selectionShorten,
} from '../../../assets/day/recurrenceDraft';
import { fill } from '../../../assets/grid/changes';
import type { DayState } from '../../../assets/grid/day';
import { type EntryTarget, pauseEntry, saveEntry, targetAt } from '../../../assets/grid/entry';
import { type Grid, linkedTo, PAUSE, unlinked, work } from '../../../assets/grid/grid';
import * as Quarter from '../../../assets/grid/quarter';
import { type Recurrence, weekly } from '../../../assets/grid/recurrence';
import { NOTHING_SENT } from '../../../assets/grid/send';
import { gridOf, minutes } from '../grid/support';

/**
 * Couper, allonger ou raccourcir un bloc qui revient, tels que l'écran les décide
 * (assets/day/recurrenceDraft.ts) : la question qu'un geste pose, ce que chaque réponse écrit, et
 * les cas où il ne demande rien. Jamais sur un jour passé.
 */

/** Mardi 6 octobre 2026 ; le lendemain le rend passé. */
const TUESDAY = '2026-10-06';
const WEDNESDAY = '2026-10-07';
const WEEK = [1, 2, 3, 4, 5];

/** La revue, chaque mardi, de 09:00 à 09:30, sans commentaire. */
const REVIEW: Recurrence = {
    id: 'review',
    start: minutes('09:00'),
    end: minutes('09:30'),
    rhythm: weekly([2]),
    firstDay: '2026-09-29',
    until: null,
    content: work('SHOP-519'),
};
/** Le Daily, chaque jour ouvré jusqu'au 4 novembre, de 10:00 à 10:30. */
const DAILY: Recurrence = {
    id: 'daily',
    start: minutes('10:00'),
    end: minutes('10:30'),
    rhythm: weekly(WEEK),
    firstDay: '2026-10-05',
    until: '2026-11-04',
    content: work('OPS-12', 'Daily'),
};
/** Le déjeuner, de 12:30 à 13:30, le lundi, le mardi et le jeudi. */
const LUNCH: Recurrence = {
    id: 'lunch',
    start: minutes('12:30'),
    end: minutes('13:30'),
    rhythm: weekly([1, 2, 4]),
    firstDay: '2026-10-05',
    until: null,
    content: PAUSE,
};

const GRID = gridOf([
    ['09:00', '09:30', 'work', 'SHOP-519', null, 'review'],
    ['10:00', '10:30', 'work', 'OPS-12', 'Daily', 'daily'],
    ['12:30', '13:30', 'pause', null, null, 'lunch'],
    ['14:00', '15:00', 'work', 'SHOP-482', null],
]);

function dayOf(
    grid: Grid = GRID,
    date = TUESDAY,
    recurrences: readonly Recurrence[] = [REVIEW, DAILY, LUNCH],
): DayState {
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

function at(...times: string[]): number[] {
    return times.map(minutes);
}

const SEEN_REVIEW = { id: 'review', weekdays: [2], until: null };
const REVIEW_RULE = { ...weekly([2]), until: null };
const SHOP_519 = work('SHOP-519');

describe('couper un bloc qui revient', () => {
    it('sa fois entière : la question, cette fois seulement la coupe ordinaire, avec les suivantes son rythme en plus', () => {
        const asked = selectionCut(dayOf(), at('09:00', '09:15'), TUESDAY);

        expect(asked?.target).toEqual(targetAt(GRID, minutes('09:00')));
        expect(asked?.action).toEqual({
            kind: 'ask',
            question: 'cut',
            once: {
                kind: 'write',
                changes: fill(at('09:00', '09:15'), null),
                gesture: 'cut',
                cuts: {
                    cells: [
                        { offset: 0, content: SHOP_519 },
                        { offset: 1, content: SHOP_519 },
                    ],
                },
            },
            following: {
                kind: 'recurrence',
                changes: fill(at('09:00', '09:15'), null),
                rule: null,
                replaces: SEEN_REVIEW,
                gesture: 'cut',
                cuts: {
                    cells: [
                        { offset: 0, content: SHOP_519 },
                        { offset: 1, content: SHOP_519 },
                    ],
                    recurrence: REVIEW_RULE,
                    // Collée, la nouvelle reprendra les fois sautées de la revue, et pas d'avant ce mardi.
                    source: { id: 'review', date: TUESDAY },
                },
            },
        });
    });

    it('avec des créneaux vides autour : la coupe ordinaire les garde, celle avec les suivantes n’emporte que la fois', () => {
        const asked = selectionCut(dayOf(), at('08:45', '09:00', '09:15', '09:30'), TUESDAY, minutes('09:30'));
        if (asked?.action.kind !== 'ask') {
            throw new Error('La question n’est pas posée.');
        }

        expect(asked.action.once.cuts?.cells.map(({ content }) => content)).toEqual([null, SHOP_519, SHOP_519, null]);
        expect(asked.action.following.cuts).toEqual({
            cells: [
                { offset: 0, content: SHOP_519 },
                { offset: 1, content: SHOP_519 },
            ],
            recurrence: REVIEW_RULE,
            source: { id: 'review', date: TUESDAY },
        });
        // La question s'ouvre sous le bloc, quel que soit le quart d'heure visé hors de lui.
        expect(asked.target).toEqual(targetAt(GRID, minutes('09:00')));
    });

    it('ne demande rien pour une partie de la fois, deux blocs qui reviennent, un bloc avec un autre, ou un jour passé', () => {
        expect(selectionCut(dayOf(), at('09:15'), TUESDAY)).toBeNull();
        expect(selectionCut(dayOf(), at('09:00', '09:15', '10:00', '10:15'), TUESDAY)).toBeNull();
        expect(selectionCut(dayOf(), [...at('09:00', '09:15'), ...at('14:00')], TUESDAY)).toBeNull();
        expect(selectionCut(dayOf(GRID, TUESDAY), at('09:00', '09:15'), WEDNESDAY)).toBeNull();
    });

    it('ne demande rien pour une fois en deux morceaux autour d’une saisie : il n’y a pas un bloc à déplacer', () => {
        // La revue de 09:00 à 09:45, posée autour d'un quart d'heure saisi avant elle.
        const long = { ...REVIEW, end: minutes('09:45') };
        const split = gridOf([
            ['09:00', '09:15', 'work', 'SHOP-519', null, 'review'],
            ['09:15', '09:30', 'work', 'SHOP-1', null],
            ['09:30', '09:45', 'work', 'SHOP-519', null, 'review'],
        ]);
        const day = dayOf(split, TUESDAY, [long]);

        // Effacer les deux morceaux demande ; les couper, non.
        expect(selectionErase(day, at('09:00', '09:30'), TUESDAY)).not.toBeNull();
        expect(selectionCut(day, at('09:00', '09:30'), TUESDAY)).toBeNull();
    });

    it('ne demande rien pour une fois posée en partie, d’un seul tenant : elle raccourcirait la série', () => {
        // La revue de 09:00 à 09:45, posée après 09:15 seulement : 09:00 était saisi avant elle.
        const long = { ...REVIEW, end: minutes('09:45') };
        const partial = gridOf([
            ['09:00', '09:15', 'work', 'SHOP-1', null],
            ['09:15', '09:45', 'work', 'SHOP-519', null, 'review'],
        ]);
        const day = dayOf(partial, TUESDAY, [long]);

        // Effacer sa fois demande ; la couper est la coupe ordinaire, sans récurrence.
        expect(selectionErase(day, at('09:15', '09:30'), TUESDAY)).not.toBeNull();
        expect(selectionCut(day, at('09:15', '09:30'), TUESDAY)).toBeNull();
        // Entière, elle se coupe avec la question.
        const whole = gridOf([['09:00', '09:45', 'work', 'SHOP-519', null, 'review']]);
        expect(selectionCut(dayOf(whole, TUESDAY, [long]), at('09:00', '09:15', '09:30'), TUESDAY)).not.toBeNull();
    });
});

describe('raccourcir un bloc qui revient', () => {
    it('son bas : la question, cette fois seulement l’effacement, avec les suivantes ses nouvelles heures', () => {
        const asked = selectionShorten(dayOf(), at('09:15'), TUESDAY);

        expect(asked).toEqual({
            target: { kind: 'new', quarters: at('09:15') },
            action: {
                kind: 'ask',
                question: 'shorten',
                once: { kind: 'write', changes: fill(at('09:15'), null), gesture: 'clear' },
                following: {
                    kind: 'recurrence',
                    changes: fill(at('09:15'), null),
                    rule: REVIEW_RULE,
                    replaces: SEEN_REVIEW,
                    gesture: 'clear',
                },
                reshapes: { content: linkedTo(SHOP_519, 'review'), start: minutes('09:00'), end: minutes('09:15') },
            },
        });
    });

    it('son haut, sur un ou plusieurs quarts d’heure', () => {
        expect(selectionShorten(dayOf(), at('09:00'), TUESDAY)?.action).toMatchObject({
            reshapes: { start: minutes('09:15'), end: minutes('09:30') },
        });
        expect(selectionShorten(dayOf(), at('12:30', '12:45'), TUESDAY)?.action).toMatchObject({
            reshapes: { content: linkedTo(PAUSE, 'lunch'), start: minutes('13:00'), end: minutes('13:30') },
        });
        // Le haut et le bas à la fois : il en reste le milieu, d'un seul tenant.
        expect(selectionShorten(dayOf(), at('12:30', '13:15'), TUESDAY)?.action).toMatchObject({
            reshapes: { start: minutes('12:45'), end: minutes('13:15') },
        });
    });

    it('avec des créneaux vides autour : cette fois seulement les efface aussi, avec les suivantes ne touche que le bloc', () => {
        const asked = selectionShorten(dayOf(), at('09:15', '09:30', '09:45'), TUESDAY);

        expect(asked?.action).toMatchObject({
            once: { changes: fill(at('09:15', '09:30', '09:45'), null) },
            following: { changes: fill(at('09:15'), null) },
        });
    });

    it('ne demande rien au milieu de la fois, sur la fois entière, deux blocs, un bloc avec un autre, ou un jour passé', () => {
        // Le milieu le couperait en deux.
        expect(selectionShorten(dayOf(), at('12:45'), TUESDAY)).toBeNull();
        expect(selectionShorten(dayOf(), at('12:45', '13:00'), TUESDAY)).toBeNull();
        // La fois entière, c'est la question « Effacer ».
        expect(selectionShorten(dayOf(), at('09:00', '09:15'), TUESDAY)).toBeNull();
        expect(selectionShorten(dayOf(), at('09:15', '10:00'), TUESDAY)).toBeNull();
        expect(selectionShorten(dayOf(), at('09:15', '14:00'), TUESDAY)).toBeNull();
        expect(selectionShorten(dayOf(), at('11:00'), TUESDAY)).toBeNull();
        expect(selectionShorten(dayOf(), at('09:15'), WEDNESDAY)).toBeNull();
    });

    it('ne demande rien sur une fois qui ne couvre pas sa plage ce jour-là', () => {
        // La revue de 09:00 à 09:45, dont 09:30 a été saisi avant qu'elle se pose.
        const long = { ...REVIEW, end: minutes('09:45') };
        const partial = gridOf([
            ['09:00', '09:30', 'work', 'SHOP-519', null, 'review'],
            ['09:30', '09:45', 'work', 'SHOP-1', null],
        ]);

        expect(selectionShorten(dayOf(partial, TUESDAY, [long]), at('09:15'), TUESDAY)).toBeNull();
    });

    it('ne demande rien sur un bloc dont la récurrence s’est arrêtée avant ce jour', () => {
        const ended = { ...REVIEW, until: '2026-10-05' };

        expect(selectionShorten(dayOf(GRID, TUESDAY, [ended, DAILY, LUNCH]), at('09:15'), TUESDAY)).toBeNull();
    });
});

describe('allonger un bloc qui revient', () => {
    function extended(changes: ReadonlyMap<number, ReturnType<typeof work> | null>, day = dayOf(), today = TUESDAY) {
        const found = extension(day, changes, today);

        return found === null ? null : { id: found.linked.id, start: found.start, end: found.end };
    }

    it('le même contenu juste au-dessous, juste au-dessus, ou des deux côtés', () => {
        expect(extended(fill(at('09:30'), SHOP_519))).toEqual({ id: 'review', start: 540, end: 585 });
        expect(extended(fill(at('08:30', '08:45'), SHOP_519))).toEqual({ id: 'review', start: 510, end: 570 });
        expect(extended(fill(at('08:45', '09:30'), SHOP_519))).toEqual({ id: 'review', start: 525, end: 585 });
        // Par-dessus son bas et au-delà.
        expect(extended(fill(at('09:15', '09:30'), SHOP_519))).toEqual({ id: 'review', start: 540, end: 585 });
        // Une pause au bord du déjeuner.
        expect(extended(fill(at('13:30'), PAUSE))).toEqual({ id: 'lunch', start: 750, end: 825 });
    });

    it('rien dans sa plage, rien qui ne le touche, ni un autre contenu', () => {
        expect(extended(fill(at('09:00'), SHOP_519))).toBeNull();
        expect(extended(fill(at('09:45'), SHOP_519))).toBeNull();
        expect(extended(fill(at('09:30', '10:00'), SHOP_519))).toBeNull();
        expect(extended(fill(at('09:30'), work('SHOP-520')))).toBeNull();
        expect(extended(fill(at('09:30'), work('SHOP-519', 'Revue')))).toBeNull();
        expect(extended(fill(at('09:30'), null))).toBeNull();
        expect(extended(new Map([...fill(at('09:30'), SHOP_519), ...fill(at('09:45'), PAUSE)]))).toBeNull();
    });

    it('ni un bloc posé en deux morceaux autour d’une autre saisie, ni deux blocs de part et d’autre', () => {
        const long = { ...REVIEW, end: minutes('09:45') };
        const split = gridOf([
            ['09:00', '09:15', 'work', 'SHOP-519', null, 'review'],
            ['09:15', '09:30', 'work', 'SHOP-1', null],
            ['09:30', '09:45', 'work', 'SHOP-519', null, 'review'],
        ]);
        expect(extended(fill(at('09:45'), SHOP_519), dayOf(split, TUESDAY, [long]))).toBeNull();

        // Une seconde revue de 09:45 à 10:00 : 09:30 les touche toutes les deux.
        const other: Recurrence = { ...REVIEW, id: 'other', start: minutes('09:45'), end: minutes('10:00') };
        const both = gridOf([
            ['09:00', '09:30', 'work', 'SHOP-519', null, 'review'],
            ['09:45', '10:00', 'work', 'SHOP-519', null, 'other'],
        ]);
        expect(extended(fill(at('09:30'), SHOP_519), dayOf(both, TUESDAY, [REVIEW, other]))).toBeNull();
        // Au bord d'une seule des deux, il l'allonge.
        expect(extended(fill(at('10:00'), SHOP_519), dayOf(both, TUESDAY, [REVIEW, other]))).toEqual({
            id: 'other',
            start: 585,
            end: 615,
        });
    });

    it('jamais sur un jour passé, ni sur un bloc dont la récurrence s’est arrêtée avant', () => {
        expect(extended(fill(at('09:30'), SHOP_519), dayOf(), WEDNESDAY)).toBeNull();
        const ended = { ...REVIEW, until: '2026-10-05' };
        expect(extended(fill(at('09:30'), SHOP_519), dayOf(GRID, TUESDAY, [ended]))).toBeNull();
    });

    it('collé ou déposé : la question, ouverte sur ce qu’on pose, et ce que chaque réponse écrit', () => {
        const changes = fill(at('09:45', '09:30'), SHOP_519);
        const asked = gestureExtension(dayOf(), changes, TUESDAY, 'paste');

        expect(asked).toEqual({
            target: { kind: 'new', quarters: at('09:30', '09:45') },
            action: {
                kind: 'ask',
                question: 'extend',
                // Cette fois seulement : le bloc entier ce jour-là, sans sa flèche.
                once: {
                    kind: 'write',
                    changes: fill(at('09:00', '09:15', '09:45', '09:30'), SHOP_519),
                    gesture: 'paste',
                },
                following: {
                    kind: 'recurrence',
                    changes,
                    rule: REVIEW_RULE,
                    replaces: SEEN_REVIEW,
                    gesture: 'paste',
                },
                reshapes: { content: linkedTo(SHOP_519, 'review'), start: minutes('09:00'), end: minutes('10:00') },
            },
        });
        expect(gestureExtension(dayOf(), fill(at('11:00'), SHOP_519), TUESDAY, 'replace')).toBeNull();
    });

    it('écrit toujours le contenu sans son lien, même collé d’une autre récurrence', () => {
        const asked = gestureExtension(dayOf(), fill(at('09:30'), linkedTo(SHOP_519, 'daily')), TUESDAY, 'paste');
        if (asked?.action.kind !== 'ask') {
            throw new Error('La question n’est pas posée.');
        }

        for (const cell of [...asked.action.once.changes.values(), ...asked.action.following.changes.values()]) {
            expect(cell).toEqual(unlinked(SHOP_519));
        }
    });
});

describe('allonger depuis la fenêtre', () => {
    /** La case cochée, chaque semaine ces jours-là, jusqu'à cette fin. */
    function checked(target: EntryTarget, weekdays: readonly number[], until = ''): RecurrenceDraft {
        const initial = initialRecurrence(target, dayOf());
        if (initial === null) {
            throw new Error("La fenêtre n'a pas de case.");
        }

        return { ...initial, on: true, pace: 'week', weekdays, until };
    }

    function saved(target: EntryTarget, ticket: string, comment: string, weekdays: readonly number[], until = '') {
        const base = saveEntry(target, { ticket, comment });

        return recurrenceAction(
            base,
            target,
            checked(target, weekdays, until),
            initialRecurrence(target, dayOf()),
            dayOf(),
            TUESDAY,
        );
    }

    const below: EntryTarget = { kind: 'new', quarters: at('09:30') };

    it('Nouveau ticket au bord, même ticket, même commentaire, même rythme, même fin : la question « Allonger »', () => {
        expect(saved(below, 'SHOP-519', '', [2])).toEqual({
            kind: 'ask',
            question: 'extend',
            once: {
                kind: 'write',
                changes: fill(at('09:00', '09:15', '09:30'), SHOP_519),
                gesture: 'replace',
            },
            following: {
                kind: 'recurrence',
                changes: fill(at('09:30'), SHOP_519),
                rule: REVIEW_RULE,
                replaces: SEEN_REVIEW,
                gesture: 'replace',
            },
            reshapes: { content: linkedTo(SHOP_519, 'review'), start: minutes('09:00'), end: minutes('09:45') },
        });
        expect(
            saved({ kind: 'new', quarters: at('10:30', '10:45') }, 'OPS-12', 'Daily', WEEK, '2026-11-04'),
        ).toMatchObject({
            kind: 'ask',
            question: 'extend',
            reshapes: { start: minutes('10:00'), end: minutes('11:00') },
        });
    });

    it('un autre rythme, une autre fin, un autre commentaire ou ticket : une récurrence à part, collée à la première', () => {
        for (const action of [
            saved(below, 'SHOP-519', '', [2, 4]),
            saved(below, 'SHOP-519', '', [2], '2026-12-31'),
            saved(below, 'SHOP-519', 'Revue', [2]),
            saved(below, 'SHOP-520', '', [2]),
            saved({ kind: 'new', quarters: at('10:30') }, 'OPS-12', 'Daily', WEEK),
        ]) {
            expect(action).toMatchObject({ kind: 'recurrence', replaces: null });
        }
    });

    it('une pause au bord du déjeuner, ou un bloc déjà saisi qu’on fait revenir, s’allongent de même', () => {
        const nextToLunch: EntryTarget = { kind: 'new', quarters: at('13:30') };
        expect(
            recurrenceAction(
                pauseEntry(nextToLunch),
                nextToLunch,
                checked(nextToLunch, [1, 2, 4]),
                initialRecurrence(nextToLunch, dayOf()),
                dayOf(),
                TUESDAY,
            ),
        ).toMatchObject({
            kind: 'ask',
            question: 'extend',
            reshapes: { start: minutes('12:30'), end: minutes('13:45') },
        });

        // Une pause déjà saisie de 13:30 à 13:45, rien de changé, la case cochée au rythme du déjeuner.
        const grid = gridOf([
            ['12:30', '13:30', 'pause', null, null, 'lunch'],
            ['13:30', '13:45', 'pause', null, null],
        ]);
        const day = dayOf(grid);
        const block = targetAt(grid, minutes('13:30'));
        const initial = initialRecurrence(block, day);
        if (initial === null) {
            throw new Error("La fenêtre n'a pas de case.");
        }
        expect(
            recurrenceAction(
                saveEntry(block, { ticket: '', comment: '' }),
                block,
                { ...initial, on: true, weekdays: [1, 2, 4] },
                initial,
                day,
                TUESDAY,
            ),
        ).toMatchObject({
            kind: 'ask',
            question: 'extend',
            reshapes: { start: minutes('12:30'), end: minutes('13:45') },
        });
    });

    it('jamais d’un jour passé', () => {
        const day = dayOf(GRID, TUESDAY);
        const base = saveEntry(below, { ticket: 'SHOP-519', comment: '' });
        const draft = checked(below, [2]);

        expect(recurrenceAction(base, below, draft, initialRecurrence(below, day), day, WEDNESDAY)).toMatchObject({
            kind: 'recurrence',
            replaces: null,
        });
    });

    it('le quart d’heure collé tout en bas de la journée allonge un bloc qui finit à 19:45', () => {
        const late: Recurrence = { ...REVIEW, id: 'late', start: minutes('19:15'), end: minutes('19:45') };
        const grid = gridOf([['19:15', '19:45', 'work', 'SHOP-519', null, 'late']]);

        expect(extension(dayOf(grid, TUESDAY, [late]), fill([Quarter.LAST], SHOP_519), TUESDAY)).toMatchObject({
            start: minutes('19:15'),
            end: Quarter.DAY_END,
        });
        const early: Recurrence = { ...REVIEW, id: 'early', start: minutes('07:15'), end: minutes('07:30') };
        const top = gridOf([['07:15', '07:30', 'work', 'SHOP-519', null, 'early']]);
        expect(extension(dayOf(top, TUESDAY, [early]), fill([Quarter.FIRST], SHOP_519), TUESDAY)).toMatchObject({
            start: Quarter.FIRST,
            end: minutes('07:30'),
        });
    });
});
