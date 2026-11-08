<?php

namespace App\Tests\V1;

use App\Day\UserCalendar;
use App\Dev\Jira\Catalog;
use App\Entity\EmptyDayWatch;
use App\Jira\JiraClient;
use App\Tests\Support\DayApi;
use App\Tests\Support\JiraApi;
use App\Tests\Support\V1Base;
use App\V1\V1Importer;
use App\V1\V1ImportResult;
use App\V1\V1Jira;
use Doctrine\DBAL\ParameterType;
use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\Query\Query;
use Doctrine\Migrations\Version\Version;
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Clock\Clock;
use Symfony\Component\Clock\ClockInterface;

/**
 * Le passage de la v1 à la v2, sur des bases créées avec le schéma exact de la 1.1.0 et
 * d'une préversion de la v1, deux migrations plus loin : tout est repris, une fois, en entier ou pas du tout, et ce que la v2
 * refuserait n'est jamais arrondi. Ce qui est repris se relit par l'API, comme l'écran.
 */
final class V1ImporterTest extends WebTestCase
{
    use DayApi;
    use JiraApi;

    private const string DAY = '2026-10-05';
    private const string EMPTY_DAY_WATCH_REPAIR = 'DoctrineMigrations\Version20261106134806';

    /**
     * @return iterable<string, array{string}>
     */
    public static function versions(): iterable
    {
        yield '1.1.0' => [V1Base::RELEASE];
        yield 'une préversion, deux migrations plus loin' => [V1Base::PREVIEW];
    }

    #[DataProvider('versions')]
    public function testToutEstReprisEtSeRelitDansLaJournee(string $version): void
    {
        $v1 = new V1Base($version);
        $day = $v1->day(self::DAY, 390);
        $v1->entry($day, self::DAY, '09:00', '09:15', 'SHOP-482', 'Relecture', 'Un titre');
        $v1->entry($day, self::DAY, '09:15', '09:30', 'SHOP-482', 'Relecture', 'Un titre');
        $v1->entry($day, self::DAY, '10:00', '11:30', 'OPS-12');
        $v1->pause($day, self::DAY, '12:00', '13:00');

        self::assertSame(V1ImportResult::Done, $this->import($v1));

        $read = $this->day(self::DAY);
        self::assertSame(['09:00-09:30 SHOP-482 « Relecture »', '10:00-11:30 OPS-12', '12:00-13:00 pause'], self::blocks($read));
        self::assertSame(390, self::at($read, 'objective'));
        self::assertSame(1, $this->fetchInt('SELECT objective_chosen FROM day'));
    }

    public function testLancienneBaseNeChangeJamais(): void
    {
        $v1 = new V1Base();
        $v1->entry($v1->day(self::DAY), self::DAY, '09:00', '09:15', 'SHOP-482');
        $before = hash_file('sha256', $v1->path);

        $this->import($v1);

        self::assertSame($before, hash_file('sha256', $v1->path));
    }

    public function testUneSaisieEnQuartsDheureEtLeTotalSontExacts(): void
    {
        $v1 = new V1Base();
        $day = $v1->day(self::DAY);
        foreach ([['09:00', '09:15'], ['09:15', '09:30'], ['09:30', '10:00']] as [$start, $end]) {
            $v1->entry($day, self::DAY, $start, $end, 'SHOP-482');
        }
        $v1->pause($day, self::DAY, '10:00', '10:15');
        $this->import($v1);

        self::assertCount(5, $this->rows(self::DAY));
        self::assertSame(60, self::at(self::arrayAt($this->day(self::DAY), 'figures'), 'worked'));
    }

    public function testUneJourneeVideALobjectifHabituelNeCreeRien(): void
    {
        $v1 = new V1Base();
        $v1->day(self::DAY);
        $this->import($v1);

        self::assertSame(0, $this->dayRows());
    }

    public function testUneJourneeVideGardeSonObjectifChoisi(): void
    {
        $v1 = new V1Base();
        $v1->day(self::DAY, 225);
        $this->import($v1);

        self::assertSame(225, self::at($this->day(self::DAY), 'objective'));
    }

