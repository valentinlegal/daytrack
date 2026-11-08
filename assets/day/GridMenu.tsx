import { useRef } from 'react';

import { CopyIcon, CupIcon, CutIcon, EditIcon, PasteIcon, PlusIcon, StarIcon, TrashIcon } from '../components/icons';
import { MenuContent, MenuItem, MenuSeparator } from '../components/Menu';
import type { SelectionActions } from '../grid/actions';
import type { Selection } from '../grid/selection';
import { selectionSummary } from './messages';
import { menuShortcut } from './shortcuts';

/**
 * Le menu de la sélection : sa taille en tête, puis Nouveau ticket…, Modifier la
 * sélection…, Copier, Couper, Coller, Convertir en pause, Ajouter aux favoris et
 * Effacer. Ce qui ne servirait à rien est grisé. Chaque choix a son raccourci, et chaque
 * raccourci son choix : celui de Nouveau ticket… est une lettre tapée sur la sélection,
 * qui s'écrit dans son champ ; Ajouter aux favoris est aussi le bloc glissé sur la liste.
 */
export function GridMenu({
    selection,
    actions,
    mac,
    onNewTicket,
    onEditSelection,
    onCopy,
    onCut,
    onPaste,
    onPause,
    onFavorite,
    onClear,
    container,
    returnFocus,
}: {
    selection: Selection;
    actions: SelectionActions;
    mac: boolean;
    onNewTicket: () => void;
    onEditSelection: () => void;
    onCopy: () => void;
    onCut: () => void;
    onPaste: () => void;
    onPause: () => void;
    /** Ajouter aux favoris le ticket que porte la sélection. */
    onFavorite: (ticket: string) => void;
    onClear: () => void;
    /** La zone principale de l'écran, où le menu se pose. */
    container: HTMLElement | null;
    returnFocus: () => void;
}) {
    // La fenêtre ouverte par « Nouveau ticket… » ou « Modifier la sélection… » a pris le
    // curseur : le menu, qui le rend après s'être fermé, le lui volerait, et elle
    // s'enregistrerait aussitôt.
    const windowOpenedRef = useRef(false);

    return (
        <MenuContent
            label="Actions sur la sélection"
            header={selectionSummary(selection)}
            container={container}
            onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (windowOpenedRef.current) {
                    windowOpenedRef.current = false;
                } else {
                    returnFocus();
                }
            }}
        >
            <MenuItem
                icon={<PlusIcon />}
                disabled={!actions.entry}
                onSelect={() => {
                    windowOpenedRef.current = true;
                    onNewTicket();
                }}
            >
                Nouveau ticket…
            </MenuItem>
            <MenuItem
                icon={<EditIcon />}
                {...menuShortcut('edit', mac)}
                disabled={!actions.edit}
                onSelect={() => {
                    windowOpenedRef.current = true;
                    onEditSelection();
                }}
            >
                Modifier la sélection…
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<CopyIcon />} {...menuShortcut('copy', mac)} disabled={!actions.copy} onSelect={onCopy}>
                Copier
            </MenuItem>
            <MenuItem icon={<CutIcon />} {...menuShortcut('cut', mac)} disabled={!actions.cut} onSelect={onCut}>
                Couper
            </MenuItem>
            <MenuItem icon={<PasteIcon />} {...menuShortcut('paste', mac)} disabled={!actions.paste} onSelect={onPaste}>
                Coller
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<CupIcon />} disabled={!actions.pause} onSelect={onPause}>
                Convertir en pause
            </MenuItem>
            <MenuItem
                icon={<StarIcon />}
                disabled={actions.favorite === null}
                onSelect={() => {
                    if (actions.favorite !== null) {
                        onFavorite(actions.favorite);
                    }
                }}
            >
                Ajouter aux favoris
            </MenuItem>
            <MenuSeparator />
            <MenuItem
                icon={<TrashIcon />}
                {...menuShortcut('delete', mac)}
                danger
                disabled={!actions.clear}
                onSelect={onClear}
            >
                Effacer
            </MenuItem>
        </MenuContent>
    );
}
