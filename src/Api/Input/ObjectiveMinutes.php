<?php

namespace App\Api\Input;

use App\Day\Objective;
use App\Day\Quarter;
use Symfony\Component\Validator\Constraints as Assert;
use Symfony\Component\Validator\Constraints\Compound;

/**
 * Un objectif en minutes, celui d'un jour précis comme l'habituel : dans ses bornes, au
 * quart d'heure.
 */
#[\Attribute(\Attribute::TARGET_PROPERTY | \Attribute::TARGET_METHOD | \Attribute::IS_REPEATABLE)]
final class ObjectiveMinutes extends Compound
{
    protected function getConstraints(array $options): array
    {
        return [
            new Assert\Range(
                min: Objective::MIN,
                max: Objective::MAX,
                notInRangeMessage: \sprintf('L\'objectif va de %s à %s.', Objective::format(Objective::MIN), Objective::format(Objective::MAX)),
            ),
            new Assert\DivisibleBy(value: Quarter::MINUTES, message: 'L\'objectif se règle au quart d\'heure.'),
        ];
    }
}
