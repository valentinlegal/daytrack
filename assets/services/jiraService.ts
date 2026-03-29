import { t } from '../i18n/fr';
import type { JiraSyncResponse } from '../types/api';

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