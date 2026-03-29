<?php

declare(strict_types=1);

namespace App\Entity;

use App\Enum\EntryType;
use App\Repository\TimeEntryRepository;
use DateTimeImmutable;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\IdGenerator\UuidGenerator;
use Symfony\Component\Uid\Uuid;

/**
 * Représente un bloc de temps assigné à un ticket ou marqué comme pause.
 */
#[ORM\Entity(repositoryClass: TimeEntryRepository::class)]
#[ORM\Table(name: 'time_entry')]
class TimeEntry
{
    #[ORM\Id]
    #[ORM\Column(type: 'uuid', unique: true)]
    #[ORM\GeneratedValue(strategy: 'CUSTOM')]
    #[ORM\CustomIdGenerator(class: UuidGenerator::class)]
    public private(set) ?Uuid $id = null;

    #[ORM\ManyToOne(targetEntity: WorkDay::class, inversedBy: 'entries')]
    #[ORM\JoinColumn(nullable: false)]
    public WorkDay $workDay;

    // Référence du ticket (ex : PROJ-123) — null si type = BREAK
    #[ORM\Column(length: 50, nullable: true)]
    public ?string $ticketKey = null {
        // Normalise la clé en majuscules sans espaces superflus
        set(?string $value) => $this->ticketKey = $value !== null ? strtoupper(trim($value)) : null;
    }

    #[ORM\Column(length: 500, nullable: true)]
    public ?string $comment = null;

    #[ORM\Column(type: Types::DATETIME_IMMUTABLE)]
    public DateTimeImmutable $startedAt;

    // Null si l'entrée est toujours en cours
    #[ORM\Column(type: Types::DATETIME_IMMUTABLE, nullable: true)]
    public ?DateTimeImmutable $endedAt = null;

    #[ORM\Column(type: 'string', length: 10, enumType: EntryType::class)]
    public EntryType $type;

    public function __construct(WorkDay $workDay, DateTimeImmutable $startedAt, EntryType $type)
    {
        $this->workDay = $workDay;
        $this->startedAt = $startedAt;
        $this->type = $type;
    }

    /**
     * Durée en minutes — null si l'entrée est toujours en cours.
     */
    public function getDurationMinutes(): ?int
    {
        if ($this->endedAt === null) {
            return null;
        }

        return (int) (($this->endedAt->getTimestamp() - $this->startedAt->getTimestamp()) / 60);
    }
}
