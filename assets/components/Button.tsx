import { type ComponentPropsWithoutRef, forwardRef } from 'react';

/**
 * Le bouton de DayTrack.
 *
 * - primary : l'action principale, une seule par zone ;
 * - secondary : le bouton ordinaire ;
 * - ghost : sans fond ni bord — icônes, flèches, croix ;
 * - danger : secondaire au texte rouge, toujours avec son icône ;
 * - link : le lien d'action, un bouton qui a l'air d'un lien, pour une action
 *   secondaire qui suit sa phrase d'explication (« Revenir à 7h30 »).
 *
 * md dans la barre du haut, sm dans les fenêtres et les listes ; le lien d'action n'a
 * ni taille ni cadre.
 *
 * Occupé (busy), il attend la réponse de ce qu'il a lancé : la roue devant son libellé,
 * aria-busy, le curseur d'attente, et un clic ne fait rien.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'md' | 'sm';

export interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    /** Un bouton carré qui ne porte qu'une icône : son libellé passe par aria-label. */
    iconOnly?: boolean;
    /** Ce qu'il a lancé attend sa réponse : la roue devant le libellé, et un clic ne fait rien. */
    busy?: boolean;
}

// Des classes écrites en entier, jamais composées : Tailwind ne génère que ce qu'il lit
// dans le code.
//
// Le survol ne vaut que pour un bouton actif : ni « disabled », ni « aria-disabled »,
// qui reste focalisable mais ne fait rien — il garde alors son apparence au repos.
const BASE =
    'inline-flex shrink-0 cursor-pointer items-center font-medium select-none transition-colors aria-busy:cursor-progress aria-disabled:cursor-default aria-disabled:opacity-(--o-disabled) disabled:cursor-default disabled:opacity-(--o-disabled)';

// Le cadre des boutons, sur une ligne. Les deux tailles écrivent au corps du texte,
// --t-md, quel que soit leur parent. Le lien d'action, lui, revient à la ligne comme
// la phrase qu'il suit.
const BOX = 'justify-center gap-2 rounded-2 border text-md whitespace-nowrap';

const VARIANTS: Record<ButtonVariant, string> = {
    primary:
        'border-btn bg-btn text-on-btn enabled:not-aria-disabled:hover:border-btn-hover enabled:not-aria-disabled:hover:bg-btn-hover',
    secondary:
        'border-line-strong bg-bg-raise text-ink enabled:not-aria-disabled:hover:bg-bg-hover aria-pressed:border-bg-press aria-pressed:bg-bg-press',
    ghost: 'border-transparent bg-transparent text-ink-2 enabled:not-aria-disabled:hover:bg-bg-hover aria-pressed:bg-bg-press aria-pressed:text-ink',
    danger: 'border-line-strong bg-bg-raise text-inc enabled:not-aria-disabled:hover:bg-bg-hover',
    link: 'gap-1 text-sm leading-(--lh) text-ink underline decoration-line-strong underline-offset-(--s-1) enabled:not-aria-disabled:hover:decoration-current',
};

const SIZES: Record<ButtonSize, string> = {
    md: 'h-ctl',
    sm: 'h-ctl-sm',
};

// Un bouton d'icône est carré et sans marge : il prend sa largeur ici, et ne
// reçoit pas la marge du bouton à libellé.
const WIDTHS: Record<ButtonSize, string> = {
    md: 'w-ctl',
    sm: 'w-ctl-sm',
};

/**
 * Sa référence passe par forwardRef, pas par une prop : ces composants évitent les
 * nouveautés de React qui ne sont pas indispensables.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    {
        variant = 'secondary',
        size = 'md',
        iconOnly = false,
        busy = false,
        type = 'button',
        className,
        children,
        onClick,
        ...props
    },
    ref,
) {
    const box = variant === 'link' ? [] : [BOX, SIZES[size], iconOnly ? WIDTHS[size] : 'px-3'];
    const classes = [BASE, ...box, VARIANTS[variant], className ?? ''].filter(Boolean).join(' ');

    // « type » vaut « button » par défaut : un bouton posé dans un formulaire ne
    // l'envoie jamais par mégarde. Occupé, même un bouton d'envoi n'envoie rien.
    return (
        <button
            ref={ref}
            type={type}
            data-variant={variant}
            className={classes}
            aria-busy={busy || undefined}
            onClick={
                busy
                    ? (event) => {
                          event.preventDefault();
                      }
                    : onClick
            }
            {...props}
        >
            {busy && <span className="spin" aria-hidden="true" />}
            {children}
        </button>
    );
});
