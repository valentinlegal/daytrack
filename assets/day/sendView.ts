import type { SendOutcome } from '../grid/daySession';
import type { RecapTicket } from '../grid/recap';
import type { SendFailure, SendStatus, TicketFailure } from '../grid/send';
import type { TokenRefusal } from '../jira/jiraApi';
import { isTokenRefusal, TOKEN_EXPIRED } from '../jira/jiraStatus';
import { dayAndMonth, dayLabel } from './calendar';
import { duration } from './format';

/**
 * Ce que l'écran dit de l'envoi d'une journée sur Jira : le bouton dans chacun de ses
 * états, et les fenêtres qu'il ouvre. Rien ne s'y calcule que le serveur n'ait déjà dit :
 * l'état vient de la journée enregistrée.
 */

/** Ce qu'un clic sur le bouton Jira ouvre. */
export type SendWindowKind = 'confirm' | 'detail' | 'result';

export interface SendButtonView {
    /** Le texte visible. */
    readonly label: string;
    readonly variant: 'primary' | 'secondary';
    /** Le nom du bouton, quand son texte ne dit pas l'état du jour. */
    readonly name: string | null;
    /** L'infobulle : ce que dit sa pastille. Aucune pendant l'envoi, le libellé suffit. */
    readonly tooltip: string | null;
    readonly icon: 'send' | 'check' | 'retry' | null;
    readonly badge: 'unsent' | 'modified' | 'error' | null;
    readonly disabled: boolean;
    readonly busy: boolean;
    readonly opens: SendWindowKind | null;
}

export const SEND_LABEL = 'Envoyer sur Jira';
export const RETRY_LABEL = "Réessayer l'envoi";
export const SENDING_ANNOUNCE = 'Envoi sur Jira en cours';

export function sendButton(status: SendStatus): SendButtonView {
    const base = { name: null, icon: 'send', badge: null, disabled: false, busy: false } as const;

    switch (status.state) {
        case 'nothing':
            return {
                ...base,
                label: SEND_LABEL,
                variant: 'secondary',
                tooltip: 'Rien à envoyer pour ce jour',
                disabled: true,
                opens: null,
            };
        case 'unsent':
            return {
                ...base,
                label: SEND_LABEL,
                variant: 'primary',
                name: `${SEND_LABEL}, journée non envoyée`,
                tooltip: 'Journée non envoyée',
                badge: 'unsent',
                opens: 'confirm',
            };
        case 'sending':
            return {
                ...base,
                label: 'Envoi en cours',
                variant: 'primary',
                tooltip: null,
                icon: null,
                busy: true,
                opens: null,
            };
        case 'sent':
            return {
                ...base,
                label: `Envoyé à ${status.sentAt?.time ?? ''}`,
                variant: 'secondary',
                tooltip:
                    status.sentAt === null
                        ? null
                        : `Envoyé le ${dayAndMonth(status.sentAt.date)} à ${status.sentAt.time}. Cliquez pour voir le détail.`,
                icon: 'check',
                opens: 'detail',
            };
        case 'modified':
            return {
                ...base,
                label: 'Renvoyer sur Jira',
                variant: 'primary',
                name: "Renvoyer sur Jira, modifié depuis l'envoi",
                tooltip:
                    status.sentAt === null
                        ? "Modifié depuis l'envoi"
                        : `Modifié depuis l'envoi de ${status.sentAt.time}`,
                badge: 'modified',
                opens: 'confirm',
            };
        case 'partial':
            return {
                ...base,
                label: RETRY_LABEL,
                variant: 'primary',
                name: `${RETRY_LABEL}, envoi partiel`,
                tooltip: 'Envoi partiel. Cliquez pour voir le détail.',
                icon: 'retry',
                badge: 'error',
                opens: 'result',
            };
        case 'unverified':
            return {
                ...base,
                label: RETRY_LABEL,
                variant: 'primary',
                name: `${RETRY_LABEL}, envoi non vérifié`,
                tooltip: 'Envoi non vérifié. Cliquez pour voir le détail.',
                icon: 'retry',
                badge: 'error',
                opens: 'result',
            };
        case 'failed':
            return {
                ...base,
                label: RETRY_LABEL,
                variant: 'primary',
                name: `${RETRY_LABEL}, échec`,
                tooltip: "Échec de l'envoi. Cliquez pour voir le détail.",
                icon: 'retry',
                badge: 'error',
                opens: 'result',
            };
    }
}

