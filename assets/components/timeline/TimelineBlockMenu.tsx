import { Coffee, Copy, Scissors, Clipboard, Trash2 } from 'lucide-react';
import { EntryType } from '@/types/api';
import type { SlotCell } from '@/hooks/useSlotGrid';
import { t } from '@/i18n/fr';
import {
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
} from '@/components/ui/context-menu';

interface TimelineBlockMenuProps {
    entry: SlotCell | null;
    hasClipboard: boolean;
    onCopy: () => void;
    onCut: () => void;
    onPaste: () => void;
    onClear: () => void;
    onConvertToBreak: () => void;
}

/** Contenu du menu contextuel d'une cellule de la vue jour, injecté dans `TimeBlock`. */
export default function TimelineBlockMenu({
    entry, hasClipboard, onCopy, onCut, onPaste, onClear, onConvertToBreak,
}: TimelineBlockMenuProps) {
    return (
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
    );
}
