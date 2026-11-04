<?php

namespace App\Repository;

use App\Entity\EmptyDayWatch;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\ORM\Query;
use Doctrine\Persistence\ManagerRegistry;

/**
 * @extends ServiceEntityRepository<EmptyDayWatch>
 */
final class EmptyDayWatchRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, EmptyDayWatch::class);
    }

    /** L'instant d'où partent les jours vides qui se signalent, tel que la base le tient ; null, aucun ne se signale. */
    public function since(): ?\DateTimeImmutable
    {
        $watch = $this->createQueryBuilder('watch')
            ->getQuery()
            ->setHint(Query::HINT_REFRESH, true)
            ->getOneOrNullResult();

        return $watch instanceof EmptyDayWatch ? $watch->since : null;
    }
}
