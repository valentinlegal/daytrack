import { useEffect, useRef, useState } from 'react';
import { EntryType } from '../types/api';
import type { TimeEntry } from '../types/api';
import { t } from '../i18n/fr';

interface TimeBlockProps {
    slot: string;
    entry: TimeEntry | null;
    isEditing: boolean;
    isSelected: boolean;
    noBottomBorder: boolean;
    hasClipboard: boolean;
    onSelect: (e: React.MouseEvent) => void;
    onStartEdit: () => void;
    onSave: (ticketKey: string | null, type: EntryType, comment: string | null) => void;
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
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const commentRef = useRef<HTMLInputElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    // Ferme le menu contextuel au moindre clic (gauche ou droit) en dehors du menu
    // mousedown se déclenche avant contextmenu, ce qui permet au bloc cible d'ouvrir son propre menu ensuite
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
            // Ne pas pré-remplir si l'entrée est une pause (pas de ticket associé)
            if (inputRef.current) {
                inputRef.current.value = entry?.type === EntryType.BREAK ? '' : (entry?.ticketKey ?? '');
            }
            setCommentValue(entry?.type === EntryType.BREAK ? '' : (entry?.comment ?? ''));
            setTimeout(() => inputRef.current?.focus(), 0);
        } else {
            setTicketError(false);
        }
    }, [isEditing, entry]);

    function save() {
        const ticketKey = inputRef.current?.value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '') || null;
        const comment = commentValue.trim() || null;

        if (ticketKey === null) {
            if (comment !== null) {
                // Commentaire sans ticket → erreur visible, on garde la cellule ouverte
                setTicketError(true);
            } else if (entry) {
                // Saisie existante vidée → suppression
                onClear();
            } else {
                onCancel();
            }
            return;
        }

        setTicketError(false);
        onSave(ticketKey, EntryType.WORK, comment);
    }

    function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
        // Sauvegarde automatique quand le focus quitte complètement la zone d'édition
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
        // Sélectionne la cellule si elle n'est pas déjà dans la sélection courante
        onContextMenuOpen();
        setContextMenu({ x: e.clientX, y: e.clientY });
    }

    function closeContextMenu() {
        setContextMenu(null);
    }

    const blockStyle = entry
        ? entry.type === EntryType.BREAK
            ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
            : 'bg-indigo-50 border-indigo-200 text-indigo-800 hover:bg-indigo-100'
        : 'bg-white border-gray-100 text-gray-400 hover:bg-gray-50';

    const selectedStyle = isSelected
        ? entry
            ? EntryType.BREAK === entry.type
                ? 'ring-2 ring-inset ring-amber-400'
                : 'ring-2 ring-inset ring-indigo-400'
            : 'ring-2 ring-inset ring-gray-400'
        : '';

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
                {isEditing ? (
                    // Saisie inline du ticket et du commentaire
                    <div className="flex flex-col gap-0.5 w-full" onClick={(e) => e.stopPropagation()} onBlur={handleBlur}>
                        <div className="flex items-center gap-1">
                            <input
                                ref={inputRef}
                                onInput={() => setTicketError(false)}
                                onKeyDown={handleTicketKeyDown}
                                placeholder={t('timeline.ticket_placeholder')}
                                className={`w-28 text-xs bg-transparent outline-none font-mono uppercase text-gray-800 placeholder:text-gray-400 ${ticketError ? 'placeholder:text-red-400' : ''}`}
                            />
                            <span className="border-l border-dashed border-gray-300 h-4 mx-1 shrink-0" />
                            <input
                                ref={commentRef}
                                value={commentValue}
                                onChange={(e) => setCommentValue(e.target.value)}
                                onKeyDown={handleCommentKeyDown}
                                placeholder={t('timeline.comment_placeholder')}
                                className="flex-1 text-xs bg-transparent outline-none font-mono text-gray-800 placeholder:text-gray-400"
                            />
                            <button
                                onClick={() => onSave(null, EntryType.BREAK, null)}
                                className="text-xs text-amber-600 hover:text-amber-800 font-medium px-1 shrink-0"
                                title={t('timeline.break_label')}
                            >
                                P
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    // Supprime l'entrée si elle existe, sinon annule simplement
                                    entry ? onClear() : onCancel();
                                }}
                                className="text-xs text-gray-400 hover:text-red-500 px-1 shrink-0"
                            >
                                ✕
                            </button>
                        </div>
                        {ticketError && (
                            <p className="text-xs text-red-500 mt-0.5">{t('timeline.ticket_required')}</p>
                        )}
                    </div>
                ) : (
                    // Affichage de l'entrée ou du slot vide
                    <span className="text-xs font-mono truncate">
                        {entry
                            ? entry.type === EntryType.BREAK
                                ? t('timeline.break_label')
                                : entry.comment
                                    ? `${entry.ticketKey ?? ''} — ${entry.comment}`.trim().replace(/^— /, '')
                                    : entry.ticketKey
                            : ''}
                    </span>
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
