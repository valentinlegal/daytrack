import fc from 'fast-check';
import { expect } from 'vitest';

import { PART_REFUSAL } from '../../../assets/day/messages';
import type { TicketWindow } from '../../../assets/day/useGridEditing';
import {
    blockOf,
    canPause,
    type Cell,
    cellAt,
    change,
    copy,
    cut,
    enterQuarters,
    fill,
    labelsOf,
    type Model,
    paste,
    QUARTERS,
    rangeOf,
    retouched,
    rewind,
    time,
} from '../../e2e/gridModel';
import { minutes } from '../grid/support';
import { type Bench, DATE } from './gridBench';

/**
 * Le pilote de la suite tirée au hasard (gridRandom.test.tsx) : les gestes qu'elle tire, et
 * comment chacun se joue sans navigateur, ce qu'il doit laisser dit au modèle de la suite jouée
 * dans Chromium (tests/e2e/gridModel.ts).
 *
 * Ce qu'elle ne tire pas, et que gridCrossings.test.tsx éprouve geste par geste : un refus —
 * ticket introuvable, journée changée ailleurs pendant qu'un geste est en route, serveur
 * muet — et les gestes qu'il abandonne ;
 * un geste fait pendant qu'une fenêtre ou un menu attendent encore de s'ouvrir, puisqu'un
 * geste qui doit les voir les attend ; et le message d'un geste qu'un autre a suivi, qui ne
 * propose plus « Annuler ». C'est ce qui permet au modèle d'écrire « Annuler » du message comme
 * Ctrl+Z.
 */

const range = fc.record({ at: fc.constantFrom(...QUARTERS), length: fc.integer({ min: 1, max: 4 }) });
const ticket = fc.constantFrom('SHOP-1', 'SHOP-2', 'OPS-3');
const comment = fc.constantFrom('', 'Revue', 'Tests');
/** Le menu ouvert au clavier ou d'un clic droit, ou le geste fait au clavier sans lui. */
const by = fc.constantFrom('menu' as const, 'pointer' as const, 'key' as const);
const menuBy = fc.constantFrom('menu' as const, 'pointer' as const);

export type Gesture =
    | { type: 'write'; at: number; length: number; ticket: string; comment: string }
    | { type: 'replace'; at: number; length: number; ticket: string; comment: string; by: 'menu' | 'pointer' | 'key' }
    /** Modifier la sélection, au menu ou à F2 : un autre commentaire, un autre ticket, ou le ticket vidé. */
    | {
          type: 'retouch';
          at: number;
          length: number;
          ticket: string;
          comment: string;
          then: 'comment' | 'ticket' | 'emptied';
          by: 'menu' | 'pointer' | 'key';
      }
    | {
          type: 'drag';
          at: number;
          length: number;
          ticket: string;
          comment: string;
          up: boolean;
          then: 'paste' | 'key' | 'enter';
      }
    | { type: 'clear' | 'cut' | 'delete' | 'empty'; at: number; length: number }
    | { type: 'pause'; at: number; length: number; by: 'menu' | 'pointer' }
    | { type: 'paste'; at: number; length: number; to: number }
    | { type: 'undo' | 'redo' }
    /**
     * Une fenêtre ouverte au double-clic sur `at`, un ticket que Jira n'a jamais vu tapé
     * dedans ; puis la sélection d'une plage, dont le premier clic la quitte pendant que Jira
     * cherche, et aussitôt le geste.
     */
    | {
          type: 'hurried';
          at: number;
          to: number;
          length: number;
          comment: string;
          then: 'clear' | 'cut' | 'paste' | 'undo';
      }
    /** Un favori déposé sur un quart d'heure : il y pose son ticket, sans commentaire. */
    | { type: 'drop'; at: number; ticket: string }
    /** Le bouton « Annuler » du message affiché, s'il en a un. */
    | { type: 'undoMessage' }
    /**
     * Le retour sur la page : la journée se relit, à son tour dans la file, derrière les gestes
     * encore en route et sous la fenêtre qui attend Jira. Personne d'autre ne l'a écrite : elle
     * ne change rien, ni à la base, ni à ce qu'annuler défait.
     */
    | { type: 'return' }
    /**
     * Un autre onglet écrit un quart d'heure de l'après-midi, hors de portée des gestes tirés,
     * une fois tout arrivé ; la page y revient et relit la journée. Annuler et rétablir
     * défont ensuite les gestes de cette page, pas le sien.
     */
    | { type: 'elsewhere'; at: number; ticket: string | null };

