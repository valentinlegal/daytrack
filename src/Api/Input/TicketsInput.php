<?php

namespace App\Api\Input;

use Symfony\Component\Validator\Constraints as Assert;

/**
 * Les tickets dont l'écran veut le titre à jour : ceux de la journée affichée et des
 * favoris.
 */
final readonly class TicketsInput
{
    /**
     * @param list<string> $tickets
     */
    public function __construct(
        #[Assert\Count(max: 200, maxMessage: 'Trop de tickets à la fois.')]
        #[Assert\All([
            new Assert\Type('string'),
            new Assert\Regex(pattern: EntryText::TICKET_PATTERN, message: 'Un identifiant de ticket s\'écrit comme SHOP-482.'),
        ])]
        public array $tickets = [],
    ) {
    }
}
