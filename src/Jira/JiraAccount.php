<?php

namespace App\Jira;

/**
 * Le compte Jira que le jeton représente : son identifiant, qui reconnaîtra ses
 * heures dans Jira, et le nom que l'écran affiche.
 */
final readonly class JiraAccount
{
    public function __construct(
        public string $id,
        public string $name,
    ) {
    }
}
