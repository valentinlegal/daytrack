<?php

namespace App\Tests\Jira;

use App\Dev\Jira\Catalog;
use App\Dev\Jira\FakeJira;
use App\Dev\Jira\FakeJiraHttpClient;
use App\Dev\Jira\FakeJiraRequest;
use App\Dev\Jira\MemoryStore;
use App\Jira\JiraAccount;
use App\Jira\JiraAddress;
use App\Jira\JiraClient;
use App\Jira\JiraConnected;
use App\Jira\JiraCredentials;
use App\Jira\JiraFailure;
use App\Jira\JiraIssue;
use App\Jira\JiraWorklog;
use App\Jira\WorklogWrite;
use App\Jira\WriteOutcome;
use App\Tests\Support\ReadsJson;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Clock\MockClock;
use Symfony\Component\Clock\NativeClock;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;

/**
 * Ce que DayTrack demande à Jira et comprend de ses réponses, contre le Jira simulé :
 * aussi strict que Jira Cloud, et qui sait refuser, se taire ou ne pas connaître.
 */
final class JiraClientTest extends TestCase
{
    use ReadsJson;

    private const string GATEWAY = 'https://api.atlassian.com';

    private FakeJira $jira;
    private JiraClient $client;

    protected function setUp(): void
    {
        $this->jira = new FakeJira(new MemoryStore());
        $this->client = new JiraClient(FakeJiraHttpClient::create($this->jira), self::GATEWAY, new NativeClock());
    }

    public function testUnJetonSansPerimetreSeRelieParLeSite(): void
    {
        $connected = $this->connect('https://jira', Catalog::API_TOKEN);

        self::assertInstanceOf(JiraConnected::class, $connected);
        self::assertSame('https://jira', $connected->api);
        self::assertEquals(new JiraAccount(Catalog::ACCOUNT_ID, Catalog::ACCOUNT_NAME), $connected->account);
        self::assertSame(Catalog::CLOUD_ID, $connected->cloudId, 'L\'identifiant du site dit de quel Jira il s\'agit.');
    }

    public function testUnJetonAPerimetresSeRelieParLaPasserelleQueDayTrackTrouveSeul(): void
    {
        $connected = $this->connect('jira', Catalog::SCOPED_TOKEN);

        self::assertInstanceOf(JiraConnected::class, $connected);
        self::assertSame(self::GATEWAY.'/ex/jira/'.Catalog::CLOUD_ID, $connected->api);
        self::assertSame(Catalog::ACCOUNT_ID, $connected->account->id);
        self::assertSame(Catalog::CLOUD_ID, $connected->cloudId, 'Par la passerelle, c\'est le même Jira.');
    }

    public function testLAdresseDeLaPasserelleQueFaisaitEcrireLaV1SeGarde(): void
    {
        $connected = $this->connect(self::GATEWAY.'/ex/jira/'.Catalog::CLOUD_ID, Catalog::SCOPED_TOKEN);

        self::assertInstanceOf(JiraConnected::class, $connected);
        self::assertSame(self::GATEWAY.'/ex/jira/'.Catalog::CLOUD_ID, $connected->api);
        self::assertSame(Catalog::CLOUD_ID, $connected->cloudId);
    }

    public function testUnJetonQuiNePeutPasEcrireEstRefuseALaConnexion(): void
    {
        self::assertSame(JiraFailure::MissingScope, $this->connect('https://jira', Catalog::READ_ONLY_TOKEN));
    }

    public function testUnJetonQuiNePeutPasLireLesTicketsEstRefuseALaConnexion(): void
    {
        self::assertSame(JiraFailure::MissingScope, $this->connect('https://jira', Catalog::WRITE_ONLY_TOKEN));
    }

    public function testUnJetonALaV1SansReadJiraUserEstRefusePourSonPerimetre(): void
    {
        self::assertSame(JiraFailure::MissingScope, $this->connect('https://jira', Catalog::V1_SCOPED_TOKEN));
    }

