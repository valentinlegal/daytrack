<?php

namespace App\Sending;

use App\Jira\JiraFailure;

/**
 * Pourquoi un ticket n'est pas arrivé dans Jira tel que la journée le dit : ce que la
 * fenêtre du résultat écrit sous lui.
 */
enum TicketFailure: string
{
    /** Jira refuse les heures d'un ticket fermé. */
    case Closed = 'closed';
    /** Jira refuse les heures de ce ticket : suivi du temps désactivé, droit manquant. */
    case Rejected = 'rejected';
    /** Jira ne connaît pas ce ticket, ce compte ne le voit pas, ou son projet ne suit pas le temps. */
    case NotFound = 'not_found';
    /** Jira n'a pas répondu pour ce ticket. */
    case Unreachable = 'unreachable';
    /** Jira demande de ralentir, et n'a pas pris toutes les heures. */
    case Throttled = 'throttled';
    /** Jira a répondu sans erreur, mais la relecture n'y trouve pas les mêmes heures. */
    case Mismatch = 'mismatch';
    /** Jira a accepté ses écritures, puis n'a pas pu être relu : ses heures y sont peut-être. */
    case Unverified = 'unverified';
    /** Ses écritures sont restées sans réponse, et il n'a pas pu être relu : DayTrack n'en sait rien. */
    case Unanswered = 'unanswered';
    /** Jira a refusé le jeton avant que ses écritures partent. */
    case TokenRefused = 'token_refused';

    /** Ce que l'échec d'un appel à Jira dit d'un ticket : la seule traduction de l'un en l'autre. */
    public static function fromJira(JiraFailure $failure): self
    {
        return match ($failure) {
            JiraFailure::Refused, JiraFailure::MissingScope => self::TokenRefused,
            JiraFailure::NotFound => self::NotFound,
            JiraFailure::Unreachable => self::Unreachable,
        };
    }

    /** Ses heures sont peut-être dans Jira, sans qu'on ait pu le vérifier. */
    public function isUnverified(): bool
    {
        return self::Unverified === $this || self::Unanswered === $this;
    }
}
