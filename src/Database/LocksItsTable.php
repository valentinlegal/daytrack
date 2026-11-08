<?php

namespace App\Database;

use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;

/**
 * Le verrou d'un dépôt : une écriture sur sa table, qui ne touche aucune ligne.
 *
 * SQLite verrouille la base entière dès la première écriture d'une transaction, même
 * quand elle ne trouve rien à changer : la table ne fait que nommer qui la prend.
 *
 * @phpstan-require-extends ServiceEntityRepository
 */
trait LocksItsTable
{
    public function lock(): void
    {
        $metadata = $this->getClassMetadata();
        $connection = $this->getEntityManager()->getConnection();
        $platform = $connection->getDatabasePlatform();
        $quoting = $this->getEntityManager()->getConfiguration()->getQuoteStrategy();
        $id = $quoting->getColumnName($metadata->getSingleIdentifierFieldName(), $metadata, $platform);

        // Aucun identifiant n'est nul : rien ne change, mais l'écriture a eu lieu.
        $connection->executeStatement(\sprintf('UPDATE %1$s SET %2$s = %2$s WHERE %2$s IS NULL', $quoting->getTableName($metadata, $platform), $id));
    }
}
