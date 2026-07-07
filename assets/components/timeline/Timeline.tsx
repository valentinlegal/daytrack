import { useEffect, useMemo, useRef, useState } from 'react';
import { Coffee } from 'lucide-react';
import { EntryType } from '@/types/api';
import type { JiraTicketInfo, TimeEntry, WorkDay } from '@/types/api';
import {
    TIMELINE_START_HOUR,
    TIMELINE_END_HOUR,
    buildEntryMap,
    formatMinutes,
    generateTimeSlots,
    getNextSlot,
    isHourSlot,
    today,
} from '@/utils/timeline';
import { createEntry, deleteEntry, updateEntry } from '@/services/dayService';
import { t } from '@/i18n/fr';
import { getBlockColors } from '@/config/ticketTypeColors';
import TimeBlock from './TimeBlock';
import EditPopover from './EditPopover';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';

interface TimelineProps {
    workDay: WorkDay;
    onWorkDayUpdate: (workDay: WorkDay) => void;
}

const TIME_SLOTS = generateTimeSlots();
/** Hauteur en px d'un créneau de 15 min */
const SLOT_HEIGHT = 36;

/** Position d'un créneau dans une série consécutive de même contenu */
export type RunPosition = 'sole' | 'first' | 'middle' | 'last';

export interface SlotRunInfo {
    position: RunPosition;
    runDurationMinutes: number;
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

function getSlotRange(from: string, to: string): string[] {
    const idxFrom = TIME_SLOTS.indexOf(from);
    const idxTo = TIME_SLOTS.indexOf(to);
    if (-1 === idxFrom || -1 === idxTo) return [from];
    const [start, end] = idxFrom <= idxTo ? [idxFrom, idxTo] : [idxTo, idxFrom];
    return TIME_SLOTS.slice(start, end + 1);
}


export default function Timeline({ workDay, onWorkDayUpdate }: TimelineProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [editingSlot, setEditingSlot] = useState<string | null>(null);
    const [editMousePos, setEditMousePos] = useState<{ x: number; y: number } | null>(null);

    const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());
    const [anchorSlot, setAnchorSlot] = useState<string | null>(null);
    const [activeSlot, setActiveSlot] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const dragMovedRef = useRef(false);
    // Créneaux dont la création/mise à jour est en cours (empêche l'empilement de saisies
    // lors d'une double soumission rapide : Entrée répétée, paste/conversion en pause spammés…).
    const pendingSlotsRef = useRef<Set<string>>(new Set());

    const [undoStack, setUndoStack] = useState<WorkDay[]>([]);
    const [redoStack, setRedoStack] = useState<WorkDay[]>([]);

    interface ClipboardCell {
        offset: number;
        ticketKey: string | null;
        ticketSummary: string | null;
        ticketType: string | null;
        comment: string | null;
        type: EntryType;
        isEmpty: boolean;
    }
    type ClipboardData = { cells: ClipboardCell[] };

    const [clipboard, setClipboard] = useState<ClipboardData | null>(() => {
        try {
            const stored = sessionStorage.getItem('daytrack_clipboard');
            if (!stored) return null;
            return JSON.parse(stored) as ClipboardData;
        } catch {
            return null;
        }
    });

    const [showPasteWarning, setShowPasteWarning] = useState(false);
    const [tick, setTick] = useState(0);

    useEffect(() => {
        function onClipboardChanged() {
            try {
                const stored = sessionStorage.getItem('daytrack_clipboard');
                setClipboard(stored ? (JSON.parse(stored) as ClipboardData) : null);
            } catch { /* sessionStorage indisponible */ }
        }
        window.addEventListener('daytrack:clipboard-changed', onClipboardChanged);
        return () => window.removeEventListener('daytrack:clipboard-changed', onClipboardChanged);
    }, []);

    useEffect(() => {
        const msUntilNextMinute = 60 * 1000 - (Date.now() % (60 * 1000));
        const id = setTimeout(() => setTick((n) => n + 1), msUntilNextMinute);
        return () => clearTimeout(id);
    }, [tick]);

