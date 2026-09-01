import type { EntryType } from '@/types/api';

const KEY = 'daytrack_clipboard';
const EVENT = 'daytrack:clipboard-changed';

export interface ClipboardCell {
    offset: number;
    ticketKey: string | null;
    ticketSummary: string | null;
    ticketType: string | null;
    comment: string | null;
    type: EntryType;
    isEmpty: boolean;
    /** Durée du bloc source en minutes. Absent = 1 créneau (15 min) — cas de la vue jour. */
    durationMinutes?: number;
}

export interface ClipboardData {
    cells: ClipboardCell[];
}

/** Lit le presse-papier partagé (jour + modèles). null si vide ou illisible. */
export function readClipboard(): ClipboardData | null {
    try {
        const stored = sessionStorage.getItem(KEY);
        return stored ? (JSON.parse(stored) as ClipboardData) : null;
    } catch {
        return null;
    }
}

/** Écrit le presse-papier partagé et notifie les autres grilles montées. */
export function writeClipboard(data: ClipboardData): void {
    try {
        sessionStorage.setItem(KEY, JSON.stringify(data));
    } catch {
        // sessionStorage plein ou indisponible — on continue sans persister
    }
    window.dispatchEvent(new Event(EVENT));
}

/** S'abonne aux changements du presse-papier. Retourne la fonction de désabonnement. */
export function subscribeClipboard(cb: () => void): () => void {
    window.addEventListener(EVENT, cb);
    return () => window.removeEventListener(EVENT, cb);
}
