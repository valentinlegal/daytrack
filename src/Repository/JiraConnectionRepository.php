<?php

namespace App\Repository;

use App\Entity\JiraConnection;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\ORM\Query;
use Doctrine\Persistence\ManagerRegistry;

/**
 * @extends ServiceEntityRepository<JiraConnection>
 */
final class JiraConnectionRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, JiraConnection::class);
    }

    /** La connexion telle que la base la tient : un autre onglet a pu la changer depuis. */
    public function current(): ?JiraConnection
    {
        $connection = $this->createQueryBuilder('connection')
            ->getQuery()
            ->setHint(Query::HINT_REFRESH, true)
            ->getOneOrNullResult();

        return $connection instanceof JiraConnection ? $connection : null;
    }
}