    useEffect(() => {
        try {
            const stored = sessionStorage.getItem(`daytrack_undo_${workDay.date}`);
            setUndoStack(stored ? (JSON.parse(stored) as WorkDay[]) : []);
        } catch { setUndoStack([]); }
        try {
            const stored = sessionStorage.getItem(`daytrack_redo_${workDay.date}`);
            setRedoStack(stored ? (JSON.parse(stored) as WorkDay[]) : []);
        } catch { setRedoStack([]); }
    }, [workDay.date]);

    useEffect(() => {
        const el = scrollRef.current;
        if (null === el) return;
        const saved = sessionStorage.getItem('daytrack_scroll');
        el.scrollTop = null !== saved ? parseInt(saved, 10) : 0;
    }, [workDay.date]);

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

    // ── Sélection ──────────────────────────────────────────────────────────

    function selectSingle(slot: string) {
        setSelectedSlots(new Set([slot]));
        setAnchorSlot(slot);
        setActiveSlot(slot);
    }

    function extendToSlot(to: string) {
        const anchor = anchorSlot ?? to;
        setSelectedSlots(new Set(getSlotRange(anchor, to)));
        setActiveSlot(to);
    }

    function toggleSlot(slot: string) {
        setSelectedSlots((prev) => {
            const next = new Set(prev);
            if (next.has(slot)) next.delete(slot);
            else next.add(slot);
            return next;
        });
        setAnchorSlot(slot);
        setActiveSlot(slot);
    }

    function clearSelection() {
        setSelectedSlots(new Set());
        setAnchorSlot(null);
        setActiveSlot(null);
    }

    function handleSelect(slot: string, e: React.MouseEvent) {
        if (e.shiftKey && anchorSlot) extendToSlot(slot);
        else if (e.ctrlKey || e.metaKey) toggleSlot(slot);
        else selectSingle(slot);
    }

    // ── Drag ─────────────────────────────────────────────────────────────

    function startDrag(slot: string) {
        dragMovedRef.current = false;
        selectSingle(slot);
        setIsDragging(true);
    }

    function handleDragExtend(slot: string) {
        if (!isDragging) return;
        dragMovedRef.current = true;
        extendToSlot(slot);
    }

    useEffect(() => {
        if (!isDragging) return;
        function onMouseUp() { setIsDragging(false); }
        document.addEventListener('mouseup', onMouseUp);
        return () => document.removeEventListener('mouseup', onMouseUp);
    }, [isDragging]);

    useEffect(() => {
        if (!isDragging) return;
        let lastY = 0;
        let frameId: number;
        function onMouseMove(e: MouseEvent) { lastY = e.clientY; }
        function scrollTick() {
            const el = scrollRef.current;
            if (el) {
                const rect = el.getBoundingClientRect();
                const threshold = 60;
                if (lastY > rect.top && lastY < rect.top + threshold) el.scrollTop -= 6;
                else if (lastY < rect.bottom && lastY > rect.bottom - threshold) el.scrollTop += 6;
            }
            frameId = requestAnimationFrame(scrollTick);
        }
        document.addEventListener('mousemove', onMouseMove);
        frameId = requestAnimationFrame(scrollTick);
        return () => {
            document.removeEventListener('mousemove', onMouseMove);
            cancelAnimationFrame(frameId);
        };
    }, [isDragging]);

    // ── Historique ────────────────────────────────────────────────────────

    function pushHistory() {
        const newUndoStack = [...undoStack.slice(-49), workDay];
        setUndoStack(newUndoStack);
        setRedoStack([]);
        sessionStorage.setItem(`daytrack_undo_${workDay.date}`, JSON.stringify(newUndoStack));
        sessionStorage.setItem(`daytrack_redo_${workDay.date}`, JSON.stringify([]));
    }

