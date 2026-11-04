import type { APIRequestContext, Page } from '@playwright/test';
import fc from 'fast-check';

import { clearDay, writeDay } from './day';
import { clickSlot, doubleClickSlot, dragSlots, expectGridMatchesBase, savedDay, slots } from './editing';
import { expect, test } from './fixtures';

/**
 * Des suites de gestes tirées au hasard, jouées dans Chromium comme quelqu'un qui se
 * sert de la grille : poser un ticket par-dessus un autre, remplacer une partie d'un
 * bloc, en changer le commentaire ou l'effacer par Modifier la sélection, glisser puis
 * coller ou saisir sur la plage, effacer, couper, convertir en pause,
 * copier et coller — un groupe avec ses trous compris —, supprimer, vider le ticket d'un
 * bloc, annuler et rétablir.
 *
 * Un modèle écrit ici, sans rien emprunter à l'application, dit ce que chaque geste doit
 * laisser. Après chaque geste, la base contient exactement ce que le modèle attend, et la
 * grille affiche exactement ce que la base contient.
 *
 * Les gestes se concentrent sur une matinée, pour qu'ils se chevauchent souvent.
 * Une suite qui échoue affiche sa graine ; `-e FC_SEED=…` la rejoue à l'identique, et
 * `-e FC_RUNS=40` en tire davantage.
 */

/** Un jour à lui, à l'écart des autres parcours. */
const DATE = '2025-12-29';

/** 08:00 à 11:45 : seize quarts d'heure. */
const QUARTERS = Array.from({ length: 16 }, (_, index) => 480 + index * 15);
const LAST = QUARTERS.at(-1) ?? 705;

