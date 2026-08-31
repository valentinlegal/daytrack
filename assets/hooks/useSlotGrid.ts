import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EntryType } from '@/types/api';
import { getNextSlot } from '@/utils/timeline';
import {
    readClipboard,
    writeClipboard,
    subscribeClipboard,
} from '@/utils/slotClipboard';
import type { ClipboardData } from '@/utils/slotClipboard';

/** "HH:mm" → minutes depuis minuit. */
function slotToMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
}

/** minutes depuis minuit → "HH:mm" aligné sur le quart d'heure (borné 00:00–23:45). */
function minutesToSlot(min: number): string {
    const c = Math.max(0, Math.min(23 * 60 + 45, Math.round(min / 15) * 15));
    return `${String(Math.floor(c / 60)).padStart(2, '0')}:${String(c % 60).padStart(2, '0')}`;
}

/** Durée en minutes entre deux "HH:mm". */
function spanMinutes(start: string, end: string): number {
    return slotToMinutes(end) - slotToMinutes(start);
}

/** Sous-ensemble commun d'une entrée de temps et d'une règle rendue comme bloc. */
export interface SlotCell {
    id: string;
    ticketKey: string | null;
    ticketSummary: string | null;
    ticketType: string | null;
    comment: string | null;
    type: EntryType;
    startedAt: string;      // "HH:mm"
    endedAt: string | null; // "HH:mm"
    /** Récurrence (vue Modèles) — absent en vue jour. */
    intervalWeeks?: number;
}

export interface SlotCellInput {
    ticketKey: string | null;
    ticketSummary: string | null;
    ticketType: string | null;
    comment: string | null;
    type: EntryType;
    endedAt: string;        // "HH:mm"
    /** Récurrence (vue Modèles) — ignoré par la vue jour. */
    intervalWeeks?: number;
}

export interface SlotGridOps {
    createCell(slot: string, data: SlotCellInput): Promise<SlotCell[]>;
    updateCell(cell: SlotCell, data: SlotCellInput): Promise<SlotCell[]>;
    deleteCell(cell: SlotCell): Promise<SlotCell[]>;
    /**
     * Optionnel : retire seulement `slots` d'une cellule (un bloc qui couvre plusieurs
     * créneaux se scinde/rétrécit). Absent → le hook supprime la cellule entière.
     */
    clearSlots?(cell: SlotCell, slots: string[]): Promise<SlotCell[]>;
}

export interface UseSlotGridArgs {
    slots: string[];
    cells: SlotCell[];
    storagePrefix: string;
    scrollRef: React.RefObject<HTMLDivElement | null>;
    ops: SlotGridOps;
    onChanged: (cells: SlotCell[]) => void;
    /** Appelé quand ⌘V est pressé sur une multi-sélection avec un presse-papier multi-cellules. */
    onNeedsPasteWarning?: () => void;
    /**
     * Appelé à la fin d'un clic-glisser d'au moins 2 créneaux qui a réellement bougé,
     * avec la position souris du relâchement. Le consommateur décide s'il ouvre un
     * popover de création (typiquement : uniquement si la plage ne contient aucun bloc).
     */
    onDragRange?: (slots: string[], pos: { x: number; y: number }) => void;
}

export interface UseSlotGridResult {
    selectedSlots: Set<string>;
    isDragging: boolean;
    hasClipboard: boolean;
    entryMap: Map<string, SlotCell>;
    onSelect(slot: string, e: React.MouseEvent): void;
    onCellMouseDown(slot: string, e: React.MouseEvent): void;
    onDragExtend(slot: string): void;
    onContextMenuOpen(slot: string): void;
    onCopy(): void;
    onCut(): void;
    onPaste(slot: string): void;
    onClearRange(slots: Set<string>): void;
    onConvertToBreak(slots: Set<string>): void;
    onDropFavorite(slot: string): void;
    /** Crée / met à jour / supprime la cellule d'un créneau. `null` sur une cellule existante = suppression. */
    save(slot: string, data: SlotCellInput | null): Promise<void>;
    /** Applique `data` à chaque créneau de la plage en une seule étape d'historique (une cellule de 15 min par créneau). */
    fillRange(slots: string[], data: SlotCellInput): Promise<void>;
    /** Vide les piles undo/redo (après une action que le moteur ne sait pas représenter). */
    clearHistory(): void;
    clearSelection(): void;
    /** true si le clic vient de terminer un drag (le consommateur ne doit pas déclencher un clic simple). */
    consumeDragMoved(): boolean;
}

