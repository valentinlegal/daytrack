import { useState } from 'react';
import { Coffee, Copy, Scissors, Clipboard, Trash2 } from 'lucide-react';
import { EntryType } from '@/types/api';
import type { JiraTicketInfo, TimeEntry } from '@/types/api';
import { t } from '@/i18n/fr';
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
    isSelected: boolean;
    hasClipboard: boolean;
    knownTickets: Record<string, JiraTicketInfo>;
    onSelect: (e: React.MouseEvent) => void;
    onStartEdit: (x: number, y: number) => void;
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
    isSelected,
    hasClipboard,
    onSelect,
    onStartEdit: onStartEditProp,
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
    const [isDragOver, setIsDragOver] = useState(false);

    return (
        <ContextMenu onOpenChange={(open) => { if (open) onContextMenuOpen(); }}>
            <ContextMenuTrigger asChild>
                <div
                    className="w-full h-full cursor-pointer select-none relative rounded-sm"
                    style={{
                        background: isDragOver ? 'rgba(99,102,241,0.08)' : undefined,
                        boxShadow: isDragOver ? 'inset 0 0 0 2px #818cf8' : undefined,
                    }}
                    onClick={(e) => { e.stopPropagation(); onSelect(e); }}
                    onDoubleClick={(e) => { e.preventDefault(); onStartEditProp(e.clientX, e.clientY); }}
                    onMouseDown={(e) => { if (!isSelected) onCellMouseDown(e); else onCellMouseDown(e); }}
                    onMouseEnter={() => onDragExtend()}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setIsDragOver(true); }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={(e) => {
                        e.preventDefault();
                        setIsDragOver(false);
                        if (e.dataTransfer.getData('application/daytrack-favorite')) onDropFavorite();
                    }}
                />
            </ContextMenuTrigger>

            <ContextMenuContent className="min-w-[200px]">
                {entry && (
                    <ContextMenuItem onClick={onCopy} className="gap-2 text-sm">
                        <Copy className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        {t('timeline.copy')}
                        <span className="ml-auto font-mono text-[11px] text-muted-foreground">⌘C</span>
                    </ContextMenuItem>
                )}
                {entry && (
                    <ContextMenuItem onClick={onCut} className="gap-2 text-sm">
                        <Scissors className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        {t('timeline.cut')}
                        <span className="ml-auto font-mono text-[11px] text-muted-foreground">⌘X</span>
                    </ContextMenuItem>
                )}
                {hasClipboard && (
                    <ContextMenuItem onClick={onPaste} className="gap-2 text-sm">
                        <Clipboard className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        {t('timeline.paste')}
                        <span className="ml-auto font-mono text-[11px] text-muted-foreground">⌘V</span>
                    </ContextMenuItem>
                )}
                {entry?.type !== EntryType.BREAK && <ContextMenuSeparator className="mx-1" />}
                {entry?.type !== EntryType.BREAK && (
                    <ContextMenuItem onClick={onConvertToBreak} className="gap-2 text-sm">
                        <Coffee className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        {t('timeline.convert_to_break')}
                    </ContextMenuItem>
                )}
                <ContextMenuSeparator className="mx-1" />
                <ContextMenuItem variant="destructive" onClick={onClear} className="gap-2 text-sm">
                    <Trash2 className="w-3.5 h-3.5 shrink-0 text-destructive" />
                    {t('timeline.clear')}
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground opacity-60">⌫</span>
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}
