import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { t } from '@/i18n/fr';
import type { WorkDay } from '@/types/api';
import { computeTicketRecap, formatMinutes } from '@/utils/timeline';
import { getTicketTypeStyle } from '@/config/ticketTypeColors';
import JiraSyncButton from '@/components/jira/JiraSyncButton';
import { XIcon } from 'lucide-react';

interface SummaryDrawerProps {
    open: boolean;
    onClose: () => void;
    workDay: WorkDay;
    onWorkDayUpdate: (workDay: WorkDay) => void;
}

export default function SummaryDrawer({ open, onClose, workDay, onWorkDayUpdate }: SummaryDrawerProps) {
    const ticketRecap = computeTicketRecap(workDay.entries);

    return (
        <div
            className={cn(
                'shrink-0 flex flex-col border-l border-border bg-background',
                'overflow-hidden transition-[width] duration-[220ms] ease-out',
            )}
            style={{ width: open ? 'min(24rem, 90vw)' : 0 }}
            aria-hidden={!open}
        >
            {/* Contenu — toujours monté pour éviter le flash au réouverture */}
            <div className="w-[min(24rem,90vw)] flex flex-col h-full min-h-0">
                {/* Header */}
                <div className="flex items-center justify-between h-14 px-4 border-b shrink-0">
                    <span className="text-sm font-semibold">{t('summary.title')}</span>
                    <button
                        onClick={onClose}
                        className="w-7 h-7 rounded-md inline-grid place-items-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                        aria-label={t('common.close')}
                    >
                        <XIcon className="size-4" />
                    </button>
                </div>

                <ScrollArea className="flex-1 min-h-0">
                    <div className="flex flex-col">
                        {/* Section sync Jira */}
                        <div className="px-4 py-4 border-b flex flex-col gap-3">
                            <JiraSyncButton workDay={workDay} onWorkDayUpdate={onWorkDayUpdate} />
                        </div>

                        {/* Récapitulatif par ticket */}
                        {ticketRecap.length > 0 ? (
                            <div className="flex flex-col">
                                <div className="px-4 pt-4 pb-2">
                                    <span className="text-[11px] uppercase tracking-[0.06em] font-medium text-muted-foreground">
                                        {t('summary.tickets_title')}
                                    </span>
                                </div>
                                <div className="flex flex-col px-4">
                                    {ticketRecap.map((rec) => {
                                        const style = getTicketTypeStyle(rec.ticketType);
                                        return (
                                            <div
                                                key={rec.ticketKey}
                                                className="flex flex-col gap-1.5 py-3 border-b border-gray-100 last:border-b-0"
                                            >
                                                <div className="flex items-baseline gap-2.5 min-w-0">
                                                    <span className={cn('text-[12px] font-mono font-semibold shrink-0 tabular-nums', style.ticketKey)}>
                                                        {rec.ticketKey}
                                                    </span>
                                                    <span className="text-[13.5px] font-medium text-foreground truncate flex-1 min-w-0">
                                                        {rec.ticketSummary ?? ''}
                                                    </span>
                                                    <span className="text-[13px] font-mono font-semibold text-foreground tabular-nums shrink-0">
                                                        {formatMinutes(rec.totalMinutes)}
                                                    </span>
                                                </div>

                                                {rec.comments.length > 0 && (
                                                    <ul className="flex flex-col gap-0.5 ml-px pl-2.5 border-l-2 border-gray-200">
                                                        {rec.comments.map((c) => (
                                                            <li key={c} className="text-[12.5px] text-muted-foreground [overflow-wrap:anywhere]">
                                                                {c}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground italic text-center py-10 px-4">
                                {t('summary.empty')}
                            </p>
                        )}
                    </div>
                </ScrollArea>
            </div>
        </div>
    );
}
