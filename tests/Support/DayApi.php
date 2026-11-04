<?php

namespace App\Tests\Support;

use App\Entity\EmptyDayWatch;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\Assert;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Component\Clock\Test\ClockSensitiveTrait;

/**
 * Parler à l'API des journées comme le fait la page de DayTrack, et regarder la
 * base derrière elle.
 *
 * L'heure est figée au mardi 6 octobre 2026, 15:20 à Paris, comme dans la journée
 * d'exemple. Le noyau ne redémarre pas d'une requête à l'autre : comme dans FrankenPHP,
 * un état laissé par une requête se verrait à la suivante.
 */
trait DayApi
{
    use ClockSensitiveTrait;
    use ReadsJson;

    protected const string TODAY = '2026-10-06';

    /** Ce que le navigateur joint à une requête partie de la page de DayTrack. */
    protected const array SAME_ORIGIN = ['HTTP_SEC_FETCH_SITE' => 'same-origin'];

    private KernelBrowser $browser;

    protected function setUp(): void
    {
        self::mockTime('2026-10-06 15:20:00 Europe/Paris');

        $this->browser = static::createClient();
        $this->browser->disableReboot();

        $this->connection()->executeStatement('DELETE FROM day_send');
        $this->connection()->executeStatement('DELETE FROM slot');
        $this->connection()->executeStatement('DELETE FROM day');
        foreach (['favorite', 'ticket', 'issue_type', 'jira_connection', 'settings', 'v1_import', 'empty_day_watch'] as $table) {
            $this->connection()->executeStatement('DELETE FROM '.$table);
        }
    }

    /**
     * @return array<mixed>
     */
    protected function day(string $date = self::TODAY): array
    {
        $this->browser->request('GET', '/api/days/'.$date);
        Assert::assertSame(200, $this->browser->getResponse()->getStatusCode(), (string) $this->browser->getResponse()->getContent());

        return $this->json();
    }

    /**
     * @param list<array<string, ?string>> $changes
     * @param array<string, string>        $server
     *
     * @return array{int, array<mixed>}
     */
    protected function patchSlots(int $version, array $changes, string $date = self::TODAY, array $server = self::SAME_ORIGIN): array
    {
        return $this->send('PATCH', '/api/days/'.$date.'/slots', ['version' => $version, 'changes' => $changes], $server);
    }

    /**
     * @return array{int, array<mixed>}
     */
    protected function putObjective(int $version, int $objective, string $date = self::TODAY): array
    {
        return $this->send('PUT', '/api/days/'.$date.'/objective', ['version' => $version, 'objective' => $objective]);
    }

    /**
     * Un geste qui doit passer : rend la journée écrite.
     *
     * @param list<array<string, ?string>> $changes
     *
     * @return array<mixed>
     */
    protected function write(int $version, array $changes, string $date = self::TODAY): array
    {
        [$status, $day] = $this->patchSlots($version, $changes, $date);
        Assert::assertSame(200, $status, json_encode($day, \JSON_THROW_ON_ERROR));

        return $day;
    }

    /**
     * @param array<mixed>|string   $body
     * @param array<string, string> $server
     *
     * @return array{int, array<mixed>}
     */
    protected function send(string $method, string $uri, array|string $body, array $server = self::SAME_ORIGIN, string $contentType = 'application/json'): array
    {
        $this->browser->request($method, $uri, server: ['CONTENT_TYPE' => $contentType] + $server, content: \is_string($body) ? $body : json_encode($body, \JSON_THROW_ON_ERROR));

        return [$this->browser->getResponse()->getStatusCode(), $this->json()];
    }

    /**
     * @return array<string, ?string>
     */
    protected static function work(string $start, string $end, string $ticket, ?string $comment = null): array
    {
        return ['start' => $start, 'end' => $end, 'kind' => 'work', 'ticket' => $ticket, 'comment' => $comment];
    }

    /**
     * @return array<string, ?string>
     */
    protected static function pause(string $start, string $end): array
    {
        return ['start' => $start, 'end' => $end, 'kind' => 'pause'];
    }

    /**
     * @return array<string, ?string>
     */
    protected static function clear(string $start, string $end): array
    {
        return ['start' => $start, 'end' => $end, 'kind' => 'empty'];
    }

    /**
     * Les blocs d'une journée rendue, réduits à ce qui se compare d'un coup d'œil.
     *
     * @param array<mixed> $day
     *
     * @return list<string>
     */
    protected static function blocks(array $day): array
    {
        return array_map(static function (array $block): string {
            $label = 'pause' === $block['kind'] ? 'pause' : self::stringAt($block, 'ticket');
            $comment = self::at($block, 'comment');

            return self::stringAt($block, 'start').'-'.self::stringAt($block, 'end').' '.$label.(\is_string($comment) ? ' « '.$comment.' »' : '');
        }, self::listAt($day, 'blocks'));
    }

    /**
     * Les lignes de la base pour un jour, une par quart d'heure occupé.
     *
     * @return list<array<string, mixed>>
     */
    protected function rows(string $date = self::TODAY): array
    {
        /* @var list<array<string, mixed>> */
        return $this->connection()->fetchAllAssociative(
            'SELECT slot.start, slot.kind, slot.ticket, slot.comment FROM slot JOIN day ON day.id = slot.day_id WHERE day.date = ? ORDER BY slot.start',
            [$date],
        );
    }

    /**
     * Le point de départ des jours vides, tel que la migration l'aurait posé à cet instant.
     * Chaque test part sans lui : aucun jour vide ne se signale.
     */
    protected function watchEmptyDaysSince(string $instant): void
    {
        $this->connection()->executeStatement('DELETE FROM empty_day_watch');
        $entityManager = static::getContainer()->get(EntityManagerInterface::class);
        $entityManager->persist(new EmptyDayWatch(new \DateTimeImmutable($instant)));
        $entityManager->flush();
    }

    protected function dayRows(): int
    {
        $count = $this->connection()->fetchOne('SELECT COUNT(*) FROM day');
        Assert::assertIsNumeric($count);

        return (int) $count;
    }

    protected function connection(): Connection
    {
        return static::getContainer()->get('doctrine.dbal.default_connection');
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
