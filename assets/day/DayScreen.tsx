import { type RefObject, useMemo, useRef, useState } from 'react';

import type { Address } from '../address';
import { GeneralError } from '../components/Field';
import { Toast } from '../components/Toast';
import type { FavoriteList } from '../favorites/favoriteList';
import type { SelectionActions } from '../grid/actions';
import { minuteOn } from '../grid/clock';
import type { DayApi } from '../grid/daySession';
import { tabMemory } from '../grid/daySession';
import { DaySessions } from '../grid/daySessions';
import type { Recurrence } from '../grid/recurrence';
import { dayFigures } from '../grid/figures';
import { recap } from '../grid/recap';
import type { SendFailure } from '../grid/send';
import type { TabStorage } from '../grid/tabStore';
import { ColumnVersion } from '../version/ColumnVersion';
import { dayLabel, dayTitle, lastOpenDay, monthOf, nextWorkingDay, tenseOf } from './calendar';
import type { CalendarApi } from './calendarApi';
import { ColumnResizer } from './ColumnResizer';
import { DayBar } from './DayBar';
import { DayGrid } from './DayGrid';
import { FavoritesColumn } from './FavoritesColumn';
import { figuresLine } from './figuresLine';
import { GridMenu } from './GridMenu';
import { MonthCalendar } from './MonthCalendar';
import { ObjectiveWindow } from './ObjectiveWindow';
import { Recap } from './Recap';
import { screenMemory } from './screenMemory';
import { emptyHintStart } from './scroll';
import { SendButton } from './SendButton';
import { recapFates, SENDING_ANNOUNCE } from './sendView';
import { SendWindow } from './SendWindow';
import { TicketWindow } from './TicketWindow';
import { useDayClosure, useOffDayFocus } from './useDayClosure';
import { useDayNavigation } from './useDayNavigation';
import { type Favorites, useFavorites } from './useFavorites';
import { type BlockDropTarget, MESSAGE_DURATION, useGridEditing } from './useGridEditing';
import { useGridExits } from './useGridExits';
import { useGridScroll } from './useGridScroll';
import { useMonthMarks } from './useMonthMarks';
import { useObjectiveWindow } from './useObjectiveWindow';
import { useRecapPanel } from './useRecapPanel';
import { useSendToJira } from './useSendToJira';
import { useSideWidth } from './useSideWidth';
import { useTicketTitles } from './useTicketTitles';
import { initialRecurrence, linkedRecurrence } from './recurrenceDraft';
import { useUserMoment } from './useUserMoment';
import { useOpenWindows, useWindowFlush } from './useWindowFlush';
import { useWorkingDays } from './workingDays';

/** Une journée pas encore lue ne connaît aucune récurrence. */
const NO_RECURRENCES: ReadonlyMap<string, Recurrence> = new Map();

/** Ce que le serveur dit à la page (templates/app.html.twig). */
export interface DayConfig {
    /** Le jour de l'adresse, « AAAA-MM-JJ ». */
    readonly date: string;
    /** Le fuseau de l'utilisateur, celui du serveur (DAYTRACK_TIMEZONE). */
    readonly timezone: string;
    /** Combien de jours devant aujourd'hui s'ouvrent. */
    readonly futureDays: number;
    /**
     * Les jours travaillés des réglages au chargement de la page, en jours de la semaine
     * ISO : chaque journée lue les redit ensuite.
     */
    readonly workingDays: readonly number[];
}

/**
 * L'écran Journée : la barre, la colonne de gauche, la grille et le récapitulatif. Il
 * assemble ce qui vit à part : la navigation entre les jours (useDayNavigation), les
 * fenêtres ouvertes (useWindowFlush), la fermeture du jour (useDayClosure), le
 * récapitulatif (useRecapPanel) et l'envoi sur Jira (useSendToJira).
 */
