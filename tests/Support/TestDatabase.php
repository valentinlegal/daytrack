<?php

namespace App\Tests\Support;

use Doctrine\DBAL\Connection;

/**
 * La base des tests, vidée avant chacun : toutes les tables du schéma, lues dans la
 * base elle-même, sauf celle où Doctrine Migrations note les migrations jouées. Une
 * table nouvelle s'y vide sans qu'on l'ajoute nulle part.
 */
final class TestDatabase
{
    /** Où Doctrine Migrations note ce qu'il a joué : vidée, la base se croirait neuve. */
    private const string MIGRATIONS = 'doctrine_migration_versions';

    /**
     * Refuse hors de l'environnement des tests, avant de toucher à quoi que ce soit : la
     * base de développement garde les journées qu'on y essaie.
     */
    public static function purge(Connection $connection, string $environment): void
    {
        if ('test' !== $environment) {
            throw new \LogicException(\sprintf('La base ne se vide que pour les tests, pas en « %s ».', $environment));
        }

        $platform = $connection->getDatabasePlatform();
        $tables = [];
        foreach ($connection->createSchemaManager()->introspectTableNames() as $table) {
            if (self::MIGRATIONS !== $table->getUnqualifiedName()->getValue()) {
                $tables[] = $table->toSQL($platform);
            }
        }

        $connection->transactional(static function (Connection $connection) use ($tables): void {
            // Les clés étrangères ne se vérifient qu'à la fin : l'ordre des tables n'importe pas.
            $connection->executeStatement('PRAGMA defer_foreign_keys = ON');
            foreach ($tables as $table) {
                $connection->executeStatement('DELETE FROM '.$table);
            }
        });
    }
}