function time(minutes: number): string {
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function minutesOf(hhmm: string): number {
    const [hours = 0, minutes = 0] = hhmm.split(':').map(Number);

    return hours * 60 + minutes;
}

/** Ce qu'un quart d'heure contient pour le modèle : « SHOP-1|Revue », « SHOP-1| », « pause », ou rien. */
type Cell = string | null;

interface Model {
    cells: Map<number, Cell>;
    undo: Map<number, Cell>[];
    redo: Map<number, Cell>[];
    clipboard: Cell[] | null;
}

function emptyModel(): Model {
    return { cells: new Map(), undo: [], redo: [], clipboard: null };
}

function cellAt(model: Model, quarter: number): Cell {
    return model.cells.get(quarter) ?? null;
}

/** Un geste qui change la grille se range pour être annulé ; un geste qui ne change rien, non. */
function change(model: Model, changes: Map<number, Cell>): void {
    const next = new Map(model.cells);
    let changed = false;
    for (const [quarter, cell] of changes) {
        changed ||= cellAt(model, quarter) !== cell;
        next.set(quarter, cell);
    }
    if (changed) {
        model.undo.push(model.cells);
        model.redo = [];
        model.cells = next;
    }
}

function rangeOf(at: number, length: number): number[] {
    return QUARTERS.filter((quarter) => quarter >= at && quarter <= Math.min(at + (length - 1) * 15, LAST));
}

/** Le bloc qui couvre un quart d'heure : ses voisins au même contenu. */
function blockOf(model: Model, quarter: number): number[] {
    const cell = cellAt(model, quarter);
    let start = quarter;
    while (start > 420 && cellAt(model, start - 15) === cell) {
        start -= 15;
    }
    let end = quarter;
    while (end < 1185 && cellAt(model, end + 15) === cell) {
        end += 15;
    }
    const block: number[] = [];
    for (let minute = start; minute <= end; minute += 15) {
        block.push(minute);
    }

    return block;
}

function fill(quarters: readonly number[], cell: Cell): Map<number, Cell> {
    return new Map(quarters.map((quarter) => [quarter, cell]));
}

/** Ce que la liste des créneaux dit de chaque quart d'heure : « 09:30, SHOP-1, Revue ». */
function labelsOf(cells: Map<number, Cell>): string[] {
    const labels: string[] = [];
    for (let minute = 420; minute < 1200; minute += 15) {
        const cell = cells.get(minute) ?? null;
        if (cell === null) {
            labels.push(`${time(minute)}, vide`);
        } else if (cell === 'pause') {
            labels.push(`${time(minute)}, pause`);
        } else {
            const [ticket = '', comment = ''] = cell.split('|');
            labels.push([time(minute), ticket, comment].filter((part) => part !== '').join(', '));
        }
    }

    return labels;
}

const range = fc.record({ at: fc.constantFrom(...QUARTERS), length: fc.integer({ min: 1, max: 4 }) });
const ticket = fc.constantFrom('SHOP-1', 'SHOP-2', 'OPS-3');
const comment = fc.constantFrom('', 'Revue', 'Tests');

type Gesture =
    | { type: 'write'; at: number; length: number; ticket: string; comment: string }
    | { type: 'replace'; at: number; length: number; ticket: string; comment: string; by: 'menu' | 'key' }
    /** Modifier la sélection, au menu ou à F2 : un autre commentaire, un autre ticket, ou le ticket vidé. */
    | {
          type: 'retouch';
          at: number;
          length: number;
          ticket: string;
          comment: string;
          then: 'comment' | 'ticket' | 'emptied';
          by: 'menu' | 'key';
      }
    | {
          type: 'drag';
          at: number;
          length: number;
          ticket: string;
          comment: string;
          /** Glissé de bas en haut : la sélection s'arrête sur son premier créneau. */
          up: boolean;
          then: 'paste' | 'key' | 'enter';
      }
    | { type: 'clear' | 'cut' | 'pause' | 'delete' | 'empty'; at: number; length: number }
    | { type: 'paste'; at: number; length: number; to: number }
    | { type: 'undo' | 'redo' };

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
        .tuple(range, ticket, comment, fc.constantFrom('menu' as const, 'key' as const))
        .map(([r, t, c, by]) => ({ type: 'replace' as const, ...r, ticket: t, comment: c, by })),
    fc
        .tuple(
            range,
            ticket,
            comment,
            fc.constantFrom('comment' as const, 'ticket' as const, 'emptied' as const),
            fc.constantFrom('menu' as const, 'key' as const),
        )
        .map(([r, t, c, then, by]) => ({ type: 'retouch' as const, ...r, ticket: t, comment: c, then, by })),
    range.map((r) => ({ type: 'clear' as const, ...r })),
    range.map((r) => ({ type: 'cut' as const, ...r })),
    range.map((r) => ({ type: 'pause' as const, ...r })),
    range.map((r) => ({ type: 'delete' as const, ...r })),
    range.map((r) => ({ type: 'empty' as const, ...r })),
    fc.tuple(range, fc.constantFrom(...QUARTERS)).map(([r, to]) => ({ type: 'paste' as const, ...r, to })),
    fc.constantFrom({ type: 'undo' as const }, { type: 'redo' as const }),
);

async function select(page: Page, quarters: readonly number[]) {
    const [first] = quarters;
    const last = quarters.at(-1);
    if (first === undefined || last === undefined) {
        return;
    }
    await clickSlot(page, time(first));
    if (last !== first) {
        await clickSlot(page, time(last), ['Shift']);
    }
}

/** Tape le ticket dans la fenêtre ouverte et l'enregistre. */
async function type(page: Page, title: string, step: { ticket: string; comment: string }) {
    const dialog = page.getByRole('dialog', { name: title });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Ticket').fill(step.ticket);
    await dialog.getByLabel('Commentaire').fill(step.comment);
    await dialog.getByLabel('Commentaire').press('Enter');
    await expect(dialog).toHaveCount(0);
}

function editTitle(model: Model, quarter: number): string {
    return cellAt(model, quarter) === 'pause' ? 'Modifier la pause' : 'Modifier le ticket';
}

/**
 * Entrée sur la sélection : Nouveau ticket sur toute une plage vide, sinon la fenêtre du
 * créneau où la sélection s'arrête, comme un double-clic.
 */