export function DayScreen({
    config,
    api,
    calendarApi,
    storage,
    favorites,
    leaveRef,
    arrowsRef,
    readHabitual,
    onSettings,
    onSettingsArrow,
    onUpdateToken,
    onJiraRefusal,
    onSendingChange,
}: {
    config: DayConfig;
    api: DayApi;
    /** Les marques du calendrier ; sans elle, le calendrier n'en porte aucune. */
    calendarApi?: CalendarApi | undefined;
    storage: TabStorage;
    favorites: FavoriteList;
    /** L'objectif habituel des réglages, relu quand la fenêtre Objectif du jour s'ouvre. */
    readHabitual?: (() => Promise<number>) | undefined;
    /** Ce qui enregistre les fenêtres ouvertes avant de quitter la journée ; la promesse dit si c'est fait. */
    leaveRef?: RefObject<() => Promise<boolean>>;
    /** Ce que la journée fait des flèches du navigateur, que l'application écoute. */
    arrowsRef?: RefObject<((address: Address) => void) | null>;
    /** Le bouton Réglages du pied de colonne. */
    onSettings?: () => void;
    /**
     * La flèche du navigateur mène aux réglages, et les fenêtres se sont enregistrées : ils
     * s'ouvrent sur ce jour. Sans elle, la page se recharge.
     */
    onSettingsArrow?: (back: string) => void;
    /** « Mettre à jour le jeton », depuis le résultat d'un envoi que Jira a refusé. */
    onUpdateToken?: () => void;
    /** Un envoi a appris que Jira refuse le jeton : le bandeau le dit. */
    onJiraRefusal?: (refusal: Extract<SendFailure, 'refused' | 'missing_scope'>) => void;
    /** Un envoi part, ou finit : ce qui est hors de l'écran passe sous le voile. */
    onSendingChange?: (sending: boolean) => void;
}) {
    const sessions = useMemo(() => new DaySessions(api, tabMemory(storage)), [api, storage]);
    const memory = useMemo(() => screenMemory(storage), [storage]);
    const moment = useUserMoment(config.timezone);
    const { sideRef, side } = useSideWidth();
    // La grille se place une fois, à l'ouverture de l'écran, sur le jour de l'adresse.
    const { scrollerRef, visibleTop } = useGridScroll(minuteOn(config.date, moment), memory);
    const windows = useOpenWindows();
    const last = lastOpenDay(moment.date, config.futureDays);
    const { date, currentDate, shown, session, snapshot, go } = useDayNavigation({
        initial: config.date,
        last,
        sessions,
        visibleTop,
        flush: windows.flush,
        held: windows.held,
        arrowsRef,
        toSettings: onSettingsArrow,
    });
    const day = snapshot?.day ?? null;
    const tense = tenseOf(date, moment.date);
    const now = minuteOn(date, moment);

    const laneRef = useRef<HTMLDivElement>(null);
    const listboxRef = useRef<HTMLDivElement>(null);
    // La zone principale, où le menu de la grille se pose.
    const [main, setMain] = useState<HTMLElement | null>(null);
    // Ce qui prend un bloc glissé hors de la grille : la liste des favoris.
    const blockDropRef = useRef<BlockDropTarget | null>(null);
    // Le bouton Jira de la barre, et la toile de ses confettis.
    const sendRef = useRef<HTMLButtonElement>(null);
    const confettiRef = useRef<HTMLCanvasElement>(null);

    // Les marques se relisent après chaque écriture, et après chaque envoi, qui ne change
    // pas la version de la journée.
    const calendar = useMonthMarks(
        calendarApi,
        date,
        moment.date,
        day === null ? null : `${String(day.version)} ${day.send.state}`,
    );
    const workingDays = useWorkingDays(config.workingDays, {
        day: day?.workingDays ?? null,
        month: calendar.monthWorkingDays,
    });
    // Où mènent les flèches de la barre : leur infobulle le dit.
    const previousDay = nextWorkingDay(date, -1, workingDays);
    const nextDay = nextWorkingDay(date, 1, workingDays);

    const closure = useDayClosure({ date, day, workingDays, daysOff: calendar.monthDaysOff });
    const recapPanel = useRecapPanel();
    const editing = useGridEditing({
        session,
        day,
        laneRef,
        scrollerRef,
        listboxRef,
        visibleTop,
        onWindowOpen: recapPanel.closeOverlay,
        blockDropRef,
        beforeWindowRef: windows.beforeTicketWindowRef,
        closed: closure.closed,
        today: moment.date,
        openingDay: shown === null ? date : null,
    });
    const { offDay, openAnywayRef, returnFocus } = useOffDayFocus(closure, editing.focusGrid);
    const favoriteGestures = useFavorites({
        list: favorites,
        editing,
        laneRef,
        scrollerRef,
        blockDropRef,
        beforeFormRef: windows.beforeFavoriteFormRef,
    });
    const drag = favoriteGestures.drag;
    useTicketTitles(session, favoriteGestures.snapshot.favorites);
    const objective = useObjectiveWindow({
        date,
        othersOpen: editing.window !== null || favoriteGestures.form !== null,
        flush: windows.flush,
        onOpen: recapPanel.closeOverlay,
    });
    const send = useSendToJira({
        currentDate,
        session,
        day,
        buttonRef: sendRef,
        confettiRef,
        notify: editing.notify,
        flush: windows.flush,
        onWindowOpen: recapPanel.closeOverlay,
        onJiraRefusal,
        onSendingChange,
    });
    useWindowFlush(windows, { editing, favorites: favoriteGestures, objective, sending: send.sending, leaveRef });
    useGridExits({
        editing,
        favorites: favoriteGestures,
        recap: recapPanel,
        sendWindowOpen: send.openKind !== null,
        objectiveOpen: objective.open,
    });

    const hintStart =
        shown !== null && 'session' in shown ? emptyHintStart(shown.top, now, closure.closed ? 4 : 2) : null;
    const figures =
        day === null
            ? null
            : figuresLine(dayFigures(day.grid, day.objective, now), day.objective, tense, day.working, day.declaredOff);
    const tickets = useMemo(() => (day === null ? null : recap(day.grid)), [day]);
    const sending = send.sending;

    return (
        <div
            ref={sideRef}
            className="day-screen group relative flex h-full overflow-clip bg-bg text-ink"
            data-recap={recapPanel.open ? 'open' : 'closed'}
            aria-busy={sending || undefined}
        >
            <div className="relative flex min-w-0 flex-1 flex-col">
                <DayBar
                    title={dayTitle(date)}
                    figures={figures}
                    previousTip={dayLabel(previousDay)}
                    nextTip={dayLabel(nextDay)}
                    canGoNext={nextDay <= last}
                    recapOpen={recapPanel.open}
                    recapToggleRef={recapPanel.toggleRef}
                    titleRef={objective.titleRef}
                    objectiveRef={objective.buttonRef}
                    objectiveOpen={objective.open}
                    onObjective={objective.onButton}
                    onToday={() => {
                        // Déjà sur aujourd'hui, il ramène quand même le calendrier à son mois.
                        go(moment.date, () => {
                            calendar.setMonth(monthOf(moment.date));
                        });
                    }}
                    onPrevious={() => {
                        go(previousDay);
                    }}
                    onNext={() => {
                        go(nextDay);
                    }}
                    onToggleRecap={() => {
                        recapPanel.setOpen(!recapPanel.open);
                    }}
                    sending={sending}
                    sendButton={
                        <SendButton
                            ref={sendRef}
                            view={send.view}
                            open={send.openKind !== null}
                            hidden={day === null}
                            onClick={send.onButton}
                        />
                    }
                />
                <div inert={sending} className="flex min-h-0 flex-1">
                    <FavoritesColumn
                        favorites={favoriteGestures}
                        resizer={side === null ? null : <ColumnResizer {...side} />}
                        calendar={
                            <MonthCalendar
                                month={calendar.month}
                                shown={date}
                                today={moment.date}
                                last={last}
                                workingDays={workingDays}
                                marks={calendar.marks}
                                daysOff={calendar.daysOff}
                                onMonth={calendar.setMonth}
                                onOpen={(day) => {
                                    go(day);
                                }}
                            />
                        }
                        version={
                            <ColumnVersion
                                beforeOpen={async () => {
                                    const closed = await windows.flush();
                                    if (closed) {
                                        recapPanel.closeOverlay();
                                    }

                                    return closed;
                                }}
                            />
                        }
                        onSettings={onSettings}
                    />
                    <main ref={setMain} className="relative flex min-w-0 flex-1 flex-col">
                        <DayGrid
                            hintStart={hintStart}
                            drop={
                                drag?.kind === 'favorite' && drag.quarter !== null
                                    ? { ticket: drag.favorite.ticket, quarter: drag.quarter }
                                    : null
                            }
                            scrollerRef={scrollerRef}
                            laneRef={laneRef}
                            listboxRef={listboxRef}
                            date={day?.date ?? null}
                            grid={day?.grid ?? null}
                            loading={shown === null}
                            busy={snapshot?.busy ?? false}
                            now={now}
                            editing={editing}
                            onMenuOpen={() => {
                                // Le menu pourrait passer sous le message d'un geste : il s'en va.
                                editing.dismissMessage();
                                recapPanel.closeOverlay();
                            }}
                            openAnywayRef={openAnywayRef}
                            offDay={offDay}
                            recurrences={day?.recurrences}
                            recurrencesHeld={day?.recurrencesHeld === true}
                            menu={
                                <GridMenu
                                    selection={editing.selection}
                                    actions={withoutKnownFavorite(editing.actions(), favoriteGestures)}
                                    mac={editing.mac}
                                    onNewTicket={editing.newTicket}
                                    onEditSelection={editing.editSelection}
                                    onCopy={editing.copy}
                                    onCut={editing.cut}
                                    onPaste={editing.paste}
                                    onPause={editing.convertToPause}
                                    onFavorite={(ticket) => {
                                        favoriteGestures.addTicket(ticket, 0);
                                    }}
                                    onClear={editing.clear}
                                    container={main}
                                    returnFocus={returnFocus}
                                />
                            }
                        />
                        <Toast
                            message={editing.message}
                            duration={MESSAGE_DURATION}
                            onDismiss={editing.dismissMessage}
                            returnFocus={returnFocus}
                        />
                        {shown !== null && 'failed' in shown && (
                            <GeneralError message="Cette journée ne se lit pas. Rechargez la page." instead />
                        )}
                    </main>
                </div>
            </div>
            <div inert={sending} className="contents">
                <Recap
                    tickets={tickets}
                    open={recapPanel.open}
                    hideRef={recapPanel.hideRef}
                    onClose={() => {
                        recapPanel.setOpen(false);
                    }}
                    fates={recapFates(tickets ?? [], send.status)}
                />
            </div>
            {sending && <div aria-hidden="true" className="send-veil" />}
            <canvas ref={confettiRef} aria-hidden="true" className="send-confetti" />
            {/* Une zone à part, sans rôle : celle du message de la grille reste la seule « status » de l'écran. */}
            <p aria-live="polite" className="sr-only">
                {sending ? SENDING_ANNOUNCE : ''}
            </p>
            {day !== null && (
                <SendWindow
                    kind={send.openKind}
                    date={date}
                    status={day.send}
                    rows={send.rows}
                    worked={dayFigures(day.grid, day.objective, null).worked}
                    hasPause={day.grid.hasPause()}
                    anchor={sendRef}
                    onClose={send.closeWindow}
                    onSend={send.start}
                    onUpdateToken={() => {
                        send.closeWindow();
                        onUpdateToken?.();
                    }}
                    returnFocus={() => {
                        sendRef.current?.focus();
                    }}
                />
            )}
            <TicketWindow
                date={date}
                today={moment.date}
                workingDays={day?.workingDays ?? []}
                window={editing.window}
                recurrence={editing.windowRecurrence}
                initialRecurrence={
                    editing.window === null || day === null ? null : initialRecurrence(editing.window.target, day)
                }
                linked={editing.window === null || day === null ? null : linkedRecurrence(editing.window.target, day)}
                ongoing={day?.ongoing ?? NO_RECURRENCES}
                settledAhead={day?.settledAhead}
                onRecurrence={editing.setRecurrence}
                note={editing.windowNote}
                place={editing.placeWindow}
                gridRef={laneRef}
                checkRef={editing.windowCheckRef}
                onDraft={editing.setDraft}
                onSave={editing.saveWindow}
                onCancel={editing.cancelWindow}
                onPause={editing.pauseWindow}
                onDelete={editing.deleteWindow}
                onChooseScope={editing.chooseScope}
                onCheckTicket={editing.checkTicket}
                returnFocus={returnFocus}
            />
            <ObjectiveWindow
                open={objective.open}
                session={session}
                day={day}
                now={now}
                tense={tense}
                anchor={objective.buttonRef}
                alignOffset={objective.alignOffset}
                flushRef={objective.flushRef}
                readHabitual={readHabitual}
                onClose={objective.close}
            />
        </div>
    );
}

/**
 * « Ajouter aux favoris » grisé quand le ticket de la sélection y est déjà : un ticket
 * n'y est jamais ajouté deux fois, et ce qui ne servirait à rien est grisé.
 */
function withoutKnownFavorite(actions: SelectionActions, favorites: Favorites): SelectionActions {
    return actions.favorite !== null && favorites.has(actions.favorite) ? { ...actions, favorite: null } : actions;
}
