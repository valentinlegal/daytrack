import { useEffect, useMemo, useRef, useState } from 'react';
import type { JiraTicketInfo, TemplateRule } from '@/types/api';
import { EntryType, TemplateRuleType } from '@/types/api';
import { SLOT_MINUTES, SLOT_PX, formatMinutes, parseTarget, shiftDate, today } from '@/utils/timeline';
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
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { t } from '@/i18n/fr';
import { cn } from '@/lib/utils';
import TemplateCell from './TemplateCell';
import TemplateBlockMenu from './TemplateBlockMenu';

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

    // ── Édition d'un bloc existant ────────────────────────────────────────
    const [editingRule, setEditingRule] = useState<TemplateRule | null>(null);
    const [editMouse, setEditMouse] = useState<{ x: number; y: number } | null>(null);
    const [endDateRuleId, setEndDateRuleId] = useState<string | null>(null);
    const [endDateValue, setEndDateValue] = useState('');

    function openEdit(rule: TemplateRule, e: React.MouseEvent) {
        setEditMouse({ x: e.clientX, y: e.clientY });
        setEditingRule(rule);
    }

    /** Supprime puis recrée une règle avec un ruleType différent (PUT ne le modifie pas). */
    async function recreateWithType(rule: TemplateRule, nextType: EntryType) {
        const isBreak = nextType === EntryType.BREAK;
        await deleteTemplateRule(rule.id);
        await createTemplateRule({
            ruleType: isBreak ? TemplateRuleType.BREAK : TemplateRuleType.WORK,
            weekday: rule.weekday,
            startTime: rule.startTime,
            durationMinutes: rule.durationMinutes,
            intervalWeeks: rule.intervalWeeks,
            anchorDate: rule.anchorDate,
            activeUntil: rule.activeUntil,
            enabled: rule.enabled,
            rotationGroupId: rule.rotationGroupId,
            ...(isBreak ? {} : { ticketKey: rule.ticketKey, ticketSummary: rule.ticketSummary, ticketType: rule.ticketType, comment: rule.comment }),
        });
    }

    async function saveEdit(
        ticketKey: string | null,
        type: EntryType,
        comment: string | null,
        ticketSummary: string | null,
        ticketType: string | null,
    ) {
        const rule = editingRule;
        setEditingRule(null);
        if (rule === null) return;
        try {
            // Le EditPopover ne renvoie WORK que pour un ticket saisi ; la conversion
            // en pause depuis ce bouton passe par recreateWithType (PUT ne change pas ruleType).
            if (type === EntryType.BREAK && rule.ruleType !== EntryType.BREAK) {
                await recreateWithType(rule, EntryType.BREAK);
            } else {
                await updateTemplateRule(rule.id, { ticketKey, ticketSummary, ticketType, comment });
            }
            onChanged();
        } catch { /* service gère */ }
    }

    async function setRuleInterval(rule: TemplateRule, n: number) {
        try { await updateTemplateRule(rule.id, { intervalWeeks: n }); onChanged(); } catch { /* */ }
    }

    async function toggleEnabled(rule: TemplateRule) {
        try { await updateTemplateRule(rule.id, { enabled: !rule.enabled }); onChanged(); } catch { /* */ }
    }

    async function clearEndDate(rule: TemplateRule) {
        try {
            // PUT n'efface pas activeUntil → supprimer + recréer sans la borne.
            await deleteTemplateRule(rule.id);
            await createTemplateRule({
                ruleType: rule.ruleType,
                weekday: rule.weekday,
                startTime: rule.startTime,
                durationMinutes: rule.durationMinutes,
                targetMinutes: rule.targetMinutes,
                intervalWeeks: rule.intervalWeeks,
                anchorDate: rule.anchorDate,
                enabled: rule.enabled,
                rotationGroupId: rule.rotationGroupId,
                ticketKey: rule.ticketKey,
                ticketSummary: rule.ticketSummary,
                ticketType: rule.ticketType,
                comment: rule.comment,
            });
            onChanged();
        } catch { /* */ }
    }

    async function submitEndDate() {
        const id = endDateRuleId;
        const value = endDateValue;
        setEndDateRuleId(null);
        if (id === null || value === '') return;
        try { await updateTemplateRule(id, { activeUntil: value }); onChanged(); } catch { /* */ }
    }

    async function removeRule(rule: TemplateRule) {
        try { await deleteTemplateRule(rule.id); onChanged(); } catch { /* */ }
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
                    const rotationTitle =
                        rotationSize > 1
                            ? t('templates.recurrence.cadence_tooltip')
                                  .replace('{n}', String(rule.intervalWeeks))
                                  .replace('{pos}', String(rotationIndex + 1))
                                  .replace('{size}', String(rotationSize))
                            : undefined;

                    return (
                        <ContextMenu key={rule.id}>
                            <ContextMenuTrigger asChild>
                                <div
                                    className={cn('absolute', !rule.enabled && 'opacity-40 grayscale')}
                                    style={{ top: 0, left: `${leftPct}%`, width: `${widthPct}%`, height: '100%', zIndex: 6 }}
                                    title={rotationTitle}
                                    onDoubleClick={(e) => { if (!isBreak) openEdit(rule, e); }}
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
                            </ContextMenuTrigger>
                            <TemplateBlockMenu
                                rule={rule}
                                onEdit={() => openEdit(rule, { clientX: window.innerWidth / 2, clientY: 200 } as React.MouseEvent)}
                                onToggleType={() => void recreateWithType(rule, isBreak ? EntryType.WORK : EntryType.BREAK).then(onChanged)}
                                onSetInterval={(n) => void setRuleInterval(rule, n)}
                                onSetEndDate={() => { setEndDateValue(rule.activeUntil ?? today()); setEndDateRuleId(rule.id); }}
                                onClearEndDate={() => void clearEndDate(rule)}
                                onToggleEnabled={() => void toggleEnabled(rule)}
                                onDelete={() => void removeRule(rule)}
                            />
                        </ContextMenu>
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

                {editingRule !== null && (
                    <EditPopover
                        slot={editingRule.startTime ?? ''}
                        entry={{
                            id: editingRule.id,
                            ticketKey: editingRule.ticketKey,
                            ticketSummary: editingRule.ticketSummary,
                            ticketType: editingRule.ticketType,
                            comment: editingRule.comment,
                            startedAt: editingRule.startTime ?? '',
                            endedAt: null,
                            type: editingRule.ruleType === EntryType.BREAK ? EntryType.BREAK : EntryType.WORK,
                            durationMinutes: editingRule.durationMinutes,
                        }}
                        anchorTop={0}
                        scrollContainer={null}
                        mousePos={editMouse}
                        knownTickets={knownTickets}
                        onSave={(k, ty, c, s, tt) => void saveEdit(k, ty, c, s, tt)}
                        onCancel={() => setEditingRule(null)}
                        onClear={() => { const r = editingRule; setEditingRule(null); if (r) void removeRule(r); }}
                    />
                )}

                {endDateRuleId !== null && (
                    <div
                        className="fixed z-50 flex flex-col gap-2 rounded-lg border bg-popover p-3 shadow-lg"
                        style={{ top: 120, left: '50%', transform: 'translateX(-50%)' }}
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        <span className="text-[12px] font-medium">{t('templates.recurrence.end_date_title')}</span>
                        <input
                            type="date"
                            min={today()}
                            value={endDateValue}
                            onChange={(e) => setEndDateValue(e.target.value)}
                            className="h-8 rounded-md border border-input px-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        />
                        <div className="flex justify-end gap-1.5">
                            <button
                                onClick={() => setEndDateRuleId(null)}
                                className="h-7 rounded-md px-3 text-[12.5px] hover:bg-accent"
                            >
                                {t('templates.stack.cancel')}
                            </button>
                            <button
                                onClick={() => void submitEndDate()}
                                className="h-7 rounded-md bg-primary px-3 text-[12.5px] font-medium text-primary-foreground enabled:hover:bg-primary/90"
                            >
                                {t('templates.recurrence.end_date_confirm')}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
