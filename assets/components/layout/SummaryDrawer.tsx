import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { t } from '@/i18n/fr';
import type { WorkDay } from '@/types/api';
import { computeTicketRecap } from '@/utils/timeline';
import { formatMinutes } from '@/utils/timeline';
import { getTicketTypeStyle } from '@/config/ticketTypeColors';
import JiraSyncButton from '@/components/jira/JiraSyncButton';

interface SummaryDrawerProps {
    open: boolean;
    onClose: () => void;
    workDay: WorkDay;
    onWorkDayUpdate: (workDay: WorkDay) => void;
}

export default function SummaryDrawer({ open, onClose, workDay, onWorkDayUpdate }: SummaryDrawerProps) {
    const ticketRecap = computeTicketRecap(workDay.entries);

    return (
        <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
            <SheetContent side="right" className="w-[min(32rem,90vw)] p-0 flex flex-col">
                <SheetHeader className="px-5 py-4 border-b">
                    <SheetTitle className="text-sm">{t('summary.title')}</SheetTitle>
                </SheetHeader>

                <ScrollArea className="flex-1">
                    <div className="px-5 py-4 flex flex-col gap-5">
                        {/* Sync JIRA */}
                        <JiraSyncButton workDay={workDay} onWorkDayUpdate={onWorkDayUpdate} />

                        {/* Récapitulatif par ticket */}
                        {ticketRecap.length > 0 && (
                            <div className="flex flex-col gap-1">
                                <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-400 mb-1">
                                    {t('summary.tickets_title')}
                                </span>
                                <div className="flex flex-col gap-4">
                                    {ticketRecap.map((rec) => {
                                        const style = getTicketTypeStyle(rec.ticketType);
                                        return (
                                            <div key={rec.ticketKey} className="flex flex-col gap-0.5">
                                                <div className="flex flex-col min-w-0">
                                                    {rec.ticketSummary ? (
                                                        <>
                                                            <span className="text-sm font-medium text-gray-800 break-all leading-snug">
                                                                {rec.ticketSummary}
                                                            </span>
                                                            <div className="flex items-end gap-1 min-w-0">
                                                                <span className={cn('text-xs font-mono shrink-0', style.ticketKey)}>
                                                                    {rec.ticketKey}
                                                                </span>
                                                                <span className="flex-1 border-b border-dashed border-gray-300 mb-[3px]" />
                                                                <span className="text-xs text-gray-400 shrink-0 font-mono">
                                                                    {formatMinutes(rec.totalMinutes)}
                                                                </span>
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <div className="flex items-end gap-1 min-w-0">
                                                            <span className={cn('text-xs font-mono shrink-0 font-semibold', style.ticketKey)}>
                                                                {rec.ticketKey}
                                                            </span>
                                                            <span className="flex-1 border-b border-dashed border-gray-300 mb-[3px]" />
                                                            <span className="text-xs text-gray-400 shrink-0 font-mono">
                                                                {formatMinutes(rec.totalMinutes)}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                                {rec.comments.length > 0 && (
                                                    <ul className="flex flex-col gap-0.5 mt-1">
                                                        {rec.comments.map((c) => (
                                                            <li
                                                                key={c}
                                                                className="text-xs text-gray-500 pl-2 border-l-2 border-gray-200 break-all"
                                                            >
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
                        )}

                        {ticketRecap.length === 0 && (
                            <p className="text-sm text-gray-400 italic text-center py-8">
                                {t('summary.empty')}
                            </p>
                        )}
                    </div>
                </ScrollArea>
            </SheetContent>
        </Sheet>
    );
}
