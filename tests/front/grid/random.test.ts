import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { fill, type QuarterChanges } from '../../../assets/grid/changes';
import type { DayState } from '../../../assets/grid/day';
import { DaySession, type Outcome, tabMemory } from '../../../assets/grid/daySession';
import { DaySessions } from '../../../assets/grid/daySessions';
import { partTarget, saveEntry, selectionTarget } from '../../../assets/grid/entry';
import { dayFigures } from '../../../assets/grid/figures';
import { type Cell, PAUSE, work } from '../../../assets/grid/grid';
import { LIMIT } from '../../../assets/grid/history';
import * as Quarter from '../../../assets/grid/quarter';
import {
    EMPTY_SELECTION,
    extendTo,
    moveSelection,
    type Selection,
    selectQuarter,
    selectQuarters,
    toggleQuarter,
} from '../../../assets/grid/selection';
import { FakeDayServer, HABITUAL_OBJECTIVE, type Request, type Transport } from './fakeDayServer';
import { memoryStorage, quarterArbitrary, rangesOf } from './support';

/**
 * Des suites de gestes tirées au hasard, jouées comme le ferait l'écran : sélection,
 * copier, couper, coller, remplir, convertir en pause, effacer, annuler, rétablir,
 * objectif, rechargement, changement de jour — contre un faux serveur aussi strict
 * que le vrai.
 *
 * Modifier la sélection y retouche le commentaire de la sélection, ou l'efface en
 * vidant son ticket.
 *
 * La première suite tient un modèle à côté, quart d'heure par quart d'heure, avec son
 * propre annuler. Après chaque geste, l'écran, le serveur et le modèle disent la même
 * journée ; le total est la somme des quarts d'heure ; aucun geste ne s'écrit deux
 * fois. Pour finir, tout annuler ramène au plus ancien état gardé, et tout rétablir
 * à la journée d'avant.
 *
 * La seconde mêle deux onglets, des réponses dans le désordre, des requêtes et des
 * réponses perdues, et des changements de jour en plein envoi. L'écran n'y montre
 * jamais qu'une journée que la base a vraiment contenue, aucun refus n'écrit, et
 * annuler ne défait jamais ce que l'autre onglet a écrit.
 *
 * Chaque passage tire une graine neuve ; FC_SEED en rejoue une (tests/front/setup.ts).
 */

const TODAY = '2026-10-06';
const TOMORROW = '2026-10-07';

/** Ce que l'utilisateur pose. Le serveur met le ticket en majuscules et resserre les espaces. */
const TYPED: readonly Cell[] = [
    PAUSE,
    work('SHOP-482'),
    work('shop-482'),
    work('SHOP-482', 'Tests'),
    work('OPS-7', 'Revue  du code'),
    work('OPS-7', 'Revue du code'),
];

function normalized(cell: Cell): Cell {
    return cell?.kind === 'work' ? work(cell.ticket.toUpperCase(), cell.comment?.replace(/\s+/gu, ' ') ?? null) : cell;
}

function canonical(day: DayState): string {
    return JSON.stringify({
        date: day.date,
        version: day.version,
        objective: day.objective,
        blocks: rangesOf(day.grid),
    });
}

type Command =
    | { readonly type: 'click' | 'shift' | 'ctrl'; readonly quarter: number }
    | { readonly type: 'arrow'; readonly step: -1 | 1; readonly extend: boolean }
    | {
          readonly type:
              'copy' | 'cut' | 'paste' | 'pause' | 'clear' | 'undo' | 'redo' | 'reload' | 'switch' | 'emptied';
      }
    | { readonly type: 'fill' | 'twice'; readonly content: Cell }
    | { readonly type: 'replace'; readonly ticket: string; readonly comment: string }
    /**
     * Modifier la sélection : un autre commentaire, ou null pour un ticket vidé, et
     * `other` pour un autre ticket tapé. Avec
     * `inside`, la sélection se pose d'abord dans l'un des blocs de la journée, sur
     * quelques-uns de ses quarts d'heure : sans quoi une sélection tirée au hasard ne
     * porte presque jamais un seul ticket.
     */
    | {
          readonly type: 'retouch';
          readonly comment: string | null;
          readonly other: boolean;
          readonly inside: { readonly block: number; readonly offset: number; readonly length: number } | null;
      }
    | { readonly type: 'objective'; readonly objective: number };

