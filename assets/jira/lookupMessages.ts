import type { Lookup } from './useTicketLookup';

/** Le refus d'un ticket que Jira ne connaît pas (src/Jira/TicketsExistInJira.php). */
export const TICKET_NOT_FOUND = "Ticket introuvable dans Jira. Vérifiez l'identifiant.";

/**
 * L'avertissement sous le champ d'un ticket que Jira ne peut pas vérifier : la saisie
 * passe quand même, et le ticket sera vérifié plus tard.
 */
export function lookupWarning(lookup: Lookup): string | null {
    switch (lookup.status) {
        case 'unreachable':
            return "Jira ne répond pas. Le ticket sera vérifié à l'envoi.";
        case 'refused':
        case 'missing_scope':
            return 'Impossible de vérifier ce ticket, Jira refuse le jeton enregistré.';
        default:
            return null;
    }
}
