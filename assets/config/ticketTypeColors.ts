// Palette des couleurs disponibles pour les types de tickets Jira.
// Les classes Tailwind doivent être définies en dur ici pour que le tree-shaking fonctionne.
// Le mapping type → couleur est configuré dans .env (JIRA_TICKET_TYPES), pas dans ce fichier.

export interface TicketTypeStyle {
    leftBorder: string;  // bandeau gauche coloré
    ring: string;        // ring de sélection
    ticketKey: string;   // couleur de l'ID du ticket
    summary: string;     // couleur du titre (lecture seule)
    comment: string;     // couleur du commentaire
    blockBg: string;     // fond teinté pour les blocs fusionnés
    dotColor: string;    // point coloré dans les favoris / header
    barColor: string;    // fond de la barre gauche des pills favoris (même teinte que ticketKey)
    borderColor: string; // couleur de bordure pour les inputs inline (même teinte que ticketKey)
}

// Couleurs disponibles — ajouter une entrée ici pour en exposer une nouvelle dans .env
const PALETTE: Record<string, TicketTypeStyle> = {
    green: {
        leftBorder: 'border-l-green-400',
        ring: 'ring-2 ring-inset ring-green-700',
        ticketKey: 'text-green-700',
        summary: 'text-gray-500',
        comment: 'text-gray-800',
        blockBg: 'bg-green-50',
        dotColor: 'bg-green-400',
        barColor: 'bg-green-700',
        borderColor: 'border-green-700',
    },
    blue: {
        leftBorder: 'border-l-blue-400',
        ring: 'ring-2 ring-inset ring-blue-700',
        ticketKey: 'text-blue-700',
        summary: 'text-gray-500',
        comment: 'text-gray-800',
        blockBg: 'bg-blue-50',
        dotColor: 'bg-blue-400',
        barColor: 'bg-blue-700',
        borderColor: 'border-blue-700',
    },
    emerald: {
        leftBorder: 'border-l-emerald-400',
        ring: 'ring-2 ring-inset ring-emerald-700',
        ticketKey: 'text-emerald-700',
        summary: 'text-gray-500',
        comment: 'text-gray-800',
        blockBg: 'bg-emerald-50',
        dotColor: 'bg-emerald-400',
        barColor: 'bg-emerald-700',
        borderColor: 'border-emerald-700',
    },
    orange: {
        leftBorder: 'border-l-orange-400',
        ring: 'ring-2 ring-inset ring-orange-700',
        ticketKey: 'text-orange-700',
        summary: 'text-gray-500',
        comment: 'text-gray-800',
        blockBg: 'bg-orange-50',
        dotColor: 'bg-orange-400',
        barColor: 'bg-orange-700',
        borderColor: 'border-orange-700',
    },
    red: {
        leftBorder: 'border-l-red-400',
        ring: 'ring-2 ring-inset ring-red-700',
        ticketKey: 'text-red-700',
        summary: 'text-gray-500',
        comment: 'text-gray-800',
        blockBg: 'bg-red-50',
        dotColor: 'bg-red-400',
        barColor: 'bg-red-700',
        borderColor: 'border-red-700',
    },
    purple: {
        leftBorder: 'border-l-purple-400',
        ring: 'ring-2 ring-inset ring-purple-700',
        ticketKey: 'text-purple-700',
        summary: 'text-gray-500',
        comment: 'text-gray-800',
        blockBg: 'bg-purple-50',
        dotColor: 'bg-purple-400',
        barColor: 'bg-purple-700',
        borderColor: 'border-purple-700',
    },
    indigo: {
        leftBorder: 'border-l-indigo-400',
        ring: 'ring-2 ring-inset ring-indigo-700',
        ticketKey: 'text-indigo-700',
        summary: 'text-gray-500',
        comment: 'text-gray-800',
        blockBg: 'bg-indigo-50',
        dotColor: 'bg-indigo-400',
        barColor: 'bg-indigo-700',
        borderColor: 'border-indigo-700',
    },
    sky: {
        leftBorder: 'border-l-sky-400',
        ring: 'ring-2 ring-inset ring-sky-700',
        ticketKey: 'text-sky-700',
        summary: 'text-gray-500',
        comment: 'text-gray-800',
        blockBg: 'bg-sky-50',
        dotColor: 'bg-sky-400',
        barColor: 'bg-sky-700',
        borderColor: 'border-sky-700',
    },
    amber: {
        leftBorder: 'border-l-amber-400',
        ring: 'ring-2 ring-inset ring-amber-700',
        ticketKey: 'text-amber-700',
        summary: 'text-gray-500',
        comment: 'text-gray-800',
        blockBg: 'bg-amber-50',
        dotColor: 'bg-amber-400',
        barColor: 'bg-amber-700',
        borderColor: 'border-amber-700',
    },
    pink: {
        leftBorder: 'border-l-pink-400',
        ring: 'ring-2 ring-inset ring-pink-700',
        ticketKey: 'text-pink-700',
        summary: 'text-gray-500',
        comment: 'text-gray-800',
        blockBg: 'bg-pink-50',
        dotColor: 'bg-pink-400',
        barColor: 'bg-pink-700',
        borderColor: 'border-pink-700',
    },
    teal: {
        leftBorder: 'border-l-teal-400',
        ring: 'ring-2 ring-inset ring-teal-700',
        ticketKey: 'text-teal-700',
        summary: 'text-gray-500',
        comment: 'text-gray-800',
        blockBg: 'bg-teal-50',
        dotColor: 'bg-teal-400',
        barColor: 'bg-teal-700',
        borderColor: 'border-teal-700',
    },
    yellow: {
        leftBorder: 'border-l-yellow-400',
        ring: 'ring-2 ring-inset ring-yellow-700',
        ticketKey: 'text-yellow-700',
        summary: 'text-gray-500',
        comment: 'text-gray-800',
        blockBg: 'bg-yellow-50',
        dotColor: 'bg-yellow-400',
        barColor: 'bg-yellow-700',
        borderColor: 'border-yellow-700',
    },
};

