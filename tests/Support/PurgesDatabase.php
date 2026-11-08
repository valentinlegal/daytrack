<?php

namespace App\Tests\Support;

use Doctrine\DBAL\Connection;

/**
 * Repartir d'une base vide, dans un test qui a démarré le noyau.
 */
trait PurgesDatabase
{
    protected static function purgeDatabase(): void
    {
        $container = static::getContainer();

        TestDatabase::purge($container->get(Connection::class), $container->getParameter('kernel.environment'));
    }
}