    public function testUneJourneeEnvoyeeEtSesVoisinesGardentLeurEtat(): void
    {
        $v1 = new V1Base();
        $sent = $v1->day('2026-10-05', syncedAt: '2026-10-05 16:00:00', syncedTickets: ['SHOP-482']);
        $v1->entry($sent, '2026-10-05', '09:00', '09:30', 'SHOP-482', 'Relecture');
        $modified = $v1->day('2026-10-02', syncedTickets: ['SHOP-482', 'OPS-12']);
        $v1->entry($modified, '2026-10-02', '09:00', '09:30', 'SHOP-482');
        $never = $v1->day('2026-10-01');
        $v1->entry($never, '2026-10-01', '09:00', '09:30', 'SHOP-482');
        $this->import($v1, new V1Jira('https://jira', Catalog::ACCOUNT_EMAIL, Catalog::API_TOKEN));

        self::assertSame('sent', $this->sendState('2026-10-05'));
        self::assertSame('modified', $this->sendState('2026-10-02'));
        self::assertNull(self::at(self::arrayAt($this->day('2026-10-02'), 'send'), 'sentAt'));
        self::assertSame('unsent', $this->sendState('2026-10-01'));

        self::assertSame('2026-10-05 16:00:00', $this->connection()->fetchOne("SELECT sent_at FROM day_send JOIN day ON day.id = day_send.day_id WHERE day.date = '2026-10-05'"));
        self::assertSame('["SHOP-482","OPS-12"]', $this->connection()->fetchOne("SELECT touched FROM day_send JOIN day ON day.id = day_send.day_id WHERE day.date = '2026-10-02'"));
    }

    public function testLeCalendrierLitLEtatRepris(): void
    {
        $v1 = new V1Base();
        $v1->entry($v1->day('2026-10-05', syncedAt: '2026-10-05 16:00:00', syncedTickets: ['SHOP-482']), '2026-10-05', '09:00', '16:30', 'SHOP-482');
        $v1->entry($v1->day('2026-10-02'), '2026-10-02', '09:00', '16:30', 'SHOP-482');
        $this->import($v1, new V1Jira('https://jira', Catalog::ACCOUNT_EMAIL, Catalog::API_TOKEN));

        $this->browser->request('GET', '/api/calendar/2026-10-01/2026-10-31');
        self::assertResponseIsSuccessful();
        $marks = self::arrayAt(json_decode((string) $this->browser->getResponse()->getContent(), true, flags: \JSON_THROW_ON_ERROR), 'marks');

        self::assertSame('sent', $marks['2026-10-05']);
        self::assertSame('unsent', $marks['2026-10-02']);
    }

    public function testUneJourneeVideeApresEnvoiGardeSesTicketsPourLesRetirerDeJira(): void
    {
        $v1 = new V1Base();
        $v1->day(self::DAY, syncedTickets: ['SHOP-482']);
        $this->import($v1, new V1Jira('https://jira', Catalog::ACCOUNT_EMAIL, Catalog::API_TOKEN));

        self::assertSame('modified', $this->sendState(self::DAY));
    }

    public function testLesFavorisGardentLeurOrdreEtLeurNom(): void
    {
        $v1 = new V1Base();
        $v1->favorite('OPS-12', 3, 'Réunions');
        $v1->favorite('SHOP-482', 1, title: 'Un titre');
        $this->import($v1);

        self::assertSame(
            [['ticket' => 'SHOP-482', 'name' => null, 'position' => 0], ['ticket' => 'OPS-12', 'name' => 'Réunions', 'position' => 1]],
            $this->connection()->fetchAllAssociative('SELECT ticket, name, position FROM favorite ORDER BY position'),
        );
        self::assertSame('Un titre', $this->connection()->fetchOne("SELECT title FROM ticket WHERE ticket_key = 'SHOP-482'"));
    }

    /**
     * @return iterable<string, array{?string, ?string, ?string, string}>
     */
    public static function refused(): iterable
    {
        yield 'pas sur un quart d\'heure' => ['09:10', '09:30', 'SHOP-482', 'work'];
        yield 'finit hors du quart d\'heure' => ['09:00', '09:20', 'SHOP-482', 'work'];
        yield 'avant 07:00' => ['06:45', '07:15', 'SHOP-482', 'work'];
        yield 'après 20:00' => ['19:45', '20:15', 'SHOP-482', 'work'];
        yield 'à minuit' => ['00:00', '00:15', 'SHOP-482', 'work'];
        yield 'finit avant de commencer' => ['10:00', '09:00', 'SHOP-482', 'work'];
        yield 'sans fin' => ['09:00', null, 'SHOP-482', 'work'];
        yield 'sans ticket' => ['09:00', '09:15', null, 'work'];
        yield 'ticket sans la forme de Jira' => ['09:00', '09:15', 'PROJET', 'work'];
        yield 'type inconnu' => ['09:00', '09:15', 'SHOP-482', 'autre'];
    }

