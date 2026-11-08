import { type RefObject, useEffect, useRef, useState } from 'react';

import { GeneralError } from '../components/Field';
import { Stepper } from '../components/Stepper';
import { duration } from '../day/format';
import { objectiveRefusal } from '../day/messages';
import { readObjective, stepObjective } from '../grid/objective';
import { type EditorSnapshot, type SettingsEditor, UNREAD } from './settingsEditor';
import { RowLabel, SettingsCard, SettingsRow, SettingsSection } from './SettingsSection';

/** Les jours de la semaine ISO, comme les boutons les écrivent et le lecteur d'écran les dit. */
const WEEK = [
    { day: 1, letter: 'L', name: 'Lundi' },
    { day: 2, letter: 'M', name: 'Mardi' },
    { day: 3, letter: 'M', name: 'Mercredi' },
    { day: 4, letter: 'J', name: 'Jeudi' },
    { day: 5, letter: 'V', name: 'Vendredi' },
    { day: 6, letter: 'S', name: 'Samedi' },
    { day: 7, letter: 'D', name: 'Dimanche' },
] as const;

/** Le champ de l'objectif habituel, vu de la page qui le porte. */
export interface ObjectiveField {
    /**
     * Enregistre ce qui est tapé et pas encore parti, ou ce qu'un enregistrement n'a pas
     * pu garder ; faux si la durée est refusée, le message sous le champ.
     */
    readonly commit: () => boolean;
    /** Ramène le curseur au champ, où est le message. */
    readonly focus: () => void;
}

/**
 * La section Journée : l'objectif habituel, puis les jours travaillés. Tout s'applique
 * sans bouton.
 */
export function DaySection({
    editor,
    snapshot,
    pendingRef,
}: {
    editor: SettingsEditor;
    snapshot: EditorSnapshot;
    pendingRef: RefObject<ObjectiveField | null>;
}) {
    const settings = snapshot.settings;

    return (
        <SettingsSection id="reglages-journee" title="Journée" explanation="Ce qui vaut pour chaque nouvelle journée.">
            <SettingsCard>
                {settings === null ? (
                    snapshot.unread && <Unread />
                ) : (
                    <>
                        <SettingsRow stack>
                            <RowLabel
                                label="Objectif habituel"
                                helpId="reglages-objectif-aide"
                                help="Temps à travailler chaque jour, hors pauses. Pour un jour précis, cliquez sur l'objectif au-dessus de la grille."
                                hidden
                            />
                            <HabitualObjective
                                editor={editor}
                                saved={settings.habitualObjective}
                                error={snapshot.errors.objective ?? null}
                                pendingRef={pendingRef}
                            />
                        </SettingsRow>
                        <SettingsRow stack>
                            <RowLabel
                                id="reglages-jours"
                                label="Jours travaillés"
                                help="Les autres jours n'ont pas d'objectif et ne sont jamais marqués incomplets."
                            />
                            <div role="group" aria-labelledby="reglages-jours" className="flex flex-none gap-1">
                                {WEEK.map(({ day, letter, name }) => {
                                    const worked = settings.workingDays.includes(day);

                                    return (
                                        <button
                                            key={day}
                                            type="button"
                                            aria-pressed={worked}
                                            aria-label={name}
                                            className="size-ctl cursor-pointer rounded-2 border border-line-strong bg-bg-raise text-sm font-semibold text-ink-2 transition-colors hover:bg-bg-hover aria-pressed:border-btn aria-pressed:bg-btn aria-pressed:text-on-btn aria-pressed:hover:border-btn-hover aria-pressed:hover:bg-btn-hover"
                                            onClick={() => {
                                                editor.setWorkingDay(day, !worked);
                                            }}
                                        >
                                            {letter}
                                        </button>
                                    );
                                })}
                            </div>
                        </SettingsRow>
                        {snapshot.errors.days !== undefined && (
                            <GeneralError message={snapshot.errors.days} className="pb-4" />
                        )}
                    </>
                )}
            </SettingsCard>
        </SettingsSection>
    );
}

