<?php

namespace App\Entity;

use App\Api\Input\EntryText;
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
    public const int COMMENT_MAX = 500;

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

    #[ORM\Column(length: EntryText::TICKET_MAX, nullable: true)]
    public private(set) ?string $ticket;

    #[ORM\Column(length: self::COMMENT_MAX, nullable: true)]
    public private(set) ?string $comment;

    /**
     * La récurrence qui l'a posé, tant qu'aucun geste ne l'en a détaché : la flèche du
     * bloc, et ce que « les suivantes » retrouvent. Une récurrence n'est jamais effacée,
     * mais la base le laisserait sans lien plutôt que de refuser.
     */
    #[ORM\ManyToOne]
    #[ORM\JoinColumn(nullable: true, onDelete: 'SET NULL')]
    public private(set) ?Recurrence $recurrence = null;

    public function __construct(Day $day, int $start, SlotContent $content, ?Recurrence $recurrence = null)
    {
        $this->id = Uuid::v7();
        $this->day = $day;
        $this->start = $start;
        $this->fill($content, $recurrence);
    }

    /** Un contenu, et la récurrence qui le pose ; null pour une saisie ordinaire. */
    public function fill(SlotContent $content, ?Recurrence $recurrence = null): void
    {
        $this->kind = $content->kind;
        $this->ticket = $content->ticket;
        $this->comment = $content->comment;
        $this->recurrence = $recurrence;
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
