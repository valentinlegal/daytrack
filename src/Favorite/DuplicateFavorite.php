<?php

namespace App\Favorite;

/**
 * Le ticket est déjà dans les favoris : ajouté entre-temps dans un autre onglet, ou
 * deux fois de suite.
 */
final class DuplicateFavorite extends \RuntimeException
{
}
