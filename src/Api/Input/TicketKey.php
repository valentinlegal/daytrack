<?php

namespace App\Api\Input;

use Symfony\Component\Validator\Constraints\Compound;

/**
 * Un identifiant de ticket, une fois réécrit : sa forme et sa longueur (EntryText).
 */
#[\Attribute(\Attribute::TARGET_PROPERTY | \Attribute::TARGET_METHOD | \Attribute::IS_REPEATABLE)]
final class TicketKey extends Compound
{
    protected function getConstraints(array $options): array
    {
        return EntryText::ticketConstraints();
    }
}
