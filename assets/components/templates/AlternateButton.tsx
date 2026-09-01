import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { JiraTicketInfo, TemplateRule } from '@/types/api';
import { TemplateRuleType } from '@/types/api';
import { today, shiftDate } from '@/utils/timeline';
import { nextOccurrenceOnOrAfter } from '@/utils/templateGrid';
import { clampToViewport } from '@/utils/viewport';
import { createTemplateRule, deleteTemplateRule } from '@/services/templateRuleService';
import { fetchTicketInfo } from '@/services/jiraService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { t } from '@/i18n/fr';

interface AlternateButtonProps {
    rule: TemplateRule;
    iso: number;
    knownTickets: Record<string, JiraTicketInfo>;
    onChanged: () => void;
    /** L'alternance ne peut pas être représentée par l'undo → on invalide l'historique de la colonne. */
    onHistoryInvalidate: () => void;
}

/**
 * Bouton « + » sur un bloc simple : le transforme en alternance à 2 membres,
 * une semaine sur deux (cadence non modifiable, jamais plus de 2 tickets).
 */
export default function AlternateButton({ rule, iso, knownTickets, onChanged, onHistoryInvalidate }: AlternateButtonProps) {
    const [open, setOpen] = useState(false);
    const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
    const [ticket, setTicket] = useState('');
    const [startDate, setStartDate] = useState(today());
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const popoverRef = useRef<HTMLDivElement>(null);

    // Fermer au clic extérieur ou à Escape
    useEffect(() => {
        if (!open) return;
        function onDown(e: MouseEvent) {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false);
        }
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') setOpen(false);
        }
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    // Garde le popover entièrement visible : recadré sur sa taille réelle (avant
    // peinture, sans clignotement) et à chaque changement de taille — ex : ligne
    // d'erreur qui apparaît — ou redimensionnement de la fenêtre.
    useLayoutEffect(() => {
        if (!open) return;
        const el = popoverRef.current;
        if (el === null) return;
        function clamp() {
            const el2 = popoverRef.current;
            if (el2 === null) return;
            const { height, width } = el2.getBoundingClientRect();
            setAnchor((a) => {
                if (a === null) return a;
                const next = clampToViewport(a.top, a.left, height, width);
                return next.top === a.top && next.left === a.left ? a : next;
            });
        }
        clamp();
        const observer = new ResizeObserver(clamp);
        observer.observe(el);
        window.addEventListener('resize', clamp);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', clamp);
        };
    }, [open]);

    async function submit() {
        const key = ticket.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
        if (!key) { setError(t('templates.error.save')); return; }
        setBusy(true);
        setError(null);
        try {
            let info: JiraTicketInfo | null = null;
            try { info = await fetchTicketInfo(key, knownTickets); } catch (e) {
                setError(e instanceof Error ? e.message : t('templates.error.save'));
                setBusy(false);
                return;
            }

            // Crée une alternance à 2 membres depuis un bloc simple.
            const groupId = crypto.randomUUID();
            const anchor0 = nextOccurrenceOnOrAfter(startDate, iso);
            const anchor1 = shiftDate(anchor0, 7);
            const wasBreak = rule.ruleType === TemplateRuleType.BREAK;
            const content = wasBreak
                ? {}
                : { ticketKey: rule.ticketKey, ticketSummary: rule.ticketSummary, ticketType: rule.ticketType, comment: rule.comment };

            // Pas de transaction côté API : on supprime le bloc d'origine puis on crée
            // les 2 membres. Si une création échoue, on annule (suppression des membres
            // déjà créés + recréation du bloc simple) pour ne pas laisser la colonne
            // cassée / un groupe de rotation à 1 membre.
            await deleteTemplateRule(rule.id);
            const createdIds: string[] = [];
            try {
                const m0 = await createTemplateRule({
                    ruleType: wasBreak ? TemplateRuleType.BREAK : TemplateRuleType.WORK,
                    weekday: iso, startTime: rule.startTime, durationMinutes: rule.durationMinutes,
                    intervalWeeks: 2, anchorDate: anchor0, rotationGroupId: groupId, ...content,
                });
                createdIds.push(m0.id);
                const m1 = await createTemplateRule({
                    ruleType: TemplateRuleType.WORK,
                    weekday: iso, startTime: rule.startTime, durationMinutes: rule.durationMinutes,
                    intervalWeeks: 2, anchorDate: anchor1, rotationGroupId: groupId,
                    ticketKey: key, ticketSummary: info?.summary ?? null, ticketType: info?.type ?? null, comment: null,
                });
                createdIds.push(m1.id);
            } catch (err) {
                for (const id of createdIds) {
                    try { await deleteTemplateRule(id); } catch { /* best effort */ }
                }
                try {
                    await createTemplateRule({
                        ruleType: rule.ruleType, weekday: iso, startTime: rule.startTime,
                        durationMinutes: rule.durationMinutes, intervalWeeks: rule.intervalWeeks,
                        // anchorDate omis s'il est passé (rejeté par l'API) → le back reprend la prochaine occurrence.
                        ...(rule.anchorDate >= today() ? { anchorDate: rule.anchorDate } : {}),
                        enabled: rule.enabled, ...content,
                    });
                } catch { /* best effort */ }
                throw err;
            }
            setOpen(false);
            setTicket('');
            onHistoryInvalidate();
            onChanged();
        } catch (e) {
            setError(e instanceof Error ? e.message : t('templates.error.save'));
        } finally {
            setBusy(false);
        }
    }

    const label = t('templates.alternate.add');

    return (
        <>
            <button
                type="button"
                aria-label={label}
                title={label}
                onClick={(e) => {
                    e.stopPropagation();
                    // Position brute sous le bouton ; le useLayoutEffect la recadre
                    // dans la fenêtre selon la taille réelle du popover.
                    const r = e.currentTarget.getBoundingClientRect();
                    setAnchor({ top: r.bottom + 4, left: r.left });
                    setStartDate(today());
                    setError(null);
                    setOpen(true);
                }}
                className="pointer-events-auto flex h-4 w-4 items-center justify-center rounded bg-amber-900/70 text-white opacity-60 transition-opacity hover:opacity-100"
            >
                <Plus className="h-3 w-3" />
            </button>

            {open && (
                <div
                    ref={popoverRef}
                    className="pointer-events-auto fixed z-50 flex w-64 flex-col gap-2 rounded-lg border bg-popover p-3 shadow-lg"
                    style={anchor ?? { top: 120, left: 120 }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                >
                    <span className="text-[12px] font-medium">{t('templates.alternate.title')}</span>
                    <label className="text-[12px] text-muted-foreground">{t('templates.alternate.ticket_label')}</label>
                    <Input
                        autoFocus
                        value={ticket}
                        onChange={(e) => { setTicket(e.target.value); setError(null); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') void submit(); if (e.key === 'Escape') setOpen(false); }}
                        placeholder="PROJ-123"
                        className="h-8 font-mono text-[13px] uppercase"
                        disabled={busy}
                    />
                    <label className="text-[12px] text-muted-foreground">{t('templates.alternate.start_label')}</label>
                    <input
                        type="date"
                        min={today()}
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="h-8 rounded-md border border-input px-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    />
                    <p className="text-[11px] text-muted-foreground">{t('templates.alternate.start_hint')}</p>
                    {error && <p className="text-[11px] text-red-500">{error}</p>}
                    <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                            {t('templates.alternate.cancel')}
                        </Button>
                        <Button size="sm" onClick={() => void submit()} disabled={busy}>
                            {t('templates.alternate.confirm')}
                        </Button>
                    </div>
                </div>
            )}
        </>
    );
}