/** Une ligne d'une fenêtre d'envoi : un ticket, son temps, et ce que le dernier essai en a fait. */
export interface SendRow {
    readonly ticket: string;
    readonly minutes: number;
    /** null s'il est arrivé ; undefined quand la fenêtre ne le dit pas. */
    readonly failure?: TicketFailure | null;
    /** Ce que la relecture a trouvé dans Jira, en minutes, quand elle l'a dit. */
    readonly inJira?: number;
    /** Retiré de la journée depuis un envoi : hors du compte, à 0h00. */
    readonly removed?: boolean;
    /** Retiré, et Jira ne le trouve plus : il en garde peut-être des heures. */
    readonly vanished?: boolean;
}

/**
 * Ce qui est arrivé à un ticket, d'après la relecture de Jira : il y est, il n'y est pas,
 * il n'y est qu'en partie, DayTrack n'a pas pu le relire, ou Jira ne le trouve plus.
 */
export type TicketFate = 'sent' | 'absent' | 'partial' | 'unverified' | 'vanished';

export function fateOf(
    failure: TicketFailure | null | undefined,
    inJira: number | undefined,
    vanished = false,
): TicketFate {
    if (vanished) {
        return 'vanished';
    }
    if (failure === null || failure === undefined) {
        return 'sent';
    }
    if (failure === 'unverified' || failure === 'unanswered') {
        return 'unverified';
    }

    return inJira !== undefined && inJira > 0 ? 'partial' : 'absent';
}

/**
 * La marque d'un ticket, dans les fenêtres comme au récapitulatif, qui la dessinent chacun
 * à leur façon : arrivé, erreur, « ? » de ce que DayTrack n'a pas pu relire, ou
 * avertissement d'un ticket que Jira ne trouve plus.
 */
export type FateMark = 'ok' | 'error' | 'unverified' | 'warning';

export function fateMark(fate: TicketFate): FateMark {
    switch (fate) {
        case 'sent':
            return 'ok';
        case 'absent':
        case 'partial':
            return 'error';
        case 'unverified':
            return 'unverified';
        case 'vanished':
            return 'warning';
    }
}

/** Ce que le lecteur d'écran dit de la marque ; un ticket retiré de la journée dit ce que Jira en garde. */
export function fateLabel(fate: TicketFate, removed: boolean): string {
    switch (fate) {
        case 'unverified':
            return 'Non vérifié';
        case 'vanished':
            return 'Introuvable dans Jira';
        case 'sent':
            return removed ? 'Retiré de Jira' : 'Envoyé';
        case 'partial':
            return removed ? 'Encore dans Jira' : 'Envoyé en partie';
        case 'absent':
            return removed ? 'Encore dans Jira' : 'Non envoyé';
    }
}

/** Sous un ticket retiré que Jira ne trouve plus : supprimé, ou que le compte ne voit plus. */
export const VANISHED_LINE =
    "Jira ne trouve plus ce ticket. S'il a encore des heures de ce jour, retirez-les dans Jira.";

/**
 * Les lignes d'une fenêtre : les tickets du jour, du plus long au plus court, comme le
 * récapitulatif, puis ceux retirés depuis un envoi, à 0h00 — le renvoi retire leurs
 * heures de Jira, et rien n'en disparaît sans avoir été montré.
 */
export function sendRows(tickets: readonly RecapTicket[], status: SendStatus, kind: SendWindowKind): SendRow[] {
    const rows: SendRow[] = [
        ...tickets.map((ticket) => ({ ticket: ticket.ticket, minutes: ticket.minutes })),
        ...status.removed.map((ticket) => ({
            ticket,
            minutes: 0,
            removed: true,
            ...(status.vanished.includes(ticket) ? { vanished: true } : {}),
        })),
    ];
    if (kind !== 'result') {
        return rows;
    }

    // Un ticket dont l'essai ne dit rien n'y est pas arrivé : rien n'a pu partir, ou Jira
    // ne l'a pas rendu tel que la journée le dit.
    const missing: TicketFailure = status.state === 'failed' ? 'unreachable' : 'mismatch';

    return rows.map((row) => {
        const inJira = status.inJira.get(row.ticket);

        return {
            ...row,
            failure: status.outcomes.has(row.ticket) ? (status.outcomes.get(row.ticket) ?? null) : missing,
            ...(inJira === undefined ? {} : { inJira }),
        };
    });
}

