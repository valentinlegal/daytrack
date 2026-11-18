<?php

namespace App\Entity;

use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Uid\Uuid;

/**
 * Une fois d'une récurrence détachée ou effacée — « cette fois seulement » — : rien ne la
 * repose ni ne la prévoit plus. Annuler le geste la rend, et la retire.
 *
 * Retenue (held), c'est une fois que la journée mise à 0h00 a retirée : revenir à un
 * objectif la rend, quand une fois détachée ne revient jamais. Annuler sur une journée à 0h00
 * ne la ramène pas : détachée, elle y devient retenue, comme si le 0h00 l'avait retirée ; et
 * rétablir la détache de nouveau.
 *
 * Coupée au même rythme, une récurrence donne les siennes d'après la coupe à celle qui la suit,
 * telles quelles, et les garde : annuler la coupe les retrouve.
 */
#[ORM\Entity]
#[ORM\UniqueConstraint(name: 'recurrence_skip_day', columns: ['recurrence_id', 'date'])]
class RecurrenceSkip
{
    #[ORM\Id]
    #[ORM\Column(type: UuidType::NAME)]
    public private(set) Uuid $id;

    #[ORM\ManyToOne]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    public private(set) Recurrence $recurrence;

    #[ORM\Column(type: Types::DATE_IMMUTABLE)]
    public private(set) \DateTimeImmutable $date;

    #[ORM\Column(options: ['default' => false])]
    public private(set) bool $held;

    public function __construct(Recurrence $recurrence, \DateTimeImmutable $date, bool $held = false)
    {
        $this->id = Uuid::v7();
        $this->recurrence = $recurrence;
        $this->date = $date;
        $this->held = $held;
    }

    /** Annuler ou rétablir la rend à sa récurrence sur une journée à 0h00 : elle n'est plus détachée, mais retenue. */
    public function hold(): void
    {
        $this->held = true;
    }

    /** Rétablir refait le geste qui l'avait détachée : retenue, elle redevient détachée. */
    public function detach(): void
    {
        $this->held = false;
    }
}
