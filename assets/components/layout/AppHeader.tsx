import { useEffect, useRef, useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import type { WorkDay } from '@/types/api';
import { t } from '@/i18n/fr';
import { MAX_DAYS_AHEAD, computeEstimatedEnd, formatMinutes, parseTarget, shiftDate, today } from '@/utils/timeline';
import { updateDayTarget } from '@/services/dayService';
import type { JiraSyncState } from '@/hooks/useJiraSync';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import JiraSyncButton from '@/components/jira/JiraSyncButton';

interface AppHeaderProps {
    date: string;
    workDay: WorkDay | null;
    onWorkDayUpdate: (workDay: WorkDay) => void;
    jiraSync: JiraSyncState;
    onPrevious: () => void;
    onNext: () => void;
    onToday: () => void;
    onOpenReport: () => void;
}

/** Formate une date YYYY-MM-DD en libellé court (ex: "Ven. 3 avril 2026") */
function formatDate(date: string): string {
    const raw = new Date(date + 'T00:00:00').toLocaleDateString('fr-FR', {
        weekday: 'short',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
    return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export default function AppHeader({
    date,
    workDay,
    onWorkDayUpdate,
    jiraSync,
    onPrevious,
    onNext,
    onToday,
    onOpenReport,
}: AppHeaderProps) {
    const nextDisabled = date >= shiftDate(today(), MAX_DAYS_AHEAD);
    const isToday = date === today();
    const balance = workDay?.balanceMinutes ?? 0;

    // Rafraîchit l'estimation toutes les 15 minutes
    const [tick, setTick] = useState(0);
    useEffect(() => {
        const msUntilNextQuarter = (15 * 60 * 1000) - (Date.now() % (15 * 60 * 1000));
        const id = setTimeout(() => setTick((n) => n + 1), msUntilNextQuarter);
        return () => clearTimeout(id);
    }, [tick]);

    const estimatedEnd = workDay ? computeEstimatedEnd(workDay) : null;

    // ── Édition de l'objectif ──────────────────────────────────────────────────

    const [editingTarget, setEditingTarget] = useState(false);
    const [targetInput, setTargetInput] = useState('');
    const [targetError, setTargetError] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    function startEditing() {
        if (!workDay) return;
        setTargetInput(formatMinutes(workDay.targetMinutes));
        setTargetError(false);
        setEditingTarget(true);
        setTimeout(() => inputRef.current?.select(), 0);
    }

    async function saveTarget() {
        if (!workDay) return;
        const minutes = parseTarget(targetInput);
        if (null === minutes) { setTargetError(true); return; }
        setEditingTarget(false);
        if (minutes === workDay.targetMinutes) return;
        try {
            const updated = await updateDayTarget(workDay.date, minutes);
            onWorkDayUpdate(updated);
        } catch { /* service gère l'erreur */ }
    }

    function handleTargetKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter') void saveTarget();
        else if (e.key === 'Escape') setEditingTarget(false);
    }

    const balanceClass = balance > 0
        ? 'text-green-600'
        : balance < 0
            ? 'text-destructive'
            : 'text-foreground';

    return (
        <header className="shrink-0 bg-background border-b flex items-center ps-5.5 pe-6 h-14">
            {/* ── Logo — largeur fixe alignée avec la sidebar favorites (256px - ps-5.5=22px = 234px) ── */}
            <div className="w-[234px] shrink-0 flex items-center gap-1.5">
                <div className="flex items-center justify-center w-9 h-9">
                    <CalendarClock className="w-7 h-7" />
                </div>
                <span className="text-xl font-semibold">{t('app.name')}</span>
            </div>

            {/* ── Navigation date ── */}
            <div className="flex items-center gap-4">
                <Button
                    variant="outline"
                    onClick={onToday}
                    disabled={isToday}
                    className=""
                >
                    {t('navigation.today')}
                </Button>

                <div className="flex items-center gap-0.5">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={onPrevious}
                                aria-label={t('navigation.previous_day')}
                            >
                                <ChevronLeft />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>{formatDate(shiftDate(date, -1))}</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span className={cn(nextDisabled && 'cursor-not-allowed')}>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={onNext}
                                    disabled={nextDisabled}
                                    aria-label={t('navigation.next_day')}
                                >
                                    <ChevronRight />
                                </Button>
                            </span>
                        </TooltipTrigger>
                        <TooltipContent>{formatDate(shiftDate(date, 1))}</TooltipContent>
                    </Tooltip>
                </div>

                <span className="font-medium">
                    {formatDate(date)}
                </span>
            </div>

            <div className="flex-1" />

            {/* ── Statistiques ── */}
            {workDay && (
                <div className="flex items-center text-sm">
                    {/* Travaillé / Objectif */}
                    <span className="flex items-baseline gap-1 px-2">
                        <span className="text-muted-foreground">{t('header.worked')} :</span>
                        <span className="font-medium">{formatMinutes(workDay.workedMinutes)}</span>
                        <span className="text-muted-foreground">/</span>
                        {editingTarget ? (
                            <input
                                ref={inputRef}
                                value={targetInput}
                                onChange={(e) => { setTargetInput(e.target.value); setTargetError(false); }}
                                onKeyDown={handleTargetKeyDown}
                                onBlur={() => void saveTarget()}
                                className={cn(
                                    'w-14 text-center text-sm font-medium outline-none border-b bg-transparent',
                                    targetError
                                        ? 'border-destructive text-destructive'
                                        : 'border-primary text-foreground',
                                )}
                            />
                        ) : (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <button
                                        onClick={startEditing}
                                        className="text-sm font-medium text-foreground hover:text-primary transition-colors leading-none pb-0.5 border-b border-dashed border-muted-foreground/30 hover:border-primary/50"
                                    >
                                        {formatMinutes(workDay.targetMinutes)}
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    {t('header.target_edit_hint')}
                                </TooltipContent>
                            </Tooltip>
                        )}
                    </span>

                    {/* Solde */}
                    <span className="flex items-baseline gap-1 px-2">
                        <span className="text-muted-foreground">{t('header.balance')} :</span>
                        <span className={cn('font-medium', balanceClass)}>
                            {balance > 0 ? '+' : ''}{formatMinutes(balance)}
                        </span>
                    </span>

                    {/* Fin estimée — visible uniquement aujourd'hui */}
                    {isToday && null !== estimatedEnd && (
                        <span className="flex items-baseline gap-1 px-2">
                            <span className="text-muted-foreground">{t('header.estimated_end')} :</span>
                            <span className="font-medium">{estimatedEnd}</span>
                        </span>
                    )}
                </div>
            )}

            <div className="h-4 flex items-center">
                <Separator orientation="vertical" className="mx-2" />
            </div>

            {/* ── Actions ── */}
            <div className="flex items-center gap-0.5">
                {workDay && (
                    <JiraSyncButton workDay={workDay} jiraSync={jiraSync} compact />
                )}

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={onOpenReport}
                            className="h-8 w-8"
                        >
                            <FileText className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('summary.title')}</TooltipContent>
                </Tooltip>
            </div>
        </header>
    );
}
