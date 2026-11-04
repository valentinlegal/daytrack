<?php

namespace App\Day;

/**
 * Des quarts d'heure voisins au même contenu, tels que la grille les affiche.
 */
final readonly class Block
{
    public function __construct(
        public int $start,
        public int $end,
        public SlotContent $content,
    ) {
    }

    public function minutes(): int
    {
        return $this->end - $this->start;
    }
}
