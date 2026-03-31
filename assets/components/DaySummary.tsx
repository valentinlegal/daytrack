import { useEffect, useRef, useState } from 'react';
import type { WorkDay } from '../types/api';
import { t } from '../i18n/fr';
import { formatMinutes, today } from '../utils/timeline';
import { updateDayTarget } from '../services/dayService';
import JiraSyncButton from './JiraSyncButton';

// Retourne l'heure actuelle en minutes depuis minuit
function getCurrentMinutes(): number {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
}

// Calcule l'heure de fin estimée en se basant sur l'heure actuelle
function computeEstimatedEnd(workDay: WorkDay): string | null {
    if (workDay.balanceMinutes >= 0) return null;
    if (workDay.date !== today()) return null;

    const nowFloor = Math.floor(getCurrentMinutes() / 15) * 15;
    const remaining = -workDay.balanceMinutes;

    // Durée totale des créneaux déjà saisis qui se terminent après l'heure actuelle :
    // ces créneaux seront "traversés" en travaillant en continu depuis maintenant,
    // il faut donc les ajouter au temps restant pour obtenir la durée totale depuis maintenant.
    const futureWorked = workDay.entries.reduce((sum, e) => {
        if (null === e.endedAt) return sum;
        const [h, m] = e.endedAt.split(':').map(Number);
        const end = h * 60 + m;
        return end > nowFloor ? sum + (e.durationMinutes ?? 0) : sum;
    }, 0);

    const estimatedMinutes = nowFloor + remaining + futureWorked;

    if (estimatedMinutes >= 24 * 60) return '> 23:59';

    return `${String(Math.floor(estimatedMinutes / 60)).padStart(2, '0')}:${String(estimatedMinutes % 60).padStart(2, '0')}`;
}

// Arrondit au quart d'heure le plus proche (ex: 46 → 45, 52 → 60)
function roundToQuarter(minutes: number): number {
    return Math.round(minutes / 15) * 15;
}

// Interprète une saisie utilisateur en minutes (ex: "7h30" → 450, "7:30" → 450, "7.5" → 450, "8" → 480)
function parseTarget(value: string): number | null {
    let raw: number | null = null;

    const hm = value.trim().match(/^(\d+)h(\d{1,2})?$/i);
    if (hm) raw = parseInt(hm[1]) * 60 + (hm[2] ? parseInt(hm[2]) : 0);

    const colon = value.trim().match(/^(\d+):(\d{2})$/);
    if (colon) raw = parseInt(colon[1]) * 60 + parseInt(colon[2]);

    const decimal = value.trim().match(/^(\d+(?:[.,]\d+)?)$/);
    if (decimal) raw = Math.round(parseFloat(decimal[1].replace(',', '.')) * 60);

    if (raw === null) return null;
    const rounded = roundToQuarter(raw);
    return rounded > 0 && rounded <= 1440 ? rounded : null;
}

interface DaySummaryProps {
    workDay: WorkDay;
    onWorkDayUpdate: (workDay: WorkDay) => void;
}

export default function DaySummary({ workDay, onWorkDayUpdate }: DaySummaryProps) {
    const balance = workDay.balanceMinutes;
    const [tick, setTick] = useState(0);
    const [editingTarget, setEditingTarget] = useState(false);

    // Rafraîchit l'estimation à chaque passage de quart d'heure
    useEffect(() => {
        const msUntilNextQuarter = (15 * 60 * 1000) - (Date.now() % (15 * 60 * 1000));
        const id = setTimeout(() => setTick((t) => t + 1), msUntilNextQuarter);
        return () => clearTimeout(id);
    }, [tick]);

    const estimatedEnd = computeEstimatedEnd(workDay);
    const [targetInput, setTargetInput] = useState('');
    const [targetError, setTargetError] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    function startEditing() {
        setTargetInput(formatMinutes(workDay.targetMinutes));
        setTargetError(false);
        setEditingTarget(true);
        setTimeout(() => inputRef.current?.select(), 0);
    }

    async function saveTarget() {
        const minutes = parseTarget(targetInput);
        if (minutes === null) {
            setTargetError(true);
            return;
        }
        setEditingTarget(false);
        if (minutes === workDay.targetMinutes) return;
        try {
            const updated = await updateDayTarget(workDay.date, minutes);
            onWorkDayUpdate(updated);
        } catch {
            // L'erreur est déjà traduite par le service
        }
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter') void saveTarget();
        else if (e.key === 'Escape') setEditingTarget(false);
    }

    return (
        <div className="w-56 shrink-0 bg-white border-l border-gray-200 p-4 flex flex-col gap-4">
            <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">
                {t('summary.title')}
            </h2>

            {/* Objectif — cliquable pour édition inline */}
            <div className="group flex justify-between items-center text-sm">
                <span className="text-gray-600">{t('summary.target')}</span>
                {editingTarget ? (
                    <input
                        ref={inputRef}
                        value={targetInput}
                        onChange={(e) => { setTargetInput(e.target.value); setTargetError(false); }}
                        onKeyDown={handleKeyDown}
                        onBlur={() => void saveTarget()}
                        className={`w-16 text-right text-sm font-medium outline-none border-b ${targetError ? 'border-red-400 text-red-500' : 'border-indigo-400 text-gray-800'}`}
                    />
                ) : (
                    <button
                        onClick={startEditing}
                        className="flex items-center gap-1 text-gray-800 font-medium hover:text-indigo-600 transition-colors"
                        title={t('summary.target_edit_hint')}
                    >
                        <svg className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-1.414A2 2 0 019.586 13z" />
                        </svg>
                        <span className="border-b border-dashed border-gray-300 group-hover:border-indigo-400 transition-colors">
                            {formatMinutes(workDay.targetMinutes)}
                        </span>
                    </button>
                )}
            </div>

            <SummaryRow label={t('summary.worked')} value={formatMinutes(workDay.workedMinutes)} />

            <div className="border-t border-gray-200 pt-3 flex flex-col gap-3">
                <SummaryRow
                    label={t('summary.balance')}
                    value={`${balance > 0 ? '+' : ''}${formatMinutes(balance)}`}
                    highlight={balance > 0 ? 'over' : balance === 0 ? 'positive' : 'negative'}
                />
                {null !== estimatedEnd && (
                    <SummaryRow
                        label={t('summary.estimated_end')}
                        value={estimatedEnd}
                    />
                )}
            </div>

            <JiraSyncButton workDay={workDay} onWorkDayUpdate={onWorkDayUpdate} />
        </div>
    );
}

interface SummaryRowProps {
    label: string;
    value: string;
    muted?: boolean;
    highlight?: 'positive' | 'negative' | 'over';
}

function SummaryRow({ label, value, muted = false, highlight }: SummaryRowProps) {
    const valueClass = highlight === 'positive'
        ? 'text-green-600 font-semibold'
        : highlight === 'negative'
            ? 'text-red-500 font-semibold'
            : highlight === 'over'
                ? 'text-orange-500 font-semibold'
                : muted
                    ? 'text-gray-400'
                    : 'text-gray-800 font-medium';

    return (
        <div className="flex justify-between items-center text-sm">
            <span className={muted ? 'text-gray-400' : 'text-gray-600'}>{label}</span>
            <span className={valueClass}>{value}</span>
        </div>
    );
}