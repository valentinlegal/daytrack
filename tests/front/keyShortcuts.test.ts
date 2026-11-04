import { describe, expect, it } from 'vitest';

import { matchesKeyShortcuts } from '../../assets/components/keyShortcuts';

const key = (
    name: string,
    modifiers: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey', boolean>> = {},
) => ({
    key: name,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...modifiers,
});

describe('la touche d’un raccourci écrit dans un menu', () => {
    it('répond à l’une de ses touches', () => {
        expect(matchesKeyShortcuts(key('Delete'), 'Delete Backspace')).toBe(true);
        expect(matchesKeyShortcuts(key('Backspace'), 'Delete Backspace')).toBe(true);
        expect(matchesKeyShortcuts(key('F2'), 'F2')).toBe(true);
        expect(matchesKeyShortcuts(key('ArrowUp', { altKey: true }), 'Alt+ArrowUp')).toBe(true);
    });

    it('prend Ctrl et ⌘ l’un pour l’autre, comme la grille, et une lettre en majuscule ou non', () => {
        expect(matchesKeyShortcuts(key('c', { ctrlKey: true }), 'Meta+C')).toBe(true);
        expect(matchesKeyShortcuts(key('C', { metaKey: true }), 'Control+C')).toBe(true);
    });

    it('refuse une autre touche, ou d’autres touches de modification', () => {
        expect(matchesKeyShortcuts(key('c'), 'Control+C')).toBe(false);
        expect(matchesKeyShortcuts(key('Delete', { shiftKey: true }), 'Delete Backspace')).toBe(false);
        expect(matchesKeyShortcuts(key('ArrowUp'), 'Alt+ArrowUp')).toBe(false);
        expect(matchesKeyShortcuts(key('ArrowDown', { altKey: true }), 'Alt+ArrowUp')).toBe(false);
        expect(matchesKeyShortcuts(key('Delete', { ctrlKey: true }), 'Delete')).toBe(false);
        expect(matchesKeyShortcuts(key('Delete'), '')).toBe(false);
    });
});
