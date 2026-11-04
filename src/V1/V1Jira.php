<?php

namespace App\V1;

/**
 * Le Jira que la v1 lisait dans son fichier : trois variables. Le jeton n'y reste que le
 * temps de la reprise, qui le chiffre.
 */
final readonly class V1Jira
{
    public function __construct(
        public string $address,
        public string $email,
        #[\SensitiveParameter]
        public string $token,
    ) {
    }

    /** Null si l'une des trois manque : la v1 n'était pas reliée, et la bienvenue s'affiche. */
    public static function of(?string $address, ?string $email, #[\SensitiveParameter] ?string $token): ?self
    {
        $address = trim($address ?? '');
        $email = trim($email ?? '');
        $token = trim($token ?? '');

        return '' === $address || '' === $email || '' === $token ? null : new self($address, $email, $token);
    }
}
