import { describe, expect, it } from 'vitest';

import { eraseAction, initialRecurrence, recurrenceAction, selectionErase } from '../../../assets/day/recurrenceDraft';
import { fill, type SlotChange } from '../../../assets/grid/changes';
import type { DayState } from '../../../assets/grid/day';
import { DaySession, type Outcome, tabMemory } from '../../../assets/grid/daySession';
import { DaySessions } from '../../../assets/grid/daySessions';
import { deleteEntry, draftOf, type EntryAction, quartersOf, saveEntry, targetAt } from '../../../assets/grid/entry';
import { PAUSE, work } from '../../../assets/grid/grid';
import * as Quarter from '../../../assets/grid/quarter';
import { FakeDayServer, type Transport } from './fakeDayServer';
import { memoryStorage, minutes, type Range, rangesOf, weeklyRule } from './support';

/**
 * « Cette fois seulement » ou « Cette fois et les suivantes », sur un bloc qui revient, joués
 * comme l'écran les jouera : la question décidée par la fenêtre ou par Suppr
 * (assets/day/recurrenceDraft.ts), cette fois seulement par un geste de la grille (apply),
 * avec les suivantes par la fenêtre (saveRecurrence) — contre le faux serveur, aussi strict
 * que le vrai (tests/Api/RecurrenceScopeTest.php).
 *
 * Aujourd'hui, où la fois est posée, et un jour à venir, où elle n'est que prévue : à chaque
 * pas, la grille montrée est ce que le serveur montre ; annuler et rétablir vont jusqu'au bout ;
 * un onglet resté ouvert sur la journée, ou sur le lendemain, est refusé s'il ne l'a pas vue
 * changer ; une réponse arrivée après un changement de jour n'atteint pas la journée affichée.
 */

const MONDAY = '2026-10-05';
const TODAY = '2026-10-06';
const WEDNESDAY = '2026-10-07';
const THURSDAY = '2026-10-08';
const WEEK = [1, 2, 3, 4, 5];

const NINE = minutes('09:00');
const DAILY: SlotChange = { start: '09:00', end: '09:30', kind: 'work', ticket: 'OPS-12', comment: 'Daily' };
const LUNCH: SlotChange = { start: '12:30', end: '13:30', kind: 'pause', ticket: null, comment: null };
/** Les bornes de la journée : une pause de 07:00 à 07:15, le point du soir de 19:45 à 20:00. */
const EARLY: SlotChange = { start: '07:00', end: '07:15', kind: 'pause', ticket: null, comment: null };
const LATE: SlotChange = { start: '19:45', end: '20:00', kind: 'work', ticket: 'OPS-7', comment: 'Soir' };

/**
 * Le serveur un mardi : ces récurrences nées lundi, chaque jour ouvré, posées ce mardi, prévues
 * à partir de mercredi. Leurs identifiants, dans l'ordre.
 */
function tuesday(changes: readonly SlotChange[] = [DAILY]): { server: FakeDayServer; ids: string[] } {
    const server = new FakeDayServer(MONDAY);
    for (const change of changes) {
        const created = server.saveRecurrence(MONDAY, server.read(MONDAY).version, [change], weeklyRule(WEEK), null);
        if (created.status !== 'saved') {
            throw new Error(`La récurrence de ${change.start} n'est pas née : ${JSON.stringify(created)}.`);
        }
    }
    server.setToday(TODAY);
    server.pose(TODAY);

    return { server, ids: server.allRecurrences().map((recurrence) => recurrence.id) };
}

function open(server: FakeDayServer, date: string, api = server.api()): DaySession {
    return new DaySession(server.read(date), api, tabMemory(memoryStorage()));
}

/**
 * Le geste qui pose la question : dans la fenêtre, un autre commentaire — un ticket tapé sur
 * une pause —, la case décochée, la corbeille ; ou Suppr sur la sélection du bloc.
 */
type Gesture = 'modify' | 'stop' | 'trash' | 'delete';
type Scope = 'once' | 'following';
type Ask = Extract<EntryAction, { readonly kind: 'ask' }>;

