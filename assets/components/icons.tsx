/**
 * Les icônes de DayTrack. Décoratives, sauf le logo : le bouton ou le texte qui les porte
 * dit ce qu'elles montrent.
 */

const STROKE = {
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
} as const;

/** Le logo, dans la couleur du texte : le trait d'un bloc de la grille, devant le nom. */
export function Logo() {
    return (
        <svg
            viewBox="0 -1005 4970.5 1271.1"
            role="img"
            aria-label="DayTrack"
            className="h-ctl-sm w-auto flex-none text-ink"
        >
            <path
                fill="currentColor"
                d="M251.3 -1005H251.3A0 0 0 0 1 251.3 -1005V266A0 0 0 0 1 251.3 266H251.3A251.3 251.3 0 0 1 0 14.8V-753.8A251.3 251.3 0 0 1 251.3 -1005Z"
            />
            <path
                fill="currentColor"
                d="M570.5 0H742.5C854.5 0 921.5 -11 981.5 -41C1095.5 -97 1162.5 -219 1162.5 -368C1162.5 -508 1104.5 -624 1001.5 -686C943.5 -721 855.5 -739 739.5 -739H570.5ZM707.5 -131V-608H734.5C821.5 -608 868.5 -600 911.5 -578C981.5 -542 1024.5 -463 1024.5 -368C1024.5 -279 983.5 -200 917.5 -164C876.5 -141 819.5 -131 737.5 -131Z M1216.5 -275C1216.5 -108 1333.5 13 1495.5 13C1573.5 13 1626.5 -12 1679.5 -72V0H1801.5V-554H1679.5V-480C1633.5 -541 1578.5 -567 1498.5 -567C1334.5 -567 1216.5 -444 1216.5 -275ZM1350.5 -272C1350.5 -373 1417.5 -445 1512.5 -445C1607.5 -445 1675.5 -374 1675.5 -273C1675.5 -181 1615.5 -109 1514.5 -109C1417.5 -109 1350.5 -175 1350.5 -272Z M1836.5 -554 2039.5 -52 1935.5 185H2078.5L2398.5 -554H2245.5L2111.5 -195L1988.5 -554Z M2411.5 -608H2548.5V0H2685.5V-608H2822.5V-739H2411.5Z M2842.5 0H2975.5V-308C2975.5 -394 3014.5 -437 3094.5 -439V-567H3084.5C3027.5 -567 2999.5 -551 2964.5 -500V-554H2842.5Z M3132.5 -275C3132.5 -108 3249.5 13 3411.5 13C3489.5 13 3542.5 -12 3595.5 -72V0H3717.5V-554H3595.5V-480C3549.5 -541 3494.5 -567 3414.5 -567C3250.5 -567 3132.5 -444 3132.5 -275ZM3266.5 -272C3266.5 -373 3333.5 -445 3428.5 -445C3523.5 -445 3591.5 -374 3591.5 -273C3591.5 -181 3531.5 -109 3430.5 -109C3333.5 -109 3266.5 -175 3266.5 -272Z M3786.5 -277C3786.5 -116 3918.5 13 4082.5 13C4211.5 13 4311.5 -58 4357.5 -182H4207.5C4174.5 -131 4136.5 -109 4081.5 -109C3989.5 -109 3920.5 -181 3920.5 -278C3920.5 -375 3986.5 -445 4078.5 -445C4138.5 -445 4180.5 -420 4207.5 -369H4357.5C4314.5 -496 4204.5 -567 4078.5 -567C3914.5 -567 3786.5 -440 3786.5 -277Z M4444.5 0H4577.5V-259L4766.5 0H4945.5L4715.5 -283L4913.5 -554H4754.5L4577.5 -293V-739H4444.5Z"
            />
        </svg>
    );
}

