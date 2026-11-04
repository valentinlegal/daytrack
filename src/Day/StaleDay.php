<?php

namespace App\Day;

/**
 * Le geste part d'une version de la journée qui n'est plus la dernière : il vient
 * d'un onglet qui n'a pas vu ce qui s'est écrit depuis. Rien n'est écrit.
 */
final class StaleDay extends \RuntimeException
{
}
