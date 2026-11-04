<?php

namespace App\Sending;

/**
 * La journée n'a ni ticket à envoyer, ni heures que DayTrack aurait laissées dans
 * Jira : l'écran ne propose pas l'envoi, seul un onglet en retard le demande.
 */
final class NothingToSend extends \RuntimeException
{
}
