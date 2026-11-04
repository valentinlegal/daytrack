<?php

namespace App\Repository;

use App\Entity\V1Import;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;

/**
 * @extends ServiceEntityRepository<V1Import>
 */
final class V1ImportRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, V1Import::class);
    }

    public function current(): ?V1Import
    {
        return $this->findOneBy([]);
    }
}
