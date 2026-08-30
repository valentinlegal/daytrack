import { useEffect, useMemo, useRef, useState } from 'react';
import type { JiraTicketInfo, TemplateRule, TimeEntry } from '@/types/api';
import { EntryType, TemplateRuleType } from '@/types/api';
import {
    DEFAULT_TARGET_MINUTES,
    SLOT_MINUTES,
    SLOT_PX,
    formatMinutes,
    getNextSlot,
    parseTarget,
    today,
} from '@/utils/timeline';
import {
    GRID_SLOTS,
    buildColumnBlocks,
    entryRulesForWeekday,
    minutesToTime,
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
import { useSlotGrid } from '@/hooks/useSlotGrid';
import type { SlotCell, SlotCellInput } from '@/hooks/useSlotGrid';
import { WorkBlock, PauseBlock } from '@/components/timeline/blocks';
import TimeBlock from '@/components/timeline/TimeBlock';
import EditPopover from '@/components/timeline/EditPopover';
import { t } from '@/i18n/fr';
import { cn } from '@/lib/utils';
import TemplateBlockMenu from './TemplateBlockMenu';

interface TemplateColumnProps {
    iso: number;
    rules: TemplateRule[];
    knownTickets: Record<string, JiraTicketInfo>;
    onChanged: () => void;
    scrollRef: React.RefObject<HTMLDivElement | null>;
    onNeedsPasteWarning: () => void;
}

/** "HH:mm" + N minutes → "HH:mm". */
function addMinutes(hhmm: string, mins: number): string {
    return minutesToTime(timeToMinutes(hhmm) + mins);
}

/** Règle Modèles → entrée synthétique pour pré-remplir le EditPopover. */
function ruleToEntry(r: TemplateRule): TimeEntry {
    return {
        id: r.id,
        ticketKey: r.ticketKey,
        ticketSummary: r.ticketSummary,
        ticketType: r.ticketType,
        comment: r.comment,
        startedAt: r.startTime ?? '',
        endedAt: r.startTime && r.durationMinutes ? addMinutes(r.startTime, r.durationMinutes) : null,
        type: r.ruleType === TemplateRuleType.BREAK ? EntryType.BREAK : EntryType.WORK,
        durationMinutes: r.durationMinutes,
    };
}

export default function TemplateColumn({
    iso,
    rules,
    knownTickets,
    onChanged,
    scrollRef,
    onNeedsPasteWarning,
}: TemplateColumnProps) {
    const columnRules = useMemo(() => entryRulesForWeekday(rules, iso), [rules, iso]);
    const blocks = useMemo(() => buildColumnBlocks(rules, iso), [rules, iso]);
    const targetRule = useMemo(() => targetRuleForWeekday(rules, iso), [rules, iso]);
    const gridHeight = GRID_SLOTS.length * SLOT_PX;

    // Chaque créneau couvert par une règle → la règle (pas seulement le créneau de départ),
    // pour que le clic droit / l'édition visent tout le bloc.
    const ruleBySlot = useMemo(() => {
        const m = new Map<string, TemplateRule>();
        for (const r of columnRules) {
            if (r.startTime === null || r.durationMinutes === null) continue;
            const startMin = timeToMinutes(r.startTime);
            for (let mn = startMin; mn < startMin + r.durationMinutes; mn += SLOT_MINUTES) {
                m.set(minutesToTime(mn), r);
            }
        }
        return m;
    }, [columnRules]);

    // Une cellule par règle WORK/BREAK, au créneau de départ.
    const cells = useMemo<SlotCell[]>(
        () => columnRules
            .filter((r) => r.startTime !== null && r.durationMinutes !== null)
            .map((r) => ({
                id: r.id,
                ticketKey: r.ticketKey,
                ticketSummary: r.ticketSummary,
                ticketType: r.ticketType,
                comment: r.comment,
                type: r.ruleType === TemplateRuleType.BREAK ? EntryType.BREAK : EntryType.WORK,
                startedAt: r.startTime as string,
                endedAt: addMinutes(r.startTime as string, r.durationMinutes as number),
            })),
        [columnRules],
    );

    const ops = useMemo(() => ({
        async createCell(slot: string, data: SlotCellInput): Promise<SlotCell[]> {
            const isBreak = data.type === EntryType.BREAK;
            await createTemplateRule({
                ruleType: isBreak ? TemplateRuleType.BREAK : TemplateRuleType.WORK,
                weekday: iso,
                startTime: slot,
                durationMinutes: Math.max(SLOT_MINUTES, timeToMinutes(data.endedAt) - timeToMinutes(slot)),
                intervalWeeks: 1,
                ...(isBreak ? {} : {
                    ticketKey: data.ticketKey,
                    ticketSummary: data.ticketSummary,
                    ticketType: data.ticketType,
                    comment: data.comment,
                }),
            });
            onChanged();
            return [];
        },
        async updateCell(cell: SlotCell, data: SlotCellInput): Promise<SlotCell[]> {
            const rule = ruleBySlot.get(cell.startedAt);
            const targetIsBreak = data.type === EntryType.BREAK;
            if (rule && targetIsBreak !== (rule.ruleType === TemplateRuleType.BREAK)) {
                // Le PUT ne change pas ruleType → delete + recreate en préservant récurrence/rotation.
                await deleteTemplateRule(cell.id);
                await createTemplateRule({
                    ruleType: targetIsBreak ? TemplateRuleType.BREAK : TemplateRuleType.WORK,
                    weekday: iso,
                    startTime: cell.startedAt,
                    durationMinutes: Math.max(SLOT_MINUTES, timeToMinutes(data.endedAt) - timeToMinutes(cell.startedAt)),
                    intervalWeeks: rule.intervalWeeks,
                    anchorDate: rule.anchorDate,
                    activeUntil: rule.activeUntil,
                    enabled: rule.enabled,
                    rotationGroupId: rule.rotationGroupId,
                    ...(targetIsBreak ? {} : {
                        ticketKey: data.ticketKey,
                        ticketSummary: data.ticketSummary,
                        ticketType: data.ticketType,
                        comment: data.comment,
                    }),
                });
            } else {
                await updateTemplateRule(cell.id, {
                    ticketKey: targetIsBreak ? null : data.ticketKey,
                    ticketSummary: targetIsBreak ? null : data.ticketSummary,
                    ticketType: targetIsBreak ? null : data.ticketType,
                    comment: targetIsBreak ? null : data.comment,
                });
            }
            onChanged();
            return [];
        },
        async deleteCell(cell: SlotCell): Promise<SlotCell[]> {
            await deleteTemplateRule(cell.id);
            onChanged();
            return [];
        },
    }), [iso, ruleBySlot, onChanged]);

    const grid = useSlotGrid({
        slots: GRID_SLOTS,
        cells,
        storagePrefix: `daytrack_tmpl_${iso}`,
        scrollRef,
        ops,
        onChanged: () => { /* ops appellent déjà props.onChanged (reload de la page) */ },
        onNeedsPasteWarning,
    });

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

    // ── Édition d'un créneau (création simple + édition d'un bloc existant) ──
    const [editingSlot, setEditingSlot] = useState<string | null>(null);
    const [editMousePos, setEditMousePos] = useState<{ x: number; y: number } | null>(null);
    // Rect de la dernière cellule clic-droitée — pour ancrer les popovers ouverts depuis le menu.
    const [menuRect, setMenuRect] = useState<DOMRect | null>(null);
    const editingRule = editingSlot !== null ? (ruleBySlot.get(editingSlot) ?? null) : null;

    // ── Création d'une plage par clic-glisser sur des créneaux libres ──────
    const [rangeCreate, setRangeCreate] = useState<{ start: string; count: number } | null>(null);
    const wasDraggingRef = useRef(false);

    useEffect(() => {
        if (grid.isDragging) { wasDraggingRef.current = true; return; }
        if (!wasDraggingRef.current) return;
        wasDraggingRef.current = false;
        const sel = [...grid.selectedSlots].sort();
        // Un glisser sur ≥ 2 créneaux tous libres ouvre le popover de création sur la plage.
        // (Pour multi-sélectionner des créneaux libres — coller-multiple — utiliser shift-clic.)
        if (sel.length >= 2 && sel.every((s) => !ruleBySlot.has(s))) {
            setRangeCreate({ start: sel[0]!, count: sel.length });
        }
    }, [grid.isDragging, grid.selectedSlots, ruleBySlot]);

    // ── Récurrence / activation / suppression (inchangés) ─────────────────
    const [endDateRuleId, setEndDateRuleId] = useState<string | null>(null);
    const [endDateValue, setEndDateValue] = useState('');

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
            ...(isBreak ? {} : {
                ticketKey: rule.ticketKey,
                ticketSummary: rule.ticketSummary,
                ticketType: rule.ticketType,
                comment: rule.comment,
            }),
        });
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
                        placeholder={formatMinutes(DEFAULT_TARGET_MINUTES)}
                        className={cn(
                            'w-16 text-right text-[12px] font-medium outline-none border-b bg-transparent',
                            targetError ? 'border-destructive text-destructive' : 'border-amber-500 text-amber-950',
                        )}
                    />
                ) : (
                    <button
                        onClick={startEditingTarget}
                        title={t('templates.target.hint')}
                        className={cn(
                            'text-[12px] border-b border-dashed border-amber-400/50 hover:text-amber-950',
                            // Objectif propre à ce jour : plein contraste. Valeur par défaut : atténuée.
                            targetRule?.targetMinutes != null
                                ? 'font-medium text-amber-900/80'
                                : 'text-amber-900/45',
                        )}
                    >
                        {formatMinutes(targetRule?.targetMinutes ?? DEFAULT_TARGET_MINUTES)}
                    </button>
                )}
            </div>

            {/* Corps : lignes de grille + blocs + cellules d'interaction */}
            <div
                className="relative"
                style={{ height: gridHeight }}
                onClick={() => { if (!grid.consumeDragMoved()) grid.clearSelection(); }}
            >
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

                {/* z2 — blocs visuels (display-only, pas d'interaction) */}
                <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 2 }}>
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
                            <div
                                key={rule.id}
                                className={cn('absolute', !rule.enabled && 'opacity-40 grayscale')}
                                style={{ top, left: `${leftPct}%`, width: `${widthPct}%`, height }}
                                title={rotationTitle}
                            >
                                {isBreak ? (
                                    <PauseBlock top={0} height={height} slotCount={slotCount} runDurationMinutes={runDurationMinutes} />
                                ) : (
                                    <WorkBlock
                                        top={0}
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
                                        style={{ top: 3, right: 5 }}
                                    >
                                        {rotationIndex + 1}/{rotationSize}
                                    </span>
                                )}
                                {!rule.enabled && (
                                    <span
                                        className="absolute z-10 left-2 rounded bg-gray-700/80 px-1 text-[10px] font-medium text-white"
                                        style={{ top: 3 }}
                                    >
                                        {t('templates.block.disabled_badge')}
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* z5 — cellules d'interaction (clic / double-clic / clic droit / drag) */}
                <div className="absolute inset-0" style={{ zIndex: 5 }}>
                    {GRID_SLOTS.map((slot, idx) => {
                        const rule = ruleBySlot.get(slot) ?? null;
                        const entry = grid.entryMap.get(slot) ?? null;
                        const effectiveSelection =
                            grid.selectedSlots.has(slot) && grid.selectedSlots.size > 1
                                ? grid.selectedSlots
                                : new Set([slot]);

                        return (
                            <div
                                key={slot}
                                className="absolute left-0 right-0 group"
                                style={{ top: idx * SLOT_PX, height: SLOT_PX }}
                            >
                                <div
                                    className={cn(
                                        'absolute inset-0 rounded-sm pointer-events-none transition-colors',
                                        grid.selectedSlots.has(slot)
                                            ? 'bg-amber-400/25 ring-1 ring-inset ring-amber-500/60'
                                            : 'group-hover:bg-amber-400/10',
                                    )}
                                    style={{ zIndex: 3 }}
                                />
                                <TimeBlock
                                    slot={slot}
                                    isSelected={grid.selectedSlots.has(slot)}
                                    onSelect={(e) => grid.onSelect(slot, e)}
                                    onStartEdit={(x, y) => {
                                        setEditMousePos({ x, y });
                                        // Édition d'un bloc : viser son créneau de départ (clé de grid.save).
                                        setEditingSlot(rule?.startTime ?? slot);
                                    }}
                                    onContextMenuOpen={() => grid.onContextMenuOpen(slot)}
                                    onContextMenuOpenAt={(r) => setMenuRect(r)}
                                    onCellMouseDown={(e) => grid.onCellMouseDown(slot, e)}
                                    onDragExtend={() => grid.onDragExtend(slot)}
                                    onDropFavorite={() => grid.onDropFavorite(slot)}
                                    menu={
                                        <TemplateBlockMenu
                                            entry={entry}
                                            rule={rule}
                                            hasClipboard={grid.hasClipboard}
                                            onCopy={() => grid.onCopy()}
                                            onCut={() => void grid.onCut()}
                                            onPaste={() => void grid.onPaste(slot)}
                                            onClear={() => void grid.onClearRange(effectiveSelection)}
                                            onConvertToBreak={() => void grid.onConvertToBreak(effectiveSelection)}
                                            onEdit={() => {
                                                setEditMousePos(
                                                    menuRect
                                                        ? { x: menuRect.left, y: menuRect.bottom + 4 }
                                                        : { x: window.innerWidth / 2, y: 200 },
                                                );
                                                setEditingSlot(rule?.startTime ?? slot);
                                            }}
                                            onToggleType={() => {
                                                if (!rule) return;
                                                void recreateWithType(
                                                    rule,
                                                    rule.ruleType === TemplateRuleType.BREAK ? EntryType.WORK : EntryType.BREAK,
                                                ).then(onChanged);
                                            }}
                                            onSetInterval={(n) => { if (rule) void setRuleInterval(rule, n); }}
                                            onSetEndDate={() => {
                                                if (rule) { setEndDateValue(rule.activeUntil ?? today()); setEndDateRuleId(rule.id); }
                                            }}
                                            onClearEndDate={() => { if (rule) void clearEndDate(rule); }}
                                            onToggleEnabled={() => { if (rule) void toggleEnabled(rule); }}
                                            onDelete={() => { if (rule) void removeRule(rule); }}
                                        />
                                    }
                                />
                            </div>
                        );
                    })}
                </div>

                {/* Popover : création simple d'un créneau ou édition d'un bloc existant */}
                {editingSlot !== null && (
                    <EditPopover
                        slot={editingSlot}
                        entry={editingRule ? ruleToEntry(editingRule) : null}
                        anchorTop={GRID_SLOTS.indexOf(editingSlot) * SLOT_PX}
                        scrollContainer={scrollRef.current}
                        mousePos={editMousePos}
                        knownTickets={knownTickets}
                        onSave={(ticketKey, type, comment, ticketSummary, ticketType) => {
                            const s = editingSlot;
                            setEditingSlot(null);
                            setEditMousePos(null);
                            if (s === null) return;
                            const endedAt = editingRule
                                ? addMinutes(s, editingRule.durationMinutes ?? SLOT_MINUTES)
                                : getNextSlot(s);
                            void grid.save(
                                s,
                                ticketKey === null && type !== EntryType.BREAK
                                    ? null
                                    : { ticketKey, ticketSummary, ticketType, comment, type, endedAt },
                            );
                        }}
                        onCancel={() => { setEditingSlot(null); setEditMousePos(null); }}
                        onClear={() => {
                            const s = editingSlot;
                            setEditingSlot(null);
                            setEditMousePos(null);
                            if (s !== null && ruleBySlot.has(s)) void grid.save(s, null);
                        }}
                    />
                )}

                {/* Popover : création d'un bloc multi-créneaux (fin d'un glisser sur des créneaux libres) */}
                {rangeCreate !== null && (
                    <EditPopover
                        slot={rangeCreate.start}
                        entry={null}
                        anchorTop={GRID_SLOTS.indexOf(rangeCreate.start) * SLOT_PX}
                        scrollContainer={scrollRef.current}
                        mousePos={null}
                        knownTickets={knownTickets}
                        onSave={(ticketKey, type, comment, ticketSummary, ticketType) => {
                            const rc = rangeCreate;
                            setRangeCreate(null);
                            grid.clearSelection();
                            if (rc === null) return;
                            const isBreak = type === EntryType.BREAK;
                            void (async () => {
                                try {
                                    await createTemplateRule({
                                        ruleType: isBreak ? TemplateRuleType.BREAK : TemplateRuleType.WORK,
                                        weekday: iso,
                                        startTime: rc.start,
                                        durationMinutes: rc.count * SLOT_MINUTES,
                                        intervalWeeks: 1,
                                        ...(isBreak ? {} : { ticketKey, ticketSummary, ticketType, comment }),
                                    });
                                    onChanged();
                                } catch { /* service gère le message */ }
                            })();
                        }}
                        onCancel={() => { setRangeCreate(null); grid.clearSelection(); }}
                        onClear={() => { setRangeCreate(null); grid.clearSelection(); }}
                    />
                )}

                {endDateRuleId !== null && (
                    <div
                        className="fixed z-50 flex flex-col gap-2 rounded-lg border bg-popover p-3 shadow-lg"
                        style={{
                            top: menuRect ? menuRect.bottom + 4 : 120,
                            left: menuRect ? menuRect.left : '50%',
                            transform: menuRect ? undefined : 'translateX(-50%)',
                        }}
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
