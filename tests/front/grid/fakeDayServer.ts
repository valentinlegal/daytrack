import type { SlotChange } from '../../../assets/grid/changes';
import { type DayState, readDay } from '../../../assets/grid/day';
import type { DayApi, SendResult, WriteResult } from '../../../assets/grid/daySession';
import type { Violation } from '../../../assets/serverApi';

/**
 * Un serveur des journées en mémoire, aussi strict que le vrai (src/Controller/Api/
 * DayController.php) : la version, le 409 d'un onglet en retard, les refus champ par
 * champ, le ticket mis en majuscules, la journée vide qui n'est pas créée.
 *
 * Il est écrit sans rien prendre au moteur — ni sa grille, ni ses plages : ce que le
 * moteur envoie de travers, il le refuse au lieu de le comprendre comme lui. Il garde
 * chaque état de chaque journée, par version : ce que la base a contenu, et qu'un
 * écran a le droit d'afficher.
 */

type Stored = { kind: 'work'; ticket: string; comment: string | null } | { kind: 'pause' };

interface StoredDay {
    version: number;
    objective: number;
    /** La version envoyée sur Jira en dernier ; null tant qu'aucune. */
    sentVersion?: number;
    quarters: Map<number, Stored>;
}

export interface Request {
    readonly kind: 'read' | 'changeSlots' | 'setObjective' | 'send';
    readonly date: string;
}

/**
 * Comment une requête voyage. Par défaut, elle arrive et revient aussitôt ; un test
 * peut la retarder, la perdre avant le serveur, ou perdre sa réponse.
 */
export type Transport = <T>(request: Request, handle: () => T) => Promise<T>;

export const HABITUAL_OBJECTIVE = 450;

/** Les journées du faux serveur sont toutes travaillées, du lundi au vendredi, et aucune n'est mise à 0h00. */
const WEEKDAY = { working: true, declaredOff: false, workingDays: [1, 2, 3, 4, 5] };

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

export class FakeDayServer {
    /** Chaque écriture acceptée, dans l'ordre. */
    readonly writes: Request[] = [];
    private readonly days = new Map<string, StoredDay>();
    private readonly history = new Map<string, string[]>();

    api(transport: Transport = (_, handle) => Promise.resolve(handle())): DayApi {
        return {
            read: (date) => transport({ kind: 'read', date }, () => this.read(date)),
            changeSlots: (date, version, changes) =>
                transport({ kind: 'changeSlots', date }, () => this.changeSlots(date, version, changes)),
            setObjective: (date, version, objective) =>
                transport({ kind: 'setObjective', date }, () => this.setObjective(date, version, objective)),
            send: (date, version) => transport({ kind: 'send', date }, () => this.send(date, version)),
        };
    }

    read(date: string): DayState {
        return readDay(this.view(date));
    }

    /** La journée telle qu'elle était à une version, ou undefined si elle ne l'a jamais eue. */
    at(date: string, version: number): DayState | undefined {
        const stored = version === 0 ? JSON.stringify(this.emptyView(date)) : this.history.get(date)?.[version];

        return stored === undefined ? undefined : readDay(JSON.parse(stored));
    }

    changeSlots(date: string, version: number, changes: readonly SlotChange[]): WriteResult {
        const violations = validate(changes);
        if (violations.length > 0) {
            return { status: 'invalid', violations };
        }
        const day = this.days.get(date);
        if ((day?.version ?? 0) !== version) {
            return { status: 'stale', day: this.read(date) };
        }
        if (day === undefined && changes.every((change) => change.kind === 'empty')) {
            // Effacer sur un jour jamais saisi ne le crée pas.
            return { status: 'saved', day: this.read(date) };
        }

        return this.write({ kind: 'changeSlots', date }, (written) => {
            for (const change of changes) {
                for (let quarter = minutes(change.start); quarter < minutes(change.end); quarter += 15) {
                    if (change.kind === 'empty') {
                        written.quarters.delete(quarter);
                    } else if (change.kind === 'pause') {
                        written.quarters.set(quarter, { kind: 'pause' });
                    } else {
                        written.quarters.set(quarter, {
                            kind: 'work',
                            ticket: normalizeTicket(change.ticket) ?? '',
                            comment: normalizeComment(change.comment),
                        });
                    }
                }
            }
        });
    }

