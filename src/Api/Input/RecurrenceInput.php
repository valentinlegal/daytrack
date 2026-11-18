<?php

namespace App\Api\Input;

use App\Day\Quarter;
use App\Day\SlotContent;
use App\Jira\TicketsExistInJira;
use App\Recurrence\RecurrenceSpec;
use App\Recurrence\SeenRecurrence;
use Symfony\Component\Uid\Uuid;
use Symfony\Component\Validator\Constraints as Assert;
use Symfony\Component\Validator\Context\ExecutionContextInterface;

/**
 * « Enregistrer » dans la fenêtre d'un ticket ou d'une pause, avec sa case « Récurrence » :
 * ce que la fenêtre écrit sur le bloc, la récurrence qu'elle règle — null pour la case
 * décochée —, et celle que le bloc portait, s'il en portait une, telle que la fenêtre l'a vue.
 * Une récurrence coupée qu'on colle nomme aussi celle dont elle vient (`follows`).
 */
#[Assert\GroupSequence(['RecurrenceInput', TicketsExistInJira::GROUP])]
#[TicketsExistInJira]
final readonly class RecurrenceInput implements NamesTickets
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
        #[Assert\Valid]
        public ?RecurrenceRuleInput $recurrence,
        #[Assert\Valid]
        public ?ReplacedRecurrenceInput $replaces = null,
        // Uuid laisse passer un texte vide.
        #[Assert\NotBlank(message: 'Récurrence inconnue.', allowNull: true)]
        #[Assert\Uuid(message: 'Récurrence inconnue.')]
        public ?string $follows = null,
    ) {
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
     * Chaque quart d'heure que la fenêtre écrit, par son début, et ce qu'il devient. Un
     * créneau ne s'y relie jamais lui-même : c'est la récurrence réglée qui le pose.
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

    public function spec(): ?RecurrenceSpec
    {
        return $this->recurrence?->spec();
    }

    public function replaced(): ?SeenRecurrence
    {
        return $this->replaces?->seen();
    }

    /** La récurrence coupée dont vient celle qu'on colle, une fois la validation passée. */
    public function followed(): ?Uuid
    {
        return null === $this->follows ? null : Uuid::fromString($this->follows);
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

    #[Assert\IsTrue(message: 'Un créneau de la fenêtre ne porte pas de récurrence : c\'est elle qui le pose.')]
    public function isUnlinked(): bool
    {
        return [] === array_filter($this->changes, static fn (SlotChangeInput $change): bool => null !== $change->recurrence);
    }
}
