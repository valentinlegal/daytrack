import { useCallback, useEffect, useState } from 'react';
import type { WorkDay } from '../types/api';
import { fetchWorkDay } from '../services/dayService';

interface UseWorkDayResult {
    workDay: WorkDay | null;
    isLoading: boolean;
    error: string | null;
    setWorkDay: (workDay: WorkDay) => void;
    reload: () => void;
}

// Gère le chargement et la mise à jour de la journée de travail courante
export function useWorkDay(date: string): UseWorkDayResult {
    const [workDay, setWorkDay] = useState<WorkDay | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await fetchWorkDay(date);
            setWorkDay(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setIsLoading(false);
        }
    }, [date]);

    useEffect(() => {
        void load();
    }, [load]);

    return {
        workDay,
        isLoading,
        error,
        setWorkDay,
        reload: load,
    };
}