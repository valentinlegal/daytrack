<?php

namespace App\Api\Input;

use Symfony\Component\Validator\Constraint;

/**
 * Un créneau ne se relie qu'à la récurrence qui l'a posé : son contenu, dans sa plage. Le
 * navigateur ne relie que ce qu'annuler ou rétablir lui rend ; le serveur ne le croit pas
 * sur parole.
 */
#[\Attribute(\Attribute::TARGET_CLASS)]
final class LinksMatchRecurrences extends Constraint
{
    public string $message = 'Ce créneau n\'appartient pas à cette récurrence.';

    public function getTargets(): string
    {
        return self::CLASS_CONSTRAINT;
    }
}
