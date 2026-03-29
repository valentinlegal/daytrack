import { MAX_DAYS_AHEAD, shiftDate, today } from '../utils/timeline';
import { t } from '../i18n/fr';

interface DayNavigationProps {
    date: string; // format YYYY-MM-DD
    onPrevious: () => void;
    onNext: () => void;
    onToday: () => void;
}

// Formate une date YYYY-MM-DD en libellé lisible (ex: "Lundi 28 mars 2026")
function formatDate(date: string): string {
    return new Date(date + 'T00:00:00').toLocaleDateString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
}

function isToday(date: string): boolean {
    return date === today();
}

export default function DayNavigation({ date, onPrevious, onNext, onToday }: DayNavigationProps) {
    const nextDisabled = date >= shiftDate(today(), MAX_DAYS_AHEAD);

    return (
        <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200">
            <button
                onClick={onPrevious}
                aria-label={t('navigation.previous_day')}
                className="p-2 rounded hover:bg-gray-100 text-gray-600 transition-colors"
            >
                ←
            </button>

            <div className="flex items-center gap-3">
                <span className="text-lg font-medium text-gray-800 capitalize">
                    {formatDate(date)}
                </span>
                {!isToday(date) && (
                    <button
                        onClick={onToday}
                        className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                        {t('navigation.today')}
                    </button>
                )}
            </div>

            <button
                onClick={onNext}
                disabled={nextDisabled}
                aria-label={t('navigation.next_day')}
                className="p-2 rounded text-gray-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:enabled:bg-gray-100"
            >
                →
            </button>
        </div>
    );
}