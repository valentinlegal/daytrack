import { fill, type QuarterChanges, type SlotChange, toSlotChanges } from './changes';
import {
    type Clipboard,
    clipboardOf,
    type ClipboardStore,
    copy,
    paste,
    storedClipboard,
    withoutRecurrence,
} from './clipboard';
import type { DayState } from './day';
import { type Cell, type Grid, normalizeCell, sameCell, type SlotContent } from './grid';
import {
    EMPTY_HISTORY,
    type History,
    type HistoryStore,
    planRedo,
    planUndo,
    record,
    redone,
    type Rewind,
    type Step,
    stepBetween,
    storedHistory,
    undone,
    type UntilRewind,
    type UntilStep,
} from './history';
import * as Quarter from './quarter';
import { detach, followRhythm, keepingOccurrences, type RecurrenceRule, type SeenRecurrence } from './recurrence';
import type { Refused, Violation } from '../serverApi';
import type { Selection } from './selection';
import type { TabStorage } from './tabStore';

export type WriteResult =
    | { readonly status: 'saved'; readonly day: DayState }
    /** La journée avait changé ailleurs : rien n'est écrit, voici la journée à jour (409). */
    | { readonly status: 'stale'; readonly day: DayState }
    | Refused;

/**
 * Ce qu'a donné un envoi sur Jira, avec la journée telle qu'elle est ensuite : son état
 * d'envoi dit ce qui est arrivé.
 */
export type SendResult =
    /** Le serveur a envoyé, et relu Jira. */
    | { readonly status: 'done'; readonly day: DayState }
    /** Rien n'est parti : la journée avait changé ailleurs, un autre onglet envoie déjà, ou il n'y a rien à envoyer (409). */
    | { readonly status: 'stale' | 'sending' | 'nothing'; readonly day: DayState };

/** Une récurrence enregistrée depuis la fenêtre : la journée, et les fins qu'annuler rendra. */
export type RecurrenceResult =
    | { readonly status: 'saved'; readonly day: DayState; readonly untils: readonly UntilStep[] }
    | { readonly status: 'stale'; readonly day: DayState }
    | Refused;

/** L'API des journées, vue du moteur. Une panne — réseau, erreur du serveur — lève. */
export interface DayApi {
    read(date: string): Promise<DayState>;
    /**
     * Un geste ; annuler et rétablir y joignent les fins à rendre aux récurrences. Annuler
     * dit aussi qu'il rend une journée d'avant (`restores`) : une fois prévue d'un jour à
     * venir que le geste annulé avait montrée cède à ce qu'il réécrit, au lieu de se détacher
     * (src/Day/DayWriter.php, changeOccurrences). Rétablir nomme les récurrences dont
     * l'annulation a rendu la fois à sa série sans l'écrire (`detaches`) : il la détache de
     * nouveau (DayWriter::detachAgain).
     */
    changeSlots(
        date: string,
        version: number,
        changes: readonly SlotChange[],
        untils?: readonly UntilRewind[],
        restores?: boolean,
        detaches?: readonly string[],
    ): Promise<WriteResult>;
    /**
     * « Enregistrer » dans la fenêtre d'un bloc, sa case « Récurrence » cochée — `rule` —
     * ou décochée — null —, sur le bloc que portait `replaces`, s'il en portait une, telle
     * que la fenêtre l'a vue. Une récurrence coupée qu'on colle nomme celle dont elle vient
     * (`follows`) : au même rythme, elle en reprend les fois effacées ou détachées.
     */
    saveRecurrence(
        date: string,
        version: number,
        changes: readonly SlotChange[],
        rule: RecurrenceRule | null,
        replaces: SeenRecurrence | null,
        follows?: string | null,
    ): Promise<RecurrenceResult>;
    setObjective(date: string, version: number, objective: number): Promise<WriteResult>;
    send(date: string, version: number): Promise<SendResult>;
}

/** Ce que l'onglet garde d'une journée à l'autre : l'historique de chaque jour, et le presse-papier. */
export interface TabMemory {
    readonly histories: HistoryStore;
    readonly clipboard: ClipboardStore;
    /**
     * Le bloc qu'un collage en route a laissé au presse-papier, et la coupée dont il emporte la
     * récurrence : annuler la coupe pendant le voyage la lui retire pour de bon (DaySession.undo).
     * Rien ne voyage plus après un rechargement : il ne se garde pas.
     */
    readonly pasting: WeakMap<Clipboard, string>;
}