    public function testLesPerimetresQuiManquentSeNommentSansRienEcrire(): void
    {
        $gateway = self::GATEWAY.'/ex/jira/'.Catalog::CLOUD_ID;
        $missing = fn (string $api, string $token): array => $this->client->missingScopes(new JiraCredentials($api, Catalog::ACCOUNT_EMAIL, $token));

        self::assertSame([], $missing($gateway, Catalog::SCOPED_TOKEN));
        self::assertSame(['write:jira-work'], $missing($gateway, Catalog::READ_ONLY_TOKEN));
        self::assertSame(['read:jira-work'], $missing($gateway, Catalog::WRITE_ONLY_TOKEN));
        self::assertSame(['read:jira-user'], $missing($gateway, Catalog::V1_SCOPED_TOKEN));
        self::assertSame([], $missing('https://jira', Catalog::API_TOKEN), 'Rien ne manque à un jeton sans périmètre.');
        self::assertSame([], $missing($gateway, 'jeton-expire'), 'Un jeton refusé ne manque d\'aucun périmètre : il ne passe pas.');

        $state = (array) $this->jira->handle(new FakeJiraRequest('GET', '/_simulation'))->body;
        self::assertSame([], self::listAt($state, 'worklogs'));
    }

    public function testUneRedirectionNeSeSuitPas(): void
    {
        $sent = [];
        $client = new JiraClient(new MockHttpClient(static function (string $method, string $url, array $options) use (&$sent): MockResponse {
            $sent = $options;

            return new MockResponse('', ['http_code' => 301, 'response_headers' => ['Location' => 'http://jira/rest/api/3/myself']]);
        }), self::GATEWAY, new NativeClock());

        self::assertSame(JiraFailure::Unreachable, $client->myself(new JiraCredentials('https://jira', Catalog::ACCOUNT_EMAIL, Catalog::API_TOKEN)));
        self::assertSame(0, $sent['max_redirects'] ?? null, 'Une redirection pourrait repartir en clair.');
    }

    public function testUnMauvaisJetonEstRefuse(): void
    {
        self::assertSame(JiraFailure::Refused, $this->connect('https://jira', 'jeton-expire'));
    }

    public function testUneAdresseOuPersonneNeRepondEstInjoignable(): void
    {
        self::assertSame(JiraFailure::Unreachable, $this->connect('https://exemple.atlassian.net', Catalog::API_TOKEN));
    }

    public function testUnJiraEnPanneEstInjoignable(): void
    {
        $this->jira->handle(new FakeJiraRequest('POST', '/_simulation/panne', body: '{"panne": true}'));

        self::assertSame(JiraFailure::Unreachable, $this->connect('https://jira', Catalog::API_TOKEN));
    }

    public function testSeRelierNEcritRienDansJira(): void
    {
        $this->connect('https://jira', Catalog::SCOPED_TOKEN);
        $state = (array) $this->jira->handle(new FakeJiraRequest('GET', '/_simulation'))->body;

        self::assertSame([], self::listAt($state, 'worklogs'));
        self::assertSame([404], array_column(self::listAt($state, 'journal'), 'status'), 'Seul l\'ajout impossible du test de connexion est parti, et Jira l\'a refusé.');
    }

    public function testUnTicketRendSonTitreEtSonType(): void
    {
        $issue = $this->client->issue($this->credentials(), 'SHOP-519');

        self::assertInstanceOf(JiraIssue::class, $issue);
        self::assertSame('Le total du panier ignore la remise quand le code est saisi en minuscules', $issue->title);
        self::assertSame(['10004', 'Bug', 0], [$issue->type->id, $issue->type->name, $issue->type->level]);
    }

    public function testUneSousTachePrendLeTypeDeSonParentEtGardeSonTitre(): void
    {
        $issue = $this->client->issue($this->credentials(), 'SHOP-531');

        self::assertInstanceOf(JiraIssue::class, $issue);
        self::assertSame('Reproduire le blocage du bouton Payer', $issue->title);
        self::assertSame('Bug', $issue->type->name);
    }

    public function testUnTicketQuiNExistePasEstIntrouvable(): void
    {
        self::assertSame(JiraFailure::NotFound, $this->client->issue($this->credentials(), 'SHOP-999'));
    }

    public function testUnJetonRefuseSeDitPourUnTicketAussi(): void
    {
        $this->jira->handle(new FakeJiraRequest('POST', '/_simulation/jeton', body: '{"refuse": true}'));

        self::assertSame(JiraFailure::Refused, $this->client->issue($this->credentials(), 'SHOP-482'));
    }