const content = fc.constantFrom(...TYPED);

/** Ce qu'on tape dans Nouveau ticket : le serveur met le ticket en majuscules et resserre les espaces. */
const draft = fc.constantFrom(...TYPED.flatMap((cell) => (cell?.kind === 'work' ? [cell] : [])));

const command: fc.Arbitrary<Command> = fc.oneof(
    { weight: 4, arbitrary: quarterArbitrary.map((quarter) => ({ type: 'click' as const, quarter })) },
    { weight: 3, arbitrary: quarterArbitrary.map((quarter) => ({ type: 'shift' as const, quarter })) },
    { weight: 1, arbitrary: quarterArbitrary.map((quarter) => ({ type: 'ctrl' as const, quarter })) },
    {
        weight: 1,
        arbitrary: fc
            .tuple(fc.constantFrom(-1 as const, 1 as const), fc.boolean())
            .map(([step, extend]) => ({ type: 'arrow' as const, step, extend })),
    },
    { weight: 2, arbitrary: fc.constant({ type: 'copy' as const }) },
    { weight: 1, arbitrary: fc.constant({ type: 'cut' as const }) },
    { weight: 3, arbitrary: fc.constant({ type: 'paste' as const }) },
    { weight: 3, arbitrary: content.map((cell) => ({ type: 'fill' as const, content: cell })) },
    { weight: 1, arbitrary: content.map((cell) => ({ type: 'twice' as const, content: cell })) },
    {
        weight: 2,
        arbitrary: draft.map((cell) => ({
            type: 'replace' as const,
            ticket: cell.ticket,
            comment: cell.comment ?? '',
        })),
    },
    {
        weight: 3,
        arbitrary: fc
            .tuple(
                fc.constantFrom(null, '', 'Tests', 'Revue  du code'),
                fc.boolean(),
                fc.option(
                    fc.record({
                        block: fc.nat(),
                        offset: fc.nat(),
                        length: fc.integer({ min: 1, max: 6 }),
                    }),
                    { freq: 3 },
                ),
            )
            .map(([comment, other, inside]) => ({ type: 'retouch' as const, comment, other, inside })),
    },
    { weight: 1, arbitrary: fc.constant({ type: 'pause' as const }) },
    { weight: 2, arbitrary: fc.constant({ type: 'clear' as const }) },
    { weight: 2, arbitrary: fc.constant({ type: 'emptied' as const }) },
    { weight: 3, arbitrary: fc.constant({ type: 'undo' as const }) },
    { weight: 2, arbitrary: fc.constant({ type: 'redo' as const }) },
    {
        weight: 1,
        arbitrary: fc
            .constantFrom(0, HABITUAL_OBJECTIVE, 480, 780)
            .map((objective) => ({ type: 'objective' as const, objective })),
    },
    { weight: 1, arbitrary: fc.constant({ type: 'reload' as const }) },
    { weight: 1, arbitrary: fc.constant({ type: 'switch' as const }) },
);

/** Le modèle d'une journée : ses 52 quarts d'heure, son objectif, et son propre annuler, par instantanés. */
interface ModelDay {
    cells: Cell[];
    objective: number;
    undo: Cell[][];
    redo: Cell[][];
}

function modelDay(): ModelDay {
    return {
        cells: Array.from({ length: Quarter.COUNT }, () => null),
        objective: HABITUAL_OBJECTIVE,
        undo: [],
        redo: [],
    };
}

const index = (quarter: number): number => (quarter - Quarter.FIRST) / Quarter.MINUTES;

/** Le geste vu par le modèle : ses quarts d'heure prennent leur contenu, et l'état d'avant se range s'il a changé. */
function modelApply(day: ModelDay, changes: QuarterChanges): void {
    const next = [...day.cells];
    for (const [quarter, cell] of changes) {
        next[index(quarter)] = normalized(cell);
    }
    if (JSON.stringify(next) !== JSON.stringify(day.cells)) {
        day.undo = [...day.undo, day.cells].slice(-LIMIT);
        day.redo = [];
        day.cells = next;
    }
}

