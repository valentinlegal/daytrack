import type { ReactNode, Ref, RefObject } from 'react';

import { Button } from '../components/Button';
import { CupIcon, RepeatIcon } from '../components/icons';
import { MenuRoot, MenuTrigger } from '../components/Menu';
import { Tooltip } from '../components/Tooltip';
import { aimsAtEmptyRange, quartersOf } from '../grid/entry';
import type { Block, Cell, Grid } from '../grid/grid';
import * as Quarter from '../grid/quarter';
import { reaches, type Recurrence } from '../grid/recurrence';
import { isSelected, selectionRuns } from '../grid/selection';
import { tintOf } from '../jira/ticketInfo';
import { useTickets } from '../jira/TicketsContext';
import { duration } from './format';
import { recurrenceLabel, recurrenceMention } from './recurrenceText';
import { TicketId } from './TicketChip';
import { type GridEditing, optionId } from './useGridEditing';

/** Les blocs de moins de 30 minutes tiennent sur une ligne. */
const TWO_LINES = 30;

/**
 * La grille au quart d'heure, de 07:00 à 20:00 : la colonne des heures, puis les
 * blocs et les pauses, la ligne « maintenant », le message d'une journée vide, la
 * sélection et son menu, et la zone où tombera un favori qu'on glisse.
 *
 * Chaque quart d'heure est une rangée de la grille CSS (day.css) : un bloc s'y place
 * par sa première et sa dernière rangée, sans position calculée en pixels.
 *
 * Au clavier et au lecteur d'écran, la grille est une liste de créneaux à sélection
 * multiple : le curseur reste sur elle, et le créneau atteint est désigné par
 * aria-activedescendant. Les blocs, eux, se lisent dans la liste des saisies.
 *
 * Un jour non travaillé et vide est fermé à la saisie (editing.closed) : la grille
 * grisée ne prend aucun geste, sauf annuler et rétablir, et son message propose
 * « Saisir quand même ».
 */
