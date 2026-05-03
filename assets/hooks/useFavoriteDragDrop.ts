import { useState, useRef, useEffect, type RefObject, type DragEvent } from 'react';
import type { FavoriteTicket } from '@/types/api';
import { arrayMove, writeToTimelineClipboard } from '@/utils/favoriteUtils';
import * as favoriteService from '@/services/favoriteService';

interface UseFavoriteDragDropResult {
    draggingId: string | null;
    dropIndex: number | null;
    isDragInProgress: boolean;
    listRef: RefObject<HTMLDivElement | null>;
    shouldShowPlaceholder: (beforeIndex: number) => boolean;
    handleItemDragStart: (e: DragEvent<HTMLDivElement>, fav: FavoriteTicket) => void;
    handleItemDragOver: (e: DragEvent<HTMLDivElement>, index: number) => void;
    handleItemDrop: (e: DragEvent<HTMLDivElement>) => void;
    handleListDragLeave: (e: DragEvent<HTMLDivElement>) => void;
    resetDrag: () => void;
}

/** Gère le drag-and-drop pour réordonner les favoris. */
export function useFavoriteDragDrop(
    favorites: FavoriteTicket[],
    onChange: (favorites: FavoriteTicket[]) => void,
): UseFavoriteDragDropResult {
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dropIndex, setDropIndex] = useState<number | null>(null);
    const listRef = useRef<HTMLDivElement>(null);

    function resetDrag() {
        setDraggingId(null);
        setDropIndex(null);
    }

    // Ref stable pour éviter de re-enregistrer le listener dragend global à chaque render.
    const resetDragRef = useRef(resetDrag);
    resetDragRef.current = resetDrag;
    useEffect(() => {
        function onDragEnd() { resetDragRef.current(); }
        document.addEventListener('dragend', onDragEnd);
        return () => document.removeEventListener('dragend', onDragEnd);
    }, []);

    function handleItemDragStart(e: DragEvent<HTMLDivElement>, fav: FavoriteTicket) {
        e.dataTransfer.effectAllowed = 'copyMove';
        e.dataTransfer.setData('application/daytrack-favorite', fav.id);
        writeToTimelineClipboard(fav);
        // setTimeout 0 : laisser le navigateur capturer le ghost de drag avant de masquer l'élément
        setTimeout(() => setDraggingId(fav.id), 0);
    }

    function handleItemDragOver(e: DragEvent<HTMLDivElement>, index: number) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        setDropIndex(e.clientY < rect.top + rect.height / 2 ? index : index + 1);
    }

    function handleItemDrop(e: DragEvent<HTMLDivElement>) {
        e.preventDefault();
        e.stopPropagation();
        const sourceId = e.dataTransfer.getData('application/daytrack-favorite');
        if (!sourceId || dropIndex === null) { resetDrag(); return; }
        const fromIndex = favorites.findIndex((f) => f.id === sourceId);
        if (-1 === fromIndex) { resetDrag(); return; }
        let toIndex = dropIndex;
        // Ajustement d'index : si on déplace vers le bas, l'index de destination doit être décrémenté
        // car la suppression de l'élément source décale les éléments suivants d'un rang.
        if (toIndex > fromIndex) toIndex--;
        if (fromIndex !== toIndex) {
            const reordered = arrayMove(favorites, fromIndex, toIndex);
            onChange(reordered);
            void favoriteService.reorderFavorites(reordered.map((f) => f.id)).catch(() => null);
        }
        resetDrag();
    }

    function handleListDragLeave(e: DragEvent<HTMLDivElement>) {
        if (!listRef.current?.contains(e.relatedTarget as Node)) setDropIndex(null);
    }

    function shouldShowPlaceholder(beforeIndex: number): boolean {
        return draggingId !== null && dropIndex === beforeIndex;
    }

    return {
        draggingId,
        dropIndex,
        isDragInProgress: draggingId !== null,
        listRef,
        shouldShowPlaceholder,
        handleItemDragStart,
        handleItemDragOver,
        handleItemDrop,
        handleListDragLeave,
        resetDrag,
    };
}
