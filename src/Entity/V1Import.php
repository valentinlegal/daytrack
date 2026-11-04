<?php

namespace App\Entity;

use App\Repository\V1ImportRepository;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Uid\Uuid;

/**
 * La reprise de la v1 a eu lieu : elle ne se refait jamais, et seuls les réglages de
 * l'application font foi ensuite. Elle garde ce qu'elle a dû laisser de côté, le temps
 * que l'écran l'ait dit. La base refuse une seconde ligne.
 *
 * @phpstan-type LeftOutEntry array{date: string, start: string, end: ?string, ticket: ?string}
 * @phpstan-type LeftOutObjective array{date: string, from: int, to: int}
 * @phpstan-type LeftOut array{entries: list<LeftOutEntry>, objectives: list<LeftOutObjective>, favorites: list<string>}
 */
#[ORM\Entity(repositoryClass: V1ImportRepository::class)]
class V1Import
{
    #[ORM\Id]
    #[ORM\Column(type: UuidType::NAME)]
    public private(set) Uuid $id;

    /** Toujours 1 : une seconde ligne heurterait l'index unique. */
    #[ORM\Column(type: Types::SMALLINT, unique: true)]
    private int $single = 1;

    #[ORM\Column(type: Types::DATETIME_IMMUTABLE)]
    public private(set) \DateTimeImmutable $importedAt;

    /** @var LeftOut */
    #[ORM\Column(type: Types::JSON)]
    public private(set) array $leftOut;

    /**
     * @param LeftOut $leftOut
     */
    public function __construct(\DateTimeImmutable $now, array $leftOut)
    {
        $this->id = Uuid::v7();
        $this->importedAt = $now->setTimezone(new \DateTimeZone('UTC'));
        $this->leftOut = $leftOut;
    }

    /** L'utilisateur a lu la liste : elle ne s'affiche plus. L'ancienne base, elle, n'a pas bougé. */
    public function seen(): void
    {
        $this->leftOut = ['entries' => [], 'objectives' => [], 'favorites' => []];
    }
}
