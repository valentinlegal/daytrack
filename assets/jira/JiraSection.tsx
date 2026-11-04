import { type RefObject, useEffect, useEffectEvent, useId, useRef, useState } from 'react';

import { Button } from '../components/Button';
import { FieldWarning } from '../components/Field';
import { SettingsSection } from '../settings/SettingsSection';
import type { CheckResult, JiraApi, JiraConnection, TokenRefusal } from './jiraApi';
import {
    ConnectedText,
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
 * Le jeton enregistré ne revient jamais au navigateur : son champ montre seize points,
 * comme un mot de passe rempli, et ces caractères ne partent jamais.
 */
const STORED_TOKEN = '0'.repeat(16);

/** Ce que Jira reproche au jeton enregistré, sous son champ (src/Controller/Api/JiraController.php). */
const STORED_TOKEN_REFUSALS: Record<TokenRefusal, string> = {
    refused: 'Jira refuse le jeton enregistré, il a sans doute expiré. Créez-en un nouveau, puis collez-le ici.',
    missing_scope:
        'Il manque à ce jeton un périmètre dont DayTrack a besoin. Créez-en un nouveau avec read:jira-work, write:jira-work et read:jira-user.',
};

/** Les champs d'une connexion enregistrée : le jeton n'y est que seize points. */
function valuesOf(connection: JiraConnection | null): Record<JiraField, string> {
    return { site: connection?.site ?? '', email: connection?.email ?? '', token: STORED_TOKEN };
}

/** Ce que Jira reproche au jeton enregistré, sous son champ. */
function errorsOf(connection: JiraConnection | null): JiraFieldErrors {
    return connection?.refusal == null
        ? NO_FIELD_ERRORS
        : { ...NO_FIELD_ERRORS, token: STORED_TOKEN_REFUSALS[connection.refusal] };
}

/** Ce qu'a donné l'enregistrement qu'on attendait, s'il y en avait un. */
export type JiraOutcome = 'none' | 'linked' | 'refused' | 'failed';

/** La section Jira, vue de la page qui la porte. */
export interface JiraPending {
    /** Attend l'enregistrement en route. */
    readonly settled: () => Promise<JiraOutcome>;
    /** Ce qui est dans les champs diffère de ce qui est enregistré. */
    readonly modified: () => boolean;
    /**
     * Quelqu'un veut quitter la page : faux si rien ne l'en empêche, sinon la section le dit.
     * Le curseur va sur « Enregistrer », sauf quand un refus vient de le poser sur son champ.
     */
    readonly retain: (outcome: JiraOutcome) => boolean;
}

/**
 * La section Jira des réglages.
 *
 * La connexion enregistrée, que la page lit avant de s'afficher, remplit les champs dès
 * la première image. Le jeton se vérifie ensuite : la ligne d'état dit le compte, ou le
 * champ du jeton dit ce que Jira lui reproche. « Enregistrer » ne sert que si quelque
 * chose a changé ; il teste avant de garder, et un refus laisse l'ancienne connexion en
 * place. Ce qui n'est pas enregistré retient sur la page, qui le dit ici.
 */
export function JiraSection({
    api,
    stored,
    unread,
    focusToken,
    pendingRef,
    onChecked,
    onLinked,
}: {
    api: JiraApi;
    /** La connexion enregistrée, lue par la page. */
    stored: JiraConnection | null;
    /** Elle n'a pas pu se lire. */
    unread: boolean;
    /** Ouverte par « Mettre à jour le jeton » : le curseur va au champ du jeton. */
    focusToken: boolean;
    pendingRef: RefObject<JiraPending | null>;
    /** Ce que la vérification du jeton enregistré a donné : le bandeau le suit aussi. */
    onChecked: (result: CheckResult) => void;
    onLinked: (connection: JiraConnection) => void;
}) {
    const [saved, setSaved] = useState<JiraConnection | null>(stored);
    const [values, setValues] = useState<Record<JiraField, string>>(() => valuesOf(stored));
    const [tokenTyped, setTokenTyped] = useState(false);
    const [errors, setErrors] = useState<JiraFieldErrors>(() => errorsOf(stored));
    const [general, setGeneral] = useState<string | null>(unread ? UNSENT : null);
    // Le compte que Jira a confirmé pour ce qui est enregistré.
    const [account, setAccount] = useState<string | null>(null);
    // La ligne d'état se tait tant que les champs parlent d'autre chose que de ce compte :
    // un refus, ou une vérification arrivée pendant qu'on tapait.
    const [withheld, setWithheld] = useState(false);
    // Chaque connexion vérifiée entre de nouveau dans la ligne d'état, qui se redit.
    const [verified, setVerified] = useState(0);
    // La ligne du compte enregistré garde sa place tant qu'elle peut encore paraître :
    // pas pour un jeton que Jira refusait déjà, dont le refus se dit sous le champ.
    const [reserving, setReserving] = useState(stored !== null && stored.refusal === null);
    const [sending, setSending] = useState(false);
    const savingRef = useRef<Promise<JiraOutcome> | null>(null);
    // On a voulu quitter la page avec ce qui est dans les champs.
    const [leaveAsked, setLeaveAsked] = useState(false);
    const leaveId = useId();
    const leaveRef = useRef<HTMLDivElement>(null);
    const saveRef = useRef<HTMLButtonElement>(null);
    const siteRef = useRef<HTMLInputElement>(null);
    const emailRef = useRef<HTMLInputElement>(null);
    const tokenRef = useRef<HTMLInputElement>(null);
    const [focusAt, setFocusAt] = useState<{ field: JiraField | 'save' } | null>(() =>
        focusToken && stored !== null ? { field: 'token' } : null,
    );

    /**
     * La connexion enregistrée, telle qu'elle est désormais : l'ancien jeton reste.
     *
     * @param confirmed Jira vient d'accepter le jeton : la ligne d'état dit le compte
     */
    const show = (connection: JiraConnection, confirmed: boolean) => {
        setSaved(connection);
        setValues(valuesOf(connection));
        setTokenTyped(false);
        setErrors(errorsOf(connection));
        setAccount(confirmed ? connection.account : null);
        setWithheld(false);
        setLeaveAsked(false);
        if (confirmed) {
            setVerified((count) => count + 1);
        }
    };

    // La vérification du jeton, qui attend Jira, dit le compte, ou le refus sous le jeton,
    // tant qu'on n'a encore rien tapé. Ce qu'on tape ne se perd jamais.
    const editedRef = useRef(false);
    // Une connexion vient d'être enregistrée : la vérification partie avant parle de
    // l'ancien jeton, et ne dit plus rien, ni ici ni au bandeau.
    const linkedRef = useRef(false);
    const onLoaded = useEffectEvent((checked: CheckResult) => {
        if (linkedRef.current) {
            return;
        }
        onChecked(checked);
        if (stored === null) {
            return;
        }
        // Jira muet ne dit rien du jeton : ce qui était enregistré tient.
        const refusal =
            checked.status === 'refused' || checked.status === 'missing_scope'
                ? checked.status
                : checked.status === 'connected'
                  ? null
                  : stored.refusal;
        const connection = { ...stored, account: checked.account ?? stored.account, refusal };
        // Le champ du jeton vidé garde le curseur : un collage s'ajouterait aux points.
        const tokenCleared = tokenTyped && values.token === '';
        if (editedRef.current || tokenCleared) {
            // Ce qu'on a tapé reste : ce que Jira a dit attend qu'on revienne à l'enregistré.
            setSaved(connection);
            setAccount(checked.status === 'connected' ? connection.account : null);
            if (editedRef.current) {
                setWithheld(true);
            } else {
                setErrors(errorsOf(connection));
            }
        } else {
            show(connection, checked.status === 'connected');
        }
        // Refusé, le jeton le dit sous son champ : la ligne ne paraîtra pas, elle rend sa
        // place. Jira muet, elle la garde, et la page ne bouge pas.
        if (refusal !== null) {
            setReserving(false);
        }
    });
    useEffect(() => {
        let current = true;
        void api.check().then(
            (checked) => {
                if (current) {
                    onLoaded(checked);
                }
            },
            () => undefined,
        );

        return () => {
            current = false;
        };
    }, [api]);

    // Le curseur va où il faut : le jeton depuis le bandeau, le premier refusé, ou
    // « Enregistrer » quand la page retient. Là, le message et les boutons se montrent, d'un
    // coup : la page a pu défiler loin de la section.
    useEffect(() => {
        if (focusAt === null) {
            return;
        }
        if (focusAt.field !== 'save') {
            ({ site: siteRef, email: emailRef, token: tokenRef })[focusAt.field].current?.focus();
        } else {
            // Sans quoi le navigateur centrerait le bouton dans la fenêtre.
            saveRef.current?.focus({ preventScroll: true });
            leaveRef.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
            saveRef.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        }
    }, [focusAt]);

    const token = tokenTyped && values.token !== '' ? values.token : null;
    const changed = saved !== null && (values.site !== saved.site || values.email !== saved.email || token !== null);

    // Lu entre un enregistrement réussi et son rendu : la page peut déjà partir.
    const changedRef = useRef(changed);

    useEffect(() => {
        changedRef.current = changed;
        pendingRef.current = {
            settled: () => savingRef.current ?? Promise.resolve('none'),
            modified: () => changedRef.current,
            retain: (outcome) => {
                if (!changedRef.current) {
                    return false;
                }
                setLeaveAsked(true);
                if (outcome !== 'refused') {
                    setFocusAt({ field: 'save' });
                }

                return true;
            },
        };

        return () => {
            pendingRef.current = null;
        };
    });

    /** Revenue à ce qui est enregistré, la section en reprend tout l'état. */
    const backToSaved = (connection: JiraConnection) => {
        editedRef.current = false;
        setErrors(errorsOf(connection));
        setGeneral(null);
        setWithheld(false);
        setLeaveAsked(false);
    };

    const edit = (field: JiraField, value: string) => {
        const next = { ...values, [field]: value };
        const typed = tokenTyped || field === 'token';
        setValues(next);
        setTokenTyped(typed);
        if (saved !== null && next.site === saved.site && next.email === saved.email && (!typed || next.token === '')) {
            backToSaved(saved);
        } else {
            editedRef.current = true;
            setErrors({ ...errors, [field]: null });
        }
    };

    /** « Annuler » : ne quitte pas la page, et le curseur reste où il était, sur le bouton grisé. */
    const cancel = () => {
        if (saved === null || savingRef.current !== null) {
            return;
        }
        setValues(valuesOf(saved));
        setTokenTyped(false);
        backToSaved(saved);
        setFocusAt({ field: 'save' });
    };

    const send = async (): Promise<JiraOutcome> => {
        try {
            const result = await api.link({ site: values.site, email: values.email, token });
            if (result.status === 'linked') {
                linkedRef.current = true;
                changedRef.current = false;
                show(result.connection, true);
                onLinked(result.connection);

                return 'linked';
            }
            const refused = fieldErrorsOf(result.violations);
            setErrors(refused);
            setWithheld(true);
            setReserving(false);
            const field = firstRefused(refused);
            if (field !== null) {
                setFocusAt({ field });
            }

            return 'refused';
        } catch {
            setGeneral(UNSENT);

            return 'failed';
        }
    };

    const save = () => {
        if (!changed || savingRef.current !== null) {
            return;
        }
        setSending(true);
        setGeneral(null);
        savingRef.current = send().finally(() => {
            savingRef.current = null;
            setSending(false);
        });
    };

    const leaving = leaveAsked && changed;

    return (
        <SettingsSection
            id="reglages-jira"
            title="Jira"
            explanation="DayTrack y retrouve vos tickets et y envoie vos heures."
        >
            <form
                aria-label="Connexion à Jira"
                noValidate
                className="flex flex-col gap-4 rounded-3 border border-line bg-bg-raise px-6 py-5"
                onSubmit={(event) => {
                    event.preventDefault();
                    save();
                }}
            >
                <JiraFields
                    values={values}
                    errors={errors}
                    siteRef={siteRef}
                    emailRef={emailRef}
                    tokenRef={tokenRef}
                    readOnly={sending}
                    onTokenFocus={(event) => {
                        // Un collage remplace le jeton tout entier.
                        event.target.select();
                    }}
                    onTokenBlur={() => {
                        // Vidé, le champ ne dirait plus que l'ancien jeton reste.
                        if (tokenTyped && values.token === '') {
                            setValues({ ...values, token: STORED_TOKEN });
                            setTokenTyped(false);
                        }
                    }}
                    onChange={edit}
                />
                {general !== null && <GeneralError message={general} />}
                <div className={`flex items-center justify-between gap-4 ${leaving ? 'flex-wrap' : ''}`}>
                    <StatusLine
                        wide={leaving}
                        account={withheld ? null : account}
                        reserved={reserving ? (saved?.account ?? null) : null}
                        verified={verified}
                    />
                    {/* Toujours en place, comme la ligne d'état : le lecteur d'écran le lit quand il paraît. */}
                    <div ref={leaveRef} role="status" className={leaving ? 'basis-full scroll-mt-bar' : 'sr-only'}>
                        {leaving && (
                            <FieldWarning id={leaveId} warning="Enregistrez ou annulez vos modifications de Jira." />
                        )}
                    </div>
                    <div className="ml-auto flex flex-none gap-2">
                        {leaving && (
                            <Button aria-disabled={sending || undefined} onClick={cancel}>
                                Annuler
                            </Button>
                        )}
                        <Button
                            ref={saveRef}
                            type="submit"
                            variant="primary"
                            aria-disabled={!changed || undefined}
                            aria-describedby={leaving ? leaveId : undefined}
                            busy={sending}
                        >
                            Enregistrer
                        </Button>
                    </div>
                </div>
            </form>
        </SettingsSection>
    );
}

/**
 * La ligne d'état : une région role="status" toujours en place, que le lecteur d'écran
 * lit quand elle change. Chaque connexion vérifiée y entre de nouveau, et se redit, même
 * au même compte.
 *
 * Tant que Jira n'a pas dit si le jeton enregistré passe, la ligne du compte enregistré
 * garde sa place, invisible et muette : sa réponse ne fait pas bouger la page.
 */
function StatusLine({
    wide,
    account,
    reserved,
    verified,
}: {
    /** Seule sur sa ligne, au-dessus du message et des boutons : sans rien à dire, elle n'y prend pas de place. */
    wide: boolean;
    /** Le compte à dire ; null tant qu'il n'y a rien à dire. */
    account: string | null;
    /** Le compte dont la ligne garde la place ; null quand elle ne paraîtra pas. */
    reserved: string | null;
    verified: number;
}) {
    return (
        <div className={!wide ? 'grid min-w-0' : account !== null || reserved !== null ? 'grid basis-full' : 'sr-only'}>
            <p role="status" className="col-start-1 row-start-1 text-sm leading-(--lh) text-ink">
                {account !== null && <ConnectedText key={verified} account={account} />}
            </p>
            {account === null && reserved !== null && (
                <span aria-hidden="true" className="invisible col-start-1 row-start-1 text-sm leading-(--lh)">
                    <ConnectedText account={reserved} />
                </span>
            )}
        </div>
    );
}
