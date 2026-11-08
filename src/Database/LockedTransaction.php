<?php

namespace App\Database;

use Doctrine\ORM\EntityManagerInterface;

/**
 * Le seul chemin par lequel DayTrack écrit à l'abri des écritures simultanées : deux
 * onglets, deux workers de FrankenPHP.
 *
 * Le verrou se prend d'abord, puis le travail lit et change ce qu'il veut, et tout
 * s'écrit d'un seul tenant : deux écritures passent l'une après l'autre, et la seconde
 * lit ce que la première a écrit. Sur une erreur, rien n'est écrit, le verrou est
 * rendu, et l'erreur repart telle quelle.
 */
final readonly class LockedTransaction
{
    public function __construct(
        private EntityManagerInterface $entityManager,
    ) {
    }

    /**
     * Un travail qui ne change rien n'écrit rien.
     *
     * @template T
     *
     * @param Lockable      $lock le dépôt dont l'écriture prend le verrou
     * @param \Closure(): T $work
     *
     * @return T ce que rend le travail
     */
    public function run(Lockable $lock, \Closure $work): mixed
    {
        // Pas de wrapInTransaction() : il ferme le gestionnaire d'entités au premier
        // refus, et la requête doit encore répondre.
        $connection = $this->entityManager->getConnection();

        // Imbriquée, une erreur rattrapée à l'intérieur oublierait ce que le travail
        // extérieur a changé en mémoire (clear()), sans que rien ne le dise.
        if ($connection->isTransactionActive()) {
            throw new \LogicException('Une écriture verrouillée ne s\'ouvre pas dans une autre.');
        }

        $connection->beginTransaction();

        try {
            // La première instruction est une écriture : elle verrouille la base jusqu'à
            // la fin de la transaction, et ce que le travail lit ensuite est le dernier état.
            $lock->lock();
            $result = $work();
            $this->entityManager->flush();
            $connection->commit();

            return $result;
        } catch (\Throwable $exception) {
            if ($connection->isTransactionActive()) {
                $connection->rollBack();
            }
            // Ce que la mémoire tient ne correspond plus à la base : on l'oublie.
            $this->entityManager->clear();

            throw $exception;
        }
    }
}
