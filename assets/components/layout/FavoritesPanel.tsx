import { useState, useRef, useEffect, Fragment } from 'react';
import { Plus, X, Check, Pencil, GripVertical } from 'lucide-react';
import { EntryType } from '@/types/api';
import type { FavoriteTicket } from '@/types/api';
import { t } from '@/i18n/fr';
import { getTicketTypeStyle } from '@/config/ticketTypeColors';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import * as favoriteService from '@/services/favoriteService';

/** Déplace un élément d'un tableau (immuable). */
function arrayMove<T>(arr: T[], from: number, to: number): T[] {
    const result = [...arr];
    const [item] = result.splice(from, 1);
    result.splice(to, 0, item);
    return result;
}

/** Écrit un favori dans le presse-papier interne de la timeline. */
function writeToTimelineClipboard(fav: FavoriteTicket): void {
    const clipboardData = {
        cells: [{
            offset: 0,
            ticketKey: fav.ticketKey,
            ticketSummary: fav.ticketSummary,
            ticketType: fav.ticketType,
            comment: null,
            type: EntryType.WORK,
            isEmpty: false,
        }],
    };
    sessionStorage.setItem('daytrack_clipboard', JSON.stringify(clipboardData));
    window.dispatchEvent(new CustomEvent('daytrack:clipboard-changed'));
}

interface FavoritesPanelProps {
    favorites: FavoriteTicket[];
    onChange: (favorites: FavoriteTicket[]) => void;
}

