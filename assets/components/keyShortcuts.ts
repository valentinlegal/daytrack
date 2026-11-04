/**
 * Une touche répond-elle à l'un de ces raccourcis, écrits comme aria-keyshortcuts les
 * écrit : « Control+C », « Alt+ArrowUp », « Delete Backspace » pour deux touches qui
 * font la même chose ? Control et Meta se valent, comme dans la grille, qui répond aux
 * deux partout ; les autres touches de modification doivent être celles du raccourci.
 */
export function matchesKeyShortcuts(
    event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
    shortcuts: string,
): boolean {
    return shortcuts
        .split(' ')
        .filter((shortcut) => shortcut !== '')
        .some((shortcut) => {
            const parts = shortcut.split('+');
            const key = parts.pop() ?? '';
            const command = parts.includes('Control') || parts.includes('Meta');

            return (
                event.key.toLowerCase() === key.toLowerCase() &&
                (event.ctrlKey || event.metaKey) === command &&
                event.altKey === parts.includes('Alt') &&
                event.shiftKey === parts.includes('Shift')
            );
        });
}
