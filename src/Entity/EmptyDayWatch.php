<?php

namespace App\Entity;

use App\Repository\EmptyDayWatchRepository;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Uid\Uuid;

/**
 * Le point de départ des jours vides : seuls ceux qui suivent le jour de cet instant, dans
 * le fuseau de l'utilisateur, se signalent « Incomplet » (DayMark). Avant lui, rien ne
 * distinguait un oubli d'un congé, et les congés passés ne se couvrent pas de marques.
 *
 * La migration qui l'apporte le pose, au premier démarrage de la version ; la reprise de
 * la v1 le repousse à son heure. Aucune lecture ne l'écrit. Une installation, une ligne :
 * la base refuse une seconde. Il n'est pas dans la ligne des réglages : sa seule présence
 * ferait refuser la reprise de la v1 (V1Importer).
 */
#[ORM\Entity(repositoryClass: EmptyDayWatchRepository::class)]
class EmptyDayWatch
{
    #[ORM\Id]
    #[ORM\Column(type: UuidType::NAME)]
    public private(set) Uuid $id;

    /** Toujours 1 : une seconde ligne heurterait l'index unique. */
    #[ORM\Column(type: Types::SMALLINT, unique: true)]
    private int $single = 1;

    /** En heure universelle. */
    #[ORM\Column(type: Types::DATETIME_IMMUTABLE)]
    public private(set) \DateTimeImmutable $since;

    public function __construct(\DateTimeImmutable $since)
    {
        $this->id = Uuid::v7();
        $this->since = $since->setTimezone(new \DateTimeZone('UTC'));
    }

    /** Repoussé jusqu'à cet instant, s'il vient après : il ne recule jamais. */
    public function notBefore(\DateTimeImmutable $instant): void
    {
        if ($instant > $this->since) {
            $this->since = $instant->setTimezone(new \DateTimeZone('UTC'));
        }
    }
}