/** La question que l'écran pose sur le bloc de ce quart d'heure, telle que la fenêtre la décide, ce mardi. */
function ask(day: DayState, gesture: Gesture, at: number): Ask {
    const target = targetAt(day.grid, at);
    const initial = initialRecurrence(target, day);
    let action: EntryAction | null;
    switch (gesture) {
        case 'modify': {
            const typed =
                target.kind === 'edit' && target.block.content.kind === 'pause'
                    ? { ticket: 'OPS-7', comment: '' }
                    : { ...draftOf(target), comment: 'Rétro' };
            action = recurrenceAction(saveEntry(target, typed), target, initial, initial, day, TODAY);
            break;
        }
        case 'stop':
            action = recurrenceAction(
                saveEntry(target, draftOf(target)),
                target,
                initial === null ? null : { ...initial, on: false },
                initial,
                day,
                TODAY,
            );
            break;
        case 'trash':
            action = eraseAction(target, day, TODAY);
            break;
        case 'delete':
            action = selectionErase(day, quartersOf(target), TODAY)?.action ?? null;
            break;
    }
    if (action?.kind !== 'ask') {
        throw new Error(`« ${gesture} » ne pose pas la question : ${JSON.stringify(action)}.`);
    }

    return action;
}

/** La réponse, comme l'écran la jouera : cette fois seulement, un geste de la grille ; avec les suivantes, la fenêtre. */
function answer(session: DaySession, asked: Ask, scope: Scope): Promise<Outcome> {
    if (scope === 'once') {
        return session.apply(asked.once.changes);
    }
    const { changes, rule, replaces } = asked.following;

    return session.saveRecurrence(changes, rule, replaces);
}

/** L'écran montre ce que le serveur montre de cette journée, à la même version : ni double, ni fantôme. */
function expectShownAsServed(session: DaySession, server: FakeDayServer): void {
    const shown = session.current().day;
    const served = server.read(session.date);
    expect(rangesOf(shown.grid)).toEqual(rangesOf(served.grid));
    expect(shown.version).toBe(served.version);
    expect(shown.grid.workedMinutes()).toBe(served.grid.workedMinutes());
}

/** Ce que la réponse laisse du Daily ce jour-là, et de sa récurrence. */
interface Expected {
    /** Le commentaire du bloc qui reste, ou null s'il est effacé. */
    readonly block: 'Daily' | 'Rétro' | null;
    /** Il est relié à la récurrence née de la coupe. */
    readonly cut: boolean;
    /** Le Daily finit la veille. */
    readonly ends: boolean;
    /** Sa fois de ce jour-là reste sautée : rien ne l'y repose ni ne l'y prévoit. */
    readonly skipped: boolean;
}

const ANSWERS: readonly (readonly [string, Gesture, Scope, Expected])[] = [
    [
        'un autre commentaire, cette fois seulement : la fois se détache, la récurrence continue',
        'modify',
        'once',
        { block: 'Rétro', cut: false, ends: false, skipped: true },
    ],
    [
        'un autre commentaire avec les suivantes : la récurrence se coupe, et la coupe garde son saut',
        'modify',
        'following',
        { block: 'Rétro', cut: true, ends: true, skipped: true },
    ],
    [
        'la case décochée, cette fois seulement : le bloc reste sans lien, la récurrence continue',
        'stop',
        'once',
        { block: 'Daily', cut: false, ends: false, skipped: true },
    ],
    [
        'la case décochée avec les suivantes : le bloc reste sans lien, la récurrence finit la veille, sans saut',
        'stop',
        'following',
        { block: 'Daily', cut: false, ends: true, skipped: false },
    ],
    [
        'la corbeille, cette fois seulement : la fois s’efface, la récurrence continue',
        'trash',
        'once',
        { block: null, cut: false, ends: false, skipped: true },
    ],
    [
        'la corbeille avec les suivantes : le bloc s’efface, la récurrence finit la veille, sans saut',
        'trash',
        'following',
        { block: null, cut: false, ends: true, skipped: false },
    ],
    ['Suppr, cette fois seulement', 'delete', 'once', { block: null, cut: false, ends: false, skipped: true }],
    ['Suppr avec les suivantes', 'delete', 'following', { block: null, cut: false, ends: true, skipped: false }],
];

