import { useEffect, useRef, useState } from 'react';
import { EntryType } from '../types/api';
import type { TimeEntry, WorkDay } from '../types/api';
import { TIMELINE_START_HOUR, buildEntryMap, generateTimeSlots, getNextSlot, isHourSlot, today } from '../utils/timeline';
import { createEntry, deleteEntry, updateEntry } from '../services/dayService';
import TimeBlock from './TimeBlock';
import { t } from '../i18n/fr';

interface TimelineProps {
    workDay: WorkDay;
    onWorkDayUpdate: (workDay: WorkDay) => void;
}

const TIME_SLOTS = generateTimeSlots();

// Retourne le créneau et l'offset exact dans ce créneau à partir d'un instant donné
function getNowPosition(date: Date): { slot: string; offsetPercent: number } {
    const h = date.getHours();
    const m = date.getMinutes();
    const slotMinutes = Math.floor(m / 15) * 15;
    const slot = `${String(h).padStart(2, '0')}:${String(slotMinutes).padStart(2, '0')}`;
    const offsetPercent = (m % 15) / 15 * 100;
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

    // Sélection multi-cellule : ensemble des créneaux sélectionnés, ancre fixe et curseur actif (mobile)
    const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());
    const [anchorSlot, setAnchorSlot] = useState<string | null>(null);
    const [activeSlot, setActiveSlot] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    // Indique qu'un drag a réellement déplacé la sélection (pour supprimer le click parasite post-drag)
    const dragMovedRef = useRef(false);

    const [undoStack, setUndoStack] = useState<WorkDay[]>([]);
    const [redoStack, setRedoStack] = useState<WorkDay[]>([]);

    // Format du presse-papier : bloc de cellules avec offsets relatifs au premier créneau copié
    interface ClipboardCell {
        offset: number;
        ticketKey: string | null;
        comment: string | null;
        type: EntryType;
        isEmpty: boolean; // true si la cellule était vide lors de la copie
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

    // Rafraîchit l'indicateur "maintenant" à chaque passage de minute
    useEffect(() => {
        const msUntilNextMinute = (60 * 1000) - (Date.now() % (60 * 1000));
        const id = setTimeout(() => setTick((t) => t + 1), msUntilNextMinute);
        return () => clearTimeout(id);
    }, [tick]);

    // Charge l'historique undo/redo depuis la session pour ce jour (ou réinitialise si absent)
    useEffect(() => {
        try {
            const storedUndo = sessionStorage.getItem(`daytrack_undo_${workDay.date}`);
            setUndoStack(storedUndo ? JSON.parse(storedUndo) as WorkDay[] : []);
        } catch {
            setUndoStack([]);
        }
        try {
            const storedRedo = sessionStorage.getItem(`daytrack_redo_${workDay.date}`);
            setRedoStack(storedRedo ? JSON.parse(storedRedo) as WorkDay[] : []);
        } catch {
            setRedoStack([]);
        }
    }, [workDay.date]);

    // Restaure la position de scroll mémorisée pour ce jour
    useEffect(() => {
        const el = scrollRef.current;
        if (null === el) return;
        const saved = sessionStorage.getItem('daytrack_scroll');
        if (null !== saved) {
            el.scrollTop = parseInt(saved, 10);
        } else {
            el.scrollTop = 0;
        }
    }, [workDay.date]);

    const isToday = workDay.date === today();
    // Un seul new Date() pour slot et offset — évite toute désynchronisation à la frontière d'une minute
    const { slot: nowSlot, offsetPercent: nowOffsetPercent } = isToday
        ? getNowPosition(new Date())
        : { slot: null, offsetPercent: 0 };

    const entryMap = buildEntryMap(workDay.entries);

    // -------------------------------------------------------------------------
    // Sélection
    // -------------------------------------------------------------------------

    function selectSingle(slot: string) {
        setSelectedSlots(new Set([slot]));
        setAnchorSlot(slot);
        setActiveSlot(slot);
    }

    /** Étend la sélection de l'ancre jusqu'à `to` (l'ancre reste fixe) */
    function extendToSlot(to: string) {
        const anchor = anchorSlot ?? to;
        setSelectedSlots(new Set(getSlotRange(anchor, to)));
        setActiveSlot(to);
    }

    /** Toggle individuel d'un créneau (Ctrl+Clic) */
    function toggleSlot(slot: string) {
        setSelectedSlots(prev => {
            const next = new Set(prev);
            if (next.has(slot)) {
                next.delete(slot);
            } else {
                next.add(slot);
            }
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
        if (e.shiftKey && anchorSlot) {
            extendToSlot(slot);
        } else if (e.ctrlKey || e.metaKey) {
            toggleSlot(slot);
        } else {
            selectSingle(slot);
        }
    }

    // -------------------------------------------------------------------------
    // Drag (sélection via clic + glisser)
    // -------------------------------------------------------------------------

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

    // Fin du drag au relâchement de la souris (global)
    useEffect(() => {
        if (!isDragging) return;

        function onMouseUp() {
            setIsDragging(false);
        }

        document.addEventListener('mouseup', onMouseUp);
        return () => document.removeEventListener('mouseup', onMouseUp);
    }, [isDragging]);

    // Auto-scroll pendant le drag si la souris approche des bords du conteneur
    useEffect(() => {
        if (!isDragging) return;

        let lastY = 0;
        let frameId: number;

        function onMouseMove(e: MouseEvent) {
            lastY = e.clientY;
        }

        function scrollTick() {
            const el = scrollRef.current;
            if (el) {
                const rect = el.getBoundingClientRect();
                const threshold = 60;
                if (lastY > rect.top && lastY < rect.top + threshold) {
                    el.scrollTop -= 6;
                } else if (lastY < rect.bottom && lastY > rect.bottom - threshold) {
                    el.scrollTop += 6;
                }
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

    // -------------------------------------------------------------------------
    // Historique undo/redo
    // -------------------------------------------------------------------------

    /** Pousse l'état courant dans la pile undo, efface le redo et persiste en session */
    function pushHistory() {
        const newUndoStack = [...undoStack.slice(-49), workDay];
        setUndoStack(newUndoStack);
        setRedoStack([]);
        sessionStorage.setItem(`daytrack_undo_${workDay.date}`, JSON.stringify(newUndoStack));
        sessionStorage.setItem(`daytrack_redo_${workDay.date}`, JSON.stringify([]));
    }

    /**
     * Réconcilie l'état courant avec un snapshot cible.
     * En pratique, une seule entrée diffère à la fois pour les opérations unitaires ;
     * plusieurs peuvent différer pour les opérations bulk (après undo/redo).
     */
    async function reconcileWorkDay(target: WorkDay) {
        const currentMap = buildEntryMap(workDay.entries);
        const targetMap = buildEntryMap(target.entries);
        let updated: WorkDay = workDay;

        // Entrées à supprimer (présentes dans le courant mais absentes de la cible)
        for (const [, currentEntry] of currentMap) {
            if (!targetMap.has(currentEntry.startedAt)) {
                updated = await deleteEntry(target.date, currentEntry.id);
            }
        }

        // Entrées à créer (présentes dans la cible mais absentes du courant)
        for (const [, targetEntry] of targetMap) {
            if (!currentMap.has(targetEntry.startedAt)) {
                updated = await createEntry(target.date, {
                    startedAt: targetEntry.startedAt,
                    endedAt: targetEntry.endedAt ?? getNextSlot(targetEntry.startedAt),
                    ticketKey: targetEntry.ticketKey,
                    type: targetEntry.type,
                    comment: targetEntry.comment,
                });
            }
        }

        // Entrées à mettre à jour (présentes dans les deux mais avec un contenu différent)
        for (const [, targetEntry] of targetMap) {
            const current = currentMap.get(targetEntry.startedAt);
            if (current && (current.ticketKey !== targetEntry.ticketKey || current.type !== targetEntry.type || current.comment !== targetEntry.comment)) {
                updated = await updateEntry(target.date, current.id, {
                    ticketKey: targetEntry.ticketKey,
                    type: targetEntry.type,
                    comment: targetEntry.comment,
                });
            }
        }

        onWorkDayUpdate(updated);
    }

    async function handleUndo() {
        const snapshot = undoStack[undoStack.length - 1];
        if (!snapshot) return;
        setEditingSlot(null);
        const newUndoStack = undoStack.slice(0, -1);
        const newRedoStack = [...redoStack, workDay];
        setUndoStack(newUndoStack);
        setRedoStack(newRedoStack);
        sessionStorage.setItem(`daytrack_undo_${workDay.date}`, JSON.stringify(newUndoStack));
        sessionStorage.setItem(`daytrack_redo_${workDay.date}`, JSON.stringify(newRedoStack));
        try {
            await reconcileWorkDay(snapshot);
        } catch {
            // L'erreur est déjà traduite par le service
        }
    }

    async function handleRedo() {
        const snapshot = redoStack[redoStack.length - 1];
        if (!snapshot) return;
        setEditingSlot(null);
        const newUndoStack = [...undoStack, workDay];
        const newRedoStack = redoStack.slice(0, -1);
        setUndoStack(newUndoStack);
        setRedoStack(newRedoStack);
        sessionStorage.setItem(`daytrack_undo_${workDay.date}`, JSON.stringify(newUndoStack));
        sessionStorage.setItem(`daytrack_redo_${workDay.date}`, JSON.stringify(newRedoStack));
        try {
            await reconcileWorkDay(snapshot);
        } catch {
            // L'erreur est déjà traduite par le service
        }
    }

    // -------------------------------------------------------------------------
    // Opération sur une cellule (depuis l'éditeur inline, 1 snapshot par appel)
    // -------------------------------------------------------------------------

    async function handleSave(slot: string, ticketKey: string | null, type: EntryType, comment: string | null) {
        const existing = entryMap.get(slot);

        try {
            let updated: WorkDay;

            if (existing) {
                // Aucune modification détectée : on n'appelle pas l'API
                if (existing.type === type && existing.ticketKey === ticketKey && existing.comment === comment) {
                    setEditingSlot(null);
                    return;
                }
                pushHistory();
                // Mise à jour d'une entrée existante
                updated = await updateEntry(workDay.date, existing.id, {
                    ticketKey,
                    type,
                    comment,
                });
            } else {
                pushHistory();
                // Création d'une nouvelle entrée pour ce créneau
                updated = await createEntry(workDay.date, {
                    startedAt: slot,
                    endedAt: getNextSlot(slot),
                    ticketKey,
                    type,
                    comment,
                });
            }

            onWorkDayUpdate(updated);
        } catch {
            // L'erreur est déjà traduite par le service
        } finally {
            setEditingSlot(null);
        }
    }

    // -------------------------------------------------------------------------
    // Opérations bulk (selection entière, un seul snapshot pour tout le lot)
    // -------------------------------------------------------------------------

    async function handleBulkClear(slots: Set<string>) {
        const toDelete = [...slots].map(s => entryMap.get(s)).filter(Boolean) as TimeEntry[];
        if (0 === toDelete.length) return;
        pushHistory();
        for (const entry of toDelete) {
            try {
                const updated = await deleteEntry(workDay.date, entry.id);
                onWorkDayUpdate(updated);
            } catch {
                // L'erreur est déjà traduite par le service
            }
        }
    }

    async function handleBulkConvertToBreak(slots: Set<string>) {
        const toConvert = [...slots]
            .map(s => entryMap.get(s))
            .filter((e): e is TimeEntry => !!e && e.type !== EntryType.BREAK);
        if (0 === toConvert.length) return;
        pushHistory();
        for (const entry of toConvert) {
            try {
                const updated = await updateEntry(workDay.date, entry.id, {
                    type: EntryType.BREAK,
                    ticketKey: null,
                    comment: null,
                });
                onWorkDayUpdate(updated);
            } catch {
                // L'erreur est déjà traduite par le service
            }
        }
        setEditingSlot(null);
    }

    // -------------------------------------------------------------------------
    // Presse-papier
    // -------------------------------------------------------------------------

    /** Copie la sélection entière comme un bloc (ordre et espacement entre créneaux préservés) */
    function handleCopySelection() {
        const sorted = [...selectedSlots].sort();
        if (0 === sorted.length) return;
        const anchorIdx = TIME_SLOTS.indexOf(sorted[0] as string);
        const cells: ClipboardCell[] = sorted.map(slot => {
            const idx = TIME_SLOTS.indexOf(slot);
            const entry = entryMap.get(slot) ?? null;
            return {
                offset: idx - anchorIdx,
                ticketKey: entry?.ticketKey ?? null,
                comment: entry?.comment ?? null,
                type: entry?.type ?? EntryType.WORK,
                isEmpty: null === entry,
            };
        });
        const value: ClipboardData = { cells };
        setClipboard(value);
        sessionStorage.setItem('daytrack_clipboard', JSON.stringify(value));
    }

    /** Colle le bloc du presse-papier à partir du créneau cible (tronque silencieusement si débordement) */
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
                    // Cellule vide copiée : effacer l'entrée destination si elle existe
                    if (existing) {
                        const updated = await deleteEntry(workDay.date, existing.id);
                        onWorkDayUpdate(updated);
                    }
                } else {
                    let updated: WorkDay;
                    if (existing) {
                        updated = await updateEntry(workDay.date, existing.id, {
                            ticketKey: cell.ticketKey,
                            type: cell.type,
                            comment: cell.comment,
                        });
                    } else {
                        updated = await createEntry(workDay.date, {
                            startedAt: destSlot,
                            endedAt: getNextSlot(destSlot),
                            ticketKey: cell.ticketKey,
                            type: cell.type,
                            comment: cell.comment,
                        });
                    }
                    onWorkDayUpdate(updated);
                }
            } catch {
                // L'erreur est déjà traduite par le service
            }
        }
    }

    // -------------------------------------------------------------------------
    // Effets clavier et déselection
    // -------------------------------------------------------------------------

    // Désélectionne sur tout clic en dehors du conteneur scroll
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

    // Ref pour les handlers clavier — toujours à jour, enregistrés une seule fois (évite les stale closures)
    const selectionKeyHandlerRef = useRef<((e: KeyboardEvent) => void) | null>(null);
    selectionKeyHandlerRef.current = (e: KeyboardEvent) => {
        if (0 === selectedSlots.size || null !== editingSlot) return;
        const ctrlOrCmd = e.metaKey || e.ctrlKey;

        if (ctrlOrCmd && 'c' === e.key) {
            e.preventDefault();
            handleCopySelection();
        } else if (ctrlOrCmd && 'v' === e.key) {
            e.preventDefault();
            if (selectedSlots.size > 1) {
                setShowPasteWarning(true);
            } else {
                const target = anchorSlot ?? [...selectedSlots][0];
                if (target) void handlePaste(target);
            }
        } else if ('Delete' === e.key || 'Backspace' === e.key) {
            e.preventDefault();
            void handleBulkClear(selectedSlots);
        } else if ('ArrowUp' === e.key || 'ArrowDown' === e.key) {
            e.preventDefault();
            const current = activeSlot ?? anchorSlot ?? [...selectedSlots][0];
            if (!current) return;
            const idx = TIME_SLOTS.indexOf(current);
            const nextIdx = 'ArrowUp' === e.key ? idx - 1 : idx + 1;
            if (nextIdx < 0 || nextIdx >= TIME_SLOTS.length) return;
            const nextSlot = TIME_SLOTS[nextIdx] as string;
            if (e.shiftKey) {
                extendToSlot(nextSlot);
            } else {
                selectSingle(nextSlot);
            }
        } else if ('Escape' === e.key) {
            e.preventDefault();
            clearSelection();
        }
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
        const ctrlOrCmd = e.metaKey || e.ctrlKey;
        if (!ctrlOrCmd) return;

        if ('z' === e.key && !e.shiftKey) {
            e.preventDefault();
            void handleUndo();
        } else if (('z' === e.key && e.shiftKey) || 'y' === e.key) {
            e.preventDefault();
            void handleRedo();
        }
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
        {showPasteWarning && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowPasteWarning(false)}>
                <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
                    <p className="text-sm text-gray-700 mb-4">{t('timeline.paste_multiselection_warning')}</p>
                    <div className="flex justify-end">
                        <button
                            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
                            onClick={() => setShowPasteWarning(false)}
                        >
                            {t('timeline.close')}
                        </button>
                    </div>
                </div>
            </div>
        )}
        <div ref={scrollRef} className="flex-1 overflow-y-auto" onScroll={handleScroll} onClick={() => {
            // Le drag déclenche un click sur l'ancêtre commun mousedown/mouseup — on l'ignore
            if (dragMovedRef.current) { dragMovedRef.current = false; return; }
            clearSelection();
        }}>
            {TIME_SLOTS.map((slot) => {
                const entry = entryMap.get(slot) ?? null;
                // Sélection effective pour les actions du menu contextuel :
                // si la cellule est dans la sélection, toute la sélection est concernée ;
                // sinon (clic droit sur une cellule hors sélection), onContextMenuOpen la sélectionnera d'abord
                const effectiveSelection = selectedSlots.has(slot) && selectedSlots.size > 1
                    ? selectedSlots
                    : new Set([slot]);

                return (
                    <div key={slot} className={`relative flex items-stretch ${isHourSlot(slot) && !slot.startsWith(String(TIMELINE_START_HOUR).padStart(2, '0')) ? 'border-t-2 border-gray-200' : ''}`}>
                        {/* Colonne heure — affichée uniquement sur les heures rondes */}
                        <div className="w-12 shrink-0 flex items-center justify-end pr-2">
                            {isHourSlot(slot) && (
                                <span className="text-xs font-semibold text-gray-500 font-mono">{slot}</span>
                            )}
                        </div>

                        {/* Colonne plage horaire — affiche le créneau de 15 min */}
                        <div className="w-24 shrink-0 flex items-center pr-2">
                            <span className="text-xs text-gray-400 font-mono">{slot}–{getNextSlot(slot)}</span>
                        </div>

                        {slot === nowSlot && <NowIndicator offsetPercent={nowOffsetPercent} />}

                        {/* Bloc de 15 minutes */}
                        <div className="flex-1">
                            <TimeBlock
                                slot={slot}
                                entry={entry}
                                isEditing={editingSlot === slot}
                                isSelected={selectedSlots.has(slot)}
                                noBottomBorder={slot.endsWith(':45')}
                                hasClipboard={null !== clipboard && clipboard.cells.length > 0}
                                onSelect={(e) => handleSelect(slot, e)}
                                onStartEdit={() => setEditingSlot(slot)}
                                onSave={(ticketKey, type, comment) => void handleSave(slot, ticketKey, type, comment)}
                                onCancel={() => setEditingSlot(null)}
                                onCopy={() => handleCopySelection()}
                                onPaste={() => void handlePaste(slot)}
                                onClear={() => void handleBulkClear(effectiveSelection)}
                                onConvertToBreak={() => void handleBulkConvertToBreak(effectiveSelection)}
                                onContextMenuOpen={() => {
                                    // Clic droit sur une cellule hors sélection : sélectionne cette cellule seule
                                    if (!selectedSlots.has(slot)) {
                                        selectSingle(slot);
                                    }
                                }}
                                onCellMouseDown={(e) => {
                                    if (0 !== e.button) return; // clic gauche uniquement
                                    if (e.shiftKey || e.ctrlKey || e.metaKey) return; // laisser onClick gérer les modificateurs
                                    e.preventDefault(); // empêche la sélection de texte pendant le drag
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
function NowIndicator({ offsetPercent }: { offsetPercent: number }) {
    return (
        <div
            className="absolute left-36 right-0 flex items-center pointer-events-none z-10 -translate-y-1/2"
            style={{ top: `${offsetPercent}%` }}
        >
            <div className="w-3 h-3 rounded-full bg-red-600 shrink-0 -ml-1.5" />
            <div className="flex-1 h-0.5 bg-red-600" />
        </div>
    );
}
