import { ContextMenu } from 'radix-ui';
import type { KeyboardEvent, ReactNode } from 'react';

import { matchesKeyShortcuts } from './keyShortcuts';
import { tokenPixels } from './tokenPixels';

/**
 * Le menu du clic droit : ancré au pointeur, une ligne de 32 px par choix — icône,
 * libellé, raccourci. Radix porte le clavier : il s'ouvre sur le premier choix, les
 * flèches parcourent, Entrée valide, Échap ferme. Le raccourci écrit en face d'un choix
 * le fait aussi, menu ouvert, et le menu se ferme, comme dans les menus du Mac.
 */
export const MenuRoot = ContextMenu.Root;
export const MenuTrigger = ContextMenu.Trigger;

export function MenuContent({
    label,
    header,
    container,
    onCloseAutoFocus,
    children,
}: {
    /** Le nom du menu pour le lecteur d'écran. */
    label: string;
    /**
     * Où le menu se pose dans la page : dans la zone de l'écran qui l'ouvre, pour qu'un
     * lecteur d'écran le trouve dans un repère. Le corps de la page sinon.
     */
    container?: HTMLElement | null;
    /** Ce qu'il y a en tête, en petit : la taille de la sélection. */
    header?: string;
    onCloseAutoFocus?: (event: Event) => void;
    children: ReactNode;
}) {
    return (
        <ContextMenu.Portal container={container}>
            <ContextMenu.Content
                aria-label={label}
                collisionPadding={tokenPixels('--s-2')}
                loop
                onCloseAutoFocus={onCloseAutoFocus}
                onKeyDown={chooseByShortcut}
                className="z-(--z-pop) w-menu rounded-2 border border-line bg-bg-raise p-1 text-ink shadow-pop"
            >
                {header !== undefined && (
                    <ContextMenu.Label className="px-3 py-2 text-xs text-ink-3">{header}</ContextMenu.Label>
                )}
                {children}
            </ContextMenu.Content>
        </ContextMenu.Portal>
    );
}

export function MenuItem({
    icon,
    shortcut,
    keyShortcuts,
    danger = false,
    disabled = false,
    onSelect,
    children,
}: {
    icon: ReactNode;
    /** Le raccourci du même geste, écrit à droite, à la manière du système : « Ctrl+C » ou « ⌘C », « Suppr » ou « ⌫ ». */
    shortcut?: string;
    /**
     * Le même raccourci pour le lecteur d'écran (aria-keyshortcuts) : « Control+C »,
     * « Delete Backspace ». Menu ouvert, il fait aussi ce choix.
     */
    keyShortcuts?: string;
    /** Effacer : le libellé et l'icône en --inc. */
    danger?: boolean;
    disabled?: boolean;
    onSelect: () => void;
    children: string;
}) {
    return (
        <ContextMenu.Item
            disabled={disabled}
            onSelect={onSelect}
            aria-keyshortcuts={keyShortcuts}
            className={`flex h-ctl cursor-pointer items-center gap-3 rounded-1 px-3 select-none focus-visible:-outline-offset-(--ring) data-disabled:cursor-default data-disabled:opacity-(--o-disabled) data-highlighted:bg-bg-hover ${
                danger ? 'text-inc' : 'text-ink [&>svg]:text-ink-2'
            }`}
        >
            {icon}
            {children}
            {shortcut !== undefined && (
                <kbd className="ml-auto font-mono text-xs text-ink-3" aria-hidden="true">
                    {shortcut}
                </kbd>
            )}
        </ContextMenu.Item>
    );
}

export function MenuSeparator() {
    return <ContextMenu.Separator className="mx-2 my-1 h-px bg-line" />;
}

/** Le choix dont le raccourci vient d'être tapé, menu ouvert : on le clique, ce qui le fait et ferme le menu. */
function chooseByShortcut(event: KeyboardEvent<HTMLDivElement>) {
    const items = event.currentTarget.querySelectorAll<HTMLElement>(
        '[role="menuitem"][aria-keyshortcuts]:not([data-disabled])',
    );
    const item = [...items].find((candidate) =>
        matchesKeyShortcuts(event, candidate.getAttribute('aria-keyshortcuts') ?? ''),
    );
    if (item !== undefined) {
        event.preventDefault();
        item.click();
    }
}