    async function reconcileWorkDay(target: WorkDay) {
        const currentMap = buildEntryMap(workDay.entries);
        const targetMap = buildEntryMap(target.entries);
        let updated: WorkDay = workDay;
        for (const [, currentEntry] of currentMap) {
            if (!targetMap.has(currentEntry.startedAt)) {
                updated = await deleteEntry(target.date, currentEntry.id);
            }
        }
        for (const [, targetEntry] of targetMap) {
            if (!currentMap.has(targetEntry.startedAt)) {
                updated = await createEntry(target.date, {
                    startedAt: targetEntry.startedAt,
                    endedAt: targetEntry.endedAt ?? getNextSlot(targetEntry.startedAt),
                    ticketKey: targetEntry.ticketKey,
                    type: targetEntry.type,
                    comment: targetEntry.comment,
                    ticketSummary: targetEntry.ticketSummary,
                    ticketType: targetEntry.ticketType,
                });
            }
        }
        for (const [, targetEntry] of targetMap) {
            const current = currentMap.get(targetEntry.startedAt);
            if (current && (
                current.ticketKey !== targetEntry.ticketKey ||
                current.type !== targetEntry.type ||
                current.comment !== targetEntry.comment ||
                current.ticketSummary !== targetEntry.ticketSummary ||
                current.ticketType !== targetEntry.ticketType
            )) {
                updated = await updateEntry(target.date, current.id, {
                    ticketKey: targetEntry.ticketKey,
                    type: targetEntry.type,
                    comment: targetEntry.comment,
                    ticketSummary: targetEntry.ticketSummary,
                    ticketType: targetEntry.ticketType,
                });
            }
        }
        onWorkDayUpdate(updated);
    }

    async function handleUndo() {
        const targetWorkDay = undoStack[undoStack.length - 1];
        if (!targetWorkDay) return;
        setEditingSlot(null);
        const newUndoStack = undoStack.slice(0, -1);
        const newRedoStack = [...redoStack, workDay];
        setUndoStack(newUndoStack);
        setRedoStack(newRedoStack);
        sessionStorage.setItem(`daytrack_undo_${workDay.date}`, JSON.stringify(newUndoStack));
        sessionStorage.setItem(`daytrack_redo_${workDay.date}`, JSON.stringify(newRedoStack));
        try { await reconcileWorkDay(targetWorkDay); } catch { /* service gère */ }
    }

    async function handleRedo() {
        const targetWorkDay = redoStack[redoStack.length - 1];
        if (!targetWorkDay) return;
        setEditingSlot(null);
        const newUndoStack = [...undoStack, workDay];
        const newRedoStack = redoStack.slice(0, -1);
        setUndoStack(newUndoStack);
        setRedoStack(newRedoStack);
        sessionStorage.setItem(`daytrack_undo_${workDay.date}`, JSON.stringify(newUndoStack));
        sessionStorage.setItem(`daytrack_redo_${workDay.date}`, JSON.stringify(newRedoStack));
        try { await reconcileWorkDay(targetWorkDay); } catch { /* service gère */ }
    }

    // ── Opérations ────────────────────────────────────────────────────────

    async function handleSave(
        slot: string,
        ticketKey: string | null,
        type: EntryType,
        comment: string | null,
        ticketSummary: string | null,
        ticketType: string | null,
    ) {
        if (pendingSlotsRef.current.has(slot)) return;
        pendingSlotsRef.current.add(slot);
        setEditingSlot(null);
        const existing = entryMap.get(slot);
        try {
            let updated: WorkDay;
            if (existing) {
                if (
                    existing.type === type &&
                    existing.ticketKey === ticketKey &&
                    existing.comment === comment &&
                    existing.ticketSummary === ticketSummary &&
                    existing.ticketType === ticketType
                ) return;
                pushHistory();
                updated = await updateEntry(workDay.date, existing.id, { ticketKey, type, comment, ticketSummary, ticketType });
            } else {
                pushHistory();
                updated = await createEntry(workDay.date, {
                    startedAt: slot,
                    endedAt: getNextSlot(slot),
                    ticketKey,
                    type,
                    comment,
                    ticketSummary,
                    ticketType,
                });
            }
            onWorkDayUpdate(updated);
        } catch {
            /* service gère */
        } finally {
            pendingSlotsRef.current.delete(slot);
        }
    }