/** Entre deux gestes : le serveur ou Jira retiennent leurs réponses, en lâchent une, ou toutes. */
export interface Pace {
    readonly type: 'hold' | 'one' | 'all';
    readonly of: 'server' | 'jira';
}

export type Step = Gesture | Pace;

const gesture: fc.Arbitrary<Gesture> = fc.oneof(
    fc.tuple(range, ticket, comment).map(([r, t, c]) => ({ type: 'write' as const, ...r, ticket: t, comment: c })),
    fc
        .tuple(
            range,
            ticket,
            comment,
            fc.boolean(),
            fc.constantFrom('paste' as const, 'key' as const, 'enter' as const),
        )
        .map(([r, t, c, up, then]) => ({ type: 'drag' as const, ...r, ticket: t, comment: c, up, then })),
    fc
        .tuple(range, ticket, comment, by)
        .map(([r, t, c, b]) => ({ type: 'replace' as const, ...r, ticket: t, comment: c, by: b })),
    fc
        .tuple(range, ticket, comment, fc.constantFrom('comment' as const, 'ticket' as const, 'emptied' as const), by)
        .map(([r, t, c, then, b]) => ({ type: 'retouch' as const, ...r, ticket: t, comment: c, then, by: b })),
    range.map((r) => ({ type: 'clear' as const, ...r })),
    range.map((r) => ({ type: 'cut' as const, ...r })),
    fc.tuple(range, menuBy).map(([r, b]) => ({ type: 'pause' as const, ...r, by: b })),
    range.map((r) => ({ type: 'delete' as const, ...r })),
    range.map((r) => ({ type: 'empty' as const, ...r })),
    fc.tuple(range, fc.constantFrom(...QUARTERS)).map(([r, to]) => ({ type: 'paste' as const, ...r, to })),
    fc.constantFrom({ type: 'undo' as const }, { type: 'redo' as const }),
    fc
        .tuple(
            fc.constantFrom(...QUARTERS),
            range,
            comment,
            fc.constantFrom('clear' as const, 'cut' as const, 'paste' as const, 'undo' as const),
        )
        .map(([at, r, c, then]) => ({ type: 'hurried' as const, at, to: r.at, length: r.length, comment: c, then })),
    fc.tuple(fc.constantFrom(...QUARTERS), ticket).map(([at, t]) => ({ type: 'drop' as const, at, ticket: t })),
    fc.constant({ type: 'undoMessage' as const }),
    fc.constant({ type: 'return' as const }),
    fc
        .tuple(fc.constantFrom(840, 855, 870, 885), fc.constantFrom('OPS-9', null))
        .map(([at, written]) => ({ type: 'elsewhere' as const, at, ticket: written })),
);

const pace: fc.Arbitrary<Pace> = fc.record({
    type: fc.constantFrom('hold' as const, 'one' as const, 'all' as const),
    of: fc.constantFrom('server' as const, 'jira' as const),
});

export const steps = fc.array(fc.oneof({ arbitrary: gesture, weight: 3 }, { arbitrary: pace, weight: 2 }), {
    minLength: 8,
    maxLength: 30,
    // Des suites longues : c'est là que les gestes se croisent.
    size: 'max',
});

/** Un ticket que l'écran n'a jamais vu : Jira doit le chercher, et la fenêtre l'attendre. */
let unseen = 7000;

/**
 * Ce que quelqu'un devant l'écran attend de voir avant son prochain geste : les réponses
 * retenues arrivent une à une — le serveur d'abord —, jusqu'à ce qu'il le voie. Rien ne
 * reste à lâcher et il ne le voit toujours pas : l'écran est coincé.
 */
async function until(bench: Bench, condition: () => boolean, what: string): Promise<void> {
    await bench.settle();
    while (!condition()) {
        const from = bench.slow.count > 0 ? bench.slow : bench.jira.count > 0 ? bench.jira : null;
        if (from === null) {
            throw new Error(`L'écran ne montre jamais ${what}.`);
        }
        await bench.answer(from, false);
    }
}

