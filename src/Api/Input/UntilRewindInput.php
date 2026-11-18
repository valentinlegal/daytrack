<?php

namespace App\Api\Input;

use App\Day\UserCalendar;
use App\Recurrence\UntilRewind;
use Symfony\Component\Uid\Uuid;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * La fin qu'annuler ou rétablir rend à une récurrence, et celle qu'elle doit encore avoir.
 */
final readonly class UntilRewindInput
{
    public function __construct(
        // Uuid laisse passer un texte vide.
        #[Assert\NotBlank(message: 'Récurrence inconnue.')]
        #[Assert\Uuid(message: 'Récurrence inconnue.')]
        public string $recurrence,
        #[Assert\Date(message: 'Une date s\'écrit AAAA-MM-JJ.')]
        public ?string $from,
        #[Assert\Date(message: 'Une date s\'écrit AAAA-MM-JJ.')]
        public ?string $to,
    ) {
    }

    /** Une fois la validation passée. */
    public function rewind(): UntilRewind
    {
        return new UntilRewind(
            Uuid::fromString($this->recurrence),
            null === $this->from ? null : UserCalendar::date($this->from),
            null === $this->to ? null : UserCalendar::date($this->to),
        );
    }
}
