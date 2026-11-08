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

    /** La forme d'un identifiant de ticket Jira, une fois réécrit : SHOP-482. Telle quelle dans l'exigence d'une route. */
    public const string TICKET_SHAPE = '[A-Z][A-Z0-9_]+-[1-9][0-9]*';

    public const string TICKET_PATTERN = '/^'.self::TICKET_SHAPE.'$/D';

    /** Comme dans Jira, où « shop-482 » mène au ticket SHOP-482. */
    public static function ticket(?string $ticket): ?string
    {
        return self::trimmed(null === $ticket ? null : strtoupper($ticket));
    }

    /**
     * Une espace insécable se tape sans la voir (Alt+Espace sur un Mac), et deux
     * espaces s'affichent comme une : deux textes qui se lisent pareil doivent être le
     * même, sinon ils coupent le bloc en deux. Le commentaire que Jira rend se nettoie
     * de même (JiraWorklog::textOf()).
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
            new Assert\Length(max: self::TICKET_MAX, maxMessage: self::fitsIn('Un identifiant de ticket', self::TICKET_MAX)),
            new Assert\Regex(pattern: self::TICKET_PATTERN, message: 'Un identifiant de ticket s\'écrit comme SHOP-482.'),
        ];
    }

    /**
     * Un texte d'une seule ligne : le bloc et la liste le montrent ainsi.
     *
     * @param positive-int $max
     * @param string       $subject ce que les refus nomment : « Le commentaire »
     *
     * @return list<Constraint>
     */
    public static function lineConstraints(int $max, string $subject): array
    {
        return [
            new Assert\Length(max: $max, maxMessage: self::fitsIn($subject, $max)),
            new Assert\Regex(pattern: '/^[^\p{Cc}\p{Zl}\p{Zp}]*$/uD', message: $subject.' tient sur une ligne.'),
        ];
    }

    /** Le refus d'un texte trop long, qui dit sa limite : « Le nom tient en 255 caractères. » */
    public static function fitsIn(string $subject, int $max): string
    {
        return \sprintf('%s tient en %d caractères.', $subject, $max);
    }

    /**
     * Un texte sans ce qui l'entoure d'invisible — espaces de toute sorte, sauts de
     * ligne, caractères de mise en forme —, ou null s'il n'en reste rien. L'adresse de
     * Jira et l'e-mail se nettoient de même (JiraConnectionInput).
     */
    public static function trimmed(?string $value): ?string
    {
        if (null === $value) {
            return null;
        }
        $value = preg_replace('/^[\p{Z}\p{Cc}\p{Cf}]+|[\p{Z}\p{Cc}\p{Cf}]+$/uD', '', $value) ?? $value;

        return '' === $value ? null : $value;
    }
}
