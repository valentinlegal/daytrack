import { type RefObject, type SyntheticEvent, useId, useLayoutEffect, useRef } from 'react';

import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { DayToggle } from '../components/DayToggle';
import { Field, FieldError } from '../components/Field';
import { ErrorIcon } from '../components/icons';
import { RadioGroup } from '../components/RadioGroup';
import { fallsOn, type Recurrence, type Schedule, timeline } from '../grid/recurrence';
import {
    alternatingWith,
    draftClash,
    draftRhythm,
    draftSkipped,
    draftUntil,
    type MonthChoice,
    monthChoiceOf,
    monthChoices,
    noDayChosen,
    type Pace,
    type RecurrenceDraft,
    recurrenceFirstDay,
    type SeenDay,
    toggleDay,
} from './recurrenceDraft';
import { saveOnEnter } from './TicketField';
import {
    alternateLabel,
    alternationNote,
    monthChoiceLabel,
    monthNote,
    recurrenceSentence,
    type Start,
    takenRefusal,
    timeLabel,
    timeTile,
    weekdayLetter,
    weekdayTitle,
} from './recurrenceText';

/** Le champ date ne va pas au-delà d'une année de quatre chiffres. */
const LAST_DATE = '9999-12-31';

/** Une semaine sur 2, 3 ou 4. */
const EVERY_WEEKS = [2, 3, 4] as const;

/**
 * La case « Récurrence », en dernier dans la fenêtre d'un ticket ou d'une pause. Décochée,
 * c'est une ligne de plus ; cochée, elle déplie le rythme — chaque semaine, une semaine sur
 * 2, 3 ou 4, chaque mois —, ses jours — les seuls jours travaillés des réglages — ou son jour
 * du mois, « Jusqu'au », les cinq prochaines fois à la teinte du ticket, et la phrase qui dit
 * le rythme.
 *
 * Les prochaines fois se calculent comme le serveur posera (assets/grid/recurrence.ts) :
 * après le jour affiché et après aujourd'hui. Un créneau qu'une autre récurrence prend déjà
 * se dit dessous, chaque fois prise marquée « Pris », avant même d'enregistrer ; le serveur
 * le refuse de même.
 */