    public function testPlusieursTicketsOntChacunLeurReponse(): void
    {
        $issues = $this->client->issues($this->credentials(), ['SHOP-482', 'SHOP-999', 'OPS-12']);

        self::assertSame(['SHOP-482', 'SHOP-999', 'OPS-12'], array_keys($issues));
        self::assertInstanceOf(JiraIssue::class, $issues['SHOP-482']);
        self::assertSame(JiraFailure::NotFound, $issues['SHOP-999']);
        self::assertInstanceOf(JiraIssue::class, $issues['OPS-12']);
    }

    public function testUnJiraQuiTardeEstInjoignable(): void
    {
        $silent = new JiraClient(new MockHttpClient(static fn (): MockResponse => new MockResponse((static function (): \Generator {
            yield '';
        })())), self::GATEWAY, new NativeClock());

        self::assertSame(JiraFailure::Unreachable, $silent->issue($this->credentials(), 'SHOP-482'));
    }

    public function testUneReponseQuiNEstPasCelleDeJiraEstInjoignable(): void
    {
        $other = new JiraClient(new MockHttpClient(new MockResponse('<html>Bienvenue</html>', ['http_code' => 200])), self::GATEWAY, new NativeClock());

        self::assertSame(JiraFailure::Unreachable, $other->myself($this->credentials()));
    }

    public function testRienNePartEnClair(): void
    {
        $sent = [];
        $spy = new JiraClient(new MockHttpClient(static function (string $method, string $url) use (&$sent): MockResponse {
            $sent[] = $url;

            return new MockResponse('{}');
        }), self::GATEWAY, new NativeClock());

        self::assertSame(JiraFailure::Unreachable, $spy->myself(new JiraCredentials('http://jira', Catalog::ACCOUNT_EMAIL, Catalog::API_TOKEN)));
        self::assertSame([], $sent);
    }