// Style par défaut quand Jira n'est pas configuré ou que le type est absent du mapping
export const DEFAULT_TICKET_STYLE: TicketTypeStyle = {
    leftBorder: 'border-l-indigo-300',
    ring: 'ring-2 ring-inset ring-indigo-700',
    ticketKey: 'text-indigo-700',
    summary: 'text-gray-500',
    comment: 'text-gray-800',
    blockBg: 'bg-indigo-50',
    dotColor: 'bg-indigo-400',
    barColor: 'bg-indigo-700',
    borderColor: 'border-indigo-700',
};

// Mapping type de ticket → nom de couleur, lu depuis data-jira-ticket-types sur #app
// Chargé une seule fois au démarrage depuis le DOM (valeur injectée par Symfony)
const TICKET_TYPE_MAPPING: Record<string, string> = (() => {
    try {
        const raw = document.getElementById('app')?.dataset.jiraTicketTypes;
        return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
        return {};
    }
})();

export function getTicketTypeStyle(ticketType: string | null | undefined): TicketTypeStyle {
    if (!ticketType) return DEFAULT_TICKET_STYLE;
    const colorName = TICKET_TYPE_MAPPING[ticketType];
    return (colorName ? PALETTE[colorName] : null) ?? DEFAULT_TICKET_STYLE;
}

/** Couleurs hex pour les blocs visuels (timeline, favoris) — même teintes que la palette Tailwind */
export const BLOCK_COLOR_MAP: Record<string, { bg: string; bar: string; text: string; border: string; ring: string }> = {
    green:   { bg: '#f0fdf4', bar: '#22c55e', text: '#15803d', border: 'rgba(34,197,94,0.25)',  ring: '#4ade80' },
    blue:    { bg: '#eff6ff', bar: '#3b82f6', text: '#1d4ed8', border: 'rgba(59,130,246,0.25)', ring: '#60a5fa' },
    emerald: { bg: '#ecfdf5', bar: '#10b981', text: '#047857', border: 'rgba(16,185,129,0.25)', ring: '#34d399' },
    orange:  { bg: '#fff7ed', bar: '#f97316', text: '#c2410c', border: 'rgba(249,115,22,0.25)', ring: '#fb923c' },
    red:     { bg: '#fef2f2', bar: '#ef4444', text: '#b91c1c', border: 'rgba(239,68,68,0.25)',  ring: '#f87171' },
    purple:  { bg: '#faf5ff', bar: '#a855f7', text: '#7e22ce', border: 'rgba(168,85,247,0.25)', ring: '#c084fc' },
    indigo:  { bg: '#eef2ff', bar: '#6366f1', text: '#4338ca', border: 'rgba(99,102,241,0.25)', ring: '#818cf8' },
    sky:     { bg: '#f0f9ff', bar: '#0ea5e9', text: '#0369a1', border: 'rgba(14,165,233,0.25)', ring: '#38bdf8' },
    amber:   { bg: '#fffbeb', bar: '#f59e0b', text: '#b45309', border: 'rgba(245,158,11,0.25)', ring: '#fbbf24' },
    pink:    { bg: '#fdf2f8', bar: '#ec4899', text: '#be185d', border: 'rgba(236,72,153,0.25)', ring: '#f472b6' },
    teal:    { bg: '#f0fdfa', bar: '#14b8a6', text: '#0f766e', border: 'rgba(20,184,166,0.25)', ring: '#2dd4bf' },
    yellow:  { bg: '#fefce8', bar: '#eab308', text: '#a16207', border: 'rgba(234,179,8,0.25)',  ring: '#facc15' },
};

/** Déduit les couleurs hex d'un type de ticket (fallback : indigo) */
export function getBlockColors(ticketType: string | null | undefined): typeof BLOCK_COLOR_MAP[string] {
    const style = getTicketTypeStyle(ticketType);
    for (const [name, colors] of Object.entries(BLOCK_COLOR_MAP)) {
        if (style.barColor.includes(name)) return colors;
    }
    return BLOCK_COLOR_MAP.indigo!;
}
