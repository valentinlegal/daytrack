import type { FocusEvent, RefObject } from 'react';

import { Field } from '../components/Field';
import { CheckIcon } from '../components/icons';
import type { Violation } from '../serverApi';
import { TokenHelp } from './TokenHelp';

export type JiraField = 'site' | 'email' | 'token';

export type JiraFieldErrors = Readonly<Record<JiraField, string | null>>;

export const NO_FIELD_ERRORS: JiraFieldErrors = { site: null, email: null, token: null };

/** Les refus du serveur, sous leur champ (src/Controller/Api/JiraController.php). */
export function fieldErrorsOf(violations: readonly Violation[]): JiraFieldErrors {
    const errors: Record<JiraField, string | null> = { ...NO_FIELD_ERRORS };
    for (const { field, message } of violations) {
        const known = field === 'site' || field === 'email' || field === 'token' ? field : 'token';
        errors[known] ??= message;
    }

    return errors;
}

/** Le premier champ refusé, dans l'ordre de l'écran : le curseur y va. */
export function firstRefused(errors: JiraFieldErrors): JiraField | null {
    return (['site', 'email', 'token'] as const).find((field) => errors[field] !== null) ?? null;
}

/**
 * Les trois champs de la connexion à Jira, sur la page de bienvenue comme dans les
 * réglages, et l'aide pour créer le jeton sous le sien.
 */
export function JiraFields({
    values,
    errors,
    siteRef,
    emailRef,
    tokenRef,
    onChange,
    onTokenFocus,
    onTokenBlur,
    readOnly = false,
}: {
    values: Readonly<Record<JiraField, string>>;
    errors: JiraFieldErrors;
    siteRef: RefObject<HTMLInputElement | null>;
    emailRef: RefObject<HTMLInputElement | null>;
    tokenRef: RefObject<HTMLInputElement | null>;
    onChange: (field: JiraField, value: string) => void;
    onTokenFocus?: (event: FocusEvent<HTMLInputElement>) => void;
    onTokenBlur?: () => void;
    /** Un essai ou un enregistrement attend Jira : rien ne se tape d'ici sa réponse. */
    readOnly?: boolean;
}) {
    return (
        <>
            <Field
                ref={siteRef}
                label="Adresse de Jira"
                readOnly={readOnly}
                type="url"
                // L'adresse du site, que montre le navigateur dans Jira : jamais celle de
                // la passerelle, que DayTrack trouve seul.
                placeholder="https://exemple.atlassian.net"
                value={values.site}
                error={errors.site}
                onChange={(event) => {
                    onChange('site', event.target.value);
                }}
            />
            <Field
                ref={emailRef}
                label="Adresse e-mail"
                readOnly={readOnly}
                type="email"
                value={values.email}
                error={errors.email}
                onChange={(event) => {
                    onChange('email', event.target.value);
                }}
            />
            <Field
                ref={tokenRef}
                label="Jeton d'API"
                readOnly={readOnly}
                type="password"
                value={values.token}
                error={errors.token}
                onFocus={onTokenFocus}
                onBlur={onTokenBlur}
                onChange={(event) => {
                    onChange('token', event.target.value);
                }}
            />
            <TokenHelp />
        </>
    );
}

/** « Connecté à Jira en tant que Camille Martin. », l'icône en face de la première ligne. */
export function ConnectedLine({ account }: { account: string }) {
    return (
        <p role="status" className="text-sm leading-(--lh) text-ink">
            <ConnectedText account={account} />
        </p>
    );
}

/** Le texte de la ligne d'état, sans sa région : les réglages la gardent en place (JiraSection). */
export function ConnectedText({ account }: { account: string }) {
    return (
        <span className="flex items-start gap-2">
            <span className="first-line-icon flex">
                <CheckIcon />
            </span>
            Connecté à Jira en tant que {account}.
        </span>
    );
}
