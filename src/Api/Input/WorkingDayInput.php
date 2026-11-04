<?php

namespace App\Api\Input;

/**
 * Un jour de la semaine allumé ou éteint : le jour est dans l'adresse.
 */
final readonly class WorkingDayInput
{
    public function __construct(
        public bool $worked,
    ) {
    }
}