describe.each([
    { name: 'aujourd’hui, où la fois est posée', date: TODAY, eve: MONDAY, next: WEDNESDAY, before: [MONDAY] },
    {
        name: 'un jour à venir, où la fois n’est que prévue',
        date: WEDNESDAY,
        eve: TODAY,
        next: THURSDAY,
        before: [MONDAY, TODAY],
    },
])('DaySession, cette fois ou les suivantes, $name', ({ date, eve, next, before }) => {
    it.each(ANSWERS)('%s', async (_, gesture, scope, expected) => {
        const { server, ids } = tuesday();
        const daily = ids[0] ?? '';
        const session = open(server, date);
        // Deux onglets restés ouverts : sur la même journée, et sur le lendemain.
        const late = open(server, date);
        const ahead = open(server, next);
        const start = rangesOf(session.current().day.grid);
        const nextStart = rangesOf(server.read(next).grid);
        const daily9: Range = ['09:00', '09:30', 'work', 'OPS-12', 'Daily', daily];
        expect(start).toEqual([daily9]);
        expect(nextStart).toEqual([daily9]);

        await expect(answer(session, ask(session.current().day, gesture, NINE), scope)).resolves.toMatchObject({
            kind: 'saved',
        });
        const born = server.allRecurrences().find((recurrence) => recurrence.id !== daily)?.id;
        expect(born !== undefined).toBe(expected.cut);
        const block = (comment: 'Daily' | 'Rétro'): Range =>
            born === undefined
                ? ['09:00', '09:30', 'work', 'OPS-12', comment]
                : ['09:00', '09:30', 'work', 'OPS-12', comment, born];
        const after = expected.block === null ? [] : [block(expected.block)];
        const nextAfter = !expected.ends ? nextStart : born === undefined ? [] : [block('Rétro')];
        const expectAnswered = (): void => {
            expect(rangesOf(session.current().day.grid)).toEqual(after);
            expectShownAsServed(session, server);
            expect(server.recurrence(daily)?.until).toBe(expected.ends ? eve : null);
            expect(server.allSkips()).toEqual(expected.skipped ? [`${daily} ${date}`] : []);
            expect(rangesOf(server.read(next).grid)).toEqual(nextAfter);
            // Les jours d'avant ne changent jamais.
            for (const day of before) {
                expect(rangesOf(server.read(day).grid)).toEqual([daily9]);
            }
            if (born !== undefined) {
                expect(server.recurrence(born)).toMatchObject({ firstDay: date, until: null });
            }
        };
        expectAnswered();
        // Un jour à venir où rien ne reste saisi ne naît pas.
        expect(server.exists(date)).toBe(date === TODAY || expected.block !== null);

        // L'onglet resté sur la journée ne l'a pas vue changer : son geste est refusé, et il se
        // remet sur la journée à jour. Celui du lendemain aussi, si les suivantes ont changé.
        const writes = server.writes.length;
        await expect(late.apply(fill([minutes('14:00')], PAUSE))).resolves.toEqual({ kind: 'stale' });
        expect(rangesOf(late.current().day.grid)).toEqual(after);
        if (scope === 'following') {
            await expect(ahead.apply(fill([minutes('14:00')], PAUSE))).resolves.toEqual({ kind: 'stale' });
            expect(rangesOf(ahead.current().day.grid)).toEqual(nextAfter);
        } else {
            expect(ahead.current().day.version).toBe(server.read(next).version);
        }
        expect(server.writes).toHaveLength(writes);

        // Annuler rend tout : le bloc relié, la fin d'avant, aucun saut du Daily ; une récurrence
        // née de la coupe est retirée, et garde le saut de la fois qu'annuler lui reprend, sans
        // effet : elle ne tombe plus jamais, et rétablir le lui ôte.
        const expectStart = (): void => {
            expect(rangesOf(session.current().day.grid)).toEqual(start);
            expectShownAsServed(session, server);
            expect(server.recurrence(daily)?.until).toBeNull();
            expect(server.allSkips()).toEqual(born === undefined ? [] : [`${born} ${date}`]);
            expect(rangesOf(server.read(next).grid)).toEqual(nextStart);
            if (born !== undefined) {
                expect(server.recurrence(born)?.until).toBe(eve);
            }
            // Aujourd'hui, posée ; un jour à venir, de nouveau prévue, sans rien d'écrit.
            expect([...server.links(date).values()]).toEqual(date === TODAY ? [daily, daily] : []);
        };
        for (let round = 0; round < 2; round += 1) {
            await expect(session.undo()).resolves.toMatchObject({ kind: 'saved' });
            expectStart();
            expect(session.current()).toMatchObject({ canUndo: false, canRedo: true });
            await expect(session.undo()).resolves.toEqual({ kind: 'nothing' });

            // Rétablir refait la réponse, saut compris : seule la coupe garde le sien.
            await expect(session.redo()).resolves.toMatchObject({ kind: 'saved' });
            expectAnswered();
            expect(session.current()).toMatchObject({ canUndo: true, canRedo: false });
            await expect(session.redo()).resolves.toEqual({ kind: 'nothing' });
        }
    });
});

