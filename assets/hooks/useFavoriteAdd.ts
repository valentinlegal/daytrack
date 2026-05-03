import { useState, useRef, useEffect, type RefObject, type KeyboardEvent } from 'react';
import type { FavoriteTicket } from '@/types/api';
import { t } from '@/i18n/fr';
import * as favoriteService from '@/services/favoriteService';

interface UseFavoriteAddResult {
    isAdding: boolean;
    addInput: string;
    addError: string | null;
    isAddLoading: boolean;
    addInputRef: RefObject<HTMLInputElement | null>;
    setAddInput: (v: string) => void;
    openAdd: () => void;
    cancelAdd: () => void;
    submitAdd: () => Promise<void>;
    handleAddKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
}

/** Gère le flux d'ajout d'un nouveau favori (popover + validation + API). */
export function useFavoriteAdd(
    favorites: FavoriteTicket[],
    onChange: (favorites: FavoriteTicket[]) => void,
): UseFavoriteAddResult {
    const [isAdding, setIsAdding] = useState(false);
    const [addInput, setAddInput] = useState('');
    const [addError, setAddError] = useState<string | null>(null);
    const [isAddLoading, setIsAddLoading] = useState(false);
    const addInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isAdding) setTimeout(() => addInputRef.current?.focus(), 0);
    }, [isAdding]);

    function openAdd() {
        setAddInput('');
        setAddError(null);
        setIsAdding(true);
    }

    function cancelAdd() {
        setIsAdding(false);
        setAddInput('');
        setAddError(null);
    }

    async function submitAdd() {
        const key = addInput.trim().toUpperCase();
        if (!key) return;
        setIsAddLoading(true);
        setAddError(null);
        try {
            const created = await favoriteService.createFavorite(key);
            onChange([...favorites, created]);
            setIsAdding(false);
            setAddInput('');
        } catch (err) {
            setAddError(err instanceof Error ? err.message : t('favorites.already_exists'));
        } finally {
            setIsAddLoading(false);
        }
    }

    function handleAddKeyDown(e: KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter') void submitAdd();
        else if (e.key === 'Escape') cancelAdd();
    }

    return {
        isAdding,
        addInput,
        addError,
        isAddLoading,
        addInputRef,
        setAddInput,
        openAdd,
        cancelAdd,
        submitAdd,
        handleAddKeyDown,
    };
}
