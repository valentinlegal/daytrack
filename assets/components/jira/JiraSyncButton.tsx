import { useEffect, useRef, useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import { t } from '@/i18n/fr';
import type { WorkDay } from '@/types/api';
import { EntryType } from '@/types/api';
import { syncDay, isJiraConfigured } from '@/services/jiraService';
import { formatIsoTime } from '@/utils/timeline';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import JiraSyncModal from './JiraSyncModal';

type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

interface JiraSyncButtonProps {
    workDay: WorkDay;
    onWorkDayUpdate: (workDay: WorkDay) => void;
    /** Mode compact pour l'AppHeader — affiche uniquement une icône colorée */
    compact?: boolean;
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

export default function JiraSyncButton({ workDay, onWorkDayUpdate, compact = false }: JiraSyncButtonProps) {
    const [showModal, setShowModal] = useState(false);
    const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
    const [feedback, setFeedback] = useState<string | null>(null);
    const [errorDetails, setErrorDetails] = useState<Record<string, string>>({});

    // Empreinte de la dernière sync réussie — initialisée depuis sessionStorage pour survivre aux remounts
    const syncFingerprintRef = useRef<string | null>(
        sessionStorage.getItem(syncFpKey(workDay.date)),
    );

    // Au changement de journée : charge le fingerprint de la nouvelle date depuis sessionStorage
    useEffect(() => {
        syncFingerprintRef.current = sessionStorage.getItem(syncFpKey(workDay.date));
        setSyncStatus('idle');
        setFeedback(null);
        setErrorDetails({});
    }, [workDay.date]);

    if (!isJiraConfigured()) return null;

    const isSynced = null !== workDay.jiraSyncedAt;
    const syncable = hasSyncableEntries(workDay);
    const isDirty = null !== syncFingerprintRef.current
        && entriesFingerprint(workDay) !== syncFingerprintRef.current;

    async function handleConfirm() {
        setShowModal(false);
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
                syncFingerprintRef.current = fp;
                setSyncStatus('success');
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

    if (compact) {
        // Désactivé quand : en cours de sync, ou rien à envoyer ET pas de diff JIRA à nettoyer
        const isDisabled = syncStatus === 'syncing' || (!syncable && !isDirty);

        // Couleur de l'icône selon l'état
        let iconColor: string;
        if (syncStatus === 'error') {
            iconColor = 'text-destructive enabled:hover:text-destructive';
        } else if (syncStatus === 'success' || (syncStatus === 'idle' && isSynced && !isDirty && syncable)) {
            iconColor = 'text-green-600 enabled:hover:text-green-700';
        } else if (syncStatus === 'idle' && (isDirty || (!isSynced && syncable))) {
            iconColor = 'text-amber-500 enabled:hover:text-amber-600';
        } else {
            iconColor = '';
        }

        // Texte du tooltip
        let tooltipText: string;
        if (syncStatus === 'syncing') {
            tooltipText = t('jira.button.syncing');
        } else if (syncStatus === 'error') {
            tooltipText = feedback ?? t('jira.error.sync_failed');
        } else if (syncStatus === 'success') {
            tooltipText = t('jira.feedback.synced');
        } else if (isSynced && workDay.jiraSyncedAt && !isDirty && syncable) {
            tooltipText = `${t('jira.status.synced')} ${formatIsoTime(workDay.jiraSyncedAt)}`;
        } else if (isDirty && !syncable) {
            // Syncé puis toutes les saisies supprimées → JIRA a des worklogs à nettoyer
            tooltipText = t('jira.status.synced_cleanup');
        } else if (isDirty) {
            tooltipText = t('jira.status.dirty');
        } else if (!isSynced && syncable) {
            tooltipText = t('jira.button.sync');
        } else {
            tooltipText = t('jira.status.nothing_to_sync');
        }

        return (
            <>
                <JiraSyncModal
                    open={showModal}
                    workDay={workDay}
                    onConfirm={() => void handleConfirm()}
                    onCancel={() => setShowModal(false)}
                />
                <Tooltip>
                    <TooltipTrigger asChild>
                        {/* Le span est le trigger pour que le tooltip fonctionne même quand le bouton est disabled */}
                        <span className={cn('inline-flex', isDisabled && 'cursor-not-allowed')}>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setShowModal(true)}
                                disabled={isDisabled}
                                className={cn('h-8 w-8', iconColor)}
                            >
                                <RefreshCw className={cn('h-4 w-4', syncStatus === 'syncing' && 'animate-spin')} />
                            </Button>
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>{tooltipText}</TooltipContent>
                </Tooltip>
            </>
        );
    }

    // Mode non-compact (SummaryDrawer)
    return (
        <>
            <JiraSyncModal
                open={showModal}
                workDay={workDay}
                onConfirm={() => void handleConfirm()}
                onCancel={() => setShowModal(false)}
            />

            <div className="flex flex-col gap-2">
                {/* Indicateur de statut */}
                {isSynced && syncStatus === 'idle' && (
                    <div className="flex items-center gap-1.5 text-xs text-green-600">
                        <Check className="w-3.5 h-3.5 shrink-0" />
                        <span>{t('jira.status.synced')} {formatIsoTime(workDay.jiraSyncedAt!)}</span>
                    </div>
                )}
                {!isSynced && syncable && syncStatus === 'idle' && (
                    <div className="flex items-center gap-1.5 text-xs text-amber-600">
                        <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                        <span>{t('jira.status.not_synced')}</span>
                    </div>
                )}
                {feedback && syncStatus === 'success' && (
                    <p className="text-xs text-green-600">{feedback}</p>
                )}
                {feedback && syncStatus === 'error' && (
                    <div className="text-xs text-red-500 flex flex-col gap-0.5">
                        <p>{feedback}</p>
                        {Object.entries(errorDetails).map(([ticket, msg]) => (
                            <p key={ticket} className="text-red-400">{ticket} : {msg}</p>
                        ))}
                    </div>
                )}

                <Button
                    variant="default"
                    onClick={() => setShowModal(true)}
                    disabled={syncStatus === 'syncing'}
                    className="gap-1.5 w-full h-auto min-h-8 py-1.5 shrink whitespace-normal text-center"
                >
                    <RefreshCw className={cn('w-3.5 h-3.5 shrink-0', syncStatus === 'syncing' && 'animate-spin')} />
                    {syncStatus === 'syncing' ? t('jira.button.syncing') : t('jira.button.sync')}
                </Button>
            </div>
        </>
    );
}