/** Sous un ticket qui n'est pas arrivé, en rouge : pourquoi. */
export function failureReason(failure: TicketFailure): string {
    switch (failure) {
        case 'closed':
            return 'Jira refuse les heures de ce ticket fermé.';
        case 'rejected':
            return 'Jira refuse les heures de ce ticket.';
        case 'not_found':
            // Jira répond de même pour un projet dont le suivi du temps est désactivé.
            return "Jira ne trouve pas ce ticket, ou n'y suit pas le temps.";
        case 'unreachable':
        case 'unanswered':
            return "Jira n'a pas répondu pour ce ticket.";
        case 'throttled':
            return "Jira demande d'attendre. Réessayez dans un moment.";
        case 'mismatch':
            return "Jira n'a pas les mêmes heures pour ce ticket.";
        case 'unverified':
            return "DayTrack n'a pas pu vérifier ce ticket.";
        case 'token_refused':
            return 'Jira a refusé le jeton enregistré avant de recevoir ces heures.';
    }
}

/** La suite de « Jira a 1h45 sur 2h30 » : ce qui est arrivé au reste. */
function restReason(failure: TicketFailure): string {
    switch (failure) {
        case 'closed':
        case 'rejected':
        case 'not_found':
        case 'token_refused':
            return ', et refuse le reste.';
        case 'throttled':
            return ", et demande d'attendre pour le reste.";
        case 'unreachable':
        case 'unanswered':
            return ", et n'a pas répondu pour le reste.";
        case 'mismatch':
        case 'unverified':
            return '.';
    }
}

/**
 * Sous un ticket d'une fenêtre : ce qu'il faut en dire, et sur quel ton — `error` en
 * rouge, `soft` discret, `warning` en couleur du texte, plus fort que le titre : rien n'a
 * échoué, mais il y a quelque chose à faire, et l'orange ne se lit pas sur un texte.
 */
export interface SendLineText {
    readonly text: string;
    readonly tone: 'error' | 'soft' | 'warning';
}

export function ticketLine(row: SendRow, kind: SendWindowKind): SendLineText | null {
    if (row.vanished === true) {
        return { text: VANISHED_LINE, tone: 'warning' };
    }
    if (kind !== 'result') {
        if (row.removed !== true) {
            return null;
        }

        return {
            text: kind === 'confirm' ? 'Ses heures seront retirées de Jira.' : 'Retiré de la journée et de Jira.',
            tone: 'soft',
        };
    }

    const fate = fateOf(row.failure, row.inJira);
    if (fate === 'unverified') {
        return null;
    }
    if (fate === 'sent') {
        return row.removed === true ? { text: 'Retiré de la journée et de Jira.', tone: 'soft' } : null;
    }

    const failure = row.failure ?? 'mismatch';
    const held = row.inJira;
    if (held === undefined) {
        return { text: failureReason(failure), tone: 'error' };
    }
    if (row.removed === true) {
        const reason =
            failure === 'mismatch'
                ? ''
                : failure === 'token_refused'
                  ? ' Jira a refusé le jeton enregistré.'
                  : ` ${failureReason(failure)}`;

        return { text: `Retiré de la journée, Jira en a encore ${duration(held)}.${reason}`, tone: 'error' };
    }
    // Autant d'heures, mais pas les mêmes : le total n'apprend rien, la raison suffit.
    if (held === row.minutes) {
        return { text: failureReason(failure), tone: 'error' };
    }
    if (held > row.minutes) {
        const reason = failure === 'mismatch' ? '' : ` ${failureReason(failure)}`;

        return { text: `Jira a ${duration(held)} au lieu de ${duration(row.minutes)}.${reason}`, tone: 'error' };
    }

    return { text: `Jira a ${duration(held)} sur ${duration(row.minutes)}${restReason(failure)}`, tone: 'error' };
}

