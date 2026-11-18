import type { SlotChange } from '../../../assets/grid/changes';
import { type DayState, readDay } from '../../../assets/grid/day';
import type { DayApi, RecurrenceResult, SendResult, WriteResult } from '../../../assets/grid/daySession';
import type { UntilRewind, UntilStep } from '../../../assets/grid/history';
import {
    earliestClash,
    firstClash,
    type Recurrence,
    type RecurrenceRule,
    type Rhythm,
    type SeenRecurrence,
    type TimedSchedule,
} from '../../../assets/grid/recurrence';
import type { Violation } from '../../../assets/serverApi';

/**
 * Un serveur des journées en mémoire, aussi strict que le vrai (src/Controller/Api/
 * DayController.php) : la version, le 409 d'un onglet en retard, les refus champ par
 * champ, un champ inconnu refusé sous son nom, le ticket mis en majuscules, la journée
 * vide qui n'est pas créée.
 *
 * Il sait les récurrences comme le vrai (src/Day/DayWriter.php, src/Entity/Day.php) : le
 * lien de chaque quart d'heure à la récurrence qui l'a posé ; un geste qui en prend un
 * détache la fois entière, et la fois détachée ne revient plus ; annuler et rétablir rendent
 * un lien qu'ils prouvent (LinksMatchRecurrences) et une fin qu'elle a encore ; la fenêtre
 * crée une récurrence, la coupe en deux ou change sa fin, l'arrête — le bloc gardé sans elle,
 * ou effacé avec elle —, et dit les fins d'avant et d'après ; une récurrence retirée finit la
 * veille de son premier jour. Arrêtée avant un jour, par la fenêtre ou par une fin rendue sans
 * lien, elle n'y garde pas de fois détachée ; ce qu'elle y avait posé se lit comme une saisie
 * ordinaire, sans lien, fondu avec un voisin au même contenu (DayReader). La fenêtre ne crée
 * pas une journée où rien ne reste saisi. Il les pose le jour venu quand on le lui dit (pose),
 * sur les seuls créneaux libres.
 *
 * Un jour à venir montre aussi les fois prévues de ses récurrences, sans les écrire
 * (src/Recurrence/RecurrenceForecast.php) : un geste qui en touche une la pose détachée, et
 * annuler la rend à la prévision. Sa version dit aussi lesquelles il prévoit
 * (src/Day/DayVersion.php) : une récurrence changée depuis un autre jour refuse l'onglet en
 * retard. Mis à 0h00, un jour perd les blocs que ses récurrences y ont posés et ne prévoit
 * plus rien ; revenu à un objectif, il les retrouve. L'envoi d'un jour à venir pose ses fois
 * prévues avant de partir (src/Sending/DaySender.php) : tant que l'envoi a quelque chose à dire
 * — des tickets, ou des heures dans Jira —, il n'en prévoit plus, et le jour venu rien ne s'y pose.
 * Vidé de ses tickets et sans heures dans Jira — renvoyé vide, ou après un envoi en panne
 * (setJiraDown) —, il redevient un jour comme un autre (src/Sending/SendClosure.php). Sa version
 * dit aussi les flèches qu'il ne montre plus.
 *
 * Il sait les rythmes du vrai (src/Recurrence/Rhythm.php) : chaque semaine ou une semaine sur
 * 2, 3 ou 4, le n-ième jour de la semaine du mois ou le dernier, une date du mois ; il refuse
 * une règle comme RecurrenceRuleInput, et un rythme mensuel que le jour du bloc ne permet pas.
 * Jamais deux récurrences sur un créneau (DayWriter::assertFree) : celle qu'on crée, qu'on
 * coupe ou dont on repousse la fin se refuse sous « recurrence.rhythm » si une autre y revient
 * un même jour après aujourd'hui, et annuler ou rétablir qui la prolongerait sur un créneau
 * pris se refuse comme une journée changée ailleurs. Des récurrences nées avant ce refus
 * peuvent se croiser encore (beforeClashRule).
 *
 * Il est écrit sans rien prendre au moteur — ni sa grille, ni ses plages, ni ses
 * récurrences : ce que le moteur envoie de travers, il le refuse au lieu de le comprendre
 * comme lui. Seule la recherche d'un créneau pris vient du moteur (firstClash, earliestClash) :
 * elle a une seule définition, que les cas partagés éprouvent des deux côtés
 * (tests/cases/recurrences.json, section conflits). Il garde chaque état de chaque journée,
 * par version : ce que la base a contenu, et qu'un écran a le droit d'afficher.
 */

type Stored = { kind: 'work'; ticket: string; comment: string | null } | { kind: 'pause' };

/** Un quart d'heure saisi, et la récurrence qui l'a posé, tant qu'aucun geste ne l'en a détaché. */
interface Slot {
    readonly content: Stored;
    readonly recurrence: string | null;
}

interface StoredDay {
    /** La version de la ligne : le nombre d'écritures reçues. */
    version: number;
    objective: number;
    /** La version de la ligne envoyée sur Jira en dernier ; absente tant qu'aucune. */
    sentVersion?: number;
    /** La version de la ligne d'un envoi qui a échoué, Jira en panne ; absente sinon. */
    failedVersion?: number;
    /**
     * Un envoi en reste : tant qu'il a quelque chose à dire, ses récurrences ne la changent plus,
     * comme un jour venu (closes, DaySendRepository::closesToRecurrences).
     */
    settled?: boolean;
    /** Jira a des heures d'elle que DayTrack y a écrites : un envoi a réussi depuis le dernier renvoi vide. */
    inJira?: boolean;
    quarters: Map<number, Slot>;
}

/**
 * Une fois détachée, que rien ne repose ni ne prévoit plus ; retenue (held), c'est une fois que
 * la journée mise à 0h00 a retirée, et qu'un objectif rendu lui rendra (src/Entity/RecurrenceSkip.php).
 */
interface Skip {
    readonly id: string;
    readonly date: string;
    readonly held: boolean;
}

/** Ce qu'une écriture fait de la journée, qui lui arrive avec ses fois prévues d'avant le geste, par quart d'heure. */
type Gesture = (day: StoredDay, planned: ReadonlyMap<number, string>) => void;

/** Une journée telle que l'API la rend : sa version se lit pour la garder, version par version. */
interface View extends Readonly<Record<string, unknown>> {
    readonly version: number;
}

/** Une journée sans ligne : version 0, l'objectif habituel, rien de saisi. */
function emptyDay(): StoredDay {
    return { version: 0, objective: HABITUAL_OBJECTIVE, quarters: new Map() };
}

/**
 * Son objectif a été mis à 0h00 pour elle (Day::isDeclaredOff) : l'objectif habituel de ce
 * serveur ne l'est jamais, et le choisir le rend.
 */
function isDeclaredOff(day: StoredDay): boolean {
    return day.objective === 0;
}

/** Une récurrence en base : sa définition ne change jamais, seule sa fin bouge (src/Entity/Recurrence.php). */
interface StoredRecurrence {
    readonly id: string;
    readonly content: Stored;
    readonly start: number;
    readonly end: number;
    /** Ses jours de la semaine ISO, dans l'ordre, son « une semaine sur », son jour du mois. */
    readonly rhythm: Rhythm;
    readonly firstDay: string;
    until: string | null;
    /** Le dernier jour déjà traité : un jour déjà venu ne reçoit jamais rien après coup. */
    posedThrough: string;
    /** Collée après une coupe : la coupée qu'elle continue, et le jour de la coupe (Recurrence::follow). */
    follows: { readonly id: string; readonly cutOn: string } | null;
}

/** Une récurrence telle que l'API la rend (src/Recurrence/RecurrenceView.php). */
function viewOf(recurrence: StoredRecurrence, skipped: readonly string[]): object {
    return {
        skipped,
        start: format(recurrence.start),
        end: format(recurrence.end),
        kind: recurrence.rhythm.kind,
        weekdays: recurrence.rhythm.weekdays,
        everyWeeks: recurrence.rhythm.everyWeeks,
        monthWeek: recurrence.rhythm.monthWeek,
        monthDay: recurrence.rhythm.monthDay,
        firstDay: recurrence.firstDay,
        until: recurrence.until,
        slot:
            recurrence.content.kind === 'work'
                ? { kind: 'work', ticket: recurrence.content.ticket, comment: recurrence.content.comment }
                : { kind: 'pause', ticket: null, comment: null },
    };
}

/** Ce qu'un test lit d'une récurrence du serveur. */
export interface RecurrenceRecord extends Rhythm {
    readonly id: string;
    readonly start: string;
    readonly end: string;
    readonly firstDay: string;
    readonly until: string | null;
    /** Ce qu'elle pose : un ticket et son commentaire, ou une pause. */
    readonly content: Stored;
    /** Ses fois détachées ou effacées après aujourd'hui, s'il en a. */
    readonly skipped?: readonly string[];
}

export interface Request {
    readonly kind: 'read' | 'changeSlots' | 'saveRecurrence' | 'setObjective' | 'send' | 'pose';
    readonly date: string;
}

/**
 * Comment une requête voyage. Par défaut, elle arrive et revient aussitôt ; un test
 * peut la retarder, la perdre avant le serveur, ou perdre sa réponse.
 */
export type Transport = <T>(request: Request, handle: () => T) => Promise<T>;

export const HABITUAL_OBJECTIVE = 450;

/** Les jours travaillés des réglages du faux serveur : du lundi au vendredi. */
export const WORKING_DAYS: readonly number[] = [1, 2, 3, 4, 5];

/** Ce faux serveur ne parle pas à Jira : un envoi y réussit toujours, et seul son état se garde. */
const NOTHING_TO_SEND = {
    state: 'nothing',
    sentAt: null,
    attemptedAt: null,
    failure: null,
    inJira: {},
    outcomes: {},
    removed: [],
    vanished: [],
};

const FIRST = 420;
const DAY_END = 1200;

/**
 * Ce que la version de la ligne occupe dans celle d'une journée : au-dessus, l'empreinte des
 * fois prévues, comme DayVersion. Le navigateur n'en lit que l'égalité.
 */
const ROW_SPAN = 2 ** 32;

const DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const MONTHS = [
    'janvier',
    'février',
    'mars',
    'avril',
    'mai',
    'juin',
    'juillet',
    'août',
    'septembre',
    'octobre',
    'novembre',
    'décembre',
];
const NOT_ONE_RANGE = "Une récurrence couvre une seule plage, d'un seul ticket.";
/** RecurrenceRefused::cutUndone. */
const CUT_UNDONE = "La coupe de cette récurrence a été annulée. Rien n'est collé.";

/** Ce que le vrai serveur lit de chaque objet du corps : un autre champ est refusé sous son nom (JsonPayload). */
const CHANGE_FIELDS = new Set(['start', 'end', 'kind', 'ticket', 'comment', 'recurrence']);
const REWIND_FIELDS = new Set(['recurrence', 'from', 'to']);
const RULE_FIELDS = new Set(['weekdays', 'until', 'kind', 'everyWeeks', 'monthWeek', 'monthDay']);
const RHYTHM_KINDS = new Set(['weekly', 'monthly_weekday', 'monthly_date']);
/** Le dernier jour de la semaine du mois (Rhythm::LAST). */
const LAST = -1;
/** Rhythm::MAX_EVERY_WEEKS. */
const MAX_EVERY_WEEKS = 4;
const REPLACED_FIELDS = new Set(['id', 'weekdays', 'until']);

/** Une écriture refusée sous ses champs : rien n'est écrit (422). */
class Refusal extends Error {
    constructor(readonly violations: Violation[]) {
        super('Refusée.');
    }
}

