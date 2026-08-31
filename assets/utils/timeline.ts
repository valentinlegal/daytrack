import type { TimeEntry, WorkDay } from '@/types/api';
import { EntryType } from '@/types/api';

export const TIMELINE_START_HOUR = 7;
export const TIMELINE_END_HOUR = 20;
export const SLOT_MINUTES = 15;
export const MAX_DAYS_AHEAD = 30;

/** Hauteur en pixels d'un créneau de 15 min dans les grilles (timeline jour + grille Modèles) */
export const SLOT_PX = 36;

/** Objectif journalier par défaut en minutes (7h30) — aligné sur WorkDay::$targetMinutes côté back */
export const DEFAULT_TARGET_MINUTES = 450;

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

// Formate un nombre de minutes en chaîne lisible (ex: 450 → "7h30", 15 → "15min", -30 → "-30min")
export function formatMinutes(minutes: number): string {
    const h = Math.floor(Math.abs(minutes) / 60);
    const m = Math.abs(minutes) % 60;
    const sign = minutes < 0 ? '-' : '';
    if (h === 0) return `${sign}${m}min`;
    return m === 0 ? `${sign}${h}h` : `${sign}${h}h${String(m).padStart(2, '0')}`;
}

// Arrondit au quart d'heure le plus proche (ex: 46 → 45, 52 → 60)
export function roundToQuarter(minutes: number): number {
    return Math.round(minutes / 15) * 15;
}

/** Interprète une saisie utilisateur en minutes (ex: "7h30" → 450, "7:30" → 450, "7.5" → 450, "8" → 480) */
export function parseTarget(value: string): number | null {
    let raw: number | null = null;

    const hm = value.trim().match(/^(\d+)h(\d{1,2})?$/i);
    if (hm) raw = parseInt(hm[1]) * 60 + (hm[2] ? parseInt(hm[2]) : 0);

    const colon = value.trim().match(/^(\d+):(\d{2})$/);
    if (colon) raw = parseInt(colon[1]) * 60 + parseInt(colon[2]);

    const decimal = value.trim().match(/^(\d+(?:[.,]\d+)?)$/);
    if (decimal) raw = Math.round(parseFloat(decimal[1].replace(',', '.')) * 60);

    if (raw === null) return null;
    const rounded = roundToQuarter(raw);
    // 0 est autorisé (week-end, jour férié, congé).
    return rounded >= 0 && rounded <= 1440 ? rounded : null;
}

/** Retourne l'heure actuelle en minutes depuis minuit */
export function getCurrentMinutes(): number {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
}

/** Calcule l'heure de fin estimée pour aujourd'hui si le solde est négatif */
export function computeEstimatedEnd(workDay: WorkDay): string | null {
    if (workDay.balanceMinutes >= 0) return null;
    if (workDay.date !== today()) return null;

    const nowFloor = Math.floor(getCurrentMinutes() / 15) * 15;
    const remaining = -workDay.balanceMinutes;

    const futureWorked = workDay.entries.reduce((sum, e) => {
        if (null === e.endedAt) return sum;
        const [h, m] = e.endedAt.split(':').map(Number);
        const end = h * 60 + m;
        return end > nowFloor ? sum + (e.durationMinutes ?? 0) : sum;
    }, 0);

    const estimatedMinutes = nowFloor + remaining + futureWorked;
    if (estimatedMinutes >= 24 * 60) return '> 23:59';
    return `${String(Math.floor(estimatedMinutes / 60)).padStart(2, '0')}:${String(estimatedMinutes % 60).padStart(2, '0')}`;
}

export interface TicketRecapEntry {
    ticketKey: string;
    ticketSummary: string | null;
    ticketType: string | null;
    totalMinutes: number;
    comments: string[];
    hasUncommentedEntries: boolean;
}

/** Groupe les entrées WORK par ticketKey et calcule les totaux */
export function computeTicketRecap(entries: TimeEntry[]): TicketRecapEntry[] {
    const map = new Map<string, TicketRecapEntry>();

    for (const entry of entries) {
        if (entry.type !== EntryType.WORK || !entry.ticketKey) continue;

        const key = entry.ticketKey;
        if (!map.has(key)) {
            map.set(key, {
                ticketKey: key,
                ticketSummary: entry.ticketSummary ?? null,
                ticketType: entry.ticketType ?? null,
                totalMinutes: 0,
                comments: [],
                hasUncommentedEntries: false,
            });
        }

        const rec = map.get(key)!;
        rec.totalMinutes += entry.durationMinutes ?? 0;

        const comment = entry.comment?.trim();
        if (comment) {
            if (!rec.comments.includes(comment)) rec.comments.push(comment);
        } else {
            rec.hasUncommentedEntries = true;
        }
    }

    return Array.from(map.values()).sort((a, b) => b.totalMinutes - a.totalMinutes);
}

/** Formate une date ISO en heure locale HH:mm */
export function formatIsoTime(isoString: string): string {
    const d = new Date(isoString);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
