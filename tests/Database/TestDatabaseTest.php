<?php

namespace App\Tests\Database;

use App\Tests\Support\DayApi;
use App\Tests\Support\JiraApi;
use App\Tests\Support\TestDatabase;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

/**
 * La purge qui précède chaque test du serveur : elle vide toutes les tables, sans liste à
 * tenir, garde la trace des migrations, et ne touche à rien hors de la base des tests.
 */
final class TestDatabaseTest extends WebTestCase
{
    use DayApi;
    use JiraApi;

    public function testToutesLesTablesSeVidentSaufCelleDesMigrations(): void
    {
        $this->fill();
        $filled = $this->rowCounts();
        foreach (['day', 'slot', 'favorite', 'ticket', 'jira_connection', 'settings', 'empty_day_watch'] as $table) {
            self::assertGreaterThan(0, $filled[$table] ?? 0, $table.' devait avoir des lignes avant la purge.');
        }
        $migrations = $this->connection()->fetchOne('SELECT COUNT(*) FROM doctrine_migration_versions');

        self::purgeDatabase();

        self::assertSame(array_fill_keys(array_keys($filled), 0), $this->rowCounts(), 'Une table garde des lignes.');
        self::assertGreaterThan(0, $migrations);
        self::assertSame($migrations, $this->connection()->fetchOne('SELECT COUNT(*) FROM doctrine_migration_versions'), 'La trace des migrations est restée.');
    }

    public function testHorsDesTestsLaPurgeRefuseSansRienToucher(): void
    {
        $this->fill();
        $filled = $this->rowCounts();

        foreach (['dev', 'prod', ''] as $environment) {
            try {
                TestDatabase::purge($this->connection(), $environment);
                self::fail('La purge a tourné en « '.$environment.' ».');
            } catch (\LogicException $refusal) {
                self::assertStringContainsString('pour les tests', $refusal->getMessage());
            }
        }

        self::assertSame($filled, $this->rowCounts());
    }

    /** Une journée envoyée nulle part, un objectif, un favori, Jira relié, ses tickets lus. */
    private function fill(): void
    {
        $this->linkJira();
        $this->watchEmptyDaysSince('2026-09-30 10:00:00 Europe/Paris');
        $day = $this->write(0, [self::work('09:00', '10:00', 'SHOP-482'), self::pause('12:00', '13:00')]);
        $this->putObjective(self::intAt($day, 'version'), 420);
        [$status] = $this->send('POST', '/api/favorites', ['ticket' => 'SHOP-482', 'position' => 0]);
        self::assertSame(201, $status);
        [$status] = $this->send('PUT', '/api/settings/habitual-objective', ['objective' => 450]);
        self::assertSame(200, $status);
    }

    /**
     * Le nombre de lignes de chaque table du schéma, sauf celle des migrations.
     *
     * @return array<string, int>
     */
    private function rowCounts(): array
    {
        $counts = [];
        foreach ($this->connection()->createSchemaManager()->introspectTableNames() as $table) {
            $name = $table->getUnqualifiedName()->getValue();
            if ('doctrine_migration_versions' !== $name) {
                $count = $this->connection()->fetchOne('SELECT COUNT(*) FROM '.$name);
                self::assertIsNumeric($count);
                $counts[$name] = (int) $count;
            }
        }
        ksort($counts);

        return $counts;
    }
}
