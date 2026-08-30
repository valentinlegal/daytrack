import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { FavoriteTicket, JiraTicketInfo, TemplateRule } from '@/types/api';
import { listTemplateRules } from '@/services/templateRuleService';
import { listFavorites } from '@/services/favoriteService';
import { GRID_SLOTS, WEEKDAYS } from '@/utils/templateGrid';
import { SLOT_PX, today } from '@/utils/timeline';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { t } from '@/i18n/fr';
import FavoritesPanel from '@/components/layout/FavoritesPanel';
import TemplateColumn from './TemplateColumn';

export default function TemplatesPage() {
    const [rules, setRules] = useState<TemplateRule[]>([]);
    const [favorites, setFavorites] = useState<FavoriteTicket[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showPasteWarning, setShowPasteWarning] = useState(false);
    // Conteneur de scroll commun aux 7 colonnes (auto-scroll pendant un drag, position persistée).
    const scrollRef = useRef<HTMLDivElement>(null);

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
        void listFavorites().then(setFavorites).catch(() => null);
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

                {/* Corps : sidebar favoris (ambrée) + gouttière d'heures + 7 colonnes, scroll vertical commun */}
                <div className="flex flex-1 overflow-hidden">
                    <FavoritesPanel favorites={favorites} onChange={setFavorites} tone="amber" />
                    <div ref={scrollRef} className="flex-1 overflow-auto">
                    {isLoading ? (
                        <div className="p-10 text-center text-sm text-amber-800/70">{t('templates.loading')}</div>
                    ) : error !== null ? (
                        <div className="p-10 text-center text-sm text-red-600">{error}</div>
                    ) : (
                        <div className="flex min-w-[1100px]">
                            {/* Gouttière d'heures — heures pleines + quarts d'heure, comme la timeline jour */}
                            <div className="w-14 shrink-0 relative" style={{ height: gridHeight, marginTop: 36 }}>
                                {GRID_SLOTS.map((slot, idx) => {
                                    const isHour = slot.endsWith(':00');
                                    return (
                                        <span
                                            key={slot}
                                            className={
                                                isHour
                                                    ? 'absolute right-3 font-mono tabular-nums text-[12.5px] font-semibold text-amber-900/70 select-none'
                                                    : 'absolute right-3 font-mono tabular-nums text-[11px] text-amber-900/35 select-none'
                                            }
                                            style={{ top: idx * SLOT_PX - (isHour ? 7 : 6) }}
                                        >
                                            {isHour ? slot.split(':')[0] : `:${slot.split(':')[1]}`}
                                        </span>
                                    );
                                })}
                            </div>

                            {WEEKDAYS.map((iso) => (
                                <TemplateColumn
                                    key={iso}
                                    iso={iso}
                                    rules={rules}
                                    knownTickets={knownTickets}
                                    onChanged={() => void reload()}
                                    scrollRef={scrollRef}
                                    onNeedsPasteWarning={() => setShowPasteWarning(true)}
                                />
                            ))}
                        </div>
                    )}
                    </div>
                </div>

                {/* Avertissement collage sur multi-sélection (même texte que la vue jour) */}
                <Dialog open={showPasteWarning} onOpenChange={(o) => !o && setShowPasteWarning(false)}>
                    <DialogContent className="max-w-sm">
                        <p className="text-sm text-gray-700">{t('timeline.paste_multiselection_warning')}</p>
                        <DialogFooter>
                            <Button size="sm" onClick={() => setShowPasteWarning(false)}>
                                {t('timeline.close')}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>
        </TooltipProvider>
    );
}