/**
 * La phrase en tête du détail d'un envoi réussi. Une journée vidée n'a plus d'heures dans
 * Jira : seuls ses tickets retirés se disent, dessous.
 */
export function detailHead(rows: readonly SendRow[]): string | null {
    return rows.some((row) => row.removed !== true) ? 'Ces heures sont dans Jira pour ce jour.' : null;
}

/** Le titre de la fenêtre du résultat. */
export function resultTitle(status: SendStatus): string {
    switch (status.state) {
        case 'failed':
            return "Échec de l'envoi";
        case 'unverified':
            return 'Envoi non vérifié';
        default:
            return 'Envoi partiel';
    }
}

/** La tête de la fenêtre du résultat : ce que DayTrack sait, et, dessous, ce qu'y faire. */
export function resultHead(
    rows: readonly SendRow[],
    status: SendStatus,
    tokenRefused: boolean,
): { text: string; muted: string | null } {
    if (status.state === 'failed') {
        const message = failureMessage(status.failure);
        // Une journée vidée n'a plus de saisies à garder, et son ticket retiré dit lui-même ce que Jira garde.
        const hasHours = rows.some((row) => row.removed !== true);

        return {
            text: joined(
                hasHours ? message : message.replace(' Vos saisies restent dans DayTrack.', ''),
                hasHours && status.sentAt !== null ? `Jira garde les heures de l'envoi de ${status.sentAt.time}.` : '',
                removedSentence(rows),
            ),
            muted: null,
        };
    }
    if (status.state === 'unverified') {
        return {
            text: unverifiedSummary(rows, status.failure),
            // Le jeton a pu être remplacé depuis : on dit ce qu'il y a à faire maintenant.
            muted: tokenRefused
                ? "Mettez à jour le jeton, puis réessayez l'envoi : rien ne partira en double."
                : "Réessayer l'envoi vérifie ces heures, sans rien envoyer en double.",
        };
    }

    return { text: partialSummary(rows), muted: null };
}

/**
 * La phrase en tête de la fenêtre d'un envoi partiel : « 3 tickets sur 4 sont dans Jira.
 * SHOP-519 n'a pas été envoyé. » Le ticket qui manque se nomme : la liste range les
 * tickets par durée, et « le dernier » pourrait y désigner un ticket arrivé. Elle ne
 * compte que les tickets qui ont des heures dans la journée.
 */
export function partialSummary(rows: readonly SendRow[]): string {
    const counted = rows.filter((row) => row.removed !== true);
    const fates = counted.map((row) => fateOf(row.failure, row.inJira));
    const total = counted.length;
    const sent = fates.filter((fate) => fate === 'sent').length;
    const anyPartial = fates.includes('partial');

    return joined(arrivalSentence(counted, total, sent, anyPartial), removedSentence(rows));
}

function arrivalSentence(counted: readonly SendRow[], total: number, sent: number, anyPartial: boolean): string {
    if (total === 0) {
        return '';
    }
    if (sent === 0) {
        if (total === 1) {
            return anyPartial ? "Le ticket n'est dans Jira qu'en partie." : "Le ticket n'a pas été envoyé.";
        }

        return anyPartial
            ? `Aucun des ${String(total)} tickets n'est dans Jira en entier.`
            : `Aucun des ${String(total)} tickets n'a été envoyé.`;
    }

    const arrived =
        sent === 1
            ? `1 ticket sur ${String(total)} est dans Jira.`
            : `${String(sent)} tickets sur ${String(total)} sont dans Jira.`;

    return `${arrived} ${missingSentence(counted, anyPartial)}`.trimEnd();
}

