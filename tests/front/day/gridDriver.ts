import fc from 'fast-check';
import { expect } from 'vitest';

import { addDays, isoWeekday } from '../../../assets/day/calendar';
import { PART_REFUSAL } from '../../../assets/day/messages';
import {
    draftRhythm,
    gestureExtension,
    type MonthChoice,
    monthChoiceOf,
    type RecurrenceDraft,
    selectionCut,
    selectionErase,
    selectionShorten,
} from '../../../assets/day/recurrenceDraft';
import { takenRefusal } from '../../../assets/day/recurrenceText';
import type { TicketWindow } from '../../../assets/day/useGridEditing';
import type { SlotChange } from '../../../assets/grid/changes';
import { paste as pasteOn } from '../../../assets/grid/clipboard';
import * as Quarter from '../../../assets/grid/quarter';
import {
    followRhythm,
    LAST_WEEK,
    monthlyChoices,
    monthlyDate,
    monthlyWeekday,
    nextTimes,
    type Recurrence,
    type RecurrenceRule,
    sameRhythm,
    type TimedSchedule,
} from '../../../assets/grid/recurrence';
import { selectQuarters } from '../../../assets/grid/selection';
import {
    blockOf,
    type Cell,
    cellAt,
    change as record,
    emptyModel,
    enterQuarters,
    entersBlock,
    fill,
    labelsOf,
    type Model,
    QUARTERS,
    rangeOf,
    rewind,
    time,
} from '../../e2e/gridModel';
import { bruteClash, bruteEarliest, bruteFalls } from '../grid/clashOracle';
import { type FakeDayServer, type RecurrenceRecord, WORKING_DAYS } from '../grid/fakeDayServer';
import { minutes, rangesOf } from '../grid/support';
import { type Bench, DATE } from './gridBench';

/**
 * Le pilote de la suite tirée au hasard (gridRandom.test.tsx) : les gestes qu'elle tire, et
 * comment chacun se joue sans navigateur, ce qu'il doit laisser dit au modèle de la suite jouée
 * dans Chromium (tests/e2e/gridModel.ts), auquel il ajoute les récurrences : les blocs qui
 * reviennent au départ, la fois qu'un geste détache, la case « Récurrence » de la fenêtre, et la
 * question « quelles fois » qu'un geste sur un bloc qui revient pose, à laquelle il répond — effacer,
 * modifier, arrêter, mais aussi couper, allonger et raccourcir : une récurrence coupée avec les
 * suivantes voyage dans le presse-papier, et repart du collage, sauf sur un créneau qu'une autre
 * prend, ce que le serveur refuse.
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
/** Ce qu'une récurrence pose, écrit comme le modèle : « SHOP-1|Revue », « OPS-3| », « pause ». */
const seedContent = fc.constantFrom('SHOP-1|Revue', 'OPS-3|', 'pause');
const ticket = fc.constantFrom('SHOP-1', 'SHOP-2', 'OPS-3');
const comment = fc.constantFrom('', 'Revue', 'Tests');
/** Le menu ouvert au clavier ou d'un clic droit, ou le geste fait au clavier sans lui. */
const by = fc.constantFrom('menu' as const, 'pointer' as const, 'key' as const);
const menuBy = fc.constantFrom('menu' as const, 'pointer' as const);

/**
 * La réponse à la question « quelles fois », si l'écran la pose sur un bloc qui revient : ce
 * choix, validé par Entrée, le bouton de droite ou un clic à côté ; d'abord Retour — Annuler,
 * sur la question de Suppr — puis le même geste de nouveau ; ou Échap, qui y renonce sans
 * rien écrire.
 */
export interface Answer {
    readonly choice: 'once' | 'following';
    readonly by: 'enter' | 'button' | 'outside';
    readonly first: 'answer' | 'back' | 'escape';
}

const answer: fc.Arbitrary<Answer> = fc.record({
    choice: fc.constantFrom('once' as const, 'following' as const),
    by: fc.constantFrom('enter' as const, 'button' as const, 'outside' as const),
    first: fc.constantFrom('answer' as const, 'answer' as const, 'answer' as const, 'back' as const, 'escape' as const),
});

/** La récurrence qu'un autre onglet crée pendant que la fenêtre est ouverte. */
export type Rival = 'same' | 'last' | 'rank' | 'date';

export type Gesture =
    | { type: 'write'; at: number; length: number; ticket: string; comment: string; answer: Answer }
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
          answer: Answer;
      }
    | { type: 'clear' | 'delete' | 'empty'; at: number; length: number; answer: Answer }
    /**
     * Ctrl+X ; sur une fois entière d'une récurrence, d'un seul tenant, la question « Couper ».
     * Puis, s'il est tiré, Ctrl+V sur ce quart d'heure : avec les suivantes, la récurrence y repart.
     */
    | { type: 'cut'; at: number; length: number; answer: Answer; then: number | null }
    | { type: 'pause'; at: number; length: number; by: 'menu' | 'pointer' }
    /** Copier puis coller ; au bord d'un bloc qui revient, du même contenu, la question « Allonger ». */
    | { type: 'paste'; at: number; length: number; to: number; answer: Answer }
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
          answer: Answer;
      }
    /**
     * Un favori déposé sur un quart d'heure : il y pose son ticket, sans commentaire ; au bord
     * d'un bloc qui revient du même ticket, sans commentaire, la question « Allonger ».
     */
    | { type: 'drop'; at: number; ticket: string; answer: Answer }
    /**
     * Juste au-dessus ou au-dessous du n-ième bloc qui revient, sur un ou deux quarts d'heure :
     * son premier quart d'heure copié puis collé, son ticket déposé depuis les favoris, ou
     * Nouveau ticket à son rythme, sa case cochée. La question « Allonger », quand il est entier.
     */
    | {
          type: 'extend';
          nth: number;
          below: boolean;
          length: number;
          by: 'paste' | 'drop' | 'window';
          answer: Answer;
      }
    /** Le n-ième bloc qui revient, sélectionné en entier, coupé — la question « Couper » —, puis collé là. */
    | { type: 'move'; nth: number; to: number; answer: Answer }
    /** Suppr sur le haut ou le bas du n-ième bloc qui revient, un ou deux quarts d'heure : la question « Raccourcir ». */
    | { type: 'trim'; nth: number; top: boolean; length: number; answer: Answer }
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
    | { type: 'elsewhere'; at: number; ticket: string | null }
    /**
     * La case « Récurrence » de la fenêtre ouverte au double-clic sur `at`. Sur un créneau vide,
     * le ticket tapé, ou sur un bloc qui ne revient pas : cochée, à ce rythme, cette fin — la
     * récurrence naît, ou la fenêtre refuse un créneau qu'une autre prend déjà. Sur un bloc qui
     * revient : décochée, un autre rythme, ou une autre fin.
     */
    | {
          type: 'recurrence';
          at: number;
          ticket: string;
          comment: string;
          /** La carte : chaque semaine, une semaine sur n, ou chaque mois. */
          pace: 'week' | 'every' | 'month';
          weekdays: readonly number[];
          /** Une semaine sur 2, 3 ou 4. */
          everyWeeks: number;
          /** Le choix de « Jour du mois », parmi ceux que le jour du bloc propose : son rang dans la liste. */
          month: number;
          /** Vide, ou « AAAA-MM-JJ ». */
          until: string;
          then: 'stop' | 'days' | 'until';
          /**
           * Un autre onglet crée, pendant que la fenêtre est ouverte, une récurrence au même
           * créneau — à la même cadence, le dernier mardi du mois, le 3e jeudi ou le 20 —, puis la
           * retire une fois la fenêtre fermée.
           */
          rival: Rival | null;
          /**
           * Sur un créneau vide, d'abord une autre récurrence, qui ne revient pas le jour du bloc :
           * ces jours-là, une semaine sur ce n. Le bloc qu'elle laisse sans flèche reçoit ensuite
           * la case tirée, que son créneau, déjà pris, fait souvent refuser.
           */
          first: { readonly weekdays: readonly number[]; readonly everyWeeks: number } | null;
          answer: Answer;
      };

/** Entre deux gestes : le serveur ou Jira retiennent leurs réponses, en lâchent une, ou toutes. */
export interface Pace {
    readonly type: 'hold' | 'one' | 'all';
    readonly of: 'server' | 'jira';
}

export type Step = Gesture | Pace;

const gesture: fc.Arbitrary<Gesture> = fc.oneof(
    fc
        .tuple(range, ticket, comment, answer)
        .map(([r, t, c, a]) => ({ type: 'write' as const, ...r, ticket: t, comment: c, answer: a })),
    fc
        .tuple(
            range,
            ticket,
            comment,
            fc.boolean(),
            fc.constantFrom('paste' as const, 'key' as const, 'enter' as const),
            answer,
        )
        .map(([r, t, c, up, then, a]) => ({
            type: 'drag' as const,
            ...r,
            ticket: t,
            comment: c,
            up,
            then,
            answer: a,
        })),
    fc
        .tuple(range, ticket, comment, by)
        .map(([r, t, c, b]) => ({ type: 'replace' as const, ...r, ticket: t, comment: c, by: b })),
    fc
        .tuple(range, ticket, comment, fc.constantFrom('comment' as const, 'ticket' as const, 'emptied' as const), by)
        .map(([r, t, c, then, b]) => ({ type: 'retouch' as const, ...r, ticket: t, comment: c, then, by: b })),
    fc.tuple(range, answer).map(([r, a]) => ({ type: 'clear' as const, ...r, answer: a })),
    fc
        .tuple(range, answer, fc.option(fc.constantFrom(...QUARTERS), { nil: null }))
        .map(([r, a, then]) => ({ type: 'cut' as const, ...r, answer: a, then })),
    fc.tuple(range, menuBy).map(([r, b]) => ({ type: 'pause' as const, ...r, by: b })),
    fc.tuple(range, answer).map(([r, a]) => ({ type: 'delete' as const, ...r, answer: a })),
    fc.tuple(range, answer).map(([r, a]) => ({ type: 'empty' as const, ...r, answer: a })),
    fc
        .tuple(range, fc.constantFrom(...QUARTERS), answer)
        .map(([r, to, a]) => ({ type: 'paste' as const, ...r, to, answer: a })),
    fc.constantFrom({ type: 'undo' as const }, { type: 'redo' as const }),
    fc
        .tuple(
            fc.constantFrom(...QUARTERS),
            range,
            comment,
            fc.constantFrom('clear' as const, 'cut' as const, 'paste' as const, 'undo' as const),
            answer,
        )
        .map(([at, r, c, then, a]) => ({
            type: 'hurried' as const,
            at,
            to: r.at,
            length: r.length,
            comment: c,
            then,
            answer: a,
        })),
    fc
        .tuple(fc.constantFrom(...QUARTERS), ticket, answer)
        .map(([at, t, a]) => ({ type: 'drop' as const, at, ticket: t, answer: a })),
    fc.constant({ type: 'undoMessage' as const }),
    fc.constant({ type: 'return' as const }),
    fc
        .tuple(fc.constantFrom(840, 855, 870, 885), fc.constantFrom('OPS-9', null))
        .map(([at, written]) => ({ type: 'elsewhere' as const, at, ticket: written })),
    fc
        .tuple(
            fc.constantFrom(...QUARTERS),
            ticket,
            comment,
            fc.record({
                pace: fc.constantFrom('week' as const, 'week' as const, 'every' as const, 'month' as const),
                weekdays: fc.constantFrom([1, 2, 3, 4, 5], [2], [1, 3, 5], [2, 4]),
                everyWeeks: fc.integer({ min: 2, max: 4 }),
                month: fc.integer({ min: 0, max: 2 }),
            }),
            fc.constantFrom('' as const, '2026-11-04' as const),
            fc.constantFrom('stop' as const, 'days' as const, 'until' as const),
            fc.option(fc.constantFrom<Rival>('same', 'same', 'last', 'rank', 'date'), { nil: null }),
            fc.option(
                fc.record({
                    weekdays: fc.constantFrom([1, 3, 5], [4], [1, 4]),
                    everyWeeks: fc.integer({ min: 1, max: 2 }),
                }),
                { nil: null },
            ),
            answer,
        )
        .map(([at, t, c, rhythm, until, then, rival, first, a]) => ({
            type: 'recurrence' as const,
            at,
            ticket: t,
            comment: c,
            ...rhythm,
            until,
            then,
            rival,
            first,
            answer: a,
        })),
);

