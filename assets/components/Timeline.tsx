import { useEffect, useState } from 'react';
import { EntryType } from '../types/api';
import type { TimeEntry, WorkDay } from '../types/api';
import { TIMELINE_START_HOUR, buildEntryMap, generateTimeSlots, getNextSlot, isHourSlot, today } from '../utils/timeline';
import { createEntry, deleteEntry, updateEntry } from '../services/dayService';
import TimeBlock from './TimeBlock';

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

export default function Timeline({ workDay, onWorkDayUpdate }: TimelineProps) {
    const [editingSlot, setEditingSlot] = useState<string | null>(null);
    const [clipboard, setClipboard] = useState<{ ticketKey: string | null; comment: string | null; type: EntryType } | null>(() => {
        try {
            const stored = localStorage.getItem('daytrack_clipboard');
            return stored ? JSON.parse(stored) as { ticketKey: string | null; comment: string | null; type: EntryType } : null;
        } catch {
            return null;
        }
    });
    const [tick, setTick] = useState(0);

    // Rafraîchit l'indicateur "maintenant" à chaque passage de minute
    useEffect(() => {
        const msUntilNextMinute = (60 * 1000) - (Date.now() % (60 * 1000));
        const id = setTimeout(() => setTick((t) => t + 1), msUntilNextMinute);
        return () => clearTimeout(id);
    }, [tick]);

    const isToday = workDay.date === today();
    // Un seul new Date() pour slot et offset — évite toute désynchronisation à la frontière d'une minute
    const { slot: nowSlot, offsetPercent: nowOffsetPercent } = isToday
        ? getNowPosition(new Date())
        : { slot: null, offsetPercent: 0 };

    const entryMap = buildEntryMap(workDay.entries);

    async function handleSave(slot: string, ticketKey: string | null, type: EntryType, comment: string | null) {
        const existing = entryMap.get(slot);

        try {
            let updated: WorkDay;

            if (existing) {
                // Mise à jour d'une entrée existante
                updated = await updateEntry(workDay.date, existing.id, {
                    ticketKey,
                    type,
                    comment,
                });
            } else {
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

    async function handleClear(entry: TimeEntry) {
        try {
            const updated = await deleteEntry(workDay.date, entry.id);
            onWorkDayUpdate(updated);
        } catch {
            // L'erreur est déjà traduite par le service
        }
    }

    function handleCopy(entry: TimeEntry) {
        const value = { ticketKey: entry.ticketKey, comment: entry.comment, type: entry.type };
        setClipboard(value);
        localStorage.setItem('daytrack_clipboard', JSON.stringify(value));
    }

    async function handlePaste(slot: string) {
        if (null === clipboard) return;

        await handleSave(slot, clipboard.ticketKey, clipboard.type, clipboard.comment);
    }

    return (
        <div className="flex-1 overflow-y-auto">
            {TIME_SLOTS.map((slot) => {
                const entry = entryMap.get(slot) ?? null;

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
                                noBottomBorder={slot.endsWith(':45')}
                                clipboard={clipboard?.ticketKey ?? null}
                                onStartEdit={() => setEditingSlot(slot)}
                                onSave={(ticketKey, type, comment) => void handleSave(slot, ticketKey, type, comment)}
                                onCancel={() => setEditingSlot(null)}
                                onCopy={() => entry && handleCopy(entry)}
                                onPaste={() => void handlePaste(slot)}
                                onClear={() => entry && void handleClear(entry)}
                            />
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

/** Ligne rouge "maintenant" positionnée à l'heure exacte dans le créneau */
function NowIndicator({ offsetPercent }: { offsetPercent: number }) {
    return (
        <div
            className="absolute left-36 right-0 flex items-center pointer-events-none z-10 -translate-y-1/2"
            style={{ top: `${offsetPercent}%` }}
        >
            <div className="w-2 h-2 rounded-full bg-red-400 shrink-0 -ml-1" />
            <div className="flex-1 h-px bg-red-400" />
        </div>
    );
}
