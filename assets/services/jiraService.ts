import { t } from '../i18n/fr';
import type { JiraTicketInfo, JiraSyncResponse } from '../types/api';

const TICKET_CACHE_KEY = 'daytrack_ticket_cache';

// Retourne le cache en mémoire de session (ticketKey → info)
function getTicketCache(): Record<string, JiraTicketInfo> {
    try {
        const stored = sessionStorage.getItem(TICKET_CACHE_KEY);
        return stored ? (JSON.parse(stored) as Record<string, JiraTicketInfo>) : {};
    } catch {
        return {};
    }
}

function setTicketCache(cache: Record<string, JiraTicketInfo>): void {
    try {
        sessionStorage.setItem(TICKET_CACHE_KEY, JSON.stringify(cache));
    } catch {
        // sessionStorage plein ou indisponible — on continue sans cache
    }
}

/**
 * Retourne les infos d'un ticket depuis le cache local (synchrone, sans appel API).
 * Priorité : knownTickets (journée en cours) → sessionStorage.
 */
export function getCachedTicketInfo(
    ticketKey: string,
    knownTickets?: Record<string, JiraTicketInfo>,
): JiraTicketInfo | null {
    const key = ticketKey.toUpperCase();
    if (knownTickets?.[key]) return knownTickets[key];
    const cache = getTicketCache();
    return cache[key] ?? null;
}

/**
 * Récupère les informations d'un ticket Jira (titre, type).
 * Vérifie le cache sessionStorage avant d'appeler l'API.
 * - Retourne null silencieusement si Jira n'est pas configuré (pas d'erreur à afficher).
 * - Lève une Error si Jira est configuré mais que le ticket est introuvable ou l'API inaccessible.
 */
export async function fetchTicketInfo(
    ticketKey: string,
    knownTickets?: Record<string, JiraTicketInfo>,
): Promise<JiraTicketInfo | null> {
    if (!isJiraConfigured()) return null;

    const key = ticketKey.toUpperCase();

    // 1. Tickets déjà connus depuis la journée en cours (passés par Timeline)
    if (knownTickets?.[key]) return knownTickets[key];

    // 2. Cache sessionStorage
    const cache = getTicketCache();
    if (cache[key]) return cache[key];

    // 3. Appel API — propage l'erreur quand Jira est configuré
    const res = await fetch(`/api/jira/ticket/${encodeURIComponent(key)}`);
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? t('timeline.ticket_fetch_error'));
    }

    const info = (await res.json()) as JiraTicketInfo;
    setTicketCache({ ...cache, [key]: info });
    return info;
}

const API_BASE = '/api';

// Déclenche la synchronisation des saisies du jour vers JIRA
export async function syncDay(date: string): Promise<JiraSyncResponse> {
    const res = await fetch(`${API_BASE}/days/${date}/jira-sync`, {
        method: 'POST',
    });

    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? t('jira.error.sync_failed'));
    }

    return res.json() as Promise<JiraSyncResponse>;
}

// Lit la configuration JIRA depuis le data-attribute du point de montage React
export function isJiraConfigured(): boolean {
    const el = document.getElementById('app');
    return el?.dataset.jiraConfigured === 'true';
}