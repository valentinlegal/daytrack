import type { Outcome } from '../grid/daySession';
import type { Step } from '../grid/history';
import { type Loss, lossOf } from '../grid/loss';
import { type ObjectiveReading } from '../grid/objective';
import * as Quarter from '../grid/quarter';
import { type Selection, selectQuarters } from '../grid/selection';
import { firstRefusal, UNSAVED } from '../serverApi';
import { dayLabel } from './calendar';
import { duration } from './format';

/**
 * Ce que l'écran dit d'un geste : le message en bas de la grille — ceux de la grille, des
 * favoris et de l'envoi —, et les refus d'une fenêtre.
 */
export interface GridMessage {
    /** Le ticket que le message nomme, écrit en gras devant le texte ; null sinon. */
    readonly ticket: string | null;
    readonly text: string;
    /** Le message propose « Annuler » : il défait le geste qu'il décrit. */
    readonly undo: boolean;
}

/**
 * Les gestes dont l'effet ne se voit pas d'un coup d'œil, ou touche plusieurs créneaux.
 * Remplacer, c'est enregistrer Nouveau ticket sur une sélection déjà saisie ; modifier,
 * changer le commentaire d'une partie de bloc dans Modifier la sélection.
 */
export type UndoableGesture = 'delete' | 'clear' | 'cut' | 'paste' | 'pause' | 'replace' | 'modify';

/** Le participe de chaque geste : un ticket, la pause, plusieurs créneaux. */
const VERBS: Record<UndoableGesture, readonly [string, string, string]> = {
    delete: ['effacé', 'effacée', 'effacés'],
    clear: ['effacé', 'effacée', 'effacés'],
    cut: ['coupé', 'coupée', 'coupés'],
    paste: ['remplacé', 'remplacée', 'remplacés'],
    pause: ['converti en pause', 'convertie en pause', 'convertis en pause'],
    replace: ['remplacé', 'remplacée', 'remplacés'],
    modify: ['modifié', 'modifiée', 'modifiés'],
};

/**
 * Le message qui propose d'annuler : il nomme ce qui a disparu — le ticket quand le
 * geste n'en touche qu'un, la pause, sinon les créneaux. Rien quand rien n'a
 * disparu : coller sur des créneaux vides ajoute, et l'ajout se voit dans la grille.
 * Un remplacement, ou une modification, dit aussi ses heures, quand ce qu'il a recouvert
 * se suit : une partie de bloc ne se voit pas d'un coup d'œil (« SHOP-482 remplacé de
 * 10:00 à 10:30 », « SHOP-482 modifié de 10:00 à 10:45 »).
 */
export function undoMessage(gesture: UndoableGesture, step: Step | null): GridMessage | null {
    const loss = step === null ? null : lossOf(step);
    if (loss === null || loss.quarters === 0) {
        return null;
    }
    const [one, pause, several] = VERBS[gesture];
    const timed = gesture === 'replace' || gesture === 'modify';
    const when = timed && loss.span !== null ? ` ${rangeLabel(loss.span.start, loss.span.end)}` : '';
    const only = loss.contents.length === 1 ? loss.contents[0] : undefined;
    if (only?.kind === 'work') {
        return { ticket: only.ticket, text: `${one}${when}`, undo: true };
    }
    if (only?.kind === 'pause') {
        return { ticket: null, text: `Pause ${pause}${when}`, undo: true };
    }

    return { ticket: null, text: `${String(loss.quarters)} créneaux ${several}${when}`, undo: true };
}

/**
 * Ce que Nouveau ticket annonce sous ses champs, sur une sélection déjà saisie :
 * « Remplace SHOP-482 sur ces 30 minutes. ». Sur une sélection en partie vide, seul ce
 * qui disparaît compte : « sur 30 minutes ».
 *
 * @param selected les quarts d'heure que la fenêtre remplit
 */
export function replaceNote(loss: Loss, selected: number): string {
    const tickets = loss.contents.flatMap((content) => (content.kind === 'work' ? [content.ticket] : []));
    const pause = loss.contents.some((content) => content.kind === 'pause');
    const named = tickets.length === 1 ? (tickets[0] ?? '') : `${String(tickets.length)} tickets`;
    const what = tickets.length === 0 ? 'la pause' : pause ? `${named} et la pause` : named;
    const minutes = String(loss.quarters * Quarter.MINUTES);

    return `Remplace ${what} sur ${loss.quarters === selected ? 'ces ' : ''}${minutes} minutes.`;
}

/**
 * Ce que Modifier la sélection annonce sous ses champs, quand un de ses blocs la
 * dépasse : « Modifie SHOP-482 sur ces 45 minutes seulement. ». Le reste du bloc ne
 * bouge pas.
 *
 * @param selected les quarts d'heure que la fenêtre modifie
 */
export function partNote(ticket: string, selected: number): string {
    return `Modifie ${ticket} sur ces ${String(selected * Quarter.MINUTES)} minutes seulement.`;
}

/** F2 sur une sélection que Modifier la sélection n'ouvre pas, son choix grisé dans le menu. */
export const PART_REFUSAL: GridMessage = notice(
    "Rien ne s'ouvre, la sélection ne porte pas un seul ticket avec un seul commentaire.",
);