async function enterOn(
    page: Page,
    model: Model,
    quarters: readonly number[],
    head: number,
    step: { ticket: string; comment: string },
) {
    await page.keyboard.press('Enter');
    if (quarters.every((quarter) => cellAt(model, quarter) === null)) {
        await type(page, 'Nouveau ticket', step);
        change(model, fill(quarters, `${step.ticket}|${step.comment}`));
    } else if (cellAt(model, head) === null) {
        await type(page, 'Nouveau ticket', step);
        change(model, fill([head], `${step.ticket}|${step.comment}`));
    } else {
        await type(page, editTitle(model, head), step);
        change(model, fill(blockOf(model, head), `${step.ticket}|${step.comment}`));
    }
}

/** La première lettre du ticket tapée sur la sélection : Nouveau ticket sur la sélection exacte. */
async function typeOn(
    page: Page,
    model: Model,
    quarters: readonly number[],
    step: { ticket: string; comment: string },
) {
    await page.keyboard.type(step.ticket.slice(0, 1));
    const dialog = page.getByRole('dialog', { name: 'Nouveau ticket' });
    await expect(dialog.getByLabel('Ticket')).toHaveValue(step.ticket.slice(0, 1));
    await page.keyboard.type(step.ticket.slice(1));
    await dialog.getByLabel('Commentaire').fill(step.comment);
    await dialog.getByLabel('Commentaire').press('Enter');
    await expect(dialog).toHaveCount(0);
    change(model, fill(quarters, `${step.ticket}|${step.comment}`));
}

/**
 * Ctrl/⌘+V sur la sélection : un seul créneau copié la remplit, un groupe se colle en
 * entier à partir de son premier créneau ; il ne déborde jamais d'ici, la matinée
 * s'arrêtant bien avant 20:00. Sans rien de copié, rien ne bouge.
 */
async function pasteOn(page: Page, model: Model, quarters: readonly number[]) {
    await page.keyboard.press('ControlOrMeta+V');
    const { clipboard } = model;
    const [first] = quarters;
    if (clipboard === null || first === undefined) {
        return;
    }
    const [single] = clipboard;
    change(
        model,
        clipboard.length === 1
            ? fill(quarters, single ?? null)
            : new Map(clipboard.map((cell, offset) => [first + offset * 15, cell])),
    );
}

