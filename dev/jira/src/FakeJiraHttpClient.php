<?php

namespace App\Dev\Jira;

use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;

/**
 * Le Jira simulé derrière un client HTTP de Symfony, pour les tests : le code qui
 * parle à Jira s'y branche comme à un vrai, sans réseau ni attente.
 *
 * Un délai de Jira y devient un dépassement du délai d'attente du client, après
 * que le Jira simulé a enregistré la requête — comme un vrai Jira trop lent. Il
 * répond à l'adresse du site comme à celle de la passerelle d'Atlassian et à celle du
 * registre des images ; ailleurs, personne ne répond, comme à une adresse qui n'existe pas.
 */
final class FakeJiraHttpClient
{
    /** Les adresses où répond le Jira simulé : son site, la passerelle d'Atlassian et le registre des images. */
    public const array HOSTS = ['jira', 'api.atlassian.com', 'ghcr.io'];

    public static function create(FakeJira $jira, string $baseUri = 'https://jira'): MockHttpClient
    {
        return new MockHttpClient(static function (string $method, string $url, array $options) use ($jira): MockResponse {
            $parts = parse_url($url);

            if (!\is_array($parts) || !\in_array($parts['host'] ?? null, self::HOSTS, true)) {
                return new MockResponse('', ['error' => \sprintf('Could not resolve host: %s', \is_array($parts) ? ($parts['host'] ?? '') : '')]);
            }

            parse_str($parts['query'] ?? '', $query);

            $headers = $options['normalized_headers'] ?? [];
            $authorization = \is_array($headers) && \is_array($headers['authorization'] ?? null) ? ($headers['authorization'][0] ?? null) : null;
            $body = $options['body'] ?? '';

            $response = $jira->handle(new FakeJiraRequest(
                $method,
                $parts['path'] ?? '/',
                array_filter($query, static fn (mixed $value, mixed $key): bool => \is_string($key) && \is_string($value), \ARRAY_FILTER_USE_BOTH),
                \is_string($authorization) ? preg_replace('/^Authorization:\s*/i', '', $authorization) : null,
                \is_string($body) ? $body : '',
            ));

            $headers = ['content-type: application/json'];
            foreach ($response->headers as $name => $value) {
                $headers[] = $name.': '.$value;
            }
            $info = ['http_code' => $response->status, 'response_headers' => $headers];
            $json = $response->json();

            if ($response->delaySeconds > 0) {
                // Une chaîne vide est un dépassement du délai d'attente pour MockResponse.
                return new MockResponse((static function () use ($json): \Generator {
                    yield '';
                    yield $json;
                })(), $info);
            }

            return new MockResponse($json, $info);
        }, $baseUri);
    }
}
