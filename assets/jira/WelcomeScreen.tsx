import { useEffect, useRef, useState } from 'react';

import { Button } from '../components/Button';
import { StackedLogo } from '../components/icons';
import type { JiraApi, JiraConnection } from './jiraApi';
import {
    ConnectedLine,
    fieldErrorsOf,
    firstRefused,
    GeneralError,
    type JiraField,
    type JiraFieldErrors,
    JiraFields,
    NO_FIELD_ERRORS,
    UNSENT,
} from './JiraFields';

/**
 * La page de bienvenue : tant que Jira n'est pas relié, elle tient lieu d'écran Journée,
 * qui ne marche pas sans lui.
 *
 * « Tester la connexion » essaie les trois champs sans rien garder ; « Commencer » les
 * essaie aussi, puis les garde et ouvre la journée. Un refus se dit sous son champ, le
 * curseur y va, et rien de ce qui a été tapé ne se perd.
 */
export function WelcomeScreen({ api, onLinked }: { api: JiraApi; onLinked: (connection: JiraConnection) => void }) {
    const [values, setValues] = useState<Record<JiraField, string>>({ site: '', email: '', token: '' });
    const [errors, setErrors] = useState<JiraFieldErrors>(NO_FIELD_ERRORS);
    const [general, setGeneral] = useState<string | null>(null);
    const [account, setAccount] = useState<string | null>(null);
    const [pending, setPending] = useState<'test' | 'link' | null>(null);
    // Un geste ne part qu'une fois : un double clic, une Entrée répétée attendent le premier.
    const pendingRef = useRef(false);
    const siteRef = useRef<HTMLInputElement>(null);
    const emailRef = useRef<HTMLInputElement>(null);
    const tokenRef = useRef<HTMLInputElement>(null);
    const [refusedAt, setRefusedAt] = useState<{ field: JiraField } | null>(null);

    // Un refus pose le curseur sur le premier champ refusé, là où est le message.
    useEffect(() => {
        if (refusedAt !== null) {
            ({ site: siteRef, email: emailRef, token: tokenRef })[refusedAt.field].current?.focus();
        }
    }, [refusedAt]);

    const form = () => ({ site: values.site, email: values.email, token: values.token === '' ? null : values.token });

    const refuse = (next: JiraFieldErrors) => {
        setErrors(next);
        const field = firstRefused(next);
        if (field !== null) {
            setRefusedAt({ field });
        }
    };

    const run = async (gesture: 'test' | 'link') => {
        if (pendingRef.current) {
            return;
        }
        pendingRef.current = true;
        setPending(gesture);
        setGeneral(null);
        try {
            if (gesture === 'test') {
                const result = await api.test(form());
                if (result.status === 'connected') {
                    setErrors(NO_FIELD_ERRORS);
                    setAccount(result.account);
                } else {
                    setAccount(null);
                    refuse(fieldErrorsOf(result.violations));
                }
            } else {
                const result = await api.link(form());
                if (result.status === 'linked') {
                    onLinked(result.connection);

                    return;
                }
                setAccount(null);
                refuse(fieldErrorsOf(result.violations));
            }
        } catch {
            setGeneral(UNSENT);
        } finally {
            pendingRef.current = false;
            setPending(null);
        }
    };

    return (
        <main className="flex min-h-screen items-center justify-center bg-bg-side py-7 text-ink">
            <section
                aria-labelledby="bienvenue"
                className="flex w-pop flex-col gap-5 rounded-3 border border-line bg-bg-raise p-7 shadow-1"
            >
                <div className="flex">
                    <StackedLogo />
                </div>
                <h1 id="bienvenue" className="mt-1 text-xl font-bold">
                    Bienvenue dans DayTrack
                </h1>
                <p className="-mt-2 text-lg leading-(--lh) text-ink-2">
                    {
                        "Notez votre temps au quart d'heure, ticket par ticket, puis envoyez-le sur Jira. Pour commencer, reliez DayTrack à votre compte Jira."
                    }
                </p>
                <form
                    aria-label="Connexion à Jira"
                    noValidate
                    className="mt-1 flex flex-col gap-4 border-t border-line pt-6"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void run('link');
                    }}
                >
                    <JiraFields
                        values={values}
                        errors={errors}
                        siteRef={siteRef}
                        emailRef={emailRef}
                        tokenRef={tokenRef}
                        readOnly={pending !== null}
                        onChange={(field, value) => {
                            setValues({ ...values, [field]: value });
                            // Taper de nouveau efface le refus du champ, et l'essai d'avant ne
                            // dit plus rien de ce qui est tapé.
                            setErrors({ ...errors, [field]: null });
                            setAccount(null);
                        }}
                    />
                    {account !== null && (
                        <div className="-mt-1">
                            <ConnectedLine account={account} />
                        </div>
                    )}
                    {general !== null && <GeneralError message={general} />}
                    <div className="flex items-center gap-2">
                        <Button
                            busy={pending === 'test'}
                            aria-disabled={pending === 'link' || undefined}
                            onClick={() => {
                                void run('test');
                            }}
                        >
                            Tester la connexion
                        </Button>
                        <Button
                            type="submit"
                            variant="primary"
                            className="ml-auto"
                            busy={pending === 'link'}
                            aria-disabled={pending === 'test' || undefined}
                        >
                            Commencer
                        </Button>
                    </div>
                </form>
                <p className="-mt-1 text-sm leading-(--lh) text-ink-3">
                    {
                        "Le jeton est enregistré par DayTrack, sur la machine qui l'héberge. Vous pourrez modifier ces informations dans les réglages."
                    }
                </p>
            </section>
        </main>
    );
}
