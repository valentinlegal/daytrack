<?php

namespace App\Tests\V1;

use App\Day\UserCalendar;
use App\Jira\JiraClient;
use App\Jira\TokenCipher;
use App\Tests\Support\DayApi;
use App\V1\V1Importer;
use App\V1\V1ImportResult;
use Doctrine\ORM\EntityManagerInterface;
use Pdo\Sqlite;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Clock\Clock;

/**
 * Facultatif : une copie de votre base de la v1, posée dans var/v1/, y passe aussi. Rien
 * de son contenu ne s'affiche.
 */
final class RealV1BaseTest extends WebTestCase
{
    use DayApi;

    /**
     * @return iterable<string, array{?string}>
     */
    public static function copies(): iterable
    {
        yield 'sans copie' => [null];

        foreach (array_filter((array) glob(\dirname(__DIR__, 2).'/var/v1/*.db'), \is_string(...)) as $copy) {
            yield basename($copy) => [$copy];
        }
    }

    #[DataProvider('copies')]
    public function testUneCopieDeVraieBaseEstRepriseAuQuartDheurePres(?string $copy): void
    {
        if (null === $copy) {
            $this->addToAssertionCount(1);

            return;
        }

        $before = hash_file('sha256', $copy);
        $v1 = new \PDO('sqlite:'.$copy, options: [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION, Sqlite::ATTR_OPEN_FLAGS => Sqlite::OPEN_READONLY]);

        $container = static::getContainer();
        $importer = new V1Importer(
            $container->get(EntityManagerInterface::class),
            $container->get(TokenCipher::class),
            $container->get(JiraClient::class),
            $container->get(UserCalendar::class),
            Clock::get(),
            $copy,
        );

        self::assertSame(V1ImportResult::Done, $importer->import(null));

        self::assertSame(self::one($v1, "SELECT COALESCE(SUM((strftime('%s', ended_at) - strftime('%s', started_at)) / 900), 0) FROM time_entry WHERE type = 'work'"), $this->fetchCount("SELECT COUNT(*) FROM slot WHERE kind = 'work'"), 'Les quarts d\'heure de travail.');
        self::assertSame(self::one($v1, "SELECT COALESCE(SUM((strftime('%s', ended_at) - strftime('%s', started_at)) / 900), 0) FROM time_entry WHERE type = 'break'"), $this->fetchCount("SELECT COUNT(*) FROM slot WHERE kind = 'pause'"), 'Les quarts d\'heure de pause.');
        self::assertSame(self::one($v1, 'SELECT COUNT(*) FROM favorite_ticket'), $this->fetchCount('SELECT COUNT(*) FROM favorite'), 'Les favoris.');
        self::assertSame(self::one($v1, 'SELECT COUNT(*) FROM favorite_ticket WHERE custom_name IS NOT NULL'), $this->fetchCount('SELECT COUNT(*) FROM favorite WHERE name IS NOT NULL'), 'Les favoris renommés.');
        self::assertSame(self::one($v1, 'SELECT COUNT(*) FROM work_day d WHERE EXISTS (SELECT 1 FROM time_entry e WHERE e.work_day_id = d.id) OR d.target_minutes <> 450'), $this->fetchCount('SELECT COUNT(*) FROM day'), 'Les journées.');
        self::assertSame(self::one($v1, 'SELECT COUNT(*) FROM work_day WHERE target_minutes <> 450'), $this->fetchCount('SELECT COUNT(*) FROM day WHERE objective_chosen = 1'), 'Les objectifs choisis.');
        self::assertSame(self::one($v1, 'SELECT COUNT(*) FROM work_day WHERE jira_synced_at IS NOT NULL'), $this->fetchCount('SELECT COUNT(*) FROM day_send WHERE sent_at IS NOT NULL'), 'Les journées envoyées.');
        $leftOut = $this->connection()->fetchOne('SELECT left_out FROM v1_import');
        self::assertIsString($leftOut);
        self::assertSame(['entries' => [], 'objectives' => [], 'favorites' => []], json_decode($leftOut, true), 'Rien de laissé de côté.');
        self::assertSame($before, hash_file('sha256', $copy), 'La copie n\'a pas bougé.');
    }

    private static function one(\PDO $pdo, string $sql): int
    {
        $statement = $pdo->query($sql);
        self::assertNotFalse($statement);

        return (int) $statement->fetchColumn();
    }

    private function fetchCount(string $sql): int
    {
        $value = $this->connection()->fetchOne($sql);
        self::assertIsNumeric($value);

        return (int) $value;
    }
}