/**
 * Ce qu'un geste de la grille a donné, quand il n'a pas fait ce qu'on attendait.
 * Rien quand il est passé, ou quand il n'avait rien à faire.
 */
export function refusalMessage(outcome: Outcome, rewinding: 'undo' | 'redo' | null = null): GridMessage | null {
    switch (outcome.kind) {
        case 'stale':
            return notice("La journée a changé entre-temps. Rien n'a été modifié.");
        case 'failed':
            return notice(UNSAVED);
        case 'conflict':
            return notice(
                `Ces créneaux ont changé entre-temps. ${rewinding === 'redo' ? "Rien n'est rétabli." : "Rien n'est annulé."}`,
            );
        case 'overflow':
            return notice("Rien n'est collé, le groupe dépasserait 20:00.");
        case 'invalid':
            return notice(firstRefusal(outcome.violations));
        case 'saved':
        case 'unchanged':
        case 'nothing':
        case 'abandoned':
            return null;
    }
}

/**
 * Le refus d'un geste dont la réponse arrive après qu'on a changé de jour : la journée
 * affichée le dit, le jour du geste devant — « Mardi 17 novembre : ce créneau est déjà pris
 * par la récurrence « Daily ». » —, sans rien changer à ce qu'elle montre. Un texte qui
 * commence par un identifiant le garde tel quel.
 */
export function elsewhereRefusal(date: string, said: GridMessage): GridMessage {
    const text = /^\p{Lu}(?:\p{Ll}|['’])/u.test(said.text)
        ? `${said.text.charAt(0).toLowerCase()}${said.text.slice(1)}`
        : said.text;

    return notice(`${dayLabel(date)}\u{a0}: ${said.ticket === null ? '' : `${said.ticket} `}${text}`);
}

/** Ce qu'une fenêtre dit sous ses champs quand elle n'a pas pu enregistrer. */
export function windowRefusal(outcome: Outcome): string | null {
    switch (outcome.kind) {
        case 'stale':
            return 'La journée a changé entre-temps. Vérifiez, puis enregistrez de nouveau.';
        case 'failed':
        case 'abandoned':
        case 'conflict':
        case 'overflow':
        case 'nothing':
            return UNSAVED;
        case 'invalid':
        case 'saved':
        case 'unchanged':
            return null;
    }
}

/** L'en-tête du menu : « 7 créneaux, 1h45 ». */
export function selectionSummary(selection: Selection): string {
    const count = selection.quarters.length;

    return `${String(count)} ${count > 1 ? 'créneaux' : 'créneau'}, ${duration(count * Quarter.MINUTES)}`;
}

/** « de 15:15 à 15:30 ». */
export function rangeLabel(start: number, end: number): string {
    return `de ${Quarter.format(start)} à ${Quarter.format(end)}`;
}

/**
 * Le sous-titre d'une fenêtre de ticket : « Mardi 6 octobre de 15:15 à 15:30 ». Une
 * sélection en plusieurs morceaux n'a pas d'heures à dire : sa taille, comme l'en-tête
 * du menu.
 *
 * @param quarters les quarts d'heure que la fenêtre modifie, dans l'ordre
 */
export function windowSubtitle(day: string, quarters: readonly number[]): string {
    const first = quarters.at(0) ?? Quarter.FIRST;
    const last = quarters.at(-1) ?? Quarter.FIRST;
    if (last - first === (quarters.length - 1) * Quarter.MINUTES) {
        return `${day} ${rangeLabel(first, last + Quarter.MINUTES)}`;
    }

    return `${day}, ${selectionSummary(selectQuarters(quarters))}`;
}

/**
 * Un identifiant qui n'a pas la forme d'un ticket, dit en quittant le champ : le même
 * texte que le refus du serveur à l'enregistrement (src/Api/Input/SlotChangeInput.php).
 */
export const TICKET_SHAPE_REFUSAL = "Un identifiant de ticket s'écrit comme SHOP-482.";

/** Ce que la fenêtre Objectif du jour dit d'une durée qu'elle ne peut pas garder. */
export function objectiveRefusal(reading: Exclude<ObjectiveReading, { kind: 'ok' }>): string {
    switch (reading.kind) {
        case 'format':
            return 'Indiquez une durée, comme 7h30.';
        case 'quarter':
            return "L'objectif se règle au quart d'heure.";
        case 'range':
            return "L'objectif va de 0h00 à 13h00.";
    }
}

/** Un message sans ticket ni « Annuler » : un refus, ce qu'un autre onglet a changé. */
export function notice(text: string): GridMessage {
    return { ticket: null, text, undo: false };
}

/**
 * « SHOP-482 ajouté aux favoris », « SHOP-482 retiré des favoris » : son « Annuler » retire
 * le favori ajouté, ou le remet à sa place.
 */
export function favoriteMessage(ticket: string, gesture: 'added' | 'removed'): GridMessage {
    return { ticket, text: gesture === 'added' ? 'ajouté aux favoris' : 'retiré des favoris', undo: true };
}
