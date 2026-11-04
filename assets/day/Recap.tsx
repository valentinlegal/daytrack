import { type RefObject } from 'react';

import { Button } from '../components/Button';
import { Tooltip } from '../components/Tooltip';
import type { RecapTicket } from '../grid/recap';
import { tintOf } from '../jira/ticketInfo';
import { useTickets } from '../jira/TicketsContext';
import { duration } from './format';
import { RecapChip } from './TicketChip';
import { CloseIcon, ErrorIcon, PanelFilledIcon, UnverifiedIcon } from '../components/icons';
import type { TicketFate } from './sendView';

/**
 * Le récapitulatif : un ticket par carte, du plus long au plus court, et une ligne par
 * commentaire.
 *
 * À partir de 1280 px, il pousse la grille et son en-tête porte l'icône qui le
 * masque ; en dessous, il s'ouvre par-dessus elle et porte une croix (day.css).
 * Fermé, il reste dans la page pour que le bouton qui l'ouvre le désigne, mais
 * n'est plus ni visible ni atteignable. Il découpe son contenu sans jamais le faire
 * défiler (overflow-clip) : le focus posé pendant qu'il s'ouvre décalait sinon ce
 * contenu, et son bord gauche sortait du cadre.
 */
export function Recap({
    tickets,
    open,
    onClose,
    hideRef,
    fates = null,
}: {
    /** null tant que la journée n'est pas lue. */
    tickets: readonly RecapTicket[] | null;
    /**
     * Après un envoi interrompu, ce que chaque ticket est devenu, quand ils n'ont pas tous
     * eu le même sort : chaque carte le dit à côté de son type. null sinon.
     */
    fates?: ReadonlyMap<string, TicketFate> | null;
    open: boolean;
    onClose: () => void;
    /** L'icône qui masque le panneau, où le focus passe quand il s'ouvre depuis la barre. */
    hideRef: RefObject<HTMLButtonElement | null>;
}) {
    return (
        <aside
            id="recap"
            aria-label="Récapitulatif"
            data-state={open ? 'open' : 'closed'}
            className="recap-panel flex min-h-0 w-recap flex-none flex-col overflow-clip bg-bg lg:data-[state=closed]:w-0"
        >
            <div className="flex min-h-0 w-recap flex-1 flex-col border-l border-line">
                <div className="flex h-bar w-recap flex-none items-center justify-between border-b border-line pr-3 pl-5">
                    <h2 className="text-lg font-bold">Récapitulatif</h2>
                    <span className="inline-flex max-lg:hidden">
                        <Tooltip label="Masquer le récapitulatif">
                            <Button
                                ref={hideRef}
                                variant="ghost"
                                size="sm"
                                iconOnly
                                aria-expanded={open}
                                aria-controls="recap"
                                aria-label="Masquer le récapitulatif"
                                onClick={onClose}
                            >
                                <PanelFilledIcon />
                            </Button>
                        </Tooltip>
                    </span>
                    <span className="hidden max-lg:inline-flex">
                        <Button
                            variant="ghost"
                            size="sm"
                            iconOnly
                            aria-label="Fermer le récapitulatif"
                            onClick={onClose}
                        >
                            <CloseIcon />
                        </Button>
                    </span>
                </div>
                <div
                    role="region"
                    aria-label="Tickets du jour"
                    // Une zone qui défile se parcourt aussi au clavier.
                    tabIndex={0}
                    className="min-h-0 w-recap flex-1 overflow-auto"
                >
                    {tickets !== null && tickets.length === 0 && (
                        <p className="flex flex-col gap-2 px-5 py-7 text-center text-ink-3">
                            <b className="font-semibold text-ink-2">Aucun ticket</b>
                            <span>Le récapitulatif se remplit au fil de la journée.</span>
                        </p>
                    )}
                    {tickets !== null && tickets.length > 0 && (
                        <ul>
                            {tickets.map((ticket) => (
                                <RecapCard
                                    key={ticket.ticket}
                                    ticket={ticket}
                                    fate={fates?.get(ticket.ticket) ?? null}
                                />
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </aside>
    );
}

/**
 * Un ticket du jour : sa pastille à la teinte de son type, son type, sa durée, puis son
 * titre écrit en entier, tels que Jira les décrit.
 */
function RecapCard({ ticket, fate }: { ticket: RecapTicket; fate: TicketFate | null }) {
    const info = useTickets().get(ticket.ticket);
    const type = info?.type ?? null;
    const title = info?.title ?? null;

    return (
        <li data-color={tintOf(info)} className="flex flex-col gap-1 border-b border-line-soft px-5 py-4">
            <div className="flex items-center gap-2">
                <RecapChip ticket={ticket.ticket} />
                {type !== null && (
                    <span className="recap-type min-w-0 truncate text-xs text-ink-3">
                        <span className="sr-only">, </span>
                        {type}
                    </span>
                )}
                {fate !== null && (
                    // Comme partout, une erreur passe son texte en rouge, un succès reste discret.
                    <span
                        className={`recap-send inline-flex flex-none items-center gap-2 text-xs ${fate === 'absent' || fate === 'partial' ? 'font-medium text-inc' : 'text-ink-2'}`}
                    >
                        <span className="sr-only">, </span>
                        {fate === 'sent' ? (
                            <span aria-hidden="true" className="day-mark" data-mark="sent" />
                        ) : (
                            <span className="recap-error">
                                {fate === 'unverified' ? <UnverifiedIcon /> : <ErrorIcon />}
                            </span>
                        )}
                        {FATE_LABELS[fate]}
                    </span>
                )}
                <span className="ml-auto flex-none text-lg font-bold tabular-nums">
                    <span className="sr-only">, </span>
                    {duration(ticket.minutes)}
                </span>
            </div>
            {title !== null && <div className="mb-1 text-md leading-(--lh)">{title}</div>}
            {ticket.comments.map((comment) => (
                <div key={comment.text} className="flex items-baseline gap-3 text-sm text-ink-2 recap-dash">
                    <span className="min-w-0 flex-1">{comment.text}</span>
                    <span className="font-mono text-xs text-ink-3">
                        <span className="sr-only">, </span>
                        {duration(comment.minutes)}
                    </span>
                </div>
            ))}
        </li>
    );
}

const FATE_LABELS: Record<TicketFate, string> = {
    sent: 'Envoyé',
    absent: 'Non envoyé',
    partial: 'Envoyé en partie',
    unverified: 'Non vérifié',
};
