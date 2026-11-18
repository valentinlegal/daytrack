<?php

namespace App\Tests\Day;

use App\Day\DayFigures;
use App\Day\Grid;
use App\Day\Quarter;
use App\Day\SlotContent;
use App\Tests\Support\ReadsJson;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Les chiffres du jour, sur les cas que le navigateur rejoue aussi.
 */
final class DayFiguresTest extends TestCase
{
    use ReadsJson;

    private const string CASES = __DIR__.'/../cases/day-figures.json';

    /**
     * @param list<array<mixed>>   $blocks
     * @param list<array<mixed>>   $planned
     * @param array<string, mixed> $expected
     */
    #[DataProvider('cases')]
    public function testLesChiffresDuJour(array $blocks, array $planned, int $objective, ?string $now, array $expected): void
    {
        $figures = DayFigures::of(self::grid($blocks)->withPlanned(self::planned($planned)), $objective, null === $now ? null : Quarter::parse($now));

        self::assertSame($expected, [
            'worked' => $figures->worked,
            'remaining' => $figures->remaining,
            'balance' => $figures->balance,
            'projectedEnd' => null === $figures->projectedEnd ? null : Quarter::format($figures->projectedEnd),
        ]);
    }

    /**
     * @return iterable<string, array{list<array<mixed>>, list<array<mixed>>, int, ?string, array<string, mixed>}>
     */
    public static function cases(): iterable
    {
        $json = file_get_contents(self::CASES);
        self::assertIsString($json);

        foreach (self::listAt(json_decode($json, true, flags: \JSON_THROW_ON_ERROR), 'cases') as $case) {
            $objective = self::at($case, 'objective');
            $now = self::at($case, 'now');
            self::assertIsInt($objective);
            self::assertTrue(null === $now || \is_string($now));

            /** @var array<string, mixed> $expected */
            $expected = self::arrayAt($case, 'expected');

            yield self::stringAt($case, 'name') => [self::listAt($case, 'blocks'), \array_key_exists('planned', $case) ? self::listAt($case, 'planned') : [], $objective, $now, $expected];
        }
    }

    /**
     * @param list<array<mixed>> $blocks
     */
    private static function grid(array $blocks): Grid
    {
        $quarters = [];
        foreach ($blocks as $block) {
            $start = Quarter::parse(self::stringAt($block, 0));
            $end = Quarter::parse(self::stringAt($block, 1));
            self::assertNotNull($start);
            self::assertNotNull($end);

            $content = 'pause' === self::stringAt($block, 2) ? SlotContent::pause() : SlotContent::work('SHOP-482', null);
            foreach (Quarter::between($start, $end) as $quarter) {
                $quarters[$quarter] = $content;
            }
        }

        return Grid::of($quarters);
    }

    /**
     * Les fois prévues, chacune d'une récurrence à part, dans l'ordre.
     *
     * @param list<array<mixed>> $planned
     *
     * @return list<array{SlotContent, int, int, string}>
     */
    private static function planned(array $planned): array
    {
        $occurrences = [];
        foreach ($planned as $index => $occurrence) {
            $start = Quarter::parse(self::stringAt($occurrence, 0));
            $end = Quarter::parse(self::stringAt($occurrence, 1));
            self::assertNotNull($start);
            self::assertNotNull($end);
            $content = 'pause' === self::stringAt($occurrence, 2) ? SlotContent::pause() : SlotContent::work('OPS-12', null);
            $occurrences[] = [$content, $start, $end, 'récurrence '.$index];
        }

        return $occurrences;
    }
}
