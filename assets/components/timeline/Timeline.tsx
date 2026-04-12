import { useEffect, useMemo, useRef, useState } from 'react';
import { EntryType } from '@/types/api';
import type { JiraTicketInfo, TimeEntry, WorkDay } from '@/types/api';
import {
    TIMELINE_START_HOUR,
    buildEntryMap,
    generateTimeSlots,
    getNextSlot,
    isHourSlot,
    today,
} from '@/utils/timeline';
import { createEntry, deleteEntry, updateEntry } from '@/services/dayService';
import { t } from '@/i18n/fr';
import TimeBlock from './TimeBlock';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';

interface TimelineProps {
    workDay: WorkDay;
    onWorkDayUpdate: (workDay: WorkDay) => void;
}

const TIME_SLOTS = generateTimeSlots();

/** Position d'un créneau dans une série consécutive de même contenu */
export type RunPosition = 'sole' | 'first' | 'middle' | 'last';

export interface SlotRunInfo {
    position: RunPosition;
    /** Durée totale du bloc en minutes (runLength × 15) */
    runDurationMinutes: number;
}

/**
 * Clé de groupement d'un créneau : détermine si deux créneaux consécutifs
 * appartiennent au même bloc visuel.
 * - Entrées vides → jamais groupées (chacune est indépendante)
 * - Pauses → groupées par commentaire
 * - Travail → groupé par ticketKey + comment
 */
function runKey(entry: TimeEntry | null): string | null {
    if (null === entry) return null;
    if (entry.type === EntryType.BREAK) return `break:${entry.comment ?? ''}`;
    return `work:${entry.ticketKey ?? ''}:${entry.comment ?? ''}`;
}