export function tabMemory(storage: TabStorage): TabMemory {
    return { histories: storedHistory(storage), clipboard: storedClipboard(storage), pasting: new WeakMap() };
}

/** Ce qu'est devenu un geste, pour que l'écran le dise. */
export type Outcome =
    /**
     * Ce que le geste a changé, tel que le serveur l'a enregistré : de quoi dire à
     * l'écran ce qui a disparu. Null pour l'objectif, qui n'est pas dans la grille.
     */
    | { readonly kind: 'saved'; readonly step: Step | null }
    /** Le geste ne change rien à la journée enregistrée : rien ne part. */
    | { readonly kind: 'unchanged' }
    /** La journée avait changé ailleurs : rien n'est écrit, et l'écran est remis à jour. */
    | { readonly kind: 'stale' }
    | { readonly kind: 'invalid'; readonly violations: readonly Violation[] }
    /**
     * Le serveur n'a pas répondu : l'écriture est peut-être passée. L'écran montre ce
     * que la base contient, s'il a pu la relire.
     */
    | { readonly kind: 'failed' }
    /** Les créneaux du geste à annuler, ou à rétablir, ont changé ailleurs : rien n'est écrit. */
    | { readonly kind: 'conflict' }
    /** Rien à annuler, à rétablir, à couper ou à coller. */
    | { readonly kind: 'nothing' }
    /** Le groupe collé déborderait après 20:00 : rien n'est collé. */
    | { readonly kind: 'overflow' }
    /** Le geste attendait derrière un geste refusé, ou la journée a été quittée : il n'est pas parti. */
    | { readonly kind: 'abandoned' };

/** Ce qu'est devenu un envoi sur Jira : ce qui est arrivé se lit dans l'état d'envoi de la journée. */
export type SendOutcome =
    | { readonly kind: 'done' }
    | { readonly kind: 'stale' }
    /** Un autre onglet envoie déjà cette journée : le résultat viendra avec la journée relue. */
    | { readonly kind: 'sending' }
    | { readonly kind: 'nothing' }
    /** Le serveur n'a pas répondu : l'envoi a pu partir. L'écran montre ce que la base dit, s'il a pu la relire. */
    | { readonly kind: 'failed' }
    | { readonly kind: 'abandoned' };

export interface PasteOutcome {
    readonly outcome: Outcome;
    /** Les quarts d'heure collés, que la sélection devient ; aucun si rien n'a été collé. */
    readonly pasted: readonly number[];
}

export interface SessionSnapshot {
    readonly day: DayState;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    /** Un geste attend sa réponse. */
    readonly busy: boolean;
}

/** Une fin changée sans quart d'heure changé : rien à rendre dans la grille. */
const EMPTY_STEP: Step = { quarters: [], before: [], after: [] };

/**
 * La journée ne reçoit aucune récurrence : mise à 0h00, ou non travaillée. Ce qu'annuler y relie
 * revient à sa série sans s'y écrire (src/Day/DayWriter.php, returned).
 */
function withholds(day: DayState): boolean {
    return day.declaredOff || !day.working;
}

function saved(before: Grid, after: Grid, quarters: Iterable<number>): Outcome {
    return { kind: 'saved', step: stepBetween(before, after, quarters) };
}

const UNCHANGED: Outcome = { kind: 'unchanged' };
const STALE: Outcome = { kind: 'stale' };
const FAILED: Outcome = { kind: 'failed' };
const CONFLICT: Outcome = { kind: 'conflict' };
const NOTHING: Outcome = { kind: 'nothing' };
const OVERFLOW: Outcome = { kind: 'overflow' };
const ABANDONED: Outcome = { kind: 'abandoned' };

