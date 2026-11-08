<?php

namespace App\Tests\Support;

use App\Entity\EmptyDayWatch;
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\Assert;
use Symfony\Component\Clock\Test\ClockSensitiveTrait;

/**
 * Parler à l'API des journées comme le fait la page de DayTrack, et regarder la
 * base derrière elle.
 *
 * L'heure est figée au mardi 6 octobre 2026, 15:20 à Paris, comme dans la journée
 * d'exemple. Chaque test part d'une base vide.
 */
trait DayApi
{
    use ClockSensitiveTrait;
    use ServerApi;

    protected const string TODAY = '2026-10-06';

    /** Le calendrier d'octobre 2026, du lundi 28 septembre au dimanche 1er novembre. */
    protected const string MONTH_FROM = '2026-09-28';
    protected const string MONTH_TO = '2026-11-01';

    protected function setUp(): void
    {
        self::mockTime('2026-10-06 15:20:00 Europe/Paris');
        $this->openBrowser();
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

    /**
     * Les marques du calendrier, jour par jour, telles que le mois les lit.
     *
     * @return array<mixed>
     */
    protected function marks(string $from = self::MONTH_FROM, string $to = self::MONTH_TO): array
    {
        return self::arrayAt($this->calendar($from, $to), 'marks');
    }

    /**
     * @return array<mixed>
     */
    protected function calendar(string $from, string $to): array
    {
        $this->browser->request('GET', '/api/calendar/'.$from.'/'.$to);
        Assert::assertSame(200, $this->browser->getResponse()->getStatusCode(), (string) $this->browser->getResponse()->getContent());
        $calendar = $this->json();
        Assert::assertSame(['marks', 'daysOff', 'workingDays'], array_keys($calendar));

        return $calendar;
    }
}
