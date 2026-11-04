<?php

namespace App\Jira;

/**
 * Pourquoi Jira n'a pas rendu ce qu'on lui demandait.
 */
enum JiraFailure: string
{
    /** Jira refuse l'e-mail ou le jeton : expiré, révoqué, mal collé. */
    case Refused = 'refused';
    /** Le jeton passe, mais il lui manque un périmètre pour cet appel. */
    case MissingScope = 'missing_scope';
    /** Jira ne répond pas, ou pas comme Jira : réseau, délai dépassé, panne, adresse fausse. */
    case Unreachable = 'unreachable';
    /** Jira dit que ce ticket n'existe pas, ou que ce compte ne peut pas le voir. */
    case NotFound = 'not_found';

    /** Un refus du jeton lui-même, que le bandeau doit dire : rien ne marchera tant qu'il dure. */
    public function isTokenRefusal(): bool
    {
        return self::Refused === $this || self::MissingScope === $this;
    }
}
