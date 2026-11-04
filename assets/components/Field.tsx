import { type ComponentPropsWithoutRef, forwardRef, useId } from 'react';

import { ErrorIcon } from './icons';

/**
 * Le bord, le focus et l'erreur d'un champ : au focus, le bord et un anneau de 1 px en
 * --focus ; en erreur, en --inc. Le texte saisi reste en --ink. La zone de texte et le
 * contrôle pas à pas en reprennent la forme.
 */
export const FIELD_FRAME =
    'rounded-2 border border-line-field bg-bg px-3 text-ink outline-none placeholder:text-ink-3 focus:border-focus focus:ring focus:ring-focus aria-invalid:border-inc aria-invalid:ring aria-invalid:ring-inc';

/** Un champ d'une ligne ; sa largeur se pose à côté. */
export const FIELD_INPUT = `h-field ${FIELD_FRAME}`;

export interface FieldProps extends Omit<ComponentPropsWithoutRef<'input'>, 'id' | 'className'> {
    label: string;
    /** « Facultatif », à droite du libellé. */
    optional?: boolean;
    /** Le refus, sous le champ ; le champ le désigne et passe en erreur. */
    error?: string | null;
    /**
     * Un avertissement sous le champ : ce qui empêche de vérifier la saisie sans qu'elle
     * soit fausse — Jira injoignable, jeton refusé. Le champ le désigne, sans passer en
     * erreur. Un refus passe devant.
     */
    warning?: string | null;
    /** Un identifiant de ticket : chasse fixe et gras. */
    mono?: boolean;
    /**
     * Le champ d'un identifiant de ticket seul : large de deux colonnes d'identifiant,
     * assez pour PLATFORM-12345, le reste de la ligne allant à l'aperçu du ticket. Le
     * libellé et le refus gardent toute la largeur.
     */
    narrow?: boolean;
}

/**
 * Un champ de saisie et son libellé. Une erreur sur ce qu'on vient de taper se dit sous
 * lui, jamais en toast. Sa référence, celle du champ, passe par forwardRef : ces
 * composants évitent les nouveautés de React qui ne sont pas indispensables.
 */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
    {
        label,
        optional = false,
        error = null,
        warning = null,
        mono = false,
        narrow = false,
        'aria-describedby': describedBy,
        ...props
    },
    ref,
) {
    const id = useId();
    const messageId = `${id}-message`;
    const shownWarning = error === null ? warning : null;
    // Le champ désigne son message, et ce que l'appelant lui fait déjà désigner.
    const describers = [error !== null || shownWarning !== null ? messageId : null, describedBy ?? null]
        .filter((describer) => describer !== null)
        .join(' ');

    return (
        <div className="flex flex-col gap-2">
            <FieldLabel htmlFor={id} label={label} optional={optional} />
            <input
                ref={ref}
                id={id}
                type="text"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={error === null ? undefined : true}
                aria-describedby={describers === '' ? undefined : describers}
                className={`${FIELD_INPUT} ${narrow ? 'w-ticket' : 'w-full'} ${mono ? 'font-mono font-semibold' : ''}`}
                {...props}
            />
            {error !== null && <FieldError id={messageId} error={error} />}
            {shownWarning !== null && <FieldWarning id={messageId} warning={shownWarning} />}
        </div>
    );
});

/** Le libellé d'un champ, et « Facultatif » à sa droite. */
export function FieldLabel({ htmlFor, label, optional }: { htmlFor: string; label: string; optional: boolean }) {
    return (
        <div className="flex items-baseline justify-between">
            <label htmlFor={htmlFor} className="text-sm font-semibold text-ink-2">
                {label}
            </label>
            {optional && <span className="text-xs text-ink-3">Facultatif</span>}
        </div>
    );
}

// Un message sous un champ peut passer sur deux lignes : son icône reste en face de la
// première.
const FIELD_MESSAGE = 'flex items-start gap-2 text-sm leading-(--lh)';

/** Le refus sous un champ, que le champ désigne par son identifiant. */
export function FieldError({ id, error }: { id: string; error: string }) {
    return (
        <p id={id} className={`${FIELD_MESSAGE} text-inc`}>
            <ErrorIcon />
            {error}
        </p>
    );
}

/**
 * L'avertissement sous un champ : le texte reste en --ink-2, seule l'icône passe en
 * --warn, qui n'a pas le contraste d'un texte de 12 px.
 */
export function FieldWarning({ id, warning }: { id: string; warning: string }) {
    return (
        <p id={id} className={`${FIELD_MESSAGE} text-ink-2`}>
            <ErrorIcon tone="warning" />
            {warning}
        </p>
    );
}