/**
 * Une journée affichée, et tout ce qui la lit ou l'écrit : les gestes, copier, couper,
 * coller, annuler, rétablir, l'objectif.
 *
 * Elle n'affiche que ce que le serveur a enregistré, jamais un résultat anticipé.
 * Les gestes passent un à un, copier compris : chacun attend la réponse du précédent,
 * puis se calcule sur la journée enregistrée, si bien qu'un double clic ou une Entrée
 * répétée ne change rien la seconde fois, et qu'une copie faite juste après un geste
 * le contient. Un geste refusé n'est pas rejoué, et ceux qui attendaient derrière lui
 * sont abandonnés : ils partaient d'une journée qui n'était plus la bonne.
 *
 * Une session ne sert qu'un jour, et s'ouvre par DaySessions. Quand l'écran change de
 * jour, elle se ferme : ce qui était déjà en file finit de s'enregistrer, un nouveau
 * geste est abandonné, et plus rien n'atteint l'écran.
 *
 * Elle se relit à son tour dans la file (refresh) : au retour sur la page, ou pendant
 * qu'un autre onglet l'envoie. Une relecture qui la trouve changée ailleurs fait refuser
 * les gestes faits avant elle qui attendent encore leur tour, comme le serveur l'aurait
 * fait : ils partaient de la journée qu'on voyait, qui n'est plus la bonne.
 */
export class DaySession {
    readonly date: string;
    private readonly api: DayApi;
    private readonly memory: TabMemory;
    private readonly listeners = new Set<() => void>();
    private day: DayState;
    private snapshot: SessionSnapshot;
    private queue: Promise<unknown> = Promise.resolve();
    private pending = 0;
    /** Avance à chaque refus : les gestes qui attendaient derrière lui sont abandonnés. */
    private epoch = 0;
    /** Avance à chaque relecture qui trouve la journée changée ailleurs (seen). */
    private rereads = 0;
    private closed = false;

    constructor(day: DayState, api: DayApi, memory: TabMemory) {
        this.date = day.date;
        this.day = day;
        this.api = api;
        this.memory = memory;
        if (memory.histories.sending(this.date) !== null) {
            // Une écriture est partie avant un rechargement, et sa réponse s'est perdue
            // avec la page. Elle est peut-être passée, peut-être encore en route :
            // l'historique ne dit plus ce que la journée contient.
            memory.histories.write(this.date, EMPTY_HISTORY);
            memory.histories.markSending(this.date, null);
        }
        this.snapshot = this.take();
    }

    /** L'état à afficher. Le même objet tant que rien n'a changé. */
    current(): SessionSnapshot {
        return this.snapshot;
    }

    subscribe(listener: () => void): () => void {
        if (!this.closed) {
            this.listeners.add(listener);
        }

        return () => {
            this.listeners.delete(listener);
        };
    }

    /** Une fois tout ce qui était en file enregistré, ou refusé. */
    settled(): Promise<void> {
        return this.queue.then(() => undefined);
    }

    /**
     * Combien de gestes ont été refusés sur cette journée : ce qui attendait derrière un
     * refus, hors de la file — une fenêtre qui attend pour s'ouvrir —, y renonce comme les
     * gestes qu'elle abandonne.
     */
    refusals(): number {
        return this.epoch;
    }

    /**
     * La journée telle que l'écran la voit : ce qu'un geste décidé maintenant, mais qui
     * n'entre dans la file que plus tard — une fenêtre qui attend Jira —, passe à `apply`.
     */
    seen(): number {
        return this.rereads;
    }

    /**
     * Un geste : seuls partent les quarts d'heure qu'il change vraiment, comparés à la
     * journée une fois le ticket et le commentaire réécrits comme le serveur le fera.
     *
     * @param seen la journée sur laquelle il a été décidé (seen) ; relue changée depuis, il
     *             est refusé
     */
    apply(changes: QuarterChanges, seen = this.rereads, cuts: Clipboard | null = null): Promise<Outcome> {
        for (const quarter of changes.keys()) {
            Quarter.assertQuarter(quarter);
        }

        return this.enqueue(() => this.write(changes).then((outcome) => this.cutDone(outcome, cuts)), ABANDONED, {
            seen,
            stale: STALE,
        });
    }

    /**
     * Un favori déposé, à son tour dans la file : son ticket sur une fois qui revient du même
     * ticket, sans commentaire, la laisse telle qu'elle est (keepingOccurrences).
     */
    drop(changes: QuarterChanges): Promise<Outcome> {
        return this.enqueue(() => this.write(keepingOccurrences(this.day.grid, changes)), ABANDONED, {
            seen: this.rereads,
            stale: STALE,
        });
    }

    /** Copier la sélection, telle qu'elle est une fois les gestes d'avant enregistrés. */
    copy(selection: Selection): Promise<Clipboard | null> {
        return this.enqueue(() => {
            const copied = copy(this.day.grid, selection);
            if (copied !== null) {
                this.memory.clipboard.write(copied);
            }

            return Promise.resolve(copied);
        }, null);
    }

