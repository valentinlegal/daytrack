<?php

namespace App\Tests\Day;

use App\Day\UserCalendar;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Clock\MockClock;

/**
 * Le jour de l'utilisateur, jamais celui de l'heure universelle.
 */
final class UserCalendarTest extends TestCase
{
    public function testA0030AParisOnEstLeLendemainDeLHeureUniverselle(): void
    {
        $calendar = self::calendarAt('2026-10-06 22:30:00 UTC');

        self::assertSame('2026-10-07', $calendar->today()->format('Y-m-d'));
        self::assertSame(30, $calendar->minuteOf(self::date('2026-10-07')));
        self::assertNull($calendar->minuteOf(self::date('2026-10-06')));
    }

    public function testLeJourDuPassageALHeureDHiverGardeSesHeuresDeGrille(): void
    {
        // Le 25 octobre 2026, à 03:00 à Paris, il redevient 02:00.
        $calendar = self::calendarAt('2026-10-25 14:20:00 UTC');

        self::assertSame('2026-10-25', $calendar->today()->format('Y-m-d'));
        self::assertSame(15 * 60 + 20, $calendar->minuteOf(self::date('2026-10-25')));
    }

    public function testUnJourSOuvreJusquATrenteJoursDevant(): void
    {
        $calendar = self::calendarAt('2026-10-06 10:00:00 Europe/Paris');

        self::assertSame('2026-11-05', $calendar->open('2026-11-05')?->format('Y-m-d'));
        self::assertNull($calendar->open('2026-11-06'));
        self::assertSame('2019-01-01', $calendar->open('2019-01-01')?->format('Y-m-d'), 'Le passé n\'a pas de limite.');
        self::assertNull($calendar->open('2026-02-30'), 'Un jour qui n\'existe pas ne s\'ouvre pas.');
    }

    public function testATrenteJoursPileLaLimiteSuitMinuitDeLUtilisateur(): void
    {
        // 23:30 en heure universelle, le 6 octobre : il est déjà le 7 à Paris.
        $calendar = self::calendarAt('2026-10-06 23:30:00 UTC');

        self::assertSame('2026-11-06', $calendar->open('2026-11-06')?->format('Y-m-d'));
    }

    public function testUneDateQuiNExistePasAuCalendrierEstRefusee(): void
    {
        foreach (['2026-02-29', '2026-02-30', '2026-13-01', '2026-10-6', '06-10-2026', '2026-10-06 ', ''] as $value) {
            self::assertNull(UserCalendar::date($value), $value);
        }
        self::assertSame('2028-02-29', UserCalendar::date('2028-02-29')?->format('Y-m-d'));
    }

    private static function calendarAt(string $now): UserCalendar
    {
        return new UserCalendar(new MockClock($now), 'Europe/Paris');
    }

    private static function date(string $value): \DateTimeImmutable
    {
        return UserCalendar::date($value) ?? throw new \LogicException($value);
    }
}
