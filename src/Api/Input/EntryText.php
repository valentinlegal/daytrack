<?php

namespace App\Api\Input;

use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * Ce que deviennent un ticket et un texte d'une ligne tapés par l'utilisateur, dans une
 * saisie comme dans un favori. Le navigateur les réécrit de même (assets/grid/grid.ts),
 * sur les cas de tests/cases/slot-text.json : un écart ferait partir deux fois le même
 * geste.
 */
final class EntryText
{
    public const int TICKET_MAX = 50;

    /** La forme d'un identifiant de ticket Jira, une fois réécrit : SHOP-482. */
    public const string TICKET_PATTERN = '/^[A-Z][A-Z0-9_]+-[1-9][0-9]*$/D';

    /** Comme dans Jira, où « shop-482 » mène au ticket SHOP-482. */
    public static function ticket(?string $ticket): ?string
    {
        return self::trimmed(null === $ticket ? null : strtoupper($ticket));
    }

    /**
     * Une espace insécable se tape sans la voir (Alt+Espace sur un Mac), et deux
     * espaces s'affichent comme une : deux textes qui se lisent pareil doivent être le
     * même, sinon ils coupent le bloc en deux.
     */
    public static function line(?string $text): ?string
    {
        return self::trimmed(null === $text ? null : preg_replace('/\p{Zs}+/u', ' ', $text) ?? $text);
    }

    /**
     * La forme d'un identifiant de ticket, une fois réécrit.
     *
     * @return list<Constraint>
     */
    public static function ticketConstraints(): array
    {
        return [
            new Assert\Length(max: self::TICKET_MAX, maxMessage: 'Un identifiant de ticket tient en 50 caractères.'),
            new Assert\Regex(pattern: self::TICKET_PATTERN, message: 'Un identifiant de ticket s\'écrit comme SHOP-482.'),
        ];
    }

    /**
     * Un texte d'une seule ligne : le bloc et la liste le montrent ainsi.
     *
     * @param positive-int $max
     *
     * @return list<Constraint>
     */
    public static function lineConstraints(int $max, string $maxMessage, string $lineMessage): array
    {
        return [
            new Assert\Length(max: $max, maxMessage: $maxMessage),
            new Assert\Regex(pattern: '/^[^\p{Cc}\p{Zl}\p{Zp}]*$/uD', message: $lineMessage),
        ];
    }

    /**
     * Un texte sans ce qui l'entoure d'invisible — espaces de toute sorte, sauts de
     * ligne, caractères de mise en forme —, ou null s'il n'en reste rien.
     */
    private static function trimmed(?string $value): ?string
    {
        if (null === $value) {
            return null;
        }
        $value = preg_replace('/^[\p{Z}\p{Cc}\p{Cf}]+|[\p{Z}\p{Cc}\p{Cf}]+$/uD', '', $value) ?? $value;

        return '' === $value ? null : $value;
    }
}
