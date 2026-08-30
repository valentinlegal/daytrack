import { useState } from 'react';
import {
    ContextMenu,
    ContextMenuTrigger,
} from '@/components/ui/context-menu';

interface TimeBlockProps {
    slot: string;
    isSelected: boolean;
    /** Contenu du menu contextuel (`<ContextMenuContent>…</ContextMenuContent>`) fourni par le consommateur. */
    menu: React.ReactNode;
    onSelect: (e: React.MouseEvent) => void;
    onStartEdit: (x: number, y: number) => void;
    onContextMenuOpen: () => void;
    onCellMouseDown: (e: React.MouseEvent) => void;
    onDragExtend: () => void;
    onDropFavorite: () => void;
}

/**
 * Cellule d'interaction transparente d'un créneau (grille jour + grille Modèles).
 * Toute la logique (sélection, drag, presse-papier, undo…) est dans useSlotGrid ;
 * ce composant ne fait que capter les événements souris et déclencher le menu.
 */
export default function TimeBlock({
    slot,
    isSelected,
    menu,
    onSelect,
    onStartEdit,
    onContextMenuOpen,
    onCellMouseDown,
    onDragExtend,
    onDropFavorite,
}: TimeBlockProps) {
    const [isDragOver, setIsDragOver] = useState(false);

    return (
        <ContextMenu onOpenChange={(open) => { if (open) onContextMenuOpen(); }}>
            <ContextMenuTrigger asChild>
                <div
                    data-slot={slot}
                    className="w-full h-full cursor-pointer select-none relative rounded-sm"
                    style={{
                        background: isDragOver ? 'rgba(99,102,241,0.08)' : undefined,
                        boxShadow: isDragOver ? 'inset 0 0 0 2px #818cf8' : undefined,
                    }}
                    onClick={(e) => { e.stopPropagation(); onSelect(e); }}
                    onDoubleClick={(e) => { e.preventDefault(); onStartEdit(e.clientX, e.clientY); }}
                    onMouseDown={(e) => onCellMouseDown(e)}
                    onMouseEnter={() => onDragExtend()}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setIsDragOver(true); }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={(e) => {
                        e.preventDefault();
                        setIsDragOver(false);
                        if (e.dataTransfer.getData('application/daytrack-favorite')) onDropFavorite();
                    }}
                />
            </ContextMenuTrigger>
            {menu}
        </ContextMenu>
    );
}