/** Ce que disent les cartes quand les réglages ne se lisent pas. */
export function Unread() {
    return <GeneralError message={UNREAD} className="pb-4" />;
}

/**
 * L'objectif habituel : le pas à pas de la fenêtre Objectif du jour, par quarts
 * d'heure. − et + l'enregistrent aussitôt ; une durée tapée, en quittant le champ ou
 * par Entrée. Une durée refusée reste dans le champ, le message dessous, comme un
 * enregistrement qui n'aboutit pas.
 */
function HabitualObjective({
    editor,
    saved,
    error,
    pendingRef,
}: {
    editor: SettingsEditor;
    /** Ce que la page montre comme enregistré. */
    saved: number;
    /** Ce que le serveur a refusé, ou un enregistrement qui n'a pas abouti. */
    error: string | null;
    pendingRef: RefObject<ObjectiveField | null>;
}) {
    const fieldRef = useRef<HTMLInputElement>(null);
    // Ce qu'on tape, tant que ce n'est pas parti ; null sinon.
    const [typed, setTyped] = useState<string | null>(null);
    // La dernière durée partie : elle reste au champ si son enregistrement n'aboutit pas.
    const [sent, setSent] = useState<number | null>(null);
    const [refusal, setRefusal] = useState<string | null>(null);
    const failed = error !== null && sent !== null;
    // Le champ montre ce qu'on tape, sinon ce que tient le serveur — qu'un autre onglet a
    // pu changer —, sauf une durée qui n'a pas pu s'enregistrer.
    const text = typed ?? duration(failed ? sent : saved);
    const reading = readObjective(text);

    const save = (minutes: number) => {
        setTyped(null);
        setRefusal(null);
        setSent(minutes);
        if (minutes !== saved || failed) {
            editor.setHabitualObjective(minutes);
        }
    };

    /**
     * Enregistre ce qui est tapé, ou réessaie ce qui n'a pas abouti ; faux si la durée
     * est refusée. Rien d'autre ne part : un onglet resté ouvert ne renvoie jamais une
     * durée que les réglages ont quittée depuis.
     */
    const commit = (): boolean => {
        if (typed === null && !failed) {
            return true;
        }
        if (reading.kind !== 'ok') {
            setRefusal(objectiveRefusal(reading));

            return false;
        }
        save(reading.minutes);

        return true;
    };

    useEffect(() => {
        pendingRef.current = {
            commit: () => {
                const kept = commit();
                if (!kept) {
                    fieldRef.current?.focus();
                }

                return kept;
            },
            focus: () => {
                fieldRef.current?.focus();
            },
        };

        return () => {
            pendingRef.current = null;
        };
    });

    // Une durée refusée part d'elle-même : 8h10 donne 8h00 ou 8h15.
    const step = (direction: -1 | 1) => {
        save(stepObjective(reading.kind === 'format' ? saved : reading.minutes, direction));
    };

    return (
        <div className="settings-stepper">
            <Stepper
                ref={fieldRef}
                label="Objectif habituel"
                hideLabel
                aria-describedby="reglages-objectif-aide"
                decreaseLabel="Enlever 15 minutes"
                increaseLabel="Ajouter 15 minutes"
                value={text}
                error={refusal ?? error}
                onDecrease={() => {
                    step(-1);
                }}
                onIncrease={() => {
                    step(1);
                }}
                onChange={(event) => {
                    setTyped(event.target.value);
                    setRefusal(null);
                }}
                onBlur={() => {
                    commit();
                }}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.repeat) {
                        event.preventDefault();
                        commit();
                    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                        event.preventDefault();
                        step(event.key === 'ArrowUp' ? 1 : -1);
                    }
                }}
            />
        </div>
    );
}
