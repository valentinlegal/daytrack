<?php

namespace App\Tests\Support;

use Doctrine\DBAL\Connection;
use PHPUnit\Framework\Assert;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;

/**
 * Parler à l'API comme le fait la page de DayTrack, et regarder la base derrière elle.
 * Le noyau ne redémarre pas d'une requête à l'autre : comme dans FrankenPHP, un état
 * laissé par une requête se verrait à la suivante.
 */
trait ServerApi
{
    use PurgesDatabase;
    use ReadsJson;

    /** Ce que le navigateur joint à une requête partie de la page de DayTrack. */
    protected const array SAME_ORIGIN = ['HTTP_SEC_FETCH_SITE' => 'same-origin'];

    private KernelBrowser $browser;

    /** Le navigateur des requêtes, sur une base vide. */
    private function openBrowser(): void
    {
        $this->browser = static::createClient();
        $this->browser->disableReboot();
        self::purgeDatabase();
    }

    /**
     * @param array<mixed>|string|null $body
     * @param array<string, string>    $server
     *
     * @return array{int, array<mixed>}
     */
    protected function send(string $method, string $uri, array|string|null $body = null, array $server = self::SAME_ORIGIN, string $contentType = 'application/json'): array
    {
        $this->browser->request($method, $uri, server: ['CONTENT_TYPE' => $contentType] + $server, content: null === $body || \is_string($body) ? $body : json_encode($body, \JSON_THROW_ON_ERROR));

        return [$this->browser->getResponse()->getStatusCode(), $this->json()];
    }

    protected function connection(): Connection
    {
        return static::getContainer()->get(Connection::class);
    }

    /**
     * @return array<mixed>
     */
    private function json(): array
    {
        $content = (string) $this->browser->getResponse()->getContent();
        $data = json_decode($content, true);
        Assert::assertIsArray($data, 'Pas une réponse JSON : '.$content);

        return $data;
    }
}
