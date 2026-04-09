import { useState, useRef, useEffect, Fragment } from 'react';
import { EntryType } from '../types/api';
import type { FavoriteTicket } from '../types/api';
import { t } from '../i18n/fr';
import { getTicketTypeStyle } from '../config/ticketTypeColors';
import * as favoriteService from '../services/favoriteService';

const COLLAPSE_KEY = 'daytrack_favorites_collapsed';

/** Déplace un élément d'un tableau (immuable). */
function arrayMove<T>(arr: T[], from: number, to: number): T[] {
    const result = [...arr];
    const [item] = result.splice(from, 1);
    result.splice(to, 0, item);
    return result;
}

/** Écrit un favori dans le presse-papier interne de la timeline.
 *  On colle ticketSummary (nom Jira original) et ticketType — jamais le customName. */
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
    // Notifie la Timeline que le presse-papier a changé
    window.dispatchEvent(new CustomEvent('daytrack:clipboard-changed'));
}

interface FavoriteTicketsProps {
    favorites: FavoriteTicket[];
    onChange: (favorites: FavoriteTicket[]) => void;
}

export default function FavoriteTickets({ favorites, onChange }: FavoriteTicketsProps) {
    const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === 'true');
    const [isAdding, setIsAdding] = useState(false);
    const [addInput, setAddInput] = useState('');
    const [addError, setAddError] = useState<string | null>(null);
    const [isAddLoading, setIsAddLoading] = useState(false);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [renameError, setRenameError] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    // État du drag natif pour le réordonnancement
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dropIndex, setDropIndex] = useState<number | null>(null);

    const addInputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // Ref toujours à jour — permet de lire l'état courant du renommage sans stale closures
    const renameCallbackRef = useRef<(() => void) | null>(null);
    renameCallbackRef.current = renamingId
        ? () => {
            const trimmed = renameValue.trim();
            const id = renamingId;
            setRenamingId(null);
            setRenameError(false);
            if (trimmed) {
                void favoriteService.renameFavorite(id, trimmed)
                    .then((updated) => onChange(favorites.map((f) => (f.id === id ? updated : f))))
                    .catch(() => null);
            }
        }
        : null;

    // Ferme le renommage sur mousedown en dehors du composant
    useEffect(() => {
        function handleOutsideMouseDown(e: MouseEvent) {
            if (containerRef.current?.contains(e.target as Node)) return;
            renameCallbackRef.current?.();
        }
        document.addEventListener('mousedown', handleOutsideMouseDown);
        return () => document.removeEventListener('mousedown', handleOutsideMouseDown);
    }, []);

    function toggleCollapse() {
        const next = !collapsed;
        setCollapsed(next);
        localStorage.setItem(COLLAPSE_KEY, String(next));
    }

    // Focalise l'input d'ajout dès qu'il apparaît
    useEffect(() => {
        if (isAdding) {
            setTimeout(() => addInputRef.current?.focus(), 0);
        }
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
        setRenameError(false);
    }

    /** Sauvegarde le nouveau nom (nom non vide garanti par l'appelant). */
    async function doRename(id: string, name: string): Promise<void> {
        try {
            const updated = await favoriteService.renameFavorite(id, name);
            onChange(favorites.map((f) => (f.id === id ? updated : f)));
        } catch {
            // Revert silencieux
        } finally {
            setRenamingId(null);
            setRenameError(false);
        }
    }

    /** Appelé au blur : sauvegarde si nom valide, revert immédiat si vide. */
    function handleRenameBlur(id: string) {
        const trimmed = renameValue.trim();
        if (!trimmed) {
            setRenameError(false);
            setRenamingId(null);
            return;
        }
        void doRename(id, trimmed);
    }

    /** Appelé à la touche Entrée : montre l'erreur sans fermer si nom vide. */
    function handleRenameEnter(id: string) {
        const trimmed = renameValue.trim();
        if (!trimmed) {
            setRenameError(true);
            return;
        }
        void doRename(id, trimmed);
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

    // ─── Drag natif — réordonnancement et dépôt sur la timeline ─────────────

    function handleItemDragStart(e: React.DragEvent<HTMLDivElement>, fav: FavoriteTicket) {
        e.dataTransfer.effectAllowed = 'copyMove';
        e.dataTransfer.setData('application/daytrack-favorite', fav.id);
        writeToTimelineClipboard(fav);
        // Léger délai pour que le ghost du navigateur soit rendu avant que React applique opacity
        setTimeout(() => setDraggingId(fav.id), 0);
    }

    function handleItemDragOver(e: React.DragEvent<HTMLDivElement>, index: number) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        setDropIndex(e.clientY < midY ? index : index + 1);
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

    /** Efface l'indicateur uniquement si le curseur quitte vraiment la liste. */
    function handleListDragLeave(e: React.DragEvent<HTMLDivElement>) {
        if (!listRef.current?.contains(e.relatedTarget as Node)) {
            setDropIndex(null);
        }
    }

    function resetDrag() {
        setDraggingId(null);
        setDropIndex(null);
    }

    // Filet de sécurité : si dragend ne remonte pas (élément source retiré du DOM pendant le drag),
    // on remet l'état à zéro via un listener document
    const resetDragRef = useRef(resetDrag);
    resetDragRef.current = resetDrag;
    useEffect(() => {
        function handleDragEnd() { resetDragRef.current(); }
        document.addEventListener('dragend', handleDragEnd);
        return () => document.removeEventListener('dragend', handleDragEnd);
    }, []);

    /** Affiche le placeholder avant l'index donné quand on drag. */
    function shouldShowPlaceholder(beforeIndex: number): boolean {
        return draggingId !== null && dropIndex === beforeIndex;
    }

    return (
        <div ref={containerRef} className="border-t border-gray-200 pt-3 flex flex-col gap-2">
            {/* En-tête avec collapse */}
            <button
                onClick={toggleCollapse}
                className="flex items-center justify-between w-full group"
            >
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {t('favorites.title')}
                </span>
                <svg
                    className={`w-3.5 h-3.5 text-gray-400 transition-transform ${collapsed ? '-rotate-90' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {!collapsed && (
                <div className="flex flex-col gap-1">
                    {favorites.length === 0 && !isAdding && (
                        <p className="text-xs text-gray-400 italic">{t('favorites.empty')}</p>
                    )}

                    <div
                        ref={listRef}
                        className="flex flex-col gap-1"
                        onDragLeave={handleListDragLeave}
                        onDragEnd={resetDrag}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={handleItemDrop}
                    >
                        {favorites.map((fav, index) => (
                            <Fragment key={fav.id}>
                                {shouldShowPlaceholder(index) && (
                                    <div className="h-10 rounded-md border border-dashed border-indigo-300 bg-indigo-50 shrink-0" />
                                )}
                                <FavoriteItem
                                    favorite={fav}
                                    isCopied={copiedId === fav.id}
                                    isDragging={draggingId === fav.id}
                                    isRenaming={renamingId === fav.id}
                                    renameValue={renameValue}
                                    isRenameError={renameError && renamingId === fav.id}
                                    onCopy={() => handleCopy(fav)}
                                    onStartRename={() => startRename(fav)}
                                    onRenameChange={setRenameValue}
                                    onRenameSubmit={() => handleRenameBlur(fav.id)}
                                    onRenameKeyDown={(e) => {
                                        if (e.key === 'Enter') handleRenameEnter(fav.id);
                                        else if (e.key === 'Escape') { setRenamingId(null); setRenameError(false); }
                                    }}
                                    onDelete={() => void handleDelete(fav.id)}
                                    onDragStart={(e) => handleItemDragStart(e, fav)}
                                    onDragOver={(e) => handleItemDragOver(e, index)}
                                    onDrop={handleItemDrop}
                                />
                            </Fragment>
                        ))}
                        {shouldShowPlaceholder(favorites.length) && (
                            <div className="h-10 rounded-md border border-dashed border-indigo-300 bg-indigo-50 shrink-0" />
                        )}
                    </div>

                    {/* Formulaire d'ajout inline */}
                    {isAdding ? (
                        <div className="flex flex-col gap-1 mt-1">
                            <div className="flex items-center gap-1">
                                <input
                                    ref={addInputRef}
                                    value={addInput}
                                    onChange={(e) => { setAddInput(e.target.value); setAddError(null); }}
                                    onKeyDown={handleAddKeyDown}
                                    placeholder={t('favorites.add_placeholder')}
                                    disabled={isAddLoading}
                                    className={`flex-1 text-xs font-mono px-2 py-1.5 rounded border outline-none transition-colors ${
                                        addError
                                            ? 'border-red-400 bg-red-50'
                                            : 'border-indigo-400 bg-white focus:border-indigo-500'
                                    }`}
                                />
                                <button
                                    onClick={() => void submitAdd()}
                                    disabled={isAddLoading}
                                    className="px-2 py-1.5 text-xs rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors shrink-0"
                                >
                                    {isAddLoading ? '…' : '✓'}
                                </button>
                                <button
                                    onClick={cancelAdd}
                                    disabled={isAddLoading}
                                    className="px-2 py-1.5 text-xs rounded bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors shrink-0"
                                >
                                    ✕
                                </button>
                            </div>
                            {addError && (
                                <p className="text-xs text-red-500">{addError}</p>
                            )}
                        </div>
                    ) : (
                        <button
                            onClick={openAdd}
                            className="flex items-center gap-1 text-xs text-gray-400 hover:text-indigo-600 transition-colors mt-0.5 w-fit"
                            title={t('favorites.add_hint')}
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            <span>{t('favorites.add_hint')}</span>
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

interface FavoriteItemProps {
    favorite: FavoriteTicket;
    isCopied: boolean;
    isDragging: boolean;
    isRenaming: boolean;
    renameValue: string;
    isRenameError: boolean;
    onCopy: () => void;
    onStartRename: () => void;
    onRenameChange: (value: string) => void;
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
    isRenameError,
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
    const tooltipText = `${displayName}\n${t('favorites.copy_tooltip')}`;
    const renameInputRef = useRef<HTMLInputElement>(null);

    // Timer pour discriminer simple clic (copie) et double-clic (renommage)
    const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Cooldown post-renommage : évite une copie accidentelle au clic qui ferme le mode rename
    const renameCooldownRef = useRef(false);
    const wasRenamingRef = useRef(false);

    useEffect(() => {
        if (isRenaming) {
            wasRenamingRef.current = true;
            setTimeout(() => renameInputRef.current?.select(), 0);
            return;
        }
        if (wasRenamingRef.current) {
            // Transition isRenaming true → false : blindage contre la copie accidentelle
            wasRenamingRef.current = false;
            renameCooldownRef.current = true;
            const timer = setTimeout(() => { renameCooldownRef.current = false; }, 300);
            return () => clearTimeout(timer);
        }
    }, [isRenaming]);

    function handleContentClick() {
        if (isRenaming || renameCooldownRef.current) return;
        if (clickTimerRef.current) return;
        clickTimerRef.current = setTimeout(() => {
            clickTimerRef.current = null;
            onCopy();
        }, 200);
    }

    function handleContentDoubleClick() {
        if (clickTimerRef.current) {
            clearTimeout(clickTimerRef.current);
            clickTimerRef.current = null;
        }
        onStartRename();
    }

    return (
        <div
            draggable={!isRenaming}
            style={isDragging ? { display: 'none' } : undefined}
            className={`group flex items-center gap-1 rounded-md border border-gray-200 border-l-2 ${typeStyle.leftBorder} bg-gray-50 hover:bg-white transition-colors overflow-hidden`}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
        >
            {/* Poignée — curseur grab pour indiquer le point de saisie du drag */}
            <div className="px-1 py-1.5 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-400 shrink-0 touch-none">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm8 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm8 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 22a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm8 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
                </svg>
            </div>

            {/* Contenu — clic simple : copie, double-clic : renommage */}
            <button
                className="flex flex-col min-w-0 flex-1 py-1.5 text-left"
                onClick={handleContentClick}
                onDoubleClick={handleContentDoubleClick}
                title={isRenaming ? undefined : tooltipText}
            >
                <span className={`text-[10px] font-mono leading-none ${typeStyle.ticketKey}`}>
                    {favorite.ticketKey}
                </span>
                {isRenaming ? (
                    <div className="flex flex-col">
                        <input
                            ref={renameInputRef}
                            value={renameValue}
                            onChange={(e) => onRenameChange(e.target.value)}
                            onKeyDown={onRenameKeyDown}
                            onBlur={onRenameSubmit}
                            placeholder={t('favorites.rename_placeholder')}
                            className={`text-xs bg-transparent border-b outline-none w-full mt-0.5 placeholder:text-gray-400 ${
                                isRenameError ? 'border-red-400 text-red-500' : 'border-indigo-400 text-gray-700'
                            }`}
                            onClick={(e) => e.stopPropagation()}
                        />
                        {isRenameError && (
                            <span className="text-[10px] text-red-500 mt-0.5">{t('favorites.rename_empty')}</span>
                        )}
                    </div>
                ) : (
                    <span className="text-xs text-gray-700 truncate leading-snug mt-0.5">
                        {isCopied ? (
                            <span className="text-gray-500 font-medium">{t('favorites.copied')}</span>
                        ) : (
                            displayName
                        )}
                    </span>
                )}
            </button>

            {/* Actions visibles au hover */}
            <div className="flex items-center gap-0.5 pr-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                {/* Renommer */}
                {!isRenaming && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onStartRename(); }}
                        className="p-1 rounded text-gray-300 hover:text-indigo-500 transition-colors"
                        title="Renommer"
                    >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-1.414A2 2 0 019.586 13z" />
                        </svg>
                    </button>
                )}
                {/* Supprimer */}
                <button
                    onClick={(e) => { e.stopPropagation(); onDelete(); }}
                    className="p-1 rounded text-gray-300 hover:text-red-500 transition-colors"
                    title="Supprimer"
                >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>
        </div>
    );
}
