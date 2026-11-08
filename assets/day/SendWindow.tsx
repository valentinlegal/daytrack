import { type RefObject, useRef } from 'react';

import { Button } from '../components/Button';
import { CheckIcon, ErrorIcon, RetryIcon, SendIcon, UnverifiedIcon } from '../components/icons';
import { Popover } from '../components/Popover';
import { tokenPixels } from '../components/tokenPixels';
import type { SendStatus } from '../grid/send';
import { isTokenRefusal } from '../jira/jiraStatus';
import { tintOf } from '../jira/ticketInfo';
import { useJiraState, useTickets } from '../jira/TicketsContext';
import { duration } from './format';
import {
    detailHead,
    fateLabel,
    fateMark,
    fateOf,
    resultHead,
    resultTitle,
    RETRY_LABEL,
    SEND_LABEL,
    type SendLineText,
    type SendRow,
    sendSubtitle,
    type SendWindowKind,
    ticketLine,
} from './sendView';
import { TicketChip } from './TicketChip';

/**
 * Les fenêtres du bouton Jira : la confirmation avant l'envoi, le détail d'un envoi
 * réussi, et le résultat d'un envoi partiel ou en échec, ticket par ticket. Sous le
 * bouton, flèche vers lui ; la croix, Échap et un clic à côté ferment sans rien faire.
 */
export function SendWindow({
    kind,
    date,
    status,
    rows,
    worked,
    hasPause,
    anchor,
    onClose,
    onSend,
    onUpdateToken,
    returnFocus,
}: {
    /** null quand aucune n'est ouverte. */
    kind: SendWindowKind | null;
    date: string;
    status: SendStatus;
    rows: readonly SendRow[];
    /** Le temps travaillé du jour, en minutes : le total. */
    worked: number;
    hasPause: boolean;
    anchor: RefObject<HTMLButtonElement | null>;
    onClose: () => void;
    /** « Envoyer sur Jira » dans la confirmation, « Réessayer l'envoi » dans le résultat. */
    onSend: () => void;
    /** « Mettre à jour le jeton », quand Jira l'a refusé. */
    onUpdateToken: () => void;
    returnFocus: () => void;
}) {
    // « Mettre à jour le jeton » tant que Jira le refuse ; remplacé depuis, on réessaie.
    const jira = useJiraState();
    const tokenRefused = isTokenRefusal(jira);
    // Le curseur entre dans la fenêtre, sur son premier bouton du pied : « Annuler » dans
    // la confirmation, pour qu'une Entrée répétée n'envoie jamais rien, « Fermer » ailleurs.
    const firstRef = useRef<HTMLButtonElement>(null);
    const title = kind === 'confirm' ? SEND_LABEL : kind === 'detail' ? 'Envoyé sur Jira' : resultTitle(status);
    const head = resultHead(rows, status, tokenRefused);
    const detail = detailHead(rows);

    return (
        <Popover
            open={kind !== null}
            anchor={anchor}
            side="bottom"
            align="end"
            sideOffset={tokenPixels('--s-3')}
            width="pop-send"
            title={title}
            subtitle={sendSubtitle(date, status, kind ?? 'confirm')}
            onCancel={onClose}
            onOutside={onClose}
            returnFocus={returnFocus}
            initialFocus={firstRef}
            footerEnd={
                kind === 'confirm' ? (
                    <>
                        <Button ref={firstRef} size="sm" onClick={onClose}>
                            Annuler
                        </Button>
                        <Button size="sm" variant="primary" onClick={onSend}>
                            <SendIcon />
                            {SEND_LABEL}
                        </Button>
                    </>
                ) : kind === 'result' ? (
                    <>
                        <Button ref={firstRef} size="sm" onClick={onClose}>
                            Fermer
                        </Button>
                        {tokenRefused ? (
                            <Button size="sm" variant="primary" onClick={onUpdateToken}>
                                Mettre à jour le jeton
                            </Button>
                        ) : (
                            <Button size="sm" variant="primary" onClick={onSend}>
                                <RetryIcon />
                                {RETRY_LABEL}
                            </Button>
                        )}
                    </>
                ) : (
                    <Button ref={firstRef} size="sm" onClick={onClose}>
                        Fermer
                    </Button>
                )
            }
        >
            {kind === 'confirm' && (
                <>
                    <p className="text-sm leading-(--lh) text-ink-2">
                        Les heures déjà déclarées dans Jira pour ce jour seront remplacées par celles-ci.
                    </p>
                    <SendList rows={rows} worked={worked} kind="confirm" />
                    {hasPause && (
                        <p className="-mt-2 text-sm leading-(--lh) text-ink-3">{"La pause n'est pas envoyée."}</p>
                    )}
                </>
            )}
            {kind === 'detail' && (
                <>
                    {detail !== null && <p className="text-sm leading-(--lh) text-ink-2">{detail}</p>}
                    <SendList rows={rows.map((row) => ({ ...row, failure: null }))} worked={worked} kind="detail" />
                </>
            )}
            {kind === 'result' && (
                <>
                    <p className="text-sm leading-(--lh) text-ink-2">
                        <Sentence text={head.text} />
                    </p>
                    {head.muted !== null && <p className="-mt-2 text-sm leading-(--lh) text-ink-2">{head.muted}</p>}
                    {/* Un échec a une seule raison, dite au-dessus : chaque ticket n'y porte que sa marque. */}
                    <SendList rows={rows} worked={null} kind="result" reasons={status.state !== 'failed'} />
                </>
            )}
        </Popover>
    );
}

