import { Popover as RadixPopover } from 'radix-ui';
import { type ReactNode, type RefObject, useId, useLayoutEffect, useRef } from 'react';

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
    /**
     * Sa hauteur au plus, en pixels, sous celle que l'écran lui laisse : une fenêtre qui
     * grandit sans bouger s'arrête là, et son contenu défile.
     */
    maxHeight?: number | null;
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
 *
 * Plus haute que la place, elle en prend toute la hauteur — celle que Radix mesure entre
 * ce qui l'a ouverte et le bord de l'écran — : l'en-tête et le pied restent, le contenu
 * défile entre les deux. La molette au bout du contenu ne fait pas défiler la page
 * dessous, et le champ caché que Tab atteint vient à l'écran, entier.
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
    maxHeight = null,
    sending = false,
    initialFocus,
    returnFocus,
    footerStart,
    footerEnd,
    children,
}: PopoverProps) {
    const titleId = useId();
    const subtitleId = useId();
    const bodyRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    // Une hauteur calculée, comme celle d'un champ qui grandit (TextArea) : la place que l'écran
    // laisse, au plus celle-ci.
    useLayoutEffect(() => {
        const content = contentRef.current;
        if (content !== null) {
            content.style.maxHeight =
                maxHeight === null ? '' : `min(var(--radix-popover-content-available-height), ${String(maxHeight)}px)`;
        }
    });
    // Un appui dans la fenêtre y pose le curseur sans rien faire défiler : le contenu qui
    // bougerait sous la souris ferait tomber le clic à côté — une carte, un bouton.
    const pressingRef = useRef(false);
    const press = () => {
        pressingRef.current = true;
        const release = () => {
            pressingRef.current = false;
        };
        window.addEventListener('pointerup', release, { once: true, capture: true });
        window.addEventListener('pointercancel', release, { once: true, capture: true });
    };
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
                    ref={contentRef}
                    aria-labelledby={titleId}
                    // Le sous-titre — le jour et les heures, la taille d'une sélection — se lit
                    // à l'ouverture, après le titre, comme il se voit dessous.
                    aria-describedby={subtitle === undefined ? undefined : subtitleId}
                    data-sending={sending ? '' : undefined}
                    className={`${WIDTHS[width]} ${overRecap ? 'z-(--z-toast)' : 'z-(--z-pop)'} flex max-h-(--radix-popover-content-available-height) flex-col rounded-3 border border-line bg-bg-raise text-ink shadow-pop`}
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
                    // Le navigateur n'amène que le curseur à l'écran : un commentaire sur deux
                    // lignes resterait à moitié caché sous le pied, comme le refus dit sous un
                    // champ ou sous un groupe de boutons. Au clavier, ou posé par un refus ; pas
                    // sous la souris, où l'on voit déjà ce qu'on clique. Le message d'abord, puis
                    // ce qui a le curseur : trop loin l'un de l'autre pour tenir ensemble, le
                    // curseur reste à l'écran.
                    onPointerDownCapture={press}
                    onFocus={(event) => {
                        const body = bodyRef.current;
                        if (pressingRef.current || event.target === body || body?.contains(event.target) !== true) {
                            return;
                        }
                        const described = event.target.closest('[aria-describedby]')?.getAttribute('aria-describedby');
                        for (const id of described?.split(' ') ?? []) {
                            const message = document.getElementById(id);
                            if (message !== null && body.contains(message)) {
                                message.scrollIntoView({ block: 'nearest' });
                            }
                        }
                        event.target.scrollIntoView({ block: 'nearest' });
                    }}
                >
                    <div className="flex flex-none items-center gap-2 border-b border-line pt-4 pr-3 pb-3 pl-4">
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
                    <div
                        ref={bodyRef}
                        className="popover-body flex min-h-0 flex-auto flex-col gap-4 overflow-y-auto overscroll-contain p-4"
                    >
                        {children}
                    </div>
                    {/* Quand les libellés ne tiennent pas sur une ligne — une police plus large
                        que prévu —, l'action principale passe dessous, toujours à
                        droite, plutôt que de sortir de la fenêtre. */}
                    <div className="flex flex-none flex-wrap items-center gap-2 border-t border-line px-4 py-3">
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
