<?php

namespace App\Api;

use Symfony\Component\HttpKernel\Exception\UnprocessableEntityHttpException;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintViolation;
use Symfony\Component\Validator\ConstraintViolationList;
use Symfony\Component\Validator\Exception\ValidationFailedException;

/**
 * Un refus que seul le serveur peut juger — un jour non travaillé, un favori ajouté
 * entre-temps ailleurs, une connexion que Jira refuse —, dit comme ceux de la
 * validation : 422, et le message sous le champ qu'il concerne (ApiErrorListener).
 */
final class FieldRefusal
{
    /**
     * @param string                $message    son modèle, avec ses paramètres : « {{ ticket }} est déjà dans vos favoris. »
     * @param array<string, string> $parameters
     */
    public static function under(object $input, string $field, Constraint $constraint, string $message, array $parameters = [], mixed $invalidValue = null): UnprocessableEntityHttpException
    {
        $violation = new ConstraintViolation(strtr($message, $parameters), $message, $parameters, $input, $field, $invalidValue, constraint: $constraint);

        return new UnprocessableEntityHttpException(previous: new ValidationFailedException($input, new ConstraintViolationList([$violation])));
    }
}