/** Une phrase où un identifiant ne se coupe jamais à son tiret. */
function Sentence({ text }: { text: string }) {
    return text.split(/([A-Z][A-Z0-9_]*-\d+)/).map((part, index) =>
        index % 2 === 1 ? (
            <span key={part} className="whitespace-nowrap">
                {part}
            </span>
        ) : (
            part
        ),
    );
}

/**
 * La liste des tickets, en tableau : chaque ligne — sa marque d'arrivée quand la fenêtre
 * la dit, sa pastille, son titre, son temps — partage les colonnes des autres, si bien
 * que les titres s'alignent quelle que soit la longueur de l'identifiant ; puis le total.
 */
function SendList({
    rows,
    worked,
    kind,
    reasons = true,
}: {
    rows: readonly SendRow[];
    worked: number | null;
    kind: SendWindowKind;
    /** Sous un ticket qui n'est pas arrivé, pourquoi. */
    reasons?: boolean;
}) {
    return (
        <ul
            className="send-list overflow-hidden rounded-2 border border-line"
            data-marks={rows.some((row) => row.failure !== undefined) || undefined}
        >
            {rows.map((row) => (
                <SendLine key={row.ticket} row={row} kind={kind} reason={reasons} />
            ))}
            {worked !== null && (
                <li className="border-t border-line bg-bg-sel px-3 py-2">
                    <span className="send-total min-w-0 truncate text-sm font-semibold">Total</span>
                    <span className="justify-self-end font-mono text-sm font-semibold">{duration(worked)}</span>
                </li>
            )}
        </ul>
    );
}

function SendLine({ row, kind, reason }: { row: SendRow; kind: SendWindowKind; reason: boolean }) {
    const info = useTickets().get(row.ticket);
    // Un échec n'a qu'une raison, dite au-dessus ; ce que Jira garde d'un ticket retiré se dit toujours.
    const line = reason || row.removed === true ? ticketLine(row, kind) : null;

    return (
        <li data-color={tintOf(info)} className="border-t border-line-soft px-3 py-2 first:border-none">
            {row.failure !== undefined && <FateMark row={row} />}
            <TicketChip ticket={row.ticket} />
            <span className="min-w-0 truncate text-sm text-ink-2">{info?.title ?? ''}</span>
            <span className="justify-self-end font-mono text-sm text-ink">{duration(row.minutes)}</span>
            {line !== null && <span className={`send-why basis-full text-sm ${TONES[line.tone]}`}>{line.text}</span>}
        </li>
    );
}

/** Le ton d'une ligne : un refus en rouge, un avertissement en couleur du texte, le reste discret. */
const TONES: Record<SendLineText['tone'], string> = {
    error: 'text-inc',
    soft: 'text-ink-2',
    warning: 'text-ink',
};

/**
 * La marque d'un ticket : la coche, l'icône d'erreur, le « ? » de ce que DayTrack n'a pas
 * pu relire, ou l'avertissement d'un ticket que Jira ne trouve plus.
 */
function FateMark({ row }: { row: SendRow }) {
    const fate = fateOf(row.failure, row.inJira, row.vanished);
    const mark = fateMark(fate);

    return (
        <span className="flex w-4 flex-none items-center justify-center">
            {mark === 'ok' ? (
                <CheckIcon />
            ) : mark === 'unverified' ? (
                <UnverifiedIcon />
            ) : (
                <ErrorIcon tone={mark === 'warning' ? 'warning' : 'error'} />
            )}
            <span className="sr-only">{fateLabel(fate, row.removed === true)}</span>
        </span>
    );
}