/** Le stand-up, de 15:00 à 16:00, né lundi ; un quart d'heure saisi avant lui à 15:30 le pose en deux morceaux. */
const STANDUP: SlotChange = { start: '15:00', end: '16:00', kind: 'work', ticket: 'OPS-12', comment: 'Stand-up' };
const AT_HALF: SlotChange = { start: '15:30', end: '15:45', kind: 'work', ticket: 'SHOP-482', comment: null };

/** Le serveur un mardi, le stand-up posé ce mardi et prévu mercredi, chaque fois en deux morceaux. */
function standupInPieces(): { server: FakeDayServer; standup: string } {
    const server = new FakeDayServer(MONDAY);
    // Saisi avant qu'il naisse : saisi après, le quart d'heure détacherait sa fois.
    for (const date of [TODAY, WEDNESDAY]) {
        server.changeSlots(date, server.read(date).version, [AT_HALF]);
    }
    server.saveRecurrence(MONDAY, server.read(MONDAY).version, [STANDUP], weeklyRule(WEEK), null);
    server.setToday(TODAY);
    server.pose(TODAY);

    return { server, standup: server.allRecurrences()[0]?.id ?? '' };
}

describe('DaySession, une fois posée en deux morceaux', () => {
    it.each([
        ['aujourd’hui', TODAY, MONDAY],
        ['un jour à venir', WEDNESDAY, TODAY],
    ])('%s, les deux réponses changent la fois entière, quel que soit le morceau ouvert', async (_, date, eve) => {
        const half: Range = ['15:30', '15:45', 'work', 'SHOP-482', null];
        for (const [gesture, at] of [
            ['trash', minutes('15:45')],
            ['modify', minutes('15:00')],
            ['delete', minutes('15:00')],
        ] as const) {
            for (const scope of ['once', 'following'] as const) {
                const { server, standup } = standupInPieces();
                const session = open(server, date);
                const start = rangesOf(session.current().day.grid);
                expect(start).toEqual([
                    ['15:00', '15:30', 'work', 'OPS-12', 'Stand-up', standup],
                    half,
                    ['15:45', '16:00', 'work', 'OPS-12', 'Stand-up', standup],
                ]);
                const asked =
                    gesture === 'delete'
                        ? (selectionErase(
                              session.current().day,
                              [minutes('15:00'), minutes('15:15'), minutes('15:45')],
                              TODAY,
                          )?.action ?? null)
                        : ask(session.current().day, gesture, at);
                if (asked === null) {
                    throw new Error('Suppr ne pose pas la question.');
                }

                await expect(answer(session, asked, scope)).resolves.toMatchObject({ kind: 'saved' });
                const born = server.allRecurrences().find((recurrence) => recurrence.id !== standup)?.id;
                const piece = (from: string, to: string): Range =>
                    born === undefined
                        ? [from, to, 'work', 'OPS-12', 'Rétro']
                        : [from, to, 'work', 'OPS-12', 'Rétro', born];
                const answered =
                    gesture === 'modify' ? [piece('15:00', '15:30'), half, piece('15:45', '16:00')] : [half];
                const label = `${gesture}, ${scope}`;
                expect(rangesOf(session.current().day.grid), label).toEqual(answered);
                expectShownAsServed(session, server);
                expect(server.recurrence(standup)?.until, label).toBe(scope === 'once' ? null : eve);

                await expect(session.undo()).resolves.toMatchObject({ kind: 'saved' });
                expect(rangesOf(session.current().day.grid), label).toEqual(start);
                expectShownAsServed(session, server);
                await expect(session.redo()).resolves.toMatchObject({ kind: 'saved' });
                expect(rangesOf(session.current().day.grid), label).toEqual(answered);
                expectShownAsServed(session, server);
            }
        }
    });
});

