<?php

namespace App\Tests\Version;

use App\Version\AvailableVersion;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Cache\Adapter\ArrayAdapter;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;

/**
 * Ce que le service garde du registre et ce qu'il fait d'une réponse de travers : le
 * registre est un tiers, et sa réponse n'est jamais crue.
 */
final class AvailableVersionTest extends TestCase
{
    private string $versionFile;

    protected function setUp(): void
    {
        $this->versionFile = (string) tempnam(sys_get_temp_dir(), 'version');
        file_put_contents($this->versionFile, "2.4.0\n");
    }

    protected function tearDown(): void
    {
        unlink($this->versionFile);
    }

    public function testLeRegistreSeLitParUnJetonAnonymePuisSesTags(): void
    {
        $requests = [];
        $client = new MockHttpClient(static function (string $method, string $url, array $options) use (&$requests): MockResponse {
            $headers = $options['normalized_headers'] ?? [];
            $requests[] = [$method, $url, \is_array($headers) && \is_array($headers['authorization'] ?? null) ? ($headers['authorization'][0] ?? null) : null];

            return new MockResponse(str_contains($url, '/token') ? '{"token":"anonyme"}' : '{"tags":["2.5.0"]}');
        });

        self::assertSame('2.5.0', $this->service($client)->find());
        self::assertSame([
            ['GET', 'https://ghcr.io/token?scope=repository:valentinlegal/daytrack:pull&service=ghcr.io', null],
            ['GET', 'https://ghcr.io/v2/valentinlegal/daytrack/tags/list', 'Authorization: Bearer anonyme'],
        ], $requests);
    }

    public function testLaReponseSeGardePlutotQueDInterrogerLeRegistreAChaquePage(): void
    {
        $cache = new ArrayAdapter();
        $client = $this->registry(['2.5.0']);
        $service = $this->service($client, $cache);

        $service->find();
        $calls = $client->getRequestsCount();

        self::assertSame('2.5.0', $service->find());
        self::assertSame($calls, $client->getRequestsCount());
    }

    public function testApresUneMiseAJourLAvisTombeSansAttendre(): void
    {
        $cache = new ArrayAdapter();
        $service = $this->service($this->registry(['2.5.0']), $cache);
        self::assertSame('2.5.0', $service->find());

        file_put_contents($this->versionFile, "2.5.0\n");

        self::assertNull($service->find());
    }

    public function testUnRegistreMuetNEstPasReinterrogeAChaquePage(): void
    {
        $client = new MockHttpClient(static fn (): MockResponse => new MockResponse('', ['error' => 'Could not resolve host: ghcr.io']));
        $service = $this->service($client, new ArrayAdapter());

        self::assertNull($service->find());
        $calls = $client->getRequestsCount();

        self::assertNull($service->find());
        self::assertSame($calls, $client->getRequestsCount());
    }

    /**
     * @param list<MockResponse> $responses
     */
    #[DataProvider('unusableResponses')]
    public function testUneReponseDeTraversNeSAnnoncePas(array $responses): void
    {
        self::assertNull($this->service(new MockHttpClient($responses))->find());
    }

    /**
     * @return iterable<string, array{list<MockResponse>}>
     */
    public static function unusableResponses(): iterable
    {
        $token = new MockResponse('{"token":"anonyme"}');

        yield 'jeton refusé' => [[new MockResponse('{"errors":[]}', ['http_code' => 403])]];
        yield 'jeton absent' => [[new MockResponse('{}')]];
        yield 'jeton qui n\'est pas un texte' => [[new MockResponse('{"token":["anonyme"]}')]];
        yield 'jeton vide' => [[new MockResponse('{"token":""}')]];
        yield 'jeton illisible' => [[new MockResponse('<html>')]];
        yield 'tags refusés' => [[$token, new MockResponse('{"errors":[]}', ['http_code' => 401])]];
        yield 'tags en panne' => [[clone $token, new MockResponse('', ['http_code' => 503])]];
        yield 'tags absents' => [[clone $token, new MockResponse('{"name":"x"}')]];
        yield 'tags qui ne sont pas une liste' => [[clone $token, new MockResponse('{"tags":"99.0.0"}')]];
        yield 'tags qui ne sont pas des textes' => [[clone $token, new MockResponse('{"tags":[99,null,{"a":"99.0.0"}]}')]];
        yield 'tags illisibles' => [[clone $token, new MockResponse('<html>')]];
        yield 'un registre qui redirige' => [[new MockResponse('', ['http_code' => 302, 'redirect_url' => 'https://ailleurs.example/'])]];
    }

    public function testUnePreVersionNAlertePersonne(): void
    {
        self::assertNull($this->service($this->registry(['1.1.0', '2.0.0-rc.1', 'rc', 'latest', 'develop']))->find());
    }

    /**
     * Une pré-version n'annonce pas une autre pré-version, ni une version plus ancienne
     * qu'elle, mais la version publiée qui la suit, oui.
     */
    #[DataProvider('fromPrerelease')]
    public function testDepuisUnePreVersion(string $installed, string $tag, ?string $announced): void
    {
        file_put_contents($this->versionFile, $installed."\n");

        self::assertSame($announced, $this->service($this->registry([$tag]))->find());
    }

    /**
     * @return iterable<string, array{string, string, ?string}>
     */
    public static function fromPrerelease(): iterable
    {
        yield 'la pré-version suivante' => ['2.0.0-rc.1', '2.0.0-rc.2', null];
        yield 'une version plus ancienne' => ['2.0.1-rc.1', '2.0.0', null];
        yield 'la version elle-même' => ['2.0.0-rc.2', '2.0.0', '2.0.0'];
        yield 'une version au-dessus' => ['2.0.1-rc.1', '2.0.2', '2.0.2'];
    }

    /**
     * @param list<string> $tags
     */
    private function registry(array $tags): MockHttpClient
    {
        return new MockHttpClient(static fn (string $method, string $url): MockResponse => new MockResponse(
            str_contains($url, '/token') ? '{"token":"anonyme"}' : json_encode(['tags' => $tags], \JSON_THROW_ON_ERROR),
        ));
    }

    private function service(MockHttpClient $client, ArrayAdapter $cache = new ArrayAdapter()): AvailableVersion
    {
        return new AvailableVersion($client, $cache, $this->versionFile);
    }
}