/** Joue un geste dans le navigateur, et dit au modèle ce qu'il doit laisser. */
async function play(page: Page, model: Model, step: Gesture) {
    switch (step.type) {
        case 'write': {
            const quarters = rangeOf(step.at, step.length);
            await select(page, quarters);
            await enterOn(page, model, quarters, quarters.at(-1) ?? step.at, step);
            break;
        }
        case 'replace': {
            // « Nouveau ticket… » du menu, ou la première lettre tapée sur la sélection :
            // la sélection exacte, saisie ou non, en un seul geste.
            const quarters = rangeOf(step.at, step.length);
            await select(page, quarters);
            if (step.by === 'menu') {
                await page.keyboard.press('Shift+F10');
                await page.getByRole('menuitem', { name: 'Nouveau ticket…' }).click();
                await type(page, 'Nouveau ticket', step);
                change(model, fill(quarters, `${step.ticket}|${step.comment}`));
            } else {
                await typeOn(page, model, quarters, step);
            }
            break;
        }
        case 'retouch': {
            // Modifier la sélection ne s'ouvre que sur un seul ticket avec un seul
            // commentaire ; ailleurs, le menu la grise et F2 dit pourquoi.
            const quarters = rangeOf(step.at, step.length);
            await select(page, quarters);
            const first = cellAt(model, quarters[0] ?? step.at);
            const open = first !== null && first !== 'pause' && quarters.every((q) => cellAt(model, q) === first);
            if (step.by === 'menu') {
                await page.keyboard.press('Shift+F10');
                const item = page.getByRole('menuitem', { name: 'Modifier la sélection…' });
                await expect(item).toBeVisible();
                if (open) {
                    await expect(item).not.toHaveAttribute('aria-disabled', 'true');
                    await item.click();
                } else {
                    await expect(item).toHaveAttribute('aria-disabled', 'true');
                    await page.keyboard.press('Escape');
                }
                await expect(page.getByRole('menu')).toHaveCount(0);
            } else {
                await page.keyboard.press('F2');
            }
            const dialog = page.getByRole('dialog', { name: 'Modifier la sélection' });
            if (!open) {
                await expect(page.getByRole('dialog')).toHaveCount(0);
                break;
            }
            const [shownTicket = '', shownComment = ''] = first.split('|');
            await expect(dialog.getByLabel('Ticket')).toHaveValue(shownTicket);
            await expect(dialog.getByLabel('Commentaire')).toHaveValue(shownComment);
            if (step.then === 'emptied') {
                await dialog.getByLabel('Ticket').fill('');
            } else if (step.then === 'ticket') {
                await dialog.getByLabel('Ticket').fill(step.ticket);
            } else {
                await dialog.getByLabel('Commentaire').fill(step.comment);
            }
            await dialog.getByLabel('Commentaire').press('Enter');
            await expect(dialog).toHaveCount(0);
            const written = {
                emptied: null,
                ticket: `${step.ticket}|${shownComment}`,
                comment: `${shownTicket}|${step.comment}`,
            }[step.then];
            change(model, fill(quarters, written));
            break;
        }
        case 'drag': {
            // Le glisser ne fait que sélectionner, sur du vide comme sur des blocs, copié ou
            // non ; puis on colle, on tape une lettre ou Entrée sur la plage.
            const quarters = rangeOf(step.at, step.length);
            const first = quarters[0] ?? step.at;
            const last = quarters.at(-1) ?? step.at;
            const [from, to] = step.up ? [last, first] : [first, last];
            await dragSlots(page, time(from), time(to));
            await expect(page.getByRole('dialog')).toHaveCount(0);
            await expect(slots(page).getByRole('option', { selected: true })).toHaveCount(quarters.length);
            if (step.then === 'paste') {
                await pasteOn(page, model, quarters);
            } else if (step.then === 'key') {
                await typeOn(page, model, quarters, step);
            } else {
                await enterOn(page, model, quarters, to, step);
            }
            break;
        }
        case 'clear':
            await select(page, rangeOf(step.at, step.length));
            await page.keyboard.press('Delete');
            change(model, fill(rangeOf(step.at, step.length), null));
            break;
        case 'cut': {
            const quarters = rangeOf(step.at, step.length);
            await select(page, quarters);
            await page.keyboard.press('ControlOrMeta+X');
            if (quarters.some((quarter) => cellAt(model, quarter) !== null)) {
                model.clipboard = quarters.map((quarter) => cellAt(model, quarter));
                change(model, fill(quarters, null));
            }
            break;
        }
        case 'pause': {
            const quarters = rangeOf(step.at, step.length);
            await select(page, quarters);
            await page.keyboard.press('Shift+F10');
            const item = page.getByRole('menuitem', { name: 'Convertir en pause' });
            await expect(item).toBeVisible();
            if (quarters.some((quarter) => cellAt(model, quarter) !== 'pause')) {
                await expect(item).not.toHaveAttribute('aria-disabled', 'true');
                await item.click();
                change(model, fill(quarters, 'pause'));
            } else {
                await expect(item).toHaveAttribute('aria-disabled', 'true');
                await page.keyboard.press('Escape');
            }
            await expect(page.getByRole('menu')).toHaveCount(0);
            break;
        }
        case 'delete': {
            await doubleClickSlot(page, time(step.at));
            if (cellAt(model, step.at) === null) {
                await expect(page.getByRole('dialog', { name: 'Nouveau ticket' })).toBeVisible();
                await page.keyboard.press('Escape');
            } else {
                const dialog = page.getByRole('dialog', { name: editTitle(model, step.at) });
                await dialog.getByRole('button', { name: 'Supprimer' }).click();
                change(model, fill(blockOf(model, step.at), null));
            }
            await expect(page.getByRole('dialog')).toHaveCount(0);
            break;
        }
        case 'empty': {
            // Le ticket d'un bloc vidé, son commentaire encore là : Entrée le supprime. Sur
            // une pause ou un créneau vide, rien n'est à vider.
            await doubleClickSlot(page, time(step.at));
            const cell = cellAt(model, step.at);
            if (cell === null || cell === 'pause') {
                await page.keyboard.press('Escape');
            } else {
                const dialog = page.getByRole('dialog', { name: 'Modifier le ticket' });
                await dialog.getByLabel('Ticket').fill('');
                await dialog.getByLabel('Commentaire').fill('Encore là');
                await dialog.getByLabel('Commentaire').press('Enter');
                change(model, fill(blockOf(model, step.at), null));
            }
            await expect(page.getByRole('dialog')).toHaveCount(0);
            break;
        }
        case 'paste': {
            const quarters = rangeOf(step.at, step.length);
            await select(page, quarters);
            await page.keyboard.press('ControlOrMeta+C');
            // Une plage vide ne se copie pas : le presse-papier garde ce qu'il tenait.
            if (quarters.some((quarter) => cellAt(model, quarter) !== null)) {
                model.clipboard = quarters.map((quarter) => cellAt(model, quarter));
            }
            await clickSlot(page, time(step.to));
            await page.keyboard.press('ControlOrMeta+V');
            // Un groupe se colle en entier à partir du créneau choisi ; il ne déborde
            // jamais d'ici, la matinée s'arrêtant bien avant 20:00.
            if (model.clipboard !== null) {
                change(model, new Map(model.clipboard.map((cell, offset) => [step.to + offset * 15, cell])));
            }
            break;
        }
        case 'undo':
        case 'redo': {
            await slots(page).focus();
            await page.keyboard.press(step.type === 'undo' ? 'ControlOrMeta+Z' : 'ControlOrMeta+Shift+Z');
            const [from, to] = step.type === 'undo' ? [model.undo, model.redo] : [model.redo, model.undo];
            const previous = from.pop();
            if (previous !== undefined) {
                to.push(model.cells);
                model.cells = previous;
            }
            break;
        }
    }
}