/** Le logo sur deux lignes, le long d'un seul trait : celui de la page de bienvenue. */
export function StackedLogo() {
    return (
        <svg
            viewBox="0 -945.9 3083.3 2276.1"
            role="img"
            aria-label="DayTrack"
            className="h-bar w-auto flex-none text-ink"
        >
            <path
                fill="currentColor"
                d="M251.3 -945.9H251.3A0 0 0 0 1 251.3 -945.9V1330.2A0 0 0 0 1 251.3 1330.2H251.3A251.3 251.3 0 0 1 0 1078.9V-694.7A251.3 251.3 0 0 1 251.3 -945.9Z"
            />
            <g fill="currentColor" transform="translate(517.3 0)">
                <path d="M68 0H240C352 0 419 -11 479 -41C593 -97 660 -219 660 -368C660 -508 602 -624 499 -686C441 -721 353 -739 237 -739H68ZM205 -131V-608H232C319 -608 366 -600 409 -578C479 -542 522 -463 522 -368C522 -279 481 -200 415 -164C374 -141 317 -131 235 -131Z M714 -275C714 -108 831 13 993 13C1071 13 1124 -12 1177 -72V0H1299V-554H1177V-480C1131 -541 1076 -567 996 -567C832 -567 714 -444 714 -275ZM848 -272C848 -373 915 -445 1010 -445C1105 -445 1173 -374 1173 -273C1173 -181 1113 -109 1012 -109C915 -109 848 -175 848 -272Z M1334 -554 1537 -52 1433 185H1576L1896 -554H1743L1609 -195L1486 -554Z" />
                <path d="M7 367.5H144V975.5H281V367.5H418V236.5H7Z M438 975.5H571V667.5C571 581.5 610 538.5 690 536.5V408.5H680C623 408.5 595 424.5 560 475.5V421.5H438Z M728 700.5C728 867.5 845 988.5 1007 988.5C1085 988.5 1138 963.5 1191 903.5V975.5H1313V421.5H1191V495.5C1145 434.5 1090 408.5 1010 408.5C846 408.5 728 531.5 728 700.5ZM862 703.5C862 602.5 929 530.5 1024 530.5C1119 530.5 1187 601.5 1187 702.5C1187 794.5 1127 866.5 1026 866.5C929 866.5 862 800.5 862 703.5Z M1382 698.5C1382 859.5 1514 988.5 1678 988.5C1807 988.5 1907 917.5 1953 793.5H1803C1770 844.5 1732 866.5 1677 866.5C1585 866.5 1516 794.5 1516 697.5C1516 600.5 1582 530.5 1674 530.5C1734 530.5 1776 555.5 1803 606.5H1953C1910 479.5 1800 408.5 1674 408.5C1510 408.5 1382 535.5 1382 698.5Z M2040 975.5H2173V716.5L2362 975.5H2541L2311 692.5L2509 421.5H2350L2173 682.5V236.5H2040Z" />
            </g>
        </svg>
    );
}

export function ChevronLeft() {
    return (
        <svg {...STROKE} strokeWidth="1.7" className="size-4 flex-none">
            <path d="M10 3.5 5.5 8l4.5 4.5" />
        </svg>
    );
}

export function ChevronRight() {
    return (
        <svg {...STROKE} strokeWidth="1.7" className="size-4 flex-none">
            <path d="M6 3.5 10.5 8 6 12.5" />
        </svg>
    );
}

/** Le panneau du récapitulatif, fermé : son bord seulement. */
export function PanelIcon() {
    return (
        <svg {...STROKE} strokeWidth="1.6" className="size-4 flex-none">
            <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
            <path d="M9.5 2.5v11" />
        </svg>
    );
}

/** Le panneau du récapitulatif, ouvert : sa partie droite pleine. */
export function PanelFilledIcon() {
    return (
        <svg {...STROKE} strokeWidth="1.6" className="size-4 flex-none">
            <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
            <path d="M9.5 2.5h2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-2z" fill="currentColor" />
        </svg>
    );
}

export function CloseIcon() {
    return (
        <svg {...STROKE} strokeWidth="1.7" className="size-4 flex-none">
            <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
    );
}

/** La coche : en --ok, sauf sur un bouton principal, où elle prend la couleur de son texte. */
export function CheckIcon({ onPrimary = false }: { onPrimary?: boolean }) {
    return (
        <svg {...STROKE} strokeWidth="1.8" className={`size-4 flex-none ${onPrimary ? '' : 'text-ok'}`}>
            <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
        </svg>
    );
}

/** Envoyer sur Jira : une flèche qui monte au-dessus d'un trait. */
export function SendIcon() {
    return (
        <svg {...STROKE} strokeWidth="1.6" className="size-4 flex-none">
            <path d="M8 10.5V3M5 6l3-3 3 3M3 12.5h10" />
        </svg>
    );
}

