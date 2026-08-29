import { cn } from '@/lib/utils';
import { SLOT_PX } from '@/utils/timeline';

interface TemplateCellProps {
    slotIndex: number;
    isInDragRange: boolean;
    onDragStart: (slotIndex: number) => void;
    onDragEnter: (slotIndex: number) => void;
}

/**
 * Cellule d'interaction transparente d'un créneau de la grille Modèles.
 * Posée au-dessus du layer de blocs (pointer-events actifs) : gère le clic-glisser
 * de sélection d'une plage contiguë. Pas de multi-sélection ni de copier/coller
 * (hors scope V1 de la vue Modèles).
 */
export default function TemplateCell({ slotIndex, isInDragRange, onDragStart, onDragEnter }: TemplateCellProps) {
    return (
        <div
            className={cn(
                'absolute left-0 right-0 cursor-pointer',
                isInDragRange ? 'bg-amber-400/25' : 'hover:bg-amber-400/10',
            )}
            style={{ top: slotIndex * SLOT_PX, height: SLOT_PX }}
            onMouseDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                onDragStart(slotIndex);
            }}
            onMouseEnter={() => onDragEnter(slotIndex)}
        />
    );
}
