<?php

namespace App\Tests\Sending;

use App\Day\Grid;
use App\Day\SlotContent;
use App\Day\UserCalendar;
use App\Sending\Worklog;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Clock\MockClock;

/**
 * Les saisies qu'une journée met dans Jira : une par ticket et par commentaire, à
 * l'heure de son premier quart d'heure, pauses exclues.
 */
final class WorklogTest extends TestCase
{
    private UserCalendar $calendar;

    protected function setUp(): void
    {
        $this->calendar = new UserCalendar(new MockClock('2026-10-06 15:20:00 Europe/Paris'), 'Europe/Paris');
    }

    public function testUnTicketAuMemeCommentaireNeFaitQuUneSaisieMemeSepare(): void
    {
        $grid = Grid::of([
            570 => SlotContent::work('SHOP-482', 'Revue'),
            585 => SlotContent::work('SHOP-482', 'Revue'),
            600 => SlotContent::work('OPS-12', null),
            615 => SlotContent::pause(),
            630 => SlotContent::work('SHOP-482', 'Revue'),
            645 => SlotContent::work('SHOP-482', null),
        ]);

        $worklogs = Worklog::ofDay($grid, self::date('2026-10-06'), $this->calendar);

        self::assertSame([
            ['ticket' => 'SHOP-482', 'comment' => 'Revue', 'started' => '2026-10-06T09:30:00.000+0200', 'seconds' => 2700],
            ['ticket' => 'OPS-12', 'comment' => null, 'started' => '2026-10-06T10:00:00.000+0200', 'seconds' => 900],
            ['ticket' => 'SHOP-482', 'comment' => null, 'started' => '2026-10-06T10:45:00.000+0200', 'seconds' => 900],
        ], array_map(static fn (Worklog $worklog): array => $worklog->toArray(), $worklogs));
    }

    public function testUnePauseSeuleNeFaitAucuneSaisie(): void
    {
        self::assertSame([], Worklog::ofDay(Grid::of([720 => SlotContent::pause()]), self::date('2026-10-06'), $this->calendar));
    }

    public function testLHeureEstCelleDuJourTravailleMemeLeJourDuChangementDHeure(): void
    {
        $grid = Grid::of([420 => SlotContent::work('SHOP-482', null), 1185 => SlotContent::work('OPS-12', null)]);

        $worklogs = Worklog::ofDay($grid, self::date('2026-10-25'), $this->calendar);

        // Le 25 octobre 2026, Paris repasse à l'heure d'hiver : 07:00 et 19:45 sont en +0100.
        self::assertSame(['2026-10-25T07:00:00.000+0100', '2026-10-25T19:45:00.000+0100'], array_map(static fn (Worklog $worklog): string => $worklog->started->format(Worklog::STARTED), $worklogs));
    }

    public function testDeuxListesQuiDisentLaMemeChoseSontEgalesDansNImporteQuelOrdre(): void
    {
        $one = new Worklog('SHOP-482', null, new \DateTimeImmutable('2026-10-06T09:30:00+02:00'), 900);
        $two = new Worklog('OPS-12', 'Revue', new \DateTimeImmutable('2026-10-06T10:00:00+02:00'), 1800);
        // La même heure écrite dans un autre fuseau est le même instant.
        $sameAsOne = new Worklog('SHOP-482', null, new \DateTimeImmutable('2026-10-06T07:30:00Z'), 900);

        self::assertTrue(Worklog::sameList([$one, $two], [$two, $sameAsOne]));
        self::assertFalse(Worklog::sameList([$one, $two], [$one]));
        self::assertFalse(Worklog::sameList([$one, $one], [$one, $two]));
        self::assertFalse(Worklog::sameList([$one], [new Worklog('SHOP-482', null, $one->started, 1800)]));
        self::assertFalse(Worklog::sameList([$one], [new Worklog('SHOP-482', 'Revue', $one->started, 900)]));
    }

    public function testCeQuiEstGardeSeRelitEtCeQuiNeSeLitPasEstIgnore(): void
    {
        $worklog = new Worklog('SHOP-482', 'Revue', new \DateTimeImmutable('2026-10-06T09:30:00+02:00'), 900);

        self::assertTrue(Worklog::sameList([$worklog], Worklog::listFrom([$worklog->toArray(), ['ticket' => 'OPS-12'], 'texte'])));
        self::assertSame([], Worklog::listFrom('pas une liste'));
    }

    private static function date(string $date): \DateTimeImmutable
    {
        return UserCalendar::date($date) ?? throw new \LogicException($date);
    }
}