/** Réessayer l'envoi : une flèche qui tourne sur elle-même. */
export function RetryIcon() {
    return (
        <svg {...STROKE} strokeWidth="1.6" className="size-4 flex-none">
            <path d="M13 8a5 5 0 1 1-1.6-3.7M13.2 2.6v3h-3" />
        </svg>
    );
}

/**
 * La tasse de la pause. En petit, à la taille du texte de la pastille « Pause », son
 * trait est celui de la flèche de « Nouvelle version », qui a la même taille.
 */
export function CupIcon({ small = false }: { small?: boolean }) {
    return (
        <svg {...STROKE} strokeWidth={small ? '1.6' : '1.5'} className={`${small ? 'size-3' : 'size-4'} flex-none`}>
            <path d="M3 6h8v3.5A3.5 3.5 0 0 1 7.5 13h-1A3.5 3.5 0 0 1 3 9.5z" />
            <path d="M11 7h1a2 2 0 0 1 0 4h-1.2M5.5 2.5v1.5M8.5 2.5v1.5" />
        </svg>
    );
}

/**
 * La flèche circulaire d'un bloc qui revient, avant sa durée, ou après celle d'une pause.
 * Elle porte son libellé, que le lecteur d'écran lit : « Revient chaque mardi ».
 */
export function RepeatIcon({ label }: { label: string }) {
    return (
        <svg
            {...STROKE}
            strokeWidth="1.6"
            role="img"
            aria-label={label}
            aria-hidden={undefined}
            className="size-3 flex-none"
        >
            <path d="M13 6.5A5 5 0 0 0 4 4.6L2.5 6M2.5 3v3h3M3 9.5A5 5 0 0 0 12 11.4l1.5-1.4M13.5 13v-3h-3" />
        </svg>
    );
}

/**
 * L'icône d'erreur : un disque --inc et son point d'exclamation. En avertissement, le
 * disque passe en --warn.
 */
export function ErrorIcon({ tone = 'error' }: { tone?: 'error' | 'warning' }) {
    return (
        <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 flex-none">
            <circle cx="8" cy="8" r="7.5" className={tone === 'warning' ? 'fill-warn' : 'fill-inc'} />
            <path d="M8 4.4v4.4" fill="none" strokeWidth="1.8" strokeLinecap="round" className="stroke-bg" />
            <circle cx="8" cy="11.5" r="1.1" className="fill-bg" />
        </svg>
    );
}

/** La marque d'un envoi non vérifié : un disque --warn et son point d'interrogation. Rien n'est faux, DayTrack ne sait pas. */
export function UnverifiedIcon() {
    return (
        <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 flex-none">
            <circle cx="8" cy="8" r="7.5" className="fill-warn" />
            <path
                d="M6.1 6.3a1.95 1.95 0 1 1 2.8 1.75c-.55.27-.9.7-.9 1.3v.25"
                fill="none"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="stroke-bg"
            />
            <circle cx="8" cy="11.7" r="1.05" className="fill-bg" />
        </svg>
    );
}

/** Le crayon du bouton de l'objectif : 12 px, plus petit que les icônes des boutons. */
export function PencilIcon() {
    return (
        <svg
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="size-3 flex-none self-center"
        >
            <path d="M8.2 1.8l2 2L4 10H2V8z" />
        </svg>
    );
}

/** Le crayon du menu de la grille, « Modifier la sélection… » : à la taille des autres icônes du menu. */
export function EditIcon() {
    return (
        <svg {...STROKE} strokeWidth="1.5" className="size-4 flex-none">
            <path d="M11 2.5 13.5 5 6 12.5H3.5V10z" />
            <path d="M9.5 4 12 6.5" />
        </svg>
    );
}

export function MinusIcon() {
    return (
        <svg {...STROKE} strokeWidth="1.7" className="size-4 flex-none">
            <path d="M3.5 8h9" />
        </svg>
    );
}

export function PlusIcon() {
    return (
        <svg {...STROKE} strokeWidth="1.7" className="size-4 flex-none">
            <path d="M8 3.5v9M3.5 8h9" />
        </svg>
    );
}

/** La flèche vers le bas du bouton « Nouvelle version » : 12 px, à la taille de son texte. */
export function DownloadIcon() {
    return (
        <svg {...STROKE} strokeWidth="1.6" className="size-3 flex-none">
            <path d="M8 2.5v7.5M5 7l3 3 3-3M3 13h10" />
        </svg>
    );
}

