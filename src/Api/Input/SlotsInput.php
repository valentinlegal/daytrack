<?php

namespace App\Api\Input;

use App\Day\Quarter;
use App\Day\SlotContent;
use App\Jira\TicketsExistInJira;
use App\Recurrence\UntilRewind;
use Symfony\Component\Uid\Uuid;
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
#[LinksMatchRecurrences]
final readonly class SlotsInput implements NamesTickets
{
    /**
     * @param list<SlotChangeInput>  $changes
     * @param list<UntilRewindInput> $recurrences les fins qu'annuler ou rétablir rendent aux récurrences
     * @param bool                   $restores    annuler : la journée d'avant revient, et une fois prévue que
     *                                            le geste annulé avait montrée lui cède au lieu de se détacher
     * @param list<string>           $detaches    rétablir : les récurrences dont l'annulation a rendu la fois à
     *                                            sa série sans l'écrire, et que le geste détache de nouveau
     */
    public function __construct(
        #[Assert\PositiveOrZero(message: 'Version invalide.')]
        public int $version,
        #[Assert\Count(max: Quarter::GRID_MINUTES / Quarter::MINUTES, maxMessage: 'Le geste change plus de créneaux que la grille n\'en a.')]
        #[Assert\Valid]
        public array $changes,
        #[Assert\Count(max: 2, maxMessage: 'Un geste change au plus deux récurrences.')]
        #[Assert\Valid]
        public array $recurrences = [],
        public bool $restores = false,
        #[Assert\Count(max: Quarter::GRID_MINUTES / Quarter::MINUTES, maxMessage: 'Le geste détache plus de fois que la grille n\'en a.')]
        #[Assert\All([new Assert\NotBlank(message: 'Récurrence inconnue.'), new Assert\Uuid(message: 'Récurrence inconnue.')])]
        public array $detaches = [],
    ) {
    }

    /**
     * Les récurrences dont rétablir détache de nouveau la fois de ce jour.
     *
     * @return list<Uuid>
     */
    public function detached(): array
    {
        return array_values(array_map(static fn (string $id): Uuid => Uuid::fromString($id), array_unique($this->detaches)));
    }

    /**
     * La récurrence qui pose chaque quart d'heure nommé, s'il en a une.
     *
     * @return array<int, Uuid>
     */
    public function links(): array
    {
        $links = [];
        foreach ($this->changes as $change) {
            if (null !== $change->recurrence && Uuid::isValid($change->recurrence)) {
                foreach ($change->quarters() as $start) {
                    $links[$start] = Uuid::fromString($change->recurrence);
                }
            }
        }

        return $links;
    }

    /**
     * @return list<UntilRewind>
     */
    public function rewinds(): array
    {
        return array_map(static fn (UntilRewindInput $rewind): UntilRewind => $rewind->rewind(), $this->recurrences);
    }

    /** Annuler un geste qui n'a changé que la fin d'une récurrence ne rend aucun créneau. */
    #[Assert\Callback]
    public function validateSomething(ExecutionContextInterface $context): void
    {
        if ([] === $this->changes && [] === $this->recurrences) {
            $context->buildViolation('Le geste ne change aucun créneau.')->atPath('changes')->addViolation();
        }
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
