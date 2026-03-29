<?php

declare(strict_types=1);

namespace App\Service;

/**
 * Résultat d'une synchronisation JIRA pour une journée.
 */
readonly class JiraSyncResult
{
    /**
     * @param array<string, string> $errors Erreurs par ticket (clé = ticket, valeur = message d'erreur)
     */
    public function __construct(
        public int $syncedCount,
        public int $deletedCount,
        public array $errors = [],
    ) {}

    public function hasErrors(): bool
    {
        return [] !== $this->errors;
    }
}