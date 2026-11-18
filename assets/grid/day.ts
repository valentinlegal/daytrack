import { isDate } from '../day/calendar';
import { type Block, Grid, linkedTo, PAUSE, work } from './grid';
import { isRecord } from './json';
import * as Quarter from './quarter';
import { readRecurrences, type Recurrence } from './recurrence';
import { readSend, type SendStatus } from './send';

/**
 * Une journée telle que la base la contient : sa grille, son objectif, l'état de son
 * envoi sur Jira, et la version qu'une écriture doit porter pour être acceptée.
 */
export interface DayState {
    /** « AAAA-MM-JJ ». */
    readonly date: string;
    /** Le nombre d'écritures reçues : 0 pour un jour qui n'a encore rien. */
    readonly version: number;
    /** En minutes. */
    readonly objective: number;
    /** L'objectif de chaque nouvelle journée, auquel « Revenir à 7h30 » ramène. */
    readonly habitualObjective: number;
    /** Travaillé selon les réglages : sinon, son objectif est à zéro et l'écran le ferme à la saisie. */
    readonly working: boolean;
    /**
     * Mis à 0h00 dans la fenêtre Objectif du jour : vide, l'écran le ferme à la saisie
     * comme un jour non travaillé, mais en garde l'objectif.
     */
    readonly declaredOff: boolean;
    /** Ceux des réglages, en jours de la semaine ISO, de 1 pour lundi à 7 pour dimanche. */
    readonly workingDays: readonly number[];
    readonly grid: Grid;
    readonly send: SendStatus;
    /** Celles qui ont posé un bloc ce jour-là, par leur identifiant : la flèche du bloc et sa fenêtre les disent. */
    readonly recurrences: ReadonlyMap<string, Recurrence>;
    /** Fermé et vide, alors qu'une récurrence y serait tombée : la journée vide le dit. */
    readonly recurrencesHeld: boolean;
    /**
     * Toutes celles qui vont encore jusqu'à ce jour, ou au-delà : une récurrence qu'on y crée
     * ou qu'on y change ne doit tomber sur aucune (firstClash). Le serveur en décide, sur les
     * siennes du moment : celles-ci datent de la lecture de la journée.
     */
    readonly ongoing: ReadonlyMap<string, Recurrence>;
    /**
     * Les jours à venir déjà envoyés, « AAAA-MM-JJ » : leurs récurrences ne les changent plus,
     * et la fenêtre d'une récurrence ne les annonce pas dans ses prochaines fois.
     */
    readonly settledAhead: ReadonlySet<string>;
}

/**
 * Lit une journée rendue par l'API (src/Day/DayView.php). Une réponse qui n'en a pas
 * la forme lève : l'écran n'affiche rien plutôt qu'une journée de travers.
 */
export function readDay(json: unknown): DayState {
    const day = record(json, 'la journée');
    const date = day.date;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new TypeError("La journée n'a pas de date.");
    }
    if (!Array.isArray(day.blocks)) {
        throw new TypeError("La journée n'a pas de blocs.");
    }
    if (typeof day.working !== 'boolean') {
        throw new TypeError('La journée ne dit pas si elle est travaillée.');
    }
    if (typeof day.declaredOff !== 'boolean') {
        throw new TypeError('La journée ne dit pas si elle est mise à 0h00.');
    }

    return {
        date,
        version: integer(day.version, 'version'),
        objective: objective(day.objective, 'objective'),
        habitualObjective: objective(day.habitualObjective, 'habitualObjective'),
        working: day.working,
        declaredOff: day.declaredOff,
        workingDays: readWeekdays(day.workingDays),
        grid: Grid.fromBlocks(day.blocks.map(readBlock)),
        send: readSend(day.send),
        // Une journée d'avant les récurrences n'en a pas.
        recurrences: day.recurrences === undefined ? new Map() : readRecurrences(day.recurrences),
        recurrencesHeld: day.recurrencesHeld === true,
        ongoing: day.ongoing === undefined ? new Map() : readRecurrences(day.ongoing),
        settledAhead: day.settledAhead === undefined ? new Set() : readDates(day.settledAhead),
    };
}

/** Des dates « AAAA-MM-JJ » du calendrier. */
function readDates(value: unknown): Set<string> {
    if (!Array.isArray(value) || !value.every((date: unknown) => typeof date === 'string' && isDate(date))) {
        throw new TypeError('« settledAhead » ne sont pas des dates.');
    }

    return new Set(value as string[]);
}

/** Des jours de la semaine ISO, chacun une fois : les flèches de la barre s'y fient. */
export function readWeekdays(value: unknown): number[] {
    if (
        !Array.isArray(value) ||
        new Set(value).size !== value.length ||
        !value.every((day: unknown) => typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 7)
    ) {
        throw new TypeError('« workingDays » ne sont pas des jours de la semaine.');
    }

    return value as number[];
}

function readBlock(json: unknown): Block {
    const block = record(json, 'un bloc');
    const start = typeof block.start === 'string' ? Quarter.parse(block.start) : null;
    const end = typeof block.end === 'string' ? Quarter.parse(block.end) : null;
    if (start === null || end === null) {
        throw new TypeError("Un bloc n'a pas d'heures.");
    }
    const recurrence = block.recurrence ?? null;
    if (recurrence !== null && typeof recurrence !== 'string') {
        throw new TypeError("La récurrence d'un bloc n'est pas un identifiant.");
    }
    if (block.kind === 'pause') {
        return { start, end, content: linkedTo(PAUSE, recurrence) };
    }
    if (block.kind !== 'work' || typeof block.ticket !== 'string') {
        throw new TypeError('Un bloc ne porte ni ticket ni pause.');
    }
    if (block.comment !== null && typeof block.comment !== 'string') {
        throw new TypeError("Le commentaire d'un bloc n'est pas un texte.");
    }

    return { start, end, content: work(block.ticket, block.comment, recurrence) };
}

function record(json: unknown, what: string): Record<string, unknown> {
    if (!isRecord(json)) {
        throw new TypeError(`L'API n'a pas rendu ${what}.`);
    }

    return json;
}

function integer(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new TypeError(`« ${field} » n'est pas un entier.`);
    }

    return value;
}

/**
 * Un objectif de 0h00 à 13h00, au quart d'heure, comme le serveur le borne. Un objectif
 * démesuré ferait tourner le calcul de la fin prévue à n'en plus finir.
 */
function objective(value: unknown, field: string): number {
    const minutes = integer(value, field);
    if (minutes > Quarter.DAY_END - Quarter.FIRST || minutes % Quarter.MINUTES !== 0) {
        throw new TypeError(`« ${field} » n'est pas un objectif.`);
    }

    return minutes;
}