    #[DataProvider('refused')]
    public function testCeQueLaV2RefuseResteDeCoteSansArrondi(?string $start, ?string $end, ?string $ticket, string $type): void
    {
        $v1 = new V1Base();
        $day = $v1->day(self::DAY, syncedAt: '2026-10-05 16:00:00', syncedTickets: ['OPS-12']);
        $v1->entry($day, self::DAY, '14:00', '14:15', 'OPS-12');
        $v1->entry($day, self::DAY, (string) $start, $end, $ticket, type: $type);
        $this->import($v1, new V1Jira('https://jira', Catalog::ACCOUNT_EMAIL, Catalog::API_TOKEN));

        self::assertSame(['14:00-14:15 OPS-12'], self::blocks($this->day(self::DAY)));
        self::assertSame([['date' => self::DAY, 'start' => (string) $start, 'end' => $end, 'ticket' => $ticket]], $this->leftOut()['entries']);
        // Jira peut avoir des heures que la journée ne montre plus : elle ne se dit pas envoyée.
        self::assertSame('modified', $this->sendState(self::DAY));
    }

    public function testSurUnChevauchementLaPremiereResteEtLautreSeDit(): void
    {
        $v1 = new V1Base();
        $day = $v1->day(self::DAY);
        $v1->entry($day, self::DAY, '09:00', '10:00', 'SHOP-482');
        $v1->entry($day, self::DAY, '09:30', '10:30', 'OPS-12');
        $this->import($v1);

        self::assertSame(['09:00-10:00 SHOP-482'], self::blocks($this->day(self::DAY)));
        self::assertSame([['date' => self::DAY, 'start' => '09:30', 'end' => '10:30', 'ticket' => 'OPS-12']], $this->leftOut()['entries']);
    }

    /**
     * @return iterable<string, array{int, int}>
     */
    public static function objectives(): iterable
    {
        yield 'plus de 13 h' => [1440, 780];
        yield 'pas au quart d\'heure' => [440, 435];
        yield 'la plus petite valeur de la v1' => [1, 0];
    }

    #[DataProvider('objectives')]
    public function testUnObjectifHorsRegleDevientLePlusProcheEtSeDit(int $target, int $expected): void
    {
        $v1 = new V1Base();
        $v1->day(self::DAY, $target);
        $this->import($v1);

        self::assertSame($expected, self::at($this->day(self::DAY), 'objective'));
        self::assertSame([['date' => self::DAY, 'from' => $target, 'to' => $expected]], $this->leftOut()['objectives']);
    }

    public function testUnCommentaireSurPlusieursLignesTientSurUneSeule(): void
    {
        $v1 = new V1Base();
        $v1->entry($v1->day(self::DAY), self::DAY, '09:00', '09:15', 'shop-482', "Une\nrelecture  rapide ");
        $this->import($v1);

        self::assertSame(['09:00-09:15 SHOP-482 « Une relecture rapide »'], self::blocks($this->day(self::DAY)));
    }

    public function testLaRepriseNeSeFaitQuuneFois(): void
    {
        $v1 = new V1Base();
        $v1->entry($v1->day(self::DAY), self::DAY, '09:00', '09:15', 'SHOP-482');
        // Le jour de la reprise, celui de l'horloge figée, vient après la dernière écriture de la v1.
        touch($v1->path, strtotime('2026-01-01'));
        self::assertSame(V1ImportResult::Done, $this->import($v1));
        $this->write(1, [self::clear('09:00', '09:15')], self::DAY);

        self::assertSame(V1ImportResult::AlreadyDone, $this->import($v1));
        self::assertSame([], $this->rows(self::DAY));
    }

    public function testRevenuEnV1PuisRepasseEnV2CeQuiASuivieSeDitSansSeReprendre(): void
    {
        $v1 = new V1Base();
        $day = $v1->day(self::DAY);
        $v1->entry($day, self::DAY, '09:00', '09:15', 'SHOP-482');
        touch($v1->path, strtotime('2026-01-01'));
        $this->import($v1);

        $v1->entry($day, self::DAY, '10:00', '10:15', 'OPS-12');
        touch($v1->path, strtotime('2026-12-01'));

        self::assertSame(V1ImportResult::V1ChangedSince, $this->import($v1));
        self::assertCount(1, $this->rows(self::DAY));
    }

    public function testUnFavoriSansLaFormeDUnTicketSeDit(): void
    {
        $v1 = new V1Base();
        $v1->favorite('PROJET', 0);
        $v1->favorite('SHOP-482', 1);
        $this->import($v1);

        self::assertSame(['PROJET'], $this->leftOut()['favorites']);
        self::assertSame('SHOP-482', $this->connection()->fetchOne('SELECT ticket FROM favorite'));
    }

