import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
    mergeAdjacentBlocks,
    minutesToTime,
    nextOccurrenceOnOrAfter,
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '@/i18n/fr';
import { cn } from '@/lib/utils';
import TemplateBlockMenu from './TemplateBlockMenu';
import AlternateButton from './AlternateButton';

interface TemplateColumnProps {
    iso: number;
    rules: TemplateRule[];
    knownTickets: Record<string, JiraTicketInfo>;
    onChanged: () => void;
    scrollRef: React.RefObject<HTMLDivElement | null>;
    onNeedsPasteWarning: () => void;
    /** iso de la colonne dont la sélection est active — les autres colonnes vident la leur. */
    activeIso: number | null;
    onActivate: (iso: number) => void;
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
    activeIso,
    onActivate,
}: TemplateColumnProps) {
    const columnRules = useMemo(() => entryRulesForWeekday(rules, iso), [rules, iso]);
    const blocks = useMemo(() => buildColumnBlocks(rules, iso), [rules, iso]);
    // Fusion purement visuelle des blocs adjacents identiques (parité avec la vue Timeline) —
    // n'affecte pas `blocks` lui-même, utilisé tel quel pour l'overlay d'alternance et l'interaction.
    const visualBlocks = useMemo(() => mergeAdjacentBlocks(blocks), [blocks]);
    const targetRule = useMemo(() => targetRuleForWeekday(rules, iso), [rules, iso]);
    const gridHeight = GRID_SLOTS.length * SLOT_PX;
    const bodyRef = useRef<HTMLDivElement>(null);

    /** Règles WORK/BREAK qui couvrent `slot` (0, 1, ou N sur une alternance). */
    function rulesCoveringSlot(slot: string): TemplateRule[] {
        const slotMin = timeToMinutes(slot);
        return columnRules.filter(
            (r) => r.startTime !== null && r.durationMinutes !== null
                && timeToMinutes(r.startTime) <= slotMin
                && slotMin < timeToMinutes(r.startTime) + r.durationMinutes,
        );
    }

    /** Règle visée sur un créneau ; sur une alternance, choisit le membre selon la position X du clic. */
    function resolveRuleAt(slot: string, clientX: number): TemplateRule | null {
        const here = rulesCoveringSlot(slot);
        if (here.length <= 1) return here[0] ?? null;
        const members = [...here].sort((a, b) => a.anchorDate.localeCompare(b.anchorDate));
        const body = bodyRef.current?.getBoundingClientRect();
        if (!body || body.width === 0) return members[0]!;
        const idx = Math.min(
            members.length - 1,
            Math.max(0, Math.floor((clientX - body.left) / (body.width / members.length))),
        );
        return members[idx]!;
    }

    // Dernier membre d'alternance pointé par créneau (clic gauche ou droit) — permet à la
    // copie (clic droit *et* ⌘C, ce dernier n'ayant pas de position X) de cibler le membre
    // réellement sélectionné plutôt que le dernier de la liste (voir `resolveCopyCell`).
    const pickedMemberRef = useRef<Map<string, string>>(new Map());
    function notePickedMember(slot: string, clientX: number) {
        const here = rulesCoveringSlot(slot);
        if (here.length <= 1) { pickedMemberRef.current.delete(slot); return; }
        const picked = resolveRuleAt(slot, clientX);
        if (picked) pickedMemberRef.current.set(slot, picked.id);
    }

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
                intervalWeeks: r.intervalWeeks,
                anchorDate: r.anchorDate,
            })),
        [columnRules],
    );

    /** Cellule du membre d'alternance pointé sur `slot` — voir `pickedMemberRef`. */
    const resolveCopyCell = useCallback((slot: string): SlotCell | undefined => {
        const ruleId = pickedMemberRef.current.get(slot);
        return ruleId ? cells.find((c) => c.id === ruleId) : undefined;
    }, [cells]);

    const ops = useMemo(() => ({
        async createCell(slot: string, data: SlotCellInput): Promise<SlotCell[]> {
            const isBreak = data.type === EntryType.BREAK;
            await createTemplateRule({
                ruleType: isBreak ? TemplateRuleType.BREAK : TemplateRuleType.WORK,
                weekday: iso,
                startTime: slot,
                durationMinutes: Math.max(SLOT_MINUTES, timeToMinutes(data.endedAt) - timeToMinutes(slot)),
                intervalWeeks: data.intervalWeeks ?? 1,
                // Semaine d'ancrage choisie (récurrence > 1 sem.). Ignorée si passée
                // (undo tardif) — le back retombe alors sur la prochaine occurrence.
                ...(data.anchorDate && data.anchorDate >= today() ? { anchorDate: data.anchorDate } : {}),
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
                    intervalWeeks: data.intervalWeeks ?? rule.intervalWeeks,
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
                const patch: Record<string, unknown> = {
                    ticketKey: targetIsBreak ? null : data.ticketKey,
                    ticketSummary: targetIsBreak ? null : data.ticketSummary,
                    ticketType: targetIsBreak ? null : data.ticketType,
                    comment: targetIsBreak ? null : data.comment,
                };
                // Redimensionnement en place (ex : undo d'un rétrécissement) — le PUT
                // conserve l'id. Pas de patch si la durée ne change pas (édition de contenu).
                const targetDuration = Math.max(
                    SLOT_MINUTES,
                    timeToMinutes(data.endedAt) - timeToMinutes(cell.startedAt),
                );
                if (rule && rule.durationMinutes !== targetDuration) {
                    patch.durationMinutes = targetDuration;
                }
                if (data.intervalWeeks !== undefined && data.intervalWeeks !== rule?.intervalWeeks) {
                    patch.intervalWeeks = data.intervalWeeks;
                }
                if (data.anchorDate !== undefined && data.anchorDate !== rule?.anchorDate
                    && data.anchorDate >= today()) {
                    patch.anchorDate = data.anchorDate;
                }
                await updateTemplateRule(cell.id, patch);
            }
            onChanged();
            return [];
        },
        async deleteCell(cell: SlotCell): Promise<SlotCell[]> {
            await deleteTemplateRule(cell.id);
            onChanged();
            return [];
        },
        // Retire seulement `slots` d'un bloc : rétrécit (bord) ou scinde en deux règles (milieu).
        async clearSlots(cell: SlotCell, slots: string[]): Promise<SlotCell[]> {
            const rule = ruleBySlot.get(cell.startedAt);
            if (!rule || rule.startTime === null || rule.durationMinutes === null) {
                await deleteTemplateRule(cell.id);
                onChanged();
                return [];
            }
            const startMin = timeToMinutes(rule.startTime);
            const removeMins = new Set(slots.map((s) => timeToMinutes(s)));
            const remaining: number[] = [];
            for (let m = startMin; m < startMin + rule.durationMinutes; m += SLOT_MINUTES) {
                if (!removeMins.has(m)) remaining.push(m);
            }
            if (remaining.length === 0) {
                await deleteTemplateRule(rule.id);
                onChanged();
                return [];
            }
            // Séries contiguës de créneaux restants.
            const runs: Array<[number, number]> = [];
            let runStart = remaining[0]!;
            let prev = remaining[0]!;
            for (let i = 1; i < remaining.length; i++) {
                const m = remaining[i]!;
                if (m === prev + SLOT_MINUTES) { prev = m; continue; }
                runs.push([runStart, prev + SLOT_MINUTES]);
                runStart = m;
                prev = m;
            }
            runs.push([runStart, prev + SLOT_MINUTES]);

            const isBreak = rule.ruleType === TemplateRuleType.BREAK;
            const content = isBreak ? {} : {
                ticketKey: rule.ticketKey,
                ticketSummary: rule.ticketSummary,
                ticketType: rule.ticketType,
                comment: rule.comment,
            };
            // 1re série → règle d'origine (mise à jour) ; suivantes → nouvelles règles.
            const [f0, f1] = runs[0]!;
            await updateTemplateRule(rule.id, {
                startTime: minutesToTime(f0),
                durationMinutes: f1 - f0,
            });
            for (let i = 1; i < runs.length; i++) {
                const [s, e] = runs[i]!;
                await createTemplateRule({
                    ruleType: rule.ruleType,
                    weekday: iso,
                    startTime: minutesToTime(s),
                    durationMinutes: e - s,
                    intervalWeeks: rule.intervalWeeks,
                    anchorDate: rule.anchorDate,
                    activeUntil: rule.activeUntil,
                    enabled: rule.enabled,
                    rotationGroupId: rule.rotationGroupId,
                    ...content,
                });
            }
            onChanged();
            return [];
        },
    }), [iso, ruleBySlot, onChanged]);

    // ── Édition d'un créneau (création simple + édition d'un bloc existant) ──
    const [editingSlot, setEditingSlot] = useState<string | null>(null);
    // Règle précise en cours d'édition (null = création). Nécessaire pour une alternance :
    // deux règles partagent le même créneau, on ne peut pas la retrouver via le créneau seul.
    const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
    const [editMousePos, setEditMousePos] = useState<{ x: number; y: number } | null>(null);
    // Rect + X du dernier clic droit — pour ancrer / cibler les popovers ouverts depuis le menu.
    const [menuRect, setMenuRect] = useState<DOMRect | null>(null);
    const menuClickXRef = useRef(0);
    // Récurrence choisie dans le formulaire (champs ajoutés au EditPopover).
    const [draftInterval, setDraftInterval] = useState(1);
    // Semaine d'ancrage — n'a de sens (et n'est affichée) que si draftInterval > 1.
    const [draftAnchor, setDraftAnchor] = useState(() => nextOccurrenceOnOrAfter(today(), iso));
    const [recurrenceError, setRecurrenceError] = useState<string | null>(null);
    const editingRule = editingRuleId !== null ? (columnRules.find((r) => r.id === editingRuleId) ?? null) : null;

    // Plage de créneaux libres sélectionnée par clic-glisser → popover de création à la souris.
    const [rangeCreate, setRangeCreate] = useState<{ slots: string[]; pos: { x: number; y: number } } | null>(null);

    function openEditor(rule: TemplateRule | null, slot: string, pos: { x: number; y: number }) {
        setRangeCreate(null);
        setRecurrenceError(null);
        setDraftInterval(rule?.intervalWeeks ?? 1);
        setDraftAnchor(
            rule?.anchorDate && rule.anchorDate >= today()
                ? rule.anchorDate
                : nextOccurrenceOnOrAfter(today(), iso),
        );
        setEditingRuleId(rule?.id ?? null);
        setEditMousePos(pos);
        setEditingSlot(rule?.startTime ?? slot);
    }
    function closeEditor() {
        setEditingSlot(null);
        setEditingRuleId(null);
        setEditMousePos(null);
        setRecurrenceError(null);
    }
    // Identité stable : évite que le useEffect([entry]) du EditPopover ne réécrase la saisie.
    const editingEntry = useMemo(() => (editingRule ? ruleToEntry(editingRule) : null), [editingRule]);

    // Un membre d'alternance a sa cadence verrouillée sur « une semaine sur deux ».
    const recurrenceLocked = editingRule?.rotationGroupId != null;

    /** Champs récurrence (intervalle + semaine d'ancrage) injectés dans le EditPopover. */
    const recurrenceField = (
        <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1">
                <span className="text-[12px] font-medium" style={{ color: 'var(--foreground)' }}>
                    {t('templates.recurrence.menu')}
                </span>
                <select
                    value={draftInterval}
                    disabled={recurrenceLocked}
                    onChange={(e) => { setDraftInterval(Number(e.target.value)); setRecurrenceError(null); }}
                    className="h-8 rounded-md border border-input bg-background px-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    <option value={1}>{t('templates.recurrence.every_week')}</option>
                    {[2, 3, 4].map((n) => (
                        <option key={n} value={n}>
                            {t('templates.recurrence.every_n_weeks').replace('{n}', String(n))}
                        </option>
                    ))}
                </select>
                {recurrenceLocked && (
                    <span className="text-[11px] text-muted-foreground">
                        {t('templates.recurrence.locked_by_rotation')}
                    </span>
                )}
            </label>

            {/* Semaine d'ancrage : ne compte que pour une cadence > 1 semaine. */}
            {!recurrenceLocked && draftInterval > 1 && (
                <label className="flex flex-col gap-1">
                    <span className="text-[12px] font-medium" style={{ color: 'var(--foreground)' }}>
                        {t('templates.recurrence.start_label')}
                    </span>
                    <input
                        type="date"
                        min={today()}
                        value={draftAnchor}
                        onChange={(e) => { if (e.target.value) setDraftAnchor(nextOccurrenceOnOrAfter(e.target.value, iso)); }}
                        className="h-8 rounded-md border border-input bg-background px-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    />
                    <span className="text-[11px] text-muted-foreground">
                        {t('templates.recurrence.start_hint')}
                    </span>
                </label>
            )}
        </div>
    );

    const grid = useSlotGrid({
        slots: GRID_SLOTS,
        cells,
        storagePrefix: `daytrack_tmpl_${iso}`,
        scrollRef,
        ops,
        // L'historique (undo/redo, indexé par id de cellule) reste valide même quand la
        // colonne porte une alternance : seuls les 3 chemins qui modifient une règle en
        // dehors du moteur (créer une alternance, éditer/effacer un de ses membres,
        // pause→travail) invalident l'historique via grid.clearHistory() — voir plus bas.
        // Le reste (coller, effacer, convertir en pause…) passe par le moteur et reste
        // undo-able, y compris sur le créneau de l'alternance elle-même.
        // 7 colonnes montées : ⌘Z ne doit agir que sur celle qui a la sélection.
        scopeUndoToSelection: true,
        // Conteneur de scroll partagé par les 7 colonnes → persistance gérée une
        // seule fois par TemplatesPage, pas par colonne.
        persistScroll: false,
        resolveCopyCell,
        onChanged: () => { /* ops appellent déjà props.onChanged (reload de la page) */ },
        onNeedsPasteWarning,
        onDragRange: (slots, pos) => {
            // Si un bloc est copié, on laisse la sélection en place pour un collage
            // (Ctrl+V) au lieu d'ouvrir la popup de création par-dessus
            if (grid.hasClipboard) return;
            // N'ouvrir la création que si la plage ne contient aucun bloc.
            if (slots.every((s) => !ruleBySlot.has(s))) {
                closeEditor();
                setDraftInterval(1);
                setDraftAnchor(nextOccurrenceOnOrAfter(today(), iso));
                setRangeCreate({ slots, pos });
            }
        },
    });

    // Une seule colonne garde sa sélection à la fois.
    useEffect(() => {
        if (grid.selectedSlots.size > 0 && activeIso !== iso) onActivate(iso);
    }, [grid.selectedSlots.size, activeIso, iso, onActivate]);
    useEffect(() => {
        if (activeIso !== null && activeIso !== iso) grid.clearSelection();
    }, [activeIso, iso, grid.clearSelection]);

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

    return (
        <div className="flex flex-col min-w-[150px] flex-1 border-r border-amber-200/70 last:border-r-0">
            {/* En-tête : libellé jour + objectif — collé en haut au scroll vertical */}
            <div className="sticky top-0 z-20 h-9 flex items-center justify-between px-2 shrink-0 border-b border-amber-200/70 bg-amber-50">
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
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onClick={startEditingTarget}
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
                        </TooltipTrigger>
                        <TooltipContent side="bottom">{t('templates.target.hint')}</TooltipContent>
                    </Tooltip>
                )}
            </div>

            {/* Corps : lignes de grille + blocs + cellules d'interaction.
                mt-2 : même respiration que la gouttière sous l'en-tête collé. */}
            <div
                ref={bodyRef}
                className="relative mt-2"
                style={{ height: gridHeight }}
                onClick={grid.onBackgroundClick}
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
                    {visualBlocks.map(({ rule, startSlotIndex, slotCount, rotationSize, rotationIndex }) => {
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
                                style={{ top, left: `${leftPct}%`, width: `${widthPct}%`, height }}
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
                                        showShortDuration={false}
                                        compact
                                    />
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
                                    onSelect={(e) => { notePickedMember(slot, e.clientX); grid.onSelect(slot, e); }}
                                    onStartEdit={(x, y) => openEditor(resolveRuleAt(slot, x), slot, { x, y })}
                                    onContextMenuOpen={() => grid.onContextMenuOpen(slot)}
                                    onContextMenuOpenAt={(r, cx) => {
                                        setMenuRect(r);
                                        menuClickXRef.current = cx;
                                        notePickedMember(slot, cx);
                                    }}
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
                                            onEdit={() => openEditor(
                                                resolveRuleAt(slot, menuClickXRef.current),
                                                slot,
                                                menuRect
                                                    ? { x: menuRect.left, y: menuRect.bottom + 4 }
                                                    : { x: window.innerWidth / 2, y: 200 },
                                            )}
                                            onToggleType={() => {
                                                if (!rule) return;
                                                // pause → travail : pas d'équivalent dans le moteur → recréation directe,
                                                // et on invalide l'historique (l'undo ne saurait pas le représenter).
                                                if (rule.ruleType === TemplateRuleType.BREAK) {
                                                    void recreateWithType(rule, EntryType.WORK).then(() => {
                                                        grid.clearHistory();
                                                        onChanged();
                                                    });
                                                } else {
                                                    void grid.onConvertToBreak(new Set([slot]));
                                                }
                                            }}
                                            onSetInterval={(n) => { if (rule) void setRuleInterval(rule, n); }}
                                            onSetEndDate={() => {
                                                if (rule) { setEndDateValue(rule.activeUntil ?? today()); setEndDateRuleId(rule.id); }
                                            }}
                                            onClearEndDate={() => { if (rule) void clearEndDate(rule); }}
                                            onToggleEnabled={() => { if (rule) void toggleEnabled(rule); }}
                                            // « Supprimer la règle » = tout le bloc : on passe tous ses créneaux.
                                            onDelete={() => {
                                                if (!rule || rule.startTime === null || rule.durationMinutes === null) {
                                                    void grid.onClearRange(new Set([slot]));
                                                    return;
                                                }
                                                const all = new Set<string>();
                                                const sm = timeToMinutes(rule.startTime);
                                                for (let m = sm; m < sm + rule.durationMinutes; m += SLOT_MINUTES) {
                                                    all.add(minutesToTime(m));
                                                }
                                                void grid.onClearRange(all);
                                            }}
                                        />
                                    }
                                />
                            </div>
                        );
                    })}
                </div>

                {/* z10 — overlay alternance : badge de rotation + bouton « + » (ajout d'un membre, jusqu'à 4) */}
                <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 10 }}>
                    {blocks.map(({ rule, startSlotIndex, rotationSize, rotationIndex }) => {
                        const widthPct = 100 / rotationSize;
                        const leftPct = rotationIndex * widthPct;
                        // « + » uniquement sur un bloc simple : il crée une alternance à 2 membres,
                        // une semaine sur deux. Une alternance ne s'étend pas au-delà de 2.
                        const showPlus = rule.rotationGroupId === null;
                        return (
                            <div
                                key={rule.id}
                                className="absolute"
                                style={{ top: startSlotIndex * SLOT_PX + 3, left: `${leftPct}%`, width: `${widthPct}%` }}
                            >
                                <div className="absolute right-1 top-0 flex items-center gap-1">
                                    {rotationSize > 1 && (
                                        <span
                                            className="rounded bg-amber-900/80 px-1 text-[10px] font-semibold text-white"
                                            title={t('templates.recurrence.cadence_tooltip')
                                                .replace('{n}', String(rule.intervalWeeks))
                                                .replace('{pos}', String(rotationIndex + 1))
                                                .replace('{size}', String(rotationSize))}
                                        >
                                            {rotationIndex + 1}/{rotationSize}
                                        </span>
                                    )}
                                    {showPlus && (
                                        <AlternateButton
                                            rule={rule}
                                            iso={iso}
                                            knownTickets={knownTickets}
                                            onChanged={onChanged}
                                            onHistoryInvalidate={grid.clearHistory}
                                        />
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Popover : création simple d'un créneau ou édition d'un bloc existant */}
                {editingSlot !== null && (
                    <EditPopover
                        slot={editingSlot}
                        entry={editingEntry}
                        anchorTop={GRID_SLOTS.indexOf(editingSlot) * SLOT_PX}
                        scrollContainer={scrollRef.current}
                        mousePos={editMousePos}
                        knownTickets={knownTickets}
                        extraField={recurrenceField}
                        extraFieldError={recurrenceError}
                        onSave={(ticketKey, type, comment, ticketSummary, ticketType) => {
                            const s = editingSlot;
                            const er = editingRule;
                            if (s === null) { closeEditor(); return; }
                            const wantClear = ticketKey === null && type !== EntryType.BREAK;
                            const toBreak = type === EntryType.BREAK;

                            // Membre d'alternance : deux règles au même créneau → patch direct de la règle visée,
                            // et cadence verrouillée (se gère en recréant l'alternance).
                            if (er && er.rotationGroupId != null) {
                                if (!wantClear && draftInterval !== er.intervalWeeks) {
                                    setRecurrenceError(t('templates.recurrence.locked_by_rotation'));
                                    return; // garde le popover ouvert
                                }
                                closeEditor();
                                const done = () => { grid.clearHistory(); onChanged(); };
                                if (wantClear) { void deleteTemplateRule(er.id).then(done); return; }
                                if (toBreak !== (er.ruleType === TemplateRuleType.BREAK)) {
                                    void recreateWithType(er, toBreak ? EntryType.BREAK : EntryType.WORK).then(done);
                                } else {
                                    void updateTemplateRule(er.id, {
                                        ticketKey: toBreak ? null : ticketKey,
                                        ticketSummary: toBreak ? null : ticketSummary,
                                        ticketType: toBreak ? null : ticketType,
                                        comment: toBreak ? null : comment,
                                    }).then(done);
                                }
                                return;
                            }

                            // Bloc simple : chemin moteur (tracé).
                            closeEditor();
                            const endedAt = er ? addMinutes(s, er.durationMinutes ?? SLOT_MINUTES) : getNextSlot(s);
                            void grid.save(
                                s,
                                wantClear
                                    ? null
                                    : {
                                        ticketKey, ticketSummary, ticketType, comment, type, endedAt,
                                        intervalWeeks: draftInterval,
                                        anchorDate: draftInterval > 1 ? draftAnchor : undefined,
                                    },
                            );
                        }}
                        onCancel={() => closeEditor()}
                        onClear={() => {
                            const s = editingSlot;
                            const er = editingRule;
                            closeEditor();
                            if (er && er.rotationGroupId != null) {
                                void deleteTemplateRule(er.id).then(() => { grid.clearHistory(); onChanged(); });
                                return;
                            }
                            if (s !== null && ruleBySlot.has(s)) void grid.save(s, null);
                        }}
                    />
                )}

                {/* Popover : création d'un bloc multi-créneaux (fin d'un glisser sur des créneaux libres) */}
                {rangeCreate !== null && (
                    <EditPopover
                        slot={rangeCreate.slots[0]!}
                        entry={null}
                        anchorTop={0}
                        scrollContainer={scrollRef.current}
                        mousePos={rangeCreate.pos}
                        knownTickets={knownTickets}
                        extraField={recurrenceField}
                        onSave={(ticketKey, type, comment, ticketSummary, ticketType) => {
                            const rc = rangeCreate;
                            setRangeCreate(null);
                            grid.clearSelection();
                            if (rc === null || (ticketKey === null && type !== EntryType.BREAK)) return;
                            const sorted = [...rc.slots].sort();
                            const start = sorted[0]!;
                            const endedAt = addMinutes(start, rc.slots.length * SLOT_MINUTES);
                            // Passe par le moteur → création d'une règle de durée pleine, tracée dans l'historique.
                            void grid.save(start, {
                                ticketKey, ticketSummary, ticketType, comment, type,
                                endedAt, intervalWeeks: draftInterval,
                                anchorDate: draftInterval > 1 ? draftAnchor : undefined,
                            });
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