/** La fenêtre que le geste a demandée, une fois ouverte : pas celle d'avant, qui s'enregistre encore. */
async function windowOpens(bench: Bench, before: number | null, what: string): Promise<TicketWindow> {
    await until(
        bench,
        () => {
            const shown = bench.editing.window;

            return shown !== null && shown.key !== before && !shown.sending;
        },
        what,
    );
    const shown = bench.editing.window;
    if (shown === null) {
        throw new Error(`${what} s'est refermée.`);
    }

    return shown;
}

/** La clé de la fenêtre affichée avant le geste, s'il y en a une. */
function windowBefore(bench: Bench): number | null {
    return bench.editing.window?.key ?? null;
}

/**
 * Maj+F10, ou un clic droit sur le créneau où s'arrête la sélection : le menu s'ouvre, une
 * fois la fenêtre d'avant fermée. On ne lit ses choix qu'une fois la journée à jour à l'écran,
 * comme quelqu'un qui le regarde.
 */
async function openMenu(bench: Bench, by: 'menu' | 'pointer'): Promise<void> {
    const before = bench.menus.length;
    const head = bench.editing.selection.head;
    if (by === 'pointer' && head !== null) {
        bench.rightClick(head);
    } else {
        bench.press('F10', { shiftKey: true });
    }
    await until(bench, () => bench.menus.length > before, 'le menu');
    await until(bench, () => !bench.snapshot().busy && bench.editing.window === null, 'la journée à jour sous le menu');
}

/** Tape le ticket et le commentaire dans la fenêtre ouverte, et l'enregistre par Entrée. */
async function typeAndSave(bench: Bench, step: { ticket: string; comment: string }): Promise<void> {
    bench.type(step.ticket, step.comment);
    bench.enter();
    await bench.settle();
}

/** Entrée sur la sélection : la fenêtre s'ouvre là où l'écrit enterQuarters. */
async function enterOn(
    bench: Bench,
    model: Model,
    quarters: readonly number[],
    head: number,
    step: { ticket: string; comment: string },
): Promise<void> {
    const before = windowBefore(bench);
    bench.press('Enter');
    const written = enterQuarters(model, quarters, head);
    const shown = await windowOpens(bench, before, 'la fenêtre ouverte par Entrée');
    expect(shown.target.kind).toBe(written.every((quarter) => cellAt(model, quarter) === null) ? 'new' : 'edit');
    await typeAndSave(bench, step);
    change(model, fill(written, `${step.ticket}|${step.comment}`));
}

/**
 * La première lettre du ticket tapée sur la sélection : Nouveau ticket s'ouvre sur la
 * sélection exacte. Tant qu'il attend la fenêtre d'avant, la suite du ticket tapée sur la
 * grille s'écrit dans son champ ; ouvert, le curseur y est.
 */
async function typeOn(
    bench: Bench,
    model: Model,
    quarters: readonly number[],
    step: { ticket: string; comment: string },
): Promise<void> {
    const before = windowBefore(bench);
    bench.press(step.ticket.slice(0, 1));
    await bench.settle();
    const opened = bench.editing.window;
    if (opened === null || opened.key === before) {
        for (const letter of step.ticket.slice(1)) {
            bench.press(letter);
        }
    }
    const shown = await windowOpens(bench, before, 'Nouveau ticket ouvert par une lettre');
    expect(shown.target.kind).toBe('new');
    expect(shown.draft.ticket).toBe(opened === null || opened.key === before ? step.ticket : step.ticket.slice(0, 1));
    await typeAndSave(bench, step);
    change(model, fill(quarters, `${step.ticket}|${step.comment}`));
}

