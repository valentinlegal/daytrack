import type { TemplateRule } from '@/types/api';
import { TemplateRuleType } from '@/types/api';
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
    rule: TemplateRule;
    onEdit: () => void;
    onToggleType: () => void;
    onSetInterval: (n: number) => void;
    onSetEndDate: () => void;
    onClearEndDate: () => void;
    onToggleEnabled: () => void;
    onDelete: () => void;
}

const INTERVAL_CHOICES = [1, 2, 3, 4];

export default function TemplateBlockMenu({
    rule,
    onEdit,
    onToggleType,
    onSetInterval,
    onSetEndDate,
    onClearEndDate,
    onToggleEnabled,
    onDelete,
}: TemplateBlockMenuProps) {
    const isBreak = rule.ruleType === TemplateRuleType.BREAK;

    return (
        <ContextMenuContent className="min-w-[220px]">
            {!isBreak && (
                <ContextMenuItem className="text-sm" onClick={onEdit}>
                    {t('templates.block.edit')}
                </ContextMenuItem>
            )}
            <ContextMenuItem className="text-sm" onClick={onToggleType}>
                {isBreak ? t('templates.block.convert_to_work') : t('templates.block.convert_to_break')}
            </ContextMenuItem>

            <ContextMenuSeparator />

            <ContextMenuSub>
                <ContextMenuSubTrigger className="text-sm">
                    {t('templates.recurrence.menu')}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                    <ContextMenuRadioGroup value={String(rule.intervalWeeks)}>
                        {INTERVAL_CHOICES.map((n) => (
                            <ContextMenuRadioItem
                                key={n}
                                value={String(n)}
                                className="text-sm"
                                onClick={() => onSetInterval(n)}
                            >
                                {n === 1
                                    ? t('templates.recurrence.every_week')
                                    : t('templates.recurrence.every_n_weeks').replace('{n}', String(n))}
                            </ContextMenuRadioItem>
                        ))}
                    </ContextMenuRadioGroup>
                    <ContextMenuSeparator />
                    <ContextMenuItem className="text-sm" onClick={onSetEndDate}>
                        {t('templates.recurrence.set_end_date')}
                    </ContextMenuItem>
                    {rule.activeUntil !== null && (
                        <ContextMenuItem className="text-sm" onClick={onClearEndDate}>
                            {t('templates.recurrence.clear_end_date')}
                        </ContextMenuItem>
                    )}
                </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuItem className="text-sm" onClick={onToggleEnabled}>
                {rule.enabled ? t('templates.block.disable') : t('templates.block.enable')}
            </ContextMenuItem>

            <ContextMenuSeparator />

            <ContextMenuItem variant="destructive" className="text-sm" onClick={onDelete}>
                {t('templates.block.delete')}
            </ContextMenuItem>
        </ContextMenuContent>
    );
}