/** Ce qui manque, après ce qui est arrivé : nommé s'il n'y en a qu'un ou deux de sorts différents. */
function missingSentence(rows: readonly SendRow[], anyPartial: boolean): string {
    const missing = rows.filter((row) => row.failure != null && !isUnverified(row));
    const partial = missing.find((row) => fateOf(row.failure, row.inJira) === 'partial');
    const absent = missing.find((row) => fateOf(row.failure, row.inJira) === 'absent');

    if (missing.length === 1) {
        return partial === undefined
            ? `${absent?.ticket ?? ''} n'a pas été envoyé.`
            : `${partial.ticket} n'y est qu'en partie.`;
    }
    if (missing.length === 2 && partial !== undefined && absent !== undefined) {
        return `${partial.ticket} n'y est qu'en partie, ${absent.ticket} pas du tout.`;
    }
    if (missing.length === 0) {
        return '';
    }

    return anyPartial
        ? `Les ${String(missing.length)} autres n'y sont pas en entier.`
        : `Les ${String(missing.length)} autres n'ont pas été envoyés.`;
}

/**
 * La phrase en tête d'un envoi non vérifié : ce qui est dans Jira, puis ce que Jira a
 * accepté sans qu'on ait pu le relire, puis ce qui n'est pas parti. Une écriture restée
 * sans réponse n'a pas été acceptée : la phrase le dit.
 */
function unverifiedSummary(rows: readonly SendRow[], failure: SendFailure | null): string {
    const counted = rows.filter((row) => row.removed !== true);
    const fates = counted.map((row) => fateOf(row.failure, row.inJira));
    const total = counted.length;
    const sent = fates.filter((fate) => fate === 'sent').length;
    const unsure = counted.filter(isUnverified);
    const missing = counted.filter((row) => row.failure != null && !isUnverified(row));
    const arrived =
        sent === 0
            ? ''
            : sent === 1
              ? `1 ticket sur ${String(total)} est dans Jira.`
              : `${String(sent)} tickets sur ${String(total)} sont dans Jira.`;

    return joined(
        arrived,
        unsure.length === 0 ? '' : unverifiedSentence(unsure, total, sent, missing.length, failure),
        missingSentence(counted, fates.includes('partial')),
        removedSentence(rows),
        rows
            .filter((row) => row.removed === true && isUnverified(row))
            .map((row) => `DayTrack n'a pas pu vérifier que Jira a retiré les heures de ${row.ticket}.`)
            .join(' '),
    );
}

function unverifiedSentence(
    unsure: readonly SendRow[],
    total: number,
    sent: number,
    missing: number,
    failure: SendFailure | null,
): string {
    const count = unsure.length;
    let which: string;
    if (sent > 0) {
        which = count === 1 ? `de ${unsure[0]?.ticket ?? ''}` : `des ${String(count)} autres tickets`;
    } else if (missing === 0) {
        which = total === 1 ? 'du ticket' : `des ${String(total)} tickets`;
    } else {
        which = count === 1 ? `d'un ticket sur ${String(total)}` : `de ${String(count)} tickets sur ${String(total)}`;
    }

    if (unsure.some((row) => row.failure === 'unanswered')) {
        const cause =
            failure === 'refused'
                ? 'Jira a refusé le jeton enregistré'
                : failure === 'missing_scope'
                  ? 'Il manque au jeton enregistré un périmètre'
                  : "Jira n'a pas répondu";

        return `${cause} pendant l'envoi des heures ${which} : DayTrack n'a pas pu vérifier qu'elles y sont.`;
    }
    if (failure === 'missing_scope') {
        return `Jira a accepté les heures ${which}, mais il manque au jeton enregistré un périmètre pour les relire.`;
    }

    return failure === 'refused'
        ? `Jira a accepté les heures ${which}, puis a refusé le jeton enregistré : DayTrack n'a pas pu vérifier qu'elles y sont.`
        : `Jira a accepté les heures ${which}, puis n'a plus répondu : DayTrack n'a pas pu vérifier qu'elles y sont.`;
}

/** Ce qu'un ticket retiré de la journée garde dans Jira. */
function removedSentence(rows: readonly SendRow[]): string {
    return rows
        .filter((row) => row.removed === true && row.failure != null && !isUnverified(row))
        .map((row) =>
            row.inJira !== undefined && row.inJira > 0
                ? `${row.ticket}, retiré de la journée, a encore ${duration(row.inJira)} dans Jira.`
                : `${row.ticket}, retiré de la journée, a peut-être encore des heures dans Jira.`,
        )
        .join(' ');
}