export function CopyIcon() {
    return (
        <svg {...STROKE} strokeWidth="1.6" className="size-4 flex-none">
            <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
            <path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />
        </svg>
    );
}

export function CutIcon() {
    return (
        <svg {...STROKE} strokeWidth="1.6" className="size-4 flex-none">
            <circle cx="4.5" cy="11.5" r="2" />
            <circle cx="11.5" cy="11.5" r="2" />
            <path d="M6 10 12.5 2.5M10 10 3.5 2.5" />
        </svg>
    );
}

export function PasteIcon() {
    return (
        <svg {...STROKE} strokeWidth="1.6" className="size-4 flex-none">
            <rect x="3.5" y="3" width="9" height="11" rx="1.5" />
            <path d="M6 3V2h4v1M6 7.5h4M6 10h2.5" />
        </svg>
    );
}

export function TrashIcon() {
    return (
        <svg {...STROKE} strokeWidth="1.5" className="size-4 flex-none">
            <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
        </svg>
    );
}

/** Monter un favori dans la liste. */
export function ArrowUpIcon() {
    return (
        <svg {...STROKE} strokeWidth="1.6" className="size-4 flex-none">
            <path d="M8 13V3M4 7l4-4 4 4" />
        </svg>
    );
}

/** Descendre un favori dans la liste. */
export function ArrowDownIcon() {
    return (
        <svg {...STROKE} strokeWidth="1.6" className="size-4 flex-none">
            <path d="M8 3v10M4 9l4 4 4-4" />
        </svg>
    );
}

/** La poignée à six points d'un favori : on peut le glisser. Elle prend la hauteur d'une icône. */
export function GripIcon() {
    return (
        <svg viewBox="0 0 10 16" fill="currentColor" aria-hidden="true" className="h-4 w-auto flex-none">
            {[4, 8, 12].map((y) => (
                <g key={y}>
                    <circle cx="3" cy={y} r="1.2" />
                    <circle cx="7" cy={y} r="1.2" />
                </g>
            ))}
        </svg>
    );
}

/** Ajouter aux favoris : une étoile, dans le menu de la grille. */
export function StarIcon() {
    return (
        <svg {...STROKE} strokeWidth="1.5" className="size-4 flex-none">
            <path d="M8 2.5l1.7 3.5 3.8.5-2.8 2.6.7 3.8L8 11.1l-3.4 1.8.7-3.8-2.8-2.6 3.8-.5z" />
        </svg>
    );
}

/** L'engrenage des réglages, au pied de la colonne de gauche. */
export function GearIcon() {
    return (
        <svg {...STROKE} viewBox="0 0 24 24" strokeWidth="2.2" className="size-4 flex-none">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    );
}

/** La flèche de « Retour à la journée ». */
export function BackIcon() {
    return (
        <svg {...STROKE} strokeWidth="1.7" className="size-4 flex-none">
            <path d="M9.5 3.5 5 8l4.5 4.5" />
        </svg>
    );
}

/** Le chevron d'une aide qui se déplie : vers la droite fermée, vers le bas ouverte (jira.css). */
export function DisclosureIcon() {
    return (
        <svg
            {...STROKE}
            strokeWidth="1.7"
            className="disclosure size-4 flex-none text-ink-3 transition-transform duration-(--dur-fast) ease-(--ease)"
        >
            <path d="M6.5 4.5 10 8l-3.5 3.5" />
        </svg>
    );
}

/** Le chevron d'un bouton qui ouvre un choix sous lui : la teinte d'un type. */
export function ChevronDownIcon() {
    return (
        <svg {...STROKE} strokeWidth="1.7" className="size-4 flex-none">
            <path d="M4.5 6.5 8 10l3.5-3.5" />
        </svg>
    );
}

/** Un lien qui s'ouvre dans un nouvel onglet : 13 px, sur la ligne du texte (jira.css). */
export function ExternalIcon() {
    return (
        <svg {...STROKE} strokeWidth="1.6" className="external-icon size-3">
            <path d="M6.5 3.5h-3v9h9v-3M9.5 2.5h4v4M13.5 2.5 7.5 8.5" />
        </svg>
    );
}