/** Calcule la position de chaque créneau dans son bloc visuel */
function computeRunMap(slots: string[], entryMap: Map<string, TimeEntry>): Map<string, SlotRunInfo> {
    const map = new Map<string, SlotRunInfo>();
    let i = 0;

    while (i < slots.length) {
        const slot = slots[i]!;
        const entry = entryMap.get(slot) ?? null;
        const key = runKey(entry);

        // Cellule vide : toujours sole
        if (null === key) {
            map.set(slot, { position: 'sole', runDurationMinutes: 15 });
            i++;
            continue;
        }

        // Détermine la longueur du run
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

// Retourne le créneau et l'offset exact dans ce créneau à partir d'un instant donné
function getNowPosition(date: Date): { slot: string; offsetPercent: number } {
    const h = date.getHours();
    const m = date.getMinutes();
    const slotMinutes = Math.floor(m / 15) * 15;
    const slot = `${String(h).padStart(2, '0')}:${String(slotMinutes).padStart(2, '0')}`;
    const offsetPercent = ((m % 15) / 15) * 100;
    return { slot, offsetPercent };
}

/** Retourne tous les créneaux entre `from` et `to` (bornes incluses, ordre ascendant) */
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

    const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());
    const [anchorSlot, setAnchorSlot] = useState<string | null>(null);
    const [activeSlot, setActiveSlot] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const dragMovedRef = useRef(false);

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

    // Écoute les mises à jour du presse-papier provenant des favoris
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

    // Rafraîchit l'indicateur "maintenant" à chaque passage de minute
    useEffect(() => {
        const msUntilNextMinute = 60 * 1000 - (Date.now() % (60 * 1000));
        const id = setTimeout(() => setTick((n) => n + 1), msUntilNextMinute);
        return () => clearTimeout(id);
    }, [tick]);

    // Charge l'historique undo/redo depuis la session
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

    // Restaure la position de scroll mémorisée
    useEffect(() => {
        const el = scrollRef.current;
        if (null === el) return;
        const saved = sessionStorage.getItem('daytrack_scroll');
        el.scrollTop = null !== saved ? parseInt(saved, 10) : 0;
    }, [workDay.date]);

    const isToday = workDay.date === today();
    const { slot: nowSlot, offsetPercent: nowOffsetPercent } = isToday
        ? getNowPosition(new Date())
        : { slot: null, offsetPercent: 0 };

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

    // ── Drag (sélection) ────────────────────────────────────────────────────

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

    // ── Historique ──────────────────────────────────────────────────────────

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

    // ── Opérations sur une cellule ──────────────────────────────────────────

    async function handleSave(
        slot: string,
        ticketKey: string | null,
        type: EntryType,
        comment: string | null,
        ticketSummary: string | null,
        ticketType: string | null,
    ) {
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
        } catch { /* service gère */ }
    }

    // ── Opérations bulk ─────────────────────────────────────────────────────

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
            try {
                const updated = await createEntry(workDay.date, { startedAt: slot, endedAt: getNextSlot(slot), type: EntryType.BREAK });
                onWorkDayUpdate(updated);
            } catch { /* service gère */ }
        }
        setEditingSlot(null);
    }

    // ── Presse-papier ───────────────────────────────────────────────────────

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
            const existing = entryMap.get(destSlot) ?? null;
            try {
                if (cell.isEmpty) {
                    if (existing) {
                        const updated = await deleteEntry(workDay.date, existing.id);
                        onWorkDayUpdate(updated);
                    }
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
            } catch { /* service gère */ }
        }
    }

    async function handlePasteToMultiple(slots: string[]) {
        if (null === clipboard || 0 === clipboard.cells.length) return;
        const cell = clipboard.cells[0]!;
        pushHistory();
        for (const slot of slots) {
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
            } catch { /* service gère */ }
        }
    }

    // ── Clavier ─────────────────────────────────────────────────────────────

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

    return (
        <>
            {/* Avertissement collage multi-sélection */}
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

            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto"
                onScroll={handleScroll}
                onClick={() => {
                    if (dragMovedRef.current) { dragMovedRef.current = false; return; }
                    clearSelection();
                }}
            >
                {TIME_SLOTS.map((slot) => {
                    const entry = entryMap.get(slot) ?? null;
                    const runInfo = runMap.get(slot)!;
                    const effectiveSelection =
                        selectedSlots.has(slot) && selectedSlots.size > 1
                            ? selectedSlots
                            : new Set([slot]);

                    const isHour = isHourSlot(slot);
                    const isFirstSlot = slot.startsWith(String(TIMELINE_START_HOUR).padStart(2, '0'));
                    const minutes = slot.split(':')[1];

                    return (
                        <div
                            key={slot}
                            className={`relative flex items-stretch ${isHour && !isFirstSlot ? 'border-t-2 border-gray-200' : ''}`}
                        >
                            {/* Colonne heure — label heure ronde + repères quarts */}
                            <div className="w-12 shrink-0 flex items-center justify-end pr-2">
                                {isHour ? (
                                    <span className="text-xs font-semibold text-gray-400 font-mono select-none">
                                        {slot.split(':')[0]}
                                    </span>
                                ) : (
                                    <span className="text-[9px] text-gray-300 font-mono select-none leading-none">
                                        {`:${minutes}`}
                                    </span>
                                )}
                            </div>

                            {/* Indicateur "maintenant" */}
                            {slot === nowSlot && (
                                <NowIndicator offsetPercent={nowOffsetPercent} dimmed={editingSlot === slot} />
                            )}

                            {/* Bloc de 15 minutes */}
                            <div className="flex-1 min-w-0">
                                <TimeBlock
                                    slot={slot}
                                    entry={entry}
                                    runInfo={runInfo}
                                    isEditing={editingSlot === slot}
                                    isSelected={selectedSlots.has(slot)}
                                    hasClipboard={null !== clipboard && clipboard.cells.length > 0}
                                    knownTickets={knownTickets}
                                    onSelect={(e) => handleSelect(slot, e)}
                                    onStartEdit={() => setEditingSlot(slot)}
                                    onSave={(ticketKey, type, comment, ticketSummary, ticketType) =>
                                        void handleSave(slot, ticketKey, type, comment, ticketSummary, ticketType)
                                    }
                                    onCancel={() => setEditingSlot(null)}
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
                                        if (editingSlot !== null) return;
                                        e.preventDefault();
                                        startDrag(slot);
                                    }}
                                    onDragExtend={() => handleDragExtend(slot)}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        </>
    );
}

/** Ligne rouge "maintenant" positionnée à l'heure exacte dans le créneau */
function NowIndicator({ offsetPercent, dimmed }: { offsetPercent: number; dimmed: boolean }) {
    return (
        <div
            className={`absolute left-12 right-0 flex items-center pointer-events-none -translate-y-1/2 transition-opacity ${dimmed ? 'z-0 opacity-20' : 'z-10'}`}
            style={{ top: `${offsetPercent}%` }}
        >
            <div className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0 -ml-1.5" />
            <div className="flex-1 h-px bg-red-500" />
        </div>
    );
}
