import { useEffect, useRef, useState } from 'react';
import { EntryType } from '../types/api';
import type { JiraTicketInfo, TimeEntry } from '../types/api';
import { getTicketTypeStyle } from '../config/ticketTypeColors';
import { fetchTicketInfo, getCachedTicketInfo } from '../services/jiraService';
import { t } from '../i18n/fr';

interface TimeBlockProps {
    slot: string;
    entry: TimeEntry | null;
    isEditing: boolean;
    isSelected: boolean;
    noBottomBorder: boolean;
    hasClipboard: boolean;
    knownTickets: Record<string, JiraTicketInfo>;
    onSelect: (e: React.MouseEvent) => void;
    onStartEdit: () => void;
    onSave: (ticketKey: string | null, type: EntryType, comment: string | null, ticketSummary: string | null, ticketType: string | null) => void;
    onCancel: () => void;
    onCopy: () => void;
    onPaste: () => void;
    onClear: () => void;
    onConvertToBreak: () => void;
    onContextMenuOpen: () => void;
    onCellMouseDown: (e: React.MouseEvent) => void;
    onDragExtend: () => void;
}

export default function TimeBlock({
    entry,
    isEditing,
    isSelected,
    noBottomBorder,
    hasClipboard,
    knownTickets,
    onSelect,
    onStartEdit,
    onSave,
    onCancel,
    onCopy,
    onPaste,
    onClear,
    onConvertToBreak,
    onContextMenuOpen,
    onCellMouseDown,
    onDragExtend,
}: TimeBlockProps) {
    const [commentValue, setCommentValue] = useState('');
    const [ticketError, setTicketError] = useState(false);
    const [ticketFetchError, setTicketFetchError] = useState<string | null>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

    // Titre et type du ticket récupérés via Jira (ou depuis l'entrée existante)
    const [localSummary, setLocalSummary] = useState<string | null>(entry?.ticketSummary ?? null);
    const [localTicketType, setLocalTicketType] = useState<string | null>(entry?.ticketType ?? null);
    const [isFetchingTicket, setIsFetchingTicket] = useState(false);

    const inputRef = useRef<HTMLInputElement>(null);
    const commentRef = useRef<HTMLInputElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    // Synchronise le résumé local quand l'entrée change (navigation entre jours, undo/redo…)
    useEffect(() => {
        setLocalSummary(entry?.ticketSummary ?? null);
        setLocalTicketType(entry?.ticketType ?? null);
    }, [entry?.id, entry?.ticketSummary, entry?.ticketType]);

    // Ferme le menu contextuel au moindre clic (gauche ou droit) en dehors du menu
    useEffect(() => {
        if (null === contextMenu) return;

        function handleMouseDown(e: MouseEvent) {
            if (menuRef.current?.contains(e.target as Node)) return;
            closeContextMenu();
        }

        document.addEventListener('mousedown', handleMouseDown);
        return () => document.removeEventListener('mousedown', handleMouseDown);
    }, [contextMenu]);

    // Pré-remplit les champs avec les valeurs existantes à l'ouverture
    useEffect(() => {
        if (isEditing) {
            if (inputRef.current) {
                inputRef.current.value = entry?.type === EntryType.BREAK ? '' : (entry?.ticketKey ?? '');
            }
            setCommentValue(entry?.type === EntryType.BREAK ? '' : (entry?.comment ?? ''));
            setLocalSummary(entry?.ticketSummary ?? null);
            setLocalTicketType(entry?.ticketType ?? null);
            setTimeout(() => inputRef.current?.focus(), 0);
        } else {
            setTicketError(false);
            setTicketFetchError(null);
        }
    }, [isEditing, entry]);

    // Met à jour la couleur instantanément depuis le cache local (sans appel API)
    function handleTicketInput() {
        setTicketError(false);
        setTicketFetchError(null);
        const rawValue = inputRef.current?.value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '') ?? '';
        if (!rawValue) {
            setLocalTicketType(null);
            setLocalSummary(null);
            return;
        }
        const cached = getCachedTicketInfo(rawValue, knownTickets);
        if (cached) {
            setLocalTicketType(cached.type);
            setLocalSummary(cached.summary);
        } else if (rawValue !== (entry?.ticketKey ?? '')) {
            // Ticket différent et absent du cache → reset en attendant le blur
            setLocalTicketType(null);
            setLocalSummary(null);
        }
    }

    // Récupère les infos du ticket Jira au blur du champ ticket (si la valeur a changé)
    async function handleTicketBlur() {
        const rawValue = inputRef.current?.value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '') ?? '';
        if (!rawValue) {
            setLocalSummary(null);
            setLocalTicketType(null);
            return;
        }

        // Pas de re-fetch si le ticket n'a pas changé et qu'on a déjà un résumé
        if (rawValue === entry?.ticketKey && entry.ticketSummary) return;

        setIsFetchingTicket(true);
        try {
            const info = await fetchTicketInfo(rawValue, knownTickets);
            // null = Jira non configuré (pas d'erreur à afficher)
            if (info) {
                setLocalSummary(info.summary);
                setLocalTicketType(info.type);
                setTicketFetchError(null);
            } else if (rawValue !== entry?.ticketKey) {
                setLocalSummary(null);
                setLocalTicketType(null);
            }
        } catch (err) {
            // Jira configuré mais ticket introuvable ou API inaccessible
            setLocalSummary(null);
            setLocalTicketType(null);
            setTicketFetchError(err instanceof Error ? err.message : t('timeline.ticket_fetch_error'));
        } finally {
            setIsFetchingTicket(false);
        }
    }

    function save() {
        // Si Jira est configuré et le ticket est invalide, on bloque la sauvegarde
        if (ticketFetchError !== null) return;

        const ticketKey = inputRef.current?.value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '') || null;
        const comment = commentValue.trim() || null;

        if (ticketKey === null) {
            if (comment !== null) {
                setTicketError(true);
            } else if (entry) {
                onClear();
            } else {
                onCancel();
            }
            return;
        }

        setTicketError(false);
        onSave(ticketKey, EntryType.WORK, comment, localSummary, localTicketType);
    }

    function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            save();
        }
    }

    function handleTicketKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter') {
            save();
        } else if (e.key === 'Tab') {
            e.preventDefault();
            commentRef.current?.focus();
        } else if (e.key === 'Escape') {
            onCancel();
        }
    }

    function handleCommentKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter') {
            save();
        } else if (e.key === 'Escape') {
            onCancel();
        }
    }

    function handleContextMenu(e: React.MouseEvent) {
        e.preventDefault();
        onContextMenuOpen();
        setContextMenu({ x: e.clientX, y: e.clientY });
    }

    function closeContextMenu() {
        setContextMenu(null);
    }

    // -------------------------------------------------------------------------
    // Calcul des styles
    // -------------------------------------------------------------------------

    const isWork = entry?.type === EntryType.WORK;
    const isBreak = entry?.type === EntryType.BREAK;

    // Pour les entrées WORK on résout le style : type BDD prioritaire, puis localTicketType (live en édition)
    const resolvedTicketType = isWork ? (entry?.ticketType ?? localTicketType) : null;
    const ticketStyle = isWork ? getTicketTypeStyle(resolvedTicketType) : null;

    // Fond neutre pour WORK — le bandeau gauche coloré porte l'information de type
    const blockStyle = entry
        ? isBreak
            ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
            : `bg-white border-gray-100 hover:bg-gray-50 border-l-4 ${ticketStyle?.leftBorder ?? 'border-l-indigo-300'}`
        : 'bg-white border-gray-100 text-gray-400 hover:bg-gray-50';

    const selectedStyle = isSelected
        ? entry
            ? isBreak
                ? 'ring-2 ring-inset ring-amber-400'
                : (ticketStyle?.ring ?? 'ring-2 ring-inset ring-indigo-400')
            : 'ring-2 ring-inset ring-gray-400'
        : '';

    // -------------------------------------------------------------------------
    // Affichage en mode lecture
    // -------------------------------------------------------------------------

    const hasSummary = Boolean(isWork && entry?.ticketSummary);
    const hasComment = Boolean(isWork && entry?.comment);
    const showSplitRight = hasSummary && hasComment;

    function renderDisplayContent() {
        if (!entry) return null;

        if (isBreak) {
            return <span className="text-xs font-mono">{t('timeline.break_label')}</span>;
        }

        if (!entry.ticketKey) return null;

        const keyColor = ticketStyle?.ticketKey ?? 'text-indigo-700';
        const summaryColor = ticketStyle?.summary ?? 'text-indigo-500';
        const commentColor = ticketStyle?.comment ?? 'text-indigo-800';

        // Pas de summary Jira : affichage classique ticket — commentaire
        if (!hasSummary) {
            return (
                <div className="flex items-center gap-2 w-full min-w-0">
                    <span className={`text-xs font-mono font-medium shrink-0 ${keyColor}`}>
                        {entry.ticketKey}
                    </span>
                    {hasComment && (
                        <>
                            <span className="text-gray-300 shrink-0">—</span>
                            <span className={`text-xs font-mono truncate ${commentColor}`}>
                                {entry.comment}
                            </span>
                        </>
                    )}
                </div>
            );
        }

        return (
            <div className="flex items-stretch gap-2 w-full min-w-0 h-full">
                {/* Colonne gauche : ID du ticket */}
                <span className={`text-xs font-mono font-medium shrink-0 self-center ${keyColor}`}>
                    {entry.ticketKey}
                </span>
                <span className="border-l border-gray-300 self-stretch shrink-0" />
                {/* Colonne droite : titre + commentaire (ou titre seul si pas de commentaire) */}
                <div className="flex flex-col justify-center min-w-0 flex-1">
                    {showSplitRight ? (
                        <>
                            <span className={`text-[10px] font-mono truncate leading-tight ${summaryColor}`}>
                                {entry.ticketSummary}
                            </span>
                            <span className={`text-xs font-mono truncate leading-tight ${commentColor}`}>
                                {entry.comment}
                            </span>
                        </>
                    ) : (
                        <span className={`text-xs font-mono truncate ${commentColor}`}>
                            {entry.ticketSummary}
                        </span>
                    )}
                </div>
            </div>
        );
    }

    // -------------------------------------------------------------------------
    // Affichage en mode édition
    // -------------------------------------------------------------------------

    function renderEditContent() {
        const summaryText = localSummary;
        const editStyle = getTicketTypeStyle(localTicketType);
        const keyColor = editStyle.ticketKey;
        const summaryColor = editStyle.summary;

        return (
            <div
                className="flex items-stretch gap-1.5 w-full"
                onClick={(e) => e.stopPropagation()}
                onBlur={handleBlur}
            >
                {/* Champ ticket (colonne gauche) */}
                <input
                    ref={inputRef}
                    onInput={handleTicketInput}
                    onKeyDown={handleTicketKeyDown}
                    onBlur={handleTicketBlur}
                    placeholder={t('timeline.ticket_placeholder')}
                    className={`w-24 shrink-0 text-xs bg-transparent outline-none font-mono uppercase font-medium self-center ${ticketError ? 'placeholder:text-red-400' : 'placeholder:text-gray-400'} ${keyColor}`}
                />

                <span className="border-l border-dashed border-gray-300 self-stretch shrink-0" />

                {/* Colonne droite : résumé (readonly) + champ commentaire + erreur fetch */}
                <div className="flex flex-col flex-1 min-w-0 justify-center gap-0.5">
                    {ticketFetchError ? (
                        <span className="text-[10px] font-mono text-red-500 leading-tight truncate">
                            {ticketFetchError}
                        </span>
                    ) : ticketError ? (
                        <span className="text-[10px] font-mono text-red-500 leading-tight truncate">
                            {t('timeline.ticket_required')}
                        </span>
                    ) : summaryText && (
                        <div className={`flex items-center gap-1 text-[10px] font-mono leading-tight ${summaryColor}`}>
                            <span className="truncate">{summaryText}</span>
                            {isFetchingTicket && (
                                <span className="shrink-0 w-2.5 h-2.5 border border-current border-t-transparent rounded-full animate-spin opacity-60" />
                            )}
                        </div>
                    )}
                    <div className="flex items-center gap-1">
                        {isFetchingTicket && !summaryText && !ticketFetchError && (
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

                {/* Boutons d'action */}
                <div className="flex items-center gap-0.5 shrink-0">
                    <button
                        onClick={() => onSave(null, EntryType.BREAK, null, null, null)}
                        className="text-xs text-amber-600 hover:text-amber-800 font-medium px-1"
                        title={t('timeline.break_label')}
                    >
                        P
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            entry ? onClear() : onCancel();
                        }}
                        className="text-xs text-gray-400 hover:text-red-500 px-1"
                    >
                        ✕
                    </button>
                </div>
            </div>
        );
    }

    return (
        <>
            <div
                className={`relative flex items-center px-2 cursor-pointer select-none ${noBottomBorder ? '' : 'border-b'} ${isEditing ? 'min-h-8 py-1' : 'h-8'} ${blockStyle} ${selectedStyle}`}
                onClick={(e) => { e.stopPropagation(); if (!isEditing) onSelect(e); }}
                onDoubleClick={() => !isEditing && onStartEdit()}
                onContextMenu={handleContextMenu}
                onMouseDown={(e) => { if (!isEditing) onCellMouseDown(e); }}
                onMouseEnter={() => onDragExtend()}
            >
                {isEditing ? renderEditContent() : renderDisplayContent()}
                {ticketError && !isEditing && (
                    <p className="absolute bottom-0 left-0 right-0 text-[10px] text-red-500 px-2 pb-0.5 bg-white/80">
                        {t('timeline.ticket_required')}
                    </p>
                )}
            </div>

            {/* Menu contextuel (clic droit) */}
            {null !== contextMenu && (
                <div
                    ref={menuRef}
                    className="fixed z-50 bg-white border border-gray-200 rounded shadow-md py-1 text-sm min-w-32"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                >
                    {entry && (
                        <ContextMenuItem
                            label={t('timeline.copy')}
                            onClick={() => { onCopy(); closeContextMenu(); }}
                        />
                    )}
                    {hasClipboard && (
                        <ContextMenuItem
                            label={t('timeline.paste')}
                            onClick={() => { onPaste(); closeContextMenu(); }}
                        />
                    )}
                    {entry?.type !== EntryType.BREAK && (
                        <ContextMenuItem
                            label={t('timeline.convert_to_break')}
                            onClick={() => { onConvertToBreak(); closeContextMenu(); }}
                        />
                    )}
                    {entry && (
                        <ContextMenuItem
                            label={t('timeline.clear')}
                            onClick={() => { onClear(); closeContextMenu(); }}
                            danger
                        />
                    )}
                </div>
            )}
        </>
    );
}

interface ContextMenuItemProps {
    label: string;
    onClick: () => void;
    danger?: boolean;
}

function ContextMenuItem({ label, onClick, danger = false }: ContextMenuItemProps) {
    return (
        <button
            onClick={onClick}
            className={`w-full text-left px-3 py-1.5 hover:bg-gray-50 ${danger ? 'text-red-500' : 'text-gray-700'}`}
        >
            {label}
        </button>
    );
}