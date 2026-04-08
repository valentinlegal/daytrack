<?php

declare(strict_types=1);

namespace App\Repository;

use App\Entity\FavoriteTicket;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;

/**
 * @extends ServiceEntityRepository<FavoriteTicket>
 */
class FavoriteTicketRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, FavoriteTicket::class);
    }

    /**
     * Retourne tous les favoris triés par position ascendante.
     *
     * @return FavoriteTicket[]
     */
    public function findAllOrderedByPosition(): array
    {
        return $this->findBy([], ['position' => 'ASC']);
    }

    /**
     * Retourne la position maximale parmi tous les favoris.
     * Retourne -1 si la table est vide.
     */
    public function getMaxPosition(): int
    {
        $result = $this->createQueryBuilder('f')
            ->select('MAX(f.position)')
            ->getQuery()
            ->getSingleScalarResult();

        return null !== $result ? (int) $result : -1;
    }
}