const pace: fc.Arbitrary<Pace> = fc.record({
    type: fc.constantFrom('hold' as const, 'one' as const, 'all' as const),
    of: fc.constantFrom('server' as const, 'jira' as const),
});

/**
 * Les récurrences nées la veille et posées sur la journée au départ : aucune, une ou deux,
 * sur la matinée des gestes. Elles ne se chevauchent pas : le serveur refuse deux récurrences
 * sur un même créneau (apart).
 */
export const seeds = fc
    .array(
        fc.tuple(range, seedContent).map(([r, content]): SlotChange => {
            const quarters = rangeOf(r.at, r.length);
            const [ticketOf = '', commentOf = ''] = content.split('|');

            return {
                start: time(quarters[0] ?? r.at),
                end: time((quarters.at(-1) ?? r.at) + 15),
                kind: content === 'pause' ? 'pause' : 'work',
                ticket: content === 'pause' ? null : ticketOf,
                comment: content === 'pause' || commentOf === '' ? null : commentOf,
            };
        }),
        { maxLength: 2 },
    )
    .map(apart);

/**
 * Une saisie faite sur la journée avant que ses récurrences n'y tombent, ou aucune : elle garde
 * son créneau, et une récurrence s'y pose autour — sa fois peut venir en deux morceaux.
 */
export const earlier = fc.array(
    fc.tuple(fc.constantFrom(...QUARTERS), ticket).map(([at, written]): SlotChange => ({
        start: time(at),
        end: time(at + 15),
        kind: 'work',
        ticket: written,
        comment: null,
    })),
    { maxLength: 1 },
);

/**
 * Des plages qui ne se chevauchent pas : chacune n'est gardée que si elle ne touche aucun
 * quart d'heure de celles d'avant. Deux récurrences de départ ne se croisent jamais.
 *
 * Un jour à venir, une fois prévue prend tout quart d'heure libre de sa plage, à tout moment :
 * celui qu'un geste libère dans sa plage — une saisie d'avant elle — lui revient, ce qu'un jour
 * venu ne fait pas — sa pose est faite. Le modèle ne le sait pas ; des plages disjointes le lui
 * épargnent, et gridAhead.test.tsx éprouve ce cas-là à part.
 */
export function apart(recurrences: readonly SlotChange[]): SlotChange[] {
    const taken = new Set<number>();

    return recurrences.filter((recurrence) => {
        const quarters: number[] = [];
        for (let quarter = minutes(recurrence.start); quarter < minutes(recurrence.end); quarter += 15) {
            quarters.push(quarter);
        }
        if (quarters.some((quarter) => taken.has(quarter))) {
            return false;
        }
        quarters.forEach((quarter) => taken.add(quarter));

        return true;
    });
}

/** Le plus de pas d'une suite ; FC_STEPS en joue davantage. */
export const MAX_STEPS = Number(process.env.FC_STEPS ?? 30);

/** La case « Récurrence », tirée plus souvent qu'un autre geste : ses rythmes et ses refus sont nombreux. */
const recurrenceGesture = gesture.filter((drawn) => drawn.type === 'recurrence');

/**
 * Ce qui allonge, raccourcit ou déplace un bloc qui revient : visé sur un bloc qui revient, que
 * des plages tirées au hasard ne touchent que rarement.
 */
const reshapeGesture: fc.Arbitrary<Gesture> = fc.oneof(
    fc
        .record({
            nth: fc.nat({ max: 3 }),
            below: fc.boolean(),
            length: fc.integer({ min: 1, max: 2 }),
            by: fc.constantFrom('paste' as const, 'drop' as const, 'window' as const),
            answer,
        })
        .map((drawn) => ({ type: 'extend' as const, ...drawn })),
    fc
        .tuple(fc.nat({ max: 3 }), fc.constantFrom(...QUARTERS), answer)
        .map(([nth, to, a]) => ({ type: 'move' as const, nth, to, answer: a })),
    fc
        .record({ nth: fc.nat({ max: 3 }), top: fc.boolean(), length: fc.integer({ min: 1, max: 2 }), answer })
        .map((drawn) => ({ type: 'trim' as const, ...drawn })),
);

export const steps = fc.array(
    fc.oneof(
        { arbitrary: gesture, weight: 3 },
        { arbitrary: recurrenceGesture, weight: 1 },
        { arbitrary: reshapeGesture, weight: 1 },
        { arbitrary: pace, weight: 2 },
    ),
    {
        minLength: Math.min(8, MAX_STEPS),
        maxLength: MAX_STEPS,
        // Des suites longues : c'est là que les gestes se croisent.
        size: 'max',
    },
);

/** Un ticket que l'écran n'a jamais vu : Jira doit le chercher, et la fenêtre l'attendre. */
let unseen = 7000;

/**
 * Le modèle de Chromium ne connaît pas les récurrences : ce pilote les lui ajoute. Un quart
 * d'heure qui revient s'y écrit « SHOP-1|Revue@<récurrence> », « pause@<récurrence> » : deux
 * quarts d'heure de récurrences différentes, ou l'un à la main, ne sont pas égaux, comme deux
 * blocs à l'écran. Une récurrence que la fenêtre fait naître y prend un nom à elle, « nouvelle-1 » :
 * le modèle ne connaît pas l'identifiant que le serveur lui donnera.
 */
const LINK = '@';

/** Les récurrences de départ de chaque modèle, par l'identifiant que le serveur leur a donné. */
const seedsOf = new WeakMap<Model, ReadonlySet<string>>();

/**
 * La plage de chaque récurrence du modèle, [début, fin], par son nom : une fois qui la couvre
 * en entier ce jour-là s'allonge ou se raccourcit. Une récurrence ne change jamais d'heures : de
 * nouvelles heures en font naître une autre.
 */
const spansOf = new WeakMap<Model, Map<string, readonly [number, number]>>();

/**
 * Le rythme et la fin que le presse-papier du modèle emporte avec son bloc, coupé avec les
 * suivantes ; null s'il n'en emporte pas.
 */
const cutRules = new WeakMap<Model, RecurrenceRule | null>();

/**
 * La dernière coupe avec les suivantes : la récurrence coupée, telle que le serveur la nomme, et
 * la grille d'avant la coupe, que l'historique du modèle range. L'annuler retire la récurrence du
 * presse-papier, qui garde son bloc ; collée, la nouvelle reprend ses fois sautées.
 */
const lastCuts = new WeakMap<Model, { readonly source: string; readonly step: Map<number, Cell> } | null>();

function spans(model: Model): Map<string, readonly [number, number]> {
    const known = spansOf.get(model);
    if (known === undefined) {
        throw new Error("Le modèle n'a pas été démarré.");
    }

    return known;
}

/** Combien de récurrences les fenêtres ont fait naître, pour nommer la suivante. */
let born = 0;

/** Ce que montre un quart d'heure, sans la récurrence qui l'a posé. */
function textOf(cell: Cell): Cell {
    return cell === null ? null : (cell.split(LINK)[0] ?? cell);
}

/** La récurrence qui l'a posé, ou null. */
function linkOf(cell: Cell): string | null {
    const at = cell === null ? -1 : cell.indexOf(LINK);

    return cell === null || at < 0 ? null : cell.slice(at + 1);
}

function linked(text: string, recurrence: string): string {
    return `${text}${LINK}${recurrence}`;
}

/** Les quarts d'heure qu'une récurrence a posés ce jour-là, et qui lui sont restés. */
function occurrence(model: Model, recurrence: string): number[] {
    return [...model.cells].flatMap(([quarter, cell]) => (linkOf(cell) === recurrence ? [quarter] : []));
}

/** Le modèle d'une journée telle que la base la contient au départ, ses récurrences comprises. */
export function startModel(bench: Bench): Model {
    const model = emptyModel();
    model.cells = baseCells(bench);
    const recurrences = bench.slow.server.allRecurrences();
    seedsOf.set(model, new Set(recurrences.map((recurrence) => recurrence.id)));
    spansOf.set(
        model,
        new Map(recurrences.map((recurrence) => [recurrence.id, [minutes(recurrence.start), minutes(recurrence.end)]])),
    );
    cutRules.set(model, null);
    lastCuts.set(model, null);

    return model;
}

/** Une récurrence qui naît dans le modèle : son nom, et sa plage. */
function bear(model: Model, start: number, end: number): string {
    born += 1;
    const name = `nouvelle-${String(born)}`;
    spans(model).set(name, [start, end]);

    return name;
}

