import { Coffee, Copy, Scissors, Clipboard, Trash2 } from 'lucide-react';
import type { TemplateRule } from '@/types/api';
import { EntryType } from '@/types/api';
import type { SlotCell } from '@/hooks/useSlotGrid';
import {
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuRadioGroup,
    ContextMenuRadioItem,
    ContextMenuSeparator,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
} from '@/components/ui/context-menu';
import { t } from '@/i18n/fr';

interface TemplateBlockMenuProps {
    entry: SlotCell | null;
    rule: TemplateRule | null; // règle correspondant au créneau, si le bloc existe
    hasClipboard: boolean;
    onCopy: () => void;
    onCut: () => void;
    onPaste: () => void;
    onClear: () => void;
    onConvertToBreak: () => void;
    onEdit: () => void;
    onToggleType: () => void;
    onSetInterval: (n: number) => void;
    onSetEndDate: () => void;
    onClearEndDate: () => void;
    onToggleEnabled: () => void;
    onDelete: () => void;
}

const INTERVAL_CHOICES = [1, 2, 3, 4];

/** `<ContextMenuContent>` complet d'une cellule Modèles : actions « grille » + actions « règle ». */
export default function TemplateBlockMenu(p: TemplateBlockMenuProps) {
    const isBreak = p.entry?.type === EntryType.BREAK;

    return (
        <ContextMenuContent className="min-w-[220px]">
            {p.entry && (
                <ContextMenuItem onClick={p.onCopy} className="gap-2 text-sm">
                    <Copy className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    {t('timeline.copy')}
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">⌘C</span>
                </ContextMenuItem>
            )}
            {p.entry && (
                <ContextMenuItem onClick={p.onCut} className="gap-2 text-sm">
                    <Scissors className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    {t('timeline.cut')}
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">⌘X</span>
                </ContextMenuItem>
            )}
            {p.hasClipboard && (
                <ContextMenuItem onClick={p.onPaste} className="gap-2 text-sm">
                    <Clipboard className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    {t('timeline.paste')}
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">⌘V</span>
                </ContextMenuItem>
            )}

            {p.rule && <ContextMenuSeparator className="mx-1" />}
            {p.rule && !isBreak && (
                <ContextMenuItem className="text-sm" onClick={p.onEdit}>{t('templates.block.edit')}</ContextMenuItem>
            )}
            {p.rule && (
                <ContextMenuItem className="text-sm" onClick={p.onToggleType}>
                    {isBreak ? t('templates.block.convert_to_work') : t('timeline.convert_to_break')}
                </ContextMenuItem>
            )}
            {!p.rule && (
                <ContextMenuItem className="gap-2 text-sm" onClick={p.onConvertToBreak}>
                    <Coffee className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    {t('timeline.convert_to_break')}
                </ContextMenuItem>
            )}

            {p.rule && (
                <>
                    <ContextMenuSub>
                        <ContextMenuSubTrigger className="text-sm">{t('templates.recurrence.menu')}</ContextMenuSubTrigger>
                        <ContextMenuSubContent>
                            {/* Membre d'alternance : cadence verrouillée sur « une semaine sur deux ». */}
                            {p.rule.rotationGroupId !== null ? (
                                <ContextMenuItem disabled className="text-sm">
                                    {t('templates.recurrence.locked_by_rotation')}
                                </ContextMenuItem>
                            ) : (
                                <ContextMenuRadioGroup value={String(p.rule.intervalWeeks)}>
                                    {INTERVAL_CHOICES.map((n) => (
                                        <ContextMenuRadioItem key={n} value={String(n)} className="text-sm" onClick={() => p.onSetInterval(n)}>
                                            {n === 1
                                                ? t('templates.recurrence.every_week')
                                                : t('templates.recurrence.every_n_weeks').replace('{n}', String(n))}
                                        </ContextMenuRadioItem>
                                    ))}
                                </ContextMenuRadioGroup>
                            )}
                            <ContextMenuSeparator />
                            <ContextMenuItem className="text-sm" onClick={p.onSetEndDate}>
                                {t('templates.recurrence.set_end_date')}
                            </ContextMenuItem>
                            {p.rule.activeUntil !== null && (
                                <ContextMenuItem className="text-sm" onClick={p.onClearEndDate}>
                                    {t('templates.recurrence.clear_end_date')}
                                </ContextMenuItem>
                            )}
                        </ContextMenuSubContent>
                    </ContextMenuSub>
                    <ContextMenuItem className="text-sm" onClick={p.onToggleEnabled}>
                        {p.rule.enabled ? t('templates.block.disable') : t('templates.block.enable')}
                    </ContextMenuItem>
                </>
            )}

            <ContextMenuSeparator className="mx-1" />
            <ContextMenuItem variant="destructive" className="gap-2 text-sm" onClick={p.rule ? p.onDelete : p.onClear}>
                <Trash2 className="w-3.5 h-3.5 shrink-0 text-destructive" />
                {p.rule ? t('templates.block.delete') : t('timeline.clear')}
            </ContextMenuItem>
        </ContextMenuContent>
    );
}
