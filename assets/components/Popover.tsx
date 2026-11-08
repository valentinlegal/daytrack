import { Popover as RadixPopover } from 'radix-ui';
import { type ReactNode, type RefObject, useId } from 'react';

import { Button } from './Button';
import { CloseIcon } from './icons';
import { tokenPixels } from './tokenPixels';

/** Ce à quoi une fenêtre s'accroche : un élément, ou un rectangle que l'écran calcule. */
export interface Measurable {
    getBoundingClientRect(): DOMRect;
    /** Ce rectangle suit cet élément : la fenêtre se replace quand ce qui le contient défile. */
    readonly contextElement?: Element | undefined;
}

export type PopoverWidth = 'pop' | 'pop-sm' | 'pop-md' | 'pop-send';

// Des classes écrites en entier : Tailwind ne génère que ce qu'il lit.
const WIDTHS: Record<PopoverWidth, string> = {
    pop: 'w-pop',
    'pop-sm': 'w-pop-sm',
    'pop-md': 'w-pop-md',
    'pop-send': 'w-pop-send',
};

export interface PopoverProps {
    open: boolean;
    anchor: RefObject<Measurable | null>;
    /** De quel côté de ce qui l'a ouverte la fenêtre se pose ; sa flèche pointe vers lui. */
    side: 'top' | 'right' | 'bottom';
    align?: 'start' | 'center' | 'end';
    /** L'écart avec ce qui l'a ouverte, flèche comprise, en pixels. */
    sideOffset?: number;
    alignOffset?: number;
    width?: PopoverWidth;
    /**
     * Pour ce qui s'ouvre hors de la journée, un bandeau : elle ne peut pas fermer le
     * récapitulatif posé sur la grille, comme les autres, et passe donc au-dessus.
     */
    overRecap?: boolean;
    title: string;
    subtitle?: string;
    /** La croix et Échap : fermer sans rien faire. */
    onCancel: () => void;
    /**
     * Un clic à côté, ou le focus parti ailleurs. Une fenêtre où l'on saisit enregistre
     * puis ferme ; les autres ferment sans rien faire.
     */
    onOutside: () => void;
    /** Elle ne désigne plus ce qui l'a ouverte : sa flèche disparaît, sans que la fenêtre bouge. */
    arrowHidden?: boolean;
    /** Le temps d'un enregistrement : la croix est grisée, Échap et le clic à côté sont retenus. */
    sending?: boolean;
    /** Le champ où le curseur se pose à l'ouverture. */
    initialFocus?: RefObject<HTMLElement | null>;
    /**
     * Rend le curseur à ce qui a ouvert la fenêtre, s'il s'est perdu avec elle. Un
     * curseur posé ailleurs — un clic à côté sur un bouton — reste où il est.
     */
    returnFocus?: () => void;
    /** Les actions secondaires, à gauche du pied. */
    footerStart?: ReactNode;
    /** « Annuler » puis l'action principale, à droite. */
    footerEnd: ReactNode;
    children: ReactNode;
}

/**
 * La fenêtre de DayTrack : accrochée à ce qui l'a ouverte, flèche comprise, et non modale
 * — la grille reste visible. Radix porte le placement, le focus et ce qui la ferme ; son
 * apparence vient des tokens.
 */
export function Popover({
    open,
    anchor,
    side,
    align = 'center',
    sideOffset = 0,
    alignOffset = 0,
    width = 'pop',
    overRecap = false,
    title,
    subtitle,
    onCancel,
    onOutside,
    arrowHidden = false,
    sending = false,
    initialFocus,
    returnFocus,
    footerStart,
    footerEnd,
    children,
}: PopoverProps) {
    const titleId = useId();
    const subtitleId = useId();
    const outside = (event: Event) => {
        event.preventDefault();
        if (!sending) {
            onOutside();
        }
    };

    return (
        <RadixPopover.Root open={open} modal={false}>
            <RadixPopover.Anchor virtualRef={anchor} />
            <RadixPopover.Portal>
                <RadixPopover.Content
                    side={side}
                    align={align}
                    // Radix compte la flèche en plus de l'écart : on la retire, pour que
                    // l'écart demandé soit l'écart réel, flèche comprise.
                    sideOffset={sideOffset - tokenPixels('--s-2')}
                    alignOffset={alignOffset}
                    collisionPadding={tokenPixels('--s-2')}
                    aria-labelledby={titleId}
                    // Le sous-titre — le jour et les heures, la taille d'une sélection — se lit
                    // à l'ouverture, après le titre, comme il se voit dessous.
                    aria-describedby={subtitle === undefined ? undefined : subtitleId}
                    data-sending={sending ? '' : undefined}
                    className={`${WIDTHS[width]} ${overRecap ? 'z-(--z-toast)' : 'z-(--z-pop)'} rounded-3 border border-line bg-bg-raise text-ink shadow-pop`}
                    onOpenAutoFocus={(event) => {
                        event.preventDefault();
                        initialFocus?.current?.focus();
                    }}
                    onCloseAutoFocus={(event) => {
                        event.preventDefault();
                        if (document.activeElement === null || document.activeElement === document.body) {
                            returnFocus?.();
                        }
                    }}
                    onEscapeKeyDown={(event) => {
                        event.preventDefault();
                        if (!sending) {
                            onCancel();
                        }
                    }}
                    onPointerDownOutside={outside}
                    onFocusOutside={outside}
                >
                    <div className="flex items-center gap-2 border-b border-line pt-4 pr-3 pb-3 pl-4">
                        <div className="min-w-0">
                            <h2 id={titleId} className="text-lg font-bold">
                                {title}
                            </h2>
                            {subtitle !== undefined && (
                                <p id={subtitleId} className="mt-1 text-sm text-ink-3">
                                    {subtitle}
                                </p>
                            )}
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            iconOnly
                            className="ml-auto"
                            aria-label="Fermer"
                            aria-disabled={sending}
                            onClick={sending ? undefined : onCancel}
                        >
                            <CloseIcon />
                        </Button>
                    </div>
                    <div className="flex flex-col gap-4 p-4">{children}</div>
                    {/* Quand les libellés ne tiennent pas sur une ligne — une police plus large
                        que prévu —, l'action principale passe dessous, toujours à
                        droite, plutôt que de sortir de la fenêtre. */}
                    <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
                        <div className="flex items-center gap-2">{footerStart}</div>
                        <div className="ml-auto flex items-center gap-2">{footerEnd}</div>
                    </div>
                    <RadixPopover.Arrow asChild>
                        {/* La flèche de 12 px, un carré tourné : la moitié qui dépasse,
                            ses deux bords, et sa base qui recouvre le bord de la fenêtre. */}
                        <svg
                            viewBox="0 0 16 8"
                            aria-hidden="true"
                            className={`block h-2 w-4 -translate-y-px ${arrowHidden ? 'invisible' : ''}`}
                        >
                            <path d="M0 0 8 8 16 0Z" className="fill-bg-raise" />
                            <path d="M0 0 8 8 16 0" className="fill-none stroke-line" />
                        </svg>
                    </RadixPopover.Arrow>
                </RadixPopover.Content>
            </RadixPopover.Portal>
        </RadixPopover.Root>
    );
}
