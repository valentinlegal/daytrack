<?php

namespace App\Api\Input;

use App\Day\Quarter;
use App\Day\SlotContent;
use App\Jira\TicketsExistInJira;
use Symfony\Component\Validator\Constraints as Assert;
use Symfony\Component\Validator\Context\ExecutionContextInterface;

/**
 * Un geste sur la grille : les créneaux qu'il change, et la version de la journée
 * qu'il a vue.
 *
 * Poser, remplacer en superposant, coller par-dessus, effacer, convertir en pause,
 * annuler, rétablir : tout geste s'écrit ainsi. Ses tickets se vérifient dans Jira
 * une fois tout le reste juste.
 */
#[Assert\GroupSequence(['SlotsInput', TicketsExistInJira::GROUP])]
#[TicketsExistInJira]
final readonly class SlotsInput implements NamesTickets
{
    /**
     * @param list<SlotChangeInput> $changes
     */
    public function __construct(
        #[Assert\PositiveOrZero(message: 'Version invalide.')]
        public int $version,
        #[Assert\Count(min: 1, max: Quarter::GRID_MINUTES / Quarter::MINUTES, minMessage: 'Le geste ne change aucun créneau.', maxMessage: 'Le geste change plus de créneaux que la grille n\'en a.')]
        #[Assert\Valid]
        public array $changes,
    ) {
    }

    #[Assert\Callback]
    public function validateOverlap(ExecutionContextInterface $context): void
    {
        $seen = [];
        foreach ($this->changes as $index => $change) {
            foreach ($change->quarters() as $start) {
                if (isset($seen[$start])) {
                    $context->buildViolation('Deux créneaux du geste couvrent le même quart d\'heure.')
                        ->atPath(\sprintf('changes[%d]', $index))
                        ->addViolation();

                    break;
                }
                $seen[$start] = true;
            }
        }
    }

    public function namedTickets(): array
    {
        $tickets = [];
        foreach ($this->changes as $index => $change) {
            if (SlotChangeInput::WORK === $change->kind && null !== $change->ticket) {
                $tickets[\sprintf('changes[%d].ticket', $index)] = $change->ticket;
            }
        }

        return $tickets;
    }

    /**
     * Chaque quart d'heure que le geste nomme, par son début, et ce qu'il devient.
     *
     * @return array<int, ?SlotContent>
     */
    public function quarters(): array
    {
        $quarters = [];
        foreach ($this->changes as $change) {
            $content = $change->content();
            foreach ($change->quarters() as $start) {
                $quarters[$start] = $content;
            }
        }

        return $quarters;
    }
}
