<?php

namespace App\Api\Input;

use App\Settings\Tint;

/**
 * La teinte choisie pour un type de ticket, parmi les douze : une autre valeur est
 * refusée comme une valeur de travers.
 */
final readonly class TintInput
{
    public function __construct(
        public Tint $color,
    ) {
    }
}
