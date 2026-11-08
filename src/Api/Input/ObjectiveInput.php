<?php

namespace App\Api\Input;

use Symfony\Component\Validator\Constraints as Assert;

/**
 * L'objectif d'un jour précis, en minutes.
 */
final readonly class ObjectiveInput
{
    public function __construct(
        #[Assert\PositiveOrZero(message: 'Version invalide.')]
        public int $version,
        #[ObjectiveMinutes]
        public int $objective,
    ) {
    }
}