    async function handleBulkClear(slots: Set<string>) {
        const toDelete = [...slots].map((s) => entryMap.get(s)).filter(Boolean) as TimeEntry[];
        if (0 === toDelete.length) return;
        pushHistory();
        for (const entry of toDelete) {
            try {
                const updated = await deleteEntry(workDay.date, entry.id);
                onWorkDayUpdate(updated);
            } catch { /* service gère */ }
        }
    }

    async function handleBulkConvertToBreak(slots: Set<string>) {
        const slotsArr = [...slots];
        const toConvert = slotsArr
            .map((s) => entryMap.get(s))
            .filter((e): e is TimeEntry => !!e && e.type !== EntryType.BREAK);
        const emptySlots = slotsArr.filter((s) => !entryMap.has(s));
        if (0 === toConvert.length && 0 === emptySlots.length) return;
        pushHistory();
        for (const entry of toConvert) {
            try {
                const updated = await updateEntry(workDay.date, entry.id, { type: EntryType.BREAK, ticketKey: null, comment: null });
                onWorkDayUpdate(updated);
            } catch { /* service gère */ }
        }
        for (const slot of emptySlots) {
            if (pendingSlotsRef.current.has(slot)) continue;
            pendingSlotsRef.current.add(slot);
            try {
                const updated = await createEntry(workDay.date, { startedAt: slot, endedAt: getNextSlot(slot), type: EntryType.BREAK });
                onWorkDayUpdate(updated);
            } catch {
                /* service gère */
            } finally {
                pendingSlotsRef.current.delete(slot);
            }
        }
        setEditingSlot(null);
    }

    // ── Presse-papier ─────────────────────────────────────────────────────

    function handleCopySelection() {
        const sorted = [...selectedSlots].sort();
        if (0 === sorted.length) return;
        const anchorIdx = TIME_SLOTS.indexOf(sorted[0] as string);
        const cells: ClipboardCell[] = sorted.map((slot) => {
            const idx = TIME_SLOTS.indexOf(slot);
            const entry = entryMap.get(slot) ?? null;
            return {
                offset: idx - anchorIdx,
                ticketKey: entry?.ticketKey ?? null,
                ticketSummary: entry?.ticketSummary ?? null,
                ticketType: entry?.ticketType ?? null,
                comment: entry?.comment ?? null,
                type: entry?.type ?? EntryType.WORK,
                isEmpty: null === entry,
            };
        });
        const value: ClipboardData = { cells };
        setClipboard(value);
        sessionStorage.setItem('daytrack_clipboard', JSON.stringify(value));
    }

    async function handleCutSelection() {
        handleCopySelection();
        await handleBulkClear(selectedSlots);
    }

    async function handlePaste(targetSlot: string) {
        if (null === clipboard || 0 === clipboard.cells.length) return;
        const targetIdx = TIME_SLOTS.indexOf(targetSlot);
        if (-1 === targetIdx) return;
        pushHistory();
        for (const cell of clipboard.cells) {
            const destIdx = targetIdx + cell.offset;
            if (destIdx < 0 || destIdx >= TIME_SLOTS.length) continue;
            const destSlot = TIME_SLOTS[destIdx] as string;
            if (pendingSlotsRef.current.has(destSlot)) continue;
            pendingSlotsRef.current.add(destSlot);
            const existing = entryMap.get(destSlot) ?? null;
            try {
                if (cell.isEmpty) {
                    if (existing) { const updated = await deleteEntry(workDay.date, existing.id); onWorkDayUpdate(updated); }
                } else {
                    let updated: WorkDay;
                    if (existing) {
                        updated = await updateEntry(workDay.date, existing.id, {
                            ticketKey: cell.ticketKey, type: cell.type, comment: cell.comment,
                            ticketSummary: cell.ticketSummary, ticketType: cell.ticketType,
                        });
                    } else {
                        updated = await createEntry(workDay.date, {
                            startedAt: destSlot, endedAt: getNextSlot(destSlot),
                            ticketKey: cell.ticketKey, type: cell.type, comment: cell.comment,
                            ticketSummary: cell.ticketSummary, ticketType: cell.ticketType,
                        });
                    }
                    onWorkDayUpdate(updated);
                }
            } catch {
                /* service gère */
            } finally {
                pendingSlotsRef.current.delete(destSlot);
            }
        }
    }

