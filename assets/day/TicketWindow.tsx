import {
    type MouseEvent,
    type RefObject,
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';

import { Button } from '../components/Button';
import { GeneralError } from '../components/Field';
import { CupIcon, TrashIcon } from '../components/icons';
import { type Measurable, Popover } from '../components/Popover';
import { RadioGroup } from '../components/RadioGroup';
import { TextArea } from '../components/TextArea';
import { tokenPixels } from '../components/tokenPixels';
import { Tooltip } from '../components/Tooltip';
import { draftOf, quartersOf, typedComment } from '../grid/entry';
import { MINUTES } from '../grid/quarter';
import type { Recurrence } from '../grid/recurrence';
import { describedTicket, type TicketInfo, tintOf } from '../jira/ticketInfo';
import { useTickets } from '../jira/TicketsContext';
import type { Lookup, TicketCheck } from '../jira/useTicketLookup';
import { dayLabel } from './calendar';
import { rangeLabel, windowSubtitle } from './messages';
import {
    draftClash,
    type RecurrenceDraft,
    recurrenceStart,
    saveBlocked,
    untilMinimum,
    untilUnfinished,
    type SeenDay,
} from './recurrenceDraft';
import { RecurrenceSection } from './RecurrenceSection';
import { rewrite } from './rewrite';
import { saveOnEnter, TicketField, useTicketField } from './TicketField';
import type { PlacedWindow, ScopeChoice, TicketWindow as TicketWindowState, WindowQuestion } from './useGridEditing';

/**
 * Les fenêtres Nouveau ticket, Modifier le ticket et Modifier la sélection : ouvertes au
 * pointeur, accrochées au créneau, à la sélection ou au quart d'heure du bloc qui les a
 * ouvertes, qu'elles suivent quand la grille défile. Sur une sélection déjà saisie,
 * Nouveau ticket dit ce qu'elle remplacera ; sur une partie de bloc, Modifier la
 * sélection dit que le reste ne bouge pas. Toutes s'ouvrent le curseur dans le champ
 * Ticket.
 *
 * On y saisit comme dans une cellule de tableur : Entrée ou un clic à côté
 * enregistrent, la croix, Échap et « Annuler » abandonnent. Un refus garde la fenêtre
 * ouverte, ce qui a été tapé, et le message sous son champ. Le ticket se récrit
 * pendant la frappe, et sa forme se juge quand on quitte son champ.
 *
 * Sur un bloc qui revient, la question « quelles fois » se pose dans la même fenêtre. Après
 * Enregistrer ou la corbeille, elle prend la place des champs, à leur largeur : ils restent
 * là, cachés, et Retour les rend tels qu'on les a laissés, le curseur dans celui qu'on venait
 * de quitter. Après Suppr, elle s'ouvre seule sous le quart d'heure visé, plus étroite, et
 * Annuler la ferme. Entrée et un clic à côté valident le choix ; Échap fait comme le bouton
 * de gauche.
 */
export function TicketWindow({
    date,
    today,
    workingDays,
    window: shown,
    recurrence,
    initialRecurrence,
    linked,
    ongoing,
    settledAhead,
    note,
    place,
    gridRef,
    checkRef,
    onDraft,
    onRecurrence,
    onSave,
    onCancel,
    onPause,
    onDelete,
    onChooseScope,
    onCheckTicket,
    returnFocus,
}: {
    date: string;
    today: string;
    /** Ceux des réglages : seuls eux se choisissent dans les jours d'une récurrence. */
    workingDays: readonly number[];
    window: TicketWindowState | null;
    /** La case « Récurrence », telle qu'elle est réglée ; null quand la fenêtre n'en a pas. */
    recurrence: RecurrenceDraft | null;
    /** La même, telle qu'à l'ouverture : une récurrence changée suffit à enregistrer. */
    initialRecurrence: RecurrenceDraft | null;
    /** La récurrence du bloc, s'il revient (linkedRecurrence). */
    linked: Recurrence | null;
    /** Les récurrences que la journée a lues : un créneau déjà pris se dit avant d'enregistrer. */
    ongoing: ReadonlyMap<string, Recurrence>;
    /** Les jours à venir déjà envoyés, que les prochaines fois d'une récurrence n'annoncent pas. */
    settledAhead?: ReadonlySet<string> | undefined;
    onRecurrence: (draft: RecurrenceDraft) => void;
    /**
     * Sous les champs : ce que Nouveau ticket remplacera, « Remplace SHOP-482 sur ces 30
     * minutes. », ou « Modifie SHOP-482 sur ces 45 minutes seulement. ».
     */
    note: string | null;
    /** Ce à quoi la fenêtre s'accroche, selon sa hauteur. */
    place: ((height: number) => PlacedWindow) | null;
    /** La grille : la fenêtre se replace quand elle défile. */
    gridRef: RefObject<HTMLElement | null>;
    /** Où dire ce que Jira sait du ticket tapé : un autre geste qui quitte la fenêtre le lit. */
    checkRef: RefObject<TicketCheck>;
    onDraft: (draft: TicketWindowState['draft']) => void;
    /** Ce que Jira sait du ticket tapé : l'enregistrement attend sa réponse quand il le cherche encore. */
    onSave: (check: TicketCheck) => void;
    onCancel: () => void;
    onPause: () => void;
    onDelete: () => void;
    /** Un choix de la question « quelles fois ». */
    onChooseScope: (choice: ScopeChoice) => void;
    /** On quitte le champ Ticket : sa forme se juge. */
    onCheckTicket: () => void;
    returnFocus: () => void;
}) {
    const ticketRef = useRef<HTMLInputElement>(null);
    const commentRef = useRef<HTMLTextAreaElement>(null);
    const firstDayRef = useRef<HTMLButtonElement>(null);
    const untilRef = useRef<HTMLInputElement>(null);
    const rhythmRef = useRef<HTMLInputElement>(null);
    const alternateRef = useRef<HTMLButtonElement>(null);
    const scopeRef = useRef<HTMLInputElement>(null);
    /** Ce que la fenêtre montre, champs ou question : la fenêtre se mesure par lui. */
    const contentRef = useRef<HTMLDivElement>(null);
    /**
     * Le dernier champ qui a eu le curseur : quand la question prend la place des champs, c'est
     * celui qu'on vient de quitter, et Retour le lui rend.
     */
    const leftRef = useRef<HTMLElement | null>(null);
    const followFocus = useCallback((fields: HTMLDivElement) => {
        const note = (event: FocusEvent) => {
            if (event.target instanceof HTMLElement) {
                leftRef.current = event.target;
            }
        };
        fields.addEventListener('focusin', note);

        return () => {
            fields.removeEventListener('focusin', note);
        };
    }, []);
    const noteId = useId();
    const previewId = useId();
    // Ce que Jira dit du ticket tapé ; « Enregistrer » pendant la recherche l'attend. Un bloc
    // qui garde son ticket ne l'attend pas (useTicketField).
    const field = useTicketField(
        shown?.draft.ticket ?? '',
        shown === null ? '' : draftOf(shown.target).ticket,
        checkRef,
    );
    const { lookup, check } = field;
    const unknownTicket = check.refused;
    const tickets = useTickets();
    // Son créneau sorti de la vue, elle s'est arrêtée au bord : sa flèche désignerait un autre.
    const [stopped, setStopped] = useState(false);
    const [maxHeight, setMaxHeight] = useState<number | null>(null);

    // Sa hauteur entière, contenu compris, et non celle qui tient dans l'écran : plus haute
    // qu'à son accroche, elle grandit vers le bas jusqu'au bas de l'écran, et son contenu défile
    // au-delà (windowPlacement.ts). La question se mesure seule : les champs qu'elle cache ne
    // comptent pas.
    const height = useCallback(() => {
        const dialog = contentRef.current?.closest('[role="dialog"]');
        const body = dialog?.querySelector('.popover-body');

        return dialog === null || dialog === undefined
            ? 0
            : dialog.getBoundingClientRect().height +
                  (body === null || body === undefined ? 0 : body.scrollHeight - body.clientHeight);
    }, []);
    /** La hauteur sur laquelle Radix l'a placée en dernier. */
    const placedRef = useRef<number | null>(null);
    /** Sa hauteur au plus, telle que la fenêtre l'a prise en dernier. */
    const shownMaxHeightRef = useRef<number | null>(null);
    /**
     * Un refus qui ne tient à aucun champ vient de s'amener à l'écran, avant que Radix replace
     * la fenêtre qu'il allonge : si sa hauteur au plus change alors, il s'y amène de nouveau.
     */
    const sayAgainRef = useRef(false);
    /**
     * Change quand son contenu change de hauteur sans qu'elle change de taille — sa hauteur au
     * plus déjà atteinte, il défile — : Radix, qui ne voit que sa taille, la replace alors.
     */
    const [measure, setMeasure] = useState(0);

    // La fenêtre se mesure quand Radix la place, et à chaque fois que la grille défile :
    // selon sa hauteur, Nouveau ticket passe dessous ou s'accroche plus haut
    // (windowPlacement.ts).
    const anchor = useMemo<RefObject<(Measurable & { readonly measure: number }) | null>>(
        () => ({
            current:
                place === null
                    ? null
                    : {
                          // Une mesure de plus : un rectangle neuf, que Radix replace.
                          measure,
                          get contextElement() {
                              return gridRef.current ?? undefined;
                          },
                          getBoundingClientRect: () => {
                              const measured = height();
                              placedRef.current = measured;
                              const placed = place(measured);
                              setStopped(placed.stopped);
                              // Replacée sans changer de hauteur au plus : le refus déjà amené à
                              // l'écran y reste.
                              if (placed.maxHeight === shownMaxHeightRef.current) {
                                  sayAgainRef.current = false;
                              }
                              setMaxHeight(placed.maxHeight);

                              return placed.rect;
                          },
                      },
        }),
        [place, gridRef, height, measure],
    );
    // Ce qu'elle montre a changé de hauteur depuis que Radix l'a placée — une case cochée, un
    // refus, l'aperçu du ticket —, sa hauteur au plus peut-être déjà atteinte.
    useLayoutEffect(() => {
        const placed = placedRef.current;
        if (placed !== null && Math.abs(height() - placed) >= 1) {
            placedRef.current = null;
            setMeasure((count) => count + 1);
        }
    }, [shown, lookup, height]);

    // Un enregistrement refusé pose le curseur sur le premier champ refusé, là où est le
    // message ; un refus dit en quittant le champ Ticket le laisse où on allait.
    const errors = shown?.errors ?? null;
    useEffect(() => {
        if (errors?.focus !== true) {
            return;
        }
        if (errors.ticket !== null) {
            ticketRef.current?.focus();
        } else if (errors.comment !== null) {
            commentRef.current?.focus();
        } else if (errors.weekdays !== null) {
            firstDayRef.current?.focus();
        } else if (errors.until !== null) {
            untilRef.current?.focus();
        } else if (errors.rhythm !== null) {
            // Un créneau déjà pris : « Alterner » le libère, s'il est proposé ; sinon le rythme.
            (alternateRef.current ?? rhythmRef.current)?.focus();
        }
    }, [errors]);

    // Un refus qui ne tient à aucun champ, dit en dernier : dans une fenêtre qui défile, il
    // s'amène à l'écran, comme le refus sous un champ où le curseur se pose.
    const generalRef = useRef<HTMLParagraphElement>(null);
    const general = errors?.general ?? null;
    const saidRef = useRef<string | null>(null);
    useEffect(() => {
        if (general !== null && (saidRef.current === null || errors?.focus === true)) {
            generalRef.current?.scrollIntoView({ block: 'nearest' });
            // Plus haute de lui, la fenêtre attend que Radix la replace.
            sayAgainRef.current = placedRef.current === null;
        }
        saidRef.current = general;
    }, [errors, general]);
    // Le refus allonge la fenêtre : Radix la replace ensuite, au-dessus de son créneau ou dessous,
    // et sa hauteur au plus, posée seulement alors, en fait défiler le contenu. Le refus s'amène
    // de nouveau à l'écran, une fois la fenêtre replacée.
    useLayoutEffect(() => {
        shownMaxHeightRef.current = maxHeight;
        if (sayAgainRef.current) {
            sayAgainRef.current = false;
            generalRef.current?.scrollIntoView({ block: 'nearest' });
        }
    }, [maxHeight]);

    // La question prend la place des champs : le curseur va au choix, avant que le champ qu'elle
    // cache ne le perde. Retour, ou un refus, rend les champs, le curseur au champ qu'on venait
    // de quitter — à défaut, au ticket — : il reste dans la fenêtre, et l'effet des refus, qui
    // passe après, l'envoie au champ refusé s'il y en a un.
    const asking = shown?.question !== undefined;
    const askedRef = useRef(false);
    useLayoutEffect(() => {
        if (asking && !askedRef.current) {
            scopeRef.current?.focus();
        } else if (!asking && askedRef.current) {
            const left = leftRef.current;
            const dialog = contentRef.current?.closest('[role="dialog"]');
            (left !== null && dialog?.contains(left) === true ? left : ticketRef.current)?.focus();
        }
        askedRef.current = asking;
    }, [asking]);

    if (shown === null || errors === null) {
        return null;
    }
    const { target, draft, sending } = shown;
    const editing = target.kind === 'edit';
    const part = target.kind === 'part';
    const pause = editing && target.block.content.kind === 'pause';
    const title = part
        ? 'Modifier la sélection'
        : !editing
          ? 'Nouveau ticket'
          : pause
            ? 'Modifier la pause'
            : 'Modifier le ticket';
    // Un ticket que Jira ne connaît pas ne s'enregistre pas : le refus est sous le champ,
    // et un clic à côté garde la fenêtre ouverte.
    // Une récurrence sans jour, ou sur un créneau qu'une autre prend déjà, une pause sans
    // ticket qui ne change rien ou à laquelle on tape un commentaire, de même : Entrée ne fait
    // rien, et le clic à côté dit le refus.
    const quarters = quartersOf(target);
    // La phrase dit la plage de la récurrence, qui peut déborder un bloc dont un quart
    // d'heure était déjà pris le jour où elle s'est posée.
    const start = linked?.start ?? quarters[0] ?? 0;
    const end = linked?.end ?? (quarters.at(-1) ?? 0) + MINUTES;
    const seen: SeenDay = { date, workingDays, ongoing, settledAhead: settledAhead ?? NO_DAYS };
    // Une date commencée se refuse d'abord : « Complétez la date. », pas un Enregistrer grisé.
    const taken =
        recurrence !== null &&
        !untilUnfinished(recurrence) &&
        draftClash(recurrence, linked, seen, today, start, end) !== null;
    const blocked =
        saveBlocked(target, draft, recurrence, initialRecurrence, date, workingDays) || unknownTicket || taken;
    // Sur un jour passé, ce qu'on change au bloc qui revient ne vaut que pour cette fois : ses
    // prochaines fois gardent la teinte de la récurrence, le contenu du bloc à l'ouverture.
    const kept = linked !== null && date < today && target.kind === 'edit' ? target.block.content : null;
    const tint =
        kept !== null
            ? kept.kind === 'pause'
                ? 'pause'
                : known(tickets.get(kept.ticket))
            : lookup.status === 'found'
              ? tintOf(lookup.info)
              : pause && draft.ticket.trim() === ''
                ? 'pause'
                : null;

    /**
     * Enregistre, une fois que Jira a répondu sur le ticket tapé : pendant la recherche, ou
     * s'il n'a pas pu le vérifier, la fenêtre attend sa réponse comme elle attend le
     * serveur, puis enregistre ou montre le refus.
     */
    const save = () => {
        if (unknownTicket) {
            return;
        }
        onSave(check);
    };

    /**
     * Valide le choix de la question. Le ticket tapé ne s'y juge que si la réponse l'écrit
     * (useGridEditing.tsx) : un bloc qui revient dont Jira ne connaît plus le ticket
     * s'efface comme un autre.
     */
    const answer = () => {
        onSave(check);
    };

    /**
     * Un bouton du pied fait son geste sans prendre le curseur au champ : le champ Ticket
     * quitté jugerait d'abord sa forme, et le refus apparu sous lui pousserait le pied
     * sous le pointeur, le clic tombant à côté. Enregistrer la juge de toute façon.
     */
    const keepFocus = (event: MouseEvent) => {
        event.preventDefault();
    };

    const onEnter = () => {
        if (!blocked) {
            save();
        }
    };

    const question = shown.question;
    const scope = question === undefined ? null : SCOPE_TITLES[question.action.question];
    const erase = question?.action.question === 'erase';
    // Posée par Suppr, la question n'a pas de champs à rendre.
    const fields = question?.back !== false;

    return (
        <Popover
            key={shown.key}
            open
            anchor={anchor}
            // Au-dessus ou dessous, selon le rectangle que rend place (useGridEditing.tsx),
            // qui part du bord gauche de la fenêtre.
            side="top"
            align="start"
            sideOffset={tokenPixels('--s-3')}
            width={fields ? 'pop' : 'pop-sm'}
            title={scope?.title ?? title}
            subtitle={
                question === undefined
                    ? windowSubtitle(dayLabel(date), quartersOf(target))
                    : scopeSubtitle(question, target, date)
            }
            arrowHidden={stopped}
            maxHeight={maxHeight}
            sending={sending}
            // Posée par Suppr, elle s'ouvre le curseur sur le choix ; après les champs, l'effet
            // ci-dessus l'y pose.
            initialFocus={question === undefined ? ticketRef : scopeRef}
            returnFocus={returnFocus}
            onCancel={onCancel}
            onOutside={question === undefined ? save : answer}
            footerStart={
                question !== undefined ? undefined : editing || part ? (
                    <>
                        {/* La corbeille efface, comme « Effacer » du menu et la touche Suppr. */}
                        <Tooltip label="Effacer">
                            <Button
                                variant="danger"
                                size="sm"
                                iconOnly
                                aria-label="Effacer"
                                onMouseDown={keepFocus}
                                onClick={onDelete}
                            >
                                <TrashIcon />
                            </Button>
                        </Tooltip>
                        {!pause && (
                            <Tooltip label="Convertir en pause">
                                <Button
                                    size="sm"
                                    iconOnly
                                    aria-label="Convertir en pause"
                                    onMouseDown={keepFocus}
                                    onClick={onPause}
                                >
                                    <CupIcon />
                                </Button>
                            </Tooltip>
                        )}
                    </>
                ) : (
                    <Button size="sm" onMouseDown={keepFocus} onClick={onPause}>
                        <CupIcon />
                        Pause
                    </Button>
                )
            }
            footerEnd={
                question !== undefined ? (
                    <>
                        <Button size="sm" onMouseDown={keepFocus} onClick={onCancel}>
                            {question.back ? 'Retour' : 'Annuler'}
                        </Button>
                        <Button
                            variant={erase ? 'danger' : 'primary'}
                            size="sm"
                            busy={sending}
                            onMouseDown={keepFocus}
                            onClick={answer}
                        >
                            {erase && <TrashIcon />}
                            {scope?.answer}
                        </Button>
                    </>
                ) : (
                    <>
                        <Button size="sm" onMouseDown={keepFocus} onClick={onCancel}>
                            Annuler
                        </Button>
                        <Button
                            variant="primary"
                            size="sm"
                            aria-disabled={blocked || undefined}
                            busy={sending}
                            onMouseDown={keepFocus}
                            onClick={blocked ? undefined : save}
                        >
                            Enregistrer
                        </Button>
                    </>
                )
            }
        >
            {/* Ce conteneur et celui des champs ne comptent pas dans la mise en page : l'espacement
                du corps vaut pour ce qu'ils contiennent. */}
            <div ref={contentRef} className="contents">
                {question !== undefined && scope !== null && (
                    <>
                        <RadioGroup
                            ref={scopeRef}
                            quietFocus
                            label={scope.asks}
                            options={SCOPE_OPTIONS}
                            value={question.choice}
                            onValueChange={(value) => {
                                onChooseScope(value === 'following' ? 'following' : 'once');
                            }}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                                    event.preventDefault();
                                    if (!event.repeat) {
                                        answer();
                                    }
                                }
                            }}
                        />
                        <p className="text-sm leading-(--lh) text-ink-2">{scope.note}</p>
                        {errors.general !== null && <GeneralError ref={generalRef} message={errors.general} />}
                    </>
                )}
                {fields && (
                    // Cachés sous la question, les champs restent là, avec ce qu'on y a tapé.
                    <div ref={followFocus} className={question === undefined ? 'contents' : 'hidden'}>
                        <div className="relative">
                            <TicketField
                                ref={ticketRef}
                                label="Ticket"
                                narrow
                                field={field}
                                value={draft.ticket}
                                refusal={errors.ticket}
                                onTicket={(ticket) => {
                                    onDraft({ ...draft, ticket });
                                }}
                                onLeave={onCheckTicket}
                                onEnter={onEnter}
                                // Le champ où le curseur arrive annonce le remplacement, et dit le ticket
                                // que Jira a trouvé. Refusé, il désigne son refus, que le champ relie lui-même.
                                aria-describedby={
                                    [
                                        note !== null && errors.ticket === null ? noteId : null,
                                        lookup.status === 'found' || lookup.status === 'searching' ? previewId : null,
                                    ]
                                        .filter((id) => id !== null)
                                        .join(' ') || undefined
                                }
                            />
                            <TicketPreview id={previewId} lookup={lookup} />
                        </div>
                        <TextArea
                            ref={commentRef}
                            label="Commentaire"
                            optional
                            placeholder="Ce qui a été fait"
                            value={draft.comment}
                            error={errors.comment}
                            onChange={(event) => {
                                onDraft({ ...draft, comment: rewrite(event.target, typedComment) });
                            }}
                            onKeyDown={saveOnEnter(onEnter)}
                        />
                        {note !== null && (
                            <p id={noteId} className="flex gap-2 text-sm text-ink-2">
                                {note}
                            </p>
                        )}
                        {recurrence !== null && (
                            <RecurrenceSection
                                draft={recurrence}
                                day={seen}
                                today={today}
                                linked={linked}
                                start={start}
                                end={end}
                                tint={tint}
                                from={recurrenceStart(recurrence, linked, date, today, workingDays)}
                                minimum={untilMinimum(recurrence, linked, date, today, workingDays)}
                                errors={{ weekdays: errors.weekdays, until: errors.until, rhythm: errors.rhythm }}
                                firstDayRef={firstDayRef}
                                untilRef={untilRef}
                                rhythmRef={rhythmRef}
                                alternateRef={alternateRef}
                                onChange={onRecurrence}
                                onEnter={onEnter}
                            />
                        )}
                        {question === undefined && errors.general !== null && (
                            <GeneralError ref={generalRef} message={errors.general} />
                        )}
                    </div>
                )}
            </div>
        </Popover>
    );
}

