<?php

namespace App\Api\Input;

use App\Day\Objective;
use App\Day\Quarter;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * L'objectif d'un jour précis, en minutes.
 */
final readonly class ObjectiveInput
{
    public function __construct(
        #[Assert\PositiveOrZero(message: 'Version invalide.')]
        public int $version,
        #[Assert\Range(min: Objective::MIN, max: Objective::MAX, notInRangeMessage: 'L\'objectif va de 0h00 à 13h00.')]
        #[Assert\DivisibleBy(value: Quarter::MINUTES, message: 'L\'objectif se règle au quart d\'heure.')]
        public int $objective,
    ) {
    }
}