    public function testSansJiraAuDemarrageLePremierReliAdopteLesEnvoisEtRelitTout(): void
    {
        $v1 = new V1Base();
        $v1->entry($v1->day(self::DAY, syncedAt: '2026-10-05 16:00:00', syncedTickets: ['SHOP-482', 'OPS-12']), self::DAY, '09:00', '09:30', 'SHOP-482');
        $this->import($v1);

        $this->linkJira();

        self::assertSame(Catalog::ACCOUNT_ID, $this->connection()->fetchOne('SELECT account_id FROM day_send'));
        self::assertSame('["SHOP-482","OPS-12"]', $this->connection()->fetchOne('SELECT touched FROM day_send'));
        self::assertSame('sent', $this->sendState(self::DAY));
    }

    public function testUnJetonDeLaPasserelleRemplaceEnTapantLeSiteGardeLesEnvois(): void
    {
        $v1 = new V1Base();
        $v1->entry($v1->day(self::DAY, syncedAt: '2026-10-05 16:00:00', syncedTickets: ['SHOP-482']), self::DAY, '09:00', '09:30', 'SHOP-482');
        $this->import($v1, new V1Jira('https://api.atlassian.com/ex/jira/'.Catalog::CLOUD_ID, Catalog::ACCOUNT_EMAIL, Catalog::V1_SCOPED_TOKEN));

        $this->linkJira(Catalog::API_TOKEN, 'https://jira');

        self::assertSame(Catalog::ACCOUNT_ID, $this->connection()->fetchOne('SELECT account_id FROM day_send'));
        self::assertSame('sent', $this->sendState(self::DAY));
    }

    public function testAucunCongeDeLaV1NeSeSignaleIncomplet(): void
    {
        // La migration a posé le point de départ au démarrage, avant la reprise.
        $this->watchEmptyDaysSince('2026-09-01 09:00:00 Europe/Paris');
        $v1 = new V1Base();
        $v1->day('2026-10-02', 300);
        $v1->day('2026-10-01', syncedTickets: ['SHOP-482']);
        $v1->entry($v1->day('2026-09-30'), '2026-09-30', '09:00', '16:30', 'SHOP-482');

        self::assertSame(V1ImportResult::Done, $this->import($v1, new V1Jira('https://jira', Catalog::ACCOUNT_EMAIL, Catalog::API_TOKEN)));

        $this->browser->request('GET', '/api/calendar/2026-09-28/2026-11-01');
        self::assertResponseIsSuccessful();
        self::assertSame(
            ['2026-09-30' => 'unsent', '2026-10-01' => 'modified'],
            self::arrayAt(json_decode((string) $this->browser->getResponse()->getContent(), true, flags: \JSON_THROW_ON_ERROR), 'marks'),
            'Les jours vides d\'avant la reprise ne se signalent pas, avec ou sans ligne.',
        );
        self::assertSame('2026-10-06 13:20:00', $this->connection()->fetchOne('SELECT since FROM empty_day_watch'), 'Le point de départ passe à l\'heure de la reprise.');
        self::assertSame(1, $this->fetchInt('SELECT COUNT(*) FROM empty_day_watch'));
    }

    public function testSansPointDeDepartLaRepriseLePose(): void
    {
        $v1 = new V1Base();
        $v1->day('2026-10-02', 300);
        $this->import($v1);

        self::assertSame('2026-10-06 13:20:00', $this->connection()->fetchOne('SELECT since FROM empty_day_watch'));
    }

    public function testLePointDeDepartNeFaitPasRefuserLaReprise(): void
    {
        $this->watchEmptyDaysSince('2026-10-06 08:00:00 Europe/Paris');
        $v1 = new V1Base();
        $v1->entry($v1->day(self::DAY), self::DAY, '10:00', '10:15', 'SHOP-482');

        self::assertSame(V1ImportResult::Done, $this->import($v1), 'Il n\'est pas une donnée de la v2.');
        self::assertSame('2026-10-06 13:20:00', $this->connection()->fetchOne('SELECT since FROM empty_day_watch'));
    }

    /**
     * Le chemin d'une installation neuve : les migrations, toutes, puis la reprise. La v2 a
     * démarré la semaine d'avant, et la base de la v1 n'est arrivée qu'ensuite.
     */
    public function testLaRepriseRepousseLePointDeDepartQueLesMigrationsOntPose(): void
    {
        $this->watchEmptyDaysAsMigrated('2026-09-30 07:00:00');
        $this->migrate(self::EMPTY_DAY_WATCH_REPAIR);

        $this->import(self::v1WithOneFullDay());

        self::assertSame(['2026-10-05' => 'unsent'], $this->marks(), 'Les jours vides d\'avant la reprise ne se signalent pas.');
        self::assertSame('2026-10-06 13:20:00', $this->connection()->fetchOne('SELECT since FROM empty_day_watch'));
    }