export default function FavoritesPanel({ favorites, onChange }: FavoritesPanelProps) {
    const [isAdding, setIsAdding] = useState(false);
    const [addInput, setAddInput] = useState('');
    const [addError, setAddError] = useState<string | null>(null);
    const [isAddLoading, setIsAddLoading] = useState(false);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dropIndex, setDropIndex] = useState<number | null>(null);

    const addInputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Ferme le renommage sur mousedown en dehors du composant
    const renameCallbackRef = useRef<(() => void) | null>(null);
    renameCallbackRef.current = renamingId
        ? () => {
            const trimmed = renameValue.trim();
            const id = renamingId;
            setRenamingId(null);
            if (trimmed) {
                void favoriteService.renameFavorite(id, trimmed)
                    .then((updated) => onChange(favorites.map((f) => (f.id === id ? updated : f))))
                    .catch(() => null);
            }
        }
        : null;

    useEffect(() => {
        function handleOutside(e: MouseEvent) {
            if (containerRef.current?.contains(e.target as Node)) return;
            renameCallbackRef.current?.();
        }
        document.addEventListener('mousedown', handleOutside);
        return () => document.removeEventListener('mousedown', handleOutside);
    }, []);

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

    function handleAddKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter') void submitAdd();
        else if (e.key === 'Escape') cancelAdd();
    }

    function startRename(fav: FavoriteTicket) {
        setRenamingId(fav.id);
        setRenameValue(fav.customName ?? fav.ticketSummary ?? fav.ticketKey);
    }

    async function commitRename(id: string) {
        const trimmed = renameValue.trim();
        setRenamingId(null);
        if (!trimmed) return;
        try {
            const updated = await favoriteService.renameFavorite(id, trimmed);
            onChange(favorites.map((f) => (f.id === id ? updated : f)));
        } catch { /* revert silencieux */ }
    }

    async function handleDelete(id: string) {
        onChange(favorites.filter((f) => f.id !== id));
        try {
            await favoriteService.deleteFavorite(id);
        } catch {
            const res = await favoriteService.listFavorites().catch(() => null);
            if (res) onChange(res);
        }
    }

    function handleCopy(fav: FavoriteTicket) {
        writeToTimelineClipboard(fav);
        setCopiedId(fav.id);
        setTimeout(() => setCopiedId((prev) => (prev === fav.id ? null : prev)), 1500);
    }

    // ── Drag & drop ──────────────────────────────────────────────────────────

    function handleItemDragStart(e: React.DragEvent<HTMLDivElement>, fav: FavoriteTicket) {
        e.dataTransfer.effectAllowed = 'copyMove';
        e.dataTransfer.setData('application/daytrack-favorite', fav.id);
        writeToTimelineClipboard(fav);
        setTimeout(() => setDraggingId(fav.id), 0);
    }

    function handleItemDragOver(e: React.DragEvent<HTMLDivElement>, index: number) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        setDropIndex(e.clientY < rect.top + rect.height / 2 ? index : index + 1);
    }

    function handleItemDrop(e: React.DragEvent<HTMLDivElement>) {
        e.preventDefault();
        e.stopPropagation();
        const sourceId = e.dataTransfer.getData('application/daytrack-favorite');
        if (!sourceId || dropIndex === null) { resetDrag(); return; }
        const fromIndex = favorites.findIndex((f) => f.id === sourceId);
        if (-1 === fromIndex) { resetDrag(); return; }
        let toIndex = dropIndex;
        if (toIndex > fromIndex) toIndex--;
        if (fromIndex !== toIndex) {
            const reordered = arrayMove(favorites, fromIndex, toIndex);
            onChange(reordered);
            void favoriteService.reorderFavorites(reordered.map((f) => f.id)).catch(() => null);
        }
        resetDrag();
    }

    function handleListDragLeave(e: React.DragEvent<HTMLDivElement>) {
        if (!listRef.current?.contains(e.relatedTarget as Node)) setDropIndex(null);
    }

    function resetDrag() {
        setDraggingId(null);
        setDropIndex(null);
    }

    const resetDragRef = useRef(resetDrag);
    resetDragRef.current = resetDrag;
    useEffect(() => {
        function onDragEnd() { resetDragRef.current(); }
        document.addEventListener('dragend', onDragEnd);
        return () => document.removeEventListener('dragend', onDragEnd);
    }, []);

    function shouldShowPlaceholder(beforeIndex: number): boolean {
        return draggingId !== null && dropIndex === beforeIndex;
    }

    return (
        <aside
            ref={containerRef}
            className="w-52 shrink-0 bg-gray-50 border-r border-gray-200 flex flex-col overflow-hidden"
        >
            {/* En-tête */}
            <div className="px-3 py-3 border-b border-gray-200 shrink-0">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-400">
                    {t('favorites.title')}
                </span>
            </div>

            {/* Liste */}
            <div
                ref={listRef}
                className="flex-1 overflow-y-auto py-2 px-2 flex flex-col gap-0.5"
                onDragLeave={handleListDragLeave}
                onDragEnd={resetDrag}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleItemDrop}
            >
                {favorites.length === 0 && !isAdding && (
                    <p className="text-xs text-gray-400 italic px-1 py-2">{t('favorites.empty')}</p>
                )}

                {favorites.map((fav, index) => (
                    <Fragment key={fav.id}>
                        {shouldShowPlaceholder(index) && (
                            <div className="h-9 rounded-md border border-dashed border-indigo-300 bg-indigo-50 shrink-0" />
                        )}
                        <FavoriteItem
                            favorite={fav}
                            isCopied={copiedId === fav.id}
                            isDragging={draggingId === fav.id}
                            isRenaming={renamingId === fav.id}
                            renameValue={renameValue}
                            onCopy={() => handleCopy(fav)}
                            onStartRename={() => startRename(fav)}
                            onRenameChange={setRenameValue}
                            onRenameSubmit={() => void commitRename(fav.id)}
                            onRenameKeyDown={(e) => {
                                if (e.key === 'Enter') void commitRename(fav.id);
                                else if (e.key === 'Escape') setRenamingId(null);
                            }}
                            onDelete={() => void handleDelete(fav.id)}
                            onDragStart={(e) => handleItemDragStart(e, fav)}
                            onDragOver={(e) => handleItemDragOver(e, index)}
                            onDrop={handleItemDrop}
                        />
                    </Fragment>
                ))}
                {shouldShowPlaceholder(favorites.length) && (
                    <div className="h-9 rounded-md border border-dashed border-indigo-300 bg-indigo-50 shrink-0" />
                )}
            </div>

            {/* Zone d'ajout */}
            <div className="px-2 py-2 border-t border-gray-200 shrink-0">
                {isAdding ? (
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1">
                            <Input
                                ref={addInputRef}
                                value={addInput}
                                onChange={(e) => { setAddInput(e.target.value); setAddError(null); }}
                                onKeyDown={handleAddKeyDown}
                                placeholder={t('favorites.add_placeholder')}
                                disabled={isAddLoading}
                                className={cn(
                                    'h-7 text-xs font-mono',
                                    addError ? 'border-red-400 bg-red-50 focus-visible:ring-red-400' : '',
                                )}
                            />
                            <Button
                                size="icon"
                                onClick={() => void submitAdd()}
                                disabled={isAddLoading}
                                className="h-7 w-7 shrink-0 bg-indigo-600 hover:bg-indigo-700"
                            >
                                <Check className="h-3 w-3" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={cancelAdd}
                                disabled={isAddLoading}
                                className="h-7 w-7 shrink-0"
                            >
                                <X className="h-3 w-3" />
                            </Button>
                        </div>
                        {addError && <p className="text-[10px] text-red-500 px-1">{addError}</p>}
                    </div>
                ) : (
                    <Button
                        variant="ghost"
                        onClick={openAdd}
                        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-indigo-600 w-full justify-start px-1 h-auto py-1"
                    >
                        <Plus className="h-3 w-3" />
                        <span>{t('favorites.add_hint')}</span>
                    </Button>
                )}
            </div>
        </aside>
    );
}