    async function handlePasteToMultiple(slots: string[]) {
        if (null === clipboard || 0 === clipboard.cells.length) return;
        const cell = clipboard.cells[0]!;
        pushHistory();
        for (const slot of slots) {
            if (pendingSlotsRef.current.has(slot)) continue;
            pendingSlotsRef.current.add(slot);
            const existing = entryMap.get(slot) ?? null;
            try {
                if (cell.isEmpty) {
                    if (existing) { const updated = await deleteEntry(workDay.date, existing.id); onWorkDayUpdate(updated); }
                } else {
                    let updated: WorkDay;
                    if (existing) {
                        updated = await updateEntry(workDay.date, existing.id, {
                            ticketKey: cell.ticketKey, type: cell.type, comment: cell.comment,
                            ticketSummary: cell.ticketSummary, ticketType: cell.ticketType,
                        });
                    } else {
                        updated = await createEntry(workDay.date, {
                            startedAt: slot, endedAt: getNextSlot(slot),
                            ticketKey: cell.ticketKey, type: cell.type, comment: cell.comment,
                            ticketSummary: cell.ticketSummary, ticketType: cell.ticketType,
                        });
                    }
                    onWorkDayUpdate(updated);
                }
            } catch {
                /* service gère */
            } finally {
                pendingSlotsRef.current.delete(slot);
            }
        }
    }

    // ── Clavier ───────────────────────────────────────────────────────────

