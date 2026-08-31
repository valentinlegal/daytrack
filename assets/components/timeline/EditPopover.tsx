import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Coffee, Trash2 } from 'lucide-react';
import { EntryType } from '@/types/api';
import type { JiraTicketInfo, TimeEntry } from '@/types/api';
import { fetchTicketInfo, getCachedTicketInfo } from '@/services/jiraService';
import { t } from '@/i18n/fr';
import { cn } from '@/lib/utils';
import { getTicketTypeStyle } from '@/config/ticketTypeColors';
import { VIEWPORT_MARGIN, clampToViewport } from '@/utils/viewport';

interface EditPopoverProps {
    slot: string;
    entry: TimeEntry | null;
    anchorTop: number;
    scrollContainer: HTMLElement | null;
    mousePos: { x: number; y: number } | null;
    knownTickets: Record<string, JiraTicketInfo>;
    onSave: (ticketKey: string | null, type: EntryType, comment: string | null, ticketSummary: string | null, ticketType: string | null) => void;
    onCancel: () => void;
    onClear: () => void;
    /** Champ additionnel injecté par le consommateur (ex : récurrence côté Modèles), rendu sous le commentaire. */
    extraField?: React.ReactNode;
    /** Message d'erreur affiché sous `extraField` (empêche la fermeture côté consommateur). */
    extraFieldError?: string | null;
}

const SLOT_HEIGHT = 32;
const POPOVER_WIDTH = 360;
const POPOVER_HEIGHT_EST = 248;

