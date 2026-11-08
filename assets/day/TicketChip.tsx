import { type ComponentProps, useLayoutEffect, useRef, useState } from 'react';

import { Tooltip } from '../components/Tooltip';

/** Jusque-là, un identifiant tient toujours dans deux fois --w-id. */
const NEVER_CUT = 20;

/**
 * Un identifiant de ticket : au-delà de deux fois --w-id, la clé du projet se coupe et le
 * tiret reste avec le numéro, entier, ce qui distingue deux tickets d'un même projet.
 *
 * Coupé, il s'affiche en deux morceaux que le navigateur expose comme deux textes : le
 * lecteur d'écran lirait la clé, puis le numéro comme un nombre négatif. Les morceaux lui
 * sont donc cachés, et il lit l'identifiant entier, d'un seul tenant. Ce texte-là ne se
 * sélectionne pas : copier la pastille ne donne pas l'identifiant deux fois.
 */
export function TicketId({ ticket, keyRef }: { ticket: string; keyRef?: ComponentProps<'span'>['ref'] }) {
    const dash = ticket.lastIndexOf('-');
    if (ticket.length <= NEVER_CUT || dash <= 0) {
        return ticket;
    }

    return (
        <span className="flex max-w-ticket min-w-0">
            <span ref={keyRef} aria-hidden="true" className="min-w-0 overflow-hidden text-ellipsis">
                {ticket.slice(0, dash)}
            </span>
            <span aria-hidden="true" className="flex-none whitespace-nowrap">
                {ticket.slice(dash)}
            </span>
            <span className="sr-only select-none">{ticket}</span>
        </span>
    );
}

/**
 * La pastille d'identifiant : partout où un ticket apparaît hors de la grille — favoris,
 * récapitulatif, fenêtres de l'envoi. Sa teinte vient du data-color de ce qui l'entoure.
 * Elle garde la largeur de son identifiant, en colonne comme dans la cellule d'un
 * tableau, où le plus long des identifiants fait la largeur de la colonne.
 */
export function TicketChip({
    ticket,
    ref,
    keyRef,
    ...props
}: { ticket: string; keyRef?: ComponentProps<'span'>['ref'] } & ComponentProps<'span'>) {
    return (
        <span
            {...props}
            ref={ref}
            className="inline-flex h-5 max-w-full min-w-0 items-center self-start justify-self-start rounded-1 border border-ty-line bg-ty-bg px-2 font-mono text-sm font-semibold whitespace-nowrap text-ty-id"
        >
            <TicketId ticket={ticket} keyRef={keyRef} />
        </span>
    );
}

/** La pastille du récapitulatif : coupée, elle a l'infobulle de l'identifiant entier. */
export function RecapChip({ ticket }: { ticket: string }) {
    const keyRef = useRef<HTMLSpanElement>(null);
    const [cut, setCut] = useState(false);

    useLayoutEffect(() => {
        const measure = () => {
            const key = keyRef.current;
            setCut(key !== null && key.scrollWidth > key.clientWidth);
        };
        measure();
        // La police de l'identifiant change sa largeur : elle arrive après le premier rendu.
        let current = true;
        void document.fonts.ready.then(() => {
            if (current) {
                measure();
            }
        });

        return () => {
            current = false;
        };
    }, [ticket]);

    const chip = <TicketChip ticket={ticket} keyRef={keyRef} />;

    return cut ? <Tooltip label={ticket}>{chip}</Tooltip> : chip;
}
