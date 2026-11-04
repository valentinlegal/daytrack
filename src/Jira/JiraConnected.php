<?php

namespace App\Jira;

/**
 * Une connexion qui marche : où DayTrack appellera l'API, le compte qu'il y trouve, et
 * l'identifiant du site, qui dit de quel Jira il s'agit quelle que soit l'adresse de
 * l'API — null quand le site ne l'a pas donné.
 */
final readonly class JiraConnected
{
    public function __construct(
        public string $api,
        public JiraAccount $account,
        public ?string $cloudId = null,
    ) {
    }
}
