<?php

namespace App\Api\Input;

use App\Favorite\NotAlreadyFavorite;
use App\Jira\TicketsExistInJira;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\Constraints as Assert;
use Symfony\Component\Validator\Context\ExecutionContextInterface;

/**
 * Un favori ajouté : par son identifiant tapé, depuis un bloc de la grille, ou remis
 * à sa place après avoir été retiré. Son ticket se vérifie dans Jira une fois tout le
 * reste juste.
 */
#[Assert\GroupSequence(['FavoriteInput', TicketsExistInJira::GROUP])]
#[TicketsExistInJira(describedOnly: true)]
final readonly class FavoriteInput implements NamesTickets
{
    #[NotAlreadyFavorite]
    public ?string $ticket;

    public ?string $name;

    public function __construct(
        ?string $ticket = null,
        ?string $name = null,
        /** Sa place, 0 en haut, où s'ouvre le formulaire d'ajout. */
        #[Assert\PositiveOrZero(message: 'Une place dans la liste commence à 0.')]
        public int $position = 0,
    ) {
        $this->ticket = EntryText::ticket($ticket);
        $this->name = EntryText::line($name);
    }

    #[Assert\Callback]
    public function validateText(ExecutionContextInterface $context): void
    {
        if (null === $this->ticket) {
            $context->buildViolation('Indiquez un ticket.')->atPath('ticket')->addViolation();
        }
        // Ces règles n'appartiennent à aucune classe : nommer leur groupe les fait jouer
        // pendant celui de FavoriteInput, que la séquence de la classe met en premier.
        $validator = $context->getValidator()->inContext($context);
        $validator->atPath('ticket')->validate($this->ticket, EntryText::ticketConstraints(), Constraint::DEFAULT_GROUP);
        $validator->atPath('name')->validate($this->name, FavoriteNameInput::constraints(), Constraint::DEFAULT_GROUP);
    }

    public function namedTickets(): array
    {
        return null === $this->ticket ? [] : ['ticket' => $this->ticket];
    }

    public function ticket(): string
    {
        return $this->ticket ?? throw new \LogicException('Un favori sans ticket a passé la validation.');
    }
}
