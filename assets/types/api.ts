// Types correspondant aux réponses de l'API Symfony

export const EntryType = {
    WORK: 'work',
    BREAK: 'break',
} as const;

export type EntryType = typeof EntryType[keyof typeof EntryType];

export interface TimeEntry {
    id: string;
    ticketKey: string | null;
    comment: string | null;
    startedAt: string; // format HH:mm
    endedAt: string | null; // format HH:mm
    type: EntryType;
    durationMinutes: number | null;
}

export interface WorkDay {
    id: string;
    date: string; // format YYYY-MM-DD
    targetMinutes: number;
    workedMinutes: number;
    balanceMinutes: number;
    entries: TimeEntry[];
    jiraSyncedAt: string | null; // ISO 8601, null si jamais synchronisé ou modifié depuis
}

export interface JiraSyncResponse {
    workDay: WorkDay;
    syncedCount: number;
    deletedCount: number;
    errors: Record<string, string>; // clé = ticket, valeur = message d'erreur
}

export interface CreateEntryPayload {
    startedAt: string;
    endedAt: string;
    type: EntryType;
    ticketKey?: string | null;
    comment?: string | null;
}

export interface UpdateEntryPayload {
    startedAt?: string;
    endedAt?: string;
    type?: EntryType;
    ticketKey?: string | null;
    comment?: string | null;
}