/** Joue un geste, et dit au modèle ce qu'il doit laisser. */
async function play(bench: Bench, model: Model, step: Gesture): Promise<void> {
    switch (step.type) {
        case 'write': {
            const quarters = rangeOf(step.at, step.length);
            bench.select(quarters);
            await enterOn(bench, model, quarters, quarters.at(-1) ?? step.at, step);
            break;
        }
        case 'replace': {
            const quarters = rangeOf(step.at, step.length);
            bench.select(quarters);
            if (step.by !== 'key') {
                await openMenu(bench, step.by);
                const before = windowBefore(bench);
                bench.choose('newTicket');
                const shown = await windowOpens(bench, before, '« Nouveau ticket… » du menu');
                expect(shown.target.kind).toBe('new');
                await typeAndSave(bench, step);
                change(model, fill(quarters, `${step.ticket}|${step.comment}`));
            } else {
                await typeOn(bench, model, quarters, step);
            }
            break;
        }
        case 'retouch': {
            const quarters = rangeOf(step.at, step.length);
            bench.select(quarters);
            const first = retouched(model, quarters);
            const before = windowBefore(bench);
            if (step.by !== 'key') {
                await openMenu(bench, step.by);
                expect(bench.editing.actions().edit).toBe(first !== null);
                if (first !== null) {
                    bench.choose('editSelection');
                }
            } else {
                bench.press('F2');
            }
            if (first === null) {
                // Rien ne s'ouvre, une fois la fenêtre d'avant enregistrée et la journée à jour.
                await until(
                    bench,
                    () => !bench.snapshot().busy && bench.editing.window === null,
                    'la journée à jour, sans fenêtre',
                );
                if (step.by === 'key') {
                    expect(bench.editing.message?.content).toBe(PART_REFUSAL.text);
                }
                break;
            }
            const shown = await windowOpens(bench, before, '« Modifier la sélection »');
            expect(shown.target.kind).toBe('part');
            const [shownTicket = '', shownComment = ''] = first.split('|');
            expect(shown.draft).toEqual({ ticket: shownTicket, comment: shownComment });
            const written = {
                emptied: { ticket: '', comment: shownComment },
                ticket: { ticket: step.ticket, comment: shownComment },
                comment: { ticket: shownTicket, comment: step.comment },
            }[step.then];
            await typeAndSave(bench, written);
            change(model, fill(quarters, step.then === 'emptied' ? null : `${written.ticket}|${written.comment}`));
            break;
        }
        case 'drag': {
            const quarters = rangeOf(step.at, step.length);
            const first = quarters[0] ?? step.at;
            const last = quarters.at(-1) ?? step.at;
            const [from, to] = step.up ? [last, first] : [first, last];
            bench.drag(from, to);
            await bench.settle();
            expect(bench.editing.selection.quarters).toEqual(quarters);
            if (step.then === 'paste') {
                bench.press('v', { ctrlKey: true });
                paste(model, quarters);
            } else if (step.then === 'key') {
                await typeOn(bench, model, quarters, step);
            } else {
                await enterOn(bench, model, quarters, to, step);
            }
            break;
        }
        case 'clear': {
            const quarters = rangeOf(step.at, step.length);
            bench.select(quarters);
            bench.press('Delete');
            change(model, fill(quarters, null));
            break;
        }
        case 'cut': {
            const quarters = rangeOf(step.at, step.length);
            bench.select(quarters);
            bench.press('x', { ctrlKey: true });
            cut(model, quarters);
            break;
        }
        case 'pause': {
            const quarters = rangeOf(step.at, step.length);
            bench.select(quarters);
            await openMenu(bench, step.by);
            expect(bench.editing.actions().pause).toBe(canPause(model, quarters));
            if (canPause(model, quarters)) {
                bench.choose('convertToPause');
                change(model, fill(quarters, 'pause'));
            }
            break;
        }
        case 'delete':
        case 'empty': {
            const before = windowBefore(bench);
            const cell = cellAt(model, step.at);
            bench.doubleClick(step.at);
            const shown = await windowOpens(bench, before, 'la fenêtre ouverte au double-clic');
            expect(shown.target.kind).toBe(cell === null ? 'new' : 'edit');
            if (cell === null || (step.type === 'empty' && cell === 'pause')) {
                bench.escape();
            } else if (step.type === 'delete') {
                bench.button('delete');
                change(model, fill(blockOf(model, step.at), null));
            } else {
                // Le ticket d'un bloc vidé, son commentaire encore là : Entrée le supprime.
                bench.type('', 'Encore là');
                bench.enter();
                change(model, fill(blockOf(model, step.at), null));
            }
            break;
        }
        case 'paste': {
            const quarters = rangeOf(step.at, step.length);
            bench.select(quarters);
            bench.press('c', { ctrlKey: true });
            copy(model, quarters);
            await bench.settle();
            bench.click(step.to);
            bench.press('v', { ctrlKey: true });
            paste(model, [step.to]);
            break;
        }
        case 'undo':
        case 'redo':
            bench.undo(step.type === 'redo');
            rewind(model, step.type);
            break;
        case 'hurried': {
            unseen += 1;
            const typed = `ESSAI-${String(unseen)}`;
            const before = windowBefore(bench);
            const cell = cellAt(model, step.at);
            bench.doubleClick(step.at);
            await windowOpens(bench, before, 'la fenêtre ouverte au double-clic');
            bench.type(typed, step.comment);
            bench.jira.hold();
            const quarters = rangeOf(step.to, step.length);
            bench.select(quarters);
            expect(bench.editing.window?.sending).toBe(true);
            // La fenêtre s'enregistre d'abord : sur son seul quart d'heure, ou sur tout son bloc.
            change(model, fill(cell === null ? [step.at] : blockOf(model, step.at), `${typed}|${step.comment}`));
            if (step.then === 'clear') {
                bench.press('Delete');
                change(model, fill(quarters, null));
            } else if (step.then === 'cut') {
                bench.press('x', { ctrlKey: true });
                cut(model, quarters);
            } else if (step.then === 'paste') {
                bench.press('v', { ctrlKey: true });
                paste(model, quarters);
            } else {
                bench.undo();
                rewind(model, 'undo');
            }
            break;
        }
        case 'drop':
            bench.dropFavorite(step.ticket, step.at);
            change(model, fill([step.at], `${step.ticket}|`));
            break;
        case 'undoMessage':
            // Le message n'est plus là, ou ne propose rien : il n'y a rien à cliquer. Il ne
            // propose « Annuler » que pour le dernier geste parti : c'est Ctrl+Z.
            if (bench.editing.message?.action !== undefined) {
                bench.undoMessage();
                rewind(model, 'undo');
            }
            break;
        case 'return':
            bench.comeBack();
            break;
        case 'elsewhere': {
            await bench.drain();
            const [start, end] = [time(step.at), time(step.at + 15)];
            bench.elsewhere(
                step.ticket === null
                    ? { start, end, kind: 'empty', ticket: null, comment: null }
                    : { start, end, kind: 'work', ticket: step.ticket, comment: null },
            );
            writtenElsewhere(model, step.at, step.ticket === null ? null : `${step.ticket}|`);
            bench.comeBack();
            await until(bench, () => !bench.snapshot().busy, 'la journée relue');
            break;
        }
    }
    await bench.settle();
}

