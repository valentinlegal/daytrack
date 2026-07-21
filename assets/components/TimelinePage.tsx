import { useState, useEffect } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import type { FavoriteTicket, WorkDay } from '@/types/api';
import { useWorkDay } from '@/hooks/useWorkDay';
import { useJiraSync } from '@/hooks/useJiraSync';
import { MAX_DAYS_AHEAD, shiftDate, today } from '@/utils/timeline';
import { TooltipProvider } from '@/components/ui/tooltip';
import AppHeader from '@/components/layout/AppHeader';
import FavoritesPanel from '@/components/layout/FavoritesPanel';
import SummaryDrawer from '@/components/layout/SummaryDrawer';
import Timeline from '@/components/timeline/Timeline';
import { listFavorites } from '@/services/favoriteService';
import { t } from '@/i18n/fr';

// Date minimale acceptée (évite les dates absurdes genre 0001-01-01)
const MIN_DATE = '2000-01-01';

const SUMMARY_OPEN_STORAGE_KEY = 'summary-panel-open';

/** Vérifie qu'une chaîne est une date YYYY-MM-DD valide dans les bornes acceptées */
function isValidDate(date: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const d = new Date(date + 'T00:00:00');
    if (isNaN(d.getTime())) return false;
    return date >= MIN_DATE && date <= shiftDate(today(), MAX_DAYS_AHEAD);
}

export default function TimelinePage() {
    const { date: dateParam } = useParams<{ date: string }>();

    if (!dateParam || !isValidDate(dateParam)) {
        return <Navigate to={`/${today()}`} replace />;
    }

    return <TimelinePageContent date={dateParam} />;
}

// Composant interne séparé pour éviter les hooks conditionnels
function TimelinePageContent({ date }: { date: string }) {
    const navigate = useNavigate();
    const { workDay, isLoading, error, setWorkDay } = useWorkDay(date);
    const [summaryOpen, setSummaryOpen] = useState(() => sessionStorage.getItem(SUMMARY_OPEN_STORAGE_KEY) === 'true');
    const [favorites, setFavorites] = useState<FavoriteTicket[]>([]);

    useEffect(() => {
        void listFavorites().then(setFavorites).catch(() => null);
    }, []);

    useEffect(() => {
        sessionStorage.setItem(SUMMARY_OPEN_STORAGE_KEY, String(summaryOpen));
    }, [summaryOpen]);

    function handleWorkDayUpdate(updated: WorkDay) {
        setWorkDay(updated);
    }

    // Monté une seule fois ici et partagé (props) par l'icône AppHeader et le panel SummaryDrawer
    const jiraSync = useJiraSync(workDay, handleWorkDayUpdate);

    return (
        <TooltipProvider delayDuration={400}>
            {/* Drawer en full-height → même flex-row que le header */}
            <div className="h-screen flex overflow-hidden bg-white">
                {/* Colonne principale : header + body */}
                <div className="flex flex-col flex-1 overflow-hidden min-w-0">
                    <AppHeader
                        date={date}
                        workDay={workDay}
                        onWorkDayUpdate={handleWorkDayUpdate}
                        jiraSync={jiraSync}
                        onPrevious={() => navigate(`/${shiftDate(date, -1)}`)}
                        onNext={() => navigate(`/${shiftDate(date, 1)}`)}
                        onToday={() => navigate(`/${today()}`)}
                        onOpenReport={() => setSummaryOpen((prev) => !prev)}
                    />

                    <div className="flex flex-1 overflow-hidden">
                        <FavoritesPanel favorites={favorites} onChange={setFavorites} />

                        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
                            {isLoading && (
                                <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                                    {t('common.loading')}
                                </div>
                            )}
                            {null !== error && (
                                <div className="flex-1 flex items-center justify-center text-red-500 text-sm">
                                    {error}
                                </div>
                            )}
                            {!isLoading && null === error && null !== workDay && (
                                <Timeline workDay={workDay} onWorkDayUpdate={handleWorkDayUpdate} />
                            )}
                        </main>
                    </div>
                </div>

                {/* Drawer récapitulatif — pleine hauteur, pousse le contenu */}
                {workDay && (
                    <SummaryDrawer
                        open={summaryOpen}
                        onClose={() => setSummaryOpen(false)}
                        workDay={workDay}
                        jiraSync={jiraSync}
                    />
                )}
            </div>
        </TooltipProvider>
    );
}
