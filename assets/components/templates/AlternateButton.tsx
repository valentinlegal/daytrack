import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { JiraTicketInfo, TemplateRule } from '@/types/api';
import { TemplateRuleType } from '@/types/api';
import { today, shiftDate } from '@/utils/timeline';
import { nextOccurrenceOnOrAfter } from '@/utils/templateGrid';
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
}

/** Bouton « + » au survol d'un bloc simple : transforme le créneau en alternance à 2 membres. */
export default function AlternateButton({ rule, iso, knownTickets, onChanged }: AlternateButtonProps) {
    const [open, setOpen] = useState(false);
    const [ticket, setTicket] = useState('');
    const [startDate, setStartDate] = useState(today());
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

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
            const groupId = crypto.randomUUID();
            const anchor0 = nextOccurrenceOnOrAfter(startDate, iso);
            const anchor1 = shiftDate(anchor0, 7);
            const wasBreak = rule.ruleType === TemplateRuleType.BREAK;
            await deleteTemplateRule(rule.id);
            await createTemplateRule({
                ruleType: wasBreak ? TemplateRuleType.BREAK : TemplateRuleType.WORK,
                weekday: iso,
                startTime: rule.startTime,
                durationMinutes: rule.durationMinutes,
                intervalWeeks: 2,
                anchorDate: anchor0,
                rotationGroupId: groupId,
                ...(wasBreak ? {} : { ticketKey: rule.ticketKey, ticketSummary: rule.ticketSummary, ticketType: rule.ticketType, comment: rule.comment }),
            });
            await createTemplateRule({
                ruleType: TemplateRuleType.WORK,
                weekday: iso,
                startTime: rule.startTime,
                durationMinutes: rule.durationMinutes,
                intervalWeeks: 2,
                anchorDate: anchor1,
                rotationGroupId: groupId,
                ticketKey: key,
                ticketSummary: info?.summary ?? null,
                ticketType: info?.type ?? null,
                comment: null,
            });
            setOpen(false);
            setTicket('');
            onChanged();
        } catch (e) {
            setError(e instanceof Error ? e.message : t('templates.error.save'));
        } finally {
            setBusy(false);
        }
    }

    return (
        <>
            <button
                type="button"
                aria-label={t('templates.alternate.add')}
                title={t('templates.alternate.add')}
                onClick={(e) => { e.stopPropagation(); setStartDate(today()); setError(null); setOpen(true); }}
                className="pointer-events-auto flex h-4 w-4 items-center justify-center rounded bg-amber-900/70 text-white opacity-60 transition-opacity hover:opacity-100"
            >
                <Plus className="h-3 w-3" />
            </button>

            {open && (
                <div
                    className="fixed z-50 flex w-64 flex-col gap-2 rounded-lg border bg-popover p-3 shadow-lg"
                    style={{ top: 120, left: '50%', transform: 'translateX(-50%)' }}
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
