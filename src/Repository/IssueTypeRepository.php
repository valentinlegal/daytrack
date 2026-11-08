<?php

namespace App\Repository;

use App\Database\Lockable;
use App\Database\LocksItsTable;
use App\Entity\Favorite;
use App\Entity\IssueType;
use App\Entity\Slot;
use App\Entity\Ticket;
use App\Settings\Tint;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\ORM\Query;
use Doctrine\ORM\Query\Expr\Join;
use Doctrine\Persistence\ManagerRegistry;
use Symfony\Component\Uid\Uuid;

/**
 * @extends ServiceEntityRepository<IssueType>
 */
final class IssueTypeRepository extends ServiceEntityRepository implements Lockable
{
    use LocksItsTable;

    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, IssueType::class);
    }

    public function byJiraId(string $instance, string $jiraId): ?IssueType
    {
        return $this->findOneBy(['instance' => $instance, 'jiraId' => $jiraId]);
    }

    public function byId(Uuid $id): ?IssueType
    {
        $type = $this->createQueryBuilder('type')
            ->where('type.id = :id')
            ->setParameter('id', $id, 'uuid')
            ->getQuery()
            ->setHint(Query::HINT_REFRESH, true)
            ->getOneOrNullResult();

        return $type instanceof IssueType ? $type : null;
    }

    /**
     * Rattache à un Jira les types gardés sous un autre nom du même Jira. Un type que le
     * Jira a déjà sous son nouveau nom garde celui-là.
     */
    public function moveToInstance(string $from, string $to): void
    {
        $taken = $this->createQueryBuilder('type')
            ->select('type.jiraId')
            ->where('type.instance = :to')
            ->setParameter('to', $to)
            ->getQuery()
            ->getSingleColumnResult();

        $move = $this->createQueryBuilder('type')
            ->update()
            ->set('type.instance', ':to')
            ->where('type.instance = :from')
            ->setParameter('to', $to)
            ->setParameter('from', $from);
        if ([] !== $taken) {
            $move->andWhere('type.jiraId NOT IN (:taken)')->setParameter('taken', $taken);
        }
        $move->getQuery()->execute();
    }

    /**
     * Les teintes que portent déjà les types de ce Jira.
     *
     * @return list<Tint>
     */
    public function tintsOf(string $instance): array
    {
        /** @var list<IssueType> $types */
        $types = $this->findBy(['instance' => $instance]);

        return array_map(static fn (IssueType $type): Tint => $type->color, $types);
    }

    /**
     * Les types des tickets que portent les saisies et les favoris, du plus utilisé au
     * moins utilisé : en quarts d'heure saisis, puis en favoris, puis par nom. Les
     * dizaines de types d'une grosse instance n'y apparaissent pas, ni ceux d'un autre
     * Jira que celui qui est relié.
     *
     * @return list<IssueType>
     */
    public function encountered(?string $instance): array
    {
        $quarters = $this->usage(Slot::class);
        $favorites = $this->usage(Favorite::class);

        if ([] === $quarters + $favorites) {
            return [];
        }

        // Une installation ne garde que les types de ses tickets : quelques dizaines au
        // plus, que la mémoire trie mieux qu'une requête.
        /** @var list<IssueType> $types */
        $types = $this->createQueryBuilder('type')->getQuery()->setHint(Query::HINT_REFRESH, true)->getResult();
        $types = array_values(array_filter(
            $types,
            static fn (IssueType $type): bool => (null === $instance || $type->instance === $instance)
                && (isset($quarters[$type->id->toRfc4122()]) || isset($favorites[$type->id->toRfc4122()])),
        ));

        usort($types, static function (IssueType $a, IssueType $b) use ($quarters, $favorites): int {
            $aId = $a->id->toRfc4122();
            $bId = $b->id->toRfc4122();

            return [$quarters[$bId] ?? 0, $favorites[$bId] ?? 0, $a->name] <=> [$quarters[$aId] ?? 0, $favorites[$aId] ?? 0, $b->name];
        });

        return $types;
    }

    /**
     * Combien de fois chaque type apparaît dans ces lignes, par identifiant de type.
     *
     * @param class-string<Slot|Favorite> $holder
     *
     * @return array<string, int>
     */
    private function usage(string $holder): array
    {
        /** @var list<array{type: Uuid|string, uses: int|string}> $rows */
        $rows = $this->getEntityManager()->createQueryBuilder()
            ->select('IDENTITY(ticket.type) AS type', 'COUNT(holder.id) AS uses')
            ->from($holder, 'holder')
            ->join(Ticket::class, 'ticket', Join::ON, 'ticket.key = holder.ticket')
            ->where('ticket.type IS NOT NULL')
            ->groupBy('ticket.type')
            ->getQuery()
            ->getArrayResult();

        $usage = [];
        foreach ($rows as $row) {
            $id = $row['type'] instanceof Uuid ? $row['type'] : Uuid::fromString($row['type']);
            $usage[$id->toRfc4122()] = (int) $row['uses'];
        }

        return $usage;
    }
}
