<?php

namespace App\Repository;

use App\Entity\Favorite;
use App\Entity\Slot;
use App\Entity\Ticket;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\ORM\Query;
use Doctrine\Persistence\ManagerRegistry;

/**
 * @extends ServiceEntityRepository<Ticket>
 */
final class TicketRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, Ticket::class);
    }

    /**
     * Les tickets connus parmi ceux-ci, par identifiant, tels que la base les tient.
     *
     * @param list<string> $keys
     *
     * @return array<string, Ticket>
     */
    public function byKeys(array $keys): array
    {
        if ([] === $keys) {
            return [];
        }

        /** @var list<Ticket> $tickets */
        $tickets = $this->createQueryBuilder('ticket')
            ->leftJoin('ticket.type', 'type')
            ->addSelect('type')
            ->where('ticket.key IN (:keys)')
            ->setParameter('keys', array_values(array_unique($keys)))
            ->getQuery()
            ->setHint(Query::HINT_REFRESH, true)
            ->getResult();

        $byKey = [];
        foreach ($tickets as $ticket) {
            $byKey[$ticket->key] = $ticket;
        }

        return $byKey;
    }

    /**
     * Ceux de ces tickets qu'une saisie ou un favori porte déjà.
     *
     * @param list<string> $keys
     *
     * @return list<string>
     */
    public function inUse(array $keys): array
    {
        if ([] === $keys) {
            return [];
        }

        $inUse = [];
        foreach ([Slot::class, Favorite::class] as $entity) {
            $found = $this->getEntityManager()->createQueryBuilder()
                ->select('DISTINCT holder.ticket')
                ->from($entity, 'holder')
                ->where('holder.ticket IN (:keys)')
                ->setParameter('keys', array_values(array_unique($keys)))
                ->getQuery()
                ->getSingleColumnResult();
            $inUse = [...$inUse, ...array_filter($found, is_string(...))];
        }

        return array_values(array_unique($inUse));
    }

    /** Tous les tickets sont à relire : le site de Jira a changé. */
    public function forgetAll(): void
    {
        $this->createQueryBuilder('ticket')->update()->set('ticket.readAt', ':never')->setParameter('never', null)->getQuery()->execute();
    }

    /**
     * Une écriture qui ne change rien : dans une transaction, elle prend le verrou de
     * la base jusqu'à la fin de celle-ci (TicketBook).
     */
    public function lock(): void
    {
        $this->getEntityManager()->getConnection()->executeStatement("UPDATE ticket SET ticket_key = ticket_key WHERE ticket_key = ''");
    }
}
