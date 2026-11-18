import { type ComponentPropsWithoutRef, forwardRef } from 'react';

export interface DayToggleProps extends Omit<
    ComponentPropsWithoutRef<'button'>,
    'type' | 'className' | 'aria-pressed' | 'aria-label' | 'children'
> {
    /** Sa lettre, à l'écran : « L », « M »… */
    letter: string;
    /** Son nom, pour le lecteur d'écran : « Lundi ». */
    name: string;
    pressed: boolean;
}

/**
 * Un jour de la semaine qu'on choisit : sa lettre dans un carré de la hauteur d'un contrôle,
 * plein à la couleur du bouton principal quand il est choisi. Les jours travaillés des
 * réglages, et les jours d'une récurrence.
 */
export const DayToggle = forwardRef<HTMLButtonElement, DayToggleProps>(function DayToggle(
    { letter, name, pressed, ...button },
    ref,
) {
    return (
        <button
            ref={ref}
            type="button"
            aria-pressed={pressed}
            aria-label={name}
            className="size-ctl flex-none cursor-pointer rounded-2 border border-line-strong bg-bg-raise text-sm font-semibold text-ink-2 transition-colors hover:bg-bg-hover aria-pressed:border-btn aria-pressed:bg-btn aria-pressed:text-on-btn aria-pressed:hover:border-btn-hover aria-pressed:hover:bg-btn-hover"
            {...button}
        >
            {letter}
        </button>
    );
});