    /**
     * Une installation reprise par la 2.0.0 : sa reprise visait un identifiant que Doctrine
     * ne retrouvait pas, et les congés de la v1 se disaient « Incomplet ». La migration lui
     * donne l'heure que la reprise aurait écrite, et Doctrine retrouve la ligne ensuite.
     */
    public function testLaMigrationRepareUneRepriseFaiteParLa200(): void
    {
        $this->watchEmptyDaysAsMigrated('2026-09-30 07:00:00');
        $this->import(self::v1WithOneFullDay());
        self::assertSame(
            ['2026-10-01' => 'incomplete', '2026-10-02' => 'incomplete', '2026-10-05' => 'unsent'],
            $this->marks(),
            'L\'état que la 2.0.0 laissait : le point de départ n\'avait pas bougé.',
        );

        $this->migrate(self::EMPTY_DAY_WATCH_REPAIR);

        self::assertSame(['2026-10-05' => 'unsent'], $this->marks());
        self::assertSame('2026-10-06 13:20:00', $this->connection()->fetchOne('SELECT since FROM empty_day_watch'));
        $watch = static::getContainer()->get(EntityManagerInterface::class)->getRepository(EmptyDayWatch::class)->findOneBy([]);
        self::assertNotNull($watch);
        $watch->notBefore(new \DateTimeImmutable('2026-10-07 08:00:00 UTC'));
        static::getContainer()->get(EntityManagerInterface::class)->flush();
        self::assertSame('2026-10-07 08:00:00', $this->connection()->fetchOne('SELECT since FROM empty_day_watch'), 'Doctrine retrouve la ligne.');
    }

    /**
     * Une installation reprise avant que le point de départ n'existe : la migration qui
     * l'apporte l'a posé après la reprise, et il y reste.
     *
     * @return iterable<string, array{string}>
     */
    public static function watchesFromTheImportOn(): iterable
    {
        yield 'à l\'heure de la reprise' => ['2026-10-06 13:20:00'];
        yield 'après elle' => ['2026-10-07 07:00:00'];
    }

    #[DataProvider('watchesFromTheImportOn')]
    public function testLaMigrationNeReculeJamaisLePointDeDepart(string $since): void
    {
        $this->watchEmptyDaysAsMigrated($since);
        $this->import(self::v1WithOneFullDay());

        $this->migrate(self::EMPTY_DAY_WATCH_REPAIR);

        self::assertSame($since, $this->connection()->fetchOne('SELECT since FROM empty_day_watch'));
        self::assertSame('text', $this->connection()->fetchOne('SELECT typeof(id) FROM empty_day_watch'));
    }

    public function testSansRepriseLaMigrationNeDeplacePasLePointDeDepart(): void
    {
        $this->watchEmptyDaysAsMigrated('2026-09-30 07:00:00');

        $this->migrate(self::EMPTY_DAY_WATCH_REPAIR);

        self::assertSame('2026-09-30 07:00:00', $this->connection()->fetchOne('SELECT since FROM empty_day_watch'));
        self::assertSame('text', $this->connection()->fetchOne('SELECT typeof(id) FROM empty_day_watch'));
    }

    public function testUneInstallationQuiASesDonneesNeSeMelePas(): void
    {
        $this->write(0, [self::work('09:00', '09:15', 'OPS-12')], self::DAY);
        $v1 = new V1Base();
        $v1->entry($v1->day(self::DAY), self::DAY, '10:00', '10:15', 'SHOP-482');

        self::assertSame(V1ImportResult::V2InUse, $this->import($v1));
        self::assertSame(['09:00-09:15 OPS-12'], self::blocks($this->day(self::DAY)));
    }

    public function testSansBaseDeLaV1RienNeSePasse(): void
    {
        self::assertSame(V1ImportResult::NoV1Base, $this->importer('/nulle/part.db')->import(null));
        self::assertSame(0, $this->fetchInt('SELECT COUNT(*) FROM v1_import'));
    }

    public function testUneBaseDuneFormeInconnueArreteToutSansRienEcrire(): void
    {
        $v1 = new V1Base();
        $v1->exec('DROP TABLE favorite_ticket');

        try {
            $this->import($v1);
            self::fail('La reprise aurait dû refuser.');
        } catch (\RuntimeException $exception) {
            self::assertStringContainsString('favorite_ticket', $exception->getMessage());
        }

        self::assertSame(0, $this->fetchInt('SELECT COUNT(*) FROM v1_import'));
    }

