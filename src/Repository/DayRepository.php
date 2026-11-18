<?php

namespace App\Repository;

use App\Database\Lockable;
use App\Database\LocksItsTable;
use App\Entity\Day;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\DBAL\Types\Types;
use Doctrine\Persistence\ManagerRegistry;

/**
 * @extends ServiceEntityRepository<Day>
 */
final class DayRepository extends ServiceEntityRepository implements Lockable
{
    use LocksItsTable;

    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, Day::class);
    }

    /** La journée et ses créneaux, en une requête. */
    public function findWithSlots(\DateTimeImmutable $date): ?Day
    {
        $day = $this->createQueryBuilder('day')
            ->addSelect('slot')
            ->leftJoin('day.slots', 'slot')
            ->where('day.date = :date')
            ->setParameter('date', $date, Types::DATE_IMMUTABLE)
            ->getQuery()
            ->getOneOrNullResult();
        \assert(null === $day || $day instanceof Day);

        return $day;
    }

    /**
     * Les journées de $from à $to compris, et leurs créneaux, en une requête.
     *
     * @return list<Day>
     */
    public function findBetweenWithSlots(\DateTimeImmutable $from, \DateTimeImmutable $to): array
    {
        return $this->createQueryBuilder('day')
            ->addSelect('slot')
            ->leftJoin('day.slots', 'slot')
            ->where('day.date BETWEEN :from AND :to')
            ->setParameter('from', $from, Types::DATE_IMMUTABLE)
            ->setParameter('to', $to, Types::DATE_IMMUTABLE)
            ->orderBy('day.date')
            ->getQuery()
            ->getResult();
    }

    /**
     * Avance la version de la journée, sous le verrou, une fois vérifiée celle que l'onglet
     * a vue (DayWriter), ou pour ce que les récurrences y posent d'elles-mêmes
     * (RecurrencePoser), qu'aucun onglet n'a encore vu. Rend false pour une journée qui n'a
     * pas encore de ligne.
     */
    public function advance(\DateTimeImmutable $date): bool
    {
        return 1 === $this->getEntityManager()->getConnection()->executeStatement(
            'UPDATE day SET version = version + 1 WHERE date = :date',
            ['date' => $date],
            ['date' => Types::DATE_IMMUTABLE],
        );
    }
}
