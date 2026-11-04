<?php

namespace App\Entity;

use App\Day\Objective;
use App\Repository\SettingsRepository;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Uid\Uuid;

/**
 * Ce qui vaut pour chaque nouvelle journée : l'objectif habituel et les jours
 * travaillés. Une installation, un utilisateur : la base refuse une seconde ligne.
 *
 * La ligne n'existe qu'une fois un réglage changé : jusque-là, les valeurs par
 * défaut valent sans rien écrire.
 */
#[ORM\Entity(repositoryClass: SettingsRepository::class)]
class Settings
{
    /** Du lundi au vendredi, en jours de la semaine ISO : 1 pour lundi, 7 pour dimanche. */
    public const array DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5];

    #[ORM\Id]
    #[ORM\Column(type: UuidType::NAME)]
    public private(set) Uuid $id;

    /** Toujours 1 : une seconde ligne heurterait l'index unique. */
    #[ORM\Column(type: Types::SMALLINT, unique: true)]
    private int $single = 1;

    /** En minutes, au quart d'heure, de 0h00 à 13h00. */
    #[ORM\Column(type: Types::SMALLINT)]
    public int $habitualObjective = Objective::HABITUAL;

    /** @var list<int> */
    #[ORM\Column(type: Types::JSON)]
    public private(set) array $workingDays = self::DEFAULT_WORKING_DAYS;

    public function __construct()
    {
        $this->id = Uuid::v7();
    }

    /** Allume ou éteint un jour de la semaine ; les sept peuvent s'éteindre. */
    public function work(int $isoDay, bool $worked): void
    {
        $days = array_values(array_filter($this->workingDays, static fn (int $day): bool => $day !== $isoDay));
        if ($worked) {
            $days[] = $isoDay;
        }
        sort($days);

        $this->workingDays = $days;
    }
}
