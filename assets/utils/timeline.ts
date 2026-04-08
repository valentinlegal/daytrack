import type { TimeEntry } from '../types/api';

export const TIMELINE_START_HOUR = 7;
export const TIMELINE_END_HOUR = 20;
export const SLOT_MINUTES = 15;
export const MAX_DAYS_AHEAD = 30;

// Génère tous les créneaux de la journée (ex: ["08:00", "08:15", ...,"18:45"])
export function generateTimeSlots(): string[] {
    const slots: string[] = [];

    for (let h = TIMELINE_START_HOUR; h < TIMELINE_END_HOUR; h++) {
        for (let m = 0; m < 60; m += SLOT_MINUTES) {
            slots.push(formatTime(h, m));
        }
    }

    return slots;
}

// Retourne le créneau suivant (ex: "09:00" → "09:15")
export function getNextSlot(slot: string): string {
    const [h, m] = slot.split(':').map(Number);
    const totalMinutes = h * 60 + m + SLOT_MINUTES;
    return formatTime(Math.floor(totalMinutes / 60), totalMinutes % 60);
}

// Construit un index des entrées par leur heure de début
export function buildEntryMap(entries: TimeEntry[]): Map<string, TimeEntry> {
    return new Map(entries.map((e) => [e.startedAt, e]));
}

// Formate des heures/minutes en chaîne HH:mm
function formatTime(hours: number, minutes: number): string {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

// Indique si un créneau correspond à une heure ronde (ex: 09:00, 10:00...)
export function isHourSlot(slot: string): boolean {
    return slot.endsWith(':00');
}

// Formate une Date en YYYY-MM-DD selon l'heure locale
export function formatLocalDate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Retourne la date du jour au format YYYY-MM-DD
export function today(): string {
    return formatLocalDate(new Date());
}

// Décale une date YYYY-MM-DD d'un certain nombre de jours
export function shiftDate(date: string, days: number): string {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return formatLocalDate(d);
}

// Formate un nombre de minutes en chaîne lisible (ex: 450 → "7h30")
export function formatMinutes(minutes: number): string {
    const h = Math.floor(Math.abs(minutes) / 60);
    const m = Math.abs(minutes) % 60;
    const sign = minutes < 0 ? '-' : '';
    return m === 0 ? `${sign}${h}h` : `${sign}${h}h${String(m).padStart(2, '0')}`;
}