function modelRewind(day: ModelDay, from: 'undo' | 'redo'): boolean {
    const target = day[from].at(-1);
    if (target === undefined) {
        return false;
    }
    day[from] = day[from].slice(0, -1);
    day[from === 'undo' ? 'redo' : 'undo'].push(day.cells);
    day.cells = target;

    return true;
}

/** Le copier-coller vu par le modèle, écrit à part de celui du moteur. */
function modelPaste(clipboard: (readonly [number, Cell])[], selection: Selection): QuarterChanges | 'overflow' | null {
    const first = selection.quarters[0];
    if (first === undefined) {
        return null;
    }
    const single = clipboard.length === 1 ? clipboard[0] : undefined;
    if (single !== undefined) {
        return new Map(selection.quarters.map((quarter) => [quarter, single[1]]));
    }
    const changes = new Map<number, Cell>();
    for (const [offset, cell] of clipboard) {
        const quarter = first + offset;
        if (quarter <= Quarter.LAST) {
            changes.set(quarter, cell);
        } else if (cell !== null) {
            return 'overflow';
        }
    }

    return changes;
}

describe('des suites de gestes tirées au hasard', () => {
    it('laissent exactement la journée attendue, à l’écran comme dans la base', async () => {
        await fc.assert(
            fc.asyncProperty(fc.array(command, { maxLength: 60 }), async (commands) => {
                const server = new FakeDayServer();
                const api = server.api();
                const storage = memoryStorage();
                const models = new Map([
                    [TODAY, modelDay()],
                    [TOMORROW, modelDay()],
                ]);
                let date = TODAY;
                let sessions = new DaySessions(api, tabMemory(storage));
                const opened = async (): Promise<DaySession> => {
                    const session = await sessions.open(date);
                    if (session === null) {
                        throw new Error('La journée ne s’est pas ouverte.');
                    }

                    return session;
                };
                let session = await opened();
                let selection = EMPTY_SELECTION;
                let modelClipboard: (readonly [number, Cell])[] | null = null;
                let saved = 0;

                const model = (): ModelDay => models.get(date) ?? modelDay();
                const count = (outcome: Outcome): void => {
                    expect(['saved', 'unchanged', 'nothing']).toContain(outcome.kind);
                    saved += outcome.kind === 'saved' ? 1 : 0;
                };
                const gesture = async (changes: QuarterChanges): Promise<void> => {
                    count(await session.apply(changes));
                    modelApply(model(), changes);
                };
                const check = (): void => {
                    const shown = session.current();
                    const stored = server.read(date);

                    expect(canonical(shown.day)).toBe(canonical(stored));
                    expect(Quarter.all().map((quarter) => stored.grid.at(quarter))).toEqual(model().cells);
                    expect(stored.objective).toBe(model().objective);
                    expect(dayFigures(shown.day.grid, shown.day.objective, null).worked).toBe(
                        model().cells.filter((cell) => cell?.kind === 'work').length * Quarter.MINUTES,
                    );
                    expect(shown.canUndo).toBe(model().undo.length > 0);
                    expect(shown.canRedo).toBe(model().redo.length > 0);
                    expect(shown.busy).toBe(false);
                    expect(server.writes).toHaveLength(saved);
                };

                for (const step of commands) {
                    switch (step.type) {
                        case 'click':
                            selection = selectQuarter(step.quarter);
                            break;
                        case 'shift':
                            selection = extendTo(selection, step.quarter);
                            break;
                        case 'ctrl':
                            selection = toggleQuarter(selection, step.quarter);
                            break;
                        case 'arrow':
                            selection = moveSelection(selection, step.step, step.extend);
                            break;
                        case 'copy':
                        case 'cut': {
                            // Une plage vide ne se copie pas : le presse-papier garde ce qu'il tenait.
                            const first = selection.quarters[0];
                            const filled = selection.quarters.some(
                                (quarter) => (model().cells[index(quarter)] ?? null) !== null,
                            );
                            if (first !== undefined && filled) {
                                modelClipboard = selection.quarters.map(
                                    (quarter) => [quarter - first, model().cells[index(quarter)] ?? null] as const,
                                );
                            }
                            if (step.type === 'copy') {
                                expect((await session.copy(selection)) === null).toBe(!filled);
                            } else {
                                count(await session.cut(selection));
                                modelApply(model(), fill(selection.quarters, null));
                            }
                            break;
                        }
                        case 'paste': {
                            const { outcome, pasted } = await session.paste(selection);
                            const expected = modelClipboard === null ? null : modelPaste(modelClipboard, selection);
                            if (expected === null || expected === 'overflow') {
                                expect(outcome.kind).toBe(expected ?? 'nothing');
                                expect(pasted).toEqual([]);
                                break;
                            }
                            count(outcome);
                            expect(pasted).toEqual([...expected.keys()].sort((a, b) => a - b));
                            modelApply(model(), expected);
                            selection = selectQuarters(pasted);
                            break;
                        }
                        case 'fill':
                            await gesture(fill(selection.quarters, step.content));
                            break;
                        case 'replace': {
                            // « Nouveau ticket… », ou une lettre tapée : la sélection exacte,
                            // saisie ou non, en un seul geste ; le reste des blocs ne bouge pas.
                            const target = selectionTarget(selection);
                            const action = target === null ? null : saveEntry(target, step);
                            if (action?.kind !== 'write') {
                                expect(selection.quarters).toEqual([]);
                                break;
                            }
                            count(await session.apply(action.changes));
                            modelApply(
                                model(),
                                fill(selection.quarters, work(step.ticket, step.comment === '' ? null : step.comment)),
                            );
                            break;
                        }
                        case 'retouch': {
                            // Modifier la sélection : seulement sur un seul ticket et un seul
                            // commentaire, et rien d'autre que la sélection ne change.
                            const blocks = session.current().day.grid.blocks();
                            const block = step.inside === null ? undefined : blocks[step.inside.block % blocks.length];
                            if (step.inside !== null && block !== undefined) {
                                const size = (block.end - block.start) / Quarter.MINUTES;
                                const start = block.start + (step.inside.offset % size) * Quarter.MINUTES;
                                const last = Math.min(
                                    start + (step.inside.length - 1) * Quarter.MINUTES,
                                    block.end - Quarter.MINUTES,
                                );
                                selection = extendTo(selectQuarter(start), last);
                            }
                            const cells = selection.quarters.map((quarter) => model().cells[index(quarter)] ?? null);
                            const first = cells[0];
                            const target = partTarget(session.current().day.grid, selection);
                            expect(target !== null).toBe(
                                first?.kind === 'work' &&
                                    cells.every((cell) => JSON.stringify(cell) === JSON.stringify(first)),
                            );
                            if (target?.kind !== 'part') {
                                break;
                            }
                            // Un autre ticket : OPS-7 sur SHOP-482, SHOP-482 sur tout autre.
                            const ticket = !step.other
                                ? target.content.ticket
                                : target.content.ticket === 'SHOP-482'
                                  ? 'OPS-7'
                                  : 'SHOP-482';
                            const comment = step.comment === '' ? null : step.comment;
                            const action = saveEntry(target, {
                                ticket: step.comment === null ? '' : ticket,
                                comment: step.comment ?? 'Encore là',
                            });
                            if (action.kind !== 'write') {
                                // Rien de changé : rien ne s'écrit.
                                expect(normalized(work(ticket, comment))).toEqual(target.content);
                                break;
                            }
                            expect([...action.changes.keys()]).toEqual(selection.quarters);
                            count(await session.apply(action.changes));
                            modelApply(
                                model(),
                                fill(selection.quarters, step.comment === null ? null : work(ticket, comment)),
                            );
                            break;
                        }
                        case 'emptied': {
                            // Modifier le ticket sur le créneau où la sélection s'arrête, son ticket
                            // vidé, un commentaire encore là : le bloc entier part.
                            const block =
                                selection.head === null ? null : session.current().day.grid.blockAt(selection.head);
                            if (block?.content.kind === 'work') {
                                const action = saveEntry({ kind: 'edit', block }, { ticket: '', comment: 'Encore là' });
                                if (action.kind !== 'write') {
                                    throw new Error('Un bloc vidé s’efface.');
                                }
                                await gesture(action.changes);
                            }
                            break;
                        }
                        case 'twice': {
                            const changes = fill(selection.quarters, step.content);
                            const [first, second] = await Promise.all([session.apply(changes), session.apply(changes)]);
                            count(first);
                            expect(second.kind).toBe('unchanged');
                            modelApply(model(), changes);
                            break;
                        }
                        case 'pause':
                            await gesture(fill(selection.quarters, PAUSE));
                            break;
                        case 'clear':
                            await gesture(fill(selection.quarters, null));
                            break;
                        case 'undo':
                        case 'redo': {
                            const outcome = await (step.type === 'undo' ? session.undo() : session.redo());
                            count(outcome);
                            expect(outcome.kind === 'saved').toBe(modelRewind(model(), step.type));
                            break;
                        }
                        case 'objective':
                            count(await session.setObjective(step.objective));
                            model().objective = step.objective;
                            break;
                        case 'reload':
                            // L'onglet repart de son stockage : sa mémoire est perdue.
                            sessions = new DaySessions(api, tabMemory(storage));
                            session = await opened();
                            break;
                        case 'switch':
                            date = date === TODAY ? TOMORROW : TODAY;
                            session = await opened();
                            selection = EMPTY_SELECTION;
                            break;
                    }
                    check();
                }

                // Tout annuler ramène au plus ancien état gardé, tout rétablir au plus récent.
                for (const direction of ['undo', 'redo'] as const) {
                    while ((await (direction === 'undo' ? session.undo() : session.redo())).kind === 'saved') {
                        saved += 1;
                        expect(modelRewind(model(), direction)).toBe(true);
                    }
                    expect(model()[direction]).toHaveLength(0);
                    expect(Quarter.all().map((quarter) => server.read(date).grid.at(quarter))).toEqual(model().cells);
                }
                expect(server.writes).toHaveLength(saved);
            }),
        );
    });
});

