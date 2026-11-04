<?php

namespace App\Dev\Jira;

/**
 * Ce que rend le Jira simulé : un statut, un corps JSON, et le temps qu'il met à
 * répondre — l'état, lui, est déjà enregistré quand ce délai commence.
 */
final readonly class FakeJiraResponse
{
    /**
     * @param array<mixed>|null     $body
     * @param array<string, string> $headers
     */
    public function __construct(
        public int $status,
        public ?array $body = null,
        public int $delaySeconds = 0,
        public array $headers = [],
    ) {
    }

    public function json(): string
    {
        return null === $this->body ? '' : json_encode($this->body, \JSON_THROW_ON_ERROR | \JSON_UNESCAPED_UNICODE | \JSON_UNESCAPED_SLASHES);
    }

    /**
     * @param list<string>          $messages
     * @param array<string, string> $errors
     */
    public static function error(int $status, array $messages, array $errors = []): self
    {
        return new self($status, ['errorMessages' => $messages, 'errors' => (object) $errors]);
    }

    /** Une erreur de la passerelle d'Atlassian, qui n'a pas la forme de celles de Jira. */
    public static function gateway(int $status, string $message): self
    {
        return new self($status, ['code' => $status, 'message' => $message]);
    }
}
