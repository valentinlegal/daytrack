// Palette des couleurs disponibles pour les types de tickets Jira.
// Les classes Tailwind doivent être définies en dur ici pour que le tree-shaking fonctionne.
// Le mapping type → couleur est configuré dans .env (JIRA_TICKET_TYPES), pas dans ce fichier.

export interface TicketTypeStyle {
    leftBorder: string;  // bandeau gauche coloré
    ring: string;        // ring de sélection
    ticketKey: string;   // couleur de l'ID du ticket
    summary: string;     // couleur du titre (lecture seule)
    comment: string;     // couleur du commentaire
}

// Couleurs disponibles — ajouter une entrée ici pour en exposer une nouvelle dans .env
const PALETTE: Record<string, TicketTypeStyle> = {
    emerald: {
        leftBorder: 'border-l-emerald-400',
        ring: 'ring-2 ring-inset ring-emerald-400',
        ticketKey: 'text-emerald-700',
        summary: 'text-gray-500',
        comment: 'text-gray-800',
    },
    orange: {
        leftBorder: 'border-l-orange-400',
        ring: 'ring-2 ring-inset ring-orange-400',
        ticketKey: 'text-orange-700',
        summary: 'text-gray-500',
        comment: 'text-gray-800',
    },
    red: {
        leftBorder: 'border-l-red-400',
        ring: 'ring-2 ring-inset ring-red-400',
        ticketKey: 'text-red-700',
        summary: 'text-gray-500',
        comment: 'text-gray-800',
    },
    purple: {
        leftBorder: 'border-l-purple-400',
        ring: 'ring-2 ring-inset ring-purple-400',
        ticketKey: 'text-purple-700',
        summary: 'text-gray-500',
        comment: 'text-gray-800',
    },
    indigo: {
        leftBorder: 'border-l-indigo-400',
        ring: 'ring-2 ring-inset ring-indigo-400',
        ticketKey: 'text-indigo-700',
        summary: 'text-gray-500',
        comment: 'text-gray-800',
    },
    sky: {
        leftBorder: 'border-l-sky-400',
        ring: 'ring-2 ring-inset ring-sky-400',
        ticketKey: 'text-sky-700',
        summary: 'text-gray-500',
        comment: 'text-gray-800',
    },
    amber: {
        leftBorder: 'border-l-amber-400',
        ring: 'ring-2 ring-inset ring-amber-400',
        ticketKey: 'text-amber-700',
        summary: 'text-gray-500',
        comment: 'text-gray-800',
    },
    pink: {
        leftBorder: 'border-l-pink-400',
        ring: 'ring-2 ring-inset ring-pink-400',
        ticketKey: 'text-pink-700',
        summary: 'text-gray-500',
        comment: 'text-gray-800',
    },
    teal: {
        leftBorder: 'border-l-teal-400',
        ring: 'ring-2 ring-inset ring-teal-400',
        ticketKey: 'text-teal-700',
        summary: 'text-gray-500',
        comment: 'text-gray-800',
    },
    yellow: {
        leftBorder: 'border-l-yellow-400',
        ring: 'ring-2 ring-inset ring-yellow-400',
        ticketKey: 'text-yellow-700',
        summary: 'text-gray-500',
        comment: 'text-gray-800',
    },
};

// Style par défaut quand Jira n'est pas configuré ou que le type est absent du mapping
export const DEFAULT_TICKET_STYLE: TicketTypeStyle = {
    leftBorder: 'border-l-indigo-300',
    ring: 'ring-2 ring-inset ring-indigo-400',
    ticketKey: 'text-indigo-700',
    summary: 'text-gray-500',
    comment: 'text-gray-800',
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