function isUnverified(row: SendRow): boolean {
    return fateOf(row.failure, row.inJira) === 'unverified';
}

function joined(...sentences: readonly string[]): string {
    return sentences.filter((sentence) => sentence !== '').join(' ');
}

/**
 * Les marques du récapitulatif : seulement quand les tickets n'ont pas tous eu le même
 * sort. La même marque sur chaque carte ne distinguerait rien, et la fenêtre et le bouton
 * le disent déjà.
 */
export function recapFates(
    tickets: readonly RecapTicket[],
    status: SendStatus,
): ReadonlyMap<string, TicketFate> | null {
    if (status.state !== 'partial' && status.state !== 'unverified') {
        return null;
    }

    const fates = new Map(
        tickets.map((ticket) => [
            ticket.ticket,
            fateOf(status.outcomes.get(ticket.ticket), status.inJira.get(ticket.ticket)),
        ]),
    );

    return new Set(fates.values()).size > 1 ? fates : null;
}

/** Ce que dit la fenêtre d'un envoi qui n'a rien pu envoyer. */
export function failureMessage(failure: SendFailure | null): string {
    switch (failure) {
        case 'refused':
            return `L'envoi a échoué. ${TOKEN_EXPIRED}`;
        case 'missing_scope':
            return "L'envoi a échoué. Il manque au jeton enregistré un périmètre dont DayTrack a besoin.";
        default:
            return "L'envoi a échoué. Jira ne répond pas, rien n'a été envoyé. Vos saisies restent dans DayTrack.";
    }
}

/** Le sous-titre d'une fenêtre : le jour pour la confirmation, l'heure de l'envoi ou de l'essai sinon. */
export function sendSubtitle(date: string, status: SendStatus, kind: SendWindowKind): string {
    const moment = kind === 'detail' ? status.sentAt : kind === 'result' ? status.attemptedAt : null;

    return moment === null ? dayLabel(date) : `${dayLabel(moment.date)} à ${moment.time}`;
}

/** Ce qui suit un envoi, une fois la réponse arrivée sur la journée qu'on voit encore. */
export interface AfterSend {
    /**
     * La fenêtre qui s'ouvre d'elle-même : le résultat d'un envoi qui n'a pas tout envoyé,
     * ou le détail d'un envoi complet qui a un ticket retiré à signaler.
     */
    readonly window: SendWindowKind | null;
    readonly confetti: boolean;
    /** Un message en bas de la grille. */
    readonly notice: string | null;
    /** Ce que Jira reproche au jeton, pour le bandeau. */
    readonly tokenRefusal: TokenRefusal | null;
}

export const STALE_SEND = "La journée a changé entre-temps. Rien n'a été envoyé.";
export const SEND_UNANSWERED = "L'envoi n'a pas abouti. Réessayez.";

/**
 * Tout est arrivé, les confettis partent ; sinon la fenêtre du résultat s'ouvre d'elle-même.
 * Un ticket retiré que Jira ne trouve plus ne retient pas la journée, mais il a quelque
 * chose à faire dans Jira : le détail de l'envoi s'ouvre à la place des confettis, et le dit.
 */
export function afterSend(outcome: SendOutcome, status: SendStatus): AfterSend {
    const none = { window: null, confetti: false, notice: null, tokenRefusal: null } as const;
    if (outcome.kind === 'stale') {
        return { ...none, notice: STALE_SEND };
    }

    const tokenRefusal = isTokenRefusal(status.failure) ? status.failure : null;
    if (status.state === 'partial' || status.state === 'unverified' || status.state === 'failed') {
        return { ...none, window: 'result', tokenRefusal };
    }
    if (status.state === 'sent' && outcome.kind === 'done') {
        return status.vanished.length > 0 ? { ...none, window: 'detail' } : { ...none, confetti: true };
    }
    if (outcome.kind === 'failed' && status.state !== 'sending') {
        return { ...none, notice: SEND_UNANSWERED, tokenRefusal };
    }

    return { ...none, tokenRefusal };
}
