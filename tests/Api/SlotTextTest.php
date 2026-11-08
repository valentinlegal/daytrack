<?php

namespace App\Tests\Api;

use App\Api\Input\EntryText;
use App\Api\Input\SlotChangeInput;
use App\Entity\Slot;
use App\Jira\JiraWorklog;
use App\Tests\Support\ReadsJson;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Validator\Validation;

/**
 * Ce que deviennent le ticket et le commentaire d'un créneau, sur les cas que le
 * navigateur rejoue aussi (tests/front/grid/grid.test.ts) : il les réécrit de même
 * avant de comparer un geste à la journée, sinon le même geste partirait deux fois.
 *
 * Et le commentaire envoyé se relit dans Jira tel qu'il est parti : la relecture de
 * l'envoi les compare à l'identique, et un écart dirait « Écart » à chaque envoi.
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

        // Un commentaire que la validation refuse ne part jamais.
        $refused = \count(Validation::createValidator()->validate($input->comment, EntryText::lineConstraints(Slot::COMMENT_MAX, 'Le commentaire'))) > 0;
        if (!$refused) {
            self::assertSame($input->comment, JiraWorklog::textOf(JiraWorklog::documentOf($input->comment)), 'Relu dans Jira, le commentaire est celui qui est parti.');
        }
    }

    public function testUnCommentaireSurPlusieursLignesDansJiraSeLitSurUneSeule(): void
    {
        $document = ['type' => 'doc', 'version' => 1, 'content' => [
            ['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => "Revue\u{200B} "]]],
            ['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => "du\ncode\u{00A0} "]]],
        ]];

        self::assertSame('Revue​ du code', JiraWorklog::textOf($document));
        self::assertNull(JiraWorklog::textOf(['type' => 'doc', 'version' => 1, 'content' => [['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => "\u{200B}\n "]]]]]));
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
