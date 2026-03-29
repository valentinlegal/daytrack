import { useState } from 'react';
import { EntryType } from '../types/api';
import type { TimeEntry, WorkDay } from '../types/api';
import { buildEntryMap, generateTimeSlots, getNextSlot, isHourSlot } from '../utils/timeline';
import { createEntry, deleteEntry, updateEntry } from '../services/dayService';
import TimeBlock from './TimeBlock';

interface TimelineProps {
    workDay: WorkDay;
    onWorkDayUpdate: (workDay: WorkDay) => void;
}

const TIME_SLOTS = generateTimeSlots();

export default function Timeline({ workDay, onWorkDayUpdate }: TimelineProps) {
    const [editingSlot, setEditingSlot] = useState<string | null>(null);
    const [clipboard, setClipboard] = useState<{ ticketKey: string | null; comment: string | null; type: EntryType } | null>(null);

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
        setClipboard({ ticketKey: entry.ticketKey, comment: entry.comment, type: entry.type });
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
                    <div key={slot} className="flex items-stretch">
                        {/* Colonne heure — affichée uniquement sur les heures rondes */}
                        <div className="w-12 shrink-0 flex items-start justify-end pr-2 pt-0.5">
                            {isHourSlot(slot) && (
                                <span className="text-xs font-semibold text-gray-500 font-mono">{slot}</span>
                            )}
                        </div>

                        {/* Colonne plage horaire — affiche le créneau de 15 min */}
                        <div className="w-24 shrink-0 flex items-center pr-2">
                            <span className="text-xs text-gray-400 font-mono">{slot}–{getNextSlot(slot)}</span>
                        </div>

                        {/* Bloc de 15 minutes */}
                        <div className="flex-1">
                            <TimeBlock
                                slot={slot}
                                entry={entry}
                                isEditing={editingSlot === slot}
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