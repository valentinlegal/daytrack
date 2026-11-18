import { Tooltip as RadixTooltip } from 'radix-ui';
import { createContext, type ReactElement, type ReactNode, useContext, useRef, useState } from 'react';

import { tokenPixels } from './tokenPixels';

/** Le temps de survol avant qu'une infobulle s'ouvre. */
const DELAY = 400;

/**
 * Sous un fournisseur commun, les infobulles se passent le relais. Le contexte se lit par
 * useContext et se fournit par .Provider : ces composants évitent les nouveautés de React
 * qui ne sont pas indispensables.
 */
const SharedContext = createContext(false);

/**
 * Le fournisseur commun des infobulles d'un écran : passer d'un bouton à son voisin —
 * d'une flèche des jours à l'autre — ouvre la suivante tout de suite, sans attendre ni
 * glisser, comme dans une barre d'outils.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
    return (
        <RadixTooltip.Provider delayDuration={DELAY}>
            <SharedContext.Provider value={true}>{children}</SharedContext.Provider>
        </RadixTooltip.Provider>
    );
}

/**
 * L'infobulle : fond --btn, texte --on-btn en
 * --t-sm, rayon --r-2, sous ce qu'elle désigne, flèche comprise. Elle s'ouvre au survol
 * après 400 ms, et quand son déclencheur reçoit le focus au clavier ; Échap la ferme.
 * Elle apparaît en fondu, en glissant un peu depuis lui, et s'efface en fondu
 * (components.css). Elle dit ce que fait un bouton d'icône, où mène une flèche, ou le
 * raccourci d'un bouton à libellé : son texte s'ajoute à la description du bouton,
 * jamais à son nom.
 *
 * Hors d'un fournisseur commun, elle porte le sien : posée seule, elle marche.
 */
export function Tooltip({
    label,
    side = 'bottom',
    open: forced,
    children,
}: {
    label: string;
    side?: 'top' | 'right' | 'bottom' | 'left';
    /**
     * Ouverte d'office (true), pour une capture ; muette (false), le temps
     * que la fenêtre de son bouton est ouverte, ou que son bouton est éteint. Sans lui, le
     * survol et le focus décident.
     */
    open?: boolean | undefined;
    /**
     * Le déclencheur, un seul élément : un bouton, qu'elle suit aussi au clavier ; ou ce qui
     * ne reçoit jamais le focus — la flèche d'un bloc qui revient, que la grille garde hors
     * du clavier —, qu'elle dit au survol seulement, sans rien ajouter à ce qu'il porte déjà.
     */
    children: ReactElement;
}) {
    const shared = useContext(SharedContext);
    const [open, setOpen] = useState(false);
    // Fermée ou ouverte d'office, elle oublie le survol et le focus : Radix ne la ferme
    // pas quand le pointeur s'en va sans qu'elle soit affichée, et elle s'ouvrirait, une
    // fois libérée, d'un survol passé — une flèche éteinte survolée puis rallumée,
    // l'objectif survolé pendant que sa fenêtre est ouverte.
    if (forced !== undefined && open) {
        setOpen(false);
    }
    const triggerRef = useRef<HTMLButtonElement>(null);
    const hoveredRef = useRef(false);

    const root = (
        <RadixTooltip.Root
            open={forced ?? open}
            onOpenChange={(next) => {
                // Le focus que l'écran rend à un bouton après un clic — fermer le
                // récapitulatif — n'ouvre rien : seuls le survol et le clavier le font.
                const asked = hoveredRef.current || triggerRef.current?.matches(':focus-visible') === true;
                if (forced === undefined && (!next || asked)) {
                    setOpen(next);
                }
            }}
        >
            <RadixTooltip.Trigger
                ref={triggerRef}
                asChild
                onPointerEnter={() => {
                    hoveredRef.current = true;
                }}
                onPointerLeave={() => {
                    hoveredRef.current = false;
                }}
                // Muette, elle ne laisse pas Radix commencer à l'ouvrir : il la croirait
                // ouverte sans jamais la voir se fermer, et la suivante, n'importe où sur
                // l'écran, s'ouvrirait sans attendre ni fondu.
                onPointerMove={(event) => {
                    if (forced === false) {
                        event.preventDefault();
                    }
                }}
                onFocus={(event) => {
                    if (forced === false) {
                        event.preventDefault();
                    }
                }}
            >
                {children}
            </RadixTooltip.Trigger>
            <RadixTooltip.Portal>
                <RadixTooltip.Content
                    side={side}
                    sideOffset={tokenPixels('--s-2')}
                    collisionPadding={tokenPixels('--s-2')}
                    className="tip-motion z-(--z-tip) max-w-side rounded-2 bg-btn p-2 text-sm leading-(--lh) text-on-btn"
                >
                    {label}
                    <RadixTooltip.Arrow asChild>
                        {/* La flèche, un carré de --s-2 tourné : sa moitié. */}
                        <svg viewBox="0 0 12 6" aria-hidden="true" className="block w-3">
                            <path d="M0 0 6 6 12 0Z" className="fill-btn" />
                        </svg>
                    </RadixTooltip.Arrow>
                </RadixTooltip.Content>
            </RadixTooltip.Portal>
        </RadixTooltip.Root>
    );

    return shared ? root : <RadixTooltip.Provider delayDuration={DELAY}>{root}</RadixTooltip.Provider>;
}
