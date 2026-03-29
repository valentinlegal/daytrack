<?php

declare(strict_types=1);

namespace App\Repository;

use App\Entity\WorkDay;
use DateTimeImmutable;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;

/**
 * @extends ServiceEntityRepository<WorkDay>
 */
class WorkDayRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, WorkDay::class);
    }

    /**
     * Récupère une journée par sa date — retourne null si elle n'existe pas encore.
     */
    public function findByDate(DateTimeImmutable $date): ?WorkDay
    {
        return $this->findOneBy(['date' => $date]);
    }
}