/** Des quarts d'heure qui se suivent, sans trou. */
function isRun(quarters: readonly number[]): boolean {
    const first = quarters[0];
    const last = quarters.at(-1);

    return first !== undefined && last !== undefined && last - first === (quarters.length - 1) * Quarter.MINUTES;
}

function union(...lists: (readonly number[])[]): number[] {
    return [...new Set(lists.flat())].sort((a, b) => a - b);
}

/** Sa fois ce jour-là, si elle couvre toute sa plage ; null sinon. */
function wholeOccurrence(model: Model, recurrence: string): number[] | null {
    const quarters = occurrence(model, recurrence).sort((a, b) => a - b);
    const span = spans(model).get(recurrence);

    return span !== undefined &&
        quarters[0] === span[0] &&
        quarters.length === (span[1] - span[0]) / Quarter.MINUTES &&
        isRun(quarters)
        ? quarters
        : null;
}

/** Les récurrences qui posent un bloc ce jour-là, de haut en bas. */
function linksIn(model: Model): string[] {
    return [
        ...new Set(
            [...model.cells]
                .sort(([a], [b]) => a - b)
                .flatMap(([, cell]) => {
                    const recurrence = linkOf(cell);

                    return recurrence === null ? [] : [recurrence];
                }),
        ),
    ];
}

/**
 * La récurrence du serveur qui pose ce bloc du modèle. Une récurrence de départ porte son
 * identifiant ; une autre se lit sur la journée affichée, qui doit être à jour.
 */
function recordOf(bench: Bench, model: Model, recurrence: string): RecurrenceRecord {
    const [quarter] = occurrence(model, recurrence);
    const id = seedsOf.get(model)?.has(recurrence)
        ? recurrence
        : quarter === undefined
          ? null
          : (bench.snapshot().day.grid.at(quarter)?.recurrence ?? null);
    const record = id === null ? undefined : bench.slow.server.recurrence(id);
    if (record === undefined) {
        throw new Error(`La récurrence ${recurrence} du modèle n'est pas sur le serveur.`);
    }

    return record;
}

function ruleOfRecord(record: RecurrenceRecord): RecurrenceRule {
    return {
        kind: record.kind,
        weekdays: record.weekdays,
        everyWeeks: record.everyWeeks,
        monthWeek: record.monthWeek,
        monthDay: record.monthDay,
        until: record.until,
    };
}

/**
 * Un geste ordinaire. Un quart d'heure qu'il prend à une récurrence détache sa fois entière
 * ce jour-là : les autres quarts d'heure gardent ce qu'ils montrent, sans elle.
 */
function change(model: Model, changes: Map<number, Cell>): void {
    const detached = new Set<string>();
    for (const [quarter, cell] of changes) {
        const before = linkOf(cellAt(model, quarter));
        if (before !== null && before !== linkOf(cell)) {
            detached.add(before);
        }
    }
    const all = new Map(changes);
    for (const [quarter, cell] of model.cells) {
        const recurrence = linkOf(cell);
        if (recurrence !== null && detached.has(recurrence) && !all.has(quarter)) {
            all.set(quarter, textOf(cell));
        }
    }
    record(model, all);
}

/**
 * Ce qu'un collage ou un favori déposé change vraiment : le même contenu sur une fois qui revient
 * la laisse telle qu'elle est, flèche comprise (keepingOccurrences).
 */
function keeping(model: Model, changes: ReadonlyMap<number, Cell>): Map<number, Cell> {
    return new Map(
        [...changes].filter(([quarter, cell]) => {
            const before = cellAt(model, quarter);

            return !(linkOf(before) !== null && cell !== null && linkOf(cell) === null && textOf(before) === cell);
        }),
    );
}

/** Copier ne garde jamais la récurrence : une plage vide ne se copie pas. */
function copy(model: Model, quarters: readonly number[]): void {
    if (quarters.some((quarter) => cellAt(model, quarter) !== null)) {
        model.clipboard = quarters.map((quarter) => textOf(cellAt(model, quarter)));
        cutRules.set(model, null);
    }
}

function cut(model: Model, quarters: readonly number[]): void {
    if (quarters.some((quarter) => cellAt(model, quarter) !== null)) {
        copy(model, quarters);
        change(model, fill(quarters, null));
    }
}

/** Convertir en pause : grisé quand toute la sélection est déjà en pause, qu'elle revienne ou non. */
function canPause(model: Model, quarters: readonly number[]): boolean {
    return quarters.some((quarter) => textOf(cellAt(model, quarter)) !== 'pause');
}

/**
 * Modifier la sélection ne s'ouvre que sur un seul ticket et un seul commentaire : le premier
 * quart d'heure, ou null. Qu'ils reviennent ou non, d'une récurrence ou de deux, ils se lisent
 * pareil et se modifient ensemble (assets/grid/entry.ts, partOf).
 */
function retouched(model: Model, quarters: readonly number[]): string | null {
    const [first] = quarters;
    const cell = first === undefined ? null : cellAt(model, first);
    const text = textOf(cell);

    return cell !== null && text !== 'pause' && quarters.every((quarter) => textOf(cellAt(model, quarter)) === text)
        ? cell
        : null;
}

/**
 * La récurrence change à partir de cette fois : sa fois entière, ses morceaux compris, montre
 * désormais `text`, posée par une récurrence qui naît.
 */
function recut(model: Model, recurrence: string, text: string): void {
    const [start, end] = spans(model).get(recurrence) ?? [Quarter.FIRST, Quarter.FIRST];
    const fresh = linked(text, bear(model, start, end));
    record(model, new Map(occurrence(model, recurrence).map((quarter) => [quarter, fresh])));
}

/** Un jour passé : jamais de question, les fois passées ne changent jamais. */
function past(bench: Bench): boolean {
    return bench.today > DATE;
}

/** La fenêtre a remplacé ses champs par la question « quelles fois », et l'écran la montre. */
function asking(bench: Bench): boolean {
    const shown = bench.editing.window;

    return shown?.question !== undefined && !shown.sending;
}

/** Un clic à côté de la fenêtre, sur l'après-midi, hors de portée des gestes. */
const OUTSIDE = 1080;

/**
 * La question « quelles fois », une fois posée : la réponse tirée. Vrai si elle écrit ; faux
 * si on y a renoncé. `again` refait le geste qui l'a posée, après Retour — les champs rendus
 * tels qu'on les a laissés — ou Annuler — la question de Suppr fermée.
 */
async function answerQuestion(bench: Bench, reply: Answer, again: () => Promise<void> | void): Promise<boolean> {
    await until(bench, () => asking(bench), 'la question « quelles fois »');
    const fromFields = bench.question()?.back === true;
    expect(bench.question()?.choice).toBe('once');
    if (reply.first === 'escape') {
        bench.escape();
        await bench.settle();
        if (fromFields) {
            // Échap rend les champs ; un second ferme la fenêtre, sans rien écrire.
            expect(bench.editing.window?.question).toBeUndefined();
            bench.escape();
            await bench.settle();
        }
        expect(bench.editing.window).toBeNull();

        return false;
    }
    if (reply.first === 'back') {
        bench.back();
        await bench.settle();
        if (fromFields) {
            expect(bench.editing.window).not.toBeNull();
            expect(bench.editing.window?.question).toBeUndefined();
        } else {
            expect(bench.editing.window).toBeNull();
        }
        await again();
        await until(bench, () => asking(bench), 'la question, posée de nouveau');
    }
    if (reply.choice === 'following') {
        bench.chooseScope('following');
    }
    expect(bench.question()?.choice).toBe(reply.choice);
    if (reply.by === 'enter') {
        bench.enter();
    } else if (reply.by === 'button') {
        bench.confirm();
    } else {
        bench.click(OUTSIDE);
    }
    await bench.settle();

    return true;
}

/** La fois entière d'une récurrence et ces quarts d'heure, effacés : les deux réponses font de même. */
function eraseOccurrence(model: Model, recurrence: string, quarters: readonly number[]): void {
    change(model, fill([...new Set([...occurrence(model, recurrence), ...quarters])], null));
}

/**
 * « Enregistrer » dans la fenêtre d'un bloc, sa case telle qu'à l'ouverture : sur un bloc qui
 * revient, rien de changé ne part ; un autre ticket ou un autre commentaire demande quelles
 * fois changer — cette fois seulement, toute la fois de ce jour, ses morceaux compris, sans
 * elle ; avec les suivantes, la récurrence coupée. Un jour passé, rien n'est demandé : seule
 * cette fois change. Ailleurs, c'est un geste ordinaire.
 */
async function saveBlock(bench: Bench, model: Model, block: readonly number[], text: string, reply: Answer) {
    const [first] = block;
    const cell = first === undefined ? null : cellAt(model, first);
    const recurrence = linkOf(cell);
    if (recurrence === null || past(bench)) {
        if (textOf(cell) !== text || recurrence === null) {
            change(model, fill(block, text));
        }

        return;
    }
    if (textOf(cell) === text) {
        return;
    }
    if (
        !(await answerQuestion(bench, reply, () => {
            bench.enter();
        }))
    ) {
        return;
    }
    if (reply.choice === 'once') {
        change(model, fill([...new Set([...occurrence(model, recurrence), ...block])], text));
    } else {
        recut(model, recurrence, text);
    }
}

/**
 * Le geste que la grille vise d'une question à Suppr : une seule fois d'une récurrence,
 * entière, et rien d'autre de saisi — ou rien.
 */
function erasedOccurrence(bench: Bench, model: Model, quarters: readonly number[]): string | null {
    const filled = quarters.filter((quarter) => cellAt(model, quarter) !== null);
    const [first] = filled;
    const recurrence = first === undefined ? null : linkOf(cellAt(model, first));
    if (
        past(bench) ||
        recurrence === null ||
        !filled.every((quarter) => linkOf(cellAt(model, quarter)) === recurrence)
    ) {
        return null;
    }

    return occurrence(model, recurrence).every((quarter) => quarters.includes(quarter)) ? recurrence : null;
}

/**
 * Le geste que la grille vise d'une question « Raccourcir » : le haut ou le bas d'une seule fois
 * d'une récurrence, entière ce jour-là, et rien d'autre de saisi ; ce qui en reste, d'un seul
 * tenant. Null sinon.
 */
