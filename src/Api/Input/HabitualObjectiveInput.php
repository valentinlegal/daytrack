<?php

namespace App\Api\Input;

use App\Day\Objective;
use App\Day\Quarter;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * L'objectif habituel, en minutes : mêmes bornes que celui d'un jour précis.
 */
final readonly class HabitualObjectiveInput
{
    public function __construct(
        #[Assert\Range(min: Objective::MIN, max: Objective::MAX, notInRangeMessage: 'L\'objectif va de 0h00 à 13h00.')]
        #[Assert\DivisibleBy(value: Quarter::MINUTES, message: 'L\'objectif se règle au quart d\'heure.')]
        public int $objective,
    ) {
    }
}
