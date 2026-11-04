<?php

namespace App\Tests\Favorite;

use App\Tests\Support\FavoriteApi;
use App\Tests\Support\RandomSuite;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

/**
 * Des suites de gestes tirées au hasard sur la liste des favoris, par l'API, contre
 * une liste tenue à côté : ajouter à une place, renommer, retirer, ranger, depuis la
 * liste à jour comme depuis celle d'un onglet en retard. Après chaque geste, la liste
 * rendue est celle qu'on attend, chaque ticket n'y est qu'une fois, et ses places
 * vont de 0 à la fin sans trou.
 */
/**
 * @phpstan-type Entry array{id: string, ticket: string, name: ?string}
 */
final class FavoriteRandomTest extends WebTestCase
{
    use FavoriteApi;
    use RandomSuite;

    private const array TICKETS = ['SHOP-482', 'SHOP-501', 'SHOP-519', 'OPS-12', 'OPS-7', 'SHOP-377'];

    public function testLaListeResteCelleDesGestes(): void
    {
        $random = $this->randomizer();
        /** @var list<Entry> $expected */
        $expected = [];
        // La liste qu'un autre onglet a vue un geste plus tôt.
        $earlier = [];

        for ($gesture = 0; $gesture < 300; ++$gesture) {
            $before = $expected;
            $seen = 0 === $random->getInt(0, 4) ? $earlier : $expected;
            $earlier = $expected;
            $known = $seen[$random->getInt(0, max(0, \count($seen) - 1))] ?? null;

            switch ($random->getInt(0, 3)) {
                case 0:
                    $ticket = self::TICKETS[$random->getInt(0, \count(self::TICKETS) - 1)];
                    $position = $random->getInt(0, \count($expected) + 1);
                    [$status, $body] = $this->add(['ticket' => $ticket, 'position' => $position]);
                    if (\in_array($ticket, array_column($expected, 'ticket'), true)) {
                        self::assertSame(422, $status, 'Un doublon : '.$ticket);
                    } else {
                        self::assertSame(201, $status);
                        $id = null;
                        foreach (self::listAt($body, 'favorites') as $favorite) {
                            $id = $favorite['ticket'] === $ticket ? self::stringAt($favorite, 'id') : $id;
                        }
                        self::assertIsString($id);
                        array_splice($expected, min($position, \count($expected)), 0, [['id' => $id, 'ticket' => $ticket, 'name' => null]]);
                    }
                    break;
                case 1:
                    if (null === $known) {
                        break;
                    }
                    $name = 0 === $random->getInt(0, 2) ? null : 'Nom '.$random->getInt(1, 9);
                    \assert(\is_string($known['id']));
                    [$status] = $this->send('PATCH', '/api/favorites/'.$known['id'], ['name' => $name]);
                    $index = self::indexOf($expected, $known['id']);
                    self::assertSame(null === $index ? 404 : 200, $status);
                    if (null !== $index) {
                        $expected[$index]['name'] = $name;
                    }
                    break;
                case 2:
                    if (null === $known) {
                        break;
                    }
                    \assert(\is_string($known['id']));
                    [$status] = $this->send('DELETE', '/api/favorites/'.$known['id']);
                    $index = self::indexOf($expected, $known['id']);
                    self::assertSame(null === $index ? 404 : 200, $status);
                    if (null !== $index) {
                        array_splice($expected, $index, 1);
                    }
                    break;
                default:
                    $order = $seen;
                    $random->shuffleArray($order);
                    [$status] = $this->send('PUT', '/api/favorites/order', ['ids' => array_column($order, 'id')]);
                    $same = array_column($order, 'id');
                    $current = array_column($expected, 'id');
                    sort($same);
                    sort($current);
                    self::assertSame($same === $current ? 200 : 409, $status);
                    if ($same === $current) {
                        $expected = $order;
                        // L'ordre vient de la liste vue, les noms restent ceux d'avant le geste.
                        foreach ($expected as $i => $favorite) {
                            $expected[$i]['name'] = $before[self::indexOf($before, $favorite['id']) ?? 0]['name'];
                        }
                    }
            }

            self::assertSame($expected, $this->favorites(), 'Après le geste '.$gesture);
            self::assertSame(
                array_map(static fn (int $position, array $favorite): string => $position.' '.$favorite['ticket'], array_keys($expected), $expected),
                $this->rows(),
            );
        }
    }

    /**
     * @param list<array<string, ?string>> $list
     */
    private static function indexOf(array $list, ?string $id): ?int
    {
        foreach ($list as $index => $favorite) {
            if ($favorite['id'] === $id) {
                return $index;
            }
        }

        return null;
    }
}
