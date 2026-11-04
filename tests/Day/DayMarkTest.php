<?php

namespace App\Tests\Day;

use App\Day\DayMark;
use App\Day\Grid;
use App\Day\Quarter;
use App\Day\SlotContent;
use App\Sending\SendState;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * La seule définition d'« incomplet », et la marque qui l'emporte sur l'état de l'envoi.
 */
final class DayMarkTest extends TestCase
{
    #[DataProvider('cases')]
    public function testLaMarqueDUnJour(string $grid, int $objective, bool $past, bool $working, bool $watched, SendState $send, ?DayMark $expected): void
    {
        self::assertSame($expected, DayMark::of(self::grid($grid), $objective, $past, $working, $watched, $send));
    }

    /**
     * @return iterable<string, array{string, int, bool, bool, bool, SendState, ?DayMark}>
     */
    public static function cases(): iterable
    {
        yield 'vide, passé, travaillé, après le point de départ : oublié' => ['', 450, true, true, true, SendState::Nothing, DayMark::Incomplete];
        yield 'vide, avant le point de départ : rien ne le distingue d\'un congé' => ['', 450, true, true, false, SendState::Nothing, null];
        yield 'commencé avant le point de départ, sous son objectif' => ['09:00-10:00', 450, true, true, false, SendState::Unsent, DayMark::Incomplete];
        yield 'une pause seule commence la journée' => ['pause 12:00-13:00', 450, true, true, false, SendState::Nothing, DayMark::Incomplete];
        yield 'objectif atteint : seulement non envoyé' => ['09:00-16:30', 450, true, true, true, SendState::Unsent, DayMark::Unsent];
        yield 'un quart d\'heure de trop ne manque rien' => ['09:00-16:45', 450, true, true, true, SendState::Sent, DayMark::Sent];
        yield 'un quart d\'heure de moins manque' => ['09:00-16:15', 450, true, true, true, SendState::Sent, DayMark::Incomplete];
        yield 'aujourd\'hui, vide' => ['', 450, false, true, true, SendState::Nothing, null];
        yield 'aujourd\'hui, sous son objectif' => ['09:00-10:00', 450, false, true, true, SendState::Unsent, DayMark::Unsent];
        yield 'samedi vide' => ['', 0, true, false, true, SendState::Nothing, null];
        yield 'samedi saisi : jamais incomplet' => ['09:00-10:00', 450, true, false, true, SendState::Unsent, DayMark::Unsent];
        yield 'mis à 0h00, vide' => ['', 0, true, true, true, SendState::Nothing, null];
        yield 'mis à 0h00, saisi quand même' => ['09:00-10:00', 0, true, true, true, SendState::Unsent, DayMark::Unsent];
        yield 'mis à 0h00, une pause seule' => ['pause 12:00-13:00', 0, true, true, true, SendState::Nothing, null];
        yield 'envoyé puis vidé : le losange l\'emporte sur « Modifié »' => ['', 450, true, true, true, SendState::Modified, DayMark::Incomplete];
        yield 'envoyé puis vidé avant le point de départ' => ['', 450, true, true, false, SendState::Modified, DayMark::Modified];
        yield 'mis à 0h00 après un envoi, puis vidé' => ['', 0, true, true, true, SendState::Modified, DayMark::Modified];
        yield 'un envoi en cours, partiel ou échoué reste à envoyer' => ['09:00-16:30', 450, true, true, true, SendState::Failed, DayMark::Unsent];
    }

    /**
     * « 09:00-10:00 » pour un ticket, « pause 12:00-13:00 » pour une pause, rien pour un jour vide.
     */
    private static function grid(string $block): Grid
    {
        if ('' === $block) {
            return Grid::empty();
        }

        $pause = str_starts_with($block, 'pause ');
        [$start, $end] = explode('-', $pause ? substr($block, 6) : $block);
        $from = Quarter::parse($start) ?? throw new \LogicException($start);
        $to = Quarter::parse($end) ?? throw new \LogicException($end);
        $content = $pause ? SlotContent::pause() : SlotContent::work('SHOP-482', null);

        return Grid::of(array_fill_keys(Quarter::between($from, $to), $content));
    }
}