/** La journée a changé ailleurs, ou la récurrence n'est plus ce que le geste croyait : rien n'est écrit (409). */
class Stale extends Error {}

export class FakeDayServer {
    /** Chaque écriture acceptée, dans l'ordre. */
    readonly writes: Request[] = [];
    private readonly days = new Map<string, StoredDay>();
    /**
     * Chaque journée rendue, par version : ce que la base a contenu, et qu'un écran a le droit
     * d'afficher. Une version peut s'être lue plusieurs fois, avec les mêmes blocs : ce qui change
     * sans elle — une récurrence créée ailleurs, un jour envoyé — n'est pas dans la grille.
     */
    private readonly history = new Map<string, Map<number, string[]>>();
    private readonly recurrences = new Map<string, StoredRecurrence>();
    /** Les fois détachées ou retenues, par « identifiant date ». */
    private readonly skips = new Map<string, Skip>();
    /** L'empreinte de chaque ensemble de fois prévues déjà vu : jamais 0, et jamais deux fois la même. */
    private readonly prints = new Map<string, number>();
    private created = 0;
    /** Jira en panne : un envoi pose ce qu'il montre, sans rien écrire dans Jira (setJiraDown). */
    private jiraDown = false;
    /** Le temps de `beforeClashRule` : une récurrence qu'on crée peut en croiser une autre. */
    private clashesAllowed = false;
    /** Ceux des réglages : rien ne se pose les autres jours, et une récurrence ne s'y choisit pas. */
    private workingDays: readonly number[] = WORKING_DAYS;

    /**
     * @param today aujourd'hui, pour le compte des jours déjà traités d'une récurrence
     *              (posedThrough) ; sans lui, le jour du geste. Les jours d'après prévoient
     *              leurs récurrences ; sans lui, aucun n'en prévoit.
     */
    constructor(private today: string | null = null) {}

    /** L'horloge avance, ou se règle sur celle de l'écran une fois les récurrences semées. */
    setToday(today: string): void {
        this.today = today;
    }

    /**
     * Un jour décoché ou coché dans les réglages, depuis un autre onglet : la journée rendue le
     * dit, comme la pose et le refus d'une récurrence.
     */
    setWorkingDays(days: readonly number[]): void {
        this.workingDays = days;
    }

    /**
     * Ce que `seed` crée passe sans le refus d'un créneau pris : des récurrences nées avant ce
     * refus, qui se croisent encore en base. Le serveur les garde telles quelles ; la plus
     * ancienne se pose, l'autre cède le quart d'heure (forecast, poseOn).
     */
    beforeClashRule(seed: () => void): void {
        this.clashesAllowed = true;
        try {
            seed();
        } finally {
            this.clashesAllowed = false;
        }
    }

    api(transport: Transport = (_, handle) => Promise.resolve(handle())): DayApi {
        return {
            read: (date) => transport({ kind: 'read', date }, () => this.read(date)),
            changeSlots: (date, version, changes, untils, restores, detaches) =>
                transport({ kind: 'changeSlots', date }, () =>
                    this.changeSlots(date, version, changes, untils, restores, detaches),
                ),
            saveRecurrence: (date, version, changes, rule, replaces, follows = null) =>
                transport({ kind: 'saveRecurrence', date }, () =>
                    this.saveRecurrence(date, version, changes, rule, replaces, follows),
                ),
            setObjective: (date, version, objective) =>
                transport({ kind: 'setObjective', date }, () => this.setObjective(date, version, objective)),
            send: (date, version) => transport({ kind: 'send', date }, () => this.send(date, version)),
        };
    }

    /** La journée telle qu'un écran la reçoit : ses saisies, et un jour à venir, ses fois prévues. */
    read(date: string): DayState {
        const view = this.view(date, true);
        const versions = this.history.get(date) ?? new Map<number, string[]>();
        const json = JSON.stringify(view);
        versions.set(view.version, [...(versions.get(view.version) ?? []).filter((served) => served !== json), json]);
        this.history.set(date, versions);

        return readDay(view);
    }

    /**
     * Ses seules saisies, telles que la base les garde : sans les fois prévues, que rien n'écrit.
     * Lues comme l'API les rend : sans le lien d'une récurrence qui ne va plus jusqu'à ce jour,
     * que `links` montre encore.
     */
    saved(date: string): DayState {
        return readDay(this.view(date, false));
    }

    /** La journée telle qu'elle a été lue en dernier à une version, ou undefined si elle ne l'a jamais eue. */
    at(date: string, version: number): DayState | undefined {
        return this.servedAt(date, version).at(-1);
    }

    /** Chaque lecture de la journée rendue à cette version, de la première à la dernière. */
    servedAt(date: string, version: number): DayState[] {
        const stored =
            this.history.get(date)?.get(version) ??
            (version === 0 ? [JSON.stringify(this.view(date, false, emptyDay()))] : []);

        return stored.map((json) => readDay(JSON.parse(json)));
    }

    /** Une récurrence telle que la base la garde, ou undefined si elle n'existe pas. */
    recurrence(id: string): RecurrenceRecord | undefined {
        const stored = this.recurrences.get(id);

        return stored === undefined
            ? undefined
            : {
                  id,
                  start: format(stored.start),
                  end: format(stored.end),
                  ...stored.rhythm,
                  firstDay: stored.firstDay,
                  until: stored.until,
                  content: stored.content,
                  ...(this.skippedOf(id).length === 0 ? {} : { skipped: this.skippedOf(id) }),
              };
    }

    /**
     * Ses fois détachées ou effacées après aujourd'hui, dans l'ordre
     * (RecurrenceRepository::skippedAfter) : elles ne prennent plus son créneau. Celles qu'un
     * objectif à 0h00 retient le gardent.
     */
    skippedOf(id: string): string[] {
        return [...this.skips.values()]
            .filter((skip) => skip.id === id && !skip.held && (this.today === null || skip.date > this.today))
            .map((skip) => skip.date)
            .sort();
    }

    /** Toutes les récurrences, dans l'ordre de leur création. */
    allRecurrences(): RecurrenceRecord[] {
        return [...this.recurrences.keys()].flatMap((id) => {
            const record = this.recurrence(id);

            return record === undefined ? [] : [record];
        });
    }

    /** Sa fois de ce jour-là a été détachée, ou retenue par un objectif à 0h00 : rien ne l'y repose ni ne l'y prévoit. */
    isSkipped(id: string, date: string): boolean {
        return this.skips.has(skipKey(id, date));
    }

    /** Sa fois de ce jour-là est retenue par un objectif à 0h00 : le retour à un objectif la rendra. */
    isHeld(id: string, date: string): boolean {
        return this.skips.get(skipKey(id, date))?.held === true;
    }

    /** Les fois détachées ou retenues, « identifiant date », dans l'ordre. */
    allSkips(): string[] {
        return [...this.skips.keys()].sort();
    }

    /**
     * Le lien de chaque quart d'heure saisi, tel que la base le garde — même celui d'une
     * récurrence qui ne va plus jusqu'à ce jour, que la journée lue ne montre plus.
     */
    links(date: string): Map<number, string | null> {
        return new Map(
            [...(this.days.get(date)?.quarters ?? [])]
                .sort(([a], [b]) => a - b)
                .map(([quarter, slot]) => [quarter, slot.recurrence]),
        );
    }

    /** La journée a une ligne en base. */
    exists(date: string): boolean {
        return this.days.has(date);
    }

    /**
     * Le jour venu (RecurrencePoser) : chaque récurrence se pose sur les jours pas encore
     * traités jusqu'à `today`, où elle tombe, travaillés, et dont la fois n'a pas été
     * détachée — sur les seuls créneaux libres : ce qui est déjà saisi l'emporte.
     */
    pose(today: string): void {
        for (const recurrence of this.recurrences.values()) {
            const last = recurrence.until === null || recurrence.until > today ? today : recurrence.until;
            let date =
                recurrence.posedThrough < recurrence.firstDay ? recurrence.firstDay : nextDay(recurrence.posedThrough);
            for (; date <= last; date = nextDay(date)) {
                this.poseOn(recurrence, date);
            }
            if (today > recurrence.posedThrough) {
                recurrence.posedThrough = today;
            }
        }
    }

