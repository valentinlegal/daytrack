import type { JiraApi, LookupResult } from './jiraApi';
import type { JiraStatus } from './jiraStatus';
import type { TicketInfo } from './ticketInfo';

/** Ce que la relecture demande au plus d'un coup (src/Api/Input/TicketsInput.php). */
const REFRESH_MAX = 200;

/**
 * Les tickets que l'écran connaît, avec leur titre et leur type venus de Jira, et la
 * teinte de leur type : ceux d'une journée, des favoris, et ce qu'on tape dans une
 * fenêtre.
 *
 * Il apprend de chaque réponse qui décrit des tickets, et ne garde que ce que le serveur
 * a dit : les blocs, les favoris et le récapitulatif y lisent leur titre. Ce que Jira
 * dit du jeton en passant va à l'état de la connexion, pour le bandeau.
 */
export class TicketBook {
    private readonly api: JiraApi;
    private readonly status: JiraStatus;
    private readonly listeners = new Set<() => void>();
    private tickets: ReadonlyMap<string, TicketInfo> = new Map();

    constructor(api: JiraApi, status: JiraStatus) {
        this.api = api;
        this.status = status;
    }

    /** Les tickets connus ; la carte change à chaque nouveauté, jamais en place. */
    current(): ReadonlyMap<string, TicketInfo> {
        return this.tickets;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);

        return () => {
            this.listeners.delete(listener);
        };
    }

    /** Ce qu'une réponse décrit : une journée, la liste des favoris, une relecture. */
    learn(described: Readonly<Record<string, TicketInfo>>): void {
        let next: Map<string, TicketInfo> | null = null;
        for (const [ticket, info] of Object.entries(described)) {
            const known = this.tickets.get(ticket);
            if (known?.title === info.title && known.type === info.type && known.color === info.color) {
                continue;
            }
            next ??= new Map(this.tickets);
            next.set(ticket, info);
        }
        if (next === null) {
            return;
        }
        this.tickets = next;
        for (const listener of this.listeners) {
            listener();
        }
    }

    /**
     * Fait relire dans Jira ceux de ces tickets dont le titre a vieilli : l'écran le
     * demande après avoir affiché une journée, sans l'attendre. Sans réponse, rien ne
     * change.
     */
    async refresh(tickets: Iterable<string>): Promise<void> {
        const wanted = [...new Set(tickets)].slice(0, REFRESH_MAX);
        if (wanted.length === 0) {
            return;
        }
        try {
            const { tickets: described, refusal } = await this.api.refresh(wanted);
            this.learn(described);
            this.status.learn(refusal);
        } catch {
            // Les titres restent ceux qu'on avait.
        }
    }

    /** Ce que Jira dit d'un ticket qu'on tape. Sans réponse du serveur, Jira est injoignable. */
    async lookup(ticket: string): Promise<LookupResult> {
        let result: LookupResult;
        try {
            result = await this.api.lookup(ticket);
        } catch {
            return { status: 'unreachable' };
        }
        if (result.status === 'found') {
            this.learn({ [ticket]: result.ticket });
        }
        if (result.refusal !== undefined) {
            this.status.learn(result.refusal);
        }

        return result;
    }
}
