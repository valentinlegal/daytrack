<?php

namespace App\Jira;

/**
 * Ce qu'une écriture d'heures a donné.
 */
enum WriteOutcome
{
    case Done;
    /** Sans réponse, ou une panne de Jira : elle a pu passer. On relit avant toute suite. */
    case Unknown;
    /** Jira la refuse pour ce ticket : fermé, sans suivi du temps, sans droit. */
    case Rejected;
    /** Jira ne connaît pas ce ticket, ou ce compte ne le voit pas. */
    case NotFound;
    /** Jira demande encore de ralentir, après plusieurs attentes. */
    case Throttled;
    /** Jira refuse le jeton : plus rien ne passera. */
    case Refused;
    case MissingScope;

    public function failure(): ?JiraFailure
    {
        return match ($this) {
            self::Refused => JiraFailure::Refused,
            self::MissingScope => JiraFailure::MissingScope,
            default => null,
        };
    }
}
