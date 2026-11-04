<?php

namespace App\Sending;

/**
 * Un envoi de cette journée est déjà en cours, parti d'un autre onglet : le second
 * n'écrit rien, il attend le résultat du premier.
 */
final class AlreadySending extends \RuntimeException
{
}
