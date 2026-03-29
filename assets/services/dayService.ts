import { t } from '../i18n/fr';
import type { CreateEntryPayload, UpdateEntryPayload, WorkDay } from '../types/api';

const API_BASE = '/api';

// Récupère ou crée une journée de travail pour la date donnée
export async function fetchWorkDay(date: string): Promise<WorkDay> {
    const res = await fetch(`${API_BASE}/days/${date}`);
    if (!res.ok) throw new Error(t('error.load_day'));
    return res.json() as Promise<WorkDay>;
}

// Crée une entrée de temps et retourne la journée mise à jour
export async function createEntry(date: string, payload: CreateEntryPayload): Promise<WorkDay> {
    const res = await fetch(`${API_BASE}/days/${date}/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(t('error.create_entry'));
    return res.json() as Promise<WorkDay>;
}

// Met à jour une entrée existante et retourne la journée mise à jour
export async function updateEntry(date: string, entryId: string, payload: UpdateEntryPayload): Promise<WorkDay> {
    const res = await fetch(`${API_BASE}/days/${date}/entries/${entryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(t('error.update_entry'));
    return res.json() as Promise<WorkDay>;
}

// Met à jour l'objectif de la journée et retourne la journée mise à jour
export async function updateDayTarget(date: string, targetMinutes: number): Promise<WorkDay> {
    const res = await fetch(`${API_BASE}/days/${date}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetMinutes }),
    });
    if (!res.ok) throw new Error(t('error.update_day'));
    return res.json() as Promise<WorkDay>;
}

// Supprime une entrée et retourne la journée rechargée
export async function deleteEntry(date: string, entryId: string): Promise<WorkDay> {
    const res = await fetch(`${API_BASE}/days/${date}/entries/${entryId}`, {
        method: 'DELETE',
    });
    if (!res.ok) throw new Error(t('error.delete_entry'));
    return fetchWorkDay(date);
}