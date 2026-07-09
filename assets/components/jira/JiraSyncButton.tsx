import { useRef, useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import { t } from '@/i18n/fr';
import type { WorkDay } from '@/types/api';
import { isJiraConfigured } from '@/services/jiraService';
import type { JiraSyncState } from '@/hooks/useJiraSync';
import { formatIsoTime } from '@/utils/timeline';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import JiraSyncModal from './JiraSyncModal';

// Icône proche du bord droit du header : léger décalage de l'origine vers la gauche pour éviter
// qu'une partie de l'éclatement radial sorte immédiatement de l'écran
const HEADER_CONFETTI_OPTIONS = { originOffsetX: -0.03 };
// Gros bouton du panel récap : effet légèrement plus large, proportionné à sa taille
const DRAWER_CONFETTI_OPTIONS = { scale: 1.3 };

interface JiraSyncButtonProps {
    workDay: WorkDay;
    /** État et actions de sync — partagés entre les deux points d'affichage du bouton (useJiraSync, monté une seule fois dans TimelinePage) */
    jiraSync: JiraSyncState;
    /** Mode compact pour l'AppHeader — affiche uniquement une icône colorée */
    compact?: boolean;
}

export default function JiraSyncButton({ workDay, jiraSync, compact = false }: JiraSyncButtonProps) {
    const [showModal, setShowModal] = useState(false);
    // Ref sur le bouton — sert d'origine pour l'effet de confettis au succès de la synchro
    const buttonRef = useRef<HTMLButtonElement>(null);

    if (!isJiraConfigured()) return null;

    const { syncStatus, feedback, errorDetails, isSynced, syncable, isDirty, confirmSync } = jiraSync;

    function handleConfirm() {
        setShowModal(false);
        void confirmSync(buttonRef.current, compact ? HEADER_CONFETTI_OPTIONS : DRAWER_CONFETTI_OPTIONS);
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
                    onConfirm={handleConfirm}
                    onCancel={() => setShowModal(false)}
                />
                <Tooltip>
                    <TooltipTrigger asChild>
                        {/* Le span est le trigger pour que le tooltip fonctionne même quand le bouton est disabled */}
                        <span className={cn('inline-flex', isDisabled && 'cursor-not-allowed')}>
                            <Button
                                ref={buttonRef}
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
                onConfirm={handleConfirm}
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
                    ref={buttonRef}
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
