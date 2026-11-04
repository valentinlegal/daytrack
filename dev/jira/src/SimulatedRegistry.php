<?php

namespace App\Dev\Jira;

use Symfony\Component\HttpClient\DecoratorTrait;
use Symfony\Contracts\HttpClient\HttpClientInterface;
use Symfony\Contracts\HttpClient\ResponseInterface;

/**
 * En développement, ce qui vise le registre des images part vers le Jira simulé, qui le
 * joue, avec le certificat de l'autorité locale : les parcours publient une version sans
 * que rien n'atteigne ghcr.io.
 */
final class SimulatedRegistry implements HttpClientInterface
{
    use DecoratorTrait;

    private const string REGISTRY = 'https://ghcr.io/';

    public function __construct(
        HttpClientInterface $client,
        private string $caFile,
        private string $simulated = 'https://jira/',
    ) {
        $this->client = $client;
    }

    /**
     * @param array<mixed> $options
     */
    public function request(string $method, string $url, array $options = []): ResponseInterface
    {
        if (str_starts_with($url, self::REGISTRY)) {
            $url = $this->simulated.substr($url, \strlen(self::REGISTRY));
            $options['cafile'] = $this->caFile;
        }

        return $this->client->request($method, $url, $options);
    }
}
