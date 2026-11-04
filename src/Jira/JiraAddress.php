<?php

namespace App\Jira;

/**
 * L'adresse de Jira telle que l'utilisateur la tape, ramenée à ce que DayTrack
 * appelle.
 *
 * Jira Cloud vit à la racine de son site : une adresse collée depuis un ticket
 * (…/browse/SHOP-482) ramène au site. Une adresse sans « https:// » le reçoit, une
 * adresse en « http:// » passe en « https:// » : rien ne part vers Jira en clair.
 * L'adresse de la passerelle d'Atlassian, que la v1 faisait écrire pour un jeton à
 * périmètres, se garde telle quelle.
 */
final readonly class JiraAddress
{
    private const string GATEWAY_PATH = '#^/ex/jira/([0-9a-fA-F-]{36})(?:/.*)?$#';

    private function __construct(
        /** Ce que l'écran montre et ce que DayTrack garde : https://exemple.atlassian.net */
        public string $site,
        /** L'identifiant du site dans la passerelle, quand l'adresse est celle de la passerelle. */
        public ?string $cloudId,
    ) {
    }

    public static function parse(string $typed): ?self
    {
        $typed = trim($typed);

        if ('' === $typed || 1 === preg_match('/\s/', $typed)) {
            return null;
        }

        if (1 !== preg_match('#^[a-z][a-z0-9+.-]*://#i', $typed)) {
            $typed = 'https://'.$typed;
        }

        $parts = parse_url($typed);
        $scheme = \is_array($parts) ? strtolower($parts['scheme'] ?? '') : '';
        $host = \is_array($parts) ? strtolower($parts['host'] ?? '') : '';

        if (!\in_array($scheme, ['http', 'https'], true) || '' === $host || isset($parts['user']) || isset($parts['pass'])) {
            return null;
        }

        $origin = 'https://'.$host.(isset($parts['port']) ? ':'.$parts['port'] : '');

        if ('api.atlassian.com' === $host && 1 === preg_match(self::GATEWAY_PATH, $parts['path'] ?? '', $matches)) {
            return new self($origin.'/ex/jira/'.strtolower($matches[1]), strtolower($matches[1]));
        }

        return new self($origin, null);
    }

    public function isGateway(): bool
    {
        return null !== $this->cloudId;
    }
}
