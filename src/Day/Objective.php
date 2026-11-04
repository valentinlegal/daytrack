<?php

namespace App\Day;

/**
 * L'objectif d'une journée, en minutes.
 */
final class Objective
{
    /** 7h30, l'objectif habituel tant qu'il n'a pas été changé dans les réglages. */
    public const int HABITUAL = 450;

    /** 0h00 marque un jour de congé, en attendant que les congés se déclarent. */
    public const int MIN = 0;

    public const int MAX = Quarter::GRID_MINUTES;
}