    /** Ce qu'un clic sur un favori met dans le presse-papier, à son tour dans la file. */
    copyContent(content: SlotContent): Promise<Clipboard | null> {
        return this.enqueue(() => {
            const copied = clipboardOf(content);
            this.memory.clipboard.write(copied);

            return Promise.resolve(copied);
        }, null);
    }

    /**
     * « Enregistrer » dans la fenêtre d'un bloc, avec sa case « Récurrence » : créer la
     * récurrence, la changer ou l'arrêter à partir de cette fois. Annuler la défait d'un
     * coup — le bloc, et la fin des récurrences touchées.
     *
     * @param replaces la récurrence que portait le bloc, telle que la fenêtre l'a vue :
     *                 changée depuis ailleurs, le serveur refuse comme une journée en retard
     */
    saveRecurrence(
        changes: QuarterChanges,
        rule: RecurrenceRule | null,
        replaces: SeenRecurrence | null,
        seen = this.rereads,
        cuts: Clipboard | null = null,
    ): Promise<Outcome> {
        for (const quarter of changes.keys()) {
            Quarter.assertQuarter(quarter);
        }

        return this.enqueue(
            () => this.writeRecurrence(changes, rule, replaces).then((outcome) => this.cutDone(outcome, cuts)),
            ABANDONED,
            { seen, stale: STALE },
        );
    }

    /** Couper : copier puis effacer, un seul geste, sur la même journée. */
    cut(selection: Selection): Promise<Outcome> {
        return this.enqueue(
            () => {
                const copied = copy(this.day.grid, selection);
                if (copied === null) {
                    return Promise.resolve(NOTHING);
                }
                this.memory.clipboard.write(copied);

                return this.write(fill(selection.quarters, null));
            },
            ABANDONED,
            this.unseen(STALE),
        );
    }

    /**
     * Coller sur la sélection ce que le presse-papier tient à son tour dans la file.
     *
     * Une récurrence coupée avec les suivantes repart du jour du collage, son bloc et elle dans
     * une seule écriture, au rythme que ce jour permet (followRhythm), et reprend les fois
     * effacées ou détachées de celle dont elle vient. Le presse-papier ne la garde plus, dès
     * l'envoi (withoutCut). Un jour passé, non travaillé ou mis à 0h00, d'avant la coupe ou
     * après sa fin, ou qui ne lui laisse aucun jour travaillé, le bloc se colle seul, et elle
     * attend un autre collage. Refusée — un créneau déjà pris —, rien n'est collé.
     *
     * @param today le jour de l'utilisateur ; sans lui, une récurrence ne repart pas
     */
    paste(selection: Selection, today: string | null = null): Promise<PasteOutcome> {
        return this.enqueue(
            async () => {
                const clipboard = this.memory.clipboard.read();
                const result = clipboard === null ? null : paste(clipboard, selection);
                if (result === null || clipboard === null || result.kind === 'nothing') {
                    return { outcome: NOTHING, pasted: [] };
                }
                if (result.kind === 'overflow') {
                    return { outcome: OVERFLOW, pasted: [] };
                }
                const revived = today === null ? null : this.revival(clipboard, today);
                if (revived !== null) {
                    const outcome = await this.withoutCut(
                        clipboard,
                        () => this.writeRecurrence(result.changes, revived.rule, null, revived.follows),
                        revived.follows,
                    );

                    return { outcome, pasted: outcome.kind === 'saved' ? result.quarters : [] };
                }
                // Le même contenu collé sur une fois qui revient la laisse telle qu'elle est.
                const outcome = await this.write(keepingOccurrences(this.day.grid, result.changes));

                return {
                    outcome,
                    pasted: outcome.kind === 'saved' || outcome.kind === 'unchanged' ? result.quarters : [],
                };
            },
            { outcome: ABANDONED, pasted: [] },
            this.unseen({ outcome: STALE, pasted: [] }),
        );
    }

