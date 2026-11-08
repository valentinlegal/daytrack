import { type RefObject, useEffect, useRef, useState } from 'react';

import { Button } from '../components/Button';
import { GeneralError } from '../components/Field';
import { type Measurable, Popover } from '../components/Popover';
import { Stepper } from '../components/Stepper';
import { tokenPixels } from '../components/tokenPixels';
import type { DayState } from '../grid/day';
import type { DaySession } from '../grid/daySession';
import { dayFigures } from '../grid/figures';
import { readObjective, stepObjective } from '../grid/objective';
import * as Quarter from '../grid/quarter';
import { dayLabel, type Tense } from './calendar';
import { figuresLine } from './figuresLine';
import { duration } from './format';
import { objectiveRefusal, windowRefusal } from './messages';

/** Une fenêtre ouverte, vue de l'écran qui la porte. */
export interface OpenWindow {
    /** Enregistre, comme sur un clic à côté ; la promesse dit si elle s'est fermée. */
    readonly save: () => Promise<boolean>;
    /** On y a changé quelque chose qui n'est pas encore enregistré. */
    readonly unsaved: () => boolean;
}

/**
 * La fenêtre Objectif du jour : sous le bouton de l'objectif, la durée au quart d'heure,
 * la fin prévue recalculée, et le lien qui remet la durée habituelle, sans rien
 * enregistrer, comme − et +.
 *
 * C'est une fenêtre où l'on saisit : un clic à côté enregistre, la croix, Échap et
 * « Annuler » abandonnent. Une durée refusée garde la fenêtre ouverte et ce qui a été
 * tapé.
 */
export function ObjectiveWindow({
    open,
    session,
    day,
    now,
    tense,
    anchor,
    alignOffset,
    flushRef,
    readHabitual,
    onClose,
}: {
    open: boolean;
    session: DaySession | null;
    day: DayState | null;
    /** L'heure qu'il est, si la journée est celle d'aujourd'hui. */
    now: number | null;
    tense: Tense;
    /** Le bouton de l'objectif, où pointe la flèche. */
    anchor: RefObject<Measurable | null>;
    /** L'écart entre le bord gauche de la fenêtre et celui du bouton : elle s'aligne sur la date. */
    alignOffset: number;
    /**
     * Où la fenêtre ouverte range de quoi s'enregistrer avant un changement de jour, ou
     * avant de quitter la page, comme sur un clic à côté.
     */
    flushRef: RefObject<OpenWindow | null>;
    /**
     * L'objectif habituel tel que les réglages le tiennent : un autre onglet a pu le
     * changer depuis que la journée s'est lue.
     */
    readHabitual?: (() => Promise<number>) | undefined;
    onClose: () => void;
}) {
    if (!open || session === null || day === null) {
        return null;
    }

    return (
        <ObjectiveForm
            session={session}
            day={day}
            now={now}
            tense={tense}
            anchor={anchor}
            alignOffset={alignOffset}
            flushRef={flushRef}
            readHabitual={readHabitual}
            onClose={onClose}
        />
    );
}

