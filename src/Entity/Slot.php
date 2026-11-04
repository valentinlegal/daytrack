<?php

namespace App\Entity;

use App\Day\SlotContent;
use App\Day\SlotKind;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Uid\Uuid;

/**
 * Un quart d'heure occupé d'une journée : un ticket et son commentaire, ou une pause.
 *
 * La base refuse elle-même deux lignes sur le même quart d'heure du même jour :
 * aucune suite de gestes, aucun bug ne peut y laisser un double ou un chevauchement.
 */
#[ORM\Entity]
#[ORM\UniqueConstraint(name: 'slot_quarter', columns: ['day_id', 'start'])]
class Slot
{
    #[ORM\Id]
    #[ORM\Column(type: UuidType::NAME)]
    public private(set) Uuid $id;

    #[ORM\ManyToOne(inversedBy: 'slots')]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    public private(set) Day $day;

    /** Le début du quart d'heure, en minutes depuis minuit : 09:15 vaut 555. */
    #[ORM\Column(type: Types::SMALLINT)]
    public private(set) int $start;

    #[ORM\Column(length: 5, enumType: SlotKind::class)]
    public private(set) SlotKind $kind;

    #[ORM\Column(length: 50, nullable: true)]
    public private(set) ?string $ticket;

    #[ORM\Column(length: 500, nullable: true)]
    public private(set) ?string $comment;

    public function __construct(Day $day, int $start, SlotContent $content)
    {
        $this->id = Uuid::v7();
        $this->day = $day;
        $this->start = $start;
        $this->fill($content);
    }

    public function fill(SlotContent $content): void
    {
        $this->kind = $content->kind;
        $this->ticket = $content->ticket;
        $this->comment = $content->comment;
    }

    public function content(): SlotContent
    {
        return match ($this->kind) {
            SlotKind::Work => SlotContent::work(
                $this->ticket ?? throw new \UnexpectedValueException(\sprintf('Le créneau %s porte du travail sans ticket.', $this->id)),
                $this->comment,
            ),
            SlotKind::Pause => SlotContent::pause(),
        };
    }
}
