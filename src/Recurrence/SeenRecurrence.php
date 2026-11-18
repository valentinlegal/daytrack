<?php

namespace App\Recurrence;

use App\Entity\Recurrence;
use Symfony\Component\Uid\Uuid;

/**
 * La récurrence que portait le bloc d'une fenêtre, telle que la fenêtre l'a vue : ses jours
 * et sa fin. Changée depuis — dans un autre onglet, depuis un autre jour, sans que la journée
 * du bloc change de version —, elle ne se remplace pas : la fenêtre écraserait ce qu'elle
 * n'a pas vu.
 */
final readonly class SeenRecurrence
{
    /**
     * @param list<int> $weekdays en jours de la semaine ISO
     */
    public function __construct(
        public Uuid $id,
        public array $weekdays,
        public ?\DateTimeImmutable $until,
    ) {
    }

    /** Elle est encore telle que la fenêtre l'a vue. */
    public function matches(Recurrence $recurrence): bool
    {
        $weekdays = array_values(array_unique($this->weekdays));
        sort($weekdays);

        return $weekdays === $recurrence->rhythm()->weekdays
            && $this->until?->format('Y-m-d') === $recurrence->until?->format('Y-m-d');
    }
}
