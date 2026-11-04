<?php

namespace App\Version;

use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\DependencyInjection\Attribute\Target;
use Symfony\Contracts\Cache\CacheInterface;
use Symfony\Contracts\Cache\ItemInterface;
use Symfony\Contracts\HttpClient\Exception\ExceptionInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

/**
 * La version à installer, s'il y en a une : la plus récente des images publiées, quand
 * elle dépasse celle de cette installation.
 *
 * L'image est publique : le registre se lit sans compte, par un jeton anonyme. Sa réponse
 * se garde quelques heures, pour ne pas l'interroger à chaque page, et moins longtemps
 * quand il ne répond pas : l'avis n'est qu'un avis, un registre muet ne se voit pas à
 * l'écran. La comparaison se refait à chaque fois : juste après une mise à jour, l'avis
 * tombe sans attendre.
 */
final readonly class AvailableVersion
{
    private const string REGISTRY = 'https://ghcr.io';
    private const string IMAGE = 'valentinlegal/daytrack';

    private const int KEPT_SECONDS = 6 * 3600;
    private const int KEPT_AFTER_FAILURE_SECONDS = 15 * 60;

    public function __construct(
        #[Target('registry.client')]
        private HttpClientInterface $registry,
        #[Target('version.cache')]
        private CacheInterface $cache,
        #[Autowire('%kernel.project_dir%/version.txt')]
        private string $versionFile,
    ) {
    }

    public function find(): ?string
    {
        $latest = $this->cache->get('latest', function (ItemInterface $item): ?string {
            $latest = $this->latest();
            $item->expiresAfter(null === $latest ? self::KEPT_AFTER_FAILURE_SECONDS : self::KEPT_SECONDS);

            return $latest;
        });

        return \is_string($latest) && version_compare($latest, $this->installed(), '>') ? $latest : null;
    }

    private function installed(): string
    {
        return trim((string) file_get_contents($this->versionFile));
    }

    /** La plus récente des versions publiées ; rien si le registre ne le dit pas. */
    private function latest(): ?string
    {
        $latest = null;
        foreach ($this->tags() as $tag) {
            // « latest », « develop », « 1.1 » sont aussi des tags : seuls les numéros
            // entiers désignent une version, et celui-ci finit à l'écran et dans une adresse.
            if (\is_string($tag) && 1 === preg_match('/^\d+\.\d+\.\d+\z/', $tag) && (null === $latest || version_compare($tag, $latest, '>'))) {
                $latest = $tag;
            }
        }

        return $latest;
    }

    /**
     * @return array<mixed>
     */
    private function tags(): array
    {
        try {
            $token = $this->registry->request('GET', self::REGISTRY.'/token', [
                'query' => ['scope' => 'repository:'.self::IMAGE.':pull', 'service' => 'ghcr.io'],
            ])->toArray()['token'] ?? null;

            if (!\is_string($token) || '' === $token) {
                return [];
            }

            $tags = $this->registry->request('GET', self::REGISTRY.'/v2/'.self::IMAGE.'/tags/list', [
                'auth_bearer' => $token,
            ])->toArray()['tags'] ?? null;

            return \is_array($tags) ? $tags : [];
        } catch (ExceptionInterface) {
            return [];
        }
    }
}
