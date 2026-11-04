<?php

namespace App\Dev\Jira;

use Symfony\Component\HttpClient\DecoratorTrait;
use Symfony\Contracts\HttpClient\HttpClientInterface;
use Symfony\Contracts\HttpClient\ResponseInterface;

/**
 * En développement, la passerelle d'Atlassian est la vraie, sauf pour le site du Jira
 * simulé : ce qui vise son identifiant part vers lui. Un vrai Jira s'essaie donc depuis
 * l'application de développement, jeton à périmètres compris, et le Jira simulé reste
 * celui des parcours.
 */
final class SimulatedGateway implements HttpClientInterface
{
    use DecoratorTrait;

    private string $gateway;

    public function __construct(
        HttpClientInterface $client,
        string $gateway,
        private string $simulated = 'https://jira',
    ) {
        $this->client = $client;
        $this->gateway = rtrim($gateway, '/').'/ex/jira/'.Catalog::CLOUD_ID.'/';
    }

    /**
     * @param array<mixed> $options
     */
    public function request(string $method, string $url, array $options = []): ResponseInterface
    {
        if (str_starts_with($url, $this->gateway)) {
            $url = $this->simulated.'/ex/jira/'.Catalog::CLOUD_ID.'/'.substr($url, \strlen($this->gateway));
        }

        return $this->client->request($method, $url, $options);
    }
}