    useEffect(() => {
        if (0 === selectedSlots.size) return;
        function handleClick(e: MouseEvent) {
            if (scrollRef.current?.contains(e.target as Node)) return;
            clearSelection();
        }
        document.addEventListener('click', handleClick);
        return () => document.removeEventListener('click', handleClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedSlots.size]);

    const selectionKeyHandlerRef = useRef<((e: KeyboardEvent) => void) | null>(null);
    selectionKeyHandlerRef.current = (e: KeyboardEvent) => {
        if (0 === selectedSlots.size || null !== editingSlot) return;
        const ctrl = e.metaKey || e.ctrlKey;
        if (ctrl && 'c' === e.key) { e.preventDefault(); handleCopySelection(); }
        else if (ctrl && 'x' === e.key) { e.preventDefault(); void handleCutSelection(); }
        else if (ctrl && 'v' === e.key) {
            e.preventDefault();
            if (selectedSlots.size > 1 && clipboard?.cells.length === 1) void handlePasteToMultiple([...selectedSlots]);
            else if (selectedSlots.size > 1) setShowPasteWarning(true);
            else { const target = anchorSlot ?? [...selectedSlots][0]; if (target) void handlePaste(target); }
        } else if ('Delete' === e.key || 'Backspace' === e.key) { e.preventDefault(); void handleBulkClear(selectedSlots); }
        else if ('ArrowUp' === e.key || 'ArrowDown' === e.key) {
            e.preventDefault();
            const current = activeSlot ?? anchorSlot ?? [...selectedSlots][0];
            if (!current) return;
            const idx = TIME_SLOTS.indexOf(current);
            const nextIdx = 'ArrowUp' === e.key ? idx - 1 : idx + 1;
            if (nextIdx < 0 || nextIdx >= TIME_SLOTS.length) return;
            const nextSlot = TIME_SLOTS[nextIdx] as string;
            if (e.shiftKey) extendToSlot(nextSlot);
            else selectSingle(nextSlot);
        } else if ('Escape' === e.key) { e.preventDefault(); clearSelection(); }
    };
    useEffect(() => {
        function handler(e: KeyboardEvent) { selectionKeyHandlerRef.current?.(e); }
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, []);

    const undoRedoKeyHandlerRef = useRef<((e: KeyboardEvent) => void) | null>(null);
    undoRedoKeyHandlerRef.current = (e: KeyboardEvent) => {
        const active = document.activeElement;
        if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
        const ctrl = e.metaKey || e.ctrlKey;
        if (!ctrl) return;
        if ('z' === e.key && !e.shiftKey) { e.preventDefault(); void handleUndo(); }
        else if (('z' === e.key && e.shiftKey) || 'y' === e.key) { e.preventDefault(); void handleRedo(); }
    };
    useEffect(() => {
        function handler(e: KeyboardEvent) { undoRedoKeyHandlerRef.current?.(e); }
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, []);

    function handleScroll() {
        const el = scrollRef.current;
        if (null === el) return;
        sessionStorage.setItem('daytrack_scroll', String(el.scrollTop));
    }

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
                    onSave={(ticketKey, type, comment, ticketSummary, ticketType) =>
                        void handleSave(editingSlot, ticketKey, type, comment, ticketSummary, ticketType)
                    }
                    onCancel={() => { setEditingSlot(null); setEditMousePos(null); }}
                    onClear={() => {
                        const existing = entryMap.get(editingSlot);
                        if (existing) void handleBulkClear(new Set([editingSlot]));
                        setEditingSlot(null);
                        setEditMousePos(null);
                    }}
                />
            )}

            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto"
                style={editingSlot !== null ? { overflow: 'hidden' } : undefined}
                onScroll={handleScroll}
                onClick={() => {
                    if (dragMovedRef.current) { dragMovedRef.current = false; return; }
                    clearSelection();
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
                            const runInfo = runMap.get(slot)!;
                            const effectiveSelection =
                                selectedSlots.has(slot) && selectedSlots.size > 1
                                    ? selectedSlots
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
                                        entry={entry}
                                        runInfo={runInfo}
                                        isSelected={selectedSlots.has(slot)}
                                        hasClipboard={null !== clipboard && clipboard.cells.length > 0}
                                        knownTickets={knownTickets}
                                        onSelect={(e) => handleSelect(slot, e)}
                                        onStartEdit={(x, y) => { setEditMousePos({ x, y }); setEditingSlot(slot); }}
                                        onCopy={() => handleCopySelection()}
                                        onCut={() => void handleCutSelection()}
                                        onPaste={() => void handlePaste(slot)}
                                        onClear={() => void handleBulkClear(effectiveSelection)}
                                        onConvertToBreak={() => void handleBulkConvertToBreak(effectiveSelection)}
                                        onContextMenuOpen={() => {
                                            if (!selectedSlots.has(slot)) selectSingle(slot);
                                        }}
                                        onDropFavorite={() => void handlePaste(slot)}
                                        onCellMouseDown={(e) => {
                                            if (0 !== e.button) return;
                                            if (e.shiftKey || e.ctrlKey || e.metaKey) return;
                                            e.preventDefault();
                                            startDrag(slot);
                                        }}
                                        onDragExtend={() => handleDragExtend(slot)}
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
                                    isSelected={selectedSlots.has(slot)}
                                />
                            );
                        })}

                        {/* Rings de sélection sur chaque créneau sélectionné */}
                        {[...selectedSlots].map((slot) => {
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

// ── Composants visuels des blocs ───────────────────────────────────────────

interface WorkBlockProps {
    top: number;
    height: number;
    slotCount: number;
    ticket: string;
    summary: string | null;
    comment: string | null;
    colors: { bg: string; bar: string; text: string; border: string; ring: string };
    runDurationMinutes: number;
    isSelected: boolean;
}

function WorkBlock({ top, height, slotCount, ticket, summary, comment, colors, runDurationMinutes }: WorkBlockProps) {
    const single = slotCount === 1;
    const dur = formatMinutes(runDurationMinutes);


    return (
        <div
            className="absolute left-1 right-1 rounded-lg overflow-hidden flex"
            style={{
                top: top + 1,
                height: height - 1,
                background: colors.bg,
                border: `1px solid ${colors.border}`,
                zIndex: 2,
            }}
        >
            {/* Barre colorée gauche */}
            <div className="w-1 shrink-0 self-stretch" style={{ background: colors.bar }} />

            {/* Corps */}
            <div className="relative flex flex-col flex-1 min-w-0 overflow-hidden px-3">
                {single ? (
                    /* Créneau unique — 3 colonnes : ID | [titre commentaire] | durée */
                    <div
                        className="grid items-center h-full min-w-0"
                        style={{ gridTemplateColumns: '80px minmax(0,1fr) auto', gap: '10px' }}
                    >
                        <span
                            className="font-mono text-[12.5px] font-semibold tabular-nums tracking-wide truncate"
                            style={{ color: colors.text }}
                        >
                            {ticket}
                        </span>
                        {/* Titre collé au commentaire — gap identique au gap externe ; titre coupé à 50% si commentaire */}
                        <div className="flex items-center min-w-0 overflow-hidden" style={{ gap: '16px' }}>
                            {(summary || !comment) && (
                                <span
                                    className="text-[12.5px] font-medium text-gray-800 truncate shrink-0"
                                    style={comment ? { maxWidth: '50%' } : undefined}
                                >
                                    {summary ?? ''}
                                </span>
                            )}
                            {comment && (
                                <span className="text-[12px] text-muted-foreground truncate flex-1 min-w-0">
                                    {comment}
                                </span>
                            )}
                        </div>
                        <span className="font-mono text-[11.5px] font-medium tabular-nums shrink-0" style={{ color: 'oklch(0.556 0 0)' }}>
                            {dur}
                        </span>
                    </div>
                ) : (
                    /* Bloc multi-créneaux */
                    <>
                        <div
                            className="flex min-w-0"
                            style={{ gap: '10px', minHeight: SLOT_HEIGHT - 2 }}
                        >
                            <span
                                className="font-mono text-[12.5px] font-semibold tabular-nums tracking-wide truncate shrink-0"
                                style={{ color: colors.text, width: 80, paddingTop: 4 }}
                            >
                                {ticket}
                            </span>
                            <div className="flex flex-col min-w-0 overflow-hidden gap-px py-1">
                                {summary && (
                                    <span
                                        className="text-[13px] font-medium text-gray-800 leading-snug overflow-hidden"
                                        style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflowWrap: 'anywhere' }}
                                    >
                                        {summary}
                                    </span>
                                )}
                                {comment && (
                                    <span
                                        className="text-[12.5px] leading-snug overflow-hidden"
                                        style={{ color: 'oklch(0.556 0 0)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as const, overflowWrap: 'anywhere' }}
                                    >
                                        {comment}
                                    </span>
                                )}
                            </div>
                        </div>
                        {/* Durée absolue en bas à droite */}
                        <div className="absolute bottom-1 right-2 pointer-events-none">
                            <span
                                className="font-mono text-[11.5px] font-medium tabular-nums pl-1"
                                style={{ color: 'oklch(0.556 0 0)', background: colors.bg }}
                            >
                                {dur}
                            </span>
                        </div>
                    </>
                )}
            </div>

        </div>
    );
}

interface PauseBlockProps {
    top: number;
    height: number;
    slotCount: number;
    runDurationMinutes: number;
}

function PauseBlock({ top, height, slotCount, runDurationMinutes }: PauseBlockProps) {
    const dur = formatMinutes(runDurationMinutes);
    const showDur = runDurationMinutes > 15;

    return (
        <div
            className="absolute left-1 right-1 rounded-lg overflow-hidden flex items-center justify-center"
            style={{
                top: top + 1,
                height: height - 1,
                background: 'repeating-linear-gradient(135deg,oklch(0.96 0 0) 0px,oklch(0.96 0 0) 6px,oklch(0.93 0 0) 6px,oklch(0.93 0 0) 7px)',
                border: '1px solid oklch(0.92 0 0)',
                zIndex: 2,
            }}
        >
            {/* Badge pill centré verticalement */}
            <div
                className="inline-flex items-center gap-2 bg-white rounded-full border border-gray-200"
                style={{ padding: '4px 12px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', fontSize: 12 }}
            >
                <Coffee className="w-3.5 h-3.5 shrink-0" style={{ color: 'oklch(0.556 0 0)' }} />
                <span className="font-medium" style={{ color: 'oklch(0.145 0 0)' }}>{t('timeline.break_label')}</span>
                {showDur && (
                    <span className="font-mono tabular-nums" style={{ fontSize: 11.5, color: 'oklch(0.556 0 0)' }}>{dur}</span>
                )}
            </div>

        </div>
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