/** La teinte d'un ticket que Jira a décrit ; aucune tant qu'il ne l'a pas fait. */
function known(info: TicketInfo | undefined): string | null {
    return info === undefined ? null : tintOf(info);
}

/**
 * L'aperçu du ticket, à côté du champ de 160 px, comme la ville à côté du code postal :
 * « Recherche dans Jira… » en gris pendant la recherche, puis le titre, sur deux lignes
 * au plus, type et titre entiers dans l'infobulle, à la teinte de son type.
 */
function TicketPreview({ id, lookup }: { id: string; lookup: Lookup }) {
    if (lookup.status === 'searching') {
        return (
            <div id={id} data-state="searching" className="ticket-preview">
                <span className="text-ink-3">Recherche dans Jira…</span>
            </div>
        );
    }
    if (lookup.status !== 'found' || lookup.info.title === null) {
        return null;
    }

    return (
        <Tooltip label={describedTicket(lookup.info) ?? lookup.info.title}>
            <div id={id} data-color={tintOf(lookup.info)} className="ticket-preview">
                <span className="line-clamp-2 text-ink">{lookup.info.title}</span>
            </div>
        </Tooltip>
    );
}

/** Aucun jour à venir envoyé : une journée qui ne les a pas lus. */
const NO_DAYS: ReadonlySet<string> = new Set();
const PAST_UNCHANGED = 'Les fois passées ne changent jamais.';