describe('DaySession, la même réponse envoyée deux fois', () => {
    it.each([
        ['cette fois seulement', 'once', { kind: 'unchanged' }],
        ['avec les suivantes', 'following', { kind: 'stale' }],
    ] as const)('ne s’enregistre qu’une fois, %s', async (_, scope, second) => {
        const { server, ids } = tuesday();
        const daily = ids[0] ?? '';
        const session = open(server, TODAY);
        const asked = ask(session.current().day, 'trash', NINE);
        const writes = server.writes.length;

        // Un double clic sur la réponse : la seconde part de la journée que la première a laissée.
        // Avec les suivantes, la récurrence qu'elle remplace n'est plus celle qu'elle a vue.
        await expect(Promise.all([answer(session, asked, scope), answer(session, asked, scope)])).resolves.toEqual([
            expect.objectContaining({ kind: 'saved' }),
            second,
        ]);
        expect(server.writes).toHaveLength(writes + 1);
        expect(rangesOf(session.current().day.grid)).toEqual([]);
        expectShownAsServed(session, server);
        expect(server.recurrence(daily)?.until).toBe(scope === 'once' ? null : MONDAY);

        // Un seul geste à annuler.
        await expect(session.undo()).resolves.toMatchObject({ kind: 'saved' });
        expect(rangesOf(session.current().day.grid)).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', daily]]);
        expect(session.current().canUndo).toBe(false);
    });
});

describe('DaySession, plusieurs réponses à la suite', () => {
    it.each([
        ['aujourd’hui', TODAY, WEDNESDAY],
        ['un jour à venir', WEDNESDAY, THURSDAY],
    ])(
        '%s, aux bornes de la journée et sur une pause : tout annuler rend la journée de départ, tout rétablir celle d’après',
        async (_, date, next) => {
            const { server, ids } = tuesday([EARLY, DAILY, LUNCH, LATE]);
            const [early, daily, lunch, late] = ids;
            const session = open(server, date);
            const start = rangesOf(session.current().day.grid);
            expect(start).toEqual([
                ['07:00', '07:15', 'pause', null, null, early],
                ['09:00', '09:30', 'work', 'OPS-12', 'Daily', daily],
                ['12:30', '13:30', 'pause', null, null, lunch],
                ['19:45', '20:00', 'work', 'OPS-7', 'Soir', late],
            ]);
            const nextStart = rangesOf(server.read(next).grid);
            const play = async (gesture: Gesture, at: number, scope: Scope): Promise<void> => {
                await expect(answer(session, ask(session.current().day, gesture, at), scope)).resolves.toMatchObject({
                    kind: 'saved',
                });
                expectShownAsServed(session, server);
            };

            // Suppr sur la pause de 07:00, avec les suivantes ; le Daily commenté autrement, cette
            // fois seulement ; le point de 19:45 arrêté, avec les suivantes ; un ticket tapé sur
            // la pause du déjeuner, avec les suivantes ; puis la fois née de la coupe effacée,
            // cette fois seulement.
            await play('delete', Quarter.FIRST, 'following');
            await play('modify', NINE, 'once');
            await play('stop', Quarter.LAST, 'following');
            await play('modify', minutes('12:30'), 'following');
            const born = server.allRecurrences().at(-1)?.id ?? '';
            await play('trash', minutes('12:30'), 'once');
            const end = rangesOf(session.current().day.grid);
            expect(end).toEqual([
                ['09:00', '09:30', 'work', 'OPS-12', 'Rétro'],
                ['19:45', '20:00', 'work', 'OPS-7', 'Soir'],
            ]);
            const skips = [...[daily, lunch, born].map((id) => `${id ?? ''} ${date}`)].sort();
            expect(server.allSkips()).toEqual(skips);
            const nextEnd = rangesOf(server.read(next).grid);
            expect(nextEnd).toEqual([
                ['09:00', '09:30', 'work', 'OPS-12', 'Daily', daily],
                ['12:30', '13:30', 'work', 'OPS-7', null, born],
            ]);

            for (let undone = 0; undone < 5; undone += 1) {
                await expect(session.undo()).resolves.toMatchObject({ kind: 'saved' });
                expectShownAsServed(session, server);
            }
            expect(session.current().canUndo).toBe(false);
            expect(rangesOf(session.current().day.grid)).toEqual(start);
            expect(rangesOf(server.read(next).grid)).toEqual(nextStart);
            // Seule la récurrence née de la coupe, retirée, garde le saut de ce jour-là.
            expect(server.allSkips()).toEqual([`${born} ${date}`]);
            for (const id of [early, daily, lunch, late]) {
                expect(server.recurrence(id ?? '')?.until).toBeNull();
            }
            expect(server.recurrence(born)?.until).toBe(date === TODAY ? MONDAY : TODAY);

            for (let redone = 0; redone < 5; redone += 1) {
                await expect(session.redo()).resolves.toMatchObject({ kind: 'saved' });
                expectShownAsServed(session, server);
            }
            expect(session.current().canRedo).toBe(false);
            expect(rangesOf(session.current().day.grid)).toEqual(end);
            expect(rangesOf(server.read(next).grid)).toEqual(nextEnd);
            expect(server.allSkips()).toEqual(skips);
        },
    );
});

