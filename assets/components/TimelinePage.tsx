import { Navigate, useNavigate, useParams } from 'react-router-dom';
import type { WorkDay } from '../types/api';
import { useWorkDay } from '../hooks/useWorkDay';
import { MAX_DAYS_AHEAD, shiftDate, today } from '../utils/timeline';
import DayNavigation from './DayNavigation';
import DaySummary from './DaySummary';
import Timeline from './Timeline';

// Date minimale acceptée (évite les dates absurdes genre 0001-01-01)
const MIN_DATE = '2000-01-01';

// Vérifie qu'une chaîne est une date YYYY-MM-DD valide dans les bornes acceptées
function isValidDate(date: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const d = new Date(date + 'T00:00:00');
    if (isNaN(d.getTime())) return false;
    return date >= MIN_DATE && date <= shiftDate(today(), MAX_DAYS_AHEAD);
}

export default function TimelinePage() {
    const { date: dateParam } = useParams<{ date: string }>();
    const navigate = useNavigate();

    // Redirection vers aujourd'hui si la date est absente, invalide ou hors bornes
    if (!dateParam || !isValidDate(dateParam)) {
        return <Navigate to={`/${today()}`} replace />;
    }

    return <TimelinePageContent date={dateParam} />;
}

// Composant interne séparé pour éviter les hooks conditionnels
function TimelinePageContent({ date }: { date: string }) {
    const navigate = useNavigate();
    const { workDay, isLoading, error, setWorkDay } = useWorkDay(date);

    function handleWorkDayUpdate(updated: WorkDay) {
        setWorkDay(updated);
    }

    return (
        <div className="h-screen flex flex-col bg-gray-50">
            <DayNavigation
                date={date}
                onPrevious={() => navigate(`/${shiftDate(date, -1)}`)}
                onNext={() => navigate(`/${shiftDate(date, 1)}`)}
                onToday={() => navigate(`/${today()}`)}
            />

            <div className="flex flex-1 overflow-hidden">
                {isLoading && (
                    <div className="flex-1 flex items-center justify-center text-gray-400">
                        Chargement…
                    </div>
                )}

                {null !== error && (
                    <div className="flex-1 flex items-center justify-center text-red-500">
                        {error}
                    </div>
                )}

                {!isLoading && null === error && null !== workDay && (
                    <>
                        <Timeline workDay={workDay} onWorkDayUpdate={handleWorkDayUpdate} />
                        <DaySummary workDay={workDay} onWorkDayUpdate={handleWorkDayUpdate} />
                    </>
                )}
            </div>
        </div>
    );
}