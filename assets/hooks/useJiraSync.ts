import { useEffect, useState } from 'react';
import type { WorkDay } from '@/types/api';
import { EntryType } from '@/types/api';
import { syncDay } from '@/services/jiraService';
import { t } from '@/i18n/fr';
import { fireConfettiFromElement, type FireConfettiOptions } from '@/utils/confetti';

export type JiraSyncStatus = 'idle' | 'syncing' | 'success' | 'error';

export interface JiraSyncState {
    syncStatus: JiraSyncStatus;
    feedback: string | null;
    errorDetails: Record<string, string>;
    isSynced: boolean;
    syncable: boolean;
    isDirty: boolean;
    confirmSync: (triggerElement: HTMLElement | null, confettiOptions?: FireConfettiOptions) => Promise<void>;
}

/** Vérifie si la journée contient des entrées synchronisables (WORK + ticket + durée) */
function hasSyncableEntries(workDay: WorkDay): boolean {
    return workDay.entries.some(
        (e) => e.type === EntryType.WORK && null !== e.ticketKey && null !== e.endedAt,
    );
}

/** Calcule une empreinte légère des entrées synchronisables pour détecter les modifications post-sync */
function entriesFingerprint(workDay: WorkDay): string {
    return workDay.entries
        .filter(e => e.type === EntryType.WORK && null !== e.ticketKey && null !== e.endedAt)
        .map(e => `${e.id}:${e.endedAt}`)
        .sort()
        .join('|');
}

/** Clé sessionStorage pour le fingerprint de sync d'une journée donnée */
function syncFpKey(date: string) { return `daytrack_jira_fp_${date}`; }

/**
 * État et logique de synchronisation JIRA pour une journée. Un seul appel de ce hook dans le
 * composant parent commun (TimelinePage), partagé via props entre les deux points d'affichage du
 * bouton de sync (icône AppHeader + panel SummaryDrawer) — évite que les deux instances divergent
 * (statut, message d'erreur) puisqu'elles représentent la même opération de sync pour la journée.
 */
export function useJiraSync(
    workDay: WorkDay | null,
    onWorkDayUpdate: (workDay: WorkDay) => void,
): JiraSyncState {
    const [syncStatus, setSyncStatus] = useState<JiraSyncStatus>('idle');
    const [feedback, setFeedback] = useState<string | null>(null);
    const [errorDetails, setErrorDetails] = useState<Record<string, string>>({});

    // Au changement de journée : réinitialise l'état transitoire de sync
    useEffect(() => {
        setSyncStatus('idle');
        setFeedback(null);
        setErrorDetails({});
    }, [workDay?.date]);

    const isSynced = null !== workDay && null !== workDay.jiraSyncedAt;
    const syncable = null !== workDay && hasSyncableEntries(workDay);
    const storedFingerprint = workDay ? sessionStorage.getItem(syncFpKey(workDay.date)) : null;
    const isDirty = null !== workDay
        && null !== storedFingerprint
        && entriesFingerprint(workDay) !== storedFingerprint;

    async function confirmSync(triggerElement: HTMLElement | null, confettiOptions?: FireConfettiOptions): Promise<void> {
        if (null === workDay) return;

        setSyncStatus('syncing');
        setFeedback(null);
        setErrorDetails({});

        try {
            const result = await syncDay(workDay.date);

            if (Object.keys(result.errors).length > 0) {
                setSyncStatus('error');
                setErrorDetails(result.errors);
                setFeedback(t('jira.feedback.partial_error'));
                onWorkDayUpdate(result.workDay);
            } else {
                const fp = entriesFingerprint(result.workDay);
                sessionStorage.setItem(syncFpKey(result.workDay.date), fp);
                setSyncStatus('success');
                if (result.syncedCount > 0) {
                    fireConfettiFromElement(triggerElement, confettiOptions);
                }
                setFeedback(
                    result.syncedCount > 0
                        ? t('jira.feedback.success').replace('{n}', String(result.syncedCount))
                        : t('jira.feedback.success_empty'),
                );
                onWorkDayUpdate(result.workDay);
                setTimeout(() => { setSyncStatus('idle'); setFeedback(null); }, 2000);
            }
        } catch (err) {
            setSyncStatus('error');
            setFeedback(err instanceof Error ? err.message : t('jira.error.sync_failed'));
        }
    }

    return { syncStatus, feedback, errorDetails, isSynced, syncable, isDirty, confirmSync };
}