    public function testUnFichierQuiNestPasUneBaseArreteToutSansRienEcrire(): void
    {
        $v1 = new V1Base();
        file_put_contents($v1->path, str_repeat('pas une base', 200));

        $this->expectException(\RuntimeException::class);
        $this->import($v1);
    }

    public function testUneErreurEnRouteNeLaisseRienEtLaRepriseSeRelance(): void
    {
        $v1 = new V1Base();
        $v1->entry($v1->day(self::DAY), self::DAY, '09:00', '09:15', 'SHOP-482');
        $v1->favorite('OPS-12', 0);

        $broken = new class implements ClockInterface {
            public function now(): \DateTimeImmutable
            {
                throw new \RuntimeException('Panne au dernier moment');
            }

            public function sleep(float|int $seconds): void
            {
            }

            public function withTimeZone(\DateTimeZone|string $timezone): static
            {
                return $this;
            }
        };

        try {
            $this->importer($v1->path, $broken)->import(new V1Jira('https://jira', Catalog::ACCOUNT_EMAIL, Catalog::API_TOKEN));
            self::fail('La reprise aurait dû échouer.');
        } catch (\RuntimeException $exception) {
            self::assertSame('Panne au dernier moment', $exception->getMessage());
        }

        foreach (['day', 'slot', 'favorite', 'jira_connection', 'v1_import'] as $table) {
            self::assertSame(0, $this->fetchInt('SELECT COUNT(*) FROM '.$table), $table);
        }

        self::assertSame(V1ImportResult::Done, $this->import($v1));
        self::assertCount(1, $this->rows(self::DAY));
    }

    public function testLeJiraDeLAncienFichierEvitLaBienvenueEtLeJetonSeChiffre(): void
    {
        $this->import(new V1Base(), new V1Jira('http://jira/', Catalog::ACCOUNT_EMAIL, Catalog::API_TOKEN));

        $row = $this->connection()->fetchAssociative('SELECT * FROM jira_connection');
        self::assertIsArray($row);
        self::assertSame('https://jira', $row['site']);
        self::assertIsString($row['encrypted_token']);
        self::assertStringNotContainsString(Catalog::API_TOKEN, $row['encrypted_token']);
        self::assertSame(Catalog::API_TOKEN, $this->cipher()->decrypt($row['encrypted_token']));

        $this->browser->request('GET', '/bienvenue');
        self::assertResponseRedirects();
    }

    public function testLAdresseDeLaPasserelleDeLaV1EstGardee(): void
    {
        $this->import(new V1Base(), new V1Jira('https://api.atlassian.com/ex/jira/'.Catalog::CLOUD_ID, Catalog::ACCOUNT_EMAIL, Catalog::SCOPED_TOKEN));

        $row = $this->connection()->fetchAssociative('SELECT site, instance FROM jira_connection');
        self::assertSame(['site' => 'https://api.atlassian.com/ex/jira/'.Catalog::CLOUD_ID, 'instance' => Catalog::CLOUD_ID], $row);
    }

    /**
     * @return iterable<string, array{string, string, string}>
     */
    public static function unusable(): iterable
    {
        yield 'sans adresse' => ['', Catalog::ACCOUNT_EMAIL, Catalog::API_TOKEN];
        yield 'sans e-mail' => ['https://jira', '', Catalog::API_TOKEN];
        yield 'sans jeton' => ['https://jira', Catalog::ACCOUNT_EMAIL, ''];
        yield 'l\'adresse d\'exemple du modèle de la v1' => ['https://api.atlassian.com/ex/jira/<CLOUD_ID>', Catalog::ACCOUNT_EMAIL, Catalog::API_TOKEN];
        yield 'une adresse illisible' => ['pas une adresse', Catalog::ACCOUNT_EMAIL, Catalog::API_TOKEN];
    }

    #[DataProvider('unusable')]
    public function testUnFichierSansJiraUtilisableMeneALaBienvenue(string $address, string $email, string $token): void
    {
        $this->import(new V1Base(), V1Jira::of($address, $email, $token));

        self::assertSame(0, $this->fetchInt('SELECT COUNT(*) FROM jira_connection'));
    }

