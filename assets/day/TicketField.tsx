import { type KeyboardEvent, type Ref, type RefObject, useEffect } from 'react';

import { Field, type FieldProps } from '../components/Field';
import { typedTicket } from '../grid/entry';
import { normalizeTicket } from '../grid/grid';
import { lookupWarning } from '../jira/lookupMessages';
import { type Lookup, NO_CHECK, type TicketCheck, useTicketLookup } from '../jira/useTicketLookup';
import { rewrite } from './rewrite';
import { ticketError } from './ticketSave';

/** Ce que Jira sait du ticket tapé dans un champ Ticket, et ce qu'en doit savoir l'enregistrement. */
export interface TicketFieldState {
    readonly lookup: Lookup;
    readonly check: TicketCheck;
}

/**
 * Ce que Jira dit du ticket tapé, et ce qu'enregistrer en doit savoir (ticketSave.ts). Le
 * crochet qui enregistre le lit dans `checkRef` : un autre geste qui quitte la fenêtre
 * n'enregistre rien que Jira ait refusé, et attend sa réponse.
 *
 * @param kept le ticket que la saisie porte déjà ; vide pour une saisie neuve. Le garder
 *             n'attend pas Jira, qui ne peut pas le vérifier : changer un commentaire n'a pas
 *             à dépendre de lui. Seule une recherche en cours s'attend.
 */
export function useTicketField(typed: string, kept: string, checkRef: RefObject<TicketCheck>): TicketFieldState {
    const { lookup, check } = useTicketLookup(typed);
    const unchanged = normalizeTicket(typed) === normalizeTicket(kept);
    const checked: TicketCheck = {
        refused: check.refused,
        known: () => (unchanged && lookup.status !== 'searching' ? undefined : check.known()),
    };
    useEffect(() => {
        checkRef.current = checked;
    });
    useEffect(
        () => () => {
            checkRef.current = NO_CHECK;
        },
        [checkRef],
    );

    return { lookup, check: checked };
}

/**
 * Entrée enregistre, une fois : une touche tenue ne renvoie pas l'enregistrement à chaque
 * répétition.
 */
export function saveOnEnter(save: () => void) {
    return (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            if (!event.repeat) {
                save();
            }
        }
    };
}

/**
 * Une Entrée tenue sur ce qui prend le curseur une fois le formulaire enregistré — le + de
 * l'en-tête, la carte d'un favori — ne l'active qu'une fois : ses répétitions rouvriraient
 * un formulaire vide, ou recopieraient le favori.
 */
export function ignoreHeldEnter(event: KeyboardEvent): void {
    if (event.key === 'Enter' && event.repeat) {
        event.preventDefault();
    }
}

export interface TicketFieldProps extends Omit<
    FieldProps,
    'value' | 'onChange' | 'onBlur' | 'onKeyDown' | 'error' | 'warning' | 'mono'
> {
    readonly ref?: Ref<HTMLInputElement>;
    readonly field: TicketFieldState;
    readonly value: string;
    /** Le refus d'un enregistrement ou d'une forme ; null sinon. */
    readonly refusal: string | null;
    /** Le ticket tapé, récrit : majuscules, sans espaces, l'identifiant d'une adresse collée. */
    readonly onTicket: (ticket: string) => void;
    /** On quitte le champ : sa forme se juge (shapeRefusal). */
    readonly onLeave: () => void;
    /** Entrée : enregistrer. */
    readonly onEnter: () => void;
}

/**
 * Le champ Ticket de la fenêtre de ticket et du formulaire d'ajout d'un favori. Le ticket
 * se récrit pendant la frappe sans déplacer le curseur, sa forme se juge quand on quitte le
 * champ, un ticket que Jira ne connaît pas se dit dessous, et ce qui empêche de le vérifier
 * aussi, sans le refuser.
 */
export function TicketField({ ref, field, value, refusal, onTicket, onLeave, onEnter, ...props }: TicketFieldProps) {
    return (
        <Field
            ref={ref}
            mono
            value={value}
            error={ticketError(refusal, field.check)}
            warning={lookupWarning(field.lookup)}
            onChange={(event) => {
                onTicket(rewrite(event.target, typedTicket));
            }}
            onBlur={onLeave}
            onKeyDown={saveOnEnter(onEnter)}
            {...props}
        />
    );
}
