<?php

namespace App\Sending;

/**
 * DayTrack n'est relié à aucun Jira : il n'y a nulle part où envoyer. L'écran ne
 * propose pas l'envoi avant la liaison, seul un appel direct le demande.
 */
final class NotLinked extends \RuntimeException
{
}
