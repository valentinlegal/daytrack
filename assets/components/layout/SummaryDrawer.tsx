import { useRef, useState, type MouseEvent } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { t } from '@/i18n/fr';
import type { WorkDay } from '@/types/api';
import { computeTicketRecap, formatMinutes } from '@/utils/timeline';
import { getTicketTypeStyle } from '@/config/ticketTypeColors';
import type { JiraSyncState } from '@/hooks/useJiraSync';
import JiraSyncButton from '@/components/jira/JiraSyncButton';
import { XIcon } from 'lucide-react';

const MIN_WIDTH = 384;
const MAX_WIDTH = 640;
const STORAGE_KEY = 'summary-panel-width';

interface SummaryDrawerProps {
    open: boolean;
    onClose: () => void;
    workDay: WorkDay;
    jiraSync: JiraSyncState;
}

export default function SummaryDrawer({ open, onClose, workDay, jiraSync }: SummaryDrawerProps) {
    const ticketRecap = computeTicketRecap(workDay.entries);

    const [width, setWidth] = useState(() => {
        const saved = sessionStorage.getItem(STORAGE_KEY);
        return saved ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parseInt(saved, 10))) : MIN_WIDTH;
    });
    const widthRef = useRef(width);
    widthRef.current = width;
    const [isResizing, setIsResizing] = useState(false);

    function handleResizeMouseDown(e: MouseEvent) {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = widthRef.current;

        setIsResizing(true);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        function onMouseMove(ev: globalThis.MouseEvent) {
            setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth - (ev.clientX - startX))));
        }

        function onMouseUp() {
            setIsResizing(false);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            sessionStorage.setItem(STORAGE_KEY, String(widthRef.current));
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        }

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    }

    function handleResizeDoubleClick() {
        setWidth(MIN_WIDTH);
        sessionStorage.removeItem(STORAGE_KEY);
    }

    return (
        <div className="relative shrink-0">
        <div
            className={cn(
                'shrink-0 overflow-hidden',
                !isResizing && 'transition-[width] duration-[220ms] ease-out',
            )}
            style={{ width: open ? width : 0 }}
            aria-hidden={!open}
        >
            {/* Contenu — toujours monté pour éviter le flash au réouverture, largeur fixe pour ne pas wrap pendant l'animation */}
            <div
                className="flex flex-col h-full min-h-0 border-l border-border bg-background"
                style={{ width }}
            >
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
                            <JiraSyncButton workDay={workDay} jiraSync={jiraSync} />
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
                                                <div className="flex items-baseline justify-between gap-2.5">
                                                    <span className={cn('text-[12px] font-mono font-semibold shrink-0 tabular-nums', style.ticketKey)}>
                                                        {rec.ticketKey}
                                                    </span>
                                                    <span className="text-[13px] font-mono font-semibold text-foreground tabular-nums shrink-0">
                                                        {formatMinutes(rec.totalMinutes)}
                                                    </span>
                                                </div>
                                                {rec.ticketSummary && (
                                                    <span className="text-[13.5px] font-medium text-foreground [overflow-wrap:anywhere]">
                                                        {rec.ticketSummary}
                                                    </span>
                                                )}

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

        {open && (
            <div
                className="absolute inset-y-0 left-0 w-[5px] cursor-col-resize group z-10"
                onMouseDown={handleResizeMouseDown}
                onDoubleClick={handleResizeDoubleClick}
            >
                <div className="absolute inset-y-0 left-0 w-px group-hover:w-[2px] bg-neutral-200 group-hover:bg-neutral-900 transition-all" />
            </div>
        )}
        </div>
    );
}
