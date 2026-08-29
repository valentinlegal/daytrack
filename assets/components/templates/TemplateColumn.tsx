import { useEffect, useMemo, useRef, useState } from 'react';
import type { JiraTicketInfo, TemplateRule } from '@/types/api';
import { EntryType, TemplateRuleType } from '@/types/api';
import { SLOT_MINUTES, SLOT_PX, formatMinutes, parseTarget } from '@/utils/timeline';
import {
    GRID_SLOTS,
    buildColumnBlocks,
    findColumnOverlap,
    targetRuleForWeekday,
    timeToMinutes,
    weekdayLabel,
} from '@/utils/templateGrid';
import { getBlockColors } from '@/config/ticketTypeColors';
import {
    createTemplateRule,
    deleteTemplateRule,
    updateTemplateRule,
} from '@/services/templateRuleService';
import { WorkBlock, PauseBlock } from '@/components/timeline/blocks';
import EditPopover from '@/components/timeline/EditPopover';
import { t } from '@/i18n/fr';
import { cn } from '@/lib/utils';
import TemplateCell from './TemplateCell';

interface TemplateColumnProps {
    iso: number;
    rules: TemplateRule[];
    knownTickets: Record<string, JiraTicketInfo>;
    onChanged: () => void;
}

export default function TemplateColumn({ iso, rules, knownTickets, onChanged }: TemplateColumnProps) {
    const blocks = useMemo(() => buildColumnBlocks(rules, iso), [rules, iso]);
    const targetRule = useMemo(() => targetRuleForWeekday(rules, iso), [rules, iso]);
    const gridHeight = GRID_SLOTS.length * SLOT_PX;

    // ── Objectif du jour ──────────────────────────────────────────────────
    const [editingTarget, setEditingTarget] = useState(false);
    const [targetInput, setTargetInput] = useState('');
    const [targetError, setTargetError] = useState(false);
    const targetInputRef = useRef<HTMLInputElement>(null);

    function startEditingTarget() {
        setTargetInput(targetRule?.targetMinutes != null ? formatMinutes(targetRule.targetMinutes) : '');
        setTargetError(false);
        setEditingTarget(true);
        setTimeout(() => targetInputRef.current?.select(), 0);
    }

    async function saveTarget() {
        const raw = targetInput.trim();

        // Vidé → supprimer la règle TARGET_OVERRIDE si elle existe
        if (raw === '') {
            setEditingTarget(false);
            if (targetRule) {
                try {
                    await deleteTemplateRule(targetRule.id);
                    onChanged();
                } catch { /* service gère le message */ }
            }
            return;
        }

        const minutes = parseTarget(raw);
        if (minutes === null) { setTargetError(true); return; }
        setEditingTarget(false);
        if (targetRule && targetRule.targetMinutes === minutes) return;

        try {
            if (targetRule) {
                await updateTemplateRule(targetRule.id, { targetMinutes: minutes });
            } else {
                await createTemplateRule({
                    ruleType: TemplateRuleType.TARGET_OVERRIDE,
                    weekday: iso,
                    targetMinutes: minutes,
                });
            }
            onChanged();
        } catch { /* service gère le message */ }
    }

    function handleTargetKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter') void saveTarget();
        else if (e.key === 'Escape') setEditingTarget(false);
    }

    // ── Création par clic-glisser ─────────────────────────────────────────
    const [dragAnchor, setDragAnchor] = useState<number | null>(null);
    const [dragCursor, setDragCursor] = useState<number | null>(null);
    const [pendingRange, setPendingRange] = useState<{ startIndex: number; count: number } | null>(null);
    const [popoverMouse, setPopoverMouse] = useState<{ x: number; y: number } | null>(null);

    const dragRange =
        dragAnchor !== null && dragCursor !== null
            ? { lo: Math.min(dragAnchor, dragCursor), hi: Math.max(dragAnchor, dragCursor) }
            : null;

    // Fin du glisser (mouseup n'importe où) → ouvre le popover sur la plage sélectionnée.
    useEffect(() => {
        if (dragAnchor === null) return;
        function onUp(e: MouseEvent) {
            const a = dragAnchor as number;
            const c = dragCursor ?? a;
            const lo = Math.min(a, c);
            const hi = Math.max(a, c);
            setPendingRange({ startIndex: lo, count: hi - lo + 1 });
            setPopoverMouse({ x: e.clientX, y: e.clientY });
            setDragAnchor(null);
            setDragCursor(null);
        }
        document.addEventListener('mouseup', onUp);
        return () => document.removeEventListener('mouseup', onUp);
    }, [dragAnchor, dragCursor]);

    function closePopover() {
        setPendingRange(null);
        setPopoverMouse(null);
    }

    async function handleCreateFromPopover(
        ticketKey: string | null,
        type: EntryType,
        comment: string | null,
        ticketSummary: string | null,
        ticketType: string | null,
    ) {
        if (pendingRange === null) return;
        const startTime = GRID_SLOTS[pendingRange.startIndex]!;
        const startMin = timeToMinutes(startTime);
        const durMin = pendingRange.count * SLOT_MINUTES;

        const overlap = findColumnOverlap(rules, iso, startMin, durMin);
        if (overlap !== null) {
            // TODO(task 8) : ouvrir le prompt d'empilement (Remplacer / Alterner / Annuler).
            closePopover();
            return;
        }

        const isBreak = type === EntryType.BREAK;
        try {
            await createTemplateRule({
                ruleType: isBreak ? TemplateRuleType.BREAK : TemplateRuleType.WORK,
                weekday: iso,
                startTime,
                durationMinutes: durMin,
                intervalWeeks: 1,
                ...(isBreak ? {} : { ticketKey, ticketSummary, ticketType, comment }),
            });
            onChanged();
        } catch { /* service gère le message */ } finally {
            closePopover();
        }
    }

    return (
        <div className="flex flex-col min-w-[150px] flex-1 border-r border-amber-200/70 last:border-r-0">
            {/* En-tête : libellé jour + objectif */}
            <div className="h-9 flex items-center justify-between px-2 shrink-0 border-b border-amber-200/70">
                <span className="text-[13px] font-semibold text-amber-900/80">{weekdayLabel(iso)}</span>
                {editingTarget ? (
                    <input
                        ref={targetInputRef}
                        value={targetInput}
                        onChange={(e) => { setTargetInput(e.target.value); setTargetError(false); }}
                        onKeyDown={handleTargetKeyDown}
                        onBlur={() => void saveTarget()}
                        placeholder={t('templates.target.placeholder')}
                        className={cn(
                            'w-16 text-right text-[12px] font-medium outline-none border-b bg-transparent',
                            targetError ? 'border-destructive text-destructive' : 'border-amber-500 text-amber-950',
                        )}
                    />
                ) : (
                    <button
                        onClick={startEditingTarget}
                        title={t('templates.target.hint')}
                        className="text-[12px] font-medium text-amber-900/70 hover:text-amber-950 border-b border-dashed border-amber-400/50"
                    >
                        {targetRule?.targetMinutes != null
                            ? formatMinutes(targetRule.targetMinutes)
                            : t('templates.target.placeholder')}
                    </button>
                )}
            </div>

            {/* Corps : lignes de grille + blocs */}
            <div className="relative" style={{ height: gridHeight }}>
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

                {blocks.map(({ rule, startSlotIndex, slotCount, rotationSize, rotationIndex }) => {
                    const top = startSlotIndex * SLOT_PX;
                    const height = slotCount * SLOT_PX;
                    const runDurationMinutes = slotCount * 15;
                    const isBreak = rule.ruleType === TemplateRuleType.BREAK;
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

                {/* Layer de cellules d'interaction (au-dessus des blocs) */}
                <div className="absolute inset-0" style={{ zIndex: 5 }}>
                    {GRID_SLOTS.map((_, idx) => (
                        <TemplateCell
                            key={idx}
                            slotIndex={idx}
                            isInDragRange={dragRange !== null && idx >= dragRange.lo && idx <= dragRange.hi}
                            onDragStart={(i) => { setDragAnchor(i); setDragCursor(i); }}
                            onDragEnter={(i) => setDragCursor((prev) => (dragAnchor === null ? prev : i))}
                        />
                    ))}
                </div>

                {pendingRange !== null && (
                    <EditPopover
                        slot={GRID_SLOTS[pendingRange.startIndex]!}
                        entry={null}
                        anchorTop={pendingRange.startIndex * SLOT_PX}
                        scrollContainer={null}
                        mousePos={popoverMouse}
                        knownTickets={knownTickets}
                        onSave={(ticketKey, type, comment, ticketSummary, ticketType) =>
                            void handleCreateFromPopover(ticketKey, type, comment, ticketSummary, ticketType)
                        }
                        onCancel={closePopover}
                        onClear={closePopover}
                    />
                )}
            </div>
        </div>
    );
}
