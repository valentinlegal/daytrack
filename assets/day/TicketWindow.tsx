import { type MouseEvent, type RefObject, useEffect, useId, useMemo, useRef, useState } from 'react';

import { Button } from '../components/Button';
import { GeneralError } from '../components/Field';
import { CupIcon, TrashIcon } from '../components/icons';
import { type Measurable, Popover } from '../components/Popover';
import { TextArea } from '../components/TextArea';
import { tokenPixels } from '../components/tokenPixels';
import { Tooltip } from '../components/Tooltip';
import { draftOf, quartersOf, saveDisabled, typedComment } from '../grid/entry';
import { describedTicket, tintOf } from '../jira/ticketInfo';
import type { Lookup, TicketCheck } from '../jira/useTicketLookup';
import { dayLabel } from './calendar';
import { windowSubtitle } from './messages';
import { rewrite } from './rewrite';
import { saveOnEnter, TicketField, useTicketField } from './TicketField';
import type { PlacedWindow, TicketWindow as TicketWindowState } from './useGridEditing';

/**
 * Les fenêtres Nouveau ticket, Modifier le ticket et Modifier la sélection : ouvertes au
 * pointeur, accrochées au créneau, à la sélection ou au quart d'heure du bloc qui les a
 * ouvertes, qu'elles suivent quand la grille défile. Sur une sélection déjà saisie,
 * Nouveau ticket dit ce qu'elle remplacera ; sur une partie de bloc, Modifier la
 * sélection dit que le reste ne bouge pas. Toutes s'ouvrent le curseur dans le champ
 * Ticket.
 *
 * On y saisit comme dans une cellule de tableur : Entrée ou un clic à côté
 * enregistrent, la croix, Échap et « Annuler » abandonnent. Un refus garde la fenêtre
 * ouverte, ce qui a été tapé, et le message sous son champ. Le ticket se récrit
 * pendant la frappe, et sa forme se juge quand on quitte son champ.
 */
