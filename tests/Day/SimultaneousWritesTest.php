<?php

namespace App\Tests\Day;

use App\Day\Objective;
use App\Day\UserCalendar;
use App\Entity\Day;
use App\Repository\DayRepository;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;

/**
 * Deux écritures simultanées sur la même journée — deux onglets, deux workers de
 * FrankenPHP — passent l'une après l'autre, et la seconde voit la version de la
 * première : elle ne peut pas écrire sur une journée qu'elle n'a pas vue.
 */
final class SimultaneousWritesTest extends KernelTestCase
{
    private Connection $connection;

    private \PDO $other;

    protected function setUp(): void
    {
        self::bootKernel();
        $this->connection = self::getContainer()->get('doctrine.dbal.default_connection');
        $this->connection->executeStatement('DELETE FROM slot');
        $this->connection->executeStatement('DELETE FROM day');

        // L'autre écriture, par sa propre connexion au même fichier. Elle n'attend
        // pas : un verrou se voit tout de suite.
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

    public function testLaSecondeEcritureAttendQueLaPremiereSoitFinie(): void
    {
        // La première écriture, comme DayWriter la mène : la version d'abord, puis la
        // journée qui se crée.
        $this->connection->beginTransaction();
        self::assertFalse($this->days()->claim(self::date(), 0));
        $this->entityManager()->persist(new Day(self::date(), Objective::HABITUAL));
        $this->entityManager()->flush();

        $this->assertLocked('INSERT INTO day (id, date, objective, version) VALUES (X\'00\', \'2026-10-06\', 450, 1)');

        $this->connection->commit();

        // Elle passe enfin, mais ne trouve plus la version qu'elle croyait la dernière.
        self::assertSame(0, $this->other->exec('UPDATE day SET version = version + 1 WHERE date = \'2026-10-06\' AND version = 0'));
    }

    public function testMemeUneJourneeIntrouvableVerrouilleLaBasePourLaVerifier(): void
    {
        $this->connection->beginTransaction();
        self::assertFalse($this->days()->claim(self::date(), 3), 'Une version 3 d\'une journée qui n\'existe pas est périmée.');

        $this->assertLocked('UPDATE day SET version = version + 1 WHERE date = \'2026-10-06\' AND version = 0');
    }

    private function assertLocked(string $statement): void
    {
        try {
            $this->other->exec($statement);
            self::fail('La seconde écriture est passée pendant la première.');
        } catch (\PDOException $exception) {
            self::assertStringContainsString('database is locked', $exception->getMessage());
        }
    }

    private function days(): DayRepository
    {
        return self::getContainer()->get(DayRepository::class);
    }

    private function entityManager(): EntityManagerInterface
    {
        return self::getContainer()->get(EntityManagerInterface::class);
    }

    private static function date(): \DateTimeImmutable
    {
        return UserCalendar::date('2026-10-06') ?? throw new \LogicException();
    }
}