type Tab = 'A' | 'B';

type Action =
    | {
          readonly tab: Tab;
          readonly type: 'fill' | 'twice';
          readonly quarters: readonly number[];
          readonly content: Cell;
      }
    /** Ctrl+Z pressé une à trois fois de suite, sans attendre la réponse. */
    | { readonly tab: Tab; readonly type: 'undo' | 'redo'; readonly times: number }
    | { readonly tab: Tab; readonly type: 'objective'; readonly objective: number }
    | { readonly tab: 'A'; readonly type: 'switch' };

type Fate = 'ok' | 'lost-before' | 'lost-after';

/** Quatre quarts d'heure seulement : les deux onglets s'y marchent dessus. */
const contested = fc.constantFrom(540, 555, 570, 585);

const tab = fc.constantFrom<Tab>('A', 'B');

const action: fc.Arbitrary<Action> = fc.oneof(
    {
        weight: 5,
        arbitrary: fc
            .record({
                tab,
                quarters: fc.uniqueArray(contested, { minLength: 1 }),
                content: fc.constantFrom(null, ...TYPED),
            })
            .map((fields) => ({ ...fields, type: 'fill' as const })),
    },
    {
        weight: 1,
        arbitrary: fc
            .record({ tab, quarters: fc.uniqueArray(contested, { minLength: 1 }), content: fc.constantFrom(...TYPED) })
            .map((fields) => ({ ...fields, type: 'twice' as const })),
    },
    {
        weight: 3,
        arbitrary: fc
            .record({ tab, times: fc.integer({ min: 1, max: 3 }) })
            .map((fields) => ({ ...fields, type: 'undo' as const })),
    },
    {
        weight: 2,
        arbitrary: fc
            .record({ tab, times: fc.integer({ min: 1, max: 3 }) })
            .map((fields) => ({ ...fields, type: 'redo' as const })),
    },
    {
        weight: 1,
        arbitrary: fc
            .record({ tab, objective: fc.constantFrom(0, HABITUAL_OBJECTIVE, 480) })
            .map((fields) => ({ ...fields, type: 'objective' as const })),
    },
    { weight: 1, arbitrary: fc.constant({ tab: 'A' as const, type: 'switch' as const }) },
);

