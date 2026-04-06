<?php

declare(strict_types=1);

namespace App\Service;

use Symfony\Component\DependencyInjection\Attribute\Autowire;

class JiraConfigProvider
{
    public function __construct(
        #[Autowire(env: 'JIRA_BASE_URL')]
        private readonly string $baseUrl,
        #[Autowire(env: 'JIRA_USER_EMAIL')]
        private readonly string $userEmail,
        #[Autowire(env: 'JIRA_API_TOKEN')]
        private readonly string $apiToken,
        #[Autowire(env: 'JIRA_TICKET_TYPES')]
        private readonly string $ticketTypes = '',
    ) {}

    /**
     * Vérifie que toutes les variables JIRA sont renseignées. 
     */
    public function isConfigured(): bool
    {
        return '' !== $this->baseUrl && '' !== $this->userEmail && '' !== $this->apiToken;
    }

    public function getBaseUrl(): string
    {
        return rtrim($this->baseUrl, '/');
    }

    public function getUserEmail(): string
    {
        return $this->userEmail;
    }

    /**
     * Retourne l'en-tête Authorization en Basic Auth (email:token encodé base64).
     */
    public function getAuthHeader(): string
    {
        return 'Basic '.base64_encode($this->userEmail.':'.$this->apiToken);
    }

    /**
     * Parse JIRA_TICKET_TYPES et retourne un mapping type → couleur.
     * Format attendu : "Story:emerald,Bug:orange,Epic:purple"
     *
     * @return array<string, string>
     */
    public function getTicketTypeColors(): array
    {
        if ('' === $this->ticketTypes) {
            return [];
        }

        $mapping = [];
        foreach (explode(',', $this->ticketTypes) as $pair) {
            $parts = explode(':', trim($pair), 2);
            if (2 === count($parts) && '' !== $parts[0] && '' !== $parts[1]) {
                $mapping[trim($parts[0])] = trim($parts[1]);
            }
        }

        return $mapping;
    }
}