<?php

namespace App\Day;

use App\Entity\Day;
use App\Recurrence\UntilChange;

/**
 * Une récurrence enregistrée depuis la fenêtre : la journée écrite — null quand elle reste
 * sans ligne, rien n'y étant saisi —, et les fins qu'annuler rendra.
 */
final readonly class RecurrenceSave
{
    /**
     * @param list<UntilChange> $untils
     */
    public function __construct(
        public ?Day $day,
        public array $untils,
    ) {
    }
}
