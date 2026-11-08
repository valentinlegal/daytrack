import type { APIRequestContext, Page, Route } from '@playwright/test';
import fc from 'fast-check';

import { writeDay } from './day';
import { clickSlot, doubleClickSlot, dragSlots, expectGridMatchesBase, savedDay, slots } from './editing';
import { expect, test } from './fixtures';
import {
    blockOf,
    canPause,
    type Cell,
    cellAt,
    change,
    copy,
    cut,
    editTitle,
    emptyModel,
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
} from './gridModel';

/**
 * Des suites de gestes tirées au hasard, jouées dans Chromium comme quelqu'un qui se
 * sert de la grille : poser un ticket par-dessus un autre, remplacer une partie d'un
 * bloc, en changer le commentaire ou l'effacer par Modifier la sélection, glisser puis
 * coller ou saisir sur la plage, effacer, couper, convertir en pause,
 * copier et coller — un groupe avec ses trous compris —, supprimer, vider le ticket d'un
 * bloc, annuler et rétablir. Et un geste fait aussitôt après avoir quitté une fenêtre que
 * Jira retient : la fenêtre s'enregistre d'abord, le geste ensuite.
 *
 * Un modèle écrit sans rien emprunter à l'application dit ce que chaque geste doit laisser
 * (gridModel.ts). Après chaque geste, la base contient exactement ce que le modèle attend, et
 * la grille affiche exactement ce que la base contient.
 *
 * L'ordre des gestes qui se croisent s'éprouve par milliers sans navigateur
 * (tests/front/day/gridRandom.test.tsx) : ici, quelques tirages prouvent l'écran réel.
 * Une suite qui échoue affiche sa graine ; `-e FC_SEED=…` la rejoue à l'identique, et
 * `-e FC_RUNS=40` en tire davantage.
 */

/** Un jour à lui, à l'écart des autres parcours. */
const DATE = '2025-12-29';

function minutesOf(hhmm: string): number {
    const [hours = 0, minutes = 0] = hhmm.split(':').map(Number);

    return hours * 60 + minutes;
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
      };

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
    fc
        .tuple(
            fc.constantFrom(...QUARTERS),
            range,
            comment,
            fc.constantFrom('clear' as const, 'cut' as const, 'paste' as const, 'undo' as const),
        )
        .map(([at, r, c, then]) => ({ type: 'hurried' as const, at, to: r.at, length: r.length, comment: c, then })),
);

/** Un ticket que l'écran n'a jamais vu : Jira doit le chercher, et la fenêtre l'attendre. */
let unseen = 7000;

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
    const written = enterQuarters(model, quarters, head);
    const empty = written.every((quarter) => cellAt(model, quarter) === null);
    await type(page, empty ? 'Nouveau ticket' : editTitle(model, head), step);
    change(model, fill(written, `${step.ticket}|${step.comment}`));
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
    paste(model, quarters);
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
            const first = retouched(model, quarters);
            const open = first !== null;
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
            if (first === null) {
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
            cut(model, quarters);
            break;
        }
        case 'pause': {
            const quarters = rangeOf(step.at, step.length);
            await select(page, quarters);
            await page.keyboard.press('Shift+F10');
            const item = page.getByRole('menuitem', { name: 'Convertir en pause' });
            await expect(item).toBeVisible();
            if (canPause(model, quarters)) {
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
            copy(model, quarters);
            await clickSlot(page, time(step.to));
            await page.keyboard.press('ControlOrMeta+V');
            paste(model, [step.to]);
            break;
        }
        case 'hurried': {
            unseen += 1;
            const typed = `ESSAI-${String(unseen)}`;
            const slow = async (route: Route) => {
                await new Promise((resolve) => setTimeout(resolve, 400));
                await route.fallback();
            };
            await page.route('**/api/tickets/*/lookup', slow);
            const cell = cellAt(model, step.at);
            await doubleClickSlot(page, time(step.at));
            const dialog = page.getByRole('dialog', {
                name: cell === null ? 'Nouveau ticket' : editTitle(model, step.at),
            });
            await dialog.getByLabel('Ticket').fill(typed);
            await dialog.getByLabel('Commentaire').fill(step.comment);
            const quarters = rangeOf(step.to, step.length);
            await select(page, quarters);
            // La fenêtre s'enregistre d'abord : sur son seul quart d'heure, ou sur tout son bloc.
            change(model, fill(cell === null ? [step.at] : blockOf(model, step.at), `${typed}|${step.comment}`));
            if (step.then === 'clear') {
                await page.keyboard.press('Delete');
                change(model, fill(quarters, null));
            } else if (step.then === 'cut') {
                await page.keyboard.press('ControlOrMeta+X');
                cut(model, quarters);
            } else if (step.then === 'paste') {
                await pasteOn(page, model, quarters);
            } else {
                await page.keyboard.press('ControlOrMeta+Z');
                rewind(model, 'undo');
            }
            await expect(dialog).toHaveCount(0);
            // Les routes des fixtures restent : seule celle-ci s'en va.
            await page.unroute('**/api/tickets/*/lookup', slow);
            break;
        }
        case 'undo':
        case 'redo': {
            await slots(page).focus();
            await page.keyboard.press(step.type === 'undo' ? 'ControlOrMeta+Z' : 'ControlOrMeta+Shift+Z');
            rewind(model, step.type);
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
});
