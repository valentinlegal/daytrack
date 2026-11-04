/**
 * Les raccourcis tels que l'écran les écrit : `Ctrl+C` sous Windows et Linux, `⌘C` sur
 * Mac. Le geste, lui, répond aux deux touches partout.
 */
export type ShortcutKey = 'C' | 'X' | 'V' | 'Z';

export function isMac(platform: string): boolean {
    return /mac|iphone|ipad/i.test(platform);
}

export function shortcutLabel(key: ShortcutKey, mac: boolean): string {
    return mac ? `⌘${key}` : `Ctrl+${key}`;
}

/** Le même raccourci pour aria-keyshortcuts : « Control+Z », « Meta+Z ». */
export function shortcutAria(key: ShortcutKey, mac: boolean): string {
    return `${mac ? 'Meta' : 'Control'}+${key}`;
}

/**
 * Effacer, retirer : « Suppr » sous Windows et Linux, « ⌫ » sur Mac, dont le clavier n'a
 * pas de touche Suppr. Les deux touches font le geste partout.
 */
export function deleteLabel(mac: boolean): string {
    return mac ? '⌫' : 'Suppr';
}

/** Le même raccourci pour aria-keyshortcuts : les deux touches. */
export const DELETE_KEYS = 'Delete Backspace';

/** Monter ou descendre un favori : « Alt+↑ » sous Windows et Linux, « ⌥↑ » sur Mac. */
export function altLabel(arrow: '↑' | '↓', mac: boolean): string {
    return `${mac ? '⌥' : 'Alt+'}${arrow}`;
}
