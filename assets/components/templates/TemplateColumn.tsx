import { useMemo } from 'react';
import type { JiraTicketInfo, TemplateRule } from '@/types/api';
import { TemplateRuleType } from '@/types/api';
import { SLOT_PX } from '@/utils/timeline';
import { GRID_SLOTS, buildColumnBlocks, weekdayLabel } from '@/utils/templateGrid';
import { getBlockColors } from '@/config/ticketTypeColors';
import { WorkBlock, PauseBlock } from '@/components/timeline/blocks';
import { t } from '@/i18n/fr';
import { cn } from '@/lib/utils';

interface TemplateColumnProps {
    iso: number;
    rules: TemplateRule[];
    knownTickets: Record<string, JiraTicketInfo>;
    onChanged: () => void;
}

/** Une colonne de la grille Modèles : en-tête (jour) + layer de blocs des règles. */
export default function TemplateColumn({ iso, rules }: TemplateColumnProps) {
    const blocks = useMemo(() => buildColumnBlocks(rules, iso), [rules, iso]);
    const gridHeight = GRID_SLOTS.length * SLOT_PX;

    return (
        <div className="flex flex-col min-w-[150px] flex-1 border-r border-amber-200/70 last:border-r-0">
            {/* En-tête de colonne */}
            <div className="h-9 flex items-center justify-center shrink-0 border-b border-amber-200/70">
                <span className="text-[13px] font-semibold text-amber-900/80">{weekdayLabel(iso)}</span>
            </div>

            {/* Corps : lignes de grille + blocs (positionnés en absolu) */}
            <div className="relative" style={{ height: gridHeight }}>
                {/* Lignes de grille */}
                {GRID_SLOTS.map((slot, idx) => (
                    <div
                        key={slot}
                        className="absolute left-0 right-0"
                        style={{
                            top: idx * SLOT_PX,
                            height: 1,
                            background: slot.endsWith(':00') ? 'oklch(0.88 0.03 90)' : 'oklch(0.93 0.02 90)',
                        }}
                    />
                ))}

                {/* Layer des blocs de règle */}
                {blocks.map(({ rule, startSlotIndex, slotCount, rotationSize, rotationIndex }) => {
                    const top = startSlotIndex * SLOT_PX;
                    const height = slotCount * SLOT_PX;
                    const runDurationMinutes = slotCount * 15;
                    const isBreak = rule.ruleType === TemplateRuleType.BREAK;

                    // Alternance : chaque membre occupe une moitié de la largeur, côte à côte.
                    const widthPct = 100 / rotationSize;
                    const leftPct = rotationIndex * widthPct;

                    return (
                        <div
                            key={rule.id}
                            className={cn('absolute', !rule.enabled && 'opacity-40 grayscale')}
                            style={{ top: 0, left: `${leftPct}%`, width: `${widthPct}%`, height: '100%' }}
                            title={
                                rotationSize > 1
                                    ? t('templates.recurrence.cadence_tooltip')
                                          .replace('{n}', String(rule.intervalWeeks))
                                          .replace('{pos}', String(rotationIndex + 1))
                                          .replace('{size}', String(rotationSize))
                                    : undefined
                            }
                        >
                            {isBreak ? (
                                <PauseBlock top={top} height={height} slotCount={slotCount} runDurationMinutes={runDurationMinutes} />
                            ) : (
                                <WorkBlock
                                    top={top}
                                    height={height}
                                    slotCount={slotCount}
                                    ticket={rule.ticketKey ?? ''}
                                    summary={rule.ticketSummary}
                                    comment={rule.comment}
                                    colors={getBlockColors(rule.ticketType)}
                                    runDurationMinutes={runDurationMinutes}
                                    isSelected={false}
                                />
                            )}

                            {rotationSize > 1 && (
                                <span
                                    className="absolute z-10 rounded bg-amber-900/80 px-1 text-[10px] font-semibold text-white"
                                    style={{ top: top + 3, right: 5 }}
                                >
                                    {rotationIndex + 1}/{rotationSize}
                                </span>
                            )}

                            {!rule.enabled && (
                                <span
                                    className="absolute z-10 left-2 rounded bg-gray-700/80 px-1 text-[10px] font-medium text-white"
                                    style={{ top: top + 3 }}
                                >
                                    {t('templates.block.disabled_badge')}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
