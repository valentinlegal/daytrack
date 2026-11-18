import { forwardRef, type KeyboardEvent, useId, useState } from 'react';

export interface RadioOption {
    readonly value: string;
    readonly label: string;
}

export interface RadioGroupProps {
    /** Ce que le lecteur d'écran lit en y entrant : la question qu'ils posent. */
    label: string;
    options: readonly RadioOption[];
    value: string;
    onValueChange: (value: string) => void;
    /** Une touche sur l'un d'eux : Entrée y valide le choix, comme dans un champ. */
    onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
    /**
     * Le curseur y est posé d'office, à l'ouverture d'une fenêtre : son anneau ne paraît qu'à la
     * première touche — une flèche, Tab —, quand on s'en sert au clavier. Sans quoi la fenêtre
     * s'ouvrirait avec un cadre que personne n'a demandé.
     */
    quietFocus?: boolean;
}

/**
 * Des boutons radio, un par ligne : le rond, puis son libellé, toute la ligne se clique. Les
 * boutons natifs, que le navigateur rend accessibles — Tab entre sur le choisi, les flèches
 * passent de l'un à l'autre et le choisissent —, à la couleur du bouton principal. La
 * référence désigne le bouton choisi, où le curseur se pose.
 */
export const RadioGroup = forwardRef<HTMLInputElement, RadioGroupProps>(function RadioGroup(
    { label, options, value, onValueChange, onKeyDown, quietFocus = false },
    ref,
) {
    const groupId = useId();
    const [keyed, setKeyed] = useState(false);
    const quiet = quietFocus && !keyed;

    return (
        <div role="radiogroup" aria-label={label} className="flex flex-col gap-1">
            {options.map((option) => (
                <label
                    key={option.value}
                    className="flex min-h-ctl-sm cursor-pointer items-center gap-2 text-md text-ink"
                >
                    <input
                        ref={option.value === value ? ref : undefined}
                        type="radio"
                        name={groupId}
                        value={option.value}
                        checked={option.value === value}
                        className={`m-0 size-4 flex-none cursor-pointer accent-btn ${quiet ? 'focus-visible:outline-none' : ''}`}
                        onChange={() => {
                            onValueChange(option.value);
                        }}
                        onKeyDown={(event) => {
                            if (event.key !== 'Enter') {
                                setKeyed(true);
                            }
                            onKeyDown?.(event);
                        }}
                    />
                    <span>{option.label}</span>
                </label>
            ))}
        </div>
    );
});
