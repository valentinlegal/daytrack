<?php

namespace App\Tests\Support;

use Doctrine\DBAL\Connection;
use PHPUnit\Framework\Assert;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;

/**
 * Parler à l'API des favoris comme le fait la page de DayTrack, et regarder la base
 * derrière elle. Le noyau ne redémarre pas d'une requête à l'autre, comme dans
 * FrankenPHP.
 */
trait FavoriteApi
{
    use ReadsJson;

    /** Ce que le navigateur joint à une requête partie de la page de DayTrack. */
    protected const array SAME_ORIGIN = ['HTTP_SEC_FETCH_SITE' => 'same-origin'];

    private KernelBrowser $browser;

    protected function setUp(): void
    {
        $this->browser = static::createClient();
        $this->browser->disableReboot();

        $this->connection()->executeStatement('DELETE FROM favorite');
        foreach (['ticket', 'issue_type', 'jira_connection', 'settings'] as $table) {
            $this->connection()->executeStatement('DELETE FROM '.$table);
        }
    }

    /**
     * La liste, telle que GET la rend.
     *
     * @return list<array<mixed>>
     */
    protected function favorites(): array
    {
        [$status, $body] = $this->send('GET', '/api/favorites');
        Assert::assertSame(200, $status);

        return self::listAt($body, 'favorites');
    }

    /**
     * @param array<string, mixed> $body
     *
     * @return array{int, array<mixed>}
     */
    protected function add(array $body): array
    {
        return $this->send('POST', '/api/favorites', $body);
    }

    /**
     * Un ajout qui doit passer : rend son identifiant.
     */
    protected function added(string $ticket, int $position = 0): string
    {
        [$status, $body] = $this->add(['ticket' => $ticket, 'position' => $position]);
        Assert::assertSame(201, $status, json_encode($body, \JSON_THROW_ON_ERROR));
        foreach (self::listAt($body, 'favorites') as $favorite) {
            if ($favorite['ticket'] === $ticket) {
                return self::stringAt($favorite, 'id');
            }
        }
        Assert::fail($ticket.' manque à la liste rendue.');
    }

    /**
     * @param array<mixed>|string|null $body
     * @param array<string, string>    $server
     *
     * @return array{int, array<mixed>}
     */
    protected function send(string $method, string $uri, array|string|null $body = null, array $server = self::SAME_ORIGIN): array
    {
        $this->browser->request($method, $uri, server: ['CONTENT_TYPE' => 'application/json'] + $server, content: null === $body ? null : (\is_string($body) ? $body : json_encode($body, \JSON_THROW_ON_ERROR)));
        $content = (string) $this->browser->getResponse()->getContent();
        $data = json_decode($content, true);
        Assert::assertIsArray($data, 'Pas une réponse JSON : '.$content);

        return [$this->browser->getResponse()->getStatusCode(), $data];
    }

    /**
     * Les tickets de la liste, de haut en bas.
     *
     * @param list<array<mixed>> $favorites
     *
     * @return list<string>
     */
    protected static function tickets(array $favorites): array
    {
        return array_map(static fn (array $favorite): string => self::stringAt($favorite, 'ticket'), $favorites);
    }

    /**
     * Ce que la base contient, dans l'ordre de ses places : « 0 SHOP-482 ».
     *
     * @return list<string>
     */
    protected function rows(): array
    {
        return array_map(
            static function (array $row): string {
                Assert::assertIsInt($row['position']);
                Assert::assertIsString($row['ticket']);

                return $row['position'].' '.$row['ticket'];
            },
            $this->connection()->fetchAllAssociative('SELECT position, ticket FROM favorite ORDER BY position'),
        );
    }

    protected function connection(): Connection
    {
        return static::getContainer()->get('doctrine.dbal.default_connection');
    }
}
