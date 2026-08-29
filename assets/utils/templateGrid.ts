import { TemplateRuleType } from '@/types/api';
import type { TemplateRule } from '@/types/api';
import { generateTimeSlots, SLOT_MINUTES, shiftDate } from '@/utils/timeline';
import { t } from '@/i18n/fr';

/** Créneaux visibles de la grille Modèles — mêmes bornes que la timeline jour (07:00 → 19:45). */
export const GRID_SLOTS: string[] = generateTimeSlots();

/** Jours de semaine ISO-8601 : 1 = lundi … 7 = dimanche. */
export const WEEKDAYS: number[] = [1, 2, 3, 4, 5, 6, 7];

export function weekdayLabel(iso: number): string {
    return t(`templates.weekday.${iso}`);
}

/** "HH:mm" → minutes depuis 00:00. */
export function timeToMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}

/** minutes depuis 00:00 → "HH:mm" (borné 00:00–23:59). */
export function minutesToTime(min: number): string {
    const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(min)));
    const h = Math.floor(clamped / 60);
    const m = clamped % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Jour ISO (1–7) d'une date "YYYY-MM-DD" — convertit le 0=dimanche de JS en 7. */
function isoWeekday(dateStr: string): number {
    const js = new Date(dateStr + 'T00:00:00').getDay();
    return js === 0 ? 7 : js;
}

/** Première date "YYYY-MM-DD" tombant sur le jour `iso` à partir de `dateStr` (incluse). */
export function nextOccurrenceOnOrAfter(dateStr: string, iso: number): string {
    const diff = (iso - isoWeekday(dateStr) + 7) % 7;
    return shiftDate(dateStr, diff);
}

export interface TemplateBlock {
    rule: TemplateRule;
    startSlotIndex: number; // index dans GRID_SLOTS
    slotCount: number;      // nombre de créneaux de 15 min couverts
    rotationSize: number;   // 1 si règle simple, N si membre d'une alternance
    rotationIndex: number;  // 0-based, ordonné par anchorDate ; 0 si règle simple
}

const GRID_START_MIN = timeToMinutes(GRID_SLOTS[0]!);
const GRID_END_MIN = timeToMinutes(GRID_SLOTS[GRID_SLOTS.length - 1]!) + SLOT_MINUTES;

/** Règles WORK/BREAK d'un jour (activées ou non), triées par startTime puis position. */
export function entryRulesForWeekday(rules: TemplateRule[], iso: number): TemplateRule[] {
    return rules
        .filter((r) => r.weekday === iso && r.ruleType !== TemplateRuleType.TARGET_OVERRIDE)
        .sort((a, b) => {
            const byTime = (a.startTime ?? '').localeCompare(b.startTime ?? '');
            return byTime !== 0 ? byTime : a.position - b.position;
        });
}

/** Règle TARGET_OVERRIDE d'un jour, ou null. */
export function targetRuleForWeekday(rules: TemplateRule[], iso: number): TemplateRule | null {
    return rules.find(
        (r) => r.weekday === iso && r.ruleType === TemplateRuleType.TARGET_OVERRIDE,
    ) ?? null;
}

/** Membres d'un groupe d'alternance, ordonnés par anchorDate croissant. */
function rotationMembers(rules: TemplateRule[], groupId: string): TemplateRule[] {
    return rules
        .filter((r) => r.rotationGroupId === groupId)
        .sort((a, b) => a.anchorDate.localeCompare(b.anchorDate));
}

/**
 * Un TemplateBlock par règle WORK/BREAK du jour, clampé dans GRID_SLOTS.
 * Les règles entièrement hors de la fenêtre visible (créées via l'API avec un
 * startTime avant 07:00 ou après 19:45) sont omises — cas limite, non atteignable
 * via l'UI de création qui ne laisse déposer que dans la grille.
 */
export function buildColumnBlocks(rules: TemplateRule[], iso: number): TemplateBlock[] {
    const blocks: TemplateBlock[] = [];

    for (const rule of entryRulesForWeekday(rules, iso)) {
        if (rule.startTime === null || rule.durationMinutes === null) continue;

        const startMin = timeToMinutes(rule.startTime);
        const endMin = startMin + rule.durationMinutes;
        if (endMin <= GRID_START_MIN || startMin >= GRID_END_MIN) continue; // hors fenêtre

        const clampedStart = Math.max(startMin, GRID_START_MIN);
        const clampedEnd = Math.min(endMin, GRID_END_MIN);
        const startSlotIndex = Math.round((clampedStart - GRID_START_MIN) / SLOT_MINUTES);
        const slotCount = Math.max(1, Math.round((clampedEnd - clampedStart) / SLOT_MINUTES));

        let rotationSize = 1;
        let rotationIndex = 0;
        if (rule.rotationGroupId !== null) {
            const members = rotationMembers(rules, rule.rotationGroupId);
            rotationSize = members.length;
            rotationIndex = Math.max(0, members.findIndex((m) => m.id === rule.id));
        }

        blocks.push({ rule, startSlotIndex, slotCount, rotationSize, rotationIndex });
    }

    return blocks;
}

/**
 * Première règle WORK/BREAK activée du jour dont la plage horaire recoupe
 * [startMin, startMin + durMin), en ignorant `excludeId`. null si le créneau est libre.
 */
export function findColumnOverlap(
    rules: TemplateRule[],
    iso: number,
    startMin: number,
    durMin: number,
    excludeId?: string,
): TemplateRule | null {
    const endMin = startMin + durMin;
    for (const rule of entryRulesForWeekday(rules, iso)) {
        if (!rule.enabled || rule.id === excludeId) continue;
        if (rule.startTime === null || rule.durationMinutes === null) continue;
        const s = timeToMinutes(rule.startTime);
        const e = s + rule.durationMinutes;
        if (startMin < e && s < endMin) return rule;
    }
    return null;
}
