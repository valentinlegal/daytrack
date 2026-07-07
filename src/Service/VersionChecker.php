<?php

declare(strict_types=1);

namespace App\Service;

use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Contracts\Cache\CacheInterface;
use Symfony\Contracts\Cache\ItemInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;
use Throwable;

/**
 * Vérifie si une version plus récente de l'image DayTrack est publiée sur ghcr.io.
 *
 * Le dépôt GitHub est privé mais l'image publiée est publique : les tags sont
 * accessibles anonymement via le flux de token du Docker Registry v2, sans
 * dépendance à un serveur externe ni à un jeton GitHub.
 */
class VersionChecker
{
    private const string REGISTRY_HOST = 'ghcr.io';
    private const string IMAGE_REPOSITORY = 'valentinlegal/daytrack';
    private const string CACHE_KEY = 'version_checker.latest_tag';
    private const int CACHE_TTL_SECONDS = 6 * 3600;

    public function __construct(
        private readonly HttpClientInterface $httpClient,
        private readonly CacheInterface $cache,
        #[Autowire(env: 'APP_VERSION')]
        private readonly string $currentVersion = 'dev',
    ) {}

    /**
     * @return array{current: string, latest: string|null, updateAvailable: bool}
     */
    public function check(): array
    {
        // Hors release taguée (dev, develop, exécution locale...) : pas de comparaison possible.
        if (!$this->isSemver($this->currentVersion)) {
            return [
                'current' => $this->currentVersion,
                'latest' => null,
                'updateAvailable' => false,
            ];
        }

        $latest = $this->fetchLatestTag();

        return [
            'current' => $this->currentVersion,
            'latest' => $latest,
            'updateAvailable' => null !== $latest && version_compare($latest, $this->currentVersion, '>'),
        ];
    }

    /**
     * Récupère le dernier tag semver publié sur ghcr.io, mis en cache pour limiter les appels au registre.
     */
    private function fetchLatestTag(): ?string
    {
        try {
            return $this->cache->get(self::CACHE_KEY, function (ItemInterface $item): ?string {
                $item->expiresAfter(self::CACHE_TTL_SECONDS);

                return $this->resolveLatestTagFromRegistry();
            });
        } catch (Throwable) {
            return null;
        }
    }

    /**
     * Interroge anonymement le registre ghcr.io (token puis liste des tags) et retient le plus récent des tags semver.
     */
    private function resolveLatestTagFromRegistry(): ?string
    {
        $tokenResponse = $this->httpClient->request(
            'GET',
            'https://'.self::REGISTRY_HOST.'/token',
            [
                'query' => [
                    'scope' => 'repository:'.self::IMAGE_REPOSITORY.':pull',
                    'service' => self::REGISTRY_HOST,
                ],
            ],
        );
        $token = $tokenResponse->toArray()['token'] ?? null;

        if (!is_string($token) || '' === $token) {
            return null;
        }

        $tagsResponse = $this->httpClient->request(
            'GET',
            'https://'.self::REGISTRY_HOST.'/v2/'.self::IMAGE_REPOSITORY.'/tags/list',
            [
                'headers' => [
                    'Authorization' => 'Bearer '.$token,
                ],
            ],
        );
        $tags = $tagsResponse->toArray()['tags'] ?? [];

        $latest = null;
        foreach ($tags as $tag) {
            if (!is_string($tag) || !$this->isSemver($tag)) {
                continue;
            }
            if (null === $latest || version_compare($tag, $latest, '>')) {
                $latest = $tag;
            }
        }

        return $latest;
    }

    /**
     * Vérifie qu'une chaîne est un semver strict "x.y.z" (les tags ghcr n'ont pas de préfixe "v").
     */
    private function isSemver(string $value): bool
    {
        return 1 === preg_match('/^\d+\.\d+\.\d+$/', $value);
    }
}