    /**
     * Un geste de la grille (DayWriter::changeSlots).
     *
     * @param untils   les fins qu'annuler et rétablir rendent aux récurrences
     * @param restores annuler : une fois seulement prévue qu'il réécrit lui cède au lieu de se détacher
     * @param detaches rétablir : les récurrences dont l'annulation a rendu la fois à sa série, détachées de nouveau
     */
    changeSlots(
        date: string,
        version: number,
        changes: readonly SlotChange[],
        untils: readonly UntilRewind[] = [],
        restores = false,
        detaches: readonly string[] = [],
    ): WriteResult {
        const violations = [
            ...validate(changes, untils.length > 0),
            ...this.validateLinks(changes),
            ...validateRewinds(untils),
            ...(detaches.every((id) => isUuid(id)) ? [] : [{ field: 'detaches', message: 'Récurrence inconnue.' }]),
        ];
        if (violations.length > 0) {
            return { status: 'invalid', violations };
        }
        if (this.versionOf(date) !== version) {
            return { status: 'stale', day: this.read(date) };
        }
        const planned = this.forecast(date, this.days.get(date));
        if (
            !this.days.has(date) &&
            untils.length === 0 &&
            changes.every(
                (change) => change.kind === 'empty' && quartersOf(change).every((quarter) => !planned.has(quarter)),
            )
        ) {
            // Effacer sur un jour jamais saisi, sans y toucher une fois prévue, ne change rien.
            return { status: 'saved', day: this.read(date) };
        }
        // Annuler ne rend qu'une fin que la récurrence a encore, jamais d'avant la veille
        // de son premier jour : tout se vérifie avant d'écrire, comme dans une transaction.
        const ends = new Map<string, string | null>();
        for (const rewind of untils) {
            const recurrence = this.recurrences.get(rewind.recurrence);
            const current = ends.has(rewind.recurrence) ? ends.get(rewind.recurrence) : recurrence?.until;
            if (
                recurrence === undefined ||
                current !== rewind.from ||
                (rewind.to !== null && rewind.to < withdrawnUntil(recurrence))
            ) {
                return { status: 'stale', day: this.read(date) };
            }
            ends.set(rewind.recurrence, rewind.to);
        }
        // Une récurrence déplacée ne revit pas à ses deux places : le geste se refuse, et dit
        // lequel faire d'abord (DayWriter::assertMoved).
        for (const rewind of untils) {
            const refused = isLonger(rewind.to, rewind.from) ? this.moved(rewind.recurrence, ends) : null;
            if (refused !== null) {
                return { status: 'invalid', violations: [{ field: 'recurrences', message: refused }] };
            }
        }
        // Une fin rendue qui la prolonge ne la ramène pas sur un créneau qu'une autre a pris
        // depuis : jamais deux récurrences sur un créneau. Le geste se refuse comme sur des
        // créneaux changés ailleurs, sans rien écrire.
        for (const rewind of untils) {
            if (isLonger(rewind.to, rewind.from) && this.clash(this.stored(rewind.recurrence), ends) !== null) {
                return { status: 'stale', day: this.read(date) };
            }
        }
        // Annuler ne relie un quart d'heure qu'à une récurrence qui tombe ce jour-là.
        for (const change of changes) {
            const recurrence = change.recurrence === undefined ? undefined : this.recurrences.get(change.recurrence);
            if (
                recurrence !== undefined &&
                !fallsOn(
                    {
                        ...recurrence,
                        until: ends.has(recurrence.id) ? (ends.get(recurrence.id) ?? null) : recurrence.until,
                    },
                    date,
                )
            ) {
                return { status: 'stale', day: this.read(date) };
            }
        }
        // Une fois sautée a libéré son créneau, qu'une autre a pu prendre depuis : annuler ne l'y
        // ramène pas, après aujourd'hui (DayWriter::assertRelinkFree).
        if (this.relinkTakes(date, changes, ends)) {
            return { status: 'stale', day: this.read(date) };
        }
        // Rétablir ne détache de nouveau qu'une fois que la journée ne porte pas
        // (DayWriter::detachAgain).
        const stored = this.days.get(date);
        const withholds =
            (stored !== undefined && isDeclaredOff(stored)) || !this.workingDays.includes(isoWeekday(date));
        for (const id of detaches) {
            const recurrence = this.recurrences.get(id);
            if (
                !withholds ||
                recurrence === undefined ||
                (stored !== undefined && occurrenceOf(stored, id).length > 0) ||
                (!ends.has(id) && !fallsOn(recurrence, date))
            ) {
                return { status: 'stale', day: this.read(date) };
            }
        }

        // Un jour jamais saisi ne naît que de ce que le geste y saisit : effacer, ou rendre une
        // fois à sa prévision, ne le crée pas.
        return this.write(
            { kind: 'changeSlots', date },
            (written, before) => {
                for (const [id, until] of ends) {
                    this.endOn(id, until, date);
                }
                const quarters = new Map<number, Stored | null>();
                const links = new Map<number, string>();
                for (const change of changes) {
                    const content = contentOf(change);
                    for (const quarter of quartersOf(change)) {
                        quarters.set(quarter, content);
                        if (content !== null && change.recurrence !== undefined) {
                            links.set(quarter, change.recurrence);
                        }
                    }
                }
                // Jamais sur une journée mise à 0h00, ni sur un jour à venir non travaillé : la fois
                // revient à sa série sans s'y écrire (DayWriter::returned).
                const returned = this.returned(written, date, links);
                const kept = new Map(links);
                for (const quarter of returned.keys()) {
                    quarters.set(quarter, null);
                    kept.delete(quarter);
                }
                this.changeOccurrences(written, date, quarters, kept, before, restores);
                for (const id of new Set(returned.values())) {
                    if (isDeclaredOff(written)) {
                        this.skips.set(skipKey(id, date), { id, date, held: true });
                    } else {
                        this.skips.delete(skipKey(id, date));
                    }
                }
                // Menée ailleurs par le geste refait, elle n'a plus rien à sauter ce jour-là.
                for (const id of new Set(detaches)) {
                    if (fallsOn(this.stored(id), date)) {
                        this.skips.set(skipKey(id, date), { id, date, held: false });
                    } else {
                        this.skips.delete(skipKey(id, date));
                    }
                }
                // Une fin rendue qui l'arrête avant ce jour sans qu'une autre y prenne sa place —
                // rétablir un effacement ou un arrêt avec les suivantes, annuler sa création — n'y
                // laisse pas de saut, comme le geste d'origine. Rétablir une coupe, qui relie, garde
                // le sien.
                if (links.size === 0) {
                    for (const id of ends.keys()) {
                        if (!reaches(this.stored(id), date)) {
                            this.skips.delete(skipKey(id, date));
                        }
                    }
                }
            },
            untils.length > 0,
        );
    }

    /**
     * « Enregistrer » dans la fenêtre, la case « Récurrence » cochée — `rule` — ou décochée —
     * null —, sur le bloc que portait `replaces`, telle que la fenêtre l'a vue
     * (DayWriter::saveRecurrence). Une récurrence coupée qu'on colle nomme celle dont elle vient
     * (`follows`).
     */
    saveRecurrence(
        date: string,
        version: number,
        changes: readonly SlotChange[],
        rule: RecurrenceRule | null,
        replaces: SeenRecurrence | null,
        follows: string | null = null,
    ): RecurrenceResult {
        const violations = [...validate(changes), ...validateRule(rule), ...validateReplaced(replaces)];
        if (follows !== null && !isUuid(follows)) {
            violations.push({ field: 'follows', message: 'Récurrence inconnue.' });
        }
        if (changes.some((change) => change.recurrence !== undefined)) {
            violations.push({
                field: 'unlinked',
                message: "Un créneau de la fenêtre ne porte pas de récurrence : c'est elle qui le pose.",
            });
        }
        if (violations.length > 0) {
            return { status: 'invalid', violations };
        }
        // Le rythme se juge avant la version, hors de la transaction. Un jour décoché depuis
        // reste à la récurrence remplacée qui l'avait déjà.
        if (rule !== null) {
            const kept = replaces === null ? [] : (this.recurrences.get(replaces.id)?.rhythm.weekdays ?? []);
            const refused = checkRule(rule, date, this.workingDays, kept, this.today ?? date);
            if (refused !== null) {
                return { status: 'invalid', violations: [refused] };
            }
        }
        const untils: UntilStep[] = [];
        try {
            // Une journée jamais saisie ne naît que de ce que la fenêtre y écrit : une fois prévue
            // effacée avec les suivantes ne la crée pas.
            const result = this.writeOrRefuse(
                { kind: 'saveRecurrence', date },
                version,
                (day, planned) => {
                    this.recurrenceGesture(day, date, changes, rule, replaces, untils, planned, follows);
                },
                false,
            );
            if (result.status !== 'saved') {
                return result;
            }

            return { status: 'saved', day: result.day, untils };
        } catch (error) {
            if (error instanceof Refusal) {
                return { status: 'invalid', violations: error.violations };
            }
            throw error;
        }
    }

    /**
     * L'objectif du jour (DayWriter::setObjective). Mise à 0h00, la journée perd les blocs que
     * ses récurrences y ont posés, et chacune la retient ; revenue à un objectif, elle les
     * retrouve.
     */
    setObjective(date: string, version: number, objective: number): WriteResult {
        if (!Number.isInteger(objective) || objective < 0 || objective > DAY_END - FIRST || objective % 15 !== 0) {
            return { status: 'invalid', violations: [{ field: 'objective', message: 'Objectif invalide.' }] };
        }
        if (this.versionOf(date) !== version) {
            return { status: 'stale', day: this.read(date) };
        }

        return this.write({ kind: 'setObjective', date }, (written, planned) => {
            const wasOff = isDeclaredOff(written);
            written.objective = objective;
            if (!wasOff && isDeclaredOff(written)) {
                this.hold(written, date, planned);
            } else if (wasOff && !isDeclaredOff(written)) {
                this.release(written, date);
            }
        });
    }

    /**
     * Un envoi : celui de la version que l'écran a vue, et seulement s'il y a un ticket. Un jour
     * à venir reçoit d'abord ses fois prévues pour de bon, liées : ce qui part est ce que la
     * journée montre (DaySender::begin).
     */
    send(date: string, version: number): SendResult {
        if (this.versionOf(date) !== version) {
            return { status: 'stale', day: this.read(date) };
        }
        const planned = this.forecast(date, this.days.get(date));
        const shown = [
            ...(this.days.get(date)?.quarters.values() ?? []),
            ...[...planned.values()].map((id) => ({ content: this.stored(id).content })),
        ];
        if (!shown.some((slot) => slot.content.kind === 'work')) {
            const emptied = this.days.get(date);
            if (emptied?.inJira !== true || this.jiraDown) {
                return { status: 'nothing', day: this.read(date) };
            }
            // Vidée depuis son envoi : Jira se vide avec elle, et son envoi, qui n'a plus rien à
            // dire, disparaît. Elle redevient un jour comme un autre (SendClosure::reopen).
            delete emptied.sentVersion;
            delete emptied.failedVersion;
            emptied.inJira = false;
            emptied.settled = false;
            if (this.reopen(emptied, date)) {
                emptied.version += 1;
            }
            this.writes.push({ kind: 'send', date });

            return { status: 'done', day: this.read(date) };
        }
        if (planned.size > 0) {
            this.write({ kind: 'pose', date }, (written, before) => {
                for (const [quarter, id] of before) {
                    written.quarters.set(quarter, { content: this.stored(id).content, recurrence: id });
                }
            });
        }
        const day = this.days.get(date);
        if (day !== undefined) {
            day.settled = true;
            // Jira en panne, rien n'est écrit : l'envoi garde ce qu'il a posé, et Jira n'a rien de plus.
            if (this.jiraDown) {
                day.failedVersion = day.version;
            } else {
                day.inJira = true;
                day.sentVersion = day.version;
                delete day.failedVersion;
            }
        }
        this.writes.push({ kind: 'send', date });

        return { status: 'done', day: this.read(date) };
    }

    /** Jira tombe en panne, ou revient : un envoi en panne pose ce qu'il montre, sans rien écrire dans Jira. */
    setJiraDown(down: boolean): void {
        this.jiraDown = down;
    }

    /**
     * Un envoi en reste, qui a encore quelque chose à dire : la journée a des tickets, ou Jira des
     * heures d'elle (DaySendRepository::closesToRecurrences).
     */
    private closes(day: StoredDay | undefined): boolean {
        return (
            day?.settled === true &&
            (day.inJira === true || [...day.quarters.values()].some((slot) => slot.content.kind === 'work'))
        );
    }

    /**
     * Les jours à venir qu'un envoi ferme, dans l'ordre (DaySendRepository::closedAfter) : aucune
     * récurrence n'y prend plus de créneau.
     */
    private closedAhead(): string[] {
        return [...this.days]
            .filter(([date, day]) => this.isAhead(date) && this.closes(day))
            .map(([date]) => date)
            .sort();
    }

