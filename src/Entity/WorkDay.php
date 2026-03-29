<?php

declare(strict_types=1);

namespace App\Entity;

use App\Enum\EntryType;
use App\Repository\WorkDayRepository;
use DateTimeImmutable;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\IdGenerator\UuidGenerator;
use Symfony\Component\Uid\Uuid;

/**
 * Représente une journée de travail avec son objectif et son solde reporté.
 */
#[ORM\Entity(repositoryClass: WorkDayRepository::class)]
#[ORM\Table(name: 'work_day')]
class WorkDay
{
    #[ORM\Id]
    #[ORM\Column(type: 'uuid', unique: true)]
    #[ORM\GeneratedValue(strategy: 'CUSTOM')]
    #[ORM\CustomIdGenerator(class: UuidGenerator::class)]
    public private(set) ?Uuid $id = null;

    // Une seule entrée par date calendaire
    #[ORM\Column(type: Types::DATE_IMMUTABLE, unique: true)]
    public DateTimeImmutable $date;

    // Objectif journalier en minutes (450 = 7h30 par défaut)
    #[ORM\Column]
    public int $targetMinutes = 450;

    /** @var Collection<int, TimeEntry> */
    #[ORM\OneToMany(targetEntity: TimeEntry::class, mappedBy: 'workDay', cascade: ['persist', 'remove'], orphanRemoval: true)]
    #[ORM\OrderBy(['startedAt' => 'ASC'])]
    public private(set) Collection $entries;

    // Date et heure de la dernière synchronisation JIRA réussie (null = jamais synchronisé ou modifié depuis)
    #[ORM\Column(type: Types::DATETIME_IMMUTABLE, nullable: true)]
    public ?DateTimeImmutable $jiraSyncedAt = null;

    /**
     * Liste des clés de tickets synchronisés lors du dernier sync JIRA.
     * Permet de nettoyer JIRA même si la journée locale a été vidée entre deux syncs.
     *
     * @var string[]|null
     */
    #[ORM\Column(type: Types::JSON, nullable: true)]
    public ?array $jiraSyncedTickets = null;

    public function __construct(DateTimeImmutable $date)
    {
        $this->date = $date;
        $this->entries = new ArrayCollection();
    }

    public function addEntry(TimeEntry $entry): static
    {
        if (!$this->entries->contains($entry)) {
            $this->entries->add($entry);
            $entry->workDay = $this;
        }

        return $this;
    }

    public function removeEntry(TimeEntry $entry): static
    {
        $this->entries->removeElement($entry);

        return $this;
    }

    /**
     * Calcule le total des minutes travaillées (hors pauses) pour la journée.
     */
    public function getWorkedMinutes(): int
    {
        $total = 0;

        foreach ($this->entries as $entry) {
            if (EntryType::WORK === $entry->type && null !== $entry->endedAt) {
                $total += (int) (($entry->endedAt->getTimestamp() - $entry->startedAt->getTimestamp()) / 60);
            }
        }

        return $total;
    }

    /**
     * Delta par rapport à l'objectif en tenant compte du report (positif = en avance, négatif = en retard).
     */
    public function getBalanceMinutes(): int
    {
        return $this->getWorkedMinutes() - $this->targetMinutes;
    }
}