function shortenedOccurrence(
    bench: Bench,
    model: Model,
    quarters: readonly number[],
): { readonly recurrence: string; readonly kept: readonly number[] } | null {
    const filled = quarters.filter((quarter) => cellAt(model, quarter) !== null);
    const [first] = filled;
    const recurrence = first === undefined ? null : linkOf(cellAt(model, first));
    if (
        past(bench) ||
        recurrence === null ||
        !filled.every((quarter) => linkOf(cellAt(model, quarter)) === recurrence)
    ) {
        return null;
    }
    const whole = wholeOccurrence(model, recurrence);
    const kept = whole?.filter((quarter) => !filled.includes(quarter)) ?? [];

    return kept.length > 0 && isRun(kept) ? { recurrence, kept } : null;
}

/**
 * Suppr sur la sélection. L'écran décide de la question sur la journée qu'il montre, puis la
 * juge de nouveau sur la journée enregistrée, une fois les gestes d'avant arrivés : posée sur
 * une fois entière, elle demande quelles fois effacer — la fois entière, quelle que soit la
 * réponse ; sur son haut ou son bas, quelles fois raccourcir — cette fois seulement, ce qui en
 * reste se détache ; avec les suivantes, une récurrence naît à ses nouvelles heures. Sinon, la
 * sélection s'efface. `select` refait la sélection, pour Suppr de nouveau après Annuler.
 */
async function pressDelete(
    bench: Bench,
    model: Model,
    quarters: readonly number[],
    reply: Answer,
    select: () => void,
): Promise<void> {
    const { day } = bench.snapshot();
    const head = bench.editing.selection.head;
    const shown =
        (selectionErase(day, quarters, bench.today, head) ?? selectionShorten(day, quarters, bench.today)) !== null;
    bench.press('Delete');
    if (!shown) {
        change(model, fill(quarters, null));

        return;
    }
    // La fenêtre attend les gestes d'avant pour s'ouvrir ; rien ne se fait sur la grille entre-temps.
    await until(
        bench,
        () => asking(bench) || (bench.editing.window === null && !bench.snapshot().busy),
        'la question de Suppr, ou l’effacement sans elle',
    );
    const recurrence = erasedOccurrence(bench, model, quarters);
    const shortened = recurrence === null ? shortenedOccurrence(bench, model, quarters) : null;
    if (recurrence === null && shortened === null) {
        expect(bench.question()).toBeUndefined();
        change(model, fill(quarters, null));

        return;
    }
    expect(bench.question()?.action.question).toBe(recurrence === null ? 'shorten' : 'erase');
    const answered = await answerQuestion(bench, reply, () => {
        select();
        bench.press('Delete');
    });
    if (!answered) {
        return;
    }
    if (recurrence !== null) {
        eraseOccurrence(model, recurrence, quarters);
    } else if (shortened !== null) {
        if (reply.choice === 'once') {
            change(model, fill(quarters, null));
        } else {
            const text = textOf(cellAt(model, shortened.kept[0] ?? Quarter.FIRST)) ?? '';
            const fresh = bear(
                model,
                shortened.kept[0] ?? Quarter.FIRST,
                (shortened.kept.at(-1) ?? Quarter.FIRST) + Quarter.MINUTES,
            );
            change(
                model,
                new Map([
                    ...fill(quarters, null),
                    ...shortened.kept.map((quarter) => [quarter, linked(text, fresh)] as const),
                ]),
            );
        }
    }
}

/**
 * Le geste que la grille vise d'une question « Couper » : celui de Suppr (erasedOccurrence),
 * sur une fois entière ce jour-là. Null sinon, et c'est la coupe ordinaire.
 */
function cutOccurrence(bench: Bench, model: Model, quarters: readonly number[]): string | null {
    const recurrence = erasedOccurrence(bench, model, quarters);

    return recurrence !== null && wholeOccurrence(model, recurrence) !== null ? recurrence : null;
}

/**
 * Ctrl+Z dans le modèle. Annuler la coupe avec les suivantes retire sa récurrence du
 * presse-papier, qui garde son bloc ; rétablir ne la remet pas.
 */
function undoModel(model: Model): void {
    const step = model.undo.at(-1);
    if (step !== undefined && step === lastCuts.get(model)?.step) {
        cutRules.set(model, null);
    }
    rewind(model, 'undo');
}

/**
 * Ctrl+X sur la sélection, comme Suppr : la question décidée sur la journée affichée, jugée de
 * nouveau sur la journée enregistrée. Cette fois seulement, la coupe ordinaire : le presse-papier
 * prend la sélection, sans récurrence. Avec les suivantes, la récurrence s'arrête à partir de cette
 * fois, et le presse-papier prend sa fois, avec son rythme et sa fin.
 */
async function pressCut(
    bench: Bench,
    model: Model,
    quarters: readonly number[],
    reply: Answer,
    select: () => void,
): Promise<void> {
    const shown = selectionCut(bench.snapshot().day, quarters, bench.today, bench.editing.selection.head) !== null;
    bench.press('x', { ctrlKey: true });
    if (!shown) {
        cut(model, quarters);

        return;
    }
    await until(
        bench,
        () => asking(bench) || (bench.editing.window === null && !bench.snapshot().busy),
        'la question de Couper, ou la coupe sans elle',
    );
    const recurrence = cutOccurrence(bench, model, quarters);
    if (recurrence === null) {
        expect(bench.question()).toBeUndefined();
        cut(model, quarters);

        return;
    }
    expect(bench.question()?.action.question).toBe('cut');
    // La journée affichée est à jour sous la question : son rythme se lit sur le serveur.
    const own = recordOf(bench, model, recurrence);
    const rule = ruleOfRecord(own);
    const answered = await answerQuestion(bench, reply, () => {
        select();
        bench.press('x', { ctrlKey: true });
    });
    if (!answered) {
        return;
    }
    const occurrenceOf = occurrence(model, recurrence).sort((a, b) => a - b);
    if (reply.choice === 'once') {
        copy(model, quarters);
    } else {
        model.clipboard = occurrenceOf.map((quarter) => textOf(cellAt(model, quarter)));
        cutRules.set(model, rule);
    }
    change(model, fill(union(occurrenceOf, quarters), null));
    const step = model.undo.at(-1);
    if (reply.choice !== 'once' && step !== undefined) {
        lastCuts.set(model, { source: own.id, step });
    }
}

/** Ce que coller écrirait sur ces quarts d'heure, tel que le modèle le tient : null s'il ne colle rien. */
function pasted(model: Model, quarters: readonly number[]): Map<number, Cell> | null {
    const { clipboard } = model;
    const [first] = quarters;
    if (clipboard === null || first === undefined) {
        return null;
    }
    // Un seul créneau remplit la sélection, sauf une récurrence coupée, qui se colle à sa longueur.
    const [single] = clipboard;
    if (clipboard.length === 1 && cutRules.get(model) === null) {
        return fill(quarters, single ?? null);
    }
    const cells = new Map<number, Cell>();
    for (const [offset, cell] of clipboard.entries()) {
        const quarter = first + offset * Quarter.MINUTES;
        if (quarter < Quarter.DAY_END) {
            cells.set(quarter, cell);
        } else if (cell !== null) {
            // Un groupe qui déborde après 20:00 ne se colle pas.
            return null;
        }
    }

    return cells;
}

/**
 * Le bloc qui revient que ce geste allonge : le même contenu, au bord de sa fois entière — au-dessus,
 * au-dessous, ou des deux côtés —, sans la recouvrir tout entière, d'un seul tenant avec elle ; et
 * un seul tel bloc. Null sinon, ou un jour passé.
 */
function extendedOccurrence(
    bench: Bench,
    model: Model,
    written: ReadonlyMap<number, Cell>,
): { readonly recurrence: string; readonly all: readonly number[]; readonly text: string } | null {
    const texts = [...written.values()];
    const [text] = texts;
    if (past(bench) || text === undefined || text === null || !texts.every((cell) => cell === text)) {
        return null;
    }
    const keys = [...written.keys()];
    const found = linksIn(model).flatMap((recurrence) => {
        const whole = wholeOccurrence(model, recurrence);
        if (whole === null || textOf(cellAt(model, whole[0] ?? Quarter.FIRST)) !== text) {
            return [];
        }
        const all = union(whole, keys);

        return keys.every((quarter) => whole.includes(quarter)) || !isRun(all) ? [] : [{ recurrence, all, text }];
    });

    return found.length === 1 ? (found[0] ?? null) : null;
}

/**
 * La question « Allonger », une fois posée : la réponse tirée. Cette fois seulement, le bloc
 * s'allonge ce jour-là, détaché. Avec les suivantes, une récurrence naît à ses nouvelles heures —
 * sauf si une autre les prend déjà, ce que le serveur refuse : rien ne s'allonge. Le refus est
 * jugé avant la réponse, sur ce que le serveur garde.
 */
async function answerExtension(
    bench: Bench,
    model: Model,
    extended: NonNullable<ReturnType<typeof extendedOccurrence>>,
    reply: Answer,
    again: () => void,
): Promise<void> {
    expect(bench.question()?.action.question).toBe('extend');
    const own = recordOf(bench, model, extended.recurrence);
    const start = extended.all[0] ?? Quarter.FIRST;
    const end = (extended.all.at(-1) ?? Quarter.FIRST) + Quarter.MINUTES;
    const taken = takenSlot(bench, { rhythm: ruleOfRecord(own), firstDay: DATE, until: own.until, start, end }, own.id);
    if (!(await answerQuestion(bench, reply, again))) {
        return;
    }
    if (reply.choice === 'once') {
        change(model, fill(extended.all, extended.text));
    } else if (taken === null) {
        const fresh = bear(model, start, end);
        change(model, fill(extended.all, linked(extended.text, fresh)));
    } else {
        await until(bench, () => bench.editing.window === null && !bench.snapshot().busy, 'le refus du créneau pris');
        expect(bench.editing.message?.content).toBe(takenBy(taken));
    }
}

/** Le refus du serveur d'un créneau pris (src/Recurrence/RecurrenceRefused.php). */
function takenBy(taken: Recurrence): string {
    return taken.content.kind === 'pause'
        ? 'Ce créneau est déjà pris par la pause.'
        : `Ce créneau est déjà pris par la récurrence «\u{a0}${taken.content.comment ?? taken.content.ticket}\u{a0}».`;
}

