<?php

namespace App\Day;

/**
 * Ce que porte un créneau : du travail sur un ticket, ou une pause, qui n'entre
 * jamais dans le temps travaillé.
 */
enum SlotKind: string
{
    case Work = 'work';
    case Pause = 'pause';
}