    /**
     * Annuler le dernier geste de la journée. Celui qui rend sa fin à la récurrence coupée que le
     * presse-papier emporte — la coupe elle-même — la lui retire : le presse-papier garde son
     * bloc, et un collage ne la ferait pas revenir une seconde fois. De même pendant qu'un collage
     * l'emporte : refusé ensuite, il ne la rend pas au presse-papier. Rétablir ne la remet pas.
     *
     * Une coupe dont le collage est encore là, ailleurs, ne s'annule pas : le serveur le refuse,
     * et dit d'annuler le collage d'abord. Rétablir ce collage attend de même que la coupe le soit.
     */
    undo(): Promise<Outcome> {
        return this.enqueue(
            () =>
                this.rewind(
                    planUndo,
                    (history) => history.undo.at(-1),
                    (history, day) => undone(history, day.grid, withholds(day)),
                    true,
                ),
            ABANDONED,
            this.unseen(STALE),
        );
    }

    redo(): Promise<Outcome> {
        return this.enqueue(
            () =>
                this.rewind(
                    planRedo,
                    (history) => history.redo.at(-1),
                    (history, day) => redone(history, day.grid),
                ),
            ABANDONED,
            this.unseen(STALE),
        );
    }

    /** L'objectif du jour. Il n'entre pas dans l'historique : sa fenêtre a son propre retour. */
    setObjective(objective: number): Promise<Outcome> {
        return this.enqueue(
            () => {
                const before = this.day;
                if (before.objective === objective) {
                    return Promise.resolve(UNCHANGED);
                }

                return this.send(
                    before,
                    () => this.api.setObjective(this.date, before.version, objective),
                    false,
                    () => ({ kind: 'saved', step: null }),
                );
            },
            ABANDONED,
            this.unseen(STALE),
        );
    }

    /**
     * Envoie la journée sur Jira telle qu'elle est enregistrée, une fois les gestes d'avant
     * partis : la journée envoyée est celle qu'on voit.
     *
     * @param shown la journée que la fenêtre de l'envoi montrait en s'ouvrant : sa version
     *              part avec l'envoi, et le serveur refuse une journée changée depuis,
     *              quel que soit le chemin qui y a mené ; relue changée (seen), rien ne part
     *              même jusqu'à lui
     */
    sendToJira(shown?: ShownDay): Promise<SendOutcome> {
        const seen = shown?.seen ?? this.rereads;

        return this.enqueue(
            async (): Promise<SendOutcome> => {
                let result: SendResult;
                try {
                    result = await this.api.send(this.date, shown?.version ?? this.day.version);
                    this.assertSameDate(result.day);
                } catch {
                    await this.reread();

                    return { kind: 'failed' };
                }

                this.day = result.day;

                return result.status === 'stale'
                    ? (this.refuse(STALE) as SendOutcome)
                    : { kind: result.status === 'done' ? 'done' : result.status };
            },
            { kind: 'abandoned' },
            { seen, stale: { kind: 'stale' } },
        );
    }

    /** Relit la journée à son tour dans la file : un envoi parti d'un autre onglet a pu finir. */
    refresh(): Promise<void> {
        return this.enqueue(() => this.reread(), undefined);
    }

    /** Le presse-papier de l'onglet tient quelque chose à coller. */
    hasClipboard(): boolean {
        return this.memory.clipboard.read() !== null;
    }

    /** Ce que tient le presse-papier de l'onglet, tel qu'un collage le lirait maintenant. */
    clipboard(): Clipboard | null {
        return this.memory.clipboard.read();
    }

    close(): void {
        this.closed = true;
        this.listeners.clear();
    }

    /** Une coupe passée met ce qu'elle a coupé dans le presse-papier ; refusée, il reste tel quel. */
    private cutDone(outcome: Outcome, cuts: Clipboard | null): Outcome {
        if (cuts !== null && outcome.kind === 'saved') {
            this.memory.clipboard.write(cuts);
        }

        return outcome;
    }

    /**
     * Ce que la récurrence coupée du presse-papier deviendrait, collée sur cette journée-ci — son
     * rythme suivi, et celle dont elle vient —, ou null si elle n'en repart pas : un jour passé ou
     * d'avant la coupe, non travaillé, mis à 0h00, après sa fin, ou qui ne lui laisse aucun jour
     * que les réglages travaillent.
     */
    private revival(
        clipboard: Clipboard,
        today: string,
    ): { readonly rule: RecurrenceRule; readonly follows: string } | null {
        const { recurrence: rule, source } = clipboard;
        if (
            rule === undefined ||
            source === undefined ||
            this.date < today ||
            this.date < source.date ||
            !this.day.working ||
            this.day.declaredOff ||
            (rule.until !== null && rule.until < this.date)
        ) {
            return null;
        }
        const rhythm = followRhythm(rule, this.date, this.day.workingDays);

        return rhythm === null ? null : { rule: { ...rhythm, until: rule.until }, follows: source.id };
    }

