<?php

namespace App\Favorite;

use App\Entity\Favorite;
use App\Repository\FavoriteRepository;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Uid\Uuid;

/**
 * Le seul chemin par lequel la liste des favoris s'écrit.
 *
 * Chaque geste passe en entier ou pas du tout, l'un après l'autre : deux onglets qui
 * ajoutent le même ticket au même instant n'en font pas deux favoris. Après chacun,
 * les places vont de 0 à la fin, sans double ni trou.
 */
final readonly class FavoriteWriter
{
    public function __construct(
        private EntityManagerInterface $entityManager,
        private FavoriteRepository $favorites,
    ) {
    }

    /**
     * @param int $position sa place, 0 en haut ; au-delà de la fin, il va en bas
     *
     * @throws DuplicateFavorite
     */
    public function add(string $ticket, ?string $name, int $position): void
    {
        $this->write(function (array $list) use ($ticket, $name, $position): array {
            foreach ($list as $favorite) {
                if ($favorite->ticket === $ticket) {
                    throw new DuplicateFavorite();
                }
            }
            $favorite = new Favorite($ticket, $name, $position);
            $this->entityManager->persist($favorite);
            array_splice($list, min($position, \count($list)), 0, [$favorite]);

            return $list;
        });
    }

    /** @return bool false si le favori n'existe plus : un autre onglet l'a retiré */
    public function rename(Uuid $id, ?string $name): bool
    {
        return $this->write(static function (array $list) use ($id, $name): ?array {
            $favorite = self::find($list, $id);
            if (null === $favorite) {
                return null;
            }
            $favorite->name = $name;

            return $list;
        });
    }

    /** @return bool false si le favori n'existe plus */
    public function remove(Uuid $id): bool
    {
        return $this->write(function (array $list) use ($id): ?array {
            $favorite = self::find($list, $id);
            if (null === $favorite) {
                return null;
            }
            $this->entityManager->remove($favorite);

            return array_values(array_filter($list, static fn (Favorite $other): bool => $other !== $favorite));
        });
    }

    /**
     * @param list<Uuid> $ids toute la liste, dans son nouvel ordre
     *
     * @return bool false si ce ne sont plus les favoris de la liste : un autre onglet l'a changée
     */
    public function reorder(array $ids): bool
    {
        return $this->write(static function (array $list) use ($ids): ?array {
            if (\count($ids) !== \count($list)) {
                return null;
            }
            $ordered = [];
            foreach ($ids as $id) {
                $favorite = self::find($list, $id);
                if (null === $favorite || \in_array($favorite, $ordered, true)) {
                    return null;
                }
                $ordered[] = $favorite;
            }

            return $ordered;
        });
    }

    /**
     * @param \Closure(list<Favorite>): ?list<Favorite> $gesture la liste dans son nouvel ordre, ou null pour ne rien écrire
     *
     * @return bool false si le geste n'a rien écrit
     *
     * @throws DuplicateFavorite
     */
    private function write(\Closure $gesture): bool
    {
        // Pas de wrapInTransaction() : il ferme le gestionnaire d'entités au premier
        // refus, et la réponse doit encore lire la liste.
        $connection = $this->entityManager->getConnection();
        $connection->beginTransaction();

        try {
            // La première instruction est une écriture : elle verrouille la base
            // jusqu'à la fin de la transaction, et la liste lue ensuite est la dernière.
            $this->favorites->lock();
            $list = $gesture($this->favorites->ordered());
            if (null === $list) {
                $connection->rollBack();

                return false;
            }
            foreach ($list as $position => $favorite) {
                $favorite->position = $position;
            }
            $this->entityManager->flush();
            $connection->commit();

            return true;
        } catch (\Throwable $exception) {
            if ($connection->isTransactionActive()) {
                $connection->rollBack();
            }
            // Ce que la mémoire tient ne correspond plus à la base : on l'oublie.
            $this->entityManager->clear();

            throw $exception;
        }
    }

    /**
     * @param list<Favorite> $list
     */
    private static function find(array $list, Uuid $id): ?Favorite
    {
        foreach ($list as $favorite) {
            if ($favorite->id->equals($id)) {
                return $favorite;
            }
        }

        return null;
    }
}