export function RecurrenceSection({
    draft,
    day,
    today,
    linked,
    start,
    end,
    tint,
    from,
    minimum,
    errors,
    firstDayRef,
    untilRef,
    rhythmRef,
    alternateRef,
    onChange,
    onEnter,
}: {
    draft: RecurrenceDraft;
    /**
     * Le jour du bloc, ses jours travaillés, les récurrences que la journée a lues, et les jours à
     * venir déjà envoyés : elle ne s'y posera pas, et ses prochaines fois ne les montrent pas.
     */
    day: SeenDay;
    today: string;
    /** La récurrence du bloc, s'il revient : ce qu'on règle la remplace, et ne se juge pas contre elle. */
    linked: Recurrence | null;
    /** La plage que la phrase dit, en minutes : celle de la récurrence du bloc, ou du bloc s'il n'en porte pas. */
    start: number;
    end: number;
    /** La teinte du ticket tapé, ou « pause » ; aucune tant que Jira ne l'a pas dite. */
    tint: string | null;
    /** D'où part ce qu'on enregistre ; null pour celle d'un bloc qui revient déjà (recurrenceStart). */
    from: Start;
    /** Le premier jour que « Jusqu'au » accepte (untilMinimum). */
    minimum: string;
    errors: { readonly weekdays: string | null; readonly until: string | null; readonly rhythm: string | null };
    /** Le premier jour, « Jusqu'au », le rythme choisi et « Alterner » : un refus y pose le curseur. */
    firstDayRef: RefObject<HTMLButtonElement | null>;
    untilRef: RefObject<HTMLInputElement | null>;
    rhythmRef: RefObject<HTMLInputElement | null>;
    alternateRef: RefObject<HTMLButtonElement | null>;
    onChange: (draft: RecurrenceDraft) => void;
    /** Entrée dans « Jusqu'au » ou sur le rythme enregistre la fenêtre, comme dans ses autres champs. */
    onEnter: () => void;
}) {
    const detailId = useId();
    const paceGroupId = useId();
    const daysId = useId();
    const daysErrorId = useId();
    const everyId = useId();
    const timesId = useId();
    const refusalId = useId();
    // « Alterner » choisi disparaît avec le refus : le curseur passe à la carte du rythme qu'il
    // a choisie, une semaine sur n, plutôt que de se perdre.
    const alternatedRef = useRef(false);
    useLayoutEffect(() => {
        if (alternatedRef.current) {
            alternatedRef.current = false;
            rhythmRef.current?.focus();
        }
    });
    const { date, workingDays, settledAhead } = day;
    // La phrase, les prochaines fois et le créneau pris (draftClash) lisent la même fin.
    const until = draftUntil(draft);
    const rhythm = draftRhythm(draft, date, workingDays);
    const clash = draftClash(draft, linked, day, today, start, end);
    const ruled: Schedule = { rhythm, firstDay: recurrenceFirstDay(draft, linked, date, today, workingDays), until };
    // Les fois détachées ou effacées de celle du bloc ne se montrent pas, tant que son rythme
    // reste le sien ; ni ses fois sur un jour à venir déjà envoyé, qu'aucune récurrence ne change
    // plus, et où aucune ne prend de créneau.
    const schedule: Schedule = {
        ...ruled,
        skipped: [...draftSkipped(rhythm, linked), ...[...settledAhead].filter((settled) => fallsOn(ruled, settled))],
    };
    // Un jour que les réglages ne travaillent plus ne suffit pas : la case ne le montre pas.
    const noDay = noDayChosen(draft, workingDays);
    const times = noDay ? [] : timeline(schedule, date > today ? date : today, workingDays);
    const refusal = clash === null ? errors.rhythm : takenRefusal(clash.recurrence);
    const alternation = clash === null ? alternatingWith(draft, linked, day, today, start, end) : null;
    const note =
        alternation !== null
            ? alternationNote(alternation.recurrence, alternation.weekdays)
            : monthNote(rhythm, workingDays);
    // Jours ISO, du lundi au dimanche : seuls ceux que les réglages travaillent se choisissent.
    const days = [1, 2, 3, 4, 5, 6, 7].filter((weekday) => workingDays.includes(weekday));
    const months = monthChoices(draft, date, workingDays);
    const paces: readonly { readonly pace: Pace; readonly label: string }[] = [
        { pace: 'week', label: 'Chaque semaine' },
        { pace: 'every', label: `Une semaine sur ${String(draft.everyWeeks)}` },
        { pace: 'month', label: 'Chaque mois' },
    ];

    /**
     * Le champ date ne donne sa valeur qu'une fois la date complète : commencée, elle reste
     * vide. Sa frappe et son départ disent aussi s'il en manque une partie, pour ne jamais
     * lire une date à moitié tapée comme « sans fin ». Vidé par « Effacer » du calendrier du
     * navigateur, il ne change pas de valeur, et onChange se tait : onInput le dit.
     */
    const typed = (event: SyntheticEvent<HTMLInputElement>) => {
        const { value, validity } = event.currentTarget;
        if (value !== draft.until || validity.badInput !== (draft.incomplete === true)) {
            onChange({ ...draft, until: value, incomplete: validity.badInput });
        }
    };

    return (
        <div className="flex flex-col gap-4 border-t border-line pt-4">
            <Checkbox
                label="Récurrence"
                checked={draft.on}
                aria-controls={draft.on ? detailId : undefined}
                onChange={(event) => {
                    onChange({ ...draft, on: event.target.checked });
                }}
            />
            {draft.on && (
                <div id={detailId} className="flex flex-col gap-4">
                    <div
                        role="radiogroup"
                        aria-label="Rythme"
                        // Le refus d'un créneau pris se dit sous les prochaines fois : le rythme le
                        // désigne, c'est lui qui le lève.
                        aria-describedby={refusal !== null && !noDay ? refusalId : undefined}
                        className="grid grid-cols-3 gap-2"
                    >
                        {paces.map(({ pace, label }) => (
                            <label
                                key={pace}
                                className="rhythm-card relative flex cursor-pointer flex-col items-center justify-between gap-2 rounded-2 border border-line-strong bg-bg-raise px-1 pt-3 pb-2 text-center text-sm leading-(--lh) text-ink-2 hover:bg-bg-hover has-checked:border-focus has-checked:text-ink has-checked:ring has-checked:ring-focus"
                            >
                                <input
                                    ref={draft.pace === pace ? rhythmRef : undefined}
                                    type="radio"
                                    name={paceGroupId}
                                    value={pace}
                                    checked={draft.pace === pace}
                                    onChange={() => {
                                        onChange({ ...draft, pace });
                                    }}
                                    onKeyDown={saveOnEnter(onEnter)}
                                />
                                <RhythmScheme pace={pace} />
                                <span>{label}</span>
                            </label>
                        ))}
                    </div>
                    <div className="flex flex-wrap items-start gap-x-5 gap-y-4">
                        {draft.pace !== 'month' && (
                            // La colonne prend la largeur de ses boutons : un refus passe à la ligne
                            // dessous, sans pousser « Jusqu'au ».
                            <div className="flex w-min min-w-0 flex-col gap-2">
                                <span id={daysId} className="text-sm leading-(--lh) font-semibold text-ink-2">
                                    Jours
                                </span>
                                <div
                                    role="group"
                                    aria-labelledby={daysId}
                                    aria-describedby={errors.weekdays === null ? undefined : daysErrorId}
                                    className="flex items-center gap-1"
                                >
                                    {days.map((weekday, index) => (
                                        <DayToggle
                                            key={weekday}
                                            ref={index === 0 ? firstDayRef : undefined}
                                            letter={weekdayLetter(weekday)}
                                            name={weekdayTitle(weekday)}
                                            pressed={draft.weekdays.includes(weekday)}
                                            onClick={() => {
                                                onChange(toggleDay(draft, weekday, workingDays));
                                            }}
                                        />
                                    ))}
                                </div>
                                {errors.weekdays !== null && <FieldError id={daysErrorId} error={errors.weekdays} />}
                            </div>
                        )}
                        {draft.pace === 'every' && (
                            <div className="flex min-w-0 flex-col gap-2">
                                <span id={everyId} className="text-sm leading-(--lh) font-semibold text-ink-2">
                                    Une semaine sur
                                </span>
                                <div role="group" aria-labelledby={everyId} className="flex items-center gap-1">
                                    {EVERY_WEEKS.map((weeks) => (
                                        <DayToggle
                                            key={weeks}
                                            letter={String(weeks)}
                                            name={`Une semaine sur ${String(weeks)}`}
                                            pressed={draft.everyWeeks === weeks}
                                            onClick={() => {
                                                onChange({ ...draft, everyWeeks: weeks });
                                            }}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}
                        {draft.pace === 'month' && (
                            <div className="flex min-w-0 flex-col gap-2">
                                <span aria-hidden="true" className="text-sm leading-(--lh) font-semibold text-ink-2">
                                    Jour du mois
                                </span>
                                <RadioGroup
                                    label="Jour du mois"
                                    options={months.map((choice) => ({
                                        value: monthChoiceOf(choice),
                                        label: monthChoiceLabel(choice),
                                    }))}
                                    value={monthChoiceOf(rhythm)}
                                    onValueChange={(value) => {
                                        onChange({ ...draft, month: value as MonthChoice });
                                    }}
                                    onKeyDown={saveOnEnter(onEnter)}
                                />
                            </div>
                        )}
                        <div className="min-w-ticket flex-1">
                            <Field
                                ref={untilRef}
                                label="Jusqu'au"
                                optional
                                mono
                                type="date"
                                min={minimum}
                                max={LAST_DATE}
                                value={draft.until}
                                error={errors.until}
                                onChange={typed}
                                onInput={typed}
                                onKeyUp={typed}
                                onBlur={typed}
                                onKeyDown={saveOnEnter(onEnter)}
                            />
                        </div>
                    </div>
                    <div className="flex min-w-0 flex-col gap-2">
                        <span id={timesId} className="text-sm leading-(--lh) font-semibold text-ink-2">
                            Prochaines fois
                        </span>
                        {times.length === 0 ? (
                            <p className="text-sm text-ink-2">Ne revient plus.</p>
                        ) : (
                            <ol
                                aria-labelledby={timesId}
                                data-color={tint === null || tint === 'pause' ? undefined : tint}
                                className={`recurrence-times m-0 grid list-none grid-cols-5 gap-1 p-0 ${tint === 'pause' ? 'is-pause' : ''}`}
                            >
                                {times.map(({ date: time, falls }) => {
                                    const tile = timeTile(time);
                                    const takenBy = falls ? (clash?.takenOn(time) ?? null) : null;

                                    return (
                                        <li
                                            key={time}
                                            aria-label={timeLabel(time, falls, takenBy)}
                                            data-state={!falls ? 'none' : takenBy !== null ? 'taken' : undefined}
                                            className="group flex min-w-0 flex-col justify-center rounded-1 border border-l-(length:--b-ty) border-ty-line border-l-ty-bar bg-ty-bg px-2 py-1 leading-(--lh) data-[state=none]:border-l data-[state=none]:border-dashed data-[state=none]:border-line-strong data-[state=none]:bg-transparent data-[state=none]:pl-(--recurrence-pad-thin)"
                                        >
                                            <span
                                                aria-hidden="true"
                                                className="text-sm font-semibold whitespace-nowrap text-ty-id tabular-nums group-data-[state=none]:font-regular"
                                            >
                                                {tile.day}
                                            </span>
                                            <span
                                                aria-hidden="true"
                                                className="text-xs whitespace-nowrap text-ink-2 group-data-[state=none]:text-ink-3 group-data-[state=taken]:font-semibold group-data-[state=taken]:text-inc"
                                            >
                                                {takenBy === null ? tile.weekday : 'Pris'}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ol>
                        )}
                        {refusal !== null && !noDay && (
                            <div
                                id={refusalId}
                                role="alert"
                                className="flex scroll-mb-4 items-start gap-2 text-sm leading-(--lh) text-inc"
                            >
                                <ErrorIcon />
                                <div className="flex flex-col items-start gap-1">
                                    <span>{refusal}</span>
                                    {clash?.alternate != null && (
                                        <Button
                                            ref={alternateRef}
                                            variant="link"
                                            onClick={() => {
                                                if (clash.alternate !== null) {
                                                    alternatedRef.current = true;
                                                    onChange(clash.alternate);
                                                }
                                            }}
                                        >
                                            {alternateLabel(clash.recurrence)}
                                        </Button>
                                    )}
                                </div>
                            </div>
                        )}
                        {!noDay && (
                            <p className="text-sm leading-(--lh) text-ink-2">
                                {recurrenceSentence(rhythm, start, end, until, from, today)}
                            </p>
                        )}
                        {!noDay && note !== null && <p className="text-sm leading-(--lh) text-ink-2">{note}</p>}
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * Le petit schéma d'une carte du rythme : cinq semaines pleines, une sur deux en creux, ou un
 * mois de quatre semaines où une case ressort.
 */
function RhythmScheme({ pace }: { pace: Pace }) {
    if (pace === 'month') {
        return (
            <span aria-hidden="true" className="rhythm-scheme is-month">
                {Array.from({ length: 28 }, (_, index) => (
                    <i key={index} data-on={index === 18 ? true : undefined} />
                ))}
            </span>
        );
    }

    return (
        <span aria-hidden="true" className="rhythm-scheme">
            {[0, 1, 2, 3, 4].map((week) => (
                <i key={week} data-off={pace === 'every' && week % 2 === 1 ? true : undefined} />
            ))}
        </span>
    );
}
