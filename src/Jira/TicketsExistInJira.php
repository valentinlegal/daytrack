<?php

namespace App\Jira;

use Symfony\Component\Validator\Constraint;

/**
 * Les tickets d'une écriture existent dans Jira : le serveur le vérifie lui-même,
 * même quand l'écran l'a déjà fait. Jira muet ou jeton refusé, ils passent sans titre
 * et seront vérifiés à l'envoi.
 *
 * Elle se pose dans le groupe « Jira », après les autres règles : une forme refusée
 * ne part pas jusqu'à Jira.
 */
#[\Attribute(\Attribute::TARGET_CLASS)]
final class TicketsExistInJira extends Constraint
{
    public const string GROUP = 'Jira';

    public string $message = 'Ticket introuvable dans Jira. Vérifiez l\'identifiant.';

    /**
     * @param bool $describedOnly un ticket que Jira n'a jamais décrit et que plus rien ne
     *                            porte se redemande (TicketBook::verify)
     */
    public function __construct(mixed $options = null, ?array $groups = [self::GROUP], mixed $payload = null, public bool $describedOnly = false)
    {
        parent::__construct($options, $groups, $payload);
    }

    public function getTargets(): string
    {
        return self::CLASS_CONSTRAINT;
    }
}
