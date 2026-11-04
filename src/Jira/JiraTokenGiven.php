<?php

namespace App\Jira;

use Symfony\Component\Validator\Constraint;

/**
 * Une connexion sans jeton tapé reprend celui qui est enregistré ; sans jeton
 * enregistré non plus, le champ du jeton se refuse avec les autres, d'un seul envoi.
 */
#[\Attribute(\Attribute::TARGET_CLASS)]
final class JiraTokenGiven extends Constraint
{
    public string $message = 'Indiquez votre jeton d\'API.';

    public function getTargets(): string
    {
        return self::CLASS_CONSTRAINT;
    }
}
