import { useState } from 'react';
import { t } from '../i18n/fr';
import type { WorkDay } from '../types/api';
import { EntryType } from '../types/api';
import { syncDay, isJiraConfigured } from '../services/jiraService';
import JiraSyncModal from './JiraSyncModal';

type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

interface JiraSyncButtonProps {
    workDay: WorkDay;
    onWorkDayUpdate: (workDay: WorkDay) => void;
}

// Vérifie si la journée contient des entrées synchronisables (WORK + ticket + durée)
function hasSyncableEntries(workDay: WorkDay): boolean {
    return workDay.entries.some(
        (e) => e.type === EntryType.WORK && null !== e.ticketKey && null !== e.endedAt,
    );
}

// Formate une date ISO en heure locale HH:mm
function formatSyncTime(isoString: string): string {
    const d = new Date(isoString);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function JiraSyncButton({ workDay, onWorkDayUpdate }: JiraSyncButtonProps) {
    const [showModal, setShowModal] = useState(false);
    const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
    const [feedback, setFeedback] = useState<string | null>(null);
    const [errorDetails, setErrorDetails] = useState<Record<string, string>>({});

    const jiraConfigured = isJiraConfigured();

    if (!jiraConfigured) {
        return null;
    }

    const isSynced = null !== workDay.jiraSyncedAt;
    const syncable = hasSyncableEntries(workDay);

    async function handleConfirm() {
        setShowModal(false);
        setSyncStatus('syncing');
        setFeedback(null);
        setErrorDetails({});

        try {
            const result = await syncDay(workDay.date);
            onWorkDayUpdate(result.workDay);

            if (Object.keys(result.errors).length > 0) {
                setSyncStatus('error');
                setErrorDetails(result.errors);
                setFeedback(t('jira.feedback.partial_error'));
            } else {
                setSyncStatus('success');
                setFeedback(
                    result.syncedCount > 0
                        ? t('jira.feedback.success').replace('{n}', String(result.syncedCount))
                        : t('jira.feedback.success_empty'),
                );
                setTimeout(() => { setSyncStatus('idle'); setFeedback(null); }, 4000);
            }
        } catch (err) {
            setSyncStatus('error');
            setFeedback(err instanceof Error ? err.message : t('jira.error.sync_failed'));
        }
    }

    return (
        <>
            {showModal && (
                <JiraSyncModal
                    workDay={workDay}
                    onConfirm={() => void handleConfirm()}
                    onCancel={() => setShowModal(false)}
                />
            )}

            <div className="border-t border-gray-200 pt-3 flex flex-col gap-2">
                {/* Indicateur de statut de synchronisation */}
                {isSynced && syncStatus === 'idle' && (
                    <div className="flex items-center gap-1.5 text-xs text-green-600">
                        <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                        <span>{t('jira.status.synced')} {formatSyncTime(workDay.jiraSyncedAt!)}</span>
                    </div>
                )}

                {!isSynced && syncable && syncStatus === 'idle' && (
                    <div className="flex items-center gap-1.5 text-xs text-amber-600">
                        <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                        <span>{t('jira.status.not_synced')}</span>
                    </div>
                )}

                {/* Feedback succès / erreur */}
                {null !== feedback && syncStatus === 'success' && (
                    <p className="text-xs text-green-600">{feedback}</p>
                )}

                {null !== feedback && syncStatus === 'error' && (
                    <div className="text-xs text-red-500 flex flex-col gap-0.5">
                        <p>{feedback}</p>
                        {Object.entries(errorDetails).map(([ticket, msg]) => (
                            <p key={ticket} className="text-red-400">{ticket} : {msg}</p>
                        ))}
                    </div>
                )}

                {/* Bouton de synchronisation */}
                <button
                    onClick={() => setShowModal(true)}
                    disabled={syncStatus === 'syncing'}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    {syncStatus === 'syncing' ? (
                        <>
                            <svg className="w-3.5 h-3.5 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                            </svg>
                            {t('jira.button.syncing')}
                        </>
                    ) : (
                        <>
                            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            {t('jira.button.sync')}
                        </>
                    )}
                </button>
            </div>
        </>
    );
}