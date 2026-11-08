import { describe, expect, it } from 'vitest';

import { matchesKeyShortcuts } from '../../../assets/components/keyShortcuts';
import {
    FAVORITE_SHORTCUTS,
    GRID_SHORTCUTS,
    menuShortcut,
    PAGE_SHORTCUTS,
    type Shortcut,
    shortcutKeys,
    shortcutLabel,
    shortcutOf,
} from '../../../assets/day/shortcuts';

type Modifier = 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey';

const key = (name: string, modifiers: Partial<Record<Modifier | 'isComposing', boolean>> = {}) => ({
    key: name,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    isComposing: false,
    ...modifiers,
});

/** Les touches d'un raccourci écrit comme aria-keyshortcuts, en événements. */
function eventsOf(keys: string) {
    return keys.split(' ').map((written) => {
        const parts = written.split('+');
        const name = parts.pop() ?? '';

        return key(name, {
            ctrlKey: parts.includes('Control'),
            metaKey: parts.includes('Meta'),
            altKey: parts.includes('Alt'),
            shiftKey: parts.includes('Shift'),
        });
    });
}

const ALL: readonly Shortcut[] = [...new Set([...GRID_SHORTCUTS, ...FAVORITE_SHORTCUTS, ...PAGE_SHORTCUTS])];

describe('la table des raccourcis', () => {
    it('décode chaque raccourci depuis les touches qu’elle annonce, sous Windows comme sur Mac', () => {
        for (const shortcut of ALL) {
            for (const mac of [false, true]) {
                for (const event of eventsOf(shortcutKeys(shortcut, mac))) {
                    expect(shortcutOf(event, ALL), `${shortcut} ${event.key}`).toBe(shortcut);
                }
            }
        }
    });

    it('fait faire le même geste à la même touche dans la grille et dans les favoris', () => {
        expect(shortcutOf(key('F2'), GRID_SHORTCUTS)).toBe('edit');
        expect(shortcutOf(key('F2'), FAVORITE_SHORTCUTS)).toBe('edit');
        for (const name of ['Delete', 'Backspace']) {
            expect(shortcutOf(key(name), GRID_SHORTCUTS)).toBe('delete');
            expect(shortcutOf(key(name), FAVORITE_SHORTCUTS)).toBe('delete');
        }
        for (const [letter, shortcut] of [
            ['c', 'copy'],
            ['v', 'paste'],
        ] as const) {
            expect(shortcutOf(key(letter, { ctrlKey: true }), GRID_SHORTCUTS)).toBe(shortcut);
            expect(shortcutOf(key(letter, { metaKey: true }), FAVORITE_SHORTCUTS)).toBe(shortcut);
        }
        expect(shortcutOf(key('ContextMenu'), GRID_SHORTCUTS)).toBe('menu');
        expect(shortcutOf(key('F10', { shiftKey: true }), FAVORITE_SHORTCUTS)).toBe('menu');
    });

    it('compte les touches de modification : F2 et Suppr avec l’une d’elles ne font rien, des deux côtés', () => {
        for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const) {
            for (const among of [GRID_SHORTCUTS, FAVORITE_SHORTCUTS]) {
                expect(shortcutOf(key('F2', { [modifier]: true }), among), `F2 ${modifier}`).toBeNull();
                expect(shortcutOf(key('Delete', { [modifier]: true }), among), `Suppr ${modifier}`).toBeNull();
                expect(shortcutOf(key('Backspace', { [modifier]: true }), among), `⌫ ${modifier}`).toBeNull();
            }
        }
        expect(shortcutOf(key('c', { ctrlKey: true, shiftKey: true }), GRID_SHORTCUTS)).toBeNull();
        expect(shortcutOf(key('v', { ctrlKey: true, altKey: true }), FAVORITE_SHORTCUTS)).toBeNull();
        expect(shortcutOf(key('ArrowUp', { altKey: true, shiftKey: true }), FAVORITE_SHORTCUTS)).toBeNull();
        expect(shortcutOf(key('z', { ctrlKey: true, altKey: true }), PAGE_SHORTCUTS)).toBeNull();
    });

    it('fait valoir Ctrl comme ⌘, et lit une lettre en majuscule comme en minuscule', () => {
        expect(shortcutOf(key('X', { metaKey: true }), GRID_SHORTCUTS)).toBe('cut');
        expect(shortcutOf(key('z', { ctrlKey: true }), PAGE_SHORTCUTS)).toBe('undo');
        expect(shortcutOf(key('Z', { metaKey: true, shiftKey: true }), PAGE_SHORTCUTS)).toBe('redo');
        expect(shortcutOf(key('y', { ctrlKey: true }), PAGE_SHORTCUTS)).toBe('redo');
    });

    it('ne prend que les raccourcis demandés, et rien pendant une composition', () => {
        expect(shortcutOf(key('ArrowUp', { altKey: true }), GRID_SHORTCUTS)).toBeNull();
        expect(shortcutOf(key('x', { ctrlKey: true }), FAVORITE_SHORTCUTS)).toBeNull();
        expect(shortcutOf(key('z', { ctrlKey: true }), GRID_SHORTCUTS)).toBeNull();
        expect(shortcutOf(key('F2', { isComposing: true }), GRID_SHORTCUTS)).toBeNull();
        expect(shortcutOf(key('s'), GRID_SHORTCUTS)).toBeNull();
    });

    it('écrit chaque raccourci comme le système, et le menu ouvert répond à ce qu’il annonce', () => {
        expect(ALL.map((shortcut) => shortcutLabel(shortcut, false))).toEqual(
            ALL.map(
                (shortcut) =>
                    ({
                        edit: 'F2',
                        copy: 'Ctrl+C',
                        cut: 'Ctrl+X',
                        paste: 'Ctrl+V',
                        delete: 'Suppr',
                        moveUp: 'Alt+↑',
                        moveDown: 'Alt+↓',
                        menu: null,
                        undo: 'Ctrl+Z',
                        redo: null,
                    })[shortcut],
            ),
        );
        expect(
            ['copy', 'delete', 'moveUp', 'undo'].map((shortcut) => shortcutLabel(shortcut as Shortcut, true)),
        ).toEqual(['⌘C', '⌫', '⌥↑', '⌘Z']);
        expect(menuShortcut('copy', true)).toEqual({ shortcut: '⌘C', keyShortcuts: 'Meta+C' });
        expect(menuShortcut('delete', false)).toEqual({ shortcut: 'Suppr', keyShortcuts: 'Delete Backspace' });
        expect(menuShortcut('menu', false)).toEqual({ keyShortcuts: 'ContextMenu Shift+F10' });
        // Le menu ouvert choisit par aria-keyshortcuts (Menu.tsx) : la même lecture que le décodage.
        for (const shortcut of ALL) {
            for (const mac of [false, true]) {
                const { keyShortcuts } = menuShortcut(shortcut, mac);
                for (const event of eventsOf(keyShortcuts).flatMap((own) => [
                    own,
                    { ...own, altKey: !own.altKey },
                    { ...own, shiftKey: !own.shiftKey },
                    { ...own, ctrlKey: !own.ctrlKey && !own.metaKey },
                ])) {
                    expect(matchesKeyShortcuts(event, keyShortcuts), `${shortcut} ${JSON.stringify(event)}`).toBe(
                        shortcutOf(event, [shortcut]) !== null,
                    );
                }
            }
        }
    });
});