/** Chaque question : son titre, ce qu'en lit le lecteur d'écran, son bouton, et la phrase sous ses choix. */
const SCOPE_TITLES: Record<
    WindowQuestion['action']['question'],
    { readonly title: string; readonly asks: string; readonly answer: string; readonly note: string }
> = {
    modify: {
        title: 'Modifier une récurrence',
        asks: 'Quelles fois modifier',
        answer: 'Enregistrer',
        note: PAST_UNCHANGED,
    },
    stop: { title: 'Arrêter une récurrence', asks: 'Quelles fois arrêter', answer: 'Arrêter', note: PAST_UNCHANGED },
    erase: { title: 'Effacer une récurrence', asks: 'Quelles fois effacer', answer: 'Effacer', note: PAST_UNCHANGED },
    cut: {
        title: 'Couper une récurrence',
        asks: 'Quelles fois couper',
        answer: 'Couper',
        note: `Les fois suivantes se déplacent là où vous collez. ${PAST_UNCHANGED}`,
    },
    extend: {
        title: 'Allonger une récurrence',
        asks: 'Quelles fois allonger',
        answer: 'Allonger',
        note: PAST_UNCHANGED,
    },
    shorten: {
        title: 'Raccourcir une récurrence',
        asks: 'Quelles fois raccourcir',
        answer: 'Raccourcir',
        note: PAST_UNCHANGED,
    },
};

