import { useEffect, useRef, useState } from 'react';
import { EntryType } from '@/types/api';
import type { JiraTicketInfo, TimeEntry } from '@/types/api';
import { getTicketTypeStyle } from '@/config/ticketTypeColors';
import { fetchTicketInfo, getCachedTicketInfo } from '@/services/jiraService';
import { formatMinutes } from '@/utils/timeline';
import { t } from '@/i18n/fr';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from '@/components/ui/context-menu';
import type { SlotRunInfo } from './Timeline';

interface TimeBlockProps {
    slot: string;
    entry: TimeEntry | null;
    runInfo: SlotRunInfo;
    isEditing: boolean;
    isSelected: boolean;
    hasClipboard: boolean;
    knownTickets: Record<string, JiraTicketInfo>;
    onSelect: (e: React.MouseEvent) => void;
    onStartEdit: () => void;
    onSave: (ticketKey: string | null, type: EntryType, comment: string | null, ticketSummary: string | null, ticketType: string | null) => void;
    onCancel: () => void;
    onCopy: () => void;
    onCut: () => void;
    onPaste: () => void;
    onClear: () => void;
    onConvertToBreak: () => void;
    onContextMenuOpen: () => void;
    onCellMouseDown: (e: React.MouseEvent) => void;
    onDragExtend: () => void;
    onDropFavorite: () => void;
}

