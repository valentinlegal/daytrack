import { useEffect, useMemo, useRef, useState } from 'react';
import { EntryType } from '@/types/api';
import type { JiraTicketInfo, TimeEntry, WorkDay } from '@/types/api';
import {
    TIMELINE_START_HOUR,
    TIMELINE_END_HOUR,
    SLOT_PX,
    buildEntryMap,
    generateTimeSlots,
    getNextSlot,
    isHourSlot,
    today,
} from '@/utils/timeline';
import { createEntry, deleteEntry, updateEntry } from '@/services/dayService';
import { useSlotGrid } from '@/hooks/useSlotGrid';
import type { SlotCell, SlotCellInput } from '@/hooks/useSlotGrid';
import { t } from '@/i18n/fr';
import { getBlockColors } from '@/config/ticketTypeColors';
import TimeBlock from './TimeBlock';
import TimelineBlockMenu from './TimelineBlockMenu';
import EditPopover from './EditPopover';
import { WorkBlock, PauseBlock } from './blocks';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';

interface TimelineProps {
    workDay: WorkDay;
    onWorkDayUpdate: (workDay: WorkDay) => void;
}

const TIME_SLOTS = generateTimeSlots();
/** Hauteur en px d'un créneau de 15 min */
const SLOT_HEIGHT = SLOT_PX;

/** Position d'un créneau dans une série consécutive de même contenu */
export type RunPosition = 'sole' | 'first' | 'middle' | 'last';

export interface SlotRunInfo {
    position: RunPosition;
    runDurationMinutes: number;
}

/** Projette un WorkDay sur le sous-ensemble commun consommé par useSlotGrid. */
function mapEntries(wd: WorkDay): SlotCell[] {
    return wd.entries.map((e) => ({
        id: e.id,
        ticketKey: e.ticketKey,
        ticketSummary: e.ticketSummary,
        ticketType: e.ticketType,
        comment: e.comment,
        type: e.type,
        startedAt: e.startedAt,
        endedAt: e.endedAt,
    }));
}

function runKey(entry: TimeEntry | null): string | null {
    if (null === entry) return null;
    if (entry.type === EntryType.BREAK) return `break:${entry.comment ?? ''}`;
    return `work:${entry.ticketKey ?? ''}:${entry.comment ?? ''}`;
}

function computeRunMap(slots: string[], entryMap: Map<string, TimeEntry>): Map<string, SlotRunInfo> {
    const map = new Map<string, SlotRunInfo>();
    let i = 0;
    while (i < slots.length) {
        const slot = slots[i]!;
        const entry = entryMap.get(slot) ?? null;
        const key = runKey(entry);
        if (null === key) {
            map.set(slot, { position: 'sole', runDurationMinutes: 15 });
            i++;
            continue;
        }
        let j = i + 1;
        while (j < slots.length) {
            const nextEntry = entryMap.get(slots[j]!) ?? null;
            if (runKey(nextEntry) !== key) break;
            j++;
        }
        const runLength = j - i;
        for (let k = i; k < j; k++) {
            const position: RunPosition =
                runLength === 1 ? 'sole'
                : k === i ? 'first'
                : k === j - 1 ? 'last'
                : 'middle';
            map.set(slots[k]!, { position, runDurationMinutes: runLength * 15 });
        }
        i = j;
    }
    return map;
}

function getNowPosition(date: Date): { slot: string; offsetPercent: number } | null {
    const h = date.getHours();
    const m = date.getMinutes();
    if (h < TIMELINE_START_HOUR || h >= TIMELINE_END_HOUR) return null;
    const slotMinutes = Math.floor(m / 15) * 15;
    const slot = `${String(h).padStart(2, '0')}:${String(slotMinutes).padStart(2, '0')}`;
    const offsetPercent = ((m % 15) / 15) * 100;
    return { slot, offsetPercent };
}