    setObjective(date: string, version: number, objective: number): WriteResult {
        if (!Number.isInteger(objective) || objective < 0 || objective > DAY_END - FIRST || objective % 15 !== 0) {
            return { status: 'invalid', violations: [{ field: 'objective', message: 'Objectif invalide.' }] };
        }
        if ((this.days.get(date)?.version ?? 0) !== version) {
            return { status: 'stale', day: this.read(date) };
        }

        return this.write({ kind: 'setObjective', date }, (written) => {
            written.objective = objective;
        });
    }

    /** Un envoi : celui de la version que l'écran a vue, et seulement s'il y a un ticket. */
    send(date: string, version: number): SendResult {
        const day = this.days.get(date);
        if ((day?.version ?? 0) !== version) {
            return { status: 'stale', day: this.read(date) };
        }
        if (day === undefined || ![...day.quarters.values()].some((content) => content.kind === 'work')) {
            return { status: 'nothing', day: this.read(date) };
        }
        day.sentVersion = day.version;
        this.writes.push({ kind: 'send', date });

        return { status: 'done', day: this.read(date) };
    }

    private write(request: Request, gesture: (day: StoredDay) => void): WriteResult {
        const date = request.date;
        const day = this.days.get(date) ?? { version: 0, objective: HABITUAL_OBJECTIVE, quarters: new Map() };
        gesture(day);
        day.version += 1;
        this.days.set(date, day);
        this.writes.push(request);
        const history = this.history.get(date) ?? [];
        history[day.version] = JSON.stringify(this.view(date));
        this.history.set(date, history);

        return { status: 'saved', day: this.read(date) };
    }

    private view(date: string): object {
        const day = this.days.get(date);
        if (day === undefined) {
            return this.emptyView(date);
        }
        const blocks: { start: string; end: string; kind: string; ticket: string | null; comment: string | null }[] =
            [];
        let previous: Stored | undefined;
        for (let quarter = FIRST; quarter < DAY_END; quarter += 15) {
            const content = day.quarters.get(quarter);
            const last = blocks.at(-1);
            if (
                content !== undefined &&
                previous !== undefined &&
                last !== undefined &&
                JSON.stringify(previous) === JSON.stringify(content)
            ) {
                last.end = format(quarter + 15);
            } else if (content !== undefined) {
                blocks.push({
                    start: format(quarter),
                    end: format(quarter + 15),
                    kind: content.kind,
                    ticket: content.kind === 'work' ? content.ticket : null,
                    comment: content.kind === 'work' ? content.comment : null,
                });
            }
            previous = content;
        }

        return {
            date,
            version: day.version,
            objective: day.objective,
            habitualObjective: HABITUAL_OBJECTIVE,
            ...WEEKDAY,
            blocks,
            send: {
                ...NOTHING_TO_SEND,
                state: blocks.some((block) => block.kind === 'work')
                    ? day.sentVersion === day.version
                        ? 'sent'
                        : 'unsent'
                    : 'nothing',
            },
        };
    }

    private emptyView(date: string): object {
        return {
            date,
            version: 0,
            objective: HABITUAL_OBJECTIVE,
            habitualObjective: HABITUAL_OBJECTIVE,
            ...WEEKDAY,
            blocks: [],
            send: NOTHING_TO_SEND,
        };
    }
}

function validate(changes: readonly SlotChange[]): Violation[] {
    const violations: Violation[] = [];
    if (changes.length === 0 || changes.length > (DAY_END - FIRST) / 15) {
        violations.push({ field: 'changes', message: 'Nombre de créneaux invalide.' });
    }
    const seen = new Set<number>();
    changes.forEach((change, index) => {
        const field = `changes[${String(index)}]`;
        const start = parse(change.start);
        const end = parse(change.end);
        if (start === null || start < FIRST || start >= DAY_END || start % 15 !== 0) {
            violations.push({ field: `${field}.start`, message: 'Début invalide.' });
        }
        if (end === null || end <= FIRST || end > DAY_END || end % 15 !== 0 || (start !== null && end <= start)) {
            violations.push({ field: `${field}.end`, message: 'Fin invalide.' });
        }
        if (change.kind === 'work') {
            const ticket = normalizeTicket(change.ticket);
            if (ticket === null || ticket.length > 50 || !/^[A-Z][A-Z0-9_]+-[1-9][0-9]*$/.test(ticket)) {
                violations.push({ field: `${field}.ticket`, message: 'Ticket invalide.' });
            }
            // Comme Symfony, la longueur se compte en caractères, pas en unités UTF-16.
            const comment = normalizeComment(change.comment);
            if (comment !== null && (Array.from(comment).length > 500 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(comment))) {
                violations.push({ field: `${field}.comment`, message: 'Commentaire invalide.' });
            }
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
