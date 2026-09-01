import { Coffee } from 'lucide-react';
import { formatMinutes, SLOT_PX } from '@/utils/timeline';
import { t } from '@/i18n/fr';
import { cn } from '@/lib/utils';

// Composants purement visuels d'un bloc de la grille (timeline jour + grille Modèles).
// Aucune logique d'interaction : positionnés en absolu par le parent via top/height.

export interface WorkBlockProps {
    top: number;
    height: number;
    slotCount: number;
    ticket: string;
    summary: string | null;
    comment: string | null;
    colors: { bg: string; bar: string; text: string; border: string; ring: string };
    runDurationMinutes: number;
    isSelected: boolean;
    /** Afficher la durée même sur un créneau de 15 min (défaut : oui — vue jour ; la vue Modèles passe `false`). */
    showShortDuration?: boolean;
    /** Colonnes étroites (vue Modèles) : resserre l'espacement ID ↔ titre. */
    compact?: boolean;
}

export function WorkBlock({ top, height, slotCount, ticket, summary, comment, colors, runDurationMinutes, showShortDuration = true, compact = false }: WorkBlockProps) {
    const single = slotCount === 1;
    const dur = formatMinutes(runDurationMinutes);
    const showDur = showShortDuration || runDurationMinutes > 15;
    const idWidth = compact ? 58 : 80;
    const idGap = compact ? '6px' : '10px';

    return (
        <div
            className="absolute left-1 right-1 rounded-lg overflow-hidden flex"
            style={{
                top: top + 1,
                height: height - 1,
                background: colors.bg,
                border: `1px solid ${colors.border}`,
                zIndex: 2,
            }}
        >
            {/* Barre colorée gauche */}
            <div className="w-1 shrink-0 self-stretch" style={{ background: colors.bar }} />

            {/* Corps */}
            <div className={cn('relative flex flex-col flex-1 min-w-0 overflow-hidden', compact ? 'px-2' : 'px-3')}>
                {single ? (
                    /* Créneau unique — 3 colonnes : ID | [titre commentaire] | durée */
                    <div
                        className="grid items-center h-full min-w-0"
                        style={{ gridTemplateColumns: `${idWidth}px minmax(0,1fr) auto`, gap: idGap }}
                    >
                        <span
                            className="font-mono text-[12.5px] font-semibold tabular-nums tracking-wide truncate"
                            style={{ color: colors.text }}
                        >
                            {ticket}
                        </span>
                        {/* Titre collé au commentaire — gap identique au gap externe ; titre coupé à 50% si commentaire */}
                        <div className="flex items-center min-w-0 overflow-hidden" style={{ gap: compact ? '8px' : '16px' }}>
                            {(summary || !comment) && (
                                <span
                                    className="text-[12.5px] font-medium text-gray-800 truncate shrink-0"
                                    style={comment ? { maxWidth: '50%' } : undefined}
                                >
                                    {summary ?? ''}
                                </span>
                            )}
                            {comment && (
                                <span className="text-[12px] text-muted-foreground truncate flex-1 min-w-0">
                                    {comment}
                                </span>
                            )}
                        </div>
                        {showDur && (
                            <span className="font-mono text-[11.5px] font-medium tabular-nums shrink-0" style={{ color: 'oklch(0.556 0 0)' }}>
                                {dur}
                            </span>
                        )}
                    </div>
                ) : (
                    /* Bloc multi-créneaux */
                    <>
                        <div
                            className="flex min-w-0"
                            style={{ gap: idGap, minHeight: SLOT_PX - 2 }}
                        >
                            <span
                                className="font-mono text-[12.5px] font-semibold tabular-nums tracking-wide truncate shrink-0"
                                style={{ color: colors.text, width: idWidth, paddingTop: 4 }}
                            >
                                {ticket}
                            </span>
                            <div className="flex flex-col min-w-0 overflow-hidden gap-px py-1">
                                {summary && (
                                    <span
                                        className="text-[13px] font-medium text-gray-800 leading-snug overflow-hidden"
                                        style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflowWrap: 'anywhere' }}
                                    >
                                        {summary}
                                    </span>
                                )}
                                {comment && (
                                    <span
                                        className="text-[12.5px] leading-snug overflow-hidden"
                                        style={{ color: 'oklch(0.556 0 0)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as const, overflowWrap: 'anywhere' }}
                                    >
                                        {comment}
                                    </span>
                                )}
                            </div>
                        </div>
                        {/* Durée absolue en bas à droite */}
                        {showDur && (
                            <div className="absolute bottom-1 right-2 pointer-events-none">
                                <span
                                    className="font-mono text-[11.5px] font-medium tabular-nums pl-1"
                                    style={{ color: 'oklch(0.556 0 0)', background: colors.bg }}
                                >
                                    {dur}
                                </span>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

export interface PauseBlockProps {
    top: number;
    height: number;
    slotCount: number;
    runDurationMinutes: number;
}

export function PauseBlock({ top, height, runDurationMinutes }: PauseBlockProps) {
    const dur = formatMinutes(runDurationMinutes);
    const showDur = runDurationMinutes > 15;

    return (
        <div
            className="absolute left-1 right-1 rounded-lg overflow-hidden flex items-center justify-center"
            style={{
                top: top + 1,
                height: height - 1,
                background: 'repeating-linear-gradient(135deg,oklch(0.96 0 0) 0px,oklch(0.96 0 0) 6px,oklch(0.93 0 0) 6px,oklch(0.93 0 0) 7px)',
                border: '1px solid oklch(0.92 0 0)',
                zIndex: 2,
            }}
        >
            {/* Badge pill centré verticalement */}
            <div
                className="inline-flex items-center gap-2 bg-white rounded-full border border-gray-200"
                style={{ padding: '4px 12px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', fontSize: 12 }}
            >
                <Coffee className="w-3.5 h-3.5 shrink-0" style={{ color: 'oklch(0.556 0 0)' }} />
                <span className="font-medium" style={{ color: 'oklch(0.145 0 0)' }}>{t('timeline.break_label')}</span>
                {showDur && (
                    <span className="font-mono tabular-nums" style={{ fontSize: 11.5, color: 'oklch(0.556 0 0)' }}>{dur}</span>
                )}
            </div>
        </div>
    );
}
