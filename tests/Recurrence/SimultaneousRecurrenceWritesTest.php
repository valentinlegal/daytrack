<?php

namespace App\Tests\Recurrence;

use App\Database\LockedTransaction;
use App\Day\DayWriter;
use App\Day\SlotContent;
use App\Day\StaleDay;
use App\Day\UserCalendar;
use App\Recurrence\RecurrencePoser;
use App\Recurrence\RecurrenceSpec;
use App\Recurrence\Rhythm;
use App\Recurrence\SeenRecurrence;
use App\Recurrence\UntilRewind;
use App\Repository\DayRepository;
use App\Repository\DaySendRepository;
use App\Repository\RecurrenceRepository;
use App\Settings\UserSettings;
use App\Tests\Support\DayApi;
use App\Tests\Support\RecurrenceApi;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\Decorator\EntityManagerDecorator;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Uid\Uuid;

/**
 * Deux workers de FrankenPHP qui écrivent les récurrences en même temps : deux onglets qui
 * passent minuit ensemble, une annulation pendant qu'un autre onglet change la même
 * récurrence depuis une autre journée. Ce qui se lit sous le verrou est le dernier état, et
 * le second ne défait jamais ce que le premier a écrit.
 */
final class SimultaneousRecurrenceWritesTest extends WebTestCase
{
    use DayApi;
    use RecurrenceApi;

    public function testDeuxOngletsQuiPassentMinuitEnsembleNePosentQuUneFois(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:45', 'OPS-12', 'Daily'));
        $this->write(self::intAt($this->day('2026-10-08'), 'version'), [self::work('11:00', '11:15', 'SHOP-482')], '2026-10-08');
        self::mockTime('2026-10-08 00:00:05 Europe/Paris');

        // L'autre worker : son propre noyau, sa propre connexion au même fichier.
        $other = static::createKernel();
        $other->boot();

        try {
            // Il n'existe que dans le conteneur des tests, que l'analyse ne lit pas.
            $otherContainer = $other->getContainer()->get('test.service_container'); // @phpstan-ignore symfonyContainer.serviceNotFound
            self::assertInstanceOf(ContainerInterface::class, $otherContainer);
            $otherPoser = $otherContainer->get(RecurrencePoser::class);

            // Celui-ci a vu la récurrence à poser, et l'autre la pose avant qu'il ait le verrou.
            $container = static::getContainer();
            $entityManager = $container->get(EntityManagerInterface::class);
            $racing = new class($entityManager, $otherPoser) extends EntityManagerDecorator {
                private bool $raced = false;

                public function __construct(EntityManagerInterface $wrapped, private readonly RecurrencePoser $other)
                {
                    parent::__construct($wrapped);
                }

                public function getConnection(): Connection
                {
                    if (!$this->raced) {
                        $this->raced = true;
                        $this->other->pose();
                    }

                    return parent::getConnection();
                }
            };
            $poser = new RecurrencePoser(
                $entityManager,
                new LockedTransaction($racing),
                $container->get(DayRepository::class),
                $container->get(DaySendRepository::class),
                $container->get(RecurrenceRepository::class),
                $container->get(UserCalendar::class),
                $container->get(UserSettings::class),
            );

            $poser->pose();
        } finally {
            $other->shutdown();
        }

        self::assertSame([555 => $id, 570 => $id], $this->links('2026-10-07'));
        self::assertSame([555 => $id, 570 => $id, 660 => null], $this->links('2026-10-08'));
        self::assertSame(1, $this->day('2026-10-07')['version'], 'Née une seule fois.');
        self::assertSame(2, $this->day('2026-10-08')['version'], 'Avancée une seule fois.');
        self::assertSame('2026-10-08', $this->recurrenceRow($id)['posedThrough']);
    }

    public function testUneAnnulationNeDefaitPasUneFinChangeeEntreTempsDansUnAutreOnglet(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));

        // L'annulation de la création : la récurrence se lit d'abord hors du verrou, pour
        // vérifier ses liens (LinksMatchRecurrences)…
        $container = static::getContainer();
        self::assertNotNull($container->get(RecurrenceRepository::class)->byId(Uuid::fromString($id)));

        // … pendant qu'un autre worker repousse sa fin, depuis une autre journée.
        $path = $this->connection()->getParams()['path'] ?? null;
        self::assertIsString($path);
        $other = new \PDO('sqlite:'.$path, options: [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION]);
        $other->prepare('UPDATE recurrence SET until = ? WHERE id = ?')->execute(['2026-10-30', Uuid::fromString($id)->toBinary()]);
        unset($other);

        $date = UserCalendar::date(self::TODAY) ?? throw new \LogicException();
        try {
            $container->get(DayWriter::class)->changeSlots($date, 1, [555 => null], [], [new UntilRewind(Uuid::fromString($id), null, UserCalendar::date('2026-10-05'))]);
            self::fail('L\'annulation est passée sur une fin qu\'elle n\'a pas vue.');
        } catch (StaleDay) {
            self::addToAssertionCount(1);
        }

        self::assertSame('2026-10-30', $this->recurrenceRow($id)['until']);
        self::assertSame([555 => $id], $this->links());
    }

    public function testUnEnregistrementNeSeFiePasAUneRecurrenceLueAvantLeVerrou(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        self::mockTime('2026-10-08 08:00:00 Europe/Paris');
        $version = self::intAt($this->day('2026-10-08'), 'version');

        // Ce worker l'a déjà lue dans cette requête — les récurrences se posent d'abord —, puis
        // un autre l'arrête depuis la fois du mercredi.
        $container = static::getContainer();
        self::assertNotNull($container->get(RecurrenceRepository::class)->byId(Uuid::fromString($id)));
        $path = $this->connection()->getParams()['path'] ?? null;
        self::assertIsString($path);
        $other = new \PDO('sqlite:'.$path, options: [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION]);
        $other->prepare('UPDATE recurrence SET until = ? WHERE id = ?')->execute(['2026-10-06', Uuid::fromString($id)->toBinary()]);
        unset($other);

        $date = UserCalendar::date('2026-10-08') ?? throw new \LogicException();
        try {
            $container->get(DayWriter::class)->saveRecurrence($date, $version, [555 => SlotContent::work('OPS-12', 'Rétro')], new RecurrenceSpec(Rhythm::weekly([1, 2, 3, 4, 5]), null), new SeenRecurrence(Uuid::fromString($id), [1, 2, 3, 4, 5], null));
            self::fail('La récurrence arrêtée ailleurs a été coupée de nouveau, et sa fin repoussée.');
        } catch (StaleDay) {
            self::addToAssertionCount(1);
        }

        self::assertSame('2026-10-06', $this->recurrenceRow($id)['until']);
        self::assertSame(1, $this->recurrenceRows());
    }
}