    public function testLesSaisiesDUnJourSeLisentPageApresPageEtSeulementCellesDuCompte(): void
    {
        $pages = [];
        $client = new JiraClient(new MockHttpClient(static function (string $method, string $url) use (&$pages): MockResponse {
            parse_str((string) parse_url($url, \PHP_URL_QUERY), $query);
            $startAt = (int) ($query['startAt'] ?? 0);
            $pages[] = $startAt;
            $author = static fn (string $id): array => ['accountId' => $id];
            $worklogs = 0 === $startAt
                ? [['id' => '1', 'author' => $author(Catalog::ACCOUNT_ID), 'started' => '2026-10-06T09:30:00.000+0200', 'timeSpentSeconds' => 900, 'comment' => ['type' => 'doc', 'version' => 1, 'content' => [['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => 'Revue  de'], ['type' => 'hardBreak'], ['type' => 'text', 'text' => 'code']]]]]],
                    ['id' => '2', 'author' => $author(Catalog::COLLEAGUE_ID), 'started' => '2026-10-06T09:30:00.000+0200', 'timeSpentSeconds' => 1800]]
                : [['id' => '3', 'author' => $author(Catalog::ACCOUNT_ID), 'started' => '2026-10-06T11:00:00.000+0200', 'timeSpentSeconds' => 900]];

            return new MockResponse((string) json_encode(['startAt' => $startAt, 'maxResults' => 2, 'total' => 3, 'worklogs' => $worklogs]));
        }), self::GATEWAY, new NativeClock());

        $day = new \DateTimeImmutable('2026-10-06', new \DateTimeZone('Europe/Paris'));
        $worklogs = $client->worklogs($this->credentials(), Catalog::ACCOUNT_ID, ['SHOP-482'], $day, $day->modify('+1 day'))['SHOP-482'];

        self::assertIsArray($worklogs);
        self::assertSame([0, 2], $pages);
        self::assertSame(['1', '3'], array_map(static fn (JiraWorklog $worklog): string => $worklog->id, $worklogs));
        self::assertSame('Revue de code', $worklogs[0]->comment);
        self::assertNull($worklogs[1]->comment);
    }

    public function testUneSaisieIllisibleDeLUtilisateurNeSeLaissePasDeCote(): void
    {
        $client = new JiraClient(new MockHttpClient(new MockResponse((string) json_encode(['startAt' => 0, 'total' => 1, 'worklogs' => [
            ['id' => '1', 'author' => ['accountId' => Catalog::ACCOUNT_ID], 'started' => 'hier', 'timeSpentSeconds' => 900],
        ]]))), self::GATEWAY, new NativeClock());

        $day = new \DateTimeImmutable('2026-10-06', new \DateTimeZone('Europe/Paris'));

        self::assertSame(JiraFailure::Unreachable, $client->worklogs($this->credentials(), Catalog::ACCOUNT_ID, ['SHOP-482'], $day, $day->modify('+1 day'))['SHOP-482']);
    }

    /**
     * @return iterable<string, array{int, string, WriteOutcome}>
     */
    public static function writeAnswers(): iterable
    {
        yield 'enregistrée' => [201, '{}', WriteOutcome::Done];
        yield 'refusée pour ce ticket' => [400, '{"errorMessages":["Time Tracking is disabled"]}', WriteOutcome::Rejected];
        yield 'interdite à ce compte' => [403, '{"errorMessages":["You do not have permission"]}', WriteOutcome::Rejected];
        yield 'jeton refusé' => [401, '{"errorMessages":["Client must be authenticated"]}', WriteOutcome::Refused];
        yield 'périmètre manquant' => [401, '{"code":401,"message":"Unauthorized; scope does not match"}', WriteOutcome::MissingScope];
        yield 'ticket introuvable' => [404, '{"errorMessages":["Issue does not exist"]}', WriteOutcome::NotFound];
        yield 'panne, peut-être enregistrée' => [500, '{}', WriteOutcome::Unknown];
    }

    #[DataProvider('writeAnswers')]
    public function testChaqueReponseAUnAjoutDitCeQuIlADonne(int $status, string $body, WriteOutcome $expected): void
    {
        $client = new JiraClient(new MockHttpClient(new MockResponse($body, ['http_code' => $status])), self::GATEWAY, new NativeClock());

        self::assertSame([$expected], $client->write($this->credentials(), [WorklogWrite::add('SHOP-482', new \DateTimeImmutable('2026-10-06T09:30:00+02:00'), 900, null)]));
    }

    public function testUneSaisieDisparueEstRetireeMaisSaCorrectionSeRelit(): void
    {
        $client = new JiraClient(new MockHttpClient([new MockResponse('{}', ['http_code' => 404]), new MockResponse('{}', ['http_code' => 404])]), self::GATEWAY, new NativeClock());
        $gone = new JiraWorklog('7', 'SHOP-482', new \DateTimeImmutable('2026-10-06T09:30:00+02:00'), 900, null);

        self::assertSame([WriteOutcome::Done, WriteOutcome::Unknown], $client->write($this->credentials(), [
            WorklogWrite::delete($gone),
            WorklogWrite::update($gone, $gone->started, 1800, null),
        ]));
    }

    public function testQuatreEcrituresAuPlusPartentEnsembleEtUnRalentissementEstAttendu(): void
    {
        $running = 0;
        $most = 0;
        $calls = 0;
        $clock = new MockClock('2026-10-06 15:20:00');
        $client = new JiraClient(new MockHttpClient(static function () use (&$running, &$most, &$calls): MockResponse {
            ++$running;
            $most = max($most, $running);
            ++$calls;

            return new MockResponse(
                (static function () use (&$running): \Generator {
                    yield '';
                    --$running;
                    yield '{}';
                })(),
                1 === $calls ? ['http_code' => 429, 'response_headers' => ['Retry-After: 3']] : ['http_code' => 201],
            );
        }), self::GATEWAY, $clock);

        $writes = array_map(static fn (int $minute): WorklogWrite => WorklogWrite::add('SHOP-482', new \DateTimeImmutable('2026-10-06T09:00:00+02:00')->modify('+'.$minute.' minutes'), 900, null), range(0, 135, 15));
        $outcomes = $client->write($this->credentials(), $writes);

        self::assertSame(array_fill(0, 10, WriteOutcome::Done), $outcomes);
        self::assertSame(11, $calls, 'La première, ralentie, repart une fois.');
        self::assertLessThanOrEqual(JiraClient::PARALLEL_WRITES, $most);
        self::assertGreaterThan(1, $most);
    }

    private function connect(string $address, string $token): JiraConnected|JiraFailure
    {
        $parsed = JiraAddress::parse($address);
        self::assertNotNull($parsed);

        return $this->client->connect($parsed, Catalog::ACCOUNT_EMAIL, $token);
    }

    private function credentials(): JiraCredentials
    {
        return new JiraCredentials('https://jira', Catalog::ACCOUNT_EMAIL, Catalog::API_TOKEN);
    }
}