    /**
     * Une écriture qui fait repartir la récurrence coupée du presse-papier, ou qui défait sa
     * coupe : le presse-papier la perd avant l'envoi, et garde son bloc. Un collage lancé
     * entre-temps sur une autre journée colle le bloc seul : jamais deux récurrences d'une même
     * coupe. Refusée pour de bon — rien n'est écrit —, elle y revient, si rien n'a été copié,
     * coupé ni annulé de sa coupe depuis ; sans réponse, l'écriture a pu passer, et elle n'y
     * revient pas. Un collage que le serveur refuse parce que la coupe a été annulée ailleurs —
     * un onglet dupliqué — ne la rend pas non plus : elle est revenue à sa place.
     *
     * @param pasting la coupée qu'emporte un collage : annuler sa coupe pendant le voyage la lui retire
     */
    private async withoutCut(
        clipboard: Clipboard,
        write: () => Promise<Outcome>,
        pasting: string | null = null,
    ): Promise<Outcome> {
        const left = withoutRecurrence(clipboard);
        if (pasting !== null) {
            this.memory.pasting.set(left, pasting);
        }
        this.memory.clipboard.write(left);
        const outcome = await write();
        const uncut = outcome.kind === 'invalid' && outcome.violations.some(({ field }) => field === 'follows');
        if (
            (outcome.kind === 'invalid' || outcome.kind === 'stale' || outcome.kind === 'conflict') &&
            !uncut &&
            this.memory.clipboard.read() === left
        ) {
            this.memory.clipboard.write(clipboard);
        }

        return outcome;
    }

    private write(changes: QuarterChanges): Promise<Outcome> {
        const before = this.day;
        const wanted = new Map<number, Cell>();
        for (const [quarter, content] of changes) {
            const cell = normalizeCell(content);
            if (!sameCell(before.grid.at(quarter), cell)) {
                wanted.set(quarter, cell);
            }
        }
        if (wanted.size === 0) {
            return Promise.resolve(UNCHANGED);
        }
        // Un quart d'heure pris à une récurrence détache sa fois entière : le geste le dit,
        // et annuler la rendra entière.
        const diff = detach(before.grid, wanted);

        return this.writeSlots(before, diff, [], false, [], (day) => {
            const outcome = saved(before.grid, day.grid, diff.keys());
            if (outcome.kind === 'saved' && outcome.step !== null) {
                this.memory.histories.write(this.date, record(this.memory.histories.read(this.date), outcome.step));
            }

            return outcome;
        });
    }

    private rewind(
        plan: (history: History, grid: Grid) => Rewind,
        top: (history: History) => Step | undefined,
        done: (history: History, day: DayState) => History,
        restores = false,
    ): Promise<Outcome> {
        const before = this.day;
        const histories = this.memory.histories;
        const history = histories.read(this.date);
        const rewind = plan(history, before.grid);
        if (rewind.kind === 'nothing') {
            return Promise.resolve(NOTHING);
        }
        if (rewind.kind === 'conflict') {
            // Les gestes plus anciens partaient d'une journée qui n'existe plus.
            histories.write(this.date, EMPTY_HISTORY);

            return Promise.resolve(this.refuse(CONFLICT));
        }
        const step = top(history);
        const written = (): Promise<Outcome> => this.rewritten(before, rewind, step, top, done, restores);
        // Annuler la coupe d'une récurrence que le presse-papier emporte, ou qu'un collage en route
        // lui a prise, la lui retire (undo).
        const clipboard = restores ? this.memory.clipboard.read() : null;
        const cut =
            clipboard === null
                ? undefined
                : clipboard.recurrence === undefined
                  ? this.memory.pasting.get(clipboard)
                  : clipboard.source?.id;
        const uncuts = cut !== undefined && rewind.untils.some(({ recurrence }) => recurrence === cut);

        return clipboard !== null && uncuts ? this.withoutCut(clipboard, written) : written();
    }

