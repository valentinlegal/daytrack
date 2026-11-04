<?php

namespace App\Jira;

/**
 * Ce qu'il faut pour parler à Jira : où, et en tant que qui.
 *
 * Le jeton ne se lit pas de dehors : il ne sert qu'à l'en-tête que le client HTTP
 * envoie à Jira, et ne paraît ni dans une trace, ni dans un vidage de l'objet.
 */
final readonly class JiraCredentials
{
    public function __construct(
        /** Le site (https://exemple.atlassian.net), ou la passerelle d'Atlassian pour un jeton à périmètres. */
        public string $api,
        public string $email,
        #[\SensitiveParameter]
        private string $token,
    ) {
    }

    /**
     * Les options du client HTTP qui portent l'identité : un en-tête Basic, que le
     * client ne journalise pas, plutôt qu'une adresse « e-mail:jeton@site » qui le serait.
     *
     * @return array{auth_basic: array{string, string}}
     */
    public function httpOptions(): array
    {
        return ['auth_basic' => [$this->email, $this->token]];
    }

    /**
     * @return array<string, string>
     */
    public function __debugInfo(): array
    {
        return ['api' => $this->api, 'email' => $this->email, 'token' => '(masqué)'];
    }
}
