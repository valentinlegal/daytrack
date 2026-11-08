<?php

namespace App\Api\Input;

/**
 * L'objectif habituel, en minutes : mêmes bornes que celui d'un jour précis.
 */
final readonly class HabitualObjectiveInput
{
    public function __construct(
        #[ObjectiveMinutes]
        public int $objective,
    ) {
    }
}
