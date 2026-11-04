<?php

namespace App\Repository;

use App\Entity\Settings;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\ORM\Query;
use Doctrine\Persistence\ManagerRegistry;

/**
 * @extends ServiceEntityRepository<Settings>
 */
final class SettingsRepository extends ServiceEntityRepository
{
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

    /**
     * Une écriture qui ne change rien : dans une transaction, elle prend le verrou de
     * la base jusqu'à la fin de celle-ci (UserSettings).
     */
    public function lock(): void
    {
        $this->getEntityManager()->getConnection()->executeStatement('UPDATE settings SET single = single WHERE single = 0');
    }
}