describe('DaySession, un bloc dont la récurrence ne va plus jusqu’à ce jour', () => {
    it('se lit sans lien, fondu avec son voisin, ne pose plus la question, et annuler l’arrêt lui rend son lien', async () => {
        const { server, ids } = tuesday();
        const daily = ids[0] ?? '';
        // Le mercredi, à venir, est envoyé : sa fois s'y écrit, reliée. Un quart d'heure saisi
        // juste après, au même contenu, reste un autre bloc.
        const sent = open(server, WEDNESDAY);
        await expect(sent.sendToJira()).resolves.toEqual({ kind: 'done' });
        await sent.apply(fill([minutes('09:30')], work('OPS-12', 'Daily')));
        const linked: Range[] = [
            ['09:00', '09:30', 'work', 'OPS-12', 'Daily', daily],
            ['09:30', '09:45', 'work', 'OPS-12', 'Daily'],
        ];
        expect(rangesOf(sent.current().day.grid)).toEqual(linked);
        const version = sent.current().day.version;

        // Ce mardi, le Daily s'arrête avec les suivantes : il finit lundi.
        const today = open(server, TODAY);
        await expect(answer(today, ask(today.current().day, 'stop', NINE), 'following')).resolves.toMatchObject({
            kind: 'saved',
        });
        expect(server.recurrence(daily)?.until).toBe(MONDAY);

        // Le mercredi garde ce qui y est écrit, et son lien en base ; il se lit sans lien, d'un
        // seul bloc, et change de version : sa flèche est partie.
        const merged: Range[] = [['09:00', '09:45', 'work', 'OPS-12', 'Daily']];
        expect(rangesOf(server.read(WEDNESDAY).grid)).toEqual(merged);
        expect(server.read(WEDNESDAY).recurrences.size).toBe(0);
        expect([...server.links(WEDNESDAY).values()]).toEqual([daily, daily, null]);
        expect(server.read(WEDNESDAY).version).not.toBe(version);
        const fresh = open(server, WEDNESDAY);
        const block = targetAt(fresh.current().day.grid, NINE);
        expect(eraseAction(block, fresh.current().day, TODAY)).toEqual(deleteEntry(block));
        expect(selectionErase(fresh.current().day, Quarter.between(NINE, minutes('09:45')), TODAY)).toBeNull();

        // L'onglet resté sur le mercredi la croit encore là : il est en retard, effacer avec les
        // suivantes y est refusé, sans rien écrire, et il se remet sur la journée à jour.
        expect(rangesOf(sent.current().day.grid)).toEqual(linked);
        const writes = server.writes.length;
        await expect(answer(sent, ask(sent.current().day, 'trash', NINE), 'following')).resolves.toEqual({
            kind: 'stale',
        });
        expect(server.writes).toHaveLength(writes);
        expect(rangesOf(sent.current().day.grid)).toEqual(merged);
        expect(server.recurrence(daily)?.until).toBe(MONDAY);

        // Annuler l'arrêt, mardi : le mercredi retrouve le lien de sa fois.
        await expect(today.undo()).resolves.toMatchObject({ kind: 'saved' });
        expect(server.recurrence(daily)?.until).toBeNull();
        expect(rangesOf(server.read(WEDNESDAY).grid)).toEqual(linked);
        expect(rangesOf(server.read(TODAY).grid)).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', daily]]);
    });
});