function ObjectiveForm({
    session,
    day,
    now,
    tense,
    anchor,
    alignOffset,
    flushRef,
    readHabitual,
    onClose,
}: {
    session: DaySession;
    day: DayState;
    now: number | null;
    tense: Tense;
    anchor: RefObject<Measurable | null>;
    alignOffset: number;
    flushRef: RefObject<OpenWindow | null>;
    readHabitual?: (() => Promise<number>) | undefined;
    onClose: () => void;
}) {
    const fieldRef = useRef<HTMLInputElement>(null);
    // « Revenir à … » propose celui des réglages : la journée le dit, puis les réglages
    // le redisent, à jour, dès qu'ils répondent. Sans réponse, celui de la journée tient.
    const [habitual, setHabitual] = useState(day.habitualObjective);
    const readHabitualRef = useRef(readHabitual);
    useEffect(() => {
        let current = true;
        void readHabitualRef.current?.().then(
            (minutes) => {
                if (current) {
                    setHabitual(minutes);
                }
            },
            () => undefined,
        );

        return () => {
            current = false;
        };
    }, []);
    const [text, setText] = useState(() => duration(day.objective));
    const [error, setError] = useState<string | null>(null);
    const [general, setGeneral] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const pendingRef = useRef<Promise<boolean> | null>(null);
    const sessionRef = useRef(session);
    useEffect(() => {
        sessionRef.current = session;
    }, [session]);
    // L'objectif relu sous la fenêtre ouverte — au retour sur la page — a changé ailleurs.
    // Sans rien de tapé, elle montre le nouveau ; sinon, elle garde ce qu'on y a tapé. Elle
    // dit que la journée a changé : l'enregistrer n'écrase jamais en silence ce qu'un autre
    // onglet a choisi. Pendant qu'elle s'enregistre, c'est sa réponse qui en décide.
    const [shownObjective, setShownObjective] = useState(day.objective);
    if (shownObjective !== day.objective) {
        setShownObjective(day.objective);
        if (!sending) {
            if (text === duration(shownObjective)) {
                setText(duration(day.objective));
            }
            setGeneral(windowRefusal({ kind: 'stale' }));
        }
    }

    const reading = readObjective(text);
    const draft = reading.kind === 'ok' ? reading.minutes : null;
    const tail = draft === null ? null : figuresLine(dayFigures(day.grid, draft, now), draft, tense).tail;
    const end = tail?.kind === 'remaining' ? tail.projectedEnd : null;

    /** Enregistre, puis ferme ; la promesse dit si la fenêtre s'est fermée. */
    const save = (): Promise<boolean> => {
        if (pendingRef.current !== null) {
            return pendingRef.current;
        }
        const wanted = draft;
        if (wanted === null) {
            setError(reading.kind === 'ok' ? null : objectiveRefusal(reading));
            fieldRef.current?.focus();

            return Promise.resolve(false);
        }
        setSending(true);
        setGeneral(null);
        const pending = session.setObjective(wanted).then((outcome) => {
            pendingRef.current = null;
            const closed = outcome.kind === 'saved' || outcome.kind === 'unchanged';
            if (sessionRef.current !== session) {
                return closed;
            }
            setSending(false);
            if (closed) {
                onClose();
            } else if (outcome.kind === 'invalid') {
                setError(outcome.violations[0]?.message ?? null);
                fieldRef.current?.focus();
            } else {
                setGeneral(windowRefusal(outcome));
            }

            return closed;
        });
        pendingRef.current = pending;

        return pending;
    };

    useEffect(() => {
        flushRef.current = { save, unsaved: () => text !== duration(day.objective) };

        return () => {
            flushRef.current = null;
        };
    });

    const step = (direction: -1 | 1) => {
        setText(duration(stepObjective(reading.kind === 'format' ? day.objective : reading.minutes, direction)));
        setError(null);
    };

    return (
        <Popover
            open
            anchor={anchor}
            side="bottom"
            align="start"
            sideOffset={tokenPixels('--s-3')}
            alignOffset={alignOffset}
            width="pop-sm"
            title="Objectif du jour"
            subtitle={dayLabel(day.date)}
            sending={sending}
            initialFocus={fieldRef}
            returnFocus={() => {
                if (anchor.current instanceof HTMLElement) {
                    anchor.current.focus();
                }
            }}
            onCancel={onClose}
            onOutside={() => {
                void save();
            }}
            footerEnd={
                <>
                    <Button size="sm" onClick={sending ? undefined : onClose}>
                        Annuler
                    </Button>
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={() => {
                            void save();
                        }}
                    >
                        Enregistrer
                    </Button>
                </>
            }
        >
            <Stepper
                ref={fieldRef}
                label="Durée à travailler, hors pauses"
                decreaseLabel="Enlever 15 minutes"
                increaseLabel="Ajouter 15 minutes"
                value={text}
                error={error}
                onDecrease={() => {
                    step(-1);
                }}
                onIncrease={() => {
                    step(1);
                }}
                onChange={(event) => {
                    setText(event.target.value);
                    setError(null);
                }}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.repeat) {
                        event.preventDefault();
                        void save();
                    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                        event.preventDefault();
                        step(event.key === 'ArrowUp' ? 1 : -1);
                    }
                }}
            />
            <div className="flex flex-col items-start gap-2">
                <p className="text-sm leading-(--lh) text-ink-2">
                    {/* À 0h00, le jour se déclare non travaillé, sauf à l'objectif habituel, qu'il suit. */}
                    {draft === 0 && habitual !== 0 ? (
                        'Jour non travaillé. '
                    ) : end !== null ? (
                        <>
                            Fin prévue à <b className="font-semibold text-ink tabular-nums">{Quarter.format(end)}</b>
                            .{' '}
                        </>
                    ) : null}
                    Les autres jours gardent votre objectif habituel.
                </p>
                {draft !== habitual && (
                    <Button
                        variant="link"
                        onClick={() => {
                            // Le lien disparaît : le curseur va au champ, qu'il vient de remplir.
                            setText(duration(habitual));
                            setError(null);
                            fieldRef.current?.focus();
                        }}
                    >
                        Revenir à {duration(habitual)}
                    </Button>
                )}
            </div>
            {general !== null && <GeneralError message={general} />}
        </Popover>
    );
}
