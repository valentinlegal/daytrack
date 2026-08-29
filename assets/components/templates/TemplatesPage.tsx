import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { JiraTicketInfo, TemplateRule } from '@/types/api';
import { listTemplateRules } from '@/services/templateRuleService';
import { GRID_SLOTS, WEEKDAYS } from '@/utils/templateGrid';
import { SLOT_PX, today } from '@/utils/timeline';
import { TooltipProvider } from '@/components/ui/tooltip';
import { t } from '@/i18n/fr';
import TemplateColumn from './TemplateColumn';

export default function TemplatesPage() {
    const [rules, setRules] = useState<TemplateRule[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    async function reload() {
        try {
            setRules(await listTemplateRules());
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('templates.error.load'));
        } finally {
            setIsLoading(false);
        }
    }

    useEffect(() => {
        void reload();
    }, []);

    // Tickets déjà connus (titre + type) pour l'autocomplete du EditPopover, comme Timeline.
    const knownTickets = useMemo<Record<string, JiraTicketInfo>>(() => {
        const map: Record<string, JiraTicketInfo> = {};
        for (const r of rules) {
            if (r.ticketKey && r.ticketSummary && r.ticketType) {
                map[r.ticketKey] = { summary: r.ticketSummary, type: r.ticketType };
            }
        }
        return map;
    }, [rules]);

    const gridHeight = GRID_SLOTS.length * SLOT_PX;

    return (
        <TooltipProvider delayDuration={400}>
            <div className="h-screen flex flex-col overflow-hidden bg-amber-50">
                {/* En-tête dédié — distinct du header du mode jour */}
                <header className="shrink-0 h-14 flex items-center gap-4 px-5 border-b border-amber-200 bg-amber-100/60">
                    <Link
                        to={`/${today()}`}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-900 hover:text-amber-950"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        {t('templates.back_to_day')}
                    </Link>
                    <div className="h-5 w-px bg-amber-300" />
                    <span className="text-sm font-semibold text-amber-950">{t('templates.nav')}</span>
                </header>

                {/* Bandeau permanent */}
                <div className="shrink-0 px-5 py-2 text-[13px] text-amber-900 bg-amber-100/40 border-b border-amber-200">
                    {t('templates.banner')}
                </div>

                {/* Corps : gouttière d'heures + 7 colonnes, scroll vertical commun */}
                <div className="flex-1 overflow-auto">
                    {isLoading ? (
                        <div className="p-10 text-center text-sm text-amber-800/70">{t('templates.loading')}</div>
                    ) : error !== null ? (
                        <div className="p-10 text-center text-sm text-red-600">{error}</div>
                    ) : (
                        <div className="flex min-w-[1100px]">
                            {/* Gouttière d'heures */}
                            <div className="w-14 shrink-0 relative" style={{ height: gridHeight, marginTop: 36 }}>
                                {GRID_SLOTS.map((slot, idx) =>
                                    slot.endsWith(':00') ? (
                                        <span
                                            key={slot}
                                            className="absolute right-2 font-mono text-[11px] text-amber-900/60 select-none"
                                            style={{ top: idx * SLOT_PX - 6 }}
                                        >
                                            {slot.split(':')[0]}
                                        </span>
                                    ) : null,
                                )}
                            </div>

                            {WEEKDAYS.map((iso) => (
                                <TemplateColumn
                                    key={iso}
                                    iso={iso}
                                    rules={rules}
                                    knownTickets={knownTickets}
                                    onChanged={() => void reload()}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </TooltipProvider>
    );
}