/** Une requête sur dix se perd : assez pour croiser chaque panne, pas au point de vider tout l'historique. */
const fate = fc.oneof(
    { weight: 18, arbitrary: fc.constant<Fate>('ok') },
    { weight: 1, arbitrary: fc.constant<Fate>('lost-before') },
    { weight: 1, arbitrary: fc.constant<Fate>('lost-after') },
);

describe('deux onglets, des réponses dans le désordre et des réponses perdues', () => {
    it('ne montrent qu’une journée que la base a contenue, et annuler ne défait que ce que l’onglet a écrit', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.scheduler(),
                fc.array(action, { maxLength: 40 }),
                fc.infiniteStream(fate),
                async (s, actions, fates) => {
                    const server = new FakeDayServer();
                    const violations: string[] = [];
                    const shown: DayState[] = [];
                    const outcomes: Outcome[] = [];
                    const settled: Promise<void>[] = [];
                    const fateOf = fates[Symbol.iterator]();
                    /** Ce que chaque onglet a écrit en dernier sur chaque quart d'heure, vu de la base. */
                    const lastWritten = new Map<string, Cell>();

                    /**
                     * Les gestes de chaque onglet pas encore rendus, par journée, dans l'ordre :
                     * le premier est celui qui s'envoie. DaySessions n'ouvre une journée qu'une
                     * fois sa session d'avant au repos, si bien qu'ils ne se mêlent jamais.
                     */
                    const running = new Map<string, Action['type'][]>();
                    /** La dernière version qu'une écriture de A, réponse reçue, a laissée à chaque journée. */
                    const writtenByA = new Map<string, number>();

                    const transport =
                        (who: Tab): Transport =>
                        async <T>(request: Request, handle: () => T): Promise<T> => {
                            const destiny = (fateOf.next().value as Fate | undefined) ?? 'ok';
                            await s.schedule(Promise.resolve(), `${who} ${request.kind} part`);
                            if (destiny === 'lost-before') {
                                throw new TypeError('Failed to fetch');
                            }
                            const before = server.read(request.date);
                            const result = handle();
                            const after = server.read(request.date);
                            const gesture = running.get(`${who} ${request.date}`)?.[0];
                            for (const [quarter, cell] of before.grid.changesTo(after.grid)) {
                                const key = `${who} ${request.date} ${String(quarter)}`;
                                if (
                                    (gesture === 'undo' || gesture === 'redo') &&
                                    JSON.stringify(lastWritten.get(key) ?? null) !==
                                        JSON.stringify(before.grid.at(quarter))
                                ) {
                                    violations.push(
                                        `${who} a annulé à ${Quarter.format(quarter)} ce que l'autre onglet avait écrit.`,
                                    );
                                }
                                lastWritten.set(key, cell);
                            }
                            await s.schedule(Promise.resolve(), `${who} ${request.kind} revient`);
                            if (destiny === 'lost-after') {
                                throw new TypeError('Failed to fetch');
                            }
                            if (who === 'A' && after.version !== before.version) {
                                writtenByA.set(request.date, after.version);
                            }

                            return result;
                        };

                    let displayed = TODAY;
                    const closed = new Set<DaySession>();
                    const watch = (session: DaySession): DaySession => {
                        session.subscribe(() => {
                            if (closed.has(session) || session.date !== displayed) {
                                violations.push(`Le ${session.date} a atteint l'écran du ${displayed}.`);
                            }
                            shown.push(session.current().day);
                        });

                        return session;
                    };
                    const sessionsA = new DaySessions(server.api(transport('A')), tabMemory(memoryStorage()));
                    const tabs: Record<Tab, DaySession | null> = {
                        A: null,
                        B: new DaySession(server.read(TODAY), server.api(transport('B')), tabMemory(memoryStorage())),
                    };
                    // L'écran ouvre sa première journée comme les suivantes, par DaySessions.
                    tabs.A = await s.waitFor(
                        sessionsA.open(TODAY).then(
                            (opened) => (opened === null ? null : watch(opened)),
                            () => null,
                        ),
                    );

                    const run = (
                        who: Tab,
                        session: DaySession,
                        type: Action['type'],
                        call: () => Promise<Outcome>,
                    ): void => {
                        const key = `${who} ${session.date}`;
                        const queue = running.get(key) ?? [];
                        running.set(key, queue);
                        queue.push(type);
                        settled.push(
                            call().then((outcome) => {
                                queue.shift();
                                outcomes.push(outcome);
                            }),
                        );
                    };
                    const fire = (step: Action): void => {
                        const session = tabs[step.tab];
                        if (step.type === 'switch') {
                            if (tabs.A !== null) {
                                closed.add(tabs.A);
                            }
                            tabs.A = null;
                            displayed = displayed === TODAY ? TOMORROW : TODAY;
                            const wanted = displayed;
                            settled.push(
                                sessionsA.open(wanted).then(
                                    (opened) => {
                                        if (opened !== null && wanted === displayed) {
                                            tabs.A = watch(opened);
                                        }
                                    },
                                    // La journée ne se lit pas : l'écran le dirait, et le prochain
                                    // changement de jour réessaiera.
                                    () => undefined,
                                ),
                            );

                            return;
                        }
                        // Pendant qu'une journée s'ouvre, il n'y a pas de grille où faire un geste.
                        if (session === null) {
                            return;
                        }
                        switch (step.type) {
                            case 'fill':
                                run(step.tab, session, step.type, () =>
                                    session.apply(fill(step.quarters, step.content)),
                                );
                                break;
                            case 'twice':
                                run(step.tab, session, step.type, () =>
                                    session.apply(fill(step.quarters, step.content)),
                                );
                                run(step.tab, session, step.type, () =>
                                    session.apply(fill(step.quarters, step.content)),
                                );
                                break;
                            case 'undo':
                            case 'redo':
                                for (let time = 0; time < step.times; time += 1) {
                                    run(step.tab, session, step.type, () =>
                                        step.type === 'undo' ? session.undo() : session.redo(),
                                    );
                                }
                                break;
                            case 'objective':
                                run(step.tab, session, step.type, () => session.setObjective(step.objective));
                                break;
                        }
                    };

                    s.scheduleSequence(
                        actions.map((step) => ({
                            label: `${step.tab} ${step.type}`,
                            builder: () => {
                                fire(step);

                                return Promise.resolve();
                            },
                        })),
                    );
                    await s.waitIdle();
                    // Un geste peut encore planifier une requête après que le planificateur
                    // s'est cru au repos : on l'attend à travers lui, qui la libère, sans quoi
                    // elle resterait retenue et le test attendrait pour toujours.
                    await s.waitFor(Promise.all(settled));

                    expect(violations).toEqual([]);
                    const current = [tabs.A, tabs.B].flatMap((session) =>
                        session === null ? [] : [session.current().day],
                    );
                    for (const day of [...shown, ...current]) {
                        const real = server.at(day.date, day.version);
                        expect(real === undefined ? undefined : canonical(real)).toBe(canonical(day));
                    }
                    expect(outcomes.filter((outcome) => outcome.kind === 'invalid')).toEqual([]);
                    const saved = outcomes.filter((outcome) => outcome.kind === 'saved').length;
                    const failed = outcomes.filter((outcome) => outcome.kind === 'failed').length;
                    expect(server.writes.length).toBeGreaterThanOrEqual(saved);
                    expect(server.writes.length).toBeLessThanOrEqual(saved + failed);
                    // Au repos, l'écran de A ne montre jamais une journée plus ancienne que ce
                    // que A lui-même y a écrit et vu revenir : revenir sur un jour en plein
                    // envoi attend l'envoi.
                    const shownA = tabs.A?.current().day;
                    if (shownA !== undefined) {
                        expect(shownA.version).toBeGreaterThanOrEqual(writtenByA.get(shownA.date) ?? 0);
                    }
                },
            ),
            // Une annulation refusée demande un enchaînement précis entre les deux onglets :
            // assez de passages pour la croiser souvent. Le test « n'annule jamais ce qu'un
            // autre onglet a écrit » de daySession.test.ts, lui, la prouve à chaque fois.
            { numRuns: 400 },
        );
    });
});
