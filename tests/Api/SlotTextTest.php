<?php

namespace App\Tests\Api;

use App\Api\Input\SlotChangeInput;
use App\Tests\Support\ReadsJson;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Ce que deviennent le ticket et le commentaire d'un créneau, sur les cas que le
 * navigateur rejoue aussi (tests/front/grid/grid.test.ts) : il les réécrit de même
 * avant de comparer un geste à la journée, sinon le même geste partirait deux fois.
 */
final class SlotTextTest extends TestCase
{
    use ReadsJson;

    private const string CASES = __DIR__.'/../cases/slot-text.json';

    /**
     * @param array<string, mixed> $expected
     */
    #[DataProvider('cases')]
    public function testLeTicketEtLeCommentaireSontReecritsCommeDansLeNavigateur(?string $ticket, ?string $comment, array $expected): void
    {
        $input = new SlotChangeInput('09:00', '09:15', SlotChangeInput::WORK, $ticket, $comment);

        self::assertSame($expected, ['ticket' => $input->ticket, 'comment' => $input->comment]);
    }

    /**
     * @return iterable<string, array{?string, ?string, array<string, mixed>}>
     */
    public static function cases(): iterable
    {
        $json = file_get_contents(self::CASES);
        self::assertIsString($json);

        foreach (self::listAt(json_decode($json, true, flags: \JSON_THROW_ON_ERROR), 'cases') as $case) {
            $ticket = self::at($case, 'ticket');
            $comment = self::at($case, 'comment');
            self::assertTrue(null === $ticket || \is_string($ticket));
            self::assertTrue(null === $comment || \is_string($comment));

            /** @var array<string, mixed> $expected */
            $expected = self::arrayAt($case, 'expected');

            yield self::stringAt($case, 'name') => [$ticket, $comment, $expected];
        }
    }
}
