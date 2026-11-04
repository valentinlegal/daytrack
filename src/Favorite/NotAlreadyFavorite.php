<?php

namespace App\Favorite;

use Symfony\Component\Validator\Constraint;

/**
 * Un ticket n'est qu'une fois dans les favoris.
 */
#[\Attribute(\Attribute::TARGET_PROPERTY)]
final class NotAlreadyFavorite extends Constraint
{
    public string $message = '{{ ticket }} est déjà dans vos favoris.';
}