/** Des réponses retenues jusqu'à ce que le test les relâche : la requête, elle, arrive aussitôt. */
function held(): { transport: Transport; sent: () => Promise<void>; release: () => void } {
    const waiting: (() => void)[] = [];

    return {
        transport: (_, handle) => {
            const result = handle();

            return new Promise((resolve) =>
                waiting.push(() => {
                    resolve(result);
                }),
            );
        },
        sent: async () => {
            while (waiting.length === 0) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        },
        release: () => {
            waiting.splice(0).forEach((resolve) => {
                resolve();
            });
        },
    };
}

describe('DaySession, une réponse arrivée après un changement de jour', () => {
    it.each(['once', 'following'] as const)(
        'n’atteint pas la journée affichée (%s), et Ctrl+Z la défait au retour',
        async (scope) => {
            const { server, ids } = tuesday();
            const daily = ids[0] ?? '';
            const { transport, sent, release } = held();
            const sessions = new DaySessions(server.api(transport), tabMemory(memoryStorage()));
            const opening = sessions.open(TODAY);
            await sent();
            release();
            const today = await opening;
            if (today === null) {
                throw new Error('Le mardi ne s’est pas ouvert.');
            }
            let notified = 0;
            today.subscribe(() => {
                notified += 1;
            });

            const erased = answer(today, ask(today.current().day, 'trash', NINE), scope);
            await sent();
            const before = notified;
            const opened = sessions.open(WEDNESDAY);
            // La réponse du mardi arrive une fois le mercredi demandé.
            release();
            await expect(erased).resolves.toMatchObject({ kind: 'saved' });
            await sent();
            release();
            const wednesday = await opened;
            if (wednesday === null) {
                throw new Error('Le mercredi ne s’est pas ouvert.');
            }

            expect(notified).toBe(before);
            expect(wednesday.date).toBe(WEDNESDAY);
            expect(wednesday.current().canUndo).toBe(false);
            expectShownAsServed(wednesday, server);
            // Le mercredi la prévoit encore si elle n'a été effacée que mardi.
            expect(rangesOf(wednesday.current().day.grid)).toEqual(
                scope === 'once' ? [['09:00', '09:30', 'work', 'OPS-12', 'Daily', daily]] : [],
            );
            expect(rangesOf(server.read(TODAY).grid)).toEqual([]);
            expect(server.recurrence(daily)?.until).toBe(scope === 'once' ? null : MONDAY);

            // De retour mardi, le geste est rangé : Ctrl+Z rend le bloc, et la récurrence.
            const back = sessions.open(TODAY);
            await sent();
            release();
            const again = await back;
            if (again === null) {
                throw new Error('Le mardi ne s’est pas rouvert.');
            }
            expect(again.current().canUndo).toBe(true);
            const undo = again.undo();
            await sent();
            release();
            await expect(undo).resolves.toMatchObject({ kind: 'saved' });
            expectShownAsServed(again, server);
            expect(rangesOf(again.current().day.grid)).toEqual([['09:00', '09:30', 'work', 'OPS-12', 'Daily', daily]]);
            expect(server.recurrence(daily)?.until).toBeNull();
            expect(server.allSkips()).toEqual([]);
            expect(rangesOf(server.read(WEDNESDAY).grid)).toEqual([
                ['09:00', '09:30', 'work', 'OPS-12', 'Daily', daily],
            ]);
        },
    );
});
