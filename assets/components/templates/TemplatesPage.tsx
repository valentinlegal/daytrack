import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, ChevronLeft } from 'lucide-react';
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
    // Colonne dont la sélection est active — les autres vident la leur.
    const [activeIso, setActiveIso] = useState<number | null>(null);
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

    // Persistance de la position de scroll du conteneur commun aux 7 colonnes
    // (les TemplateColumn passent persistScroll:false pour ne pas le faire 7 fois).
    useEffect(() => {
        const el = scrollRef.current;
        if (el === null || isLoading) return;
        const saved = sessionStorage.getItem('daytrack_tmpl_scroll');
        if (saved !== null) el.scrollTop = parseInt(saved, 10);
        function onScroll() {
            if (el !== null) sessionStorage.setItem('daytrack_tmpl_scroll', String(el.scrollTop));
        }
        el.addEventListener('scroll', onScroll);
        return () => el.removeEventListener('scroll', onScroll);
    }, [isLoading]);

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
                {/* En-tête — même structure que la vue jour (logo, bouton, titre) */}
                <header className="shrink-0 bg-background border-b flex items-center ps-5.5 pe-6 h-14">
                    {/* Logo — bloc de largeur fixe aligné sur la sidebar favoris */}
                    <div className="w-[234px] shrink-0 flex items-center gap-1.5">
                        <div className="flex items-center justify-center w-9 h-9">
                            <CalendarClock className="w-7 h-7" />
                        </div>
                        <span className="text-xl font-semibold">{t('app.name')}</span>
                    </div>

                    {/* Bouton retour à la place de « Aujourd'hui », puis titre */}
                    <div className="flex items-center gap-4">
                        <Button variant="outline" asChild>
                            <Link to={`/${today()}`}>
                                <ChevronLeft className="w-4 h-4" />
                                {t('templates.back_to_day')}
                            </Link>
                        </Button>
                        <span className="font-medium">{t('templates.nav')}</span>
                    </div>
                </header>

                {/* Corps : sidebar favoris + (bandeau au-dessus de la grille) + 7 colonnes */}
                <div className="flex flex-1 overflow-hidden">
                    <FavoritesPanel favorites={favorites} onChange={setFavorites} />
                    <div className="flex flex-col flex-1 overflow-hidden min-w-0">
                        {/* Bandeau permanent — à côté de la sidebar, au-dessus de la grille */}
                        <div className="shrink-0 px-5 py-2 text-[13px] text-amber-900 bg-amber-100/40 border-b border-amber-200">
                            {t('templates.banner')}
                        </div>
                        <div ref={scrollRef} className="flex-1 overflow-auto">
                    {isLoading ? (
                        <div className="p-10 text-center text-sm text-amber-800/70">{t('templates.loading')}</div>
                    ) : error !== null ? (
                        <div className="p-10 text-center text-sm text-red-600">{error}</div>
                    ) : (
                        <div className="flex min-w-[1100px]">
                            {/* Gouttière d'heures — heures pleines + quarts d'heure, comme la timeline jour */}
                            <div className="w-14 shrink-0 flex flex-col">
                                {/* Cale alignée sur les en-têtes de colonne, collée en haut au scroll */}
                                <div className="sticky top-0 z-20 h-9 shrink-0 bg-amber-50 border-b border-amber-200/70" />
                                {/* mt-2 : dégage le haut du label « 07 » sous l'en-tête collé */}
                                <div className="relative mt-2" style={{ height: gridHeight }}>
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
                                    activeIso={activeIso}
                                    onActivate={setActiveIso}
                                />
                            ))}
                        </div>
                    )}
                        </div>
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