export function TicketWindow({
    date,
    window: shown,
    note,
    place,
    gridRef,
    checkRef,
    onDraft,
    onSave,
    onCancel,
    onPause,
    onDelete,
    onCheckTicket,
    returnFocus,
}: {
    date: string;
    window: TicketWindowState | null;
    /**
     * Sous les champs : ce que Nouveau ticket remplacera, « Remplace SHOP-482 sur ces 30
     * minutes. », ou « Modifie SHOP-482 sur ces 45 minutes seulement. ».
     */
    note: string | null;
    /** Ce à quoi la fenêtre s'accroche, selon sa hauteur. */
    place: ((height: number) => PlacedWindow) | null;
    /** La grille : la fenêtre se replace quand elle défile. */
    gridRef: RefObject<HTMLElement | null>;
    /** Où dire ce que Jira sait du ticket tapé : un autre geste qui quitte la fenêtre le lit. */
    checkRef: RefObject<TicketCheck>;
    onDraft: (draft: TicketWindowState['draft']) => void;
    /** Ce que Jira sait du ticket tapé : l'enregistrement attend sa réponse quand il le cherche encore. */
    onSave: (check: TicketCheck) => void;
    onCancel: () => void;
    onPause: () => void;
    onDelete: () => void;
    /** On quitte le champ Ticket : sa forme se juge. */
    onCheckTicket: () => void;
    returnFocus: () => void;
}) {
    const ticketRef = useRef<HTMLInputElement>(null);
    const commentRef = useRef<HTMLTextAreaElement>(null);
    const noteId = useId();
    const previewId = useId();
    // Ce que Jira dit du ticket tapé ; « Enregistrer » pendant la recherche l'attend. Un bloc
    // qui garde son ticket ne l'attend pas (useTicketField).
    const field = useTicketField(
        shown?.draft.ticket ?? '',
        shown === null ? '' : draftOf(shown.target).ticket,
        checkRef,
    );
    const { lookup, check } = field;
    const unknownTicket = check.refused;
    // Son créneau sorti de la vue, elle s'est arrêtée au bord : sa flèche désignerait un autre.
    const [stopped, setStopped] = useState(false);

    // La fenêtre se mesure quand Radix la place, et à chaque fois que la grille défile :
    // selon sa hauteur, Nouveau ticket passe dessous ou s'accroche plus haut
    // (windowPlacement.ts).
    const anchor = useMemo<RefObject<Measurable | null>>(() => {
        const height = () => ticketRef.current?.closest('[role="dialog"]')?.getBoundingClientRect().height ?? 0;

        return {
            current:
                place === null
                    ? null
                    : {
                          get contextElement() {
                              return gridRef.current ?? undefined;
                          },
                          getBoundingClientRect: () => {
                              const placed = place(height());
                              setStopped(placed.stopped);

                              return placed.rect;
                          },
                      },
        };
    }, [place, gridRef]);

    // Un enregistrement refusé pose le curseur sur le premier champ refusé, là où est le
    // message ; un refus dit en quittant le champ Ticket le laisse où on allait.
    const errors = shown?.errors ?? null;
    useEffect(() => {
        if (errors?.focus !== true) {
            return;
        }
        if (errors.ticket !== null) {
            ticketRef.current?.focus();
        } else if (errors.comment !== null) {
            commentRef.current?.focus();
        }
    }, [errors]);

    if (shown === null || errors === null) {
        return null;
    }
    const { target, draft, sending } = shown;
    const editing = target.kind === 'edit';
    const part = target.kind === 'part';
    const pause = editing && target.block.content.kind === 'pause';
    const title = part
        ? 'Modifier la sélection'
        : !editing
          ? 'Nouveau ticket'
          : pause
            ? 'Modifier la pause'
            : 'Modifier le ticket';
    // Un ticket que Jira ne connaît pas ne s'enregistre pas : le refus est sous le champ,
    // et un clic à côté garde la fenêtre ouverte.
    const blocked = saveDisabled(target, draft) || unknownTicket;

    /**
     * Enregistre, une fois que Jira a répondu sur le ticket tapé : pendant la recherche, ou
     * s'il n'a pas pu le vérifier, la fenêtre attend sa réponse comme elle attend le
     * serveur, puis enregistre ou montre le refus.
     */
    const save = () => {
        if (unknownTicket) {
            return;
        }
        onSave(check);
    };

    /**
     * Un bouton du pied fait son geste sans prendre le curseur au champ : le champ Ticket
     * quitté jugerait d'abord sa forme, et le refus apparu sous lui pousserait le pied
     * sous le pointeur, le clic tombant à côté. Enregistrer la juge de toute façon.
     */
    const keepFocus = (event: MouseEvent) => {
        event.preventDefault();
    };

    const onEnter = () => {
        if (!blocked) {
            save();
        }
    };

    return (
        <Popover
            key={shown.key}
            open
            anchor={anchor}
            // Au-dessus ou dessous, selon le rectangle que rend place (useGridEditing.tsx),
            // qui part du bord gauche de la fenêtre.
            side="top"
            align="start"
            sideOffset={tokenPixels('--s-3')}
            title={title}
            subtitle={windowSubtitle(dayLabel(date), quartersOf(target))}
            arrowHidden={stopped}
            sending={sending}
            initialFocus={ticketRef}
            returnFocus={returnFocus}
            onCancel={onCancel}
            onOutside={save}
            footerStart={
                editing || part ? (
                    <>
                        {/* Sur une sélection, la corbeille efface, comme « Effacer » du menu. */}
                        <Tooltip label={part ? 'Effacer' : 'Supprimer'}>
                            <Button
                                variant="danger"
                                size="sm"
                                iconOnly
                                aria-label={part ? 'Effacer' : 'Supprimer'}
                                onMouseDown={keepFocus}
                                onClick={onDelete}
                            >
                                <TrashIcon />
                            </Button>
                        </Tooltip>
                        {!pause && (
                            <Tooltip label="Convertir en pause">
                                <Button
                                    size="sm"
                                    iconOnly
                                    aria-label="Convertir en pause"
                                    onMouseDown={keepFocus}
                                    onClick={onPause}
                                >
                                    <CupIcon />
                                </Button>
                            </Tooltip>
                        )}
                    </>
                ) : (
                    <Button size="sm" onMouseDown={keepFocus} onClick={onPause}>
                        <CupIcon />
                        Pause
                    </Button>
                )
            }
            footerEnd={
                <>
                    <Button size="sm" onMouseDown={keepFocus} onClick={onCancel}>
                        Annuler
                    </Button>
                    <Button
                        variant="primary"
                        size="sm"
                        aria-disabled={blocked || undefined}
                        busy={sending}
                        onMouseDown={keepFocus}
                        onClick={blocked ? undefined : save}
                    >
                        Enregistrer
                    </Button>
                </>
            }
        >
            <div className="relative">
                <TicketField
                    ref={ticketRef}
                    label="Ticket"
                    narrow
                    field={field}
                    value={draft.ticket}
                    refusal={errors.ticket}
                    onTicket={(ticket) => {
                        onDraft({ ...draft, ticket });
                    }}
                    onLeave={onCheckTicket}
                    onEnter={onEnter}
                    // Le champ où le curseur arrive annonce le remplacement, et dit le ticket
                    // que Jira a trouvé. Refusé, il désigne son refus, que le champ relie lui-même.
                    aria-describedby={
                        [
                            note !== null && errors.ticket === null ? noteId : null,
                            lookup.status === 'found' || lookup.status === 'searching' ? previewId : null,
                        ]
                            .filter((id) => id !== null)
                            .join(' ') || undefined
                    }
                />
                <TicketPreview id={previewId} lookup={lookup} />
            </div>
            <TextArea
                ref={commentRef}
                label="Commentaire"
                optional
                placeholder="Ce qui a été fait"
                value={draft.comment}
                error={errors.comment}
                onChange={(event) => {
                    onDraft({ ...draft, comment: rewrite(event.target, typedComment) });
                }}
                onKeyDown={saveOnEnter(onEnter)}
            />
            {note !== null && (
                <p id={noteId} className="flex gap-2 text-sm text-ink-2">
                    {note}
                </p>
            )}
            {errors.general !== null && <GeneralError message={errors.general} />}
        </Popover>
    );
}

/**
 * L'aperçu du ticket, à côté du champ de 160 px, comme la ville à côté du code postal :
 * « Recherche dans Jira… » en gris pendant la recherche, puis le titre, sur deux lignes
 * au plus, type et titre entiers dans l'infobulle, à la teinte de son type.
 */
function TicketPreview({ id, lookup }: { id: string; lookup: Lookup }) {
    if (lookup.status === 'searching') {
        return (
            <div id={id} data-state="searching" className="ticket-preview">
                <span className="text-ink-3">Recherche dans Jira…</span>
            </div>
        );
    }
    if (lookup.status !== 'found' || lookup.info.title === null) {
        return null;
    }

    return (
        <Tooltip label={describedTicket(lookup.info) ?? lookup.info.title}>
            <div id={id} data-color={tintOf(lookup.info)} className="ticket-preview">
                <span className="line-clamp-2 text-ink">{lookup.info.title}</span>
            </div>
        </Tooltip>
    );
}
