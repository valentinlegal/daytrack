// Types correspondant aux réponses de l'API Symfony

export const EntryType = {
    WORK: 'work',
    BREAK: 'break',
} as const;

export type EntryType = typeof EntryType[keyof typeof EntryType];

export interface TimeEntry {
    id: string;
    ticketKey: string | null;
    ticketSummary: string | null;
    ticketType: string | null;
    comment: string | null;
    startedAt: string; // format HH:mm
    endedAt: string | null; // format HH:mm
    type: EntryType;
    durationMinutes: number | null;
}

export interface JiraTicketInfo {
    summary: string;
    type: string;
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
    ticketSummary?: string | null;
    ticketType?: string | null;
    comment?: string | null;
}

export interface UpdateEntryPayload {
    startedAt?: string;
    endedAt?: string;
    type?: EntryType;
    ticketKey?: string | null;
    ticketSummary?: string | null;
    ticketType?: string | null;
    comment?: string | null;
}

export interface FavoriteTicket {
    id: string;
    ticketKey: string;
    ticketSummary: string | null; // nom Jira original, figé à la création
    customName: string | null;   // étiquette personnalisée par l'utilisateur
    ticketType: string | null;
    position: number;
}

export interface VersionInfo {
    current: string;
    latest: string | null;
    updateAvailable: boolean;
}

// ── Templates de journée (règles récurrentes) ──────────────────────────────

export const TemplateRuleType = {
    WORK: 'work',
    BREAK: 'break',
    TARGET_OVERRIDE: 'target_override',
} as const;

export type TemplateRuleType = typeof TemplateRuleType[keyof typeof TemplateRuleType];

export interface TemplateRule {
    id: string;
    ruleType: TemplateRuleType;
    weekday: number;            // 1 = lundi … 7 = dimanche (ISO-8601)
    startTime: string | null;   // "HH:mm" — null pour TARGET_OVERRIDE
    durationMinutes: number | null; // null pour TARGET_OVERRIDE
    ticketKey: string | null;
    ticketSummary: string | null;
    ticketType: string | null;
    comment: string | null;
    targetMinutes: number | null; // uniquement TARGET_OVERRIDE
    intervalWeeks: number;      // 1 = toutes les semaines
    anchorDate: string;         // "YYYY-MM-DD"
    activeFrom: string;         // "YYYY-MM-DD" — figé à la création côté serveur
    activeUntil: string | null; // "YYYY-MM-DD"
    enabled: boolean;
    rotationGroupId: string | null;
    position: number;
}

export interface CreateTemplateRulePayload {
    ruleType: TemplateRuleType;
    weekday: number;
    startTime?: string | null;
    durationMinutes?: number | null;
    ticketKey?: string | null;
    ticketSummary?: string | null;
    ticketType?: string | null;
    comment?: string | null;
    targetMinutes?: number | null;
    intervalWeeks?: number;
    anchorDate?: string | null;
    activeUntil?: string | null;
    enabled?: boolean;
    rotationGroupId?: string | null;
}

// Le PUT backend est un patch partiel ; ruleType et rotationGroupId ne sont pas modifiables
// (voir src/Dto/Input/UpdateTemplateRuleInput.php). Pour changer l'un ou l'autre, supprimer +
// recréer la règle (fait dans les tâches 7 et 8).
export interface UpdateTemplateRulePayload {
    startTime?: string | null;
    durationMinutes?: number | null;
    ticketKey?: string | null;
    ticketSummary?: string | null;
    ticketType?: string | null;
    comment?: string | null;
    targetMinutes?: number | null;
    weekday?: number;
    intervalWeeks?: number;
    anchorDate?: string;
    activeUntil?: string | null;
    enabled?: boolean;
}