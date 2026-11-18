<?php

namespace App\Day;

/**
 * Des quarts d'heure voisins au même contenu, posés par la même récurrence ou par aucune,
 * tels que la grille les affiche.
 */
final readonly class Block
{
    public function __construct(
        public int $start,
        public int $end,
        public SlotContent $content,
        /** L'identifiant de la récurrence qui l'a posé ; null pour une saisie ordinaire. */
        public ?string $recurrence = null,
    ) {
    }

    public function minutes(): int
    {
        return $this->end - $this->start;
    }
}