// ── Item ────────────────────────────────────────────────────────────────────

interface FavoriteItemProps {
    favorite: FavoriteTicket;
    isCopied: boolean;
    isDragging: boolean;
    isRenaming: boolean;
    renameValue: string;
    onCopy: () => void;
    onStartRename: () => void;
    onRenameChange: (v: string) => void;
    onRenameSubmit: () => void;
    onRenameKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    onDelete: () => void;
    onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
    onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
}

function FavoriteItem({
    favorite,
    isCopied,
    isDragging,
    isRenaming,
    renameValue,
    onCopy,
    onStartRename,
    onRenameChange,
    onRenameSubmit,
    onRenameKeyDown,
    onDelete,
    onDragStart,
    onDragOver,
    onDrop,
}: FavoriteItemProps) {
    const typeStyle = getTicketTypeStyle(favorite.ticketType);
    const displayName = favorite.customName ?? favorite.ticketSummary ?? favorite.ticketKey;
    const renameInputRef = useRef<HTMLInputElement>(null);

    const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const renameCooldownRef = useRef(false);
    const wasRenamingRef = useRef(false);

    useEffect(() => {
        if (isRenaming) {
            wasRenamingRef.current = true;
            setTimeout(() => renameInputRef.current?.select(), 0);
            return;
        }
        if (wasRenamingRef.current) {
            wasRenamingRef.current = false;
            renameCooldownRef.current = true;
            const timer = setTimeout(() => { renameCooldownRef.current = false; }, 300);
            return () => clearTimeout(timer);
        }
    }, [isRenaming]);

    function handleClick() {
        if (isRenaming || renameCooldownRef.current) return;
        if (clickTimerRef.current) return;
        clickTimerRef.current = setTimeout(() => {
            clickTimerRef.current = null;
            onCopy();
        }, 200);
    }

    function handleDoubleClick() {
        if (clickTimerRef.current) {
            clearTimeout(clickTimerRef.current);
            clickTimerRef.current = null;
        }
        onStartRename();
    }

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <div
                    draggable={!isRenaming}
                    style={isDragging ? { display: 'none' } : undefined}
                    className={cn(
                        'group flex items-center gap-1 rounded-md border border-gray-200 bg-white hover:bg-gray-50',
                        'cursor-pointer transition-colors overflow-hidden border-l-2',
                        typeStyle.leftBorder,
                    )}
                    onClick={handleClick}
                    onDoubleClick={handleDoubleClick}
                    onDragStart={onDragStart}
                    onDragOver={onDragOver}
                    onDrop={onDrop}
                >
                    {/* Poignée drag */}
                    <div
                        className="pl-1 py-2 text-gray-300 hover:text-gray-400 shrink-0 cursor-grab active:cursor-grabbing"
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                    >
                        <GripVertical className="w-3 h-3" />
                    </div>

                    {/* Contenu */}
                    <div className="flex flex-col min-w-0 flex-1 py-1.5">
                        <span className={cn('text-[10px] font-mono leading-none', typeStyle.ticketKey)}>
                            {favorite.ticketKey}
                        </span>
                        {isRenaming ? (
                            <input
                                ref={renameInputRef}
                                value={renameValue}
                                onChange={(e) => onRenameChange(e.target.value)}
                                onKeyDown={onRenameKeyDown}
                                onBlur={onRenameSubmit}
                                placeholder={t('favorites.rename_placeholder')}
                                className="text-xs bg-transparent border-b border-indigo-400 outline-none w-full mt-0.5 placeholder:text-gray-400 text-gray-700"
                                onClick={(e) => e.stopPropagation()}
                            />
                        ) : (
                            <span className="text-xs text-gray-600 truncate leading-snug mt-0.5">
                                {isCopied ? (
                                    <span className="text-gray-500 font-medium">{t('favorites.copied')}</span>
                                ) : displayName}
                            </span>
                        )}
                    </div>

                    {/* Actions au hover */}
                    <div className="flex items-center pr-1 shrink-0 self-stretch opacity-0 group-hover:opacity-100 transition-opacity gap-0.5">
                        {!isRenaming && (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={(e) => { e.stopPropagation(); onStartRename(); }}
                                className="h-6 w-6 text-gray-300 hover:text-indigo-500"
                            >
                                <Pencil className="w-3 h-3" />
                            </Button>
                        )}
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => { e.stopPropagation(); onDelete(); }}
                            className="h-6 w-6 text-gray-300 hover:text-red-500"
                        >
                            <X className="w-3 h-3" />
                        </Button>
                    </div>
                </div>
            </TooltipTrigger>
            {!isRenaming && (
                <TooltipContent side="right">
                    {displayName} — {t('favorites.copy_tooltip')}
                </TooltipContent>
            )}
        </Tooltip>
    );
}