    public function testLeCompteSeConfirmeALaPremiereReponseDeJiraEtGardeLesEnvois(): void
    {
        $v1 = new V1Base();
        $v1->entry($v1->day(self::DAY, syncedAt: '2026-10-05 16:00:00', syncedTickets: ['SHOP-482']), self::DAY, '09:00', '09:30', 'SHOP-482');
        $this->import($v1, new V1Jira('https://jira', Catalog::ACCOUNT_EMAIL, Catalog::API_TOKEN));
        self::assertSame('', $this->connection()->fetchOne('SELECT account_id FROM jira_connection'));

        $this->send('POST', '/api/jira/check', []);

        self::assertSame(Catalog::ACCOUNT_ID, $this->connection()->fetchOne('SELECT account_id FROM jira_connection'));
        self::assertSame(Catalog::ACCOUNT_NAME, $this->connection()->fetchOne('SELECT account_name FROM jira_connection'));
        self::assertSame(Catalog::ACCOUNT_ID, $this->connection()->fetchOne('SELECT account_id FROM day_send'));
        self::assertSame('sent', $this->sendState(self::DAY));
    }

    public function testRienNePartTantQueLeCompteNestPasConnu(): void
    {
        $v1 = new V1Base();
        $v1->entry($v1->day(self::DAY), self::DAY, '09:00', '09:30', 'SHOP-482');
        $this->import($v1, new V1Jira('https://jira', Catalog::ACCOUNT_EMAIL, Catalog::API_TOKEN));
        $this->simulate('panne', ['panne' => true]);

        [$status, $body] = $this->send('POST', '/api/days/'.self::DAY.'/send', ['version' => 1]);

        self::assertSame(200, $status, (string) json_encode($body));
        self::assertSame([], $this->worklogsOf(Catalog::ACCOUNT_ID));
        self::assertSame('', $this->connection()->fetchOne('SELECT account_id FROM jira_connection'));
    }

    public function testUnEnvoiConfirmeLeCompteEtNeToucheQueSesHeures(): void
    {
        $v1 = new V1Base();
        $v1->entry($v1->day(self::DAY), self::DAY, '09:00', '09:30', 'SHOP-482');
        $this->import($v1, new V1Jira('https://jira', Catalog::ACCOUNT_EMAIL, Catalog::API_TOKEN));

        [$status] = $this->send('POST', '/api/days/'.self::DAY.'/send', ['version' => 1]);

        self::assertSame(200, $status);
        self::assertSame(Catalog::ACCOUNT_ID, $this->connection()->fetchOne('SELECT account_id FROM day_send'));
        self::assertSame('sent', $this->sendState(self::DAY));
        self::assertCount(1, $this->worklogsOf(Catalog::ACCOUNT_ID));
        self::assertCount(1, $this->worklogsOf(Catalog::COLLEAGUE_ID));
    }

    public function testUnJetonDeLaV1ADeuxPerimetresDitCeQuiManqueEtLeSuivantConfirme(): void
    {
        $v1 = new V1Base();
        $v1->entry($v1->day(self::DAY, syncedAt: '2026-10-05 16:00:00', syncedTickets: ['SHOP-482']), self::DAY, '09:00', '09:30', 'SHOP-482');
        $this->import($v1, new V1Jira('https://api.atlassian.com/ex/jira/'.Catalog::CLOUD_ID, Catalog::ACCOUNT_EMAIL, Catalog::V1_SCOPED_TOKEN));

        [, $check] = $this->send('POST', '/api/jira/check', []);
        self::assertSame('missing_scope', self::at($check, 'status'));
        self::assertSame(['read:jira-user'], self::at($check, 'missingScopes'));

        $this->linkJira(Catalog::SCOPED_TOKEN, 'https://api.atlassian.com/ex/jira/'.Catalog::CLOUD_ID);

        self::assertSame(Catalog::ACCOUNT_ID, $this->connection()->fetchOne('SELECT account_id FROM day_send'));
        self::assertSame('sent', $this->sendState(self::DAY));
    }

    public function testRelieAUnAutreCompteLesJourneesRepriesNeSontPasLesSiennes(): void
    {
        $v1 = new V1Base();
        $v1->entry($v1->day(self::DAY, syncedAt: '2026-10-05 16:00:00', syncedTickets: ['SHOP-482']), self::DAY, '09:00', '09:30', 'SHOP-482');
        $this->import($v1, new V1Jira('https://jira', Catalog::ACCOUNT_EMAIL, Catalog::API_TOKEN));

        $this->linkJira(email: Catalog::COLLEAGUE_EMAIL);

        self::assertSame('', $this->connection()->fetchOne('SELECT account_id FROM day_send'));
        self::assertSame('unsent', $this->sendState(self::DAY));
    }

    public function testLaListeSeDitDansLaPageEtSEfface(): void
    {
        $v1 = new V1Base();
        $v1->entry($v1->day(self::DAY), self::DAY, '06:00', '06:15', 'SHOP-482');
        $this->import($v1);

        $this->browser->request('GET', '/'.self::DAY);
        self::assertStringContainsString('06:00', (string) $this->browser->getResponse()->getContent());

        $this->postSeen(self::SAME_ORIGIN);
        self::assertResponseStatusCodeSame(204);
        self::assertSame(['entries' => [], 'objectives' => [], 'favorites' => []], $this->leftOut());
    }

