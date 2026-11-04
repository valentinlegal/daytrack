<?php

namespace App\Dev\Jira;

/**
 * Une requête faite au Jira simulé, d'où qu'elle vienne : le service HTTP du
 * développement ou le client simulé des tests.
 */
final readonly class FakeJiraRequest
{
    /**
     * @param array<string, string> $query
     */
    public function __construct(
        public string $method,
        public string $path,
        public array $query = [],
        public ?string $authorization = null,
        public string $body = '',
    ) {
    }

    /** L'en-tête « Authorization » qu'enverrait DayTrack avec ces identifiants. */
    public static function basic(string $email, string $token): string
    {
        return 'Basic '.base64_encode($email.':'.$token);
    }
}