    /** Écrit ce qui défait, ou refait, le dernier geste (rewind). */
    private rewritten(
        before: DayState,
        rewind: Extract<Rewind, { readonly kind: 'changes' }>,
        step: Step | undefined,
        top: (history: History) => Step | undefined,
        done: (history: History, day: DayState) => History,
        restores: boolean,
    ): Promise<Outcome> {
        const histories = this.memory.histories;

        return this.writeSlots(before, rewind.changes, rewind.untils, restores, rewind.detaches ?? [], (day) => {
            // Une autre session du même jour a pu ranger un geste entre-temps : on ne
            // déplace que celui qui vient d'être défait, sinon on oublie tout.
            const now = histories.read(this.date);
            const current = top(now);
            histories.write(
                this.date,
                step !== undefined && current !== undefined && sameStep(step, current) ? done(now, day) : EMPTY_HISTORY,
            );

            return saved(before.grid, day.grid, rewind.changes.keys());
        }).then((outcome) => {
            // Refusé sans que la journée ait changé : la fin d'une récurrence a changé ailleurs,
            // depuis un autre jour, ou elle ne tombe plus ce jour-là — retirée depuis le jour
            // où elle est née —, et le lien qu'il rendait n'a plus où aller. Le geste ne se
            // défera plus : il est oublié, avec ceux d'avant, plutôt que de redire à chaque
            // Ctrl+Z que la journée a changé.
            const relinks = [...rewind.changes.values()].some((cell) => cell !== null && cell.recurrence !== null);
            if (
                outcome.kind === 'stale' &&
                (rewind.untils.length > 0 || relinks || rewind.detaches !== undefined) &&
                this.day.version === before.version
            ) {
                histories.write(this.date, EMPTY_HISTORY);

                return CONFLICT;
            }

            return outcome;
        });
    }

    private writeSlots(
        before: DayState,
        changes: QuarterChanges,
        untils: readonly UntilRewind[],
        restores: boolean,
        detaches: readonly string[],
        onSaved: (day: DayState) => Outcome,
    ): Promise<Outcome> {
        return this.send(
            before,
            () =>
                restores
                    ? this.api.changeSlots(this.date, before.version, toSlotChanges(changes), untils, true)
                    : detaches.length > 0
                      ? this.api.changeSlots(this.date, before.version, toSlotChanges(changes), untils, false, detaches)
                      : untils.length === 0
                        ? this.api.changeSlots(this.date, before.version, toSlotChanges(changes))
                        : this.api.changeSlots(this.date, before.version, toSlotChanges(changes), untils),
            true,
            onSaved,
        );
    }

    /**
     * Le geste rangé est tout ce qui a changé dans la journée : la version qu'il portait
     * garantit que rien d'autre ne l'a écrite entre-temps. Il garde les fins d'avant et
     * d'après des récurrences touchées.
     */
    private writeRecurrence(
        changes: QuarterChanges,
        rule: RecurrenceRule | null,
        replaces: SeenRecurrence | null,
        follows: string | null = null,
    ): Promise<Outcome> {
        const before = this.day;
        const cells = new Map<number, Cell>();
        for (const [quarter, content] of changes) {
            cells.set(quarter, normalizeCell(content));
        }
        let untils: readonly UntilStep[] = [];

        return this.send(
            before,
            async () => {
                const result = await this.api.saveRecurrence(
                    this.date,
                    before.version,
                    toSlotChanges(cells),
                    rule,
                    replaces,
                    follows,
                );
                if (result.status === 'saved') {
                    untils = result.untils;
                }

                return result;
            },
            true,
            (day) => {
                const step = stepBetween(before.grid, day.grid, Quarter.all());
                const kept = step === null && untils.length === 0 ? null : { ...(step ?? EMPTY_STEP), untils };
                if (kept !== null) {
                    this.memory.histories.write(this.date, record(this.memory.histories.read(this.date), kept));
                }

                return { kind: 'saved', step };
            },
        );
    }

    /**
     * Envoie une écriture partie de `before`. Celle des créneaux laisse une marque le
     * temps du voyage : un rechargement en plein envoi saura qu'il ne sait pas.
     */
    private async send(
        before: DayState,
        request: () => Promise<WriteResult>,
        slots: boolean,
        onSaved: (day: DayState) => Outcome,
    ): Promise<Outcome> {
        const histories = this.memory.histories;
        if (slots) {
            histories.markSending(this.date, before.version);
        }
        let result: WriteResult;
        try {
            result = await request();
            if (result.status !== 'invalid') {
                this.assertSameDate(result.day);
            }
        } catch {
            return await this.recover(before, slots);
        } finally {
            if (slots) {
                histories.markSending(this.date, null);
            }
        }

        switch (result.status) {
            case 'saved':
                this.day = result.day;

                return onSaved(result.day);
            case 'stale':
                this.day = result.day;

                return this.refuse(STALE);
            case 'invalid':
                return this.refuse({ kind: 'invalid', violations: result.violations });
        }
    }