/**
 * Coller, sans question : une récurrence coupée avec les suivantes repart de la journée, son bloc
 * à sa longueur, à son rythme suivi (followRhythm), avec les fois sautées de la coupée au même
 * rythme — sauf si une autre prend déjà ce créneau, ce que le serveur refuse : rien n'est collé,
 * et le presse-papier la garde. Un jour passé, ou après sa fin, le bloc se colle seul, et elle
 * attend un autre collage.
 *
 * @param others les récurrences du serveur quand le collage y arrivera
 * @return la récurrence qui prend déjà le créneau, si le serveur refuse le collage
 */
function pasteModel(
    bench: Bench,
    model: Model,
    quarters: readonly number[],
    others: readonly Recurrence[] = recurrencesOf(bench.slow.server),
): Recurrence | null {
    const cells = pasted(model, quarters);
    const rule = cutRules.get(model) ?? null;
    const [first] = quarters;
    if (cells === null || first === undefined) {
        return null;
    }
    if (rule === null || past(bench) || (rule.until !== null && rule.until < DATE)) {
        change(model, keeping(model, cells));

        return null;
    }
    const rhythm = followRhythm(rule, DATE, WORKING_DAYS);
    if (rhythm === null) {
        change(model, keeping(model, cells));

        return null;
    }
    const end = first + cells.size * Quarter.MINUTES;
    const source = others.find((other) => other.id === lastCuts.get(model)?.source);
    const carried =
        source !== undefined && sameRhythm(source.rhythm, rhythm)
            ? (source.skipped ?? []).filter((date) => date > DATE)
            : [];
    const candidate = { rhythm, firstDay: DATE, until: rule.until, start: first, end, skipped: carried };
    const taken = bruteEarliest(candidate, others, bench.today);
    if (taken !== null) {
        return taken.recurrence;
    }
    const fresh = bear(model, first, end);
    const falls = bruteFalls(candidate, DATE);
    change(
        model,
        new Map([...cells].map(([quarter, cell]) => [quarter, cell === null || !falls ? cell : linked(cell, fresh)])),
    );
    cutRules.set(model, null);

    return null;
}

/**
 * Le collage, sans question. Refusé — une récurrence coupée sur un créneau qu'une autre prend —,
 * le refus se dit en bas de la grille, et les gestes partis derrière lui sont abandonnés : on
 * attend de le voir avant le geste suivant, comme quelqu'un devant l'écran.
 */
async function plainPaste(
    bench: Bench,
    model: Model,
    quarters: readonly number[],
    others: readonly Recurrence[] | null,
): Promise<void> {
    const taken = pasteModel(bench, model, quarters, others ?? undefined);
    if (taken !== null) {
        // Il part derrière la fenêtre d'avant, qui peut encore attendre Jira.
        await until(
            bench,
            () => bench.editing.window === null && !bench.snapshot().busy && bench.slow.count === 0,
            'le refus du collage',
        );
        expect(bench.editing.message?.content).toBe(takenBy(taken));
    }
}

/** Coller sur la sélection poserait-il la question « Allonger », sur la journée affichée et le presse-papier de l'onglet ? */
function pasteAsks(bench: Bench, quarters: readonly number[]): boolean {
    const clipboard = bench.session.clipboard();
    const result =
        clipboard === null || clipboard.recurrence !== undefined ? null : pasteOn(clipboard, selectQuarters(quarters));

    return (
        result?.kind === 'paste' &&
        gestureExtension(bench.snapshot().day, result.changes, bench.today, 'paste') !== null
    );
}

/**
 * Ctrl+V sur la sélection. Au bord d'un bloc qui revient, du même contenu, la question
 * « Allonger », décidée sur la journée affichée et jugée de nouveau sur la journée enregistrée ;
 * sinon, le collage. Le presse-papier tient une récurrence coupée, sur un jour qui la ferait
 * repartir : on attend que la journée soit à jour, comme quelqu'un qui la regarde, pour juger du
 * créneau sur ce que le serveur gardera — sauf `others`, les récurrences telles qu'elles seront.
 */
async function pressPaste(
    bench: Bench,
    model: Model,
    quarters: readonly number[],
    reply: Answer,
    select: () => void,
    others: readonly Recurrence[] | null = null,
): Promise<void> {
    if (others === null && cutRules.get(model) !== null && !past(bench)) {
        await until(
            bench,
            () => bench.editing.window === null && !bench.snapshot().busy && bench.slow.count === 0,
            'la journée à jour, avant de coller',
        );
    }
    const shown = pasteAsks(bench, quarters);
    bench.press('v', { ctrlKey: true });
    if (!shown) {
        await plainPaste(bench, model, quarters, others);

        return;
    }
    await until(
        bench,
        () => asking(bench) || (bench.editing.window === null && !bench.snapshot().busy),
        'la question d’Allonger, ou le collage sans elle',
    );
    const cells = pasted(model, quarters);
    const extended = cells === null || cutRules.get(model) !== null ? null : extendedOccurrence(bench, model, cells);
    if (extended === null) {
        expect(bench.question()).toBeUndefined();
        await plainPaste(bench, model, quarters, others);

        return;
    }
    await answerExtension(bench, model, extended, reply, () => {
        select();
        bench.press('v', { ctrlKey: true });
    });
}

/**
 * Un favori déposé : au bord d'un bloc qui revient du même ticket, sans commentaire, la question
 * « Allonger ». L'écran en décide une fois la fenêtre d'avant enregistrée, sur la journée qu'il
 * montre alors : à jour, il doit la poser ; sinon, elle se juge sur la journée enregistrée.
 */
async function dropOn(bench: Bench, model: Model, at: number, ticketOf: string, reply: Answer): Promise<void> {
    const written = fill([at], `${ticketOf}|`);
    const extended = extendedOccurrence(bench, model, written);
    const settled = bench.editing.window === null && !bench.snapshot().busy && bench.slow.count === 0;
    bench.dropFavorite(ticketOf, at);
    if (settled && extended === null) {
        change(model, keeping(model, written));

        return;
    }
    // Décidé sur une journée encore en route, le favori peut attendre qu'elle soit à jour pour
    // se poser : on attend de voir ce qu'il fait avant le geste suivant.
    await until(
        bench,
        () => asking(bench) || (!settled && bench.editing.window === null && !bench.snapshot().busy),
        'la question d’Allonger, ou le favori posé sans elle',
    );
    if (!asking(bench)) {
        expect(extended === null || !settled).toBe(true);
        change(model, keeping(model, written));

        return;
    }
    if (extended === null) {
        throw new Error(`La question « Allonger » est posée sur ${time(at)}, que le modèle n'allonge pas.`);
    }
    await answerExtension(bench, model, extended, reply, () => {
        bench.dropFavorite(ticketOf, at);
    });
}

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
    step: { ticket: string; comment: string; answer: Answer },
): Promise<void> {
    const before = windowBefore(bench);
    bench.press('Enter');
    const written = enterQuarters(model, quarters);
    const shown = await windowOpens(bench, before, 'la fenêtre ouverte par Entrée');
    const edits = entersBlock(model, quarters);
    expect(shown.target.kind).toBe(edits ? 'edit' : 'new');
    await typeAndSave(bench, step);
    if (edits) {
        await saveBlock(bench, model, written, `${step.ticket}|${step.comment}`, step.answer);
    } else {
        change(model, fill(written, `${step.ticket}|${step.comment}`));
    }
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
            await enterOn(bench, model, quarters, step);
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
            const [shownTicket = '', shownComment = ''] = (textOf(first) ?? '').split('|');
            expect(shown.draft).toEqual({ ticket: shownTicket, comment: shownComment });
            const written = {
                emptied: { ticket: '', comment: shownComment },
                ticket: { ticket: step.ticket, comment: shownComment },
                comment: { ticket: shownTicket, comment: step.comment },
            }[step.then];
            await typeAndSave(bench, written);
            // Rien de changé, rien ne part : le bloc qui revient garde sa récurrence.
            if (step.then === 'emptied' || `${written.ticket}|${written.comment}` !== textOf(first)) {
                change(model, fill(quarters, step.then === 'emptied' ? null : `${written.ticket}|${written.comment}`));
            }
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
                await pressPaste(bench, model, quarters, step.answer, () => {
                    bench.select(quarters);
                });
            } else if (step.then === 'key') {
                await typeOn(bench, model, quarters, step);
            } else {
                await enterOn(bench, model, quarters, step);
            }
            break;
        }
        case 'clear': {
            const quarters = rangeOf(step.at, step.length);
            bench.select(quarters);
            await pressDelete(bench, model, quarters, step.answer, () => {
                bench.select(quarters);
            });
            break;
        }
        case 'cut': {
            const quarters = rangeOf(step.at, step.length);
            bench.select(quarters);
            await pressCut(bench, model, quarters, step.answer, () => {
                bench.select(quarters);
            });
            if (step.then !== null) {
                const to = step.then;
                bench.click(to);
                await pressPaste(bench, model, [to], step.answer, () => {
                    bench.click(to);
                });
            }
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
            const recurrence = linkOf(cell);
            if (cell === null || (step.type === 'empty' && textOf(cell) === 'pause')) {
                bench.escape();
                break;
            }
            // La corbeille, ou le ticket d'un bloc vidé, son commentaire encore là, et Entrée.
            const erase = () => {
                if (step.type === 'delete') {
                    bench.button('delete');
                } else {
                    bench.enter();
                }
            };
            if (step.type === 'empty') {
                bench.type('', 'Encore là');
            }
            erase();
            if (recurrence === null || past(bench)) {
                change(model, fill(blockOf(model, step.at), null));
            } else if (await answerQuestion(bench, step.answer, erase)) {
                // Sur un bloc qui revient : quelles fois effacer — la fois entière, de toute façon.
                eraseOccurrence(model, recurrence, blockOf(model, step.at));
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
            await pressPaste(bench, model, [step.to], step.answer, () => {
                bench.click(step.to);
            });
            break;
        }
        case 'undo':
            bench.undo();
            undoModel(model);
            break;
        case 'redo':
            bench.undo(true);
            rewind(model, 'redo');
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
            const recurrence = linkOf(cell);
            const asks = recurrence !== null && !past(bench);
            // La fenêtre, ouverte, montre la journée à jour : la récurrence de son bloc, qu'elle
            // détachera ce jour-là, se lit sur le serveur.
            const detached = asks ? recordOf(bench, model, recurrence).id : null;
            bench.select(quarters);
            // La fenêtre s'enregistre d'abord : sur son seul quart d'heure, ou sur tout son bloc.
            // Sur un bloc qui revient, le premier clic à côté pose la question, sans attendre
            // Jira ; le suivant, ou le geste qui la quitte, la valide : cette fois seulement.
            expect(asks ? bench.editing.window?.sending === true || asking(bench) : bench.editing.window?.sending).toBe(
                true,
            );
            if (cell === null) {
                change(model, fill([step.at], `${typed}|${step.comment}`));
            } else if (asks) {
                const block = blockOf(model, step.at);
                change(
                    model,
                    fill([...new Set([...occurrence(model, recurrence), ...block])], `${typed}|${step.comment}`),
                );
            } else {
                await saveBlock(bench, model, blockOf(model, step.at), `${typed}|${step.comment}`, step.answer);
            }
            if (step.then === 'clear') {
                await pressDelete(bench, model, quarters, step.answer, () => {
                    bench.select(quarters);
                });
            } else if (step.then === 'cut') {
                await pressCut(bench, model, quarters, step.answer, () => {
                    bench.select(quarters);
                });
            } else if (step.then === 'paste') {
                // Le collage part derrière la fenêtre, qui détache la fois de son bloc : une
                // récurrence coupée se juge sur ce que le serveur gardera alors.
                const others = recurrencesOf(bench.slow.server).map((other) =>
                    other.id === detached ? { ...other, skipped: [...(other.skipped ?? []), DATE] } : other,
                );
                await pressPaste(
                    bench,
                    model,
                    quarters,
                    step.answer,
                    () => {
                        bench.select(quarters);
                    },
                    others,
                );
            } else {
                bench.undo();
                undoModel(model);
            }
            break;
        }
        case 'drop':
            await dropOn(bench, model, step.at, step.ticket, step.answer);
            break;
        case 'extend':
            await extend(bench, model, step);
            break;
        case 'trim': {
            const recurrence = linksIn(model)[step.nth % Math.max(1, linksIn(model).length)];
            if (recurrence === undefined) {
                break;
            }
            const own = occurrence(model, recurrence).sort((a, b) => a - b);
            const ends = step.top ? own.slice(0, step.length) : own.slice(-step.length);
            // La sélection va d'un bout à l'autre : en deux morceaux, ce qui les sépare aussi.
            const quarters = Quarter.between(
                ends[0] ?? Quarter.FIRST,
                (ends.at(-1) ?? Quarter.FIRST) + Quarter.MINUTES,
            );
            bench.select(quarters);
            await pressDelete(bench, model, quarters, step.answer, () => {
                bench.select(quarters);
            });
            break;
        }
        case 'move': {
            const recurrence = linksIn(model)[step.nth % Math.max(1, linksIn(model).length)];
            if (recurrence === undefined) {
                break;
            }
            // Du premier au dernier de ses quarts d'heure : en deux morceaux, ce qui les sépare aussi.
            const own = occurrence(model, recurrence).sort((a, b) => a - b);
            const quarters = Quarter.between(own[0] ?? Quarter.FIRST, (own.at(-1) ?? Quarter.FIRST) + Quarter.MINUTES);
            bench.select(quarters);
            await pressCut(bench, model, quarters, step.answer, () => {
                bench.select(quarters);
            });
            bench.click(step.to);
            await pressPaste(bench, model, [step.to], step.answer, () => {
                bench.click(step.to);
            });
            break;
        }
        case 'undoMessage':
            // Le message n'est plus là, ou ne propose rien : il n'y a rien à cliquer. Il ne
            // propose « Annuler » que pour le dernier geste parti : c'est Ctrl+Z.
            if (bench.editing.message?.action !== undefined) {
                bench.undoMessage();
                undoModel(model);
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
        case 'recurrence':
            await recurrence(bench, model, step);
            break;
    }
    await bench.settle();
}

