<?php

namespace App\Tests\Database;

use App\Database\Lockable;
use App\Database\LockedTransaction;
use App\Entity\Favorite;
use App\Repository\DayRepository;
use App\Repository\DaySendRepository;
use App\Repository\FavoriteRepository;
use App\Repository\IssueTypeRepository;
use App\Repository\JiraConnectionRepository;
use App\Repository\SettingsRepository;
use App\Repository\TicketRepository;
use App\Tests\Support\PurgesDatabase;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;

/**
 * Le chemin commun des écritures : un geste de la grille, un favori, un réglage, la
 * connexion à Jira, un ticket décrit, l'envoi d'une journée. Ce qu'il prouve ici vaut
 * pour chacun, et pour ceux à venir.
 */
final class LockedTransactionTest extends KernelTestCase
{
    use PurgesDatabase;

    private Connection $connection;

    /** Un autre onglet, par sa propre connexion au même fichier. Il n'attend pas : un verrou se voit tout de suite. */
    private \PDO $other;

    protected function setUp(): void
    {
        self::bootKernel();
        $this->connection = self::getContainer()->get('doctrine.dbal.default_connection');
        self::purgeDatabase();

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

    public function testCeQueLeTravailChangeSEcritDUnSeulTenantEtSaValeurRevient(): void
    {
        $favorite = new Favorite('SHOP-482', null, 0);
        $result = $this->transaction()->run($this->favorites(), function () use ($favorite): Favorite {
            $this->entityManager()->persist($favorite);

            return $favorite;
        });

        self::assertSame($favorite, $result);
        self::assertSame(['SHOP-482'], $this->tickets(), 'Écrit sans flush() dans le travail.');
        self::assertFalse($this->connection->isTransactionActive());
        self::assertTrue($this->canWrite());
    }

    public function testUneErreurAuMilieuNEcritRienEtRendLeVerrou(): void
    {
        $failure = new \RuntimeException('Au milieu du travail.');
        $favorite = new Favorite('SHOP-482', null, 0);

        $thrown = null;
        try {
            $this->transaction()->run($this->favorites(), function () use ($favorite, $failure): void {
                $this->entityManager()->persist($favorite);
                // Déjà parti vers la base, mais dans la transaction.
                $this->entityManager()->flush();
                self::assertFalse($this->canWrite(), 'Pendant le travail, la base est à lui.');
                $this->entityManager()->persist(new Favorite('SHOP-377', null, 1));

                throw $failure;
            });
        } catch (\RuntimeException $exception) {
            $thrown = $exception;
        }

        self::assertSame($failure, $thrown, 'L\'erreur repart telle quelle.');
        self::assertSame([], $this->tickets(), 'Rien de ce que le travail a écrit ne reste.');
        self::assertFalse($this->connection->isTransactionActive());
        self::assertTrue($this->canWrite(), 'Le verrou est rendu.');
        self::assertFalse($this->entityManager()->contains($favorite), 'La mémoire ne garde rien que la base n\'a pas.');
        self::assertTrue($this->entityManager()->isOpen(), 'La requête peut encore répondre.');
    }

    public function testLeVerrouEstPrisAvantQueLeTravailNeLise(): void
    {
        $this->transaction()->run($this->favorites(), function (): void {
            // Une lecture d'abord ne ferait pas attendre l'autre onglet : SQLite le
            // refuserait au lieu de le mettre en file.
            self::assertFalse($this->canWrite(), 'Avant même la première lecture, la base est au travail.');
            $this->favorites()->ordered();
        });

        self::assertTrue($this->canWrite());
    }

    public function testUneEcritureVerrouilleeNeSOuvrePasDansUneAutre(): void
    {
        $thrown = null;
        try {
            $this->transaction()->run($this->favorites(), function (): void {
                $this->transaction()->run($this->favorites(), static fn (): bool => true);
            });
        } catch (\LogicException $exception) {
            $thrown = $exception;
        }

        self::assertInstanceOf(\LogicException::class, $thrown);
        self::assertFalse($this->connection->isTransactionActive());
        self::assertTrue($this->canWrite());
    }

    public function testUnTravailQuiNeChangeRienNEcritRien(): void
    {
        self::assertSame([], $this->transaction()->run($this->favorites(), fn (): array => $this->tickets()));

        self::assertSame([], $this->tickets());
        self::assertTrue($this->canWrite());
    }

    /**
     * @param class-string<Lockable> $repository
     */
    #[DataProvider('repositories')]
    public function testChaqueDepotQuiEcritPrendLeVerrou(string $repository): void
    {
        $lock = self::getContainer()->get($repository);
        self::assertInstanceOf(Lockable::class, $lock);

        $this->connection->beginTransaction();
        $lock->lock();

        self::assertFalse($this->canWrite(), 'Une seconde écriture passerait pendant la première.');

        $this->connection->rollBack();
        self::assertTrue($this->canWrite());
    }

    /**
     * @return iterable<string, array{class-string<Lockable>}>
     */
    public static function repositories(): iterable
    {
        foreach ([DayRepository::class, DaySendRepository::class, FavoriteRepository::class, IssueTypeRepository::class, JiraConnectionRepository::class, SettingsRepository::class, TicketRepository::class] as $repository) {
            yield new \ReflectionClass($repository)->getShortName() => [$repository];
        }
    }

    /** Une écriture de l'autre onglet passe-t-elle tout de suite ? */
    private function canWrite(): bool
    {
        try {
            $this->other->exec('BEGIN IMMEDIATE');
        } catch (\PDOException $exception) {
            self::assertStringContainsString('database is locked', $exception->getMessage());

            return false;
        }
        $this->other->exec('ROLLBACK');

        return true;
    }

    /**
     * @return list<string>
     */
    private function tickets(): array
    {
        return array_values(array_filter($this->connection->fetchFirstColumn('SELECT ticket FROM favorite ORDER BY position'), is_string(...)));
    }

    private function transaction(): LockedTransaction
    {
        return self::getContainer()->get(LockedTransaction::class);
    }

    private function favorites(): FavoriteRepository
    {
        return self::getContainer()->get(FavoriteRepository::class);
    }

    private function entityManager(): EntityManagerInterface
    {
        return self::getContainer()->get(EntityManagerInterface::class);
    }
}
