import { hasTicketShape } from '../grid/entry';
import { TICKET_NOT_FOUND } from '../jira/lookupMessages';
import type { TicketCheck } from '../jira/useTicketLookup';
import { TICKET_SHAPE_REFUSAL } from './messages';

/**
 * Les règles d'un champ Ticket — la fenêtre de ticket, le formulaire d'ajout d'un favori —,
 * écrites une fois : sa forme se juge quand on le quitte, un ticket que Jira ne connaît pas
 * bloque l'enregistrement, qui attend sa réponse quand il cherche encore, et un seul
 * enregistrement part à la fois. Ce que l'écran en montre est dans TicketField.tsx.
 */

/**
 * La forme du ticket tapé, jugée quand on quitte son champ, jamais pendant la frappe : son
 * refus, ou rien. Un champ vide n'a pas de forme à juger.
 */
export function shapeRefusal(typed: string): string | null {
    return hasTicketShape(typed) ? null : TICKET_SHAPE_REFUSAL;
}

/**
 * Ce que le champ dit sous lui : le refus d'un enregistrement ou d'une forme, sinon un
 * ticket que Jira ne connaît pas, dès qu'il l'a dit.
 */
export function ticketError(refusal: string | null, check: TicketCheck): string | null {
    return refusal ?? (check.refused ? TICKET_NOT_FOUND : null);
}

/** Ce que fait un enregistrement, étape par étape (TicketSave.run). */
export interface SaveSteps<T> {
    /**
     * Ce que Jira sait du ticket tapé ; null quand il n'y a pas de ticket à vérifier : un
     * nom, une pause, un effacement.
     */
    readonly check: TicketCheck | null;
    /**
     * L'écran montre encore l'enregistrement en route, alors que sa réponse est arrivée : un
     * geste fait avant qu'il l'ait montrée. C'est elle qui vaut pour lui, et rien ne repart.
     */
    readonly sending: boolean;
    /** Un refus connu d'avance, sans rien envoyer : un ticket manquant, une forme refusée. */
    readonly refusal?: string | null;
    /**
     * Le refus se dit sous le champ, le curseur dedans, et rien n'est écrit.
     *
     * @param answered Jira vient de dire qu'il ne connaît pas le ticket : l'écran montrait
     *                 l'enregistrement en route, il ne le montre plus
     */
    refuse(message: string, answered: boolean): void;
    /**
     * L'enregistrement part : l'écran le montre en route, et ce qui s'écrira une fois Jira
     * d'accord est rendu. Quand rien n'est à écrire, la réponse à rendre tout de suite.
     */
    start(): (() => Promise<T>) | boolean;
    /** Ce que l'écran fait de la réponse ; vrai quand c'est fini, la fenêtre fermée. */
    settle(result: T): boolean;
}

/**
 * L'enregistrement d'une fenêtre ou d'un formulaire qui a un champ Ticket. Un seul part à la
 * fois : Entrée répétée, un clic à côté pendant qu'il est en route, un autre geste qui
 * quitte la fenêtre attendent le sien, sans en lancer un second.
 *
 * Un ticket que Jira ne connaît pas ne part pas, quel que soit le geste. Quand Jira le
 * cherche encore, ou n'a pas pu le vérifier, l'enregistrement attend sa réponse, l'écran
 * le montrant en route : introuvable, rien ne s'écrit et le refus se dit sous le champ.
 */
export class TicketSave {
    private pending: Promise<boolean> | null = null;
    /** Ce qu'a donné le dernier enregistrement parti : fini, la fenêtre fermée, ou non. */
    private answered = false;

    /** L'enregistrement en route, que les autres gestes attendent ; null s'il n'y en a pas. */
    get current(): Promise<boolean> | null {
        return this.pending;
    }

    /** La promesse dit si c'est fini, la fenêtre fermée ; refusée, elle reste ouverte. */
    run<T>(steps: SaveSteps<T>): Promise<boolean> {
        if (this.pending !== null) {
            return this.pending;
        }
        if (steps.sending) {
            return Promise.resolve(this.answered);
        }
        const refusal = steps.refusal ?? (steps.check?.refused === true ? TICKET_NOT_FOUND : null);
        if (refusal !== null) {
            steps.refuse(refusal, false);

            return Promise.resolve(false);
        }
        const write = steps.start();
        if (typeof write === 'boolean') {
            return Promise.resolve(write);
        }
        const pending = (steps.check?.known() ?? Promise.resolve(true)).then(async (exists) => {
            if (!exists) {
                this.pending = null;
                this.answered = false;
                steps.refuse(TICKET_NOT_FOUND, true);

                return false;
            }
            const result = await write();
            this.pending = null;
            this.answered = steps.settle(result);

            return this.answered;
        });
        this.pending = pending;

        return pending;
    }
}
