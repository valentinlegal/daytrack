<?php

namespace App\Repository;

use App\Database\Lockable;
use App\Database\LocksItsTable;
use App\Entity\Settings;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\ORM\Query;
use Doctrine\Persistence\ManagerRegistry;

/**
 * @extends ServiceEntityRepository<Settings>
 */
final class SettingsRepository extends ServiceEntityRepository implements Lockable
{
    use LocksItsTable;

    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, Settings::class);
    }

    /** Les réglages tels que la base les tient, ou null tant qu'aucun n'a changé. */
    public function current(): ?Settings
    {
        $settings = $this->createQueryBuilder('settings')
            ->getQuery()
            ->setHint(Query::HINT_REFRESH, true)
            ->getOneOrNullResult();

        return $settings instanceof Settings ? $settings : null;
    }
}
