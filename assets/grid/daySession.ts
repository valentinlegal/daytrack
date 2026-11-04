import { fill, type QuarterChanges, type SlotChange, toSlotChanges } from './changes';
import { type Clipboard, clipboardOf, type ClipboardStore, copy, paste, storedClipboard } from './clipboard';
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
} from './history';
import * as Quarter from './quarter';
import type { Selection } from './selection';
import type { TabStorage } from './tabStore';

/** Une saisie refusée, champ par champ (src/EventListener/ApiErrorListener.php). */
export interface Violation {
    readonly field: string;
    readonly message: string;
}

export type WriteResult =
    | { readonly status: 'saved'; readonly day: DayState }
    /** La journée avait changé ailleurs : rien n'est écrit, voici la journée à jour (409). */
    | { readonly status: 'stale'; readonly day: DayState }
    /** Une règle refuse le geste : rien n'est écrit (422). */
    | { readonly status: 'invalid'; readonly violations: readonly Violation[] };

/**
 * Ce qu'a donné un envoi sur Jira, avec la journée telle qu'elle est ensuite : son état
 * d'envoi dit ce qui est arrivé.
 */
export type SendResult =
    /** Le serveur a envoyé, et relu Jira. */
    | { readonly status: 'done'; readonly day: DayState }
    /** Rien n'est parti : la journée avait changé ailleurs, un autre onglet envoie déjà, ou il n'y a rien à envoyer (409). */
    | { readonly status: 'stale' | 'sending' | 'nothing'; readonly day: DayState };

/** L'API des journées, vue du moteur. Une panne — réseau, erreur du serveur — lève. */
export interface DayApi {
    read(date: string): Promise<DayState>;
    changeSlots(date: string, version: number, changes: readonly SlotChange[]): Promise<WriteResult>;
    setObjective(date: string, version: number, objective: number): Promise<WriteResult>;
    send(date: string, version: number): Promise<SendResult>;
}

/** Ce que l'onglet garde d'une journée à l'autre : l'historique de chaque jour, et le presse-papier. */
export interface TabMemory {
    readonly histories: HistoryStore;
    readonly clipboard: ClipboardStore;
}

export function tabMemory(storage: TabStorage): TabMemory {
    return { histories: storedHistory(storage), clipboard: storedClipboard(storage) };
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
     * Un geste : seuls partent les quarts d'heure qu'il change vraiment, comparés à la
     * journée une fois le ticket et le commentaire réécrits comme le serveur le fera.
     */
    apply(changes: QuarterChanges): Promise<Outcome> {
        for (const quarter of changes.keys()) {
            Quarter.assertQuarter(quarter);
        }

        return this.enqueue(() => this.write(changes), ABANDONED);
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

    /** Couper : copier puis effacer, un seul geste, sur la même journée. */
    cut(selection: Selection): Promise<Outcome> {
        return this.enqueue(() => {
            const copied = copy(this.day.grid, selection);
            if (copied === null) {
                return Promise.resolve(NOTHING);
            }
            this.memory.clipboard.write(copied);

            return this.write(fill(selection.quarters, null));
        }, ABANDONED);
    }

    /** Coller sur la sélection ce que le presse-papier tient à son tour dans la file. */
    paste(selection: Selection): Promise<PasteOutcome> {
        return this.enqueue(
            async () => {
                const clipboard = this.memory.clipboard.read();
                const result = clipboard === null ? null : paste(clipboard, selection);
                if (result === null || result.kind === 'nothing') {
                    return { outcome: NOTHING, pasted: [] };
                }
                if (result.kind === 'overflow') {
                    return { outcome: OVERFLOW, pasted: [] };
                }
                const outcome = await this.write(result.changes);

                return {
                    outcome,
                    pasted: outcome.kind === 'saved' || outcome.kind === 'unchanged' ? result.quarters : [],
                };
            },
            { outcome: ABANDONED, pasted: [] },
        );
    }

    undo(): Promise<Outcome> {
        return this.enqueue(() => this.rewind(planUndo, (history) => history.undo.at(-1), undone), ABANDONED);
    }

    redo(): Promise<Outcome> {
        return this.enqueue(() => this.rewind(planRedo, (history) => history.redo.at(-1), redone), ABANDONED);
    }

    /** L'objectif du jour. Il n'entre pas dans l'historique : sa fenêtre a son propre retour. */
    setObjective(objective: number): Promise<Outcome> {
        return this.enqueue(() => {
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
        }, ABANDONED);
    }

    /**
     * Envoie la journée sur Jira telle qu'elle est enregistrée, une fois les gestes d'avant
     * partis : la journée envoyée est celle qu'on voit.
     */
    sendToJira(): Promise<SendOutcome> {
        return this.enqueue(
            async (): Promise<SendOutcome> => {
                let result: SendResult;
                try {
                    result = await this.api.send(this.date, this.day.version);
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

    close(): void {
        this.closed = true;
        this.listeners.clear();
    }

    private write(changes: QuarterChanges): Promise<Outcome> {
        const before = this.day;
        const diff = new Map<number, Cell>();
        for (const [quarter, content] of changes) {
            const wanted = normalizeCell(content);
            if (!sameCell(before.grid.at(quarter), wanted)) {
                diff.set(quarter, wanted);
            }
        }
        if (diff.size === 0) {
            return Promise.resolve(UNCHANGED);
        }

        return this.writeSlots(before, diff, (day) => {
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
        done: (history: History, grid: Grid) => History,
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

        return this.writeSlots(before, rewind.changes, (day) => {
            // Une autre session du même jour a pu ranger un geste entre-temps : on ne
            // déplace que celui qui vient d'être défait, sinon on oublie tout.
            const now = histories.read(this.date);
            const current = top(now);
            histories.write(
                this.date,
                step !== undefined && current !== undefined && sameStep(step, current)
                    ? done(now, day.grid)
                    : EMPTY_HISTORY,
            );

            return saved(before.grid, day.grid, rewind.changes.keys());
        });
    }

    private writeSlots(
        before: DayState,
        changes: QuarterChanges,
        onSaved: (day: DayState) => Outcome,
    ): Promise<Outcome> {
        return this.send(
            before,
            () => this.api.changeSlots(this.date, before.version, toSlotChanges(changes)),
            true,
            onSaved,
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

    /** @param abandoned ce que rend le geste s'il ne part pas */
    private enqueue<T>(task: () => Promise<T>, abandoned: T): Promise<T> {
        if (this.closed) {
            return Promise.resolve(abandoned);
        }
        const epoch = this.epoch;
        this.pending += 1;
        this.publish();
        const run = this.queue
            .then(() => (epoch === this.epoch ? task() : abandoned))
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
