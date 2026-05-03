import { useRef, useEffect, Fragment, type KeyboardEvent, type DragEvent } from 'react';
import { Plus, Trash2, Pencil, GripVertical } from 'lucide-react';
import type { FavoriteTicket } from '@/types/api';
import { t } from '@/i18n/fr';
import { getTicketTypeStyle } from '@/config/ticketTypeColors';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import * as favoriteService from '@/services/favoriteService';
import { useFavoriteAdd } from '@/hooks/useFavoriteAdd';
import { useFavoriteRename } from '@/hooks/useFavoriteRename';
import { useFavoriteDragDrop } from '@/hooks/useFavoriteDragDrop';
import { useFavoriteCopy } from '@/hooks/useFavoriteCopy';

interface FavoritesPanelProps {
    favorites: FavoriteTicket[];
    onChange: (favorites: FavoriteTicket[]) => void;
}

export default function FavoritesPanel({ favorites, onChange }: FavoritesPanelProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    const add = useFavoriteAdd(favorites, onChange);
    const rename = useFavoriteRename(favorites, onChange, containerRef);
    const drag = useFavoriteDragDrop(favorites, onChange);
    const copy = useFavoriteCopy();

    async function handleDelete(id: string) {
        onChange(favorites.filter((f) => f.id !== id));
        try {
            await favoriteService.deleteFavorite(id);
        } catch {
            const res = await favoriteService.listFavorites().catch(() => null);
            if (res) onChange(res);
        }
    }

    return (
        <aside
            ref={containerRef}
            className="w-60 py-4 ps-2 pe-4 shrink-0 bg-neutral-50 border-r border-neutral-200 flex flex-col overflow-hidden"
        >
            {/* En-tête : titre à gauche aligné sur les pills, bouton "+" à droite */}
            <div className="pl-3 pb-2 shrink-0 flex items-center justify-between">
                <span className="text-xs font-semibold text-neutral-500">
                    {t('favorites.title')}
                </span>
                <Popover open={add.isAdding} onOpenChange={(open) => open ? add.openAdd() : add.cancelAdd()}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    className="text-gray-500 hover:text-gray-900"
                                    aria-label={t('favorites.add_hint')}
                                >
                                    <Plus className="h-3 w-3" />
                                </Button>
                            </PopoverTrigger>
                        </TooltipTrigger>
                        <TooltipContent side="right">{t('favorites.add_hint')}</TooltipContent>
                    </Tooltip>
                    <PopoverContent side="right" align="start" className="w-56 p-3 flex flex-col gap-2">
                        <p className="text-xs font-semibold text-gray-700">{t('favorites.add_title')}</p>
                        <div className="flex items-center gap-1">
                            <Input
                                ref={add.addInputRef}
                                value={add.addInput}
                                onChange={(e) => { add.setAddInput(e.target.value); }}
                                onKeyDown={add.handleAddKeyDown}
                                placeholder={t('favorites.add_placeholder')}
                                disabled={add.isAddLoading}
                                className={cn(
                                    'h-7 text-xs font-mono',
                                    add.addError ? 'border-red-400 bg-red-50 focus-visible:ring-red-400' : '',
                                )}
                            />
                            <Button
                                size="icon"
                                onClick={() => void add.submitAdd()}
                                disabled={add.isAddLoading}
                                className="h-7 w-7 shrink-0 bg-gray-900 enabled:hover:bg-gray-800"
                            >
                                <Plus className="h-3 w-3" />
                            </Button>
                        </div>
                        {add.addError && <p className="text-[10px] text-red-500">{add.addError}</p>}
                    </PopoverContent>
                </Popover>
            </div>

            {/* Liste — pl-4 pour laisser la place à la poignée externe */}
            <div
                ref={drag.listRef}
                className="flex-1 overflow-y-auto py-1 pl-3 pr-1 flex flex-col gap-2"
                onDragLeave={drag.handleListDragLeave}
                onDragEnd={drag.resetDrag}
                onDragOver={(e) => e.preventDefault()}
                onDrop={drag.handleItemDrop}
            >
                {favorites.length === 0 && (
                    <p className="text-xs text-gray-400 italic px-1 py-2">{t('favorites.empty')}</p>
                )}

                {favorites.map((fav, index) => (
                    <Fragment key={fav.id}>
                        {drag.shouldShowPlaceholder(index) && (
                            <div className="h-[50px] rounded-md border border-dashed border-gray-300 shrink-0" />
                        )}
                        <FavoriteItem
                            favorite={fav}
                            isCopied={copy.copiedId === fav.id}
                            isDragging={drag.draggingId === fav.id}
                            isDragInProgress={drag.isDragInProgress}
                            isRenaming={rename.renamingId === fav.id}
                            renameValue={rename.renameValue}
                            onCopy={() => copy.handleCopy(fav)}
                            onStartRename={() => rename.startRename(fav)}
                            onRenameChange={rename.onRenameChange}
                            onRenameSubmit={() => void rename.commitRename(fav.id)}
                            onRenameKeyDown={(e) => {
                                if (e.key === 'Enter') void rename.commitRename(fav.id);
                                else if (e.key === 'Escape') rename.setRenamingId(null);
                            }}
                            onDelete={() => void handleDelete(fav.id)}
                            onDragStart={(e) => drag.handleItemDragStart(e, fav)}
                            onDragOver={(e) => drag.handleItemDragOver(e, index)}
                            onDrop={drag.handleItemDrop}
                        />
                    </Fragment>
                ))}
                {drag.shouldShowPlaceholder(favorites.length) && (
                    <div className="h-[50px] rounded-md border border-dashed border-gray-300 shrink-0" />
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
    isDragInProgress: boolean;
    isRenaming: boolean;
    renameValue: string;
    onCopy: () => void;
    onStartRename: () => void;
    onRenameChange: (v: string) => void;
    onRenameSubmit: () => void;
    onRenameKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
    onDelete: () => void;
    onDragStart: (e: DragEvent<HTMLDivElement>) => void;
    onDragOver: (e: DragEvent<HTMLDivElement>) => void;
    onDrop: (e: DragEvent<HTMLDivElement>) => void;
}

function FavoriteItem({
    favorite,
    isCopied,
    isDragging,
    isDragInProgress,
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
                {/*
                  Wrapper : draggable depuis n'importe où (pill ou poignée).
                  La poignée est positionnée en absolu à gauche dans le pl-4 de la liste.
                */}
                <div
                    className="relative group"
                    draggable={!isRenaming}
                    style={isDragging ? { display: 'none' } : undefined}
                    onDragStart={onDragStart}
                    onDragOver={onDragOver}
                    onDrop={onDrop}
                >
                    {/* Poignée drag — à gauche du pill, masquée pendant tout drag */}
                    <div
                        className={cn(
                            'absolute left-0 -translate-x-full top-0 bottom-0',
                            'flex items-center cursor-grab active:cursor-grabbing transition-opacity',
                            isDragInProgress ? 'opacity-0' : 'opacity-0 group-hover:opacity-100',
                        )}
                    >
                        <GripVertical className="w-4 h-4 text-gray-400" />
                    </div>

                    {/* Pill */}
                    <div
                        className={cn(
                            'flex rounded-md shadow-sm overflow-hidden h-[50px]',
                            'cursor-pointer transition-colors',
                            typeStyle.blockBg,
                        )}
                        onClick={handleClick}
                        onDoubleClick={handleDoubleClick}
                    >
                        {/* Barre colorée gauche — non arrondie, clippée par overflow-hidden */}
                        <div className={cn('w-[4px] self-stretch shrink-0', typeStyle.barColor)} />

                        {/* Contenu + actions */}
                        <div className="flex items-stretch gap-0.5 flex-1 min-w-0 pr-2">
                            <div className="flex flex-col justify-between gap-0.5 min-w-0 flex-1 py-2 pl-2">
                                <span className={cn('text-xs font-semibold leading-none', typeStyle.ticketKey)}>
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
                                        className={cn(
                                            'text-xs bg-transparent border-b outline-none w-full placeholder:opacity-40',
                                            typeStyle.ticketKey,
                                            typeStyle.borderColor,
                                        )}
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                ) : (
                                    <span className={cn('text-xs truncate leading-snug', typeStyle.ticketKey)}>
                                        {isCopied ? (
                                            <span className="opacity-60 font-medium">{t('favorites.copied')}</span>
                                        ) : displayName}
                                    </span>
                                )}
                            </div>

                            {/* Actions au hover — icônes sans fond, opacité réduite par défaut */}
                            <div className="flex items-center shrink-0 self-stretch opacity-0 group-hover:opacity-100 transition-opacity">
                                {!isRenaming && (
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); onStartRename(); }}
                                        className={cn(
                                            'h-6 w-6 flex items-center justify-center rounded-sm',
                                            'transition-opacity opacity-50 hover:opacity-100 focus:outline-none',
                                            typeStyle.ticketKey,
                                        )}
                                    >
                                        <Pencil className="w-4 h-4 shrink-0" />
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); onDelete(); }}
                                    className={cn(
                                        'h-6 w-6 flex items-center justify-center rounded-sm',
                                        'transition-opacity opacity-50 hover:opacity-100 focus:outline-none',
                                        typeStyle.ticketKey,
                                    )}
                                >
                                    <Trash2 className="w-4 h-4 shrink-0" />
                                </button>
                            </div>
                        </div>
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
