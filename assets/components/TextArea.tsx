import { type ComponentPropsWithoutRef, type ForwardedRef, forwardRef, useId, useLayoutEffect, useRef } from 'react';

import { FIELD_FRAME, FieldError, FieldLabel } from './Field';

export interface TextAreaProps extends Omit<ComponentPropsWithoutRef<'textarea'>, 'id' | 'className' | 'rows'> {
    label: string;
    /** « Facultatif », à droite du libellé. */
    optional?: boolean;
    /** Le refus, sous la zone ; elle le désigne et passe en erreur. */
    error?: string | null;
}

/** Au-delà, la zone ne grandit plus : elle défile. */
const MAX_LINES = 4;

/**
 * Une zone de texte : deux lignes au départ, elle grandit avec ce qu'on y tape jusqu'à
 * quatre, puis défile. Le texte revient à la ligne de lui-même. Mêmes libellé, bord,
 * focus et refus qu'un champ. Sa référence passe par forwardRef : ces composants évitent
 * les nouveautés de React qui ne sont pas indispensables.
 */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
    { label, optional = false, error = null, value, ...props },
    ref,
) {
    const id = useId();
    const errorId = `${id}-erreur`;
    const areaRef = useRef<HTMLTextAreaElement | null>(null);

    useLayoutEffect(() => {
        fit(areaRef.current);
    }, [value]);

    return (
        <div className="flex flex-col gap-2">
            <FieldLabel htmlFor={id} label={label} optional={optional} />
            <textarea
                id={id}
                ref={(node) => {
                    areaRef.current = node;
                    assign(ref, node);
                }}
                rows={2}
                value={value}
                autoComplete="off"
                aria-invalid={error === null ? undefined : true}
                aria-describedby={error === null ? undefined : errorId}
                className={`${FIELD_FRAME} block min-h-area w-full resize-none py-2`}
                {...props}
            />
            {error !== null && <FieldError id={errorId} error={error} />}
        </div>
    );
});

/** La hauteur de ce qui est écrit, bords compris, sans dépasser MAX_LINES lignes. */
function fit(area: HTMLTextAreaElement | null): void {
    if (area === null) {
        return;
    }
    const style = getComputedStyle(area);
    const borders = area.offsetHeight - area.clientHeight;
    const max =
        Number.parseFloat(style.lineHeight) * MAX_LINES +
        Number.parseFloat(style.paddingTop) +
        Number.parseFloat(style.paddingBottom) +
        borders;

    area.style.height = 'auto';
    const wanted = area.scrollHeight + borders;
    area.style.height = `${String(Math.min(wanted, max))}px`;
    area.style.overflowY = wanted > max ? 'auto' : 'hidden';
}

function assign<T>(ref: ForwardedRef<T>, node: T | null): void {
    if (typeof ref === 'function') {
        ref(node);
    } else if (ref !== null) {
        ref.current = node;
    }
}
