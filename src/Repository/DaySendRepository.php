<?php

namespace App\Repository;

use App\Entity\DaySend;
use App\Entity\JiraConnection;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\DBAL\Types\Types;
use Doctrine\Persistence\ManagerRegistry;

/**
 * @extends ServiceEntityRepository<DaySend>
 */
final class DaySendRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, DaySend::class);
    }

    /** L'envoi de ce jour vers ce Jira, sous ce compte ; aucun sans Jira relié. */
    public function forDate(\DateTimeImmutable $date, ?JiraConnection $jira): ?DaySend
    {
        if (null === $jira) {
            return null;
        }

        $send = $this->createQueryBuilder('send')
            ->join('send.day', 'day')
            ->where('day.date = :date')
            ->andWhere('send.instance = :instance AND send.accountId = :account')
            ->setParameter('date', $date, Types::DATE_IMMUTABLE)
            ->setParameter('instance', $jira->instance)
            ->setParameter('account', $jira->accountId)
            ->getQuery()
            ->getOneOrNullResult();
        \assert(null === $send || $send instanceof DaySend);

        return $send;
    }

    /**
     * Les envois vers ce Jira, sous ce compte ; aucun sans Jira relié.
     *
     * @return array<string, DaySend> par jour « AAAA-MM-JJ », de $from à $to compris
     */
    public function between(\DateTimeImmutable $from, \DateTimeImmutable $to, ?JiraConnection $jira): array
    {
        if (null === $jira) {
            return [];
        }

        /** @var list<DaySend> $sends */
        $sends = $this->createQueryBuilder('send')
            ->addSelect('day')
            ->join('send.day', 'day')
            ->where('day.date BETWEEN :from AND :to')
            ->andWhere('send.instance = :instance AND send.accountId = :account')
            ->setParameter('from', $from, Types::DATE_IMMUTABLE)
            ->setParameter('to', $to, Types::DATE_IMMUTABLE)
            ->setParameter('instance', $jira->instance)
            ->setParameter('account', $jira->accountId)
            ->getQuery()
            ->getResult();

        $byDate = [];
        foreach ($sends as $send) {
            $byDate[$send->day->date->format('Y-m-d')] = $send;
        }

        return $byDate;
    }

    /**
     * Le même Jira, reconnu jusqu'ici à son adresse, dit son identifiant : l'état d'envoi
     * de ses journées le suit. Un jour qui en aurait déjà un sous l'identifiant garde
     * celui-là.
     */
    public function moveToInstance(string $from, string $to): void
    {
        $this->getEntityManager()->getConnection()->executeStatement(
            'UPDATE day_send SET instance = :to WHERE instance = :from AND NOT EXISTS (SELECT 1 FROM day_send other WHERE other.instance = :to AND other.day_id = day_send.day_id AND other.account_id = day_send.account_id)',
            ['to' => $to, 'from' => $from],
        );
    }

    /**
     * Jira a dit quel compte représente le jeton repris de la v1 : les journées reprises
     * lui appartiennent. Un jour qui en aurait déjà un sous ce compte garde celui-là.
     */
    public function moveToAccount(string $instance, string $from, string $to): void
    {
        $this->getEntityManager()->getConnection()->executeStatement(
            'UPDATE day_send SET account_id = :to WHERE instance = :instance AND account_id = :from AND NOT EXISTS (SELECT 1 FROM day_send other WHERE other.instance = :instance AND other.day_id = day_send.day_id AND other.account_id = :to)',
            ['to' => $to, 'from' => $from, 'instance' => $instance],
        );
    }

    /** Les journées reprises de la v1 sans Jira relié appartiennent au premier qu'on relie. */
    public function adoptUnclaimed(string $instance, string $account): void
    {
        $this->getEntityManager()->getConnection()->executeStatement(
            "UPDATE day_send SET instance = :instance, account_id = :account WHERE instance = '' AND account_id = ''",
            ['instance' => $instance, 'account' => $account],
        );
    }

    /**
     * Prend l'envoi de ce jour, si aucun autre n'est en cours : rend false sinon. Une
     * seule instruction, que la base exécute d'un bloc : deux onglets qui envoient
     * ensemble ne partent jamais tous les deux.
     */
    public function claim(DaySend $send, \DateTimeImmutable $now): bool
    {
        return 1 === $this->getEntityManager()->getConnection()->executeStatement(
            'UPDATE day_send SET sending_since = :now WHERE id = :id AND (sending_since IS NULL OR sending_since <= :expired)',
            ['now' => DaySend::universal($now), 'id' => $send->id, 'expired' => DaySend::universal($now->modify(DaySend::SENDING_EXPIRES))],
            ['now' => Types::DATETIME_IMMUTABLE, 'id' => 'uuid', 'expired' => Types::DATETIME_IMMUTABLE],
        );
    }
}
