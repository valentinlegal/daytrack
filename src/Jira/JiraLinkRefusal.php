<?php

namespace App\Jira;

/**
 * Pourquoi DayTrack refuse de tester une connexion sans même appeler Jira.
 */
enum JiraLinkRefusal: string
{
    /** Aucun jeton tapé, et aucun d'enregistré à reprendre. */
    case TokenMissing = 'token_missing';
    /** Aucun jeton tapé, et l'adresse n'est ni celle d'Atlassian ni celle d'avant : le jeton enregistré n'y part pas. */
    case TokenStaysHome = 'token_stays_home';
}
