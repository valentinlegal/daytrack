<?php

namespace App\Tests\Support;

use PHPUnit\Framework\Assert;

/**
 * Parler à l'API des favoris comme le fait la page de DayTrack, et regarder la base
 * derrière elle. Chaque test part d'une base vide.
 */
trait FavoriteApi
{
    use ServerApi;

    protected function setUp(): void
    {
        $this->openBrowser();
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
}
