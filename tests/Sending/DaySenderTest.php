<?php

namespace App\Tests\Sending;

use App\Day\DayReader;
use App\Day\StaleDay;
use App\Day\UserCalendar;
use App\Dev\Jira\Catalog;
use App\Dev\Jira\FakeJira;
use App\Dev\Jira\FakeJiraHttpClient;
use App\Dev\Jira\MemoryStore;
use App\Dev\Jira\State;
use App\Dev\Jira\StateStore;
use App\Jira\JiraClient;
use App\Jira\JiraLink;
use App\Repository\DayRepository;
use App\Repository\DaySendRepository;
use App\Sending\DaySender;
use App\Tests\Support\DayApi;
use App\Tests\Support\JiraApi;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Clock\ClockInterface;
use Symfony\Component\Clock\NativeClock;
use Symfony\Component\Uid\Uuid;

/**
 * L'envoi, pendant qu'un autre onglet change la journée ou le compte Jira : ce qui suit
 * l'envoi relit la base, et ne dit jamais envoyé ce que le compte relié n'a pas reçu.
 */
final class DaySenderTest extends WebTestCase
{
    use DayApi;
    use JiraApi;

    public function testUneJourneeChangeePendantLEnvoiSeRelitModifiee(): void
    {
        $this->linkJira();
        $day = $this->write(0, [self::work('09:30', '10:30', 'SHOP-482')]);
        $connection = $this->connection();

        // Le Jira simulé, qui laisse l'autre onglet écrire dès qu'il a reçu la première saisie.
        $store = new class($connection) implements StateStore {
            private MemoryStore $inner;
            private bool $changed = false;

            public function __construct(private readonly \Doctrine\DBAL\Connection $connection)
            {
                $this->inner = new MemoryStore();
            }

            public function update(callable $change): mixed
            {
                $result = $this->inner->update($change);
                $this->inner->update(function (State $state): void {
                    if (!$this->changed && [] !== array_filter($state->worklogs, static fn ($worklog): bool => 'SHOP-482' === $worklog->issueKey)) {
                        $this->changed = true;
                        $this->connection->executeStatement(
                            "INSERT INTO slot (id, day_id, start, kind, ticket, comment) SELECT ?, id, 660, 'work', 'SHOP-377', NULL FROM day WHERE date = ?",
                            [Uuid::v7()->toBinary(), self::TODAY_DATE],
                        );
                        $this->connection->executeStatement('UPDATE day SET version = version + 1 WHERE date = ?', [self::TODAY_DATE]);
                    }
                });

                return $result;
            }

            public function reset(): void
            {
                $this->inner->reset();
            }

            private const string TODAY_DATE = '2026-10-06';
        };

        $container = static::getContainer();
        $sender = new DaySender(
            $container->get(EntityManagerInterface::class),
            $container->get(DayRepository::class),
            $container->get(DaySendRepository::class),
            $container->get(JiraLink::class),
            new JiraClient(FakeJiraHttpClient::create(new FakeJira($store)), 'https://api.atlassian.com', new NativeClock()),
            $container->get(UserCalendar::class),
            $container->get(ClockInterface::class),
        );

        $date = UserCalendar::date(self::TODAY) ?? throw new \LogicException();
        $sender->send($date, self::intAt($day, 'version'));
        $view = $container->get(DayReader::class)->view($date)->toArray();

        self::assertSame(['09:30-10:30 SHOP-482', '11:00-11:15 SHOP-377'], self::blocks($view));
        self::assertSame('modified', $view['send']['state']);
    }

    public function testUnCompteReliePendantQueLEnvoiSePrendNeRecoitRienEtLePremierNePerdRien(): void
    {
        $this->linkJira();
        $day = $this->write(0, [self::work('09:30', '10:30', 'SHOP-482')]);
        [, $sent] = $this->send('POST', '/api/days/'.self::TODAY.'/send', ['version' => self::intAt($day, 'version')]);
        self::assertSame('sent', self::at($sent, 'send', 'state'));
        $day = $this->write(self::intAt($sent, 'version'), [self::work('10:30', '11:00', 'OPS-7')]);

        $container = static::getContainer();
        $connection = $this->connection();
        // Un autre onglet relie un autre compte au moment même où l'envoi se prend.
        $clock = new class($container->get(ClockInterface::class), $connection) implements ClockInterface {
            private bool $relinked = false;

            public function __construct(private readonly ClockInterface $inner, private readonly \Doctrine\DBAL\Connection $connection)
            {
            }

            public function now(): \DateTimeImmutable
            {
                if (!$this->relinked) {
                    $this->relinked = true;
                    $this->connection->executeStatement("UPDATE jira_connection SET account_id = '712020:autre-compte'");
                }

                return $this->inner->now();
            }

            public function sleep(float|int $seconds): void
            {
                $this->inner->sleep($seconds);
            }

            public function withTimeZone(\DateTimeZone|string $timezone): static
            {
                return $this;
            }
        };
        $store = new MemoryStore();
        $sender = new DaySender(
            $container->get(EntityManagerInterface::class),
            $container->get(DayRepository::class),
            $container->get(DaySendRepository::class),
            $container->get(JiraLink::class),
            new JiraClient(FakeJiraHttpClient::create(new FakeJira($store)), 'https://api.atlassian.com', new NativeClock()),
            $container->get(UserCalendar::class),
            $clock,
        );

        $date = UserCalendar::date(self::TODAY) ?? throw new \LogicException();
        try {
            $sender->send($date, self::intAt($day, 'version'));
            self::fail('L\'envoi aurait dû s\'arrêter.');
        } catch (StaleDay) {
        }

        // Rien n'est parti, et l'envoi du premier compte est tel qu'il était.
        self::assertSame([], $store->update(static fn (State $state): array => $state->worklogs));
        $connection->executeStatement('UPDATE jira_connection SET account_id = ?', [Catalog::ACCOUNT_ID]);
        self::assertNull($connection->fetchOne('SELECT refusal FROM jira_connection'));
        self::assertSame('modified', $container->get(DayReader::class)->view($date)->toArray()['send']['state']);
    }

    public function testUneJourneeVideeApresUnEchecNAPlusRienAEnvoyer(): void
    {
        $this->linkJira();
        $day = $this->write(0, [self::work('09:30', '10:30', 'PANNE-1')]);

        [$status, $failed] = $this->send('POST', '/api/days/'.self::TODAY.'/send', ['version' => self::intAt($day, 'version')]);
        self::assertSame(200, $status);
        self::assertSame('failed', self::at($failed, 'send', 'state'));

        // Rien n'est parti vers PANNE-1 : la journée vidée n'en garde rien à retirer.
        $empty = $this->write(self::intAt($failed, 'version'), [self::clear('09:30', '10:30')]);

        self::assertSame('nothing', self::at($empty, 'send', 'state'));
        self::assertSame([], self::at($empty, 'send', 'removed'));
    }
}