/** La base contient ce que les gestes devaient laisser, le temps qu'un geste en route arrive. */
async function expectBaseMatchesModel(request: APIRequestContext, model: Model) {
    const expected = labelsOf(model.cells);
    await expect
        .poll(
            async () => {
                const cells = new Map<number, Cell>();
                for (const block of await savedDay(request, DATE)) {
                    const cell = block.kind === 'pause' ? 'pause' : `${block.ticket ?? ''}|${block.comment ?? ''}`;
                    for (let minute = minutesOf(block.start); minute < minutesOf(block.end); minute += 15) {
                        cells.set(minute, cell);
                    }
                }

                return labelsOf(cells).flatMap((label, index) =>
                    label === expected[index] ? [] : [`base « ${label} », modèle « ${expected[index] ?? ''} »`],
                );
            },
            { message: 'La base diffère de ce que les gestes devaient laisser' },
        )
        .toEqual([]);
}

test('des gestes tirés au hasard laissent la base telle que le modèle l’attend, et la grille telle que la base', async ({
    page,
    request,
}) => {
    test.setTimeout(240_000);
    const seed = process.env.FC_SEED === undefined ? undefined : Number(process.env.FC_SEED);

    await fc.assert(
        fc.asyncProperty(fc.array(gesture, { minLength: 4, maxLength: 12 }), async (gestures) => {
            await writeDay(request, DATE, []);
            await page.goto(`/${DATE}`);
            await page.evaluate(() => {
                sessionStorage.clear();
            });
            await page.reload();
            await expect(page.getByRole('group', { name: 'Chiffres du jour' })).toBeVisible();

            const model = emptyModel();
            for (const step of gestures) {
                await play(page, model, step);
                await expectBaseMatchesModel(request, model);
                await expectGridMatchesBase(page, request, DATE);
            }
        }),
        { numRuns: Number(process.env.FC_RUNS ?? 4), endOnFailure: true, ...(seed === undefined ? {} : { seed }) },
    );

    await clearDay(request, DATE);
});