/** Le choix de « Jour du mois » tiré, parmi ceux que le jour du bloc propose. */
function monthOf(step: Extract<Gesture, { type: 'recurrence' }>): MonthChoice {
    const choices = monthlyChoices(DATE, WORKING_DAYS);
    const chosen = choices[step.month % choices.length];

    return chosen === undefined ? 'date' : monthChoiceOf(chosen);
}

/** La case réglée au rythme tiré : sa carte, ses jours, son « une semaine sur », son jour du mois. */
function paced(draft: RecurrenceDraft, step: Extract<Gesture, { type: 'recurrence' }>): RecurrenceDraft {
    return {
        ...draft,
        on: true,
        pace: step.pace,
        weekdays: step.weekdays,
        everyWeeks: step.everyWeeks,
        month: monthOf(step),
    };
}

/** Les récurrences du serveur, telles que le moteur les lit. */
function recurrencesOf(server: FakeDayServer): Recurrence[] {
    return server.allRecurrences().map((record) => ({
        id: record.id,
        rhythm: {
            kind: record.kind,
            weekdays: record.weekdays,
            everyWeeks: record.everyWeeks,
            monthWeek: record.monthWeek,
            monthDay: record.monthDay,
        },
        firstDay: record.firstDay,
        until: record.until,
        start: minutes(record.start),
        end: minutes(record.end),
        content: record.content,
        // Une fois détachée ou effacée ne prend plus son créneau.
        ...(record.skipped === undefined ? {} : { skipped: record.skipped }),
    }));
}

/**
 * L'autre récurrence qui prend déjà le créneau de ce qu'on enregistre — après aujourd'hui, un
 * jour déjà venu ne reçoit plus rien —, cherchée jour après jour sur ce que le serveur garde,
 * sans rien prendre à la fenêtre ; null si le créneau est libre.
 */
function takenSlot(bench: Bench, candidate: TimedSchedule, except: string | null): Recurrence | null {
    const others = recurrencesOf(bench.slow.server).filter((other) => other.id !== except);

    return bruteEarliest(candidate, others, bench.today)?.recurrence ?? null;
}

/**
 * Un autre onglet crée au même créneau une récurrence sans fin : à la même cadence, le jour où
 * ce qu'on enregistre reviendrait la première fois après aujourd'hui ; ou, à partir de son
 * jour, le dernier mardi du mois, le 3e jeudi, le 20 de chaque mois. Null s'il n'y a pas de tel
 * jour, ou si le serveur la lui refuse : son créneau est déjà pris.
 */
function rivalOf(
    bench: Bench,
    candidate: TimedSchedule,
    kind: Rival,
): { readonly id: string; readonly date: string } | null {
    const { server } = bench.slow;
    const after = bench.today > DATE ? bench.today : DATE;
    const [date, rhythm] =
        kind === 'same'
            ? [nextTimes(candidate, after, WORKING_DAYS, 1)[0], candidate.rhythm]
            : kind === 'last'
              ? ['2026-10-27', monthlyWeekday(2, LAST_WEEK)]
              : kind === 'rank'
                ? ['2026-10-15', monthlyWeekday(4, 3)]
                : ['2026-10-20', monthlyDate(20)];
    if (date === undefined) {
        return null;
    }
    const change: SlotChange = {
        start: time(candidate.start),
        end: time(candidate.end),
        kind: 'work',
        ticket: 'OPS-77',
        comment: 'Rival',
    };
    const result = server.saveRecurrence(date, server.read(date).version, [change], { ...rhythm, until: null }, null);
    const id = server.allRecurrences().at(-1)?.id;

    return result.status === 'saved' && id !== undefined ? { id, date } : null;
}

/**
 * L'autre onglet retire la récurrence qu'il avait créée, sur son premier jour : elle ne prend
 * plus rien. La page y revient, et relit la journée.
 */
async function withdrawRival(bench: Bench, rival: { readonly id: string; readonly date: string }): Promise<void> {
    const { server } = bench.slow;
    const record = server.recurrence(rival.id);
    if (record === undefined) {
        throw new Error(`La récurrence ${rival.id} n'existe pas.`);
    }
    const result = server.saveRecurrence(
        rival.date,
        server.read(rival.date).version,
        [{ start: record.start, end: record.end, kind: 'empty', ticket: null, comment: null }],
        null,
        { id: rival.id, weekdays: record.weekdays, until: record.until },
    );
    if (result.status !== 'saved') {
        throw new Error(`L'autre onglet n'a pas retiré ${rival.id} : ${JSON.stringify(result)}.`);
    }
    expect(server.recurrence(rival.id)?.until).toBe(addDays(rival.date, -1));
    bench.comeBack();
    await until(bench, () => !bench.snapshot().busy, 'la journée relue');
}

/**
 * La fenêtre refuse un créneau qu'une autre récurrence prend déjà, sous ses prochaines fois, et
 * rien ne part — ni à Entrée, ni à Entrée répétée ; Échap la ferme sans rien écrire. Refusé par
 * le serveur — l'autre est née ailleurs pendant que la fenêtre était ouverte —, elle garde ce
 * qu'on y a réglé, relit la journée, et la connaît désormais.
 */
async function refusedSlot(bench: Bench, taken: Recurrence, byServer: boolean): Promise<void> {
    const shown = bench.editing.window;
    const draft = bench.editing.windowRecurrence;
    await until(
        bench,
        () =>
            bench.editing.window?.errors.rhythm !== null &&
            bench.editing.window?.sending === false &&
            !bench.snapshot().busy,
        'le refus du créneau pris',
    );
    const refused = bench.editing.window;
    expect(refused?.key).toBe(shown?.key);
    expect(refused?.draft).toEqual(shown?.draft);
    expect(bench.editing.windowRecurrence).toEqual(draft);
    expect(refused?.errors.rhythm).toBe(
        byServer
            ? `Ce créneau est déjà pris par la récurrence «\u{a0}${taken.content.kind === 'work' ? (taken.content.comment ?? taken.content.ticket) : ''}\u{a0}».`
            : takenRefusal(taken),
    );
    if (byServer) {
        // Relue, la journée connaît l'autre : la fenêtre la nomme désormais elle-même.
        expect(bench.snapshot().day.ongoing.has(taken.id)).toBe(true);
    }
    const requests = bench.slow.requests.length;
    bench.enter();
    await bench.settle();
    bench.enter();
    await bench.settle();
    expect(bench.slow.requests).toHaveLength(requests);
    expect(bench.editing.window?.errors.rhythm).toBe(takenRefusal(taken));
    bench.escape();
    await bench.settle();
    expect(bench.editing.window).toBeNull();
}

/** Ce qui naîtrait de la case sur ces quarts d'heure : du jour du bloc, sur sa plage, à son rythme, jusqu'à sa fin. */
function bornOf(set: RecurrenceDraft, quarters: readonly number[]): TimedSchedule {
    const first = quarters[0] ?? Quarter.FIRST;

    return {
        rhythm: draftRhythm(set, DATE, WORKING_DAYS),
        firstDay: DATE,
        until: set.until === '' ? null : set.until,
        start: first,
        end: (quarters.at(-1) ?? first) + Quarter.MINUTES,
    };
}

