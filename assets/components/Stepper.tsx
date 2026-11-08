import { type ComponentProps, useId } from 'react';

import { Button } from './Button';
import { FIELD_INPUT, FieldError } from './Field';
import { MinusIcon, PlusIcon } from './icons';

export interface StepperProps extends Omit<ComponentProps<'input'>, 'id' | 'className'> {
    label: string;
    /**
     * Le libellé n'est lu que par le lecteur d'écran : la page l'affiche déjà ailleurs,
     * comme l'objectif habituel des réglages, nommé dans la colonne de gauche de sa ligne.
     */
    hideLabel?: boolean;
    /** Le libellé des boutons, pour le lecteur d'écran : « Enlever 15 minutes ». */
    decreaseLabel: string;
    increaseLabel: string;
    onDecrease: () => void;
    onIncrease: () => void;
    error?: string | null;
}

/**
 * Le contrôle pas à pas : −, le champ, +. Les boutons prennent la hauteur du champ, et le
 * champ se tape aussi.
 */
export function Stepper({
    label,
    hideLabel = false,
    decreaseLabel,
    increaseLabel,
    onDecrease,
    onIncrease,
    error = null,
    'aria-describedby': describedBy,
    ...props
}: StepperProps) {
    const id = useId();
    const errorId = `${id}-erreur`;
    // Une aide posée à côté (aria-describedby), puis le refus quand il y en a un.
    const description = [describedBy, error === null ? undefined : errorId].filter(Boolean).join(' ') || undefined;

    return (
        <div className="flex flex-col gap-2">
            <label htmlFor={id} className={hideLabel ? 'sr-only' : 'text-sm font-semibold text-ink-2'}>
                {label}
            </label>
            <div className="flex gap-2">
                <Button iconOnly className="h-field w-field" aria-label={decreaseLabel} onClick={onDecrease}>
                    <MinusIcon />
                </Button>
                <input
                    id={id}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={error === null ? undefined : true}
                    aria-describedby={description}
                    className={`${FIELD_INPUT} w-full text-center font-mono text-lg font-semibold`}
                    {...props}
                />
                <Button iconOnly className="h-field w-field" aria-label={increaseLabel} onClick={onIncrease}>
                    <PlusIcon />
                </Button>
            </div>
            {error !== null && <FieldError id={errorId} error={error} />}
        </div>
    );
}