/**
 * Ce qu'un autre onglet écrit hors de portée des gestes de la page : la journée le garde, et
 * annuler ou rétablir un geste de la page ne le touche pas.
 */
function writtenElsewhere(model: Model, quarter: number, cell: Cell): void {
    for (const cells of [model.cells, ...model.undo, ...model.redo]) {
        cells.set(quarter, cell);
    }
}

async function pass(bench: Bench, step: Pace): Promise<void> {
    const from = step.of === 'server' ? bench.slow : bench.jira;
    if (step.type === 'hold') {
        from.hold();
    } else {
        await bench.answer(from, step.type === 'all');
    }
}

function isPace(step: Step): step is Pace {
    return step.type === 'hold' || step.type === 'one' || step.type === 'all';
}

/** Un pas de la suite : un geste, ou le serveur et Jira qui retiennent ou lâchent leurs réponses. */
export async function take(bench: Bench, model: Model, step: Step): Promise<void> {
    await (isPace(step) ? pass(bench, step) : play(bench, model, step));
}

/** Ce que la base contient, quart d'heure par quart d'heure, comme le modèle l'écrit. */
function baseCells(bench: Bench): Map<number, Cell> {
    const cells = new Map<number, Cell>();
    for (const [start, end, kind, ticketOf, commentOf] of bench.slow.ranges()) {
        for (let quarter = minutes(start); quarter < minutes(end); quarter += 15) {
            cells.set(quarter, kind === 'pause' ? 'pause' : `${ticketOf ?? ''}|${commentOf ?? ''}`);
        }
    }

    return cells;
}

/** L'écran ne montre jamais qu'une journée que la base a vraiment contenue. */
export function expectShownOnceSaved(bench: Bench): void {
    const { day } = bench.snapshot();
    const saved = bench.slow.server.at(DATE, day.version);
    expect(saved === undefined ? undefined : saved.grid.blocks()).toEqual(day.grid.blocks());
}

/** Les quarts d'heure où la base diffère du modèle : « base « 08:00, SHOP-1 », modèle « 08:00, vide » ». */
export function differences(bench: Bench, model: Model): string[] {
    const expected = labelsOf(model.cells);

    return labelsOf(baseCells(bench)).flatMap((label, index) =>
        label === expected[index] ? [] : [`base « ${label} », modèle « ${expected[index] ?? ''} »`],
    );
}