    public function testUneAutrePageNePeutPasEffacerLaListe(): void
    {
        $v1 = new V1Base();
        $v1->entry($v1->day(self::DAY), self::DAY, '06:00', '06:15', 'SHOP-482');
        $this->import($v1);

        $this->postSeen(['HTTP_SEC_FETCH_SITE' => 'cross-site']);

        self::assertResponseStatusCodeSame(403);
        self::assertCount(1, $this->leftOut()['entries']);
    }

    /**
     * @param array<string, string> $server
     */
    private function postSeen(array $server): void
    {
        $this->browser->request('POST', '/api/v1-import/seen', server: ['CONTENT_TYPE' => 'application/json', ...$server], content: '{}');
    }

    /**
     * @return list<mixed>
     */
    private function worklogsOf(string $account): array
    {
        return array_values(array_filter(
            self::listAt($this->jiraState(), 'worklogs'),
            static fn (mixed $worklog): bool => $account === self::at($worklog, 'authorId'),
        ));
    }

    private function import(V1Base $v1, ?V1Jira $jira = null): V1ImportResult
    {
        return $this->importer($v1->path)->import($jira);
    }

    private function importer(string $path, ?ClockInterface $clock = null): V1Importer
    {
        $container = static::getContainer();
        $entityManager = $container->get(EntityManagerInterface::class);
        $jira = $container->get(JiraClient::class);
        $calendar = $container->get(UserCalendar::class);

        return new V1Importer($entityManager, $this->cipher(), $jira, $calendar, $clock ?? Clock::get(), $path);
    }

    /** Une journée pleine le lundi : le jeudi et le vendredi d'avant restent vides, comme des congés. */
    private static function v1WithOneFullDay(): V1Base
    {
        $v1 = new V1Base();
        $v1->entry($v1->day(self::DAY), self::DAY, '09:00', '16:30', 'SHOP-482');

        return $v1;
    }

    /**
     * Le point de départ tel que la migration qui l'apporte l'écrit, identifiant compris, mis
     * ensuite à l'heure dite.
     */
    private function watchEmptyDaysAsMigrated(string $since): void
    {
        $this->connection()->executeStatement('DELETE FROM empty_day_watch');
        foreach ($this->migrationSql('DoctrineMigrations\Version20261102094431') as $query) {
            if (str_starts_with($query->getStatement(), 'INSERT')) {
                $this->execute($query);
            }
        }
        $this->connection()->executeStatement('UPDATE empty_day_watch SET since = ?', [$since]);
        self::assertSame('blob', $this->connection()->fetchOne('SELECT typeof(id) FROM empty_day_watch'));
    }

    private function migrate(string $migration): void
    {
        foreach ($this->migrationSql($migration) as $query) {
            $this->execute($query);
        }
    }

    /**
     * @return array<Query>
     */
    private function migrationSql(string $migration): array
    {
        $planned = static::getContainer()->get('doctrine.migrations.dependency_factory')->getMigrationRepository()->getMigration(new Version($migration))->getMigration();
        $planned->up(new Schema());

        return $planned->getSql();
    }

    /** Une requête de migration, avec ses valeurs et leurs types, comme Doctrine Migrations la joue. */
    private function execute(Query $query): void
    {
        $parameters = $query->getParameters();
        $types = array_map(static fn (mixed $type): ParameterType|string => $type instanceof ParameterType || \is_string($type) ? $type : throw new \LogicException('Un type de valeur inattendu.'), $query->getTypes());
        self::assertIsList($parameters);
        self::assertIsList($types);
        $this->connection()->executeStatement($query->getStatement(), $parameters, $types);
    }

    private function sendState(string $date): mixed
    {
        return self::at(self::arrayAt($this->day($date), 'send'), 'state');
    }

    private function fetchInt(string $sql): int
    {
        $value = $this->connection()->fetchOne($sql);
        self::assertIsNumeric($value);

        return (int) $value;
    }

    /**
     * @return array{entries: list<mixed>, objectives: list<mixed>, favorites: list<mixed>}
     */
    private function leftOut(): array
    {
        $json = $this->connection()->fetchOne('SELECT left_out FROM v1_import');
        self::assertIsString($json);
        /** @var array{entries: list<mixed>, objectives: list<mixed>, favorites: list<mixed>} $leftOut */
        $leftOut = json_decode($json, true, flags: \JSON_THROW_ON_ERROR);

        return $leftOut;
    }
}