export default function Timeline({ workDay, onWorkDayUpdate }: TimelineProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [editingSlot, setEditingSlot] = useState<string | null>(null);
    const [editMousePos, setEditMousePos] = useState<{ x: number; y: number } | null>(null);
    // Plage de créneaux vides sélectionnée par clic-glisser → popover de création à la souris.
    const [rangeDraft, setRangeDraft] = useState<{ slots: string[]; pos: { x: number; y: number } } | null>(null);

    const [showPasteWarning, setShowPasteWarning] = useState(false);
    const [tick, setTick] = useState(0);

    useEffect(() => {
        const msUntilNextMinute = 60 * 1000 - (Date.now() % (60 * 1000));
        const id = setTimeout(() => setTick((n) => n + 1), msUntilNextMinute);
        return () => clearTimeout(id);
    }, [tick]);

    const isToday = workDay.date === today();
    const nowPosition = isToday ? getNowPosition(new Date()) : null;
    const nowSlot = nowPosition?.slot ?? null;
    const nowOffsetPercent = nowPosition?.offsetPercent ?? 0;

    const entryMap = buildEntryMap(workDay.entries);
    const runMap = useMemo(() => computeRunMap(TIME_SLOTS, entryMap), [workDay.entries]);

    const knownTickets = useMemo<Record<string, JiraTicketInfo>>(() => {
        const map: Record<string, JiraTicketInfo> = {};
        for (const entry of workDay.entries) {
            if (entry.ticketKey && entry.ticketSummary && entry.ticketType) {
                map[entry.ticketKey] = { summary: entry.ticketSummary, type: entry.ticketType };
            }
        }
        return map;
    }, [workDay.entries]);

    /** Blocs visuels calculés pour le layer absolu (1 entrée par run) */
    const visualBlocks = useMemo(() => {
        return TIME_SLOTS.reduce<Array<{
            slotIdx: number;
            slot: string;
            runDurationMinutes: number;
            entry: TimeEntry;
        }>>((acc, slot, idx) => {
            const runInfo = runMap.get(slot);
            if (!runInfo) return acc;
            const { position, runDurationMinutes } = runInfo;
            if (position !== 'first' && position !== 'sole') return acc;
            const entry = entryMap.get(slot);
            if (!entry) return acc;
            acc.push({ slotIdx: idx, slot, runDurationMinutes, entry });
            return acc;
        }, []);
    }, [runMap, entryMap]);

    // ── Moteur d'interaction partagé (sélection / drag / presse-papier / undo / raccourcis) ──

    const cells = useMemo<SlotCell[]>(() => mapEntries(workDay), [workDay.entries]);

    const ops = useMemo(() => ({
        async createCell(slot: string, data: SlotCellInput): Promise<SlotCell[]> {
            const updated = await createEntry(workDay.date, {
                startedAt: slot,
                endedAt: data.endedAt,
                ticketKey: data.ticketKey,
                type: data.type,
                comment: data.comment,
                ticketSummary: data.ticketSummary,
                ticketType: data.ticketType,
            });
            onWorkDayUpdate(updated);
            return mapEntries(updated);
        },
        async updateCell(cell: SlotCell, data: SlotCellInput): Promise<SlotCell[]> {
            const updated = await updateEntry(workDay.date, cell.id, {
                ticketKey: data.ticketKey,
                type: data.type,
                comment: data.comment,
                ticketSummary: data.ticketSummary,
                ticketType: data.ticketType,
            });
            onWorkDayUpdate(updated);
            return mapEntries(updated);
        },
        async deleteCell(cell: SlotCell): Promise<SlotCell[]> {
            const updated = await deleteEntry(workDay.date, cell.id);
            onWorkDayUpdate(updated);
            return mapEntries(updated);
        },
    }), [workDay.date, onWorkDayUpdate]);

    const grid = useSlotGrid({
        slots: TIME_SLOTS,
        cells,
        storagePrefix: `daytrack_${workDay.date}`,
        scrollRef,
        ops,
        onChanged: () => { /* onWorkDayUpdate déjà appelé par ops */ },
        onNeedsPasteWarning: () => setShowPasteWarning(true),
        onDragRange: (slots, pos) => {
            // Si un créneau est copié, on laisse la sélection en place pour un collage
            // (Ctrl+V) au lieu d'ouvrir la popup de création par-dessus
            if (grid.hasClipboard) return;
            if (slots.every((s) => !entryMap.has(s))) {
                setEditingSlot(null);
                setRangeDraft({ slots, pos });
            }
        },
    });

    // ── Calcul position du popover ────────────────────────────────────────

    function getEditAnchorTop(slot: string): number {
        const idx = TIME_SLOTS.indexOf(slot);
        return idx * SLOT_HEIGHT;
    }

    return (
        <>
            {/* Modal avertissement collage */}
            <Dialog open={showPasteWarning} onOpenChange={(o) => !o && setShowPasteWarning(false)}>
                <DialogContent className="max-w-sm">
                    <p className="text-sm text-gray-700">{t('timeline.paste_multiselection_warning')}</p>
                    <DialogFooter>
                        <Button size="sm" onClick={() => setShowPasteWarning(false)}>
                            {t('timeline.close')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Popover d'édition */}
            {editingSlot !== null && (
                <EditPopover
                    slot={editingSlot}
                    entry={entryMap.get(editingSlot) ?? null}
                    anchorTop={getEditAnchorTop(editingSlot)}
                    scrollContainer={scrollRef.current}
                    mousePos={editMousePos}
                    knownTickets={knownTickets}
                    onSave={(ticketKey, type, comment, ticketSummary, ticketType) => {
                        setEditingSlot(null);
                        void grid.save(
                            editingSlot,
                            ticketKey === null && type !== EntryType.BREAK
                                ? null
                                : { ticketKey, ticketSummary, ticketType, comment, type, endedAt: getNextSlot(editingSlot) },
                        );
                    }}
                    onCancel={() => { setEditingSlot(null); setEditMousePos(null); }}
                    onClear={() => {
                        const ex = entryMap.get(editingSlot);
                        if (ex) void grid.save(editingSlot, null);
                        setEditingSlot(null);
                        setEditMousePos(null);
                    }}
                />
            )}

            {/* Popover de création sur une plage de créneaux vides (fin d'un clic-glisser) */}
            {rangeDraft !== null && (
                <EditPopover
                    slot={rangeDraft.slots[0]!}
                    entry={null}
                    anchorTop={0}
                    scrollContainer={scrollRef.current}
                    mousePos={rangeDraft.pos}
                    knownTickets={knownTickets}
                    onSave={(ticketKey, type, comment, ticketSummary, ticketType) => {
                        const rd = rangeDraft;
                        setRangeDraft(null);
                        grid.clearSelection();
                        if (rd === null || (ticketKey === null && type !== EntryType.BREAK)) return;
                        void grid.fillRange(rd.slots, {
                            ticketKey, ticketSummary, ticketType, comment, type,
                            endedAt: getNextSlot(rd.slots[0]!),
                        });
                    }}
                    onCancel={() => { setRangeDraft(null); grid.clearSelection(); }}
                    onClear={() => { setRangeDraft(null); grid.clearSelection(); }}
                />
            )}

            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto"
                style={editingSlot !== null || rangeDraft !== null ? { overflow: 'hidden' } : undefined}
                onClick={() => {
                    if (!grid.consumeDragMoved()) grid.clearSelection();
                }}
            >
                {/*
                  Conteneur relatif pour le layer absolu des blocs.
                  mt-2 : 8px de marge haute pour que le label "07" ne soit pas coupé.
                  Hauteur = slots + 1 ligne finale "20h" + padding bas.
                */}
                <div
                    className="relative mt-2"
                    style={{ height: TIME_SLOTS.length * SLOT_HEIGHT + SLOT_HEIGHT }}
                >
                    {/* Gouttière — labels d'heure uniquement (les lignes de grille sont dans le layer visuel) */}
                    {TIME_SLOTS.map((slot, slotIdx) => {
                        const isHour = isHourSlot(slot);
                        const top = slotIdx * SLOT_HEIGHT;

                        return (
                            <div
                                key={slot}
                                className="absolute left-0 right-0"
                                style={{ top, height: SLOT_HEIGHT }}
                            >
                                <div className="absolute left-0 w-14 flex justify-end pr-3 pointer-events-none" style={{ top: 0 }}>
                                    {isHour ? (
                                        <span className="font-mono tabular-nums font-semibold text-[12.5px] select-none"
                                            style={{ color: 'oklch(0.556 0 0)', transform: 'translateY(-7px)' }}>
                                            {slot.split(':')[0]}
                                        </span>
                                    ) : (
                                        <span className="font-mono tabular-nums text-[11px] select-none"
                                            style={{ color: 'oklch(0.72 0 0)', transform: 'translateY(-6px)' }}>
                                            :{slot.split(':')[1]}
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    {/* Label de fin (20h) */}
                    <div
                        className="absolute left-0 right-0"
                        style={{ top: TIME_SLOTS.length * SLOT_HEIGHT, height: SLOT_HEIGHT }}
                    >
                        <div className="absolute left-0 w-14 flex justify-end pr-3 pointer-events-none">
                            <span className="font-mono tabular-nums font-semibold text-[12.5px] select-none"
                                style={{ color: 'oklch(0.556 0 0)', transform: 'translateY(-7px)' }}>
                                {String(TIMELINE_END_HOUR).padStart(2, '0')}
                            </span>
                        </div>
                    </div>

                    {/* Layer de cellules transparentes (click / drag / context menu) */}
                    <div className="absolute left-14 right-2 top-0 pointer-events-none" style={{ height: TIME_SLOTS.length * SLOT_HEIGHT }}>
                        {TIME_SLOTS.map((slot) => {
                            const slotIdx = TIME_SLOTS.indexOf(slot);
                            const entry = entryMap.get(slot) ?? null;
                            const effectiveSelection =
                                grid.selectedSlots.has(slot) && grid.selectedSlots.size > 1
                                    ? grid.selectedSlots
                                    : new Set([slot]);

                            return (
                                <div
                                    key={slot}
                                    className="absolute left-0 right-0 pointer-events-auto group"
                                    style={{ top: slotIdx * SLOT_HEIGHT, height: SLOT_HEIGHT }}
                                >
                                    {/* Overlay hover — visible au-dessus des blocs grâce au z-index */}
                                    <div
                                        className="absolute inset-0 rounded-sm pointer-events-none group-hover:bg-black/[0.025] transition-colors"
                                        style={{ zIndex: 3 }}
                                    />
                                    <TimeBlock
                                        slot={slot}
                                        isSelected={grid.selectedSlots.has(slot)}
                                        onSelect={(e) => grid.onSelect(slot, e)}
                                        onStartEdit={(x, y) => { setEditMousePos({ x, y }); setEditingSlot(slot); }}
                                        onContextMenuOpen={() => grid.onContextMenuOpen(slot)}
                                        onCellMouseDown={(e) => grid.onCellMouseDown(slot, e)}
                                        onDragExtend={() => grid.onDragExtend(slot)}
                                        onDropFavorite={() => grid.onDropFavorite(slot)}
                                        menu={
                                            <TimelineBlockMenu
                                                entry={entry}
                                                hasClipboard={grid.hasClipboard}
                                                onCopy={() => grid.onCopy()}
                                                onCut={() => void grid.onCut()}
                                                onPaste={() => void grid.onPaste(slot)}
                                                onClear={() => void grid.onClearRange(effectiveSelection)}
                                                onConvertToBreak={() => void grid.onConvertToBreak(effectiveSelection)}
                                            />
                                        }
                                    />
                                </div>
                            );
                        })}
                    </div>

                    {/* Layer visuel des blocs (pointer-events: none) */}
                    <div className="absolute left-14 right-2 top-0 bottom-0 pointer-events-none">
                        {/* Lignes de grille — rendues en premier (zIndex 0) pour être derrière les blocs (zIndex 2) */}
                        {TIME_SLOTS.map((slot, slotIdx) => {
                            const isHour = isHourSlot(slot);
                            return (
                                <div
                                    key={`line-${slot}`}
                                    className="absolute left-0 right-0"
                                    style={{
                                        top: slotIdx * SLOT_HEIGHT,
                                        height: 1,
                                        background: isHour ? 'oklch(0.91 0 0)' : 'oklch(0.95 0 0)',
                                        zIndex: 0,
                                    }}
                                />
                            );
                        })}
                        {/* Ligne terminale 20h */}
                        <div
                            className="absolute left-0 right-0"
                            style={{
                                top: TIME_SLOTS.length * SLOT_HEIGHT,
                                height: 1,
                                background: 'oklch(0.91 0 0)',
                                zIndex: 0,
                            }}
                        />

                        {visualBlocks.map(({ slotIdx, slot, runDurationMinutes, entry }) => {
                            const slotCount = runDurationMinutes / 15;
                            const top = slotIdx * SLOT_HEIGHT;
                            const height = slotCount * SLOT_HEIGHT;
                            const isBreak = entry.type === EntryType.BREAK;

                            if (isBreak) {
                                return (
                                    <PauseBlock
                                        key={slot}
                                        top={top}
                                        height={height}
                                        slotCount={slotCount}
                                        runDurationMinutes={runDurationMinutes}
                                    />
                                );
                            }

                            const colors = getBlockColors(entry.ticketType);
                            return (
                                <WorkBlock
                                    key={slot}
                                    top={top}
                                    height={height}
                                    slotCount={slotCount}
                                    ticket={entry.ticketKey ?? ''}
                                    summary={entry.ticketSummary ?? null}
                                    comment={entry.comment ?? null}
                                    colors={colors}
                                    runDurationMinutes={runDurationMinutes}
                                    isSelected={grid.selectedSlots.has(slot)}
                                />
                            );
                        })}

                        {/* Rings de sélection sur chaque créneau sélectionné */}
                        {[...grid.selectedSlots].map((slot) => {
                            const slotIdx = TIME_SLOTS.indexOf(slot);
                            if (-1 === slotIdx) return null;
                            const entry = entryMap.get(slot) ?? null;
                            const colors = entry?.type === EntryType.WORK ? getBlockColors(entry.ticketType) : null;
                            return (
                                <div
                                    key={`sel-${slot}`}
                                    className="absolute left-0 right-0 rounded-md"
                                    style={{
                                        top: slotIdx * SLOT_HEIGHT + 1,
                                        height: SLOT_HEIGHT - 1,
                                        boxShadow: `inset 0 0 0 2px ${colors?.ring ?? 'oklch(0.708 0 0)'}`,
                                        background: colors ? `${colors.ring}1a` : undefined,
                                        pointerEvents: 'none',
                                        zIndex: 4,
                                    }}
                                />
                            );
                        })}
                    </div>

                    {/* Indicateur "maintenant" */}
                    {nowSlot && (
                        <NowIndicator
                            slotIdx={TIME_SLOTS.indexOf(nowSlot)}
                            offsetPercent={nowOffsetPercent}
                        />
                    )}
                </div>
            </div>
        </>
    );
}

function NowIndicator({ slotIdx, offsetPercent }: { slotIdx: number; offsetPercent: number }) {
    const top = slotIdx * SLOT_HEIGHT + (offsetPercent / 100) * SLOT_HEIGHT;
    return (
        <div
            className="absolute left-14 right-2 pointer-events-none"
            style={{ top, zIndex: 6 }}
        >
            <div
                className="absolute rounded-full bg-red-500"
                style={{
                    width: 10, height: 10,
                    left: 0,
                    top: 0,
                    transform: 'translate(-50%, -50%)',
                    boxShadow: '0 0 0 3px rgba(239,68,68,0.18)',
                }}
            />
            <div
                className="absolute left-1 right-0"
                style={{ height: 1.5, background: 'oklch(0.62 0.22 27)', top: 0, transform: 'translateY(-50%)' }}
            />
        </div>
    );
}