    /**
     * Sans réponse, on ne sait pas si l'écriture est passée : la journée est relue, pour
     * que l'écran montre ce que la base contient. Si une écriture de créneaux a pu passer
     * depuis — la sienne, ou celle d'un autre onglet au même instant, rien ne permet de
     * les distinguer —, l'historique ne dit plus ce que la journée contient : il est
     * oublié, plutôt que d'annuler un jour ce qu'un autre onglet a écrit.
     */
    private async recover(before: DayState, slots: boolean): Promise<Outcome> {
        let written = true;
        try {
            const day = await this.api.read(this.date);
            this.assertSameDate(day);
            this.day = day;
            written = day.version !== before.version;
        } catch {
            // La journée reste celle d'avant : le prochain geste la remettra à jour.
        }
        if (written && slots) {
            this.memory.histories.write(this.date, EMPTY_HISTORY);
        }

        return this.refuse(FAILED);
    }

    private async reread(): Promise<void> {
        try {
            const day = await this.api.read(this.date);
            this.assertSameDate(day);
            if (day.version !== this.day.version) {
                this.rereads += 1;
            }
            this.day = day;
        } catch {
            // La journée reste celle d'avant : la prochaine lecture la remettra à jour.
        }
    }

    private assertSameDate(day: DayState): void {
        if (day.date !== this.date) {
            throw new Error(`Le serveur a rendu le ${day.date} pour le ${this.date}.`);
        }
    }

    private refuse(outcome: Outcome): Outcome {
        this.epoch += 1;

        return outcome;
    }

    /** Un geste décidé maintenant, sur la journée qu'on voit : ce qu'il rend si elle est relue changée avant son tour. */
    private unseen<T>(stale: T): Outdated<T> {
        return { seen: this.rereads, stale };
    }

    /**
     * @param abandoned ce que rend le geste s'il ne part pas
     * @param outdated  la journée sur laquelle il a été décidé : relue changée avant son tour,
     *                  il est refusé, et ce qui attend derrière lui abandonné
     */
    private enqueue<T>(task: () => Promise<T>, abandoned: T, outdated?: Outdated<T>): Promise<T> {
        if (this.closed) {
            return Promise.resolve(abandoned);
        }
        const epoch = this.epoch;
        this.pending += 1;
        this.publish();
        const run = this.queue
            .then(() => {
                if (epoch !== this.epoch) {
                    return abandoned;
                }
                if (outdated !== undefined && outdated.seen !== this.rereads) {
                    this.refuse(STALE);

                    return outdated.stale;
                }

                return task();
            })
            .finally(() => {
                this.pending -= 1;
                this.publish();
            });
        // Un geste qui lève est un bug : il le dit à son appelant, sans bloquer les suivants.
        this.queue = run.catch(() => undefined);

        return run;
    }

    private publish(): void {
        this.snapshot = this.take();
        if (!this.closed) {
            this.listeners.forEach((listener) => {
                listener();
            });
        }
    }

    private take(): SessionSnapshot {
        const history = this.memory.histories.read(this.date);

        return {
            day: this.day,
            canUndo: history.undo.length > 0,
            canRedo: history.redo.length > 0,
            busy: this.pending > 0,
        };
    }
}

/** La journée telle qu'une fenêtre la montrait en s'ouvrant : sa version, et ses relectures (DaySession.seen). */
export interface ShownDay {
    readonly version: number;
    readonly seen: number;
}

/** Ce que rend un geste quand la journée a été relue changée entre le moment où on l'a fait et son tour. */
interface Outdated<T> {
    readonly seen: number;
    readonly stale: T;
}

function sameStep(a: Step, b: Step): boolean {
    return (
        a.quarters.length === b.quarters.length &&
        a.quarters.every(
            (quarter, index) =>
                b.quarters[index] === quarter &&
                sameCell(a.before[index] ?? null, b.before[index] ?? null) &&
                sameCell(a.after[index] ?? null, b.after[index] ?? null),
        )
    );
}
