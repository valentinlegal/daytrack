<?php

namespace App\Repository;

use App\Database\Lockable;
use App\Database\LocksItsTable;
use App\Entity\Favorite;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\ORM\Query;
use Doctrine\Persistence\ManagerRegistry;

/**
 * @extends ServiceEntityRepository<Favorite>
 */
final class FavoriteRepository extends ServiceEntityRepository implements Lockable
{
    use LocksItsTable;

    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, Favorite::class);
    }

    /**
     * La liste, de haut en bas, telle que la base la tient : un favori déjà chargé
     * reprend ce qu'un autre onglet a pu y écrire depuis.
     *
     * @return list<Favorite>
     */
    public function ordered(): array
    {
        /* @var list<Favorite> */
        return $this->createQueryBuilder('favorite')
            ->orderBy('favorite.position', \SortDirection::Ascending)
            ->addOrderBy('favorite.id', \SortDirection::Ascending)
            ->getQuery()
            ->setHint(Query::HINT_REFRESH, true)
            ->getResult();
    }
}
