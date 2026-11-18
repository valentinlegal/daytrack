import { type ComponentPropsWithoutRef, forwardRef } from 'react';

export interface CheckboxProps extends Omit<ComponentPropsWithoutRef<'input'>, 'type' | 'className'> {
    /** Le libellé, à droite de la case : la case et lui se cliquent, pas le reste de la ligne. */
    label: string;
}

/**
 * Une case à cocher : la case native, que le navigateur rend accessible au clavier et au
 * lecteur d'écran, à la couleur du bouton principal, puis son libellé. Celle qui déplie une
 * suite la désigne par `aria-controls`.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, ...input }, ref) {
    return (
        <label className="flex min-h-ctl-sm w-fit max-w-full cursor-pointer items-center gap-2 text-md font-medium text-ink">
            <input ref={ref} type="checkbox" className="m-0 size-4 flex-none cursor-pointer accent-btn" {...input} />
            <span>{label}</span>
        </label>
    );
});
