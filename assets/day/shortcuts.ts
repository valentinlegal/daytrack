import { matchesKeyShortcuts } from '../components/keyShortcuts';

/**
 * Les raccourcis de la grille et des favoris, en un seul endroit : la touche, le geste
 * qu'elle fait, comment l'écran l'écrit et comment le lecteur d'écran l'annonce. Les menus
 * les lisent ici, et les touches s'y décodent : la même touche fait la même chose des deux
 * côtés, menu ouvert ou fermé.
 *
 * Une touche de modification compte : F2 avec Ctrl n'est pas F2, Ctrl+Suppr n'est pas
 * Suppr. Control et ⌘ se valent partout : `Ctrl+C` sous Windows et Linux, `⌘C` sur Mac,
 * et les deux touches font le geste partout.
 */
export type Shortcut =
    /** Modifier la sélection…, Renommer… */
    | 'edit'
    | 'copy'
    | 'cut'
    | 'paste'
    /** Effacer, Retirer des favoris : Suppr sous Windows et Linux, ⌫ sur Mac, qui n'a pas de Suppr. */
    | 'delete'
    | 'moveUp'
    | 'moveDown'
    /** Le menu du clic droit, au clavier : la touche Menu, ou Maj+F10. */
    | 'menu'
    | 'undo'
    | 'redo';

interface Keys {
    /** Les touches, comme aria-keyshortcuts les écrit ; plusieurs, séparées d'une espace, font le même geste. */
    readonly keys: (mac: boolean) => string;
    /** Le raccourci tel que l'écran l'écrit ; null quand il ne s'écrit nulle part. */
    readonly label: (mac: boolean) => string | null;
}

/** « Ctrl+C » sous Windows et Linux, « ⌘C » sur Mac ; « Control+C » et « Meta+C » pour le lecteur d'écran. */
function command(letter: string): Keys {
    return {
        keys: (mac) => `${mac ? 'Meta' : 'Control'}+${letter}`,
        label: (mac) => (mac ? `⌘${letter}` : `Ctrl+${letter}`),
    };
}

/** « Alt+↑ » sous Windows et Linux, « ⌥↑ » sur Mac. */
function alt(arrow: 'ArrowUp' | 'ArrowDown', drawn: '↑' | '↓'): Keys {
    return { keys: () => `Alt+${arrow}`, label: (mac) => `${mac ? '⌥' : 'Alt+'}${drawn}` };
}

const SHORTCUTS: Readonly<Record<Shortcut, Keys>> = {
    edit: { keys: () => 'F2', label: () => 'F2' },
    copy: command('C'),
    cut: command('X'),
    paste: command('V'),
    delete: { keys: () => 'Delete Backspace', label: (mac) => (mac ? '⌫' : 'Suppr') },
    moveUp: alt('ArrowUp', '↑'),
    moveDown: alt('ArrowDown', '↓'),
    menu: { keys: () => 'ContextMenu Shift+F10', label: () => null },
    undo: command('Z'),
    redo: {
        keys: (mac) => `${mac ? 'Meta' : 'Control'}+Y ${mac ? 'Meta' : 'Control'}+Shift+Z`,
        label: () => null,
    },
};

/** Les raccourcis de la sélection de la grille. */
export const GRID_SHORTCUTS = ['edit', 'copy', 'cut', 'paste', 'delete', 'menu'] as const satisfies readonly Shortcut[];

/** Les raccourcis d'un favori qui a le curseur : coller pose sur la sélection de la grille le favori copié. */
export const FAVORITE_SHORTCUTS = [
    'edit',
    'copy',
    'paste',
    'delete',
    'moveUp',
    'moveDown',
    'menu',
] as const satisfies readonly Shortcut[];

/** Annuler et rétablir valent dans toute la page, hors d'un champ. */
export const PAGE_SHORTCUTS = ['undo', 'redo'] as const satisfies readonly Shortcut[];

export function isMac(platform: string): boolean {
    return /mac|iphone|ipad/i.test(platform);
}

/**
 * Le geste d'une touche parmi ces raccourcis ; null si elle n'en fait aucun. Une touche
 * morte en cours de composition n'en fait jamais.
 */
export function shortcutOf<S extends Shortcut>(
    event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'isComposing'>,
    among: readonly S[],
): S | null {
    if (event.isComposing) {
        return null;
    }

    return among.find((shortcut) => matchesKeyShortcuts(event, SHORTCUTS[shortcut].keys(false))) ?? null;
}

/** Le raccourci tel que l'écran l'écrit : « Ctrl+C » ou « ⌘C », « Suppr » ou « ⌫ », « F2 ». */
export function shortcutLabel(shortcut: Shortcut, mac: boolean): string | null {
    return SHORTCUTS[shortcut].label(mac);
}

/** Le même raccourci pour aria-keyshortcuts : « Control+C » ou « Meta+C », « Delete Backspace ». */
export function shortcutKeys(shortcut: Shortcut, mac: boolean): string {
    return SHORTCUTS[shortcut].keys(mac);
}

/**
 * Ce qu'un choix de menu écrit en face de lui, et annonce au lecteur d'écran (MenuItem) :
 * menu ouvert, ce raccourci fait aussi ce choix.
 */
export function menuShortcut(shortcut: Shortcut, mac: boolean): { shortcut?: string; keyShortcuts: string } {
    const label = shortcutLabel(shortcut, mac);
    const keyShortcuts = shortcutKeys(shortcut, mac);

    return label === null ? { keyShortcuts } : { shortcut: label, keyShortcuts };
}
