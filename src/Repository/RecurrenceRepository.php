<?php

namespace App\Repository;

use App\Entity\Recurrence;
use App\Entity\RecurrenceSkip;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Query;
use Doctrine\Persistence\ManagerRegistry;
use Symfony\Component\Uid\Uuid;

/**
 * @extends ServiceEntityRepository<Recurrence>
 */
final class RecurrenceRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, Recurrence::class);
    }

    public function byId(Uuid $id): ?Recurrence
    {
        return $this->find($id);
    }

    /**
     * Celles qu'on a collées après une coupe de celle-ci (Recurrence::$follows). Déjà chargées,
     * elles restent telles que la requête les a laissées : à relire sous le verrou celles qu'elle
     * n'a pas changées.
     *
     * @return list<Recurrence>
     */
    public function followersOf(Recurrence $source): array
    {
        /** @var list<Recurrence> $followers */
        $followers = $this->createQueryBuilder('recurrence')
            ->where('recurrence.follows = :source')
            ->setParameter('source', $source->id, 'uuid')
            ->orderBy('recurrence.id')
            ->getQuery()
            ->getResult();

        return $followers;
    }

    /**
     * Toutes relues de la base, sous le verrou d'une écriture : chargées plus tôt dans la
     * requête, leur fin a pu changer depuis dans un autre onglet. Ce que le geste change
     * ensuite se juge sur elles (RecurrenceClash).
     */
    public function refreshAll(): void
    {
        $this->createQueryBuilder('recurrence')->getQuery()->setHint(Query::HINT_REFRESH, true)->getResult();
    }

    /**
     * Celles qui ont des jours à traiter jusqu'à aujourd'hui : ni retirées, ni finies avant
     * le premier jour qui leur reste.
     *
     * @return list<Recurrence>
     */
    public function due(\DateTimeImmutable $today): array
    {
        return $this->createQueryBuilder('recurrence')
            ->where('recurrence.posedThrough < :today')
            ->andWhere('recurrence.until IS NULL OR recurrence.until > recurrence.posedThrough')
            ->andWhere('recurrence.until IS NULL OR recurrence.until >= recurrence.firstDay')
            ->setParameter('today', $today, Types::DATE_IMMUTABLE)
            ->orderBy('recurrence.id')
            ->getQuery()
            ->getResult();
    }

    /**
     * Celles qui tombent ce jour-là selon leur rythme, quoi qu'en disent les réglages et
     * l'objectif du jour.
     *
     * @return list<Recurrence>
     */
    public function fallingOn(\DateTimeImmutable $date): array
    {
        $candidates = $this->createQueryBuilder('recurrence')
            ->where('recurrence.firstDay <= :date')
            ->andWhere('recurrence.until IS NULL OR recurrence.until >= :date')
            ->setParameter('date', $date, Types::DATE_IMMUTABLE)
            ->orderBy('recurrence.id')
            ->getQuery()
            ->getResult();

        return array_values(array_filter($candidates, static fn (Recurrence $recurrence): bool => $recurrence->fallsOn($date)));
    }

    /**
     * Celles qui ont encore des jours à venir après aujourd'hui, par leur identifiant : ni
     * finies avant, ni retirées. Une récurrence qu'on crée ou qu'on change ne doit tomber sur
     * aucune, quel que soit le jour d'où on le fait (RecurrenceClash).
     *
     * @return array<string, Recurrence>
     */
    public function ongoing(\DateTimeImmutable $today): array
    {
        /** @var list<Recurrence> $ongoing */
        $ongoing = $this->createQueryBuilder('recurrence')
            ->where('recurrence.until IS NULL OR (recurrence.until > :today AND recurrence.until >= recurrence.firstDay)')
            ->setParameter('today', $today, Types::DATE_IMMUTABLE)
            ->orderBy('recurrence.id')
            ->getQuery()
            ->getResult();
        $byId = [];
        foreach ($ongoing as $recurrence) {
            $byId[$recurrence->id->toRfc4122()] = $recurrence;
        }

        return $byId;
    }

    /**
     * Les fois détachées ou effacées « cette fois seulement » après aujourd'hui, par
     * récurrence, dans l'ordre : elles ne prennent plus leur créneau. Celles qu'un jour mis à
     * 0h00 retient le gardent : revenir à un objectif les rendra.
     *
     * @return array<string, list<string>>
     */
    public function skippedAfter(\DateTimeImmutable $today): array
    {
        /** @var list<RecurrenceSkip> $skips */
        $skips = $this->getEntityManager()->createQueryBuilder()
            ->select('skip')
            ->from(RecurrenceSkip::class, 'skip')
            ->where('skip.date > :today AND skip.held = false')
            ->setParameter('today', $today, Types::DATE_IMMUTABLE)
            ->orderBy('skip.date')
            ->getQuery()
            ->getResult();
        $byId = [];
        foreach ($skips as $skip) {
            $byId[$skip->recurrence->id->toRfc4122()][] = $skip->date->format('Y-m-d');
        }

        return $byId;
    }

    /**
     * Ses fois sautées après ce jour, détachées ou retenues, dans l'ordre.
     *
     * @return list<RecurrenceSkip>
     */
    public function skipsAfter(Recurrence $recurrence, \DateTimeImmutable $date): array
    {
        $day = $date->format('Y-m-d');

        return array_values(array_filter(
            $this->getEntityManager()->getRepository(RecurrenceSkip::class)->findBy(['recurrence' => $recurrence], ['date' => 'ASC']),
            static fn (RecurrenceSkip $skip): bool => $skip->date->format('Y-m-d') > $day,
        ));
    }

    /**
     * Ces fois-là sautées pour une autre aussi, telles quelles : détachées, ou retenues par un
     * jour à 0h00, qui les lui rendra avec son objectif.
     *
     * @param list<RecurrenceSkip> $skips
     */
    public function carry(array $skips, Recurrence $to): void
    {
        foreach ($skips as $skip) {
            if (null === $this->skipOn($to, $skip->date)) {
                $this->getEntityManager()->persist(new RecurrenceSkip($to, $skip->date, $skip->held));
            }
        }
    }

    public function isSkipped(Recurrence $recurrence, \DateTimeImmutable $date): bool
    {
        return null !== $this->skipOn($recurrence, $date);
    }

    /** Cette fois-là est détachée ou effacée, et pas seulement retenue par un 0h00. */
    public function isDetached(Recurrence $recurrence, \DateTimeImmutable $date): bool
    {
        return false === $this->skipOn($recurrence, $date)?->held;
    }

    /** Cette fois-là est détachée : rien ne la repose ni ne la prévoit plus. */
    public function skip(Recurrence $recurrence, \DateTimeImmutable $date): void
    {
        if (null === $this->skipOn($recurrence, $date)) {
            $this->getEntityManager()->persist(new RecurrenceSkip($recurrence, $date));
        }
    }

    /** Cette fois-là lui est rendue, par annuler. */
    public function unskip(Recurrence $recurrence, \DateTimeImmutable $date): void
    {
        $skip = $this->skipOn($recurrence, $date);
        if (null !== $skip) {
            $this->getEntityManager()->remove($skip);
        }
    }

    /**
     * La journée mise à 0h00 lui retire cette fois-là, jusqu'à ce qu'elle revienne à un
     * objectif. Une fois déjà détachée le reste.
     */
    public function hold(Recurrence $recurrence, \DateTimeImmutable $date): void
    {
        if (null === $this->skipOn($recurrence, $date)) {
            $this->getEntityManager()->persist(new RecurrenceSkip($recurrence, $date, held: true));
        }
    }

    /**
     * Annuler ou rétablir lui rend cette fois-là sur une journée mise à 0h00 : elle la retient
     * comme si le 0h00 l'avait retirée, détachée avant ou non, jusqu'à ce que la journée revienne
     * à un objectif.
     */
    public function holdReturned(Recurrence $recurrence, \DateTimeImmutable $date): void
    {
        $skip = $this->skipOn($recurrence, $date);
        if (null === $skip) {
            $this->getEntityManager()->persist(new RecurrenceSkip($recurrence, $date, held: true));
        } else {
            $skip->hold();
        }
    }

    /**
     * Cette fois-là est de nouveau détachée, retenue ou non entre-temps : rétablir refait le geste
     * qui l'avait détachée, et que son annulation avait rendue à sa série sans l'écrire ; sur un
     * jour rouvert, elle cède le créneau qu'une autre y veut (SendClosure).
     */
    public function detachAgain(Recurrence $recurrence, \DateTimeImmutable $date): void
    {
        $skip = $this->skipOn($recurrence, $date);
        if (null === $skip) {
            $this->getEntityManager()->persist(new RecurrenceSkip($recurrence, $date));
        } else {
            $skip->detach();
        }
    }

    /**
     * La journée revient à un objectif : les fois que son passage à 0h00 avait retirées lui
     * sont rendues, et rendues ici pour qu'elle les repose ou les prévoie.
     *
     * @return list<Recurrence>
     */
    public function release(\DateTimeImmutable $date): array
    {
        $entityManager = $this->getEntityManager();
        $released = [];
        foreach ($entityManager->getRepository(RecurrenceSkip::class)->findBy(['date' => $date, 'held' => true]) as $skip) {
            $released[] = $skip->recurrence;
            $entityManager->remove($skip);
        }
        // Dans l'ordre où le poseur les prend : la première l'emporte sur un quart d'heure disputé.
        usort($released, static fn (Recurrence $a, Recurrence $b): int => strcmp($a->id->toRfc4122(), $b->id->toRfc4122()));

        return $released;
    }

    private function skipOn(Recurrence $recurrence, \DateTimeImmutable $date): ?RecurrenceSkip
    {
        $entityManager = $this->getEntityManager();
        // Une fois détachée dans ce même geste n'est pas encore écrite.
        foreach ($entityManager->getUnitOfWork()->getScheduledEntityInsertions() as $pending) {
            if ($pending instanceof RecurrenceSkip && $pending->recurrence === $recurrence && $pending->date->format('Y-m-d') === $date->format('Y-m-d')) {
                return $pending;
            }
        }

        return $entityManager->getRepository(RecurrenceSkip::class)->findOneBy(['recurrence' => $recurrence, 'date' => $date]);
    }
}