/**
 * Sur un créneau vide, une première récurrence, qui ne revient pas le jour du bloc : le bloc
 * reste sans flèche. Refusée si son créneau est déjà pris, comme toute autre.
 */
async function firstOn(
    bench: Bench,
    model: Model,
    step: Extract<Gesture, { type: 'recurrence' }>,
    first: NonNullable<Extract<Gesture, { type: 'recurrence' }>['first']>,
): Promise<void> {
    const before = windowBefore(bench);
    bench.doubleClick(step.at);
    await windowOpens(bench, before, 'la fenêtre ouverte au double-clic');
    const draft = bench.editing.windowRecurrence;
    if (draft === null) {
        throw new Error("La fenêtre d'un seul créneau a toujours sa case « Récurrence ».");
    }
    bench.type('OPS-5', 'Avant');
    const set: RecurrenceDraft = {
        ...draft,
        on: true,
        pace: first.everyWeeks > 1 ? 'every' : 'week',
        weekdays: first.weekdays,
        everyWeeks: first.everyWeeks > 1 ? first.everyWeeks : draft.everyWeeks,
        until: '',
    };
    bench.setRecurrence(set);
    const candidate = bornOf(set, [step.at]);
    expect(bruteFalls(candidate, DATE)).toBe(false);
    const taken = takenSlot(bench, candidate, null);
    bench.enter();
    if (taken !== null) {
        await refusedSlot(bench, taken, false);
    } else {
        born += 1;
        record(model, fill([step.at], 'OPS-5|Avant'));
    }
    await until(bench, () => !bench.snapshot().busy && bench.editing.window === null, 'la fenêtre fermée');
}

/** La case « Récurrence » de la fenêtre ouverte au double-clic, réglée puis enregistrée par Entrée. */
async function recurrence(bench: Bench, model: Model, step: Extract<Gesture, { type: 'recurrence' }>): Promise<void> {
    if (step.first !== null && cellAt(model, step.at) === null) {
        await firstOn(bench, model, step, step.first);
    }
    const before = windowBefore(bench);
    const cell = cellAt(model, step.at);
    bench.doubleClick(step.at);
    await windowOpens(bench, before, 'la fenêtre ouverte au double-clic');
    const draft = bench.editing.windowRecurrence;
    const recurrence = linkOf(cell);
    if (draft === null) {
        throw new Error("La fenêtre d'un seul créneau a toujours sa case « Récurrence ».");
    }
    expect(draft.on).toBe(recurrence !== null);
    // Un jour passé, le rythme et la fin d'un bloc qui revient changent à partir de demain :
    // la fois passée reste la sienne, seule la case décochée la détache.
    const pastDay = past(bench);
    if (cell === null || recurrence === null) {
        if (cell === null) {
            bench.type(step.ticket, step.comment);
        }
        const set = { ...paced(draft, step), until: step.until };
        bench.setRecurrence(set);
        const quarters = cell === null ? [step.at] : blockOf(model, step.at);
        const candidate = bornOf(set, quarters);
        const text = cell === null ? `${step.ticket}|${step.comment}` : (textOf(cell) ?? '');
        // La fenêtre connaît les récurrences que la journée a lues ; l'autre onglet, après.
        const known = takenSlot(bench, candidate, null);
        // Au bord d'un bloc qui revient, du même contenu, au même rythme et à la même fin : il s'allonge.
        const extended = known === null ? windowExtension(bench, model, quarters, text, candidate) : null;
        const rival = step.rival !== null && known === null ? rivalOf(bench, candidate, step.rival) : null;
        const taken = known ?? (rival === null ? null : takenSlot(bench, candidate, null));
        // Allongée avec les suivantes, ses nouvelles heures prises ailleurs : le serveur le refuse.
        const longer =
            extended === null
                ? null
                : takenSlot(
                      bench,
                      {
                          ...candidate,
                          start: extended.all[0] ?? candidate.start,
                          end: (extended.all.at(-1) ?? candidate.start) + Quarter.MINUTES,
                      },
                      extended.id,
                  );
        bench.enter();
        if (extended !== null) {
            await windowExtends(bench, model, extended, longer, step.answer);
        } else if (taken !== null) {
            await refusedSlot(bench, taken, known === null);
        } else {
            // Le bloc n'en est une fois que si elle tombe ce jour-là.
            const fresh = bear(model, candidate.start, candidate.end);
            const shown = bruteFalls(candidate, DATE) ? linked(text, fresh) : text;
            const steps = model.undo.length;
            record(model, cell === null ? fill([step.at], shown) : fill(quarters, shown));
            if (model.undo.length === steps) {
                // Rien ne bouge à l'écran, mais annuler retirera la récurrence née.
                model.undo.push(new Map(model.cells));
                model.redo = [];
            }
        }
        if (rival !== null) {
            await bench.settle();
            await until(bench, () => !bench.snapshot().busy && bench.editing.window === null, 'la fenêtre fermée');
            await withdrawRival(bench, rival);
        }
    } else if (step.then === 'stop') {
        // La case décochée : un jour passé, elle s'arrête après aujourd'hui sans rien demander ;
        // sinon, la question. Cette fois seulement ou avec les suivantes, la fois entière garde
        // ce qu'elle montre, sans lien.
        bench.setRecurrence({ ...draft, on: false });
        bench.enter();
        const stopped =
            pastDay ||
            (await answerQuestion(bench, step.answer, () => {
                bench.enter();
            }));
        if (stopped) {
            record(
                model,
                new Map(occurrence(model, recurrence).map((quarter) => [quarter, textOf(cellAt(model, quarter))])),
            );
        }
    } else {
        await rechange(bench, model, step, draft, recurrence, cell);
    }
    await bench.settle();
}

/**
 * Ce que la fenêtre allonge : le bloc qui revient au bord duquel elle écrit le même contenu
 * (extendedOccurrence), s'il revient au même rythme et jusqu'à la même fin. La fenêtre ouverte,
 * la journée affichée est à jour : sa récurrence se lit sur le serveur.
 */
function windowExtension(
    bench: Bench,
    model: Model,
    quarters: readonly number[],
    text: string,
    candidate: TimedSchedule,
): (NonNullable<ReturnType<typeof extendedOccurrence>> & { readonly id: string }) | null {
    const extended = extendedOccurrence(bench, model, fill(quarters, text));
    if (extended === null) {
        return null;
    }
    const own = recordOf(bench, model, extended.recurrence);

    return sameRhythm(own, candidate.rhythm) && own.until === candidate.until ? { ...extended, id: own.id } : null;
}

/**
 * La question « Allonger une récurrence », posée à la place des champs de la fenêtre : Retour les
 * rend. Cette fois seulement, le bloc s'allonge ce jour-là, sans récurrence nouvelle ; avec les
 * suivantes, une récurrence naît à ses nouvelles heures, ou le serveur refuse un créneau qu'une
 * autre prend déjà — la fenêtre revient alors à ses champs, le refus dessous.
 */
async function windowExtends(
    bench: Bench,
    model: Model,
    extended: NonNullable<ReturnType<typeof windowExtension>>,
    taken: Recurrence | null,
    reply: Answer,
): Promise<void> {
    await until(bench, () => asking(bench), 'la question « Allonger »');
    expect(bench.question()).toMatchObject({ action: { question: 'extend' }, back: true });
    const answered = await answerQuestion(bench, reply, () => {
        bench.enter();
    });
    if (!answered) {
        return;
    }
    if (reply.choice === 'once') {
        change(model, fill(extended.all, extended.text));
    } else if (taken !== null) {
        await refusedSlot(bench, taken, true);
    } else {
        const fresh = bear(
            model,
            extended.all[0] ?? Quarter.FIRST,
            (extended.all.at(-1) ?? Quarter.FIRST) + Quarter.MINUTES,
        );
        change(model, fill(extended.all, linked(extended.text, fresh)));
    }
    await until(bench, () => !bench.snapshot().busy && bench.editing.window === null, 'la fenêtre fermée');
}

/**
 * Juste au-dessus ou au-dessous du n-ième bloc qui revient : son premier quart d'heure copié
 * puis collé, son ticket déposé depuis les favoris, ou Nouveau ticket sur le quart d'heure vide
 * d'à côté, le même ticket, le même commentaire, sa case cochée au même rythme et à la même fin.
 */
async function extend(bench: Bench, model: Model, step: Extract<Gesture, { type: 'extend' }>): Promise<void> {
    const links = linksIn(model);
    const recurrence = links[step.nth % Math.max(1, links.length)];
    if (recurrence === undefined) {
        return;
    }
    const own = occurrence(model, recurrence).sort((a, b) => a - b);
    const first = own[0] ?? Quarter.FIRST;
    const start = step.below ? (own.at(-1) ?? first) + Quarter.MINUTES : first - step.length * Quarter.MINUTES;
    const quarters = Array.from({ length: step.length }, (_, index) => start + index * Quarter.MINUTES);
    const next = step.below ? start : first - Quarter.MINUTES;
    if (!quarters.every((quarter) => Quarter.isQuarter(quarter))) {
        return;
    }
    const text = textOf(cellAt(model, first)) ?? '';
    const [ticketOf = '', commentOf = ''] = text.split('|');
    switch (step.by) {
        case 'paste':
            bench.click(first);
            bench.press('c', { ctrlKey: true });
            copy(model, [first]);
            await bench.settle();
            bench.select(quarters);
            await pressPaste(bench, model, quarters, step.answer, () => {
                bench.select(quarters);
            });
            break;
        case 'drop':
            await dropOn(bench, model, next, text === 'pause' || commentOf !== '' ? 'SHOP-1' : ticketOf, step.answer);
            break;
        case 'window': {
            if (text === 'pause' || cellAt(model, next) !== null) {
                return;
            }
            // Comme quelqu'un qui regarde la grille avant d'ouvrir la fenêtre : la journée à jour.
            await until(
                bench,
                () => bench.editing.window === null && !bench.snapshot().busy && bench.slow.count === 0,
                'la journée à jour',
            );
            const record = recordOf(bench, model, recurrence);
            const choices = monthlyChoices(DATE, WORKING_DAYS);
            const month = choices.findIndex((choice) => sameRhythm(choice, record));
            await play(bench, model, {
                type: 'recurrence',
                at: next,
                ticket: ticketOf,
                comment: commentOf,
                pace: record.kind !== 'weekly' ? 'month' : record.everyWeeks > 1 ? 'every' : 'week',
                weekdays: record.weekdays.length > 0 ? record.weekdays : [2],
                everyWeeks: record.everyWeeks > 1 ? record.everyWeeks : 2,
                month: Math.max(0, month),
                until: record.until ?? '',
                then: 'stop',
                rival: null,
                first: null,
                answer: step.answer,
            });
            break;
        }
    }
}