export default function EditPopover({
    slot,
    entry,
    anchorTop,
    scrollContainer,
    mousePos,
    knownTickets,
    onSave,
    onCancel,
    onClear,
    extraField,
    extraFieldError,
}: EditPopoverProps) {
    const ref = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const commentRef = useRef<HTMLTextAreaElement>(null);

    const [commentValue, setCommentValue] = useState(
        entry?.type === EntryType.BREAK ? '' : (entry?.comment ?? ''),
    );
    const [localSummary, setLocalSummary] = useState<string | null>(entry?.ticketSummary ?? null);
    const [localTicketType, setLocalTicketType] = useState<string | null>(entry?.ticketType ?? null);
    const [isFetchingTicket, setIsFetchingTicket] = useState(false);
    const [ticketError, setTicketError] = useState(false);
    const [ticketFetchError, setTicketFetchError] = useState<string | null>(null);

    const isFetchingRef = useRef(false);
    const [popoverPos, setPopoverPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

    // Placement initial — mesuré sur la taille *réelle* du popover (l'estimation ne
    // suffit pas : il est plus haut avec le champ récurrence). useLayoutEffect →
    // repositionné avant peinture, sans clignotement.
    useLayoutEffect(() => {
        const measured = ref.current?.getBoundingClientRect();
        const h = measured && measured.height > 0 ? measured.height : POPOVER_HEIGHT_EST;
        const w = measured && measured.width > 0 ? measured.width : POPOVER_WIDTH;

        let desiredTop: number;
        let desiredLeft: number;

        if (mousePos) {
            // Près du curseur ; bascule au-dessus si ça déborderait en bas.
            desiredLeft = mousePos.x + 4;
            desiredTop = mousePos.y + h < window.innerHeight - VIEWPORT_MARGIN
                ? mousePos.y + 4
                : mousePos.y - h;
        } else if (scrollContainer !== null) {
            const containerRect = scrollContainer.getBoundingClientRect();
            // Pixel absolu dans la fenêtre du bas du slot
            const slotBottomInViewport =
                anchorTop - scrollContainer.scrollTop + containerRect.top + SLOT_HEIGHT;
            const belowTop = slotBottomInViewport + 6;
            desiredTop = belowTop + h < window.innerHeight - VIEWPORT_MARGIN
                ? belowTop
                : slotBottomInViewport - SLOT_HEIGHT - h - 6;
            // Centré dans la zone timeline (après la gouttière de 56px)
            const gutterW = 56;
            const tlLeft = containerRect.left + gutterW;
            const tlWidth = containerRect.width - gutterW - 8;
            desiredLeft = tlLeft + (tlWidth - w) / 2;
        } else {
            return;
        }

        setPopoverPos(clampToViewport(desiredTop, desiredLeft, h, w));
    }, [anchorTop, scrollContainer, mousePos]);

    // Le contenu grandit après coup (sélection d'une récurrence → apparition du
    // champ date) : on recadre la position courante dans la fenêtre à chaque
    // changement de taille du popover, et au redimensionnement de la fenêtre.
    useEffect(() => {
        const el = ref.current;
        if (el === null) return;
        function reclamp() {
            const el2 = ref.current;
            if (el2 === null) return;
            const { height, width } = el2.getBoundingClientRect();
            setPopoverPos((pos) => {
                const next = clampToViewport(pos.top, pos.left, height, width);
                return next.top === pos.top && next.left === pos.left ? pos : next;
            });
        }
        const observer = new ResizeObserver(reclamp);
        observer.observe(el);
        window.addEventListener('resize', reclamp);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', reclamp);
        };
    }, []);

    useEffect(() => {
        setTimeout(() => inputRef.current?.focus(), 0);
    }, []);

    // Valeur initiale du champ ticket
    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.value = entry?.type === EntryType.BREAK ? '' : (entry?.ticketKey ?? '');
        }
    }, [entry]);

    // Fermer au clic extérieur ou Escape
    useEffect(() => {
        function onMouseDown(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) onCancel();
        }
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onCancel();
        }
        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [onCancel]);

    function handleTicketInput() {
        setTicketError(false);
        setTicketFetchError(null);
        const raw = inputRef.current?.value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '') ?? '';
        if (!raw) { setLocalTicketType(null); setLocalSummary(null); return; }
        const cached = getCachedTicketInfo(raw, knownTickets);
        if (cached) {
            setLocalTicketType(cached.type);
            setLocalSummary(cached.summary);
        } else if (raw !== (entry?.ticketKey ?? '')) {
            setLocalTicketType(null);
            setLocalSummary(null);
        }
    }

    async function doFetch(raw: string): Promise<{ summary: string | null; type: string | null; error: string | null }> {
        if (!raw) { setLocalSummary(null); setLocalTicketType(null); return { summary: null, type: null, error: null }; }
        if (raw === entry?.ticketKey && entry.ticketSummary) {
            return { summary: entry.ticketSummary, type: entry.ticketType ?? null, error: null };
        }
        isFetchingRef.current = true;
        setIsFetchingTicket(true);
        try {
            const info = await fetchTicketInfo(raw, knownTickets);
            if (info) {
                setLocalSummary(info.summary);
                setLocalTicketType(info.type);
                setTicketFetchError(null);
                return { summary: info.summary, type: info.type, error: null };
            }
            if (raw !== entry?.ticketKey) { setLocalSummary(null); setLocalTicketType(null); }
            return { summary: null, type: null, error: null };
        } catch (err) {
            const msg = err instanceof Error ? err.message : t('timeline.ticket_fetch_error');
            setLocalSummary(null);
            setLocalTicketType(null);
            setTicketFetchError(msg);
            return { summary: null, type: null, error: msg };
        } finally {
            isFetchingRef.current = false;
            setIsFetchingTicket(false);
        }
    }

    async function handleTicketBlur() {
        const raw = inputRef.current?.value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '') ?? '';
        await doFetch(raw);
    }

    function save(summaryOverride?: string | null, typeOverride?: string | null) {
        const ticketKey = inputRef.current?.value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '') || null;
        const comment = commentValue.trim() || null;
        if (ticketFetchError !== null) return;
        if (ticketKey === null) {
            if (comment !== null) { setTicketError(true); return; }
            if (entry?.type === EntryType.BREAK) { onCancel(); return; }
            if (entry) { onClear(); return; }
            onCancel();
            return;
        }
        setTicketError(false);
        onSave(
            ticketKey,
            EntryType.WORK,
            comment,
            summaryOverride !== undefined ? summaryOverride : localSummary,
            typeOverride !== undefined ? typeOverride : localTicketType,
        );
    }

    async function submitTicket() {
        const raw = inputRef.current?.value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '') ?? '';
        if (!raw) { save(); return; }
        const { summary, type, error } = await doFetch(raw);
        if (error !== null) return;
        save(summary, type);
    }

    async function handleTicketKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter') {
            await submitTicket();
        } else if (e.key === 'Tab') {
            e.preventDefault();
            commentRef.current?.focus();
        }
    }

    function handleCommentKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
        // Entrée seule = sauvegarde, Shift+Entrée = saut de ligne
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
    }

    const editStyle = getTicketTypeStyle(localTicketType);
    const keyColor = ticketFetchError !== null ? '#dc2626' : undefined;

    return (
        <div
            ref={ref}
            className="fixed z-50 flex flex-col gap-2.5"
            style={{
                top: popoverPos.top,
                left: popoverPos.left,
                width: POPOVER_WIDTH,
                background: 'var(--popover, white)',
                border: '1px solid var(--border, #e5e7eb)',
                borderRadius: 10,
                boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)',
                padding: 12,
                animation: 'dt-pop-in 120ms ease-out',
            }}
            onMouseDown={(e) => e.stopPropagation()}
        >
            {/* En-tête : label + heure */}
            <div className="flex items-baseline justify-between">
                <span className="text-[12px] font-medium" style={{ color: 'var(--foreground)' }}>Ticket</span>
                <span className="font-mono text-[11.5px]" style={{ color: 'var(--muted-foreground)' }}>{slot}</span>
            </div>

            {/* Champ ticket */}
            <div className="flex flex-col gap-1">
                <input
                    ref={inputRef}
                    onInput={handleTicketInput}
                    onKeyDown={handleTicketKeyDown}
                    onBlur={handleTicketBlur}
                    placeholder={t('timeline.ticket_placeholder')}
                    className={cn(
                        'h-8 px-2.5 border rounded-md bg-background font-mono text-[13px] font-semibold uppercase outline-none w-full',
                        'placeholder:text-muted-foreground placeholder:font-normal placeholder:normal-case',
                        'transition-[border-color,box-shadow]',
                        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
                        ticketError || ticketFetchError ? 'border-red-400' : 'border-input',
                    )}
                    style={keyColor ? { color: keyColor } : undefined}
                />
                {/* Hint sous le champ */}
                <div className="min-h-[16px] flex items-center gap-1.5 px-0.5">
                    {ticketFetchError ? (
                        <span className="text-[12px] font-mono text-red-500">{ticketFetchError}</span>
                    ) : ticketError ? (
                        <span className="text-[12px] font-mono text-red-500">{t('timeline.ticket_required')}</span>
                    ) : isFetchingTicket ? (
                        <span className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--muted-foreground)' }}>
                            <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin shrink-0" />
                            Recherche dans Jira…
                        </span>
                    ) : localSummary ? (
                        <span className={cn('text-[12px] truncate', editStyle.summary)}>{localSummary}</span>
                    ) : (
                        <span className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>Aperçu du titre Jira</span>
                    )}
                </div>
            </div>

            {/* Champ commentaire */}
            <div className="flex flex-col gap-1">
                <label className="text-[12px] font-medium" style={{ color: 'var(--foreground)' }}>Commentaire</label>
                <textarea
                    ref={commentRef}
                    value={commentValue}
                    onChange={(e) => setCommentValue(e.target.value)}
                    onKeyDown={handleCommentKeyDown}
                    placeholder="Optionnel — décrire ce qui a été fait"
                    rows={2}
                    className={cn(
                        'w-full px-2.5 py-2 border border-input rounded-md bg-background text-[13px] outline-none resize-y',
                        'transition-[border-color,box-shadow]',
                        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
                        'placeholder:text-muted-foreground',
                    )}
                    style={{ color: 'var(--foreground)' }}
                />
            </div>

            {extraField}
            {extraFieldError && (
                <p className="text-[12px] text-red-500 -mt-1">{extraFieldError}</p>
            )}

            {/* Pied : actions */}
            <div
                className="flex items-center gap-1.5 pt-2 mt-1"
                style={{ borderTop: '1px solid var(--border)' }}
            >
                <button
                    onClick={() => void submitTicket()}
                    className="inline-flex items-center justify-center h-7 px-3 rounded-md text-[12.5px] font-medium transition-colors bg-primary text-primary-foreground enabled:hover:bg-primary/90"
                >
                    {t('timeline.save')}
                </button>
                <div className="flex-1" />
                <button
                    onClick={() => onSave(null, EntryType.BREAK, null, null, null)}
                    className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[12.5px] font-medium transition-colors hover:bg-accent"
                    style={{ color: 'var(--foreground)' }}
                >
                    <Coffee className="w-3.5 h-3.5 shrink-0" />
                    Convertir en pause
                </button>
                {entry && (
                    <button
                        onClick={() => onClear()}
                        className="inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors text-destructive hover:bg-destructive/10"
                        aria-label={t('timeline.clear')}
                    >
                        <Trash2 className="w-3.5 h-3.5 shrink-0" />
                    </button>
                )}
            </div>
        </div>
    );
}