export function DayGrid({
    scrollerRef,
    laneRef,
    listboxRef,
    date,
    grid,
    loading,
    busy,
    now,
    hintStart,
    drop,
    editing,
    onMenuOpen,
    menu,
    offDay = null,
    recurrences = NO_RECURRENCES,
    recurrencesHeld = false,
    openAnywayRef,
}: {
    scrollerRef: RefObject<HTMLDivElement | null>;
    laneRef: RefObject<HTMLDivElement | null>;
    listboxRef: RefObject<HTMLDivElement | null>;
    /** Le jour affiché : un bloc dont la récurrence a fini avant lui n'en est plus une fois. */
    date: string | null;
    /** null tant que la journée n'est pas lue, ou si elle ne se lit pas : la grille reste vide, sans message. */
    grid: Grid | null;
    /** La journée est en cours de lecture. */
    loading: boolean;
    /** L'heure qu'il est, si la journée est celle d'aujourd'hui ; null sinon. */
    now: number | null;
    /** Où commence le message d'une journée vide (scroll.ts, emptyHintStart). */
    hintStart: number | null;
    /** Le favori qu'on glisse sur la grille et le quart d'heure où il tombera ; null sinon. */
    drop: { readonly ticket: string; readonly quarter: number } | null;
    /** Un geste attend sa réponse. */
    busy: boolean;
    editing: GridEditing;
    /** Le menu du clic droit s'ouvre. */
    onMenuOpen: () => void;
    /** Le menu du clic droit, rendu à son ouverture. */
    menu: ReactNode;
    /**
     * La grille est fermée (editing.closed) : pourquoi — « Samedi n'est pas un jour
     * travaillé. », ou l'objectif mis à 0h00 —, et ce qui l'ouvre pour ce jour-là.
     */
    offDay?: { readonly reason: string; readonly onOpen: () => void } | null;
    /** Celles qui ont posé un bloc ce jour-là : la flèche du bloc dit leur rythme. */
    recurrences?: ReadonlyMap<string, Recurrence> | undefined;
    /** Fermée et vide, alors qu'une récurrence y serait tombée : le message le dit. */
    recurrencesHeld?: boolean;
    /** « Saisir quand même », à qui la grille fermée rend le curseur. */
    openAnywayRef?: Ref<HTMLButtonElement> | undefined;
}) {
    const blocks = grid?.blocks() ?? [];
    const tickets = useTickets();
    // La récurrence d'un bloc qui revient, si elle va encore jusqu'à ce jour (linkedRecurrence).
    const repeatOf = (cell: Cell): Recurrence | null => {
        const id = cell === null ? null : cell.recurrence;
        const recurrence = id === null ? undefined : recurrences.get(id);

        return recurrence === undefined || date === null || !reaches(recurrence, date) ? null : recurrence;
    };
    const { selection, window: open } = editing;
    const target = open?.target ?? null;
    // Nouveau ticket sur une plage vide dessine le créneau visé ; sur une sélection déjà
    // saisie, ou en plusieurs morceaux, la sélection reste dessinée.
    const aimed = target !== null && grid !== null && aimsAtEmptyRange(grid, target) ? quartersOf(target) : null;
    // Modifier le ticket entoure son bloc, et Nouveau ticket sur une plage vide la dessine en
    // pointillé : leur sélection, prise à l'ouverture, ne se dessine pas en plus. Une autre —
    // un glisser ailleurs, qui ne ferme la fenêtre qu'au relâcher, les flèches pendant
    // qu'elle s'enregistre — se dessine, fenêtre ouverte ou non.
    const selectionShownByWindow =
        target !== null &&
        (target.kind === 'edit' || aimed !== null) &&
        selection.quarters.join() === quartersOf(target).join();
    // Le créneau atteint n'est désigné que s'il est sélectionné : son cadre montre alors
    // où est le curseur. Sans lui — après Échap —, la liste porte son propre anneau au
    // clavier ; venu du pointeur, rien ne se dessine.
    const head = selection.head !== null && isSelected(selection, selection.head) ? selection.head : null;
    const closed = editing.closed;
    // La colonne des identifiants prend la largeur du plus long du jour (day.css, id-column).
    const longestId = Math.max(
        0,
        ...blocks.map(({ content }) => (content.kind === 'work' ? content.ticket.length : 0)),
    );

    return (
        <div
            ref={scrollerRef}
            role="region"
            aria-label="Grille de la journée"
            // Elle se parcourt au clavier par sa liste de créneaux, qui prend le focus.
            className="relative min-h-0 flex-1 overflow-auto"
            aria-busy={loading}
        >
            <div className="flex py-3">
                <div className="grid w-gut flex-none quarter-rows" aria-hidden="true">
                    {Quarter.all().map((quarter) => (
                        <span
                            key={quarter}
                            className={`hour-mark self-start justify-self-end pr-3 font-mono text-xs leading-(--lh) ${
                                quarter % 60 === 0 ? 'font-semibold text-ink' : 'text-ink-3'
                            }`}
                        >
                            {quarter % 60 === 0 ? Quarter.format(quarter) : Quarter.format(quarter).slice(3)}
                        </span>
                    ))}
                </div>
                <MenuRoot
                    modal={false}
                    onOpenChange={(open) => {
                        if (open) {
                            onMenuOpen();
                        }
                    }}
                >
                    <MenuTrigger asChild disabled={grid === null || closed}>
                        <div
                            ref={laneRef}
                            role="presentation"
                            className={`relative grid min-w-0 flex-1 quarter-rows border-b border-l border-line quarter-lines id-ch-${String(longestId)} ${closed ? 'bg-bg-side' : ''}`}
                            onMouseDown={editing.onLaneMouseDown}
                            onDoubleClick={editing.onLaneDoubleClick}
                            onContextMenu={editing.onLaneContextMenu}
                        >
                            <ol
                                aria-label="Saisies du jour"
                                className="col-start-1 row-span-full grid grid-rows-subgrid"
                            >
                                {blocks.map((block) => (
                                    <BlockItem
                                        key={block.start}
                                        block={block}
                                        repeat={repeatLabel(repeatOf(block.content))}
                                        ringed={target?.kind === 'edit' && target.block.start === block.start}
                                    />
                                ))}
                            </ol>
                            {now !== null && now >= Quarter.FIRST && now < Quarter.DAY_END && (
                                <div
                                    aria-hidden="true"
                                    className={`now-line ${rows(Quarter.floor(now), Quarter.floor(now) + Quarter.MINUTES)} now-at-${String(now % Quarter.MINUTES)}`}
                                />
                            )}
                            {/* Une fenêtre encore ouverte sur une grille qui vient de se fermer — le jour
                                mis à 0h00 dans un autre onglet — garde la place : « Saisir quand même »
                                reparaît quand elle se ferme, au lieu de passer sous ce qu'elle vise. */}
                            {grid !== null &&
                                blocks.length === 0 &&
                                hintStart !== null &&
                                !(offDay !== null && target !== null) && (
                                    <div
                                        className={`pointer-events-none col-start-1 mx-2 flex flex-col items-center text-center text-ink-3 ${rows(hintStart, hintStart + (offDay === null ? 2 : recurrencesHeld ? 5 : 4) * Quarter.MINUTES)}`}
                                    >
                                        <b className="block leading-(--h-row) font-semibold text-ink-2">
                                            Aucun ticket pour ce jour
                                        </b>
                                        <span className="block leading-(--h-row)">
                                            {offDay === null
                                                ? 'Double-cliquez sur un créneau, ou glissez un favori sur la grille.'
                                                : offDay.reason}
                                        </span>
                                        {offDay !== null && recurrencesHeld && (
                                            <span className="block leading-(--h-row)">
                                                Vos récurrences ne s'y posent pas.
                                            </span>
                                        )}
                                        {offDay !== null && (
                                            // Un calque qui laisse passer les clics les rend à son bouton.
                                            <Button
                                                ref={openAnywayRef}
                                                size="sm"
                                                className="pointer-events-auto mt-3"
                                                onClick={offDay.onOpen}
                                            >
                                                Saisir quand même
                                            </Button>
                                        )}
                                    </div>
                                )}
                            {/* La sélection, d'un seul cadre par suite de créneaux. */}
                            {/* Une grille fermée n'a pas de sélection, pas même celle d'avant sa fermeture. */}
                            {!closed &&
                                !selectionShownByWindow &&
                                selectionRuns(selection).map((run) => (
                                    <div
                                        key={run.start}
                                        aria-hidden="true"
                                        className={`pointer-events-none z-(--z-sel) col-start-1 -my-px mx-1 rounded-2 border-(length:--ring) border-focus bg-sel-fill ${rows(run.start, run.end)}`}
                                    />
                                ))}
                            {aimed !== null && (
                                <div
                                    aria-hidden="true"
                                    className={`pointer-events-none z-(--z-sel) col-start-1 my-px mx-2 rounded-1 border-(length:--b-mid) border-dashed border-ink-2 bg-bg-sel ${rows(aimed[0] ?? Quarter.FIRST, (aimed.at(-1) ?? Quarter.FIRST) + Quarter.MINUTES)}`}
                                />
                            )}
                            {drop !== null && (
                                <div
                                    aria-hidden="true"
                                    data-color={tintOf(tickets.get(drop.ticket))}
                                    className={`pointer-events-none z-(--z-sel) col-start-1 my-px mx-2 flex items-center rounded-1 border-(length:--b-mid) border-dashed border-ty-bar bg-ty-bg pl-3 font-mono text-sm font-semibold text-ty-id ${rows(drop.quarter, drop.quarter + Quarter.MINUTES)}`}
                                >
                                    {Quarter.format(drop.quarter)} à {Quarter.format(drop.quarter + Quarter.MINUTES)}
                                </div>
                            )}
                            <div
                                ref={listboxRef}
                                role="listbox"
                                aria-label="Créneaux de la journée"
                                aria-multiselectable="true"
                                aria-activedescendant={head === null ? undefined : optionId(head)}
                                aria-busy={busy}
                                tabIndex={grid === null || closed ? -1 : 0}
                                className={`pointer-events-none col-start-1 row-span-full grid grid-rows-subgrid focus-visible:-outline-offset-(--ring) ${head === null && !editing.pointerCursor ? '' : 'outline-none'}`}
                                onKeyDown={editing.onListboxKeyDown}
                                onFocus={editing.onListboxFocus}
                                onBlur={editing.onListboxBlur}
                            >
                                {Quarter.all().map((quarter) => (
                                    <div
                                        key={quarter}
                                        id={optionId(quarter)}
                                        role="option"
                                        aria-selected={isSelected(selection, quarter)}
                                        // Amené au clavier, le créneau se montre avec la marge de la
                                        // grille : 07:00 se lit entière sous la barre.
                                        className={`${rows(quarter, quarter + Quarter.MINUTES)} scroll-my-3`}
                                    >
                                        <span className="sr-only">
                                            {optionLabel(
                                                quarter,
                                                grid?.at(quarter) ?? null,
                                                repeatOf(grid?.at(quarter) ?? null),
                                            )}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </MenuTrigger>
                    {menu}
                </MenuRoot>
            </div>
        </div>
    );
}

/**
 * Ce que le lecteur d'écran dit d'un créneau : « 09:30, SHOP-482, Mapping des colonnes », et
 * le rythme d'un bloc qui revient, comme sa flèche : « 09:15, OPS-12, Daily, revient chaque
 * semaine, du lundi au vendredi ».
 */
function optionLabel(quarter: number, cell: Cell, recurrence: Recurrence | null): string {
    const time = Quarter.format(quarter);
    if (cell === null) {
        return `${time}, vide`;
    }
    const repeat = recurrence === null ? null : recurrenceMention(recurrence.rhythm);
    if (cell.kind === 'pause') {
        return [time, 'pause', repeat].filter((part) => part !== null).join(', ');
    }

    return [time, cell.ticket, cell.comment, repeat].filter((part) => part !== null).join(', ');
}

/**
 * Un bloc n'a pas d'infobulle : le récapitulatif écrit le titre en entier, et le lecteur
 * d'écran lit dans le bloc le type et le titre.
 *
 * @param ringed la fenêtre Modifier le ticket est ouverte sur ce bloc : il s'entoure
 */
function BlockItem({ block, ringed, repeat }: { block: Block; ringed: boolean; repeat: string | null }) {
    const tickets = useTickets();
    const { start, end, content } = block;
    const range = `De ${Quarter.format(start)} à ${Quarter.format(end)}, `;
    const place = `col-start-1 my-px mx-2 ${rows(start, end)} ${ringed ? 'z-(--z-sel) edit-ring' : ''}`;

    if (content.kind === 'pause') {
        return (
            <li
                className={`${place} flex items-center justify-center gap-3 overflow-hidden rounded-1 border border-pause-hatch bg-pause-bg pr-3 pl-2 pause-hatch`}
            >
                <span className="sr-only">{range}</span>
                <span className="inline-flex h-5 items-center gap-1 rounded-pill border border-pause-hatch bg-bg px-2 text-sm font-medium text-pause-ink">
                    <CupIcon small />
                    Pause
                    <span className="font-mono text-ink-3 tabular-nums">{duration(end - start)}</span>
                    {repeat !== null && (
                        <Tooltip label={repeat}>
                            <span className="ml-(--s-half) inline-flex items-center text-ink-3">
                                <RepeatIcon label={repeat} />
                            </span>
                        </Tooltip>
                    )}
                </span>
            </li>
        );
    }

    const twoLines = end - start >= TWO_LINES;
    const info = tickets.get(content.ticket);
    const title = info?.title ?? null;
    // Une ligne par quart d'heure, centrée sur lui : le commentaire qui revient à la ligne
    // prend --h-row par ligne. Le titre, venu de Jira, prend la première ligne ; tant que
    // Jira ne l'a pas donné, le commentaire prend sa place et toutes les lignes du bloc,
    // remonté de --s-half — l'air et le bord du bloc —, en --ink-2 quelle que soit la
    // taille du bloc. La teinte est celle de son type, le gris tant que Jira ne l'a pas
    // décrit.
    const lines = (end - start) / Quarter.MINUTES;
    const comment = content.comment;
    const type = info?.type ?? null;

    return (
        <li
            data-color={tintOf(info)}
            className={`${place} flex gap-3 overflow-hidden rounded-1 border border-l-(length:--b-ty) border-ty-line border-l-ty-bar bg-ty-bg pr-3 pl-2 ${ringed ? '' : 'hover:shadow-1'} ${
                twoLines ? 'items-start' : 'items-center'
            }`}
        >
            <span className="sr-only">{range}</span>
            <span
                className={`id-column flex flex-none flex-col font-mono text-sm font-semibold ${twoLines ? 'gap-(--s-half)' : 'gap-1'}`}
            >
                <span className={`whitespace-nowrap text-ty-id ${twoLines ? 'leading-(--h-line)' : ''}`}>
                    <TicketId ticket={content.ticket} />
                </span>
                {type !== null && <span className="sr-only">, {type}</span>}
            </span>
            <span className={`flex min-w-0 flex-1 flex-col ${twoLines ? 'gap-(--s-half)' : 'gap-1'}`}>
                {title === null ? (
                    comment !== null && (
                        <span
                            className={`min-w-0 text-ink-2 ${twoLines ? `-mt-(--s-half) leading-(--h-row) wrap-break-word line-clamp-${String(lines)}` : 'overflow-hidden text-ellipsis whitespace-nowrap'}`}
                        >
                            {comment}
                        </span>
                    )
                ) : twoLines ? (
                    <>
                        <span className="min-w-0 truncate leading-(--h-line) font-medium">{title}</span>
                        {comment !== null && (
                            <span
                                className={`min-w-0 leading-(--h-row) wrap-break-word text-ink-2 line-clamp-${String(lines - 1)}`}
                            >
                                {comment}
                            </span>
                        )}
                    </>
                ) : (
                    <span className="flex min-w-0 items-baseline gap-3 whitespace-nowrap">
                        <span className="max-w-full flex-none truncate font-medium">{title}</span>
                        {comment !== null && (
                            <span className="min-w-0 flex-initial truncate text-ink-3">{comment}</span>
                        )}
                    </span>
                )}
            </span>
            {repeat !== null && (
                <Tooltip label={repeat}>
                    <span className={`inline-flex flex-none items-center text-ink-3 ${twoLines ? 'h-(--h-line)' : ''}`}>
                        <span className="sr-only">, </span>
                        <RepeatIcon label={repeat} />
                    </span>
                </Tooltip>
            )}
            <span className={`flex-none font-mono text-sm text-ink-2 ${twoLines ? 'leading-(--h-line)' : ''}`}>
                <span className="sr-only">, </span>
                {duration(end - start)}
            </span>
        </li>
    );
}

const NO_RECURRENCES: ReadonlyMap<string, Recurrence> = new Map();

/**
 * Ce que le lecteur d'écran lit de la flèche d'un bloc qui revient, et son infobulle ; null
 * pour une saisie ordinaire, ou une récurrence finie avant ce jour.
 */
function repeatLabel(recurrence: Recurrence | null): string | null {
    return recurrence === null ? null : recurrenceLabel(recurrence.rhythm);
}

/** Les rangées d'un quart d'heure à un autre : la première rangée est celle de 07:00. */
function rows(start: number, end: number): string {
    return `row-start-${String(row(start))} row-end-${String(row(end))}`;
}

function row(minutes: number): number {
    return (minutes - Quarter.FIRST) / Quarter.MINUTES + 1;
}
