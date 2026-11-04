<?php

namespace App\Day;

/**
 * Un objectif posé sur un jour que les réglages ne travaillent pas : il n'en a pas.
 * L'écran n'en propose pas, seul un onglet resté ouvert sur l'ancien réglage l'envoie.
 */
final class NonWorkingDay extends \RuntimeException
{
}
