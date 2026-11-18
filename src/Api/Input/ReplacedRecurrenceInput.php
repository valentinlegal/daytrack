<?php

namespace App\Api\Input;

use App\Day\UserCalendar;
use App\Recurrence\SeenRecurrence;
use Symfony\Component\Uid\Uuid;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * La récurrence que portait le bloc d'une fenêtre, et ce que la fenêtre en a vu : ses jours
 * et sa fin.
 */
final readonly class ReplacedRecurrenceInput
{
    /**
     * @param list<int> $weekdays en jours de la semaine ISO, du lundi (1) au dimanche (7)
     */
    public function __construct(
        // Uuid laisse passer un texte vide.
        #[Assert\NotBlank(message: 'Récurrence inconnue.')]
        #[Assert\Uuid(message: 'Récurrence inconnue.')]
        public string $id,
        #[Assert\Count(max: 7, maxMessage: 'Un jour de la semaine va du lundi au dimanche.')]
        #[Assert\All([new Assert\Range(notInRangeMessage: 'Un jour de la semaine va du lundi au dimanche.', min: 1, max: 7)])]
        public array $weekdays,
        #[Assert\Date(message: 'Une date s\'écrit AAAA-MM-JJ.')]
        public ?string $until,
    ) {
    }

    /** Une fois la validation passée. */
    public function seen(): SeenRecurrence
    {
        return new SeenRecurrence(
            Uuid::fromString($this->id),
            $this->weekdays,
            null === $this->until ? null : UserCalendar::date($this->until),
        );
    }
}
