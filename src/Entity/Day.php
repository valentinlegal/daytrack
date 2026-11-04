<?php

namespace App\Entity;

use App\Day\Grid;
use App\Day\SlotContent;
use App\Repository\DayRepository;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Uid\Uuid;

/**
 * Une journée qui a reçu au moins une écriture : une saisie, ou son objectif.
 *
 * Un jour qu'on ne fait que parcourir n'a pas de ligne : il se lit vide, avec
 * l'objectif habituel. Une journée vide dont on n'a pas choisi l'objectif — une saisie
 * posée puis effacée, ou annulée — le suit de même : elle n'est pas encore saisie.
 */
#[ORM\Entity(repositoryClass: DayRepository::class)]
class Day
{
    #[ORM\Id]
    #[ORM\Column(type: UuidType::NAME)]
    public private(set) Uuid $id;

    /** À minuit, en heure universelle : seule la date compte. */
    #[ORM\Column(type: Types::DATE_IMMUTABLE, unique: true)]
    public private(set) \DateTimeImmutable $date;

    /** En minutes, au quart d'heure, de 0h00 à 13h00. */
    #[ORM\Column(type: Types::SMALLINT)]
    public int $objective;

    /** Son objectif a été choisi pour elle, dans la fenêtre Objectif du jour : il tient même vide. */
    #[ORM\Column(options: ['default' => false])]
    public private(set) bool $objectiveChosen = false;

    /**
     * Le nombre d'écritures reçues. Une écriture qui part d'une version plus
     * ancienne vient d'un onglet qui n'a pas vu la dernière : elle se refuse. Seul
     * DayRepository::claim() l'avance, dans la base.
     */
    #[ORM\Column]
    public private(set) int $version = 1;

    /** @var Collection<int, Slot> */
    #[ORM\OneToMany(targetEntity: Slot::class, mappedBy: 'day', cascade: ['persist'], orphanRemoval: true)]
    #[ORM\OrderBy(['start' => \SortDirection::Ascending])]
    private Collection $slots;

    public function __construct(\DateTimeImmutable $date, int $objective)
    {
        $this->id = Uuid::v7();
        $this->date = $date;
        $this->objective = $objective;
        $this->slots = new ArrayCollection();
    }

    /** L'objectif de ce jour-là, qui ne suit plus l'objectif habituel. */
    public function chooseObjective(int $objective): void
    {
        $this->objective = $objective;
        $this->objectiveChosen = true;
    }

    /** Remise à l'objectif habituel : vide, elle le suit de nouveau, comme un jour jamais touché. */
    public function returnToHabitual(int $habitual): void
    {
        $this->objective = $habitual;
        $this->objectiveChosen = false;
    }

    /** Ni saisie ni objectif choisi : elle suit l'objectif habituel, comme un jour sans ligne. */
    public function followsHabitual(): bool
    {
        return !$this->objectiveChosen && $this->slots->isEmpty();
    }

    /**
     * Son objectif a été mis à 0h00 pour lui, dans la fenêtre Objectif du jour : il se
     * déclare non travaillé, comme un jour de congé. Un objectif habituel à 0h00 n'en
     * déclare aucun.
     */
    public function isDeclaredOff(): bool
    {
        return $this->objectiveChosen && 0 === $this->objective;
    }

    /** Son objectif, ou l'habituel tant qu'elle le suit. Un jour non travaillé n'en a aucun (DayReader). */
    public function objectiveFollowing(int $habitual): int
    {
        return $this->followsHabitual() ? $habitual : $this->objective;
    }

    public function grid(): Grid
    {
        $quarters = [];
        foreach ($this->slots as $slot) {
            $quarters[$slot->start] = $slot->content();
        }

        return Grid::of($quarters);
    }

    /**
     * Chaque quart d'heure nommé prend son nouveau contenu, ou se vide sur null.
     *
     * Un quart d'heure déjà occupé garde sa ligne, qui change de contenu : effacer
     * puis recréer la même ligne dans une écriture ferait passer l'ajout avant la
     * suppression, Doctrine les ordonnant ainsi, et la base le refuserait.
     *
     * @param array<int, ?SlotContent> $changes
     */
    public function change(array $changes): void
    {
        $slots = [];
        foreach ($this->slots as $slot) {
            $slots[$slot->start] = $slot;
        }

        foreach ($changes as $start => $content) {
            $slot = $slots[$start] ?? null;
            if (null === $content) {
                if (null !== $slot) {
                    $this->slots->removeElement($slot);
                }
            } elseif (null !== $slot) {
                $slot->fill($content);
            } else {
                $this->slots->add(new Slot($this, $start, $content));
            }
        }
    }
}