    /**
     * Un jour à venir qu'aucun envoi ne ferme plus rend à ses récurrences ce que ses envois y
     * avaient posé (SendClosure::reopen) : ce qu'elles y attendent encore redevient prévu ; ce
     * qu'une récurrence arrêtée avant lui y avait posé reste, sans lien. Puis une récurrence qui
     * voudrait le créneau d'une autre y cède sa fois (SendClosure::yieldDisputed) : celle dont le
     * bloc y était écrit garde le sien, sinon la plus ancienne. Le veut celle qui y tombe et dont la
     * fois n'y est pas effacée, ou effacée par le geste même qui le rouvre — annuler la ramène.
     * Rend vrai si sa grille a changé.
     *
     * @param before les récurrences qui y avaient un bloc avant le geste ; sans geste, celles d'à présent
     */
    private reopen(day: StoredDay, date: string, before?: ReadonlySet<string>): boolean {
        if (!this.isAhead(date) || this.closes(day)) {
            return false;
        }
        // Celles dont un bloc y est écrit, avant que ce que l'envoi y a posé redevienne prévu : elles
        // gardent leur créneau.
        const written = new Set(
            [...day.quarters.values()].flatMap((slot) => (slot.recurrence === null ? [] : [slot.recurrence])),
        );
        let changed = false;
        for (const [quarter, slot] of [...day.quarters]) {
            const recurrence = slot.recurrence === null ? undefined : this.recurrences.get(slot.recurrence);
            if (recurrence === undefined || date <= recurrence.posedThrough) {
                continue;
            }
            changed = true;
            if (this.awaits(recurrence, day, date) && !this.skips.has(skipKey(recurrence.id, date))) {
                day.quarters.delete(quarter);
            } else {
                day.quarters.set(quarter, { content: slot.content, recurrence: null });
            }
        }
        const earlier = before ?? written;
        const wrote = (recurrence: StoredRecurrence): boolean =>
            written.has(recurrence.id) || earlier.has(recurrence.id);
        const wanting = [...this.recurrences.values()]
            .filter((recurrence) => fallsOn(recurrence, date))
            .filter(
                (recurrence) =>
                    earlier.has(recurrence.id) || this.skips.get(skipKey(recurrence.id, date))?.held !== false,
            )
            .sort((a, b) => Number(!wrote(a)) - Number(!wrote(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const kept: StoredRecurrence[] = [];
        for (const recurrence of wanting) {
            if (
                !wrote(recurrence) &&
                kept.some((other) => recurrence.start < other.end && other.start < recurrence.end)
            ) {
                this.skips.set(skipKey(recurrence.id, date), { id: recurrence.id, date, held: false });
            } else {
                kept.push(recurrence);
            }
        }

        return changed;
    }

    /**
     * Ce que fait la fenêtre (DayWriter::saveRecurrence) : créer, couper, changer la fin,
     * arrêter. Un refus lève avant d'avoir rien changé. Un jour à venir, la fenêtre a vu ses
     * fois prévues comme ses saisies.
     *
     * @param follows à la création, la récurrence coupée dont vient celle qu'on colle
     */
    private recurrenceGesture(
        day: StoredDay,
        date: string,
        changes: readonly SlotChange[],
        rule: RecurrenceRule | null,
        replaces: SeenRecurrence | null,
        untils: UntilStep[],
        planned: ReadonlyMap<number, string>,
        follows: string | null,
    ): void {
        const old = replaces === null ? null : this.recurrences.get(replaces.id);
        if (old === undefined) {
            throw new Stale();
        }
        // Changée ailleurs depuis que la fenêtre l'a vue, arrêtée avant ce jour, elle ne le
        // concerne plus.
        if (
            old !== null &&
            ((replaces !== null && !stillSeen(old, replaces)) ||
                (old.until !== null && old.until < date) ||
                this.shownOccurrence(day, planned, old.id).length === 0)
        ) {
            throw new Stale();
        }
        const quarters = new Map<number, Stored | null>();
        for (const change of changes) {
            for (const quarter of quartersOf(change)) {
                quarters.set(quarter, contentOf(change));
            }
        }
        const content = oneContent(quarters);
        const starts = [...quarters.keys()].sort((a, b) => a - b);
        if (old === null) {
            const first = starts[0];
            const last = starts.at(-1);
            if (
                rule === null ||
                content === null ||
                first === undefined ||
                last === undefined ||
                last - first !== (starts.length - 1) * 15
            ) {
                throw new Refusal([{ field: 'changes', message: NOT_ONE_RANGE }]);
            }
            // Collée, elle continue la coupée, qui ne va plus jusqu'à ce jour : encore là, sa coupe a
            // été annulée, et le collage se refuse (DayWriter::followed). Au même rythme, elle en
            // reprend les fois sautées après ce jour (DayWriter::carriedFrom). Inconnue, rien.
            const source = follows === null ? undefined : this.recurrences.get(follows);
            if (source !== undefined && reaches(source, date)) {
                throw new Refusal([{ field: 'follows', message: CUT_UNDONE }]);
            }
            // Collée déjà ailleurs, et encore là sur la période de la nouvelle (DayWriter::followed).
            const pasted = (source === undefined ? [] : this.liveFollowers(source.id)).find(
                (live) => (rule.until === null || rule.until >= live.firstDay) && reaches(live, date),
            );
            if (pasted !== undefined) {
                throw new Refusal([
                    {
                        field: 'follows',
                        message: `Cette récurrence a déjà été collée le ${dayLabel(pasted.firstDay)}. Rien n'est collé.`,
                    },
                ]);
            }
            const created = this.create(content, first, last + 15, rule, date);
            if (source !== undefined && sameRhythm(created.rhythm, source.rhythm)) {
                this.carry(source.id, created.id, date);
            }
            this.assertFree(created);
            if (source !== undefined && source.until !== null) {
                created.follows = { id: source.id, cutOn: nextDay(source.until) };
            }
            untils.push({ recurrence: created.id, before: withdrawnUntil(created), after: created.until });
            this.changeOccurrences(day, date, quarters, linksIfFalls(created, date, starts), planned);

            return;
        }
        if (this.today !== null && date < this.today) {
            this.changePast(day, date, this.today, old, quarters, content, rule, untils);

            return;
        }
        // Les autres morceaux de cette fois, posés ou prévus, suivent le bloc modifié.
        const occurrence = this.shownOccurrence(day, planned, old.id).filter((quarter) => !quarters.has(quarter));
        const before = old.until;
        const cut = date <= old.firstDay ? withdrawnUntil(old) : previousDay(date);
        // Arrêtée à partir de cette fois — le bloc reste, sans elle, ou s'efface avec elle.
        if (rule === null) {
            this.endOn(old.id, cut, date);
            untils.push({ recurrence: old.id, before, after: old.until });
            const all = new Map(quarters);
            for (const quarter of occurrence) {
                all.set(quarter, this.shownSlot(day, planned, quarter)?.content ?? null);
            }
            this.changeOccurrences(day, date, all, new Map(), planned);
            // Elle ne va plus jusqu'à ce jour : rien n'est à y sauter.
            this.skips.delete(skipKey(old.id, date));

            return;
        }
        // Ses heures à partir de cette fois : les mêmes, ou allongées ou raccourcies par la grille.
        const hours = hoursAfter(old, quarters, content);
        if (hours === null) {
            throw new Refusal([{ field: 'changes', message: NOT_ONE_RANGE }]);
        }
        const [start, end] = hours;
        const kept = content ?? old.content;
        if (
            start === old.start &&
            end === old.end &&
            sameStored(kept, old.content) &&
            sameRhythm(rhythmOf(rule), old.rhythm)
        ) {
            if (rule.until !== before) {
                this.endOn(old.id, rule.until, date);
                this.assertFreeLonger(old, before);
                untils.push({ recurrence: old.id, before, after: old.until });
            }
            this.changeOccurrences(day, date, quarters, new Map(starts.map((quarter) => [quarter, old.id])), planned);

            return;
        }
        this.endOn(old.id, cut, date);
        untils.push({ recurrence: old.id, before, after: old.until });
        const created = this.create(kept, start, end, rule, date);
        this.assertMovedLonger(old, before, created);
        // Une collée remplacée le jour même de son collage passe la main (DayWriter::saveRecurrence).
        if (date <= old.firstDay && old.follows !== null && old.until !== null) {
            created.follows = { id: old.id, cutOn: nextDay(old.until) };
        }
        // Au même rythme, la nouvelle reprend la suite de l'ancienne : ses fois sautées après ce
        // jour, détachées ou retenues, le restent. Annuler la coupe les laisse à la nouvelle, retirée.
        if (sameRhythm(created.rhythm, old.rhythm)) {
            this.carry(old.id, created.id, date);
        }
        this.assertFree(created);
        untils.push({ recurrence: created.id, before: withdrawnUntil(created), after: created.until });
        const all = new Map(quarters);
        for (const quarter of occurrence) {
            all.set(quarter, kept);
        }
        // Raccourcie, ce qu'elle quitte ce jour-là s'efface : seul ce qu'elle garde s'y relie.
        const linked = [...all].filter(([, cell]) => cell !== null).map(([quarter]) => quarter);
        this.changeOccurrences(day, date, all, linksIfFalls(created, date, linked), planned);
    }

    /**
     * Sur un jour passé (DayWriter::changePast) : le rythme ou la fin changent à partir de
     * demain, ce qu'on change au bloc ne vaut que pour cette fois, et décocher l'arrête
     * après aujourd'hui en détachant le bloc.
     */
    private changePast(
        day: StoredDay,
        date: string,
        today: string,
        old: StoredRecurrence,
        quarters: ReadonlyMap<number, Stored | null>,
        content: Stored | null,
        rule: RecurrenceRule | null,
        untils: UntilStep[],
    ): void {
        const before = old.until;
        const last = before === null || before > today ? today : before;
        if (
            rule !== null &&
            (content === null || [...quarters.keys()].some((quarter) => quarter < old.start || quarter >= old.end))
        ) {
            throw new Refusal([{ field: 'changes', message: NOT_ONE_RANGE }]);
        }
        if (rule === null || !sameRhythm(rhythmOf(rule), old.rhythm)) {
            const tomorrow = nextDay(today);
            if (rule !== null && rule.until !== null && rule.until < tomorrow) {
                throw new Refusal([{ field: 'recurrence.until', message: untilRefusal(tomorrow, today) }]);
            }
            if (last !== before) {
                this.endOn(old.id, last, date);
                untils.push({ recurrence: old.id, before, after: old.until });
            }
            if (rule !== null) {
                const created = this.create(old.content, old.start, old.end, rule, tomorrow);
                created.posedThrough = today;
                this.assertMovedLonger(old, before, created);
                this.assertFree(created);
                untils.push({ recurrence: created.id, before: withdrawnUntil(created), after: created.until });
            }
        } else if (rule.until !== before) {
            if (rule.until !== null && rule.until < today) {
                throw new Refusal([{ field: 'recurrence.until', message: untilRefusal(today, today) }]);
            }
            this.endOn(old.id, rule.until, date);
            this.assertFreeLonger(old, before);
            untils.push({ recurrence: old.id, before, after: old.until });
        }
        const keeps = rule !== null && content !== null && sameStored(content, old.content);
        // Un jour passé ne prévoit rien.
        this.changeOccurrences(
            day,
            date,
            quarters,
            keeps ? new Map([...quarters.keys()].map((quarter) => [quarter, old.id])) : new Map(),
            new Map(),
        );
    }

    private create(content: Stored, start: number, end: number, rule: RecurrenceRule, date: string): StoredRecurrence {
        this.created += 1;
        const recurrence: StoredRecurrence = {
            id: `01900000-0000-7000-8000-${String(this.created).padStart(12, '0')}`,
            content,
            start,
            end,
            rhythm: rhythmOf(rule),
            firstDay: date,
            until: rule.until,
            posedThrough: this.today !== null && this.today > date ? this.today : date,
            follows: null,
        };
        this.recurrences.set(recurrence.id, recurrence);

        return recurrence;
    }

    /**
     * Jamais deux récurrences sur un créneau (DayWriter::assertFree) : celle qu'on crée, qu'on
     * coupe ou qu'on prolonge se refuse si une autre y revient un même jour, jugé sur toutes
     * les récurrences telles que le geste les laisse. Le refus lève : write défait le reste.
     */
    private assertFree(candidate: StoredRecurrence): void {
        const clash = this.clashesAllowed ? null : this.clash(candidate);
        if (clash !== null) {
            throw new Refusal([{ field: 'recurrence.rhythm', message: takenRefusal(this.stored(clash)) }]);
        }
    }

    /**
     * Sa fin changée en place : seule une fin repoussée peut la mener sur un créneau pris, ou
     * au-delà du collage d'une coupée (DayWriter::assertMovedLonger).
     */
    private assertFreeLonger(recurrence: StoredRecurrence, before: string | null): void {
        if (!isLonger(recurrence.until, before)) {
            return;
        }
        this.assertMovedLonger(recurrence, before);
        this.assertFree(recurrence);
    }

    /**
     * Une coupée ne va pas, par sa fenêtre, au-delà du premier jour d'une collée encore là
     * (DayWriter::assertMovedLonger) : ni par sa fin repoussée, ni par la nouvelle récurrence
     * (`reaching`) qui la remplace quand la fenêtre change autre chose.
     */
    private assertMovedLonger(
        recurrence: StoredRecurrence,
        before: string | null,
        reaching: StoredRecurrence = recurrence,
    ): void {
        if (!isLonger(reaching.until, before)) {
            return;
        }
        // Une collée finie avant demain ne gêne pas : les fois passées ne changent jamais.
        const tomorrow = nextDay(this.today ?? recurrence.firstDay);
        const follower = this.liveFollowers(recurrence.id).find(
            (live) =>
                (reaching.until === null || reaching.until >= live.firstDay) &&
                (live.until === null || live.until >= tomorrow),
        );
        if (follower !== undefined) {
            throw new Refusal([
                { field: 'recurrence.until', message: `Annulez d'abord le collage du ${dayLabel(follower.firstDay)}.` },
            ]);
        }
    }

    /**
     * L'autre récurrence qui prend son créneau le plus tôt après aujourd'hui — la plus ancienne,
     * à date égale —, ou null (RecurrenceClash::earliest) : un jour déjà venu ne reçoit plus rien
     * d'aucune, ni un jour à venir déjà envoyé. `ends` sont les fins qu'un geste leur rend avant
     * d'écrire.
     */
    private clash(candidate: StoredRecurrence, ends: ReadonlyMap<string, string | null> = new Map()): string | null {
        const timed = (recurrence: StoredRecurrence): Recurrence => ({
            ...recurrence,
            until: ends.has(recurrence.id) ? (ends.get(recurrence.id) ?? null) : recurrence.until,
            // Une fois détachée ou effacée ne prend plus son créneau.
            skipped: this.skippedOf(recurrence.id),
        });
        const others = [...this.recurrences.values()].filter((other) => other.id !== candidate.id).map(timed);
        const schedule: TimedSchedule = timed(candidate);

        return earliestClash(schedule, others, this.today, this.closedAhead())?.recurrence.id ?? null;
    }

    /**
     * Un quart d'heure relié à une récurrence dont la fois de ce jour à venir est effacée ou
     * détachée, quand une autre en a pris le créneau depuis (RecurrenceClash::takenWhileSkipped) :
     * elle y tombe, avec les fins que le geste rend, sa fois n'est pas sautée, leurs heures se
     * croisent, et rien ne les croisait jusque-là — deux récurrences nées avant ce refus, qui se
     * croisaient déjà, restent telles quelles.
     */
    private relinkTakes(
        date: string,
        changes: readonly SlotChange[],
        ends: ReadonlyMap<string, string | null>,
    ): boolean {
        const today = this.today;
        if (today === null || date <= today) {
            return false;
        }
        const ended = (recurrence: StoredRecurrence): StoredRecurrence => ({
            ...recurrence,
            until: ends.has(recurrence.id) ? (ends.get(recurrence.id) ?? null) : recurrence.until,
        });
        const timed = (recurrence: StoredRecurrence): Recurrence => ({
            ...ended(recurrence),
            skipped: this.skippedOf(recurrence.id),
        });
        const linked = new Set(
            changes.flatMap((change) => (change.recurrence === undefined ? [] : [change.recurrence])),
        );
        const closed = this.closedAhead();

        return [...linked].some((id) => {
            const recurrence = this.recurrences.get(id);
            if (recurrence === undefined || !this.skippedOf(id).includes(date)) {
                return false;
            }

            return [...this.recurrences.values()].some(
                (other) =>
                    other.id !== id &&
                    other.start < recurrence.end &&
                    recurrence.start < other.end &&
                    fallsOn(ended(other), date) &&
                    !this.skippedOf(other.id).includes(date) &&
                    !closed.includes(date) &&
                    firstClash(timed(recurrence), timed(other), today, closed) === null,
            );
        });
    }

    /** Sa fin change ; les jours venus jusque-là sont traités : une fin repoussée ne pose rien après coup. */
    private endOn(id: string, until: string | null, date: string): void {
        const recurrence = this.recurrences.get(id);
        if (recurrence === undefined) {
            throw new Error(`La récurrence ${id} n'existe pas.`);
        }
        if (until !== null && until < withdrawnUntil(recurrence)) {
            throw new Error('Une récurrence ne finit pas avant la veille de son premier jour.');
        }
        recurrence.until = until;
        const today = this.today ?? date;
        if (today > recurrence.posedThrough) {
            recurrence.posedThrough = today;
        }
    }

    /**
     * Les quarts d'heure qu'annuler ou rétablir relient sans les écrire (DayWriter::returned) :
     * mise à 0h00, une journée n'en porte aucune, et sa récurrence la retient ; à venir et non
     * travaillée, elle n'en reçoit aucune, et la retrouvera prévue. Une récurrence qui y a déjà
     * des quarts d'heure y est : ce qu'on lui relie s'écrit.
     */
    private returned(day: StoredDay, date: string, links: ReadonlyMap<number, string>): Map<number, string> {
        const present = new Set([...day.quarters.values()].map((slot) => slot.recurrence));
        const returned = new Map<number, string>();
        for (const [quarter, id] of links) {
            if (
                !present.has(id) &&
                (isDeclaredOff(day) ||
                    (!this.workingDays.includes(isoWeekday(date)) && this.awaits(this.stored(id), day, date)))
            ) {
                returned.set(quarter, id);
            }
        }

        return returned;
    }

    /**
     * Le geste, puis le compte des fois détachées (Day::change, DayWriter::changeOccurrences) :
     * un quart d'heure qu'il prend à une récurrence — posé par elle, ou un jour à venir prévu
     * par elle — sans le lui laisser détache sa fois entière ce jour-là : ses autres quarts
     * d'heure, posés ou prévus, s'écrivent sans son lien, et rien ne l'y repose ni ne l'y
     * prévoit plus. Une fois rendue par annuler redevient la sienne.
     *
     * Un quart d'heure rendu à une récurrence qui l'y prévoit encore n'écrit rien : la fois
     * redevient prévue, et celle qui s'y montrait entre-temps lui cède sans se détacher, si
     * elle passe après elle dans la prévision. Ce
     * qu'annuler réécrit (`restores`) ne détache pas non plus une fois seulement prévue : elle
     * lui cède, comme à une saisie d'avant elle.
     *
     * @param planned  les fois prévues ce jour-là avant le geste, par quart d'heure
     * @param restores le geste rend une journée d'avant (annuler)
     */
    private changeOccurrences(
        day: StoredDay,
        date: string,
        quarters: ReadonlyMap<number, Stored | null>,
        links: ReadonlyMap<number, string>,
        planned: ReadonlyMap<number, string>,
        restores = false,
    ): void {
        const saved = new Map<number, string>();
        for (const [quarter, slot] of day.quarters) {
            if (slot.recurrence !== null) {
                saved.set(quarter, slot.recurrence);
            }
        }
        const changes = new Map(quarters);
        const detached = new Set<string>();
        for (const [quarter, content] of quarters) {
            const link = links.get(quarter);
            const before = saved.get(quarter) ?? planned.get(quarter);
            if (before === undefined || link === before) {
                continue;
            }
            // Elle ne cède à un lien que s'il la précède dans l'ordre de la prévision (celui des
            // identifiants) : sinon c'est elle qui s'y montrerait de nouveau, et rétablir ne
            // referait rien.
            const yields =
                !saved.has(quarter) &&
                ((restores && content !== null) ||
                    (link !== undefined && link < before && this.plans(this.stored(link), day, date)));
            if (!yields) {
                detached.add(before);
            }
        }
        for (const [quarter, id] of [...saved, ...planned]) {
            if (detached.has(id) && !changes.has(quarter)) {
                changes.set(quarter, this.stored(id).content);
            }
        }
        const written = new Map(links);
        for (const [quarter, id] of links) {
            if (saved.get(quarter) !== id && this.plans(this.stored(id), day, date)) {
                changes.set(quarter, null);
                written.delete(quarter);
            }
        }

        // Day::change : un quart d'heure posé qui ne garde pas son lien détache aussi sa fois.
        for (const quarter of changes.keys()) {
            const before = saved.get(quarter);
            if (before !== undefined && written.get(quarter) !== before) {
                detached.add(before);
            }
        }
        for (const [quarter, content] of changes) {
            if (content === null) {
                day.quarters.delete(quarter);
            } else {
                day.quarters.set(quarter, { content, recurrence: written.get(quarter) ?? null });
            }
        }
        for (const [quarter, slot] of day.quarters) {
            if (slot.recurrence !== null && detached.has(slot.recurrence) && !changes.has(quarter)) {
                day.quarters.set(quarter, { content: slot.content, recurrence: null });
            }
        }
        for (const id of detached) {
            if (occurrenceOf(day, id).length === 0) {
                this.skip(id, date, false);
            }
        }
        for (const id of new Set(links.values())) {
            this.skips.delete(skipKey(id, date));
        }
    }

    /**
     * Mise à 0h00 (DayWriter::holdOccurrences), la journée perd les blocs que ses récurrences
     * y ont posés — ceux qui portent leur flèche —, sans toucher à ses autres saisies, et un
     * jour à venir ne prévoit plus rien. Chaque récurrence retirée, posée ou prévue, la
     * retient : revenue à un objectif une fois le jour venu, la journée retrouve ce que le
     * 0h00 lui avait retiré.
     *
     * @param planned les fois prévues avant le 0h00, par quart d'heure
     */
    private hold(day: StoredDay, date: string, planned: ReadonlyMap<number, string>): void {
        const held = new Set<string>(planned.values());
        for (const [quarter, slot] of [...day.quarters]) {
            const recurrence = slot.recurrence === null ? undefined : this.recurrences.get(slot.recurrence);
            if (recurrence !== undefined && (recurrence.until === null || recurrence.until >= date)) {
                day.quarters.delete(quarter);
                held.add(recurrence.id);
            }
        }
        for (const id of held) {
            this.skip(id, date, true);
        }
    }

    /**
     * Revenue à un objectif (DayWriter::releaseOccurrences), la journée retrouve les fois que
     * son passage à 0h00 avait retirées, et seulement elles : prévues de nouveau un jour à
     * venir, reposées sur ses quarts d'heure libres sinon, la première l'emportant.
     */
    private release(day: StoredDay, date: string): void {
        const released = [...this.skips.values()]
            .filter((skip) => skip.held && skip.date === date)
            .map((skip) => skip.id)
            .sort();
        for (const id of released) {
            this.skips.delete(skipKey(id, date));
        }
        for (const id of released) {
            const recurrence = this.stored(id);
            if (!fallsOn(recurrence, date) || this.plans(recurrence, day, date)) {
                continue;
            }
            for (let quarter = recurrence.start; quarter < recurrence.end; quarter += 15) {
                if (!day.quarters.has(quarter)) {
                    day.quarters.set(quarter, { content: recurrence.content, recurrence: id });
                }
            }
        }
    }

    /** Ses fois sautées après ce jour, détachées ou retenues, le sont aussi pour une autre (RecurrenceRepository::carry). */
    private carry(from: string, to: string, after: string): void {
        for (const skip of [...this.skips.values()]) {
            if (skip.id === from && skip.date > after) {
                this.skip(to, skip.date, skip.held);
            }
        }
    }

    /** Cette fois-là est détachée, ou retenue ; une fois déjà détachée le reste. */
    private skip(id: string, date: string, held: boolean): void {
        const key = skipKey(id, date);
        if (!this.skips.has(key)) {
            this.skips.set(key, { id, date, held });
        }
    }

    private poseOn(recurrence: StoredRecurrence, date: string): void {
        if (
            !fallsOn(recurrence, date) ||
            !this.workingDays.includes(isoWeekday(date)) ||
            this.skips.has(skipKey(recurrence.id, date))
        ) {
            return;
        }
        const day = this.days.get(date);
        if (day !== undefined && (isDeclaredOff(day) || this.closes(day))) {
            return;
        }
        const free: number[] = [];
        for (let quarter = recurrence.start; quarter < recurrence.end; quarter += 15) {
            if (day?.quarters.has(quarter) !== true) {
                free.push(quarter);
            }
        }
        if (free.length === 0) {
            return;
        }
        this.write({ kind: 'pose', date }, (written, planned) => {
            this.changeOccurrences(
                written,
                date,
                new Map(free.map((quarter) => [quarter, recurrence.content])),
                new Map(free.map((quarter) => [quarter, recurrence.id])),
                planned,
            );
        });
    }

    /**
     * Les fois prévues ce jour-là, par quart d'heure (RecurrenceForecast::on) : aucune un jour
     * déjà venu ou envoyé, non travaillé, ou mis à 0h00. Chaque récurrence qui y tombe, pas encore
     * traitée ce jour-là et dont la fois n'est pas détachée, prend à son tour, dans l'ordre de
     * leurs identifiants, les quarts d'heure de sa plage que ni les saisies ni une fois placée
     * avant elle n'occupent.
     */
    private forecast(date: string, day: StoredDay | undefined): Map<number, string> {
        const planned = new Map<number, string>();
        if (
            !this.isAhead(date) ||
            !this.workingDays.includes(isoWeekday(date)) ||
            (day !== undefined && (isDeclaredOff(day) || this.closes(day)))
        ) {
            return planned;
        }
        const candidates = [...this.recurrences.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        for (const recurrence of candidates) {
            if (
                !fallsOn(recurrence, date) ||
                date <= recurrence.posedThrough ||
                this.skips.has(skipKey(recurrence.id, date))
            ) {
                continue;
            }
            for (let quarter = recurrence.start; quarter < recurrence.end; quarter += 15) {
                if (day?.quarters.has(quarter) !== true && !planned.has(quarter)) {
                    planned.set(quarter, recurrence.id);
                }
            }
        }

        return planned;
    }

    /**
     * Elle prévoit encore sa fois ce jour-là si rien ne la détache (RecurrenceForecast::plans) :
     * un lien qu'annuler lui rend n'a rien à écrire.
     */
    private plans(recurrence: StoredRecurrence, day: StoredDay, date: string): boolean {
        return this.workingDays.includes(isoWeekday(date)) && this.awaits(recurrence, day, date);
    }

    /**
     * Sa fois ne s'écrit pas encore : elle se prévoit, ou se prévoira si le jour redevient
     * travaillé (RecurrenceForecast::awaits).
     */
    private awaits(recurrence: StoredRecurrence, day: StoredDay, date: string): boolean {
        return (
            this.isAhead(date) &&
            date > recurrence.posedThrough &&
            fallsOn(recurrence, date) &&
            !isDeclaredOff(day) &&
            !this.closes(day)
        );
    }

    /** Après aujourd'hui ; sans horloge, aucun jour ne l'est. */
    private isAhead(date: string): boolean {
        return this.today !== null && date > this.today;
    }

    /**
     * La version qu'un onglet a vue (DayVersion::of) : celle de la ligne, et au-dessus,
     * l'empreinte des récurrences que la journée prévoit, et de celles dont elle ne montre plus la
     * flèche — arrêtées avant ce jour depuis un autre jour.
     */
    private versionOf(date: string, day = this.days.get(date), planned = this.forecast(date, day)): number {
        const row = day?.version ?? 0;
        const ended = [...(day?.quarters.values() ?? [])].flatMap((slot) =>
            slot.recurrence !== null && !reaches(this.stored(slot.recurrence), date) ? [slot.recurrence] : [],
        );
        if (planned.size === 0 && ended.length === 0) {
            return row;
        }
        let ids = [...new Set(planned.values())].sort().join(' ');
        if (ended.length > 0) {
            ids += ` / ${[...new Set(ended)].sort().join(' ')}`;
        }
        const print = this.prints.get(ids) ?? this.prints.size + 1;
        this.prints.set(ids, print);

        return print * ROW_SPAN + row;
    }

    /** Ce que la journée montre de ce quart d'heure : sa saisie, ou sa fois prévue. */
    private shownSlot(day: StoredDay, planned: ReadonlyMap<number, string>, quarter: number): Slot | undefined {
        const saved = day.quarters.get(quarter);
        const id = planned.get(quarter);

        return saved ?? (id === undefined ? undefined : { content: this.stored(id).content, recurrence: id });
    }

    /** Les quarts d'heure de sa fois ce jour-là, posés ou prévus. */
    private shownOccurrence(day: StoredDay, planned: ReadonlyMap<number, string>, id: string): number[] {
        const quarters: number[] = [];
        for (let quarter = FIRST; quarter < DAY_END; quarter += 15) {
            if (this.shownSlot(day, planned, quarter)?.recurrence === id) {
                quarters.push(quarter);
            }
        }

        return quarters;
    }

    /**
     * Ce qui refuse une fin rendue qui prolonge une récurrence déplacée, ou null : collée, la
     * coupée va jusqu'à son premier jour ; coupée, une collée encore là commence avant sa fin.
     * Un maillon retiré renvoie au suivant (DayWriter::assertMoved). Les fins se lisent telles
     * que le geste les laisse (`ends`).
     */
    private moved(id: string, ends: ReadonlyMap<string, string | null> = new Map()): string | null {
        const recurrence = this.stored(id);
        const reaches = (other: StoredRecurrence, date: string) => {
            const end = this.endOf(other, ends);

            return end === null || end >= date;
        };
        if (recurrence.follows !== null && !this.withdrawn(recurrence, ends)) {
            let source = this.recurrences.get(recurrence.follows.id);
            while (source !== undefined && this.withdrawn(source, ends) && source.follows !== null) {
                source = this.recurrences.get(source.follows.id);
            }
            if (source !== undefined && !this.withdrawn(source, ends) && reaches(source, recurrence.firstDay)) {
                return `Rétablissez d'abord la coupe du ${dayLabel(recurrence.follows.cutOn)}.`;
            }
            // Une autre collée de la même coupe, encore là sur sa période : un onglet dupliqué l'a
            // collée ailleurs pendant que celle-ci était annulée (DayWriter::pastedTwin).
            const twin = (source === undefined ? [] : this.liveFollowers(source.id, ends)).find(
                (live) =>
                    live.id !== recurrence.id &&
                    reaches(recurrence, live.firstDay) &&
                    reaches(live, recurrence.firstDay),
            );
            if (twin !== undefined) {
                return `Annulez d'abord le collage du ${dayLabel(twin.firstDay)}.`;
            }
        }
        const follower = this.liveFollowers(id, ends).find((live) => reaches(recurrence, live.firstDay));

        return follower === undefined ? null : `Annulez d'abord le collage du ${dayLabel(follower.firstDay)}.`;
    }

    /** Les collées encore là qui la continuent, une collée retirée renvoyant aux siennes (DayWriter::liveFollowers). */
    private liveFollowers(id: string, ends: ReadonlyMap<string, string | null> = new Map()): StoredRecurrence[] {
        return [...this.recurrences.values()]
            .filter((other) => other.follows?.id === id)
            .sort((a, b) => a.id.localeCompare(b.id))
            .flatMap((follower) =>
                this.withdrawn(follower, ends) ? this.liveFollowers(follower.id, ends) : [follower],
            );
    }

    private endOf(recurrence: StoredRecurrence, ends: ReadonlyMap<string, string | null>): string | null {
        return ends.has(recurrence.id) ? (ends.get(recurrence.id) ?? null) : recurrence.until;
    }

    private withdrawn(recurrence: StoredRecurrence, ends: ReadonlyMap<string, string | null>): boolean {
        const end = this.endOf(recurrence, ends);

        return end !== null && end < recurrence.firstDay;
    }

    private stored(id: string): StoredRecurrence {
        const recurrence = this.recurrences.get(id);
        if (recurrence === undefined) {
            throw new Error(`La récurrence ${id} n'existe pas.`);
        }

        return recurrence;
    }

    /** Ce que LinksMatchRecurrences refuse : un lien qui n'est pas celui que la récurrence poserait là. */
    private validateLinks(changes: readonly SlotChange[]): Violation[] {
        const violations: Violation[] = [];
        changes.forEach((change, index) => {
            const field = `changes[${String(index)}].recurrence`;
            const id = change.recurrence;
            if (id === undefined) {
                return;
            }
            if (!isUuid(id)) {
                violations.push({ field, message: 'Récurrence inconnue.' });

                return;
            }
            if (change.kind === 'work' && normalizeTicket(change.ticket) === null) {
                return;
            }
            const recurrence = this.recurrences.get(id);
            const content = contentOf(change);
            const quarters = quartersOf(change);
            if (
                recurrence === undefined ||
                content === null ||
                !sameStored(content, recurrence.content) ||
                quarters.length === 0 ||
                quarters.some((quarter) => quarter < recurrence.start || quarter >= recurrence.end)
            ) {
                violations.push({ field, message: "Ce créneau n'appartient pas à cette récurrence." });
            }
        });

        return violations;
    }

    /** Une écriture sur la version vue : refusée (409) si la journée a changé, ou si le geste le dit. */
    private writeOrRefuse(request: Request, version: number, gesture: Gesture, creates: boolean): WriteResult {
        if (this.versionOf(request.date) !== version) {
            return { status: 'stale', day: this.read(request.date) };
        }
        try {
            return this.write(request, gesture, creates);
        } catch (error) {
            if (error instanceof Stale) {
                return { status: 'stale', day: this.read(request.date) };
            }
            throw error;
        }
    }

    /**
     * Le geste s'applique à une copie, et reçoit les fois prévues avant lui : s'il lève, la base
     * reste telle qu'elle était. Un jour jamais saisi ne naît que si `creates` le dit, ou si le
     * geste y laisse une saisie ; une fois détachée ou rendue s'écrit quand même.
     */
    private write(request: Request, gesture: Gesture, creates = true): WriteResult {
        const date = request.date;
        const stored = this.days.get(date);
        const planned = this.forecast(date, stored);
        const day: StoredDay = stored === undefined ? emptyDay() : { ...stored, quarters: new Map(stored.quarters) };
        // Un envoi qui n'a plus rien à dire s'oublie avant le geste : un ticket saisi ne
        // refermerait pas la journée (SendClosure::forget).
        const closed = this.closes(day);
        if (!closed) {
            day.settled = false;
        }
        // Celles qui y ont un bloc avant le geste : effacée par lui, une fois garde son créneau sur le
        // jour qu'il rouvre (reopen).
        const before = new Set(
            [...day.quarters.values()].flatMap((slot) => (slot.recurrence === null ? [] : [slot.recurrence])),
        );
        const recurrences = new Map([...this.recurrences].map(([id, recurrence]) => [id, { ...recurrence }] as const));
        const skips = new Map(this.skips);
        const created = this.created;
        try {
            gesture(day, planned);
        } catch (error) {
            this.recurrences.clear();
            recurrences.forEach((recurrence, id) => this.recurrences.set(id, recurrence));
            this.skips.clear();
            skips.forEach((skip, key) => this.skips.set(key, skip));
            this.created = created;
            throw error;
        }
        if (!this.closes(day)) {
            day.settled = false;
            if (closed) {
                this.reopen(day, date, before);
            }
        }
        if (stored !== undefined || creates || day.quarters.size > 0) {
            day.version += 1;
            this.days.set(date, day);
        }
        this.writes.push(request);

        return { status: 'saved', day: this.read(date) };
    }

    /**
     * La journée telle que l'API la rend (DayReader) ; `withPlanned`, un jour à venir y montre
     * ses fois prévues, liées à leur récurrence, comme ses autres blocs. Une récurrence arrêtée
     * ou retirée avant ce jour n'y a plus de fois : ce qu'elle y avait posé se lit sans lien,
     * fondu avec un voisin au même contenu, et son lien reste en base (links).
     */
    private view(date: string, withPlanned: boolean, day = this.days.get(date)): View {
        const planned = withPlanned ? this.forecast(date, day) : new Map<number, string>();
        const version = this.versionOf(date, day, planned);
        const slots = new Map<number, Slot>();
        for (const [quarter, slot] of day?.quarters ?? []) {
            const recurrence = slot.recurrence === null ? undefined : this.recurrences.get(slot.recurrence);
            slots.set(
                quarter,
                recurrence !== undefined && reaches(recurrence, date)
                    ? slot
                    : { content: slot.content, recurrence: null },
            );
        }
        for (const [quarter, id] of planned) {
            if (slots.has(quarter)) {
                throw new Error(`Une fois prévue tombe sur une saisie à ${format(quarter)}.`);
            }
            slots.set(quarter, { content: this.stored(id).content, recurrence: id });
        }
        const blocks: {
            start: string;
            end: string;
            kind: string;
            ticket: string | null;
            comment: string | null;
            recurrence: string | null;
        }[] = [];
        let previous: Slot | undefined;
        for (let quarter = FIRST; quarter < DAY_END; quarter += 15) {
            const slot = slots.get(quarter);
            const last = blocks.at(-1);
            if (
                slot !== undefined &&
                previous !== undefined &&
                last !== undefined &&
                sameStored(previous.content, slot.content) &&
                previous.recurrence === slot.recurrence
            ) {
                last.end = format(quarter + 15);
            } else if (slot !== undefined) {
                blocks.push({
                    start: format(quarter),
                    end: format(quarter + 15),
                    kind: slot.content.kind,
                    ticket: slot.content.kind === 'work' ? slot.content.ticket : null,
                    comment: slot.content.kind === 'work' ? slot.content.comment : null,
                    recurrence: slot.recurrence,
                });
            }
            previous = slot;
        }
        const recurrences: Record<string, object> = {};
        for (const slot of slots.values()) {
            const recurrence = slot.recurrence === null ? undefined : this.recurrences.get(slot.recurrence);
            if (recurrence !== undefined) {
                recurrences[recurrence.id] = viewOf(recurrence, this.skippedOf(recurrence.id));
            }
        }
        // Celles qui ont encore des jours après aujourd'hui (RecurrenceRepository::ongoing) : ni
        // finies avant, ni retirées, quel que soit le jour lu.
        const ongoing: Record<string, object> = {};
        for (const recurrence of this.recurrences.values()) {
            const { until } = recurrence;
            if (until === null || ((this.today === null || until > this.today) && until >= recurrence.firstDay)) {
                ongoing[recurrence.id] = viewOf(recurrence, this.skippedOf(recurrence.id));
            }
        }

        return {
            date,
            version,
            objective: day?.objective ?? HABITUAL_OBJECTIVE,
            habitualObjective: HABITUAL_OBJECTIVE,
            working: this.workingDays.includes(isoWeekday(date)),
            declaredOff: day !== undefined && isDeclaredOff(day),
            workingDays: this.workingDays,
            blocks,
            recurrences,
            recurrencesHeld: false,
            ongoing,
            settledAhead: this.closedAhead(),
            send: {
                ...NOTHING_TO_SEND,
                state: blocks.some((block) => block.kind === 'work')
                    ? day !== undefined && day.sentVersion === day.version
                        ? 'sent'
                        : day !== undefined && day.failedVersion === day.version
                          ? 'failed'
                          : 'unsent'
                    : 'nothing',
            },
        };
    }
}

/** @param rewinding annuler une fin seule ne rend aucun créneau (src/Api/Input/SlotsInput.php) */
function validate(changes: readonly SlotChange[], rewinding = false): Violation[] {
    const violations: Violation[] = [];
    if ((changes.length === 0 && !rewinding) || changes.length > (DAY_END - FIRST) / 15) {
        violations.push({ field: 'changes', message: 'Nombre de créneaux invalide.' });
    }
    const seen = new Set<number>();
    changes.forEach((change, index) => {
        const field = `changes[${String(index)}]`;
        for (const key of Object.keys(change)) {
            if (!CHANGE_FIELDS.has(key)) {
                violations.push({ field: `${field}.${key}`, message: 'Champ inconnu.' });
            }
        }
        const start = parse(change.start);
        const end = parse(change.end);
        if (start === null || start < FIRST || start >= DAY_END || start % 15 !== 0) {
            violations.push({ field: `${field}.start`, message: 'Début invalide.' });
        }
        if (end === null || end <= FIRST || end > DAY_END || end % 15 !== 0 || (start !== null && end <= start)) {
            violations.push({ field: `${field}.end`, message: 'Fin invalide.' });
        }
        // Ce qui arrive du navigateur n'a pas encore de type : une autre nature est refusée.
        const kind: string = change.kind;
        if (kind === 'work') {
            const ticket = normalizeTicket(change.ticket);
            if (ticket === null || ticket.length > 50 || !/^[A-Z][A-Z0-9_]+-[1-9][0-9]*$/.test(ticket)) {
                violations.push({ field: `${field}.ticket`, message: 'Ticket invalide.' });
            }
            // Comme Symfony, la longueur se compte en caractères, pas en unités UTF-16.
            const comment = normalizeComment(change.comment);
            if (comment !== null && (Array.from(comment).length > 500 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(comment))) {
                violations.push({ field: `${field}.comment`, message: 'Commentaire invalide.' });
            }
        } else if (kind !== 'pause' && kind !== 'empty') {
            violations.push({ field: `${field}.kind`, message: 'Nature invalide.' });
        } else if (change.ticket !== null || change.comment !== null) {
            violations.push({ field, message: 'Ni ticket ni commentaire ici.' });
        }
        if (start !== null && end !== null) {
            for (let quarter = start; quarter < end; quarter += 15) {
                if (seen.has(quarter)) {
                    violations.push({ field, message: 'Deux créneaux couvrent le même quart d’heure.' });
                    break;
                }
                seen.add(quarter);
            }
        }
    });

    return violations;
}

/** Les fins qu'annuler ou rétablir rendent (SlotsInput, UntilRewindInput). */
function validateRewinds(untils: readonly UntilRewind[]): Violation[] {
    const violations: Violation[] = [];
    if (untils.length > 2) {
        violations.push({ field: 'recurrences', message: 'Un geste change au plus deux récurrences.' });
    }
    untils.forEach((rewind, index) => {
        const field = `recurrences[${String(index)}]`;
        for (const key of Object.keys(rewind)) {
            if (!REWIND_FIELDS.has(key)) {
                violations.push({ field: `${field}.${key}`, message: 'Champ inconnu.' });
            }
        }
        if (!isUuid(rewind.recurrence)) {
            violations.push({ field: `${field}.recurrence`, message: 'Récurrence inconnue.' });
        }
        for (const end of ['from', 'to'] as const) {
            const value = rewind[end];
            if (value !== null && !isDate(value)) {
                violations.push({ field: `${field}.${end}`, message: "Une date s'écrit AAAA-MM-JJ." });
            }
        }
    });

    return violations;
}

/**
 * Le rythme et la fin que règle la fenêtre (RecurrenceRuleInput) : chaque champ sous son nom,
 * puis chaque rythme avec ses champs, et seulement les siens.
 */
function validateRule(rule: RecurrenceRule | null): Violation[] {
    if (rule === null) {
        return [];
    }
    const violations: Violation[] = [];
    const refuse = (field: string, message: string): void => {
        violations.push({ field: `recurrence.${field}`, message });
    };
    for (const key of Object.keys(rule)) {
        if (!RULE_FIELDS.has(key)) {
            refuse(key, 'Champ inconnu.');
        }
    }
    const { weekdays, everyWeeks, monthWeek, monthDay, until } = rule;
    // Ce qui arrive du navigateur n'a pas encore de type : un autre rythme est refusé.
    const kind: string = rule.kind;
    if (
        weekdays.length > 7 ||
        !weekdays.every((weekday) => Number.isInteger(weekday) && weekday >= 1 && weekday <= 7)
    ) {
        refuse('weekdays', 'Un jour de la semaine va du lundi au dimanche.');
    }
    if (new Set(weekdays).size !== weekdays.length) {
        refuse('weekdays', "Un jour ne se choisit qu'une fois.");
    }
    if (until !== null && !isDate(until)) {
        refuse('until', "Une date s'écrit AAAA-MM-JJ.");
    }
    if (!RHYTHM_KINDS.has(kind)) {
        refuse('kind', 'Rythme inconnu.');
    }
    if (!Number.isInteger(everyWeeks) || everyWeeks < 1 || everyWeeks > MAX_EVERY_WEEKS) {
        refuse('everyWeeks', 'Une récurrence revient chaque semaine, ou une semaine sur 2, 3 ou 4.');
    }
    if (monthWeek !== null && ![1, 2, 3, 4, LAST].includes(monthWeek)) {
        refuse('monthWeek', 'Un jour du mois se nomme du 1er au 4e, ou le dernier.');
    }
    if (monthDay !== null && (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31)) {
        refuse('monthDay', 'Une date du mois va du 1er au 31.');
    }
    switch (kind) {
        case 'weekly':
            if (weekdays.length === 0) {
                refuse('weekdays', 'Choisissez au moins un jour.');
            }
            if (monthWeek !== null || monthDay !== null) {
                refuse('kind', "Chaque semaine n'a pas de jour du mois.");
            }
            break;
        case 'monthly_weekday':
            if (weekdays.length !== 1 || monthWeek === null || monthDay !== null || everyWeeks !== 1) {
                refuse('kind', 'Le n-ième jour du mois a un seul jour de la semaine et son rang.');
            }
            break;
        case 'monthly_date':
            if (weekdays.length !== 0 || monthWeek !== null || monthDay === null || everyWeeks !== 1) {
                refuse('kind', "Une date du mois n'a que sa date.");
            }
            break;
    }

    return violations;
}

/** Ce que la fenêtre a vu de la récurrence qu'elle remplace (ReplacedRecurrenceInput). */
function validateReplaced(replaces: SeenRecurrence | null): Violation[] {
    if (replaces === null) {
        return [];
    }
    const violations: Violation[] = [];
    for (const key of Object.keys(replaces)) {
        if (!REPLACED_FIELDS.has(key)) {
            violations.push({ field: `replaces.${key}`, message: 'Champ inconnu.' });
        }
    }
    if (!isUuid(replaces.id)) {
        violations.push({ field: 'replaces.id', message: 'Récurrence inconnue.' });
    }
    if (
        replaces.weekdays.length > 7 ||
        !replaces.weekdays.every((weekday) => Number.isInteger(weekday) && weekday >= 1 && weekday <= 7)
    ) {
        violations.push({ field: 'replaces.weekdays', message: 'Un jour de la semaine va du lundi au dimanche.' });
    }
    if (replaces.until !== null && !isDate(replaces.until)) {
        violations.push({ field: 'replaces.until', message: "Une date s'écrit AAAA-MM-JJ." });
    }

    return violations;
}

/** Elle est encore telle que la fenêtre l'a vue : ses jours et sa fin (SeenRecurrence::matches). */
function stillSeen(recurrence: StoredRecurrence, seen: SeenRecurrence): boolean {
    return (
        [...new Set(seen.weekdays)].sort((a, b) => a - b).join() === recurrence.rhythm.weekdays.join() &&
        seen.until === recurrence.until
    );
}

/**
 * Ce que DayWriter::checkSpec refuse : un jour qui n'est plus travaillé — sauf s'il était
 * déjà à la récurrence remplacée —, un rythme mensuel que le jour du bloc ne permet pas, une
 * fin avant le jour du bloc.
 */
function checkRule(
    rule: RecurrenceRule,
    date: string,
    workingDays: readonly number[],
    kept: readonly number[],
    today: string,
): Violation | null {
    const off = rule.weekdays.find((weekday) => !workingDays.includes(weekday) && !kept.includes(weekday));
    if (off !== undefined) {
        return {
            field: 'recurrence.weekdays',
            message: `Le ${DAYS[off - 1] ?? ''} n'est plus travaillé. Rechargez la page.`,
        };
    }
    if (!permittedBy(rhythmOf(rule), date)) {
        return { field: 'recurrence.rhythm', message: 'Ce rythme ne tombe pas le jour du bloc. Rechargez la page.' };
    }
    if (rule.until !== null && rule.until < date) {
        return { field: 'recurrence.until', message: untilRefusal(date, today) };
    }

    return null;
}

/** RecurrenceRefused::endsBefore, écrit à part pour ne pas reprendre le texte de la fenêtre. */
function untilRefusal(date: string, today: string): string {
    const year = date.slice(0, 4) === today.slice(0, 4) ? '' : ` ${date.slice(0, 4)}`;

    return `Choisissez un jour à partir du ${dayLabel(date)}${year}.`;
}

/** « mardi 24 novembre », « mardi 1er décembre » (RecurrenceRefused::day). */
function dayLabel(date: string): string {
    const day = Number(date.slice(8, 10));

    return `${DAYS[isoWeekday(date) - 1] ?? ''} ${day === 1 ? '1er' : String(day)} ${MONTHS[Number(date.slice(5, 7)) - 1] ?? ''}`;
}

/** RecurrenceRefused::taken, écrit à part pour ne pas reprendre le texte de la fenêtre. */
function takenRefusal(other: StoredRecurrence): string {
    return other.content.kind === 'pause'
        ? 'Ce créneau est déjà pris par la pause.'
        : `Ce créneau est déjà pris par la récurrence «\u{a0}${other.content.comment ?? other.content.ticket}\u{a0}».`;
}

/** Une fin qui va plus loin que l'autre : sans fin, ou plus tard (DayWriter::isLonger). */
function isLonger(until: string | null, than: string | null): boolean {
    return than !== null && (until === null || until > than);
}

/** Le rythme d'une règle déjà validée (RecurrenceRuleInput::spec) : ses jours dans l'ordre, chacun une fois. */
function rhythmOf(rule: RecurrenceRule): Rhythm {
    switch (rule.kind) {
        case 'weekly':
            return {
                kind: 'weekly',
                weekdays: [...new Set(rule.weekdays)].sort((a, b) => a - b),
                everyWeeks: rule.everyWeeks,
                monthWeek: null,
                monthDay: null,
            };
        case 'monthly_weekday':
            return {
                kind: 'monthly_weekday',
                weekdays: rule.weekdays.slice(0, 1),
                everyWeeks: 1,
                monthWeek: rule.monthWeek,
                monthDay: null,
            };
        case 'monthly_date':
            return { kind: 'monthly_date', weekdays: [], everyWeeks: 1, monthWeek: null, monthDay: rule.monthDay };
    }
}

/** Rhythm::equals. */
function sameRhythm(a: Rhythm, b: Rhythm): boolean {
    return (
        a.kind === b.kind &&
        a.weekdays.join() === b.weekdays.join() &&
        a.everyWeeks === b.everyWeeks &&
        a.monthWeek === b.monthWeek &&
        a.monthDay === b.monthDay
    );
}

/**
 * Rhythm::permittedBy : un rythme mensuel que ce jour permet — son rang, du 1er au 4e, « le
 * dernier » s'il l'est, ou sa date. Un rythme à la semaine n'a pas à tomber ce jour-là.
 */
function permittedBy(rhythm: Rhythm, date: string): boolean {
    switch (rhythm.kind) {
        case 'weekly':
            return true;
        case 'monthly_weekday':
            return rhythm.weekdays.join() === String(isoWeekday(date)) && inMonthWeek(rhythm, date);
        case 'monthly_date':
            return dayOfMonth(date) === rhythm.monthDay;
    }
}

/**
 * Les heures d'une récurrence changée à partir de cette fois (DayWriter::hoursAfter) : les
 * mêmes quand le geste écrit dans sa plage, ou sa plage plus ce qui la prolonge du même
 * contenu, ou moins ce qui en efface un bord, d'un seul tenant ; null pour tout autre geste,
 * et pour les deux à la fois.
 */
function hoursAfter(
    old: StoredRecurrence,
    quarters: ReadonlyMap<number, Stored | null>,
    content: Stored | null,
): [number, number] | null {
    if (content !== null && [...quarters.keys()].every((quarter) => quarter >= old.start && quarter < old.end)) {
        return [old.start, old.end];
    }
    const own = new Set<number>();
    for (let quarter = old.start; quarter < old.end; quarter += 15) {
        own.add(quarter);
    }
    let erased = false;
    let added = false;
    for (const [quarter, cell] of quarters) {
        if (cell === null) {
            if (!own.delete(quarter)) {
                return null;
            }
            erased = true;
        } else if (sameStored(cell, old.content)) {
            added ||= quarter < old.start || quarter >= old.end;
            own.add(quarter);
        } else {
            return null;
        }
    }
    // L'un ou l'autre : allonger et raccourcir d'un même geste la déplacerait.
    if (erased && added) {
        return null;
    }
    const all = [...own].sort((a, b) => a - b);
    const first = all[0];
    const last = all.at(-1);

    return first === undefined || last === undefined || last - first !== (all.length - 1) * 15
        ? null
        : [first, last + 15];
}

/** Le seul contenu que la fenêtre écrit, ou null si elle en écrit plusieurs, ou efface. */
function oneContent(quarters: ReadonlyMap<number, Stored | null>): Stored | null {
    const [first] = quarters.values();
    if (first === undefined || first === null) {
        return null;
    }

    return [...quarters.values()].every((content) => content !== null && sameStored(content, first)) ? first : null;
}

function occurrenceOf(day: StoredDay, id: string): number[] {
    return [...day.quarters]
        .filter(([, slot]) => slot.recurrence === id)
        .map(([quarter]) => quarter)
        .sort((a, b) => a - b);
}

function contentOf(change: SlotChange): Stored | null {
    if (change.kind === 'empty') {
        return null;
    }
    if (change.kind === 'pause') {
        return { kind: 'pause' };
    }

    return { kind: 'work', ticket: normalizeTicket(change.ticket) ?? '', comment: normalizeComment(change.comment) };
}

function quartersOf(change: SlotChange): number[] {
    const quarters: number[] = [];
    for (let quarter = minutes(change.start); quarter < minutes(change.end); quarter += 15) {
        quarters.push(quarter);
    }

    return quarters;
}

function sameStored(a: Stored, b: Stored): boolean {
    return a.kind === 'pause' || b.kind === 'pause'
        ? a.kind === b.kind
        : a.ticket === b.ticket && a.comment === b.comment;
}

/**
 * Elle tombe ce jour-là : entre son premier jour et sa fin, selon son rythme compté depuis son
 * premier jour (Rhythm::fallsOn) — une semaine sur n se compte en semaines du lundi.
 */
function fallsOn(recurrence: StoredRecurrence, date: string): boolean {
    const { rhythm, firstDay, until } = recurrence;
    if (date < firstDay || (until !== null && date > until)) {
        return false;
    }
    switch (rhythm.kind) {
        case 'weekly':
            return (
                rhythm.weekdays.includes(isoWeekday(date)) &&
                Math.trunc(daysBetween(monday(firstDay), monday(date)) / 7) % rhythm.everyWeeks === 0
            );
        case 'monthly_weekday':
            return rhythm.weekdays.includes(isoWeekday(date)) && inMonthWeek(rhythm, date);
        case 'monthly_date':
            return dayOfMonth(date) === rhythm.monthDay;
    }
}

/** Le n-ième de ses jours de la semaine dans le mois, ou le dernier : un de plus dans sept jours changerait de mois. */
function inMonthWeek(rhythm: Rhythm, date: string): boolean {
    return rhythm.monthWeek === LAST
        ? shifted(date, 7).slice(5, 7) !== date.slice(5, 7)
        : Math.ceil(dayOfMonth(date) / 7) === rhythm.monthWeek;
}

function dayOfMonth(date: string): number {
    return Number(date.slice(8, 10));
}

function monday(date: string): string {
    return shifted(date, 1 - isoWeekday(date));
}

/** Des jours du calendrier, comptés en heure universelle : ils n'ont pas d'heure. */
function daysBetween(from: string, to: string): number {
    const utc = (date: string) =>
        Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));

    return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/** Elle va encore jusqu'à ce jour (Recurrence::reaches) : finie avant lui, ce qu'elle y a posé n'en est plus une fois. */
function reaches(recurrence: StoredRecurrence, date: string): boolean {
    return recurrence.until === null || recurrence.until >= date;
}

/** Les quarts d'heure qu'une récurrence pose ce jour-là, ou aucun si elle n'y tombe pas. */
function linksIfFalls(recurrence: StoredRecurrence, date: string, quarters: readonly number[]): Map<number, string> {
    return fallsOn(recurrence, date)
        ? new Map(quarters.map((quarter) => [quarter, recurrence.id]))
        : new Map<number, string>();
}

/** La fin qui la retire : la veille de son premier jour, où elle ne tombe jamais. */
function withdrawnUntil(recurrence: StoredRecurrence): string {
    return previousDay(recurrence.firstDay);
}

function skipKey(id: string, date: string): string {
    return `${id} ${date}`;
}

function isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }
    const time = Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));

    return new Date(time).toISOString().slice(0, 10) === value;
}