const SCOPE_OPTIONS = [
    { value: 'once', label: 'Cette fois seulement' },
    { value: 'following', label: 'Cette fois et les suivantes' },
] as const;

/**
 * Le sous-titre de la question : le bloc par son commentaire, sinon son ticket — une pause
 * n'a ni l'un ni l'autre —, puis le jour, « Daily, mardi 20 octobre ». Allonger ou raccourcir
 * disent aussi ses heures après le geste : « Daily, mercredi 7 octobre, de 09:15 à 09:45 ».
 */
function scopeSubtitle(question: WindowQuestion, target: TicketWindowState['target'], date: string): string {
    const { reshapes } = question.action;
    const content = reshapes?.content ?? (target.kind === 'edit' ? target.block.content : null);
    const name = content === null ? null : content.kind === 'pause' ? 'Pause' : (content.comment ?? content.ticket);
    const day = dayLabel(date);
    // Les heures se lisent ensemble : un nom de jour long ne laisse pas la dernière seule à la ligne.
    const hours =
        reshapes === undefined ? '' : `, ${rangeLabel(reshapes.start, reshapes.end).replaceAll(' ', '\u00a0')}`;

    return `${name === null ? '' : `${name}, `}${day.charAt(0).toLowerCase()}${day.slice(1)}${hours}`;
}
