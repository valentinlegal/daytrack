<?php

declare(strict_types=1);

namespace App\Repository;

use App\Entity\TemplateRule;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;

/**
 * @extends ServiceEntityRepository<TemplateRule>
 */
class TemplateRuleRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, TemplateRule::class);
    }

    /**
     * Retourne toutes les règles (actives et désactivées) triées par position ascendante.
     *
     * @return TemplateRule[]
     */
    public function findAllOrderedByPosition(): array
    {
        return $this->findBy([], ['position' => 'ASC']);
    }

    /**
     * Retourne uniquement les règles activées — utilisé par la matérialisation.
     *
     * @return TemplateRule[]
     */
    public function findAllEnabled(): array
    {
        return $this->findBy(['enabled' => true]);
    }

    /**
     * Retourne la position maximale parmi toutes les règles.
     * Retourne -1 si la table est vide.
     */
    public function getMaxPosition(): int
    {
        $result = $this->createQueryBuilder('r')
            ->select('MAX(r.position)')
            ->getQuery()
            ->getSingleScalarResult();

        return null !== $result ? (int) $result : -1;
    }
}