export default function TimeBlock({
    slot,
    entry,
    runInfo,
    isEditing,
    isSelected,
    hasClipboard,
    knownTickets,
    onSelect,
    onStartEdit,
    onSave,
    onCancel,
    onCopy,
    onCut,
    onPaste,
    onClear,
    onConvertToBreak,
    onContextMenuOpen,
    onCellMouseDown,
    onDragExtend,
    onDropFavorite,
}: TimeBlockProps) {
    const [commentValue, setCommentValue] = useState('');
    const [ticketError, setTicketError] = useState(false);
    const [ticketFetchError, setTicketFetchError] = useState<string | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);

    const [localSummary, setLocalSummary] = useState<string | null>(entry?.ticketSummary ?? null);
    const [localTicketType, setLocalTicketType] = useState<string | null>(entry?.ticketType ?? null);
    const [isFetchingTicket, setIsFetchingTicket] = useState(false);
    const [isErrored, setIsErrored] = useState(false);

    const isFetchingTicketRef = useRef(false);
    const isEditingRef = useRef(isEditing);
    isEditingRef.current = isEditing;

    const inputRef = useRef<HTMLInputElement>(null);
    const commentRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setLocalSummary(entry?.ticketSummary ?? null);
        setLocalTicketType(entry?.ticketType ?? null);
    }, [entry?.id, entry?.ticketSummary, entry?.ticketType]);

    useEffect(() => {
        if (isEditing) {
            if (inputRef.current) {
                inputRef.current.value = entry?.type === EntryType.BREAK ? '' : (entry?.ticketKey ?? '');
            }
            setCommentValue(entry?.type === EntryType.BREAK ? '' : (entry?.comment ?? ''));
            setLocalSummary(entry?.ticketSummary ?? null);
            setLocalTicketType(entry?.ticketType ?? null);
            setIsErrored(false);
            setTimeout(() => inputRef.current?.focus(), 0);
        } else {
            setTicketError(false);
            setTicketFetchError(null);
        }
    }, [isEditing, entry]);

    function handleTicketInput() {
        setTicketError(false);
        setTicketFetchError(null);
        const rawValue = inputRef.current?.value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '') ?? '';
        if (!rawValue) { setLocalTicketType(null); setLocalSummary(null); return; }
        const cached = getCachedTicketInfo(rawValue, knownTickets);
        if (cached) {
            setLocalTicketType(cached.type);
            setLocalSummary(cached.summary);
        } else if (rawValue !== (entry?.ticketKey ?? '')) {
            setLocalTicketType(null);
            setLocalSummary(null);
        }
    }

    async function doFetchTicketInfo(rawValue: string): Promise<{ summary: string | null; type: string | null; error: string | null }> {
        if (!rawValue) { setLocalSummary(null); setLocalTicketType(null); return { summary: null, type: null, error: null }; }
        if (rawValue === entry?.ticketKey && entry.ticketSummary) {
            return { summary: entry.ticketSummary, type: entry.ticketType ?? null, error: null };
        }
        isFetchingTicketRef.current = true;
        setIsFetchingTicket(true);
        try {
            const info = await fetchTicketInfo(rawValue, knownTickets);
            if (info) {
                setLocalSummary(info.summary);
                setLocalTicketType(info.type);
                setTicketFetchError(null);
                return { summary: info.summary, type: info.type, error: null };
            } else {
                if (rawValue !== entry?.ticketKey) { setLocalSummary(null); setLocalTicketType(null); }
                return { summary: null, type: null, error: null };
            }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : t('timeline.ticket_fetch_error');
            setLocalSummary(null);
            setLocalTicketType(null);
            setTicketFetchError(errorMsg);
            if (!isEditingRef.current) setIsErrored(true);
            return { summary: null, type: null, error: errorMsg };
        } finally {
            isFetchingTicketRef.current = false;
            setIsFetchingTicket(false);
        }
    }

    async function handleTicketBlur() {
        const rawValue = inputRef.current?.value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '') ?? '';
        await doFetchTicketInfo(rawValue);
    }

    function save() {
        const ticketKey = inputRef.current?.value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '') || null;
        const comment = commentValue.trim() || null;
        if (ticketFetchError !== null) return;
        if (ticketKey === null) {
            if (comment !== null) { setTicketError(true); }
            else if (entry?.type === EntryType.BREAK) { onCancel(); }
            else if (entry) { onClear(); }
            else { onCancel(); }
            return;
        }
        setTicketError(false);
        onSave(ticketKey, EntryType.WORK, comment, localSummary, localTicketType);
    }

    function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            if (isFetchingTicketRef.current) { onCancel(); return; }
            if (ticketFetchError !== null) { setIsErrored(true); onCancel(); return; }
            save();
        }
    }

    async function handleTicketKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter') {
            const rawValue = inputRef.current?.value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '') ?? '';
            const comment = commentValue.trim() || null;
            const ticketKey = rawValue || null;
            if (ticketKey === null) {
                if (comment !== null) setTicketError(true);
                else if (entry?.type === EntryType.BREAK) onCancel();
                else if (entry) onClear();
                else onCancel();
                return;
            }
            const { summary, type, error } = await doFetchTicketInfo(rawValue);
            if (error !== null) return;
            setTicketError(false);
            onSave(ticketKey, EntryType.WORK, comment, summary, type);
        } else if (e.key === 'Tab') {
            e.preventDefault();
            commentRef.current?.focus();
        } else if (e.key === 'Escape') {
            onCancel();
        }
    }

    function handleCommentKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter') save();
        else if (e.key === 'Escape') onCancel();
    }

    // ── Styles ────────────────────────────────────────────────────────────────

    const isWork = entry?.type === EntryType.WORK;
    const isBreak = entry?.type === EntryType.BREAK;
    const resolvedTicketType = isWork ? (entry?.ticketType ?? localTicketType) : null;
    const ticketStyle = isWork ? getTicketTypeStyle(resolvedTicketType) : null;

    const { position, runDurationMinutes } = runInfo;
    const isRunFirst = position === 'first' || position === 'sole';
    const isRunLast = position === 'last' || position === 'sole';

    // Fond et bordure selon état
    const blockBg = entry
        ? isBreak
            ? 'bg-gray-50 hover:bg-gray-100'
            : isErrored
                ? 'bg-red-50 hover:bg-red-100'
                : (ticketStyle?.blockBg ?? 'bg-indigo-50') + ' hover:brightness-95'
        : isEditing
            ? 'bg-white'
            : 'bg-white hover:bg-gray-50';

    // Indicateur gauche coloré : div bg-{color} de 4px, sur toutes les cellules avec entrée.
    // On n'utilise pas border-l-{color} car tailwind-merge peut confondre width et color (même préfixe).
    const leftIndicatorBg = entry
        ? isBreak
            ? 'bg-gray-400'
            : isErrored
                ? 'bg-red-400'
                : (ticketStyle?.dotColor ?? 'bg-indigo-400')
        : 'bg-transparent';

    // Bordure séparatrice uniquement en bas du dernier créneau d'un bloc ou d'un créneau vide.
    // Pas de border-b (même transparent) à l'intérieur d'un bloc : ça laisserait une ligne blanche.
    const bottomBorderClass = isRunLast || !entry
        ? 'border-b border-gray-100'
        : '';

    const selectedStyle = isSelected
        ? entry
            ? isBreak
                ? 'ring-2 ring-inset ring-gray-400'
                : isErrored
                    ? 'ring-2 ring-inset ring-red-400'
                    : (ticketStyle?.ring ?? 'ring-2 ring-inset ring-indigo-400')
            : 'ring-2 ring-inset ring-gray-400'
        : '';

    // ── Affichage lecture ────────────────────────────────────────────────────

    /** Contenu visible uniquement sur la première cellule d'un bloc */
    function renderDisplayContent() {
        if (!entry) return null;
        if (!isRunFirst) {
            // Cellule intermédiaire ou dernière : affiche uniquement la durée si c'est la dernière
            if (isRunLast && runDurationMinutes > 15) {
                return (
                    <div className="flex justify-end items-center h-full pr-2">
                        <span className="text-[10px] font-mono text-gray-400 select-none">
                            {formatMinutes(runDurationMinutes)}
                        </span>
                    </div>
                );
            }
            return null;
        }

        if (isBreak) {
            return (
                <div className="flex items-center justify-between w-full">
                    <span className="text-xs font-mono text-gray-700">{t('timeline.break_label')}</span>
                    {isRunLast && runDurationMinutes > 15 && (
                        <span className="text-[10px] font-mono text-gray-500 select-none">
                            {formatMinutes(runDurationMinutes)}
                        </span>
                    )}
                </div>
            );
        }

        if (!entry.ticketKey) return null;

        const keyColor = isErrored ? 'text-red-600' : (ticketStyle?.ticketKey ?? 'text-indigo-700');
        const summaryColor = ticketStyle?.summary ?? 'text-gray-500';
        const commentColor = ticketStyle?.comment ?? 'text-gray-800';

        const hasSummary = Boolean(entry.ticketSummary);
        const hasComment = Boolean(entry.comment);

        return (
            <div className="flex items-stretch gap-2 w-full min-w-0 h-full">
                {/* Ticket key */}
                <span className={cn('w-24 text-xs font-mono font-medium shrink-0 self-center', keyColor)}>
                    {entry.ticketKey}
                </span>

                {(hasSummary || hasComment) && (
                    <span className="border-l border-gray-300 self-stretch shrink-0" />
                )}

                {/* Summary + comment */}
                {hasSummary || hasComment ? (
                    <div className={cn('flex flex-col justify-center min-w-0 flex-1', hasSummary && hasComment ? 'gap-0.5' : '')}>
                        {hasSummary && (
                            <span className={cn('font-mono truncate leading-none', hasComment ? cn('text-[10px]', summaryColor) : cn('text-xs', commentColor))}>
                                {entry.ticketSummary}
                            </span>
                        )}
                        {hasComment && (
                            <span className={cn('text-xs font-mono truncate leading-none', commentColor)}>
                                {entry.comment}
                            </span>
                        )}
                    </div>
                ) : null}

                {/* Durée en fin de bloc */}
                {isRunLast && runDurationMinutes > 15 && (
                    <span className="text-[10px] font-mono text-gray-400 shrink-0 self-center select-none ml-auto">
                        {formatMinutes(runDurationMinutes)}
                    </span>
                )}
            </div>
        );
    }

    // ── Affichage édition ────────────────────────────────────────────────────

    function renderEditContent() {
        const editStyle = getTicketTypeStyle(localTicketType);
        const keyColor = ticketFetchError !== null ? 'text-red-600' : editStyle.ticketKey;
        const summaryColor = editStyle.summary;

        return (
            <div
                className="flex items-stretch gap-2 w-full"
                onClick={(e) => e.stopPropagation()}
                onBlur={handleBlur}
            >
                <input
                    ref={inputRef}
                    onInput={handleTicketInput}
                    onKeyDown={handleTicketKeyDown}
                    onBlur={handleTicketBlur}
                    placeholder={t('timeline.ticket_placeholder')}
                    className={cn(
                        'w-24 shrink-0 p-0 text-xs bg-transparent outline-none font-mono uppercase font-medium self-center',
                        ticketError ? 'placeholder:text-red-500' : 'placeholder:text-gray-400',
                        keyColor,
                    )}
                />

                <span className="border-l border-dashed border-gray-300 self-stretch shrink-0" />

                <div className="flex flex-col flex-1 min-w-0 justify-center gap-0.5">
                    {ticketFetchError ? (
                        <span className={cn('text-[10px] font-mono leading-tight truncate', keyColor)}>
                            {ticketFetchError}
                        </span>
                    ) : ticketError ? (
                        <span className="text-[10px] font-mono text-red-600 leading-tight truncate">
                            {t('timeline.ticket_required')}
                        </span>
                    ) : localSummary ? (
                        <div className={cn('flex items-center gap-1 text-[10px] font-mono leading-tight', summaryColor)}>
                            <span className="truncate select-text cursor-text" tabIndex={-1}>{localSummary}</span>
                            {isFetchingTicket && (
                                <span className="shrink-0 w-2.5 h-2.5 border border-current border-t-transparent rounded-full animate-spin opacity-60" />
                            )}
                        </div>
                    ) : null}
                    <div className="flex items-center gap-1">
                        {isFetchingTicket && !localSummary && !ticketFetchError && (
                            <span className="shrink-0 w-2.5 h-2.5 border border-gray-400 border-t-transparent rounded-full animate-spin" />
                        )}
                        <input
                            ref={commentRef}
                            value={commentValue}
                            onChange={(e) => setCommentValue(e.target.value)}
                            onKeyDown={handleCommentKeyDown}
                            placeholder={t('timeline.comment_placeholder')}
                            className="flex-1 text-xs bg-transparent outline-none font-mono text-gray-800 placeholder:text-gray-400"
                        />
                    </div>
                </div>

                <div className="flex items-center gap-0.5 shrink-0">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onSave(null, EntryType.BREAK, null, null, null)}
                        className="h-6 px-1.5 text-xs text-amber-600 hover:text-amber-800 hover:bg-amber-50"
                        title={t('timeline.break_label')}
                    >
                        P
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); entry ? onClear() : onCancel(); }}
                        className="h-6 px-1.5 text-xs text-gray-400 hover:text-red-500 hover:bg-red-50"
                    >
                        ✕
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <ContextMenu onOpenChange={(open) => { if (open) onContextMenuOpen(); }}>
            <ContextMenuTrigger asChild>
                <div
                    className={cn(
                        'relative flex cursor-pointer select-none overflow-hidden',
                        isEditing ? 'min-h-8' : 'h-8',
                        blockBg,
                        bottomBorderClass,
                        selectedStyle,
                        isDragOver ? 'ring-2 ring-inset ring-indigo-400 bg-indigo-50' : '',
                    )}
                    onClick={(e) => { e.stopPropagation(); if (!isEditing) onSelect(e); }}
                    onDoubleClick={() => !isEditing && onStartEdit()}
                    onMouseDown={(e) => { if (!isEditing) onCellMouseDown(e); }}
                    onMouseEnter={() => onDragExtend()}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setIsDragOver(true); }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={(e) => {
                        e.preventDefault();
                        setIsDragOver(false);
                        if (e.dataTransfer.getData('application/daytrack-favorite')) onDropFavorite();
                    }}
                >
                    {/* Indicateur de couleur gauche (4px) */}
                    <div className={cn('w-1 shrink-0 self-stretch', leftIndicatorBg)} />
                    {/* Contenu */}
                    <div className={cn('flex flex-1 min-w-0 items-center px-2', isEditing && 'py-1')}>
                        {isEditing ? renderEditContent() : renderDisplayContent()}
                    </div>
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
                {entry && <ContextMenuItem onClick={onCopy}>{t('timeline.copy')}</ContextMenuItem>}
                {entry && <ContextMenuItem onClick={onCut}>{t('timeline.cut')}</ContextMenuItem>}
                {hasClipboard && <ContextMenuItem onClick={onPaste}>{t('timeline.paste')}</ContextMenuItem>}
                {entry?.type !== EntryType.BREAK && (
                    <ContextMenuItem onClick={onConvertToBreak}>{t('timeline.convert_to_break')}</ContextMenuItem>
                )}
                {entry && <ContextMenuSeparator />}
                {entry && <ContextMenuItem variant="destructive" onClick={onClear}>{t('timeline.clear')}</ContextMenuItem>}
            </ContextMenuContent>
        </ContextMenu>
    );
}
