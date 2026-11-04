<?php

namespace App\Jira;

use Symfony\Component\Validator\Constraint;

/**
 * Jira accepte la connexion telle qu'elle a été tapée. Elle ne se pose sur aucune
 * classe : seul JiraController la juge, en appelant Jira, et dit son refus sous le
 * champ qu'il concerne, comme toute règle.
 */
final class JiraAcceptsConnection extends Constraint
{
}
