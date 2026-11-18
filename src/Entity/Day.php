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
     * DayRepository::advance() l'avance, dans la base.
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
        $links = [];
        foreach ($this->slots as $slot) {
            $quarters[$slot->start] = $slot->content();
            if (null !== $slot->recurrence) {
                $links[$slot->start] = $slot->recurrence->id->toRfc4122();
            }
        }

        return Grid::of($quarters, $links);
    }

    /**
     * Les quarts d'heure que cette récurrence a posés ce jour-là, et qui lui sont restés.
     *
     * @return list<int>
     */
    public function quartersOf(Recurrence $recurrence): array
    {
        $quarters = [];
        foreach ($this->slots as $slot) {
            if ($slot->recurrence === $recurrence) {
                $quarters[] = $slot->start;
            }
        }

        return $quarters;
    }

    /** Ce quart d'heure est déjà saisi. */
    public function holds(int $start): bool
    {
        return $this->slots->exists(static fn (int $key, Slot $slot): bool => $slot->start === $start);
    }

    /** Aucun quart d'heure saisi, pause comprise. */
    public function isEmpty(): bool
    {
        return $this->slots->isEmpty();
    }

    /** Ce quart d'heure est saisi, et posé par cette récurrence. */
    public function isLinked(int $start, Recurrence $recurrence): bool
    {
        return $this->slots->exists(static fn (int $key, Slot $slot): bool => $slot->start === $start && $slot->recurrence === $recurrence);
    }

    /**
     * La récurrence de chaque quart d'heure qu'une récurrence a posé, par son début.
     *
     * @return array<int, Recurrence>
     */
    public function linkedQuarters(): array
    {
        $linked = [];
        foreach ($this->slots as $slot) {
            if (null !== $slot->recurrence) {
                $linked[$slot->start] = $slot->recurrence;
            }
        }

        return $linked;
    }

    /**
     * Chaque quart d'heure nommé prend son nouveau contenu, ou se vide sur null, posé par
     * la récurrence que $links lui donne, ou à la main.
     *
     * Une fois d'une récurrence ne se détache qu'en entier : un geste qui touche un de ses
     * quarts d'heure sans le lui laisser — l'effacer, coller par-dessus, le remplacer, le
     * convertir en pause — détache aussi les autres, qui gardent leur contenu sans flèche.
     * Le navigateur le prévoit avec la même règle (assets/grid/recurrence.ts, detach).
     *
     * Un quart d'heure déjà occupé garde sa ligne, qui change de contenu : effacer
     * puis recréer la même ligne dans une écriture ferait passer l'ajout avant la
     * suppression, Doctrine les ordonnant ainsi, et la base le refuserait.
     *
     * @param array<int, ?SlotContent> $changes
     * @param array<int, Recurrence>   $links   la récurrence de chaque quart d'heure qu'elle pose, parmi $changes
     *
     * @return list<Recurrence> les récurrences dont ce geste a détaché la fois de ce jour-là
     */
    public function change(array $changes, array $links = []): array
    {
        $slots = [];
        foreach ($this->slots as $slot) {
            $slots[$slot->start] = $slot;
        }

        $detached = [];
        foreach ($changes as $start => $content) {
            $before = ($slots[$start] ?? null)?->recurrence;
            if (null !== $before && ($links[$start] ?? null) !== $before) {
                $detached[spl_object_id($before)] = $before;
            }
        }

        foreach ($changes as $start => $content) {
            $slot = $slots[$start] ?? null;
            $recurrence = null === $content ? null : $links[$start] ?? null;
            if (null === $content) {
                if (null !== $slot) {
                    $this->slots->removeElement($slot);
                }
            } elseif (null !== $slot) {
                $slot->fill($content, $recurrence);
            } else {
                $this->slots->add(new Slot($this, $start, $content, $recurrence));
            }
        }

        foreach ($this->slots as $slot) {
            if (null !== $slot->recurrence && isset($detached[spl_object_id($slot->recurrence)]) && !\array_key_exists($slot->start, $changes)) {
                $slot->fill($slot->content());
            }
        }

        return array_values($detached);
    }
}
