<?php

namespace App\Tests\Favorite;

use App\Repository\FavoriteRepository;
use Doctrine\DBAL\Connection;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;

/**
 * Deux gestes simultanés sur la liste des favoris — deux onglets, deux workers de
 * FrankenPHP — passent l'un après l'autre : le second lit la liste que le premier a
 * laissée, et deux ajouts du même ticket n'en font pas deux favoris.
 */
final class SimultaneousFavoriteWritesTest extends KernelTestCase
{
    private Connection $connection;

    private \PDO $other;

    protected function setUp(): void
    {
        self::bootKernel();
        $this->connection = self::getContainer()->get('doctrine.dbal.default_connection');
        $this->connection->executeStatement('DELETE FROM favorite');

        // L'autre geste, par sa propre connexion au même fichier. Il n'attend pas : un
        // verrou se voit tout de suite.
        $path = $this->connection->getParams()['path'] ?? null;
        self::assertIsString($path);
        $this->other = new \PDO('sqlite:'.$path, options: [\PDO::ATTR_TIMEOUT => 0, \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION]);
    }

    protected function tearDown(): void
    {
        if ($this->connection->isTransactionActive()) {
            $this->connection->rollBack();
        }
        unset($this->other);

        parent::tearDown();
    }

    public function testMemeUneListeVideSeVerrouillePourEtreLue(): void
    {
        $this->connection->beginTransaction();
        self::getContainer()->get(FavoriteRepository::class)->lock();

        try {
            $this->other->exec('INSERT INTO favorite (id, ticket, name, position) VALUES (X\'00\', \'SHOP-482\', NULL, 0)');
            self::fail('Le second geste est passé pendant le premier.');
        } catch (\PDOException $exception) {
            self::assertStringContainsString('database is locked', $exception->getMessage());
        }
    }
}
