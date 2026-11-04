<?php

namespace App\Tests\Day;

use App\Day\Block;
use App\Day\Grid;
use App\Day\Quarter;
use App\Day\SlotContent;
use App\Tests\Support\ReadsJson;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Le découpage d'une journée en blocs : les quarts d'heure voisins au même contenu
 * forment un bloc, et rien d'autre ne les regroupe.
 */
final class GridTest extends TestCase
{
    use ReadsJson;

    private const string CASES = __DIR__.'/../cases/blocks.json';

    /**
     * Les cas que le navigateur rejoue aussi (tests/front/grid/grid.test.ts).
     *
     * @param list<array<mixed>> $slots
     * @param list<array<mixed>> $expected
     */
    #[DataProvider('sharedCases')]
    public function testLesBlocsDesCasPartagesAvecLeNavigateur(array $slots, array $expected): void
    {
        $quarters = [];
        foreach ($slots as $slot) {
            $start = Quarter::parse(self::stringAt($slot, 0));
            $end = Quarter::parse(self::stringAt($slot, 1));
            self::assertNotNull($start);
            self::assertNotNull($end);

            $content = self::content($slot);
            foreach (Quarter::between($start, $end) as $quarter) {
                $quarters[$quarter] = $content;
            }
        }

        self::assertSame($expected, array_map(static fn (Block $block): array => [
            Quarter::format($block->start),
            Quarter::format($block->end),
            $block->content->kind->value,
            $block->content->ticket,
            $block->content->comment,
        ], Grid::of($quarters)->blocks()));
    }

    /**
     * @return iterable<string, array{list<array<mixed>>, list<array<mixed>>}>
     */
    public static function sharedCases(): iterable
    {
        $json = file_get_contents(self::CASES);
        self::assertIsString($json);

        foreach (self::listAt(json_decode($json, true, flags: \JSON_THROW_ON_ERROR), 'cases') as $case) {
            yield self::stringAt($case, 'name') => [self::listAt($case, 'slots'), self::listAt($case, 'blocks')];
        }
    }

    public function testDesQuartsDHeureVoisinsIdentiquesFormentUnSeulBloc(): void
    {
        $daily = SlotContent::work('OPS-12', 'Daily');

        self::assertSame([['09:00', '09:45', 'OPS-12', 'Daily']], self::blocks(self::grid(['09:00' => $daily, '09:15' => $daily, '09:30' => $daily])));
    }

    public function testUnCommentaireDifferentCoupeLeBloc(): void
    {
        $grid = self::grid([
            '09:00' => SlotContent::work('SHOP-482', 'Mapping'),
            '09:15' => SlotContent::work('SHOP-482', 'Tests'),
            '09:30' => SlotContent::work('SHOP-482', null),
        ]);

        self::assertSame([
            ['09:00', '09:15', 'SHOP-482', 'Mapping'],
            ['09:15', '09:30', 'SHOP-482', 'Tests'],
            ['09:30', '09:45', 'SHOP-482', null],
        ], self::blocks($grid));
    }

    public function testUnTrouCoupeLeBloc(): void
    {
        $task = SlotContent::work('SHOP-482', null);

        self::assertSame([
            ['09:00', '09:15', 'SHOP-482', null],
            ['09:30', '09:45', 'SHOP-482', null],
        ], self::blocks(self::grid(['09:30' => $task, '09:00' => $task])));
    }

    public function testDesPausesVoisinesFormentUneSeulePause(): void
    {
        $grid = self::grid(['12:30' => SlotContent::pause(), '12:45' => SlotContent::pause(), '13:00' => SlotContent::work('OPS-7', null)]);

        self::assertSame([['12:30', '13:00', null, null], ['13:00', '13:15', 'OPS-7', null]], self::blocks($grid));
        self::assertSame(15, $grid->workedMinutes());
    }

    public function testLaGrilleVaDe0700A2000(): void
    {
        $grid = Grid::of([Quarter::FIRST => SlotContent::pause(), Quarter::DAY_END - Quarter::MINUTES => SlotContent::pause()]);
        self::assertCount(2, $grid->blocks());

        foreach ([Quarter::FIRST - Quarter::MINUTES, Quarter::DAY_END, 425] as $start) {
            try {
                Grid::of([$start => SlotContent::pause()]);
                self::fail(Quarter::format($start).' a été accepté.');
            } catch (\InvalidArgumentException) {
                self::addToAssertionCount(1);
            }
        }
    }

    /**
     * @param array<mixed> $slot
     */
    private static function content(array $slot): SlotContent
    {
        if ('pause' === self::stringAt($slot, 2)) {
            return SlotContent::pause();
        }
        $comment = self::at($slot, 4);
        self::assertTrue(null === $comment || \is_string($comment));

        return SlotContent::work(self::stringAt($slot, 3), $comment);
    }

    /**
     * @param array<string, SlotContent> $quarters
     */
    private static function grid(array $quarters): Grid
    {
        $byMinute = [];
        foreach ($quarters as $time => $content) {
            $start = Quarter::parse($time);
            self::assertNotNull($start);
            $byMinute[$start] = $content;
        }

        return Grid::of($byMinute);
    }

    /**
     * @return list<array{string, string, ?string, ?string}>
     */
    private static function blocks(Grid $grid): array
    {
        return array_map(static fn (Block $block): array => [
            Quarter::format($block->start),
            Quarter::format($block->end),
            $block->content->ticket,
            $block->content->comment,
        ], $grid->blocks());
    }
}