/**
 * Un autre rythme que celui du bloc qui revient, et qui tombe encore ce jour-là : celui tiré,
 * le mardi gardé, ou à défaut d'autres jours de la semaine.
 */
function otherRhythm(draft: RecurrenceDraft, step: Extract<Gesture, { type: 'recurrence' }>): RecurrenceDraft {
    const wanted = paced(draft, {
        ...step,
        weekdays: step.weekdays.includes(isoWeekday(DATE))
            ? step.weekdays
            : [...step.weekdays, isoWeekday(DATE)].sort(),
    });
    const seen = draft.seenRhythm;
    if (seen === undefined || !sameRhythm(draftRhythm(wanted, DATE, WORKING_DAYS), seen)) {
        return wanted;
    }

    return { ...draft, pace: 'week', weekdays: draft.weekdays.join() === '1,2,3,4,5' ? [2, 4] : [1, 2, 3, 4, 5] };
}

/**
 * Sur un bloc qui revient, un autre rythme — d'un jour passé, à partir de demain —, ou une autre
 * fin, sans question : la récurrence change à partir de cette fois. Ce qui prendrait le créneau
 * d'une autre est refusé, comme ce qu'on crée.
 */
async function rechange(
    bench: Bench,
    model: Model,
    step: Extract<Gesture, { type: 'recurrence' }>,
    draft: RecurrenceDraft,
    recurrence: string,
    cell: Cell,
): Promise<void> {
    const pastDay = past(bench);
    const seen = draft.seen;
    const own = recurrencesOf(bench.slow.server).find((candidate) => candidate.id === seen?.id);
    if (own === undefined) {
        throw new Error('La fenêtre d’un bloc qui revient a vu sa récurrence.');
    }
    if (step.then === 'days') {
        const changed = otherRhythm(draft, step);
        bench.setRecurrence(changed);
        if (pastDay && draft.until !== '' && draft.until <= bench.today) {
            // D'un jour passé, un autre rythme part de demain : une récurrence qui finit au plus
            // tard aujourd'hui — coupée par un geste d'avant — n'en a plus. Le refus se dit sous
            // « Jusqu'au », la fenêtre reste ouverte avec ce qu'on y a choisi, et Échap la ferme
            // sans rien écrire.
            bench.enter();
            await until(bench, () => bench.editing.window?.sending === false, 'le refus de la fenêtre');
            expect(bench.editing.window?.errors.until).toMatch(/^Choisissez un jour à partir du /);
            bench.escape();

            return;
        }
        const taken = takenSlot(
            bench,
            {
                rhythm: draftRhythm(changed, DATE, WORKING_DAYS),
                firstDay: pastDay ? addDays(bench.today, 1) : DATE,
                until: draft.until === '' ? null : draft.until,
                start: own.start,
                end: own.end,
            },
            own.id,
        );
        bench.enter();
        if (taken !== null) {
            await refusedSlot(bench, taken, false);
        } else if (pastDay) {
            // Aucun quart d'heure ne bouge, mais annuler la lui rendra.
            model.undo.push(new Map(model.cells));
            model.redo = [];
        } else {
            recut(model, recurrence, textOf(cell) ?? '');
        }

        return;
    }
    // Sa fin seule change. Repoussée, elle ne prend pas le créneau d'une autre.
    const end = draft.until === '' ? '2026-11-04' : null;
    const longer = own.until !== null && (end === null || end > own.until);
    const taken = longer ? takenSlot(bench, { ...own, until: end }, own.id) : null;
    bench.setRecurrence({ ...draft, until: end ?? '' });
    bench.enter();
    if (taken !== null) {
        await refusedSlot(bench, taken, false);

        return;
    }
    // Aucun quart d'heure ne bouge, mais annuler la lui rendra.
    model.undo.push(new Map(model.cells));
    model.redo = [];
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

/** Ce que la base contient, quart d'heure par quart d'heure, comme le modèle l'écrit, récurrences comprises. */
function baseCells(bench: Bench): Map<number, Cell> {
    const cells = new Map<number, Cell>();
    for (const [start, end, kind, ticketOf, commentOf, recurrenceOf] of bench.slow.ranges()) {
        const text = kind === 'pause' ? 'pause' : `${ticketOf ?? ''}|${commentOf ?? ''}`;
        for (let quarter = minutes(start); quarter < minutes(end); quarter += 15) {
            cells.set(quarter, recurrenceOf === undefined ? text : linked(text, recurrenceOf));
        }
    }

    return cells;
}

/**
 * Ce que la liste des créneaux dit de chaque quart d'heure, et la récurrence qui l'a posé : une
 * récurrence de départ par son identifiant, une récurrence née en route par son rang dans la
 * journée, que le modèle ne connaît pas autrement.
 */
function labels(cells: Map<number, Cell>, seeds: ReadonlySet<string>): string[] {
    const names = new Map<string, string>();
    const shown = new Map<number, Cell>();
    const links: (string | null)[] = [];
    for (let quarter = 420; quarter < 1200; quarter += 15) {
        const cell = cells.get(quarter) ?? null;
        const recurrence = linkOf(cell);
        shown.set(quarter, textOf(cell));
        if (recurrence !== null && !seeds.has(recurrence) && !names.has(recurrence)) {
            names.set(recurrence, `née en route n° ${String(names.size + 1)}`);
        }
        links.push(recurrence === null ? null : (names.get(recurrence) ?? recurrence));
    }

    return labelsOf(shown).map((label, index) => {
        const recurrence = links[index] ?? null;

        return recurrence === null ? label : `${label}, revient (${recurrence})`;
    });
}

/**
 * L'écran ne montre jamais qu'une journée que la base a vraiment contenue : celle que le serveur a
 * rendue à sa version. Une version ne se lit jamais avec deux grilles : arrêtée depuis un autre
 * jour, une récurrence qui n'y montre plus sa flèche change aussi la version (src/Day/DayVersion.php).
 */
export function expectShownOnceSaved(bench: Bench): void {
    const { day } = bench.snapshot();
    const served = bench.slow.server.servedAt(DATE, day.version).map((saved) => saved.grid.blocks());
    expect(served).toContainEqual(day.grid.blocks());
    expect(served.filter((blocks) => JSON.stringify(blocks) !== JSON.stringify(day.grid.blocks()))).toEqual([]);
}

/**
 * Ce qui doit tenir après chaque pas : aucune paire de récurrences du serveur ne prend un même
 * créneau un même jour après aujourd'hui — cherchée jour après jour, sans rien prendre au
 * moteur —, aucun quart d'heure n'est montré ni gardé deux fois, et rien en route, la grille
 * montre exactement ce que la base contient.
 */
export function expectSound(bench: Bench): void {
    const recurrences = recurrencesOf(bench.slow.server);
    // Un jour à venir envoyé ne compte pour aucune : rien ne s'y pose plus.
    const closed = [...bench.slow.server.read(DATE).settledAhead];
    const crossing = recurrences.flatMap((a, index) =>
        recurrences.slice(index + 1).flatMap((b) => {
            const date = bruteClash(a, b, bench.today, closed);

            return date === null ? [] : [`${a.id} et ${b.id} le ${date}`];
        }),
    );
    expect(crossing).toEqual([]);
    const base = rangesOf(bench.slow.server.read(DATE).grid);
    for (const ranges of [bench.shown(), base]) {
        ranges.forEach(([start], index) => {
            expect(index === 0 || minutes(start) >= minutes(ranges[index - 1]?.[1] ?? '00:00')).toBe(true);
        });
    }
    if (!bench.snapshot().busy && bench.slow.count === 0) {
        expect(bench.shown()).toEqual(base);
    }
}

/** Les quarts d'heure où la base diffère du modèle : « base « 08:00, SHOP-1 », modèle « 08:00, vide » ». */
export function differences(bench: Bench, model: Model): string[] {
    const seeds = seedsOf.get(model) ?? new Set();
    const expected = labels(model.cells, seeds);

    return labels(baseCells(bench), seeds).flatMap((label, index) =>
        label === expected[index] ? [] : [`base « ${label} », modèle « ${expected[index] ?? ''} »`],
    );
}

/**
 * Chaque récurrence qui pose un bloc ce jour-là y tombe encore : sa fin n'est pas avant lui. Une
 * fin rendue de travers par annuler ou rétablir laisserait un lien sur un bloc que la
 * récurrence ne poserait plus, ou une récurrence vivante que plus rien ne montre. Lu dans la
 * base : la journée lue ne montre pas le lien d'une récurrence finie avant elle (DayReader).
 */
export function linkedButEnded(bench: Bench): string[] {
    const linkedIds = new Set(
        [...bench.slow.server.links(DATE).values()].flatMap((recurrence) => (recurrence === null ? [] : [recurrence])),
    );

    return bench.slow.server
        .allRecurrences()
        .filter(
            (recurrence) =>
                linkedIds.has(recurrence.id) &&
                (recurrence.firstDay > DATE || (recurrence.until !== null && recurrence.until < DATE)),
        )
        .map((recurrence) => `${recurrence.id} pose un bloc le ${DATE} mais finit le ${String(recurrence.until)}`);
}

/**
 * Une fois tout annulé : les récurrences de départ vivent comme au départ, et celles nées en
 * route sont retirées — elles finissent la veille de leur premier jour, et ne tomberont jamais.
 */
export function aliveAfterUndoingAll(bench: Bench, model: Model): string[] {
    const seeds = seedsOf.get(model) ?? new Set();

    return bench.slow.server.allRecurrences().flatMap((recurrence) => {
        const withdrawn = recurrence.until !== null && recurrence.until < recurrence.firstDay;
        if (seeds.has(recurrence.id)) {
            return recurrence.until === null
                ? []
                : [`la récurrence de départ ${recurrence.id} finit le ${recurrence.until}`];
        }

        return withdrawn ? [] : [`${recurrence.id}, née en route, vit encore (fin : ${String(recurrence.until)})`];
    });
}