export function useSlotGrid({
    slots,
    cells,
    storagePrefix,
    scrollRef,
    ops,
    onChanged,
    onNeedsPasteWarning,
    onDragRange,
}: UseSlotGridArgs): UseSlotGridResult {
    // Chaque créneau *couvert* par une cellule pointe vers elle (pas seulement son créneau
    // de départ) : en vue jour une cellule = 1 créneau (identique à avant), en vue Modèles
    // un bloc multi-créneaux devient adressable depuis n'importe lequel de ses créneaux.
    const entryMap = useMemo(() => {
        const m = new Map<string, SlotCell>();
        for (const c of cells) {
            const startIdx = slots.indexOf(c.startedAt);
            if (-1 === startIdx) { m.set(c.startedAt, c); continue; }
            const endIdx = c.endedAt ? slots.indexOf(c.endedAt) : startIdx + 1;
            const lastIdx = -1 === endIdx ? startIdx : Math.max(startIdx, endIdx - 1);
            for (let i = startIdx; i <= lastIdx; i++) m.set(slots[i]!, c);
        }
        return m;
    }, [cells, slots]);

    // ── Sélection ─────────────────────────────────────────────────────────
    const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());
    const [anchorSlot, setAnchorSlot] = useState<string | null>(null);
    const [activeSlot, setActiveSlot] = useState<string | null>(null);

    const slotRange = useCallback(
        (from: string, to: string): string[] => {
            const a = slots.indexOf(from);
            const b = slots.indexOf(to);
            if (-1 === a || -1 === b) return [from];
            const [lo, hi] = a <= b ? [a, b] : [b, a];
            return slots.slice(lo, hi + 1);
        },
        [slots],
    );

    const selectSingle = useCallback((slot: string) => {
        setSelectedSlots(new Set([slot]));
        setAnchorSlot(slot);
        setActiveSlot(slot);
    }, []);

    const extendToSlot = useCallback(
        (to: string) => {
            setSelectedSlots(new Set(slotRange(anchorSlot ?? to, to)));
            setActiveSlot(to);
        },
        [anchorSlot, slotRange],
    );

    const toggleSlot = useCallback((slot: string) => {
        setSelectedSlots((prev) => {
            const next = new Set(prev);
            if (next.has(slot)) next.delete(slot);
            else next.add(slot);
            return next;
        });
        setAnchorSlot(slot);
        setActiveSlot(slot);
    }, []);

    const clearSelection = useCallback(() => {
        setSelectedSlots(new Set());
        setAnchorSlot(null);
        setActiveSlot(null);
    }, []);

    const onSelect = useCallback(
        (slot: string, e: React.MouseEvent) => {
            if (e.shiftKey && anchorSlot) extendToSlot(slot);
            else if (e.ctrlKey || e.metaKey) toggleSlot(slot);
            else selectSingle(slot);
        },
        [anchorSlot, extendToSlot, toggleSlot, selectSingle],
    );

    // Clic hors grille → efface la sélection
    useEffect(() => {
        if (0 === selectedSlots.size) return;
        function onDocClick(e: MouseEvent) {
            if (scrollRef.current?.contains(e.target as Node)) return;
            clearSelection();
        }
        document.addEventListener('click', onDocClick);
        return () => document.removeEventListener('click', onDocClick);
    }, [selectedSlots.size, scrollRef, clearSelection]);

    // ── Drag ──────────────────────────────────────────────────────────────
    const [isDragging, setIsDragging] = useState(false);
    const dragMovedRef = useRef(false);
    const lastMouseRef = useRef({ x: 0, y: 0 });
    const selectedSlotsRef = useRef(selectedSlots);
    selectedSlotsRef.current = selectedSlots;
    const onDragRangeRef = useRef(onDragRange);
    onDragRangeRef.current = onDragRange;

    const onCellMouseDown = useCallback(
        (slot: string, e: React.MouseEvent) => {
            if (0 !== e.button) return;
            if (e.shiftKey || e.ctrlKey || e.metaKey) return;
            e.preventDefault();
            dragMovedRef.current = false;
            selectSingle(slot);
            setIsDragging(true);
        },
        [selectSingle],
    );

    const onDragExtend = useCallback(
        (slot: string) => {
            if (!isDragging) return;
            dragMovedRef.current = true;
            extendToSlot(slot);
        },
        [isDragging, extendToSlot],
    );

    const consumeDragMoved = useCallback(() => {
        if (dragMovedRef.current) {
            dragMovedRef.current = false;
            return true;
        }
        return false;
    }, []);

    useEffect(() => {
        if (!isDragging) return;
        let frame = 0;
        function onMove(e: MouseEvent) {
            lastMouseRef.current = { x: e.clientX, y: e.clientY };
        }
        function onUp() {
            setIsDragging(false);
            // Fin d'un glisser qui a bougé sur ≥ 2 créneaux → signal de création de plage.
            if (dragMovedRef.current) {
                const dragged = [...selectedSlotsRef.current];
                if (dragged.length >= 2) {
                    onDragRangeRef.current?.(dragged, { ...lastMouseRef.current });
                }
            }
        }
        function tick() {
            const el = scrollRef.current;
            const y = lastMouseRef.current.y;
            if (el) {
                const r = el.getBoundingClientRect();
                const t = 60;
                if (y > r.top && y < r.top + t) el.scrollTop -= 6;
                else if (y < r.bottom && y > r.bottom - t) el.scrollTop += 6;
            }
            frame = requestAnimationFrame(tick);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        frame = requestAnimationFrame(tick);
        return () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            cancelAnimationFrame(frame);
        };
    }, [isDragging, scrollRef]);

    // ── Scroll persistant ────────────────────────────────────────────────
    useEffect(() => {
        const el = scrollRef.current;
        if (null === el) return;
        const saved = sessionStorage.getItem(`${storagePrefix}_scroll`);
        el.scrollTop = null !== saved ? parseInt(saved, 10) : 0;
        function onScroll() {
            if (el) sessionStorage.setItem(`${storagePrefix}_scroll`, String(el.scrollTop));
        }
        el.addEventListener('scroll', onScroll);
        return () => el.removeEventListener('scroll', onScroll);
    }, [storagePrefix, scrollRef]);

    // ── Presse-papier ────────────────────────────────────────────────────
    const [clipboard, setClipboard] = useState<ClipboardData | null>(() => readClipboard());
    useEffect(() => subscribeClipboard(() => setClipboard(readClipboard())), []);

    const onCopy = useCallback(() => {
        const sorted = [...selectedSlots].sort();
        if (0 === sorted.length) return;
        const anchorIdx = slots.indexOf(sorted[0] as string);
        // Un bloc multi-créneaux (même cellule sur plusieurs créneaux) n'est copié qu'une fois,
        // à l'offset de son créneau de départ.
        const seen = new Set<string>();
        const cellsOut: ClipboardData['cells'] = [];
        for (const slot of sorted) {
            const idx = slots.indexOf(slot);
            const entry = entryMap.get(slot) ?? null;
            if (entry && seen.has(entry.id)) continue;
            if (entry) seen.add(entry.id);
            const baseIdx = entry ? slots.indexOf(entry.startedAt) : idx;
            cellsOut.push({
                offset: baseIdx - anchorIdx,
                ticketKey: entry?.ticketKey ?? null,
                ticketSummary: entry?.ticketSummary ?? null,
                ticketType: entry?.ticketType ?? null,
                comment: entry?.comment ?? null,
                type: entry?.type ?? EntryType.WORK,
                isEmpty: null === entry,
                // Longueur du bloc source (utile en vue Modèles ; 15 min en vue jour).
                durationMinutes: entry?.endedAt ? spanMinutes(entry.startedAt, entry.endedAt) : undefined,
            });
        }
        const value: ClipboardData = { cells: cellsOut };
        setClipboard(value);
        writeClipboard(value);
    }, [selectedSlots, slots, entryMap]);

    // ── Garde anti-double-soumission + historique ────────────────────────
    const pendingSlotsRef = useRef<Set<string>>(new Set());
    const [undoStack, setUndoStack] = useState<SlotCell[][]>([]);
    const [redoStack, setRedoStack] = useState<SlotCell[][]>([]);

    useEffect(() => {
        try {
            const u = sessionStorage.getItem(`${storagePrefix}_undo`);
            setUndoStack(u ? (JSON.parse(u) as SlotCell[][]) : []);
        } catch { setUndoStack([]); }
        try {
            const r = sessionStorage.getItem(`${storagePrefix}_redo`);
            setRedoStack(r ? (JSON.parse(r) as SlotCell[][]) : []);
        } catch { setRedoStack([]); }
    }, [storagePrefix]);

    const persistStacks = useCallback(
        (u: SlotCell[][], r: SlotCell[][]) => {
            sessionStorage.setItem(`${storagePrefix}_undo`, JSON.stringify(u));
            sessionStorage.setItem(`${storagePrefix}_redo`, JSON.stringify(r));
        },
        [storagePrefix],
    );

    const pushHistory = useCallback(() => {
        const u = [...undoStack.slice(-49), cells];
        setUndoStack(u);
        setRedoStack([]);
        persistStacks(u, []);
    }, [undoStack, cells, persistStacks]);

    const clearHistory = useCallback(() => {
        setUndoStack([]);
        setRedoStack([]);
        persistStacks([], []);
    }, [persistStacks]);

    const reconcile = useCallback(
        async (target: SlotCell[]) => {
            const curMap = new Map(cells.map((c) => [c.startedAt, c]));
            const tgtMap = new Map(target.map((c) => [c.startedAt, c]));
            let latest: SlotCell[] = cells;
            for (const [, cur] of curMap) {
                if (!tgtMap.has(cur.startedAt)) latest = await ops.deleteCell(cur);
            }
            for (const [, tgt] of tgtMap) {
                if (!curMap.has(tgt.startedAt)) {
                    latest = await ops.createCell(tgt.startedAt, {
                        ticketKey: tgt.ticketKey,
                        ticketSummary: tgt.ticketSummary,
                        ticketType: tgt.ticketType,
                        comment: tgt.comment,
                        type: tgt.type,
                        endedAt: tgt.endedAt ?? getNextSlot(tgt.startedAt),
                    });
                }
            }
            for (const [, tgt] of tgtMap) {
                const cur = curMap.get(tgt.startedAt);
                if (!cur) continue;
                const tgtEnd = tgt.endedAt ?? getNextSlot(tgt.startedAt);
                const durChanged = (cur.endedAt ?? getNextSlot(cur.startedAt)) !== tgtEnd;
                const contentChanged =
                    cur.ticketKey !== tgt.ticketKey
                    || cur.type !== tgt.type
                    || cur.comment !== tgt.comment
                    || cur.ticketSummary !== tgt.ticketSummary
                    || cur.ticketType !== tgt.ticketType;
                if (durChanged) {
                    // Durée modifiée (ex : bloc scindé/rétréci) → recréer à la bonne longueur.
                    await ops.deleteCell(cur);
                    latest = await ops.createCell(tgt.startedAt, {
                        ticketKey: tgt.ticketKey,
                        ticketSummary: tgt.ticketSummary,
                        ticketType: tgt.ticketType,
                        comment: tgt.comment,
                        type: tgt.type,
                        endedAt: tgtEnd,
                    });
                } else if (contentChanged) {
                    latest = await ops.updateCell(cur, {
                        ticketKey: tgt.ticketKey,
                        ticketSummary: tgt.ticketSummary,
                        ticketType: tgt.ticketType,
                        comment: tgt.comment,
                        type: tgt.type,
                        endedAt: cur.endedAt ?? getNextSlot(cur.startedAt),
                    });
                }
            }
            onChanged(latest);
        },
        [cells, ops, onChanged],
    );

    const handleUndo = useCallback(async () => {
        const target = undoStack[undoStack.length - 1];
        if (!target) return;
        const u = undoStack.slice(0, -1);
        const r = [...redoStack, cells];
        setUndoStack(u);
        setRedoStack(r);
        persistStacks(u, r);
        try { await reconcile(target); } catch { /* ops gèrent */ }
    }, [undoStack, redoStack, cells, persistStacks, reconcile]);

    const handleRedo = useCallback(async () => {
        const target = redoStack[redoStack.length - 1];
        if (!target) return;
        const u = [...undoStack, cells];
        const r = redoStack.slice(0, -1);
        setUndoStack(u);
        setRedoStack(r);
        persistStacks(u, r);
        try { await reconcile(target); } catch { /* ops gèrent */ }
    }, [undoStack, redoStack, cells, persistStacks, reconcile]);

    // ── Opérations ───────────────────────────────────────────────────────
    const save = useCallback(
        async (slot: string, data: SlotCellInput | null) => {
            if (pendingSlotsRef.current.has(slot)) return;
            pendingSlotsRef.current.add(slot);
            const existing = entryMap.get(slot);
            try {
                if (data === null) {
                    if (existing) { pushHistory(); onChanged(await ops.deleteCell(existing)); }
                    return;
                }
                if (existing) {
                    const intervalUnchanged =
                        data.intervalWeeks === undefined
                        || data.intervalWeeks === existing.intervalWeeks;
                    if (
                        existing.type === data.type
                        && existing.ticketKey === data.ticketKey
                        && existing.comment === data.comment
                        && existing.ticketSummary === data.ticketSummary
                        && existing.ticketType === data.ticketType
                        && intervalUnchanged
                    ) return;
                    pushHistory();
                    onChanged(await ops.updateCell(existing, data));
                } else {
                    pushHistory();
                    onChanged(await ops.createCell(slot, data));
                }
            } catch {
                /* ops gèrent le message */
            } finally {
                pendingSlotsRef.current.delete(slot);
            }
        },
        [entryMap, ops, onChanged, pushHistory],
    );

    const fillRange = useCallback(
        async (targetSlots: string[], data: SlotCellInput) => {
            if (0 === targetSlots.length) return;
            pushHistory();
            let latest: SlotCell[] = cells;
            for (const slot of targetSlots) {
                if (pendingSlotsRef.current.has(slot)) continue;
                pendingSlotsRef.current.add(slot);
                const existing = entryMap.get(slot);
                // Une cellule de 15 min par créneau ; les créneaux adjacents identiques
                // se fusionnent visuellement (vue jour) ou forment un bloc (vue Modèles via ops).
                const perSlot: SlotCellInput = { ...data, endedAt: getNextSlot(slot) };
                try {
                    if (existing) latest = await ops.updateCell(existing, perSlot);
                    else latest = await ops.createCell(slot, perSlot);
                } catch { /* ops gèrent le message */ } finally {
                    pendingSlotsRef.current.delete(slot);
                }
            }
            onChanged(latest);
        },
        [entryMap, cells, ops, onChanged, pushHistory],
    );

    const onClearRange = useCallback(
        async (targetSlots: Set<string>) => {
            // Regroupe les créneaux sélectionnés par cellule touchée.
            const byId = new Map<string, { cell: SlotCell; slots: string[] }>();
            for (const s of targetSlots) {
                const c = entryMap.get(s);
                if (!c) continue;
                const e = byId.get(c.id) ?? { cell: c, slots: [] };
                e.slots.push(s);
                byId.set(c.id, e);
            }
            if (0 === byId.size) return;
            pushHistory();
            let latest: SlotCell[] = cells;
            for (const { cell, slots: cellSlots } of byId.values()) {
                try {
                    // `clearSlots` (vue Modèles) retire seulement les créneaux sélectionnés ;
                    // sinon on supprime la cellule entière (vue jour : 1 cellule = 1 créneau).
                    latest = ops.clearSlots
                        ? await ops.clearSlots(cell, cellSlots)
                        : await ops.deleteCell(cell);
                } catch { /* */ }
            }
            onChanged(latest);
        },
        [entryMap, cells, ops, onChanged, pushHistory],
    );

    const onConvertToBreak = useCallback(
        async (targetSlots: Set<string>) => {
            const arr = [...targetSlots];
            const byId = new Map<string, SlotCell>();
            for (const s of arr) {
                const c = entryMap.get(s);
                if (c && c.type !== EntryType.BREAK) byId.set(c.id, c);
            }
            const toConvert = [...byId.values()];
            const empties = arr.filter((s) => !entryMap.has(s));
            if (0 === toConvert.length && 0 === empties.length) return;
            pushHistory();
            let latest: SlotCell[] = cells;
            for (const cell of toConvert) {
                try {
                    latest = await ops.updateCell(cell, {
                        ticketKey: null, ticketSummary: null, ticketType: null,
                        comment: null, type: EntryType.BREAK,
                        endedAt: cell.endedAt ?? getNextSlot(cell.startedAt),
                    });
                } catch { /* */ }
            }
            for (const slot of empties) {
                if (pendingSlotsRef.current.has(slot)) continue;
                pendingSlotsRef.current.add(slot);
                try {
                    latest = await ops.createCell(slot, {
                        ticketKey: null, ticketSummary: null, ticketType: null,
                        comment: null, type: EntryType.BREAK, endedAt: getNextSlot(slot),
                    });
                } catch { /* */ } finally {
                    pendingSlotsRef.current.delete(slot);
                }
            }
            onChanged(latest);
        },
        [entryMap, cells, ops, onChanged, pushHistory],
    );

    const applyClipboardCell = useCallback(
        async (destSlot: string, cell: ClipboardData['cells'][number]): Promise<SlotCell[] | null> => {
            const existing = entryMap.get(destSlot) ?? null;
            if (cell.isEmpty) {
                return existing ? await ops.deleteCell(existing) : null;
            }
            const data: SlotCellInput = {
                ticketKey: cell.ticketKey,
                ticketSummary: cell.ticketSummary,
                ticketType: cell.ticketType,
                comment: cell.comment,
                type: cell.type,
                // > 15 min : bloc Modèles multi-créneaux → on restitue sa longueur.
                // Sinon (vue jour) : créneau suivant, comportement inchangé.
                endedAt: existing?.endedAt
                    ?? (cell.durationMinutes && cell.durationMinutes > 15
                        ? minutesToSlot(slotToMinutes(destSlot) + cell.durationMinutes)
                        : getNextSlot(destSlot)),
            };
            return existing ? await ops.updateCell(existing, data) : await ops.createCell(destSlot, data);
        },
        [entryMap, ops],
    );

    const onPaste = useCallback(
        async (targetSlot: string) => {
            if (null === clipboard || 0 === clipboard.cells.length) return;
            const targetIdx = slots.indexOf(targetSlot);
            if (-1 === targetIdx) return;
            pushHistory();
            let latest: SlotCell[] = cells;
            for (const cell of clipboard.cells) {
                const destIdx = targetIdx + cell.offset;
                if (destIdx < 0 || destIdx >= slots.length) continue;
                const destSlot = slots[destIdx] as string;
                if (pendingSlotsRef.current.has(destSlot)) continue;
                pendingSlotsRef.current.add(destSlot);
                try {
                    const r = await applyClipboardCell(destSlot, cell);
                    if (r) latest = r;
                } catch { /* */ } finally {
                    pendingSlotsRef.current.delete(destSlot);
                }
            }
            onChanged(latest);
        },
        [clipboard, slots, cells, onChanged, pushHistory, applyClipboardCell],
    );

    const onPasteToMultiple = useCallback(
        async (targetSlots: string[]) => {
            if (null === clipboard || 0 === clipboard.cells.length) return;
            const cell = clipboard.cells[0]!;
            pushHistory();
            let latest: SlotCell[] = cells;
            for (const slot of targetSlots) {
                if (pendingSlotsRef.current.has(slot)) continue;
                pendingSlotsRef.current.add(slot);
                try {
                    const r = await applyClipboardCell(slot, cell);
                    if (r) latest = r;
                } catch { /* */ } finally {
                    pendingSlotsRef.current.delete(slot);
                }
            }
            onChanged(latest);
        },
        [clipboard, cells, onChanged, pushHistory, applyClipboardCell],
    );

    const onCut = useCallback(async () => {
        onCopy();
        await onClearRange(selectedSlots);
    }, [onCopy, onClearRange, selectedSlots]);

    const onDropFavorite = useCallback((slot: string) => { void onPaste(slot); }, [onPaste]);

    const onContextMenuOpen = useCallback(
        (slot: string) => { if (!selectedSlots.has(slot)) selectSingle(slot); },
        [selectedSlots, selectSingle],
    );

    // ── Raccourcis clavier ───────────────────────────────────────────────
    const selKeyRef = useRef<((e: KeyboardEvent) => void) | null>(null);
    selKeyRef.current = (e: KeyboardEvent) => {
        if (0 === selectedSlots.size) return;
        const active = document.activeElement;
        if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
        const ctrl = e.metaKey || e.ctrlKey;
        if (ctrl && 'c' === e.key) { e.preventDefault(); onCopy(); }
        else if (ctrl && 'x' === e.key) { e.preventDefault(); void onCut(); }
        else if (ctrl && 'v' === e.key) {
            e.preventDefault();
            if (selectedSlots.size > 1 && clipboard?.cells.length === 1) void onPasteToMultiple([...selectedSlots]);
            else if (selectedSlots.size > 1) onNeedsPasteWarning?.();
            else { const t = anchorSlot ?? [...selectedSlots][0]; if (t) void onPaste(t); }
        } else if ('Delete' === e.key || 'Backspace' === e.key) { e.preventDefault(); void onClearRange(selectedSlots); }
        else if ('ArrowUp' === e.key || 'ArrowDown' === e.key) {
            e.preventDefault();
            const cur = activeSlot ?? anchorSlot ?? [...selectedSlots][0];
            if (!cur) return;
            const idx = slots.indexOf(cur);
            const nextIdx = 'ArrowUp' === e.key ? idx - 1 : idx + 1;
            if (nextIdx < 0 || nextIdx >= slots.length) return;
            const nextSlot = slots[nextIdx] as string;
            if (e.shiftKey) extendToSlot(nextSlot);
            else selectSingle(nextSlot);
        } else if ('Escape' === e.key) { e.preventDefault(); clearSelection(); }
    };
    useEffect(() => {
        function handler(e: KeyboardEvent) { selKeyRef.current?.(e); }
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, []);

    const undoKeyRef = useRef<((e: KeyboardEvent) => void) | null>(null);
    undoKeyRef.current = (e: KeyboardEvent) => {
        const active = document.activeElement;
        if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
        const ctrl = e.metaKey || e.ctrlKey;
        if (!ctrl) return;
        if ('z' === e.key && !e.shiftKey) { e.preventDefault(); void handleUndo(); }
        else if (('z' === e.key && e.shiftKey) || 'y' === e.key) { e.preventDefault(); void handleRedo(); }
    };
    useEffect(() => {
        function handler(e: KeyboardEvent) { undoKeyRef.current?.(e); }
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, []);

    return {
        selectedSlots,
        isDragging,
        hasClipboard: null !== clipboard && clipboard.cells.length > 0,
        entryMap,
        onSelect,
        onCellMouseDown,
        onDragExtend,
        onContextMenuOpen,
        onCopy,
        onCut,
        onPaste,
        onClearRange,
        onConvertToBreak,
        onDropFavorite,
        save,
        fillRange,
        clearHistory,
        clearSelection,
        consumeDragMoved,
    };
}