/** Le jour de la semaine ISO d'un jour du calendrier, compté en heure universelle : il n'a pas d'heure. */
function isoWeekday(date: string): number {
    const day = new Date(
        Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))),
    ).getUTCDay();

    return day === 0 ? 7 : day;
}

function shifted(date: string, days: number): string {
    const time = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + days);

    return new Date(time).toISOString().slice(0, 10);
}

function nextDay(date: string): string {
    return shifted(date, 1);
}

function previousDay(date: string): string {
    return shifted(date, -1);
}

/** Comme SlotChangeInput : ce qui entoure d'invisible disparaît, et ce qui reste vide vaut null. */
function trimmed(value: string): string | null {
    const result = value.replace(/^[\p{Z}\p{Cc}\p{Cf}]+|[\p{Z}\p{Cc}\p{Cf}]+$/gu, '');

    return result === '' ? null : result;
}

function normalizeTicket(ticket: string | null): string | null {
    return ticket === null ? null : trimmed(ticket.replace(/[a-z]/g, (letter) => letter.toUpperCase()));
}

function normalizeComment(comment: string | null): string | null {
    return comment === null ? null : trimmed(comment.replace(/\p{Zs}+/gu, ' '));
}

function parse(time: string): number | null {
    const parts = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);

    return parts === null ? null : Number(parts[1]) * 60 + Number(parts[2]);
}

function minutes(time: string): number {
    return parse(time) ?? Number.NaN;
}

function format(value: number): string {
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
