<?php

namespace App\Jira;

/**
 * Un type de ticket d'une instance Jira : chacune a les siens, que l'administrateur
 * renomme ou crée. Son identifiant le suit d'un nom à l'autre.
 */
final readonly class JiraIssueType
{
    /** Le niveau d'une sous-tâche dans la hiérarchie de Jira ; 0 pour un ticket standard, 1 pour un parent. */
    public const int SUBTASK_LEVEL = -1;

    public function __construct(
        public string $id,
        public string $name,
        public int $level,
    ) {
    }
}
