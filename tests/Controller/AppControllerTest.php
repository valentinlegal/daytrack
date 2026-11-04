<?php

namespace App\Tests\Controller;

use Doctrine\DBAL\Connection;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Clock\Test\ClockSensitiveTrait;
use Symfony\Component\HttpFoundation\Request;

/**
 * La page de l'application, ouverte sur le jour de son adresse.
 *
 * L'heure est figée au mardi 6 octobre 2026, 15:20 à Paris, comme dans la journée
 * d'exemple.
 */
final class AppControllerTest extends WebTestCase
{
    use ClockSensitiveTrait;

    private const string DAY = '/2026-10-06';

    protected function setUp(): void
    {
        self::mockTime('2026-10-06 15:20:00 Europe/Paris');
    }

    protected function tearDown(): void
    {
        // Les proxys de confiance vivent dans une propriété statique de Request : un
        // test qui en pose ne doit pas les laisser au suivant.
        Request::setTrustedProxies([], Request::HEADER_X_FORWARDED_FOR);
        $_SERVER['TRUSTED_PROXIES'] = $_ENV['TRUSTED_PROXIES'] = '';
        $_SERVER['DAYTRACK_OLD_COMPOSE'] = $_ENV['DAYTRACK_OLD_COMPOSE'] = '';

        parent::tearDown();
    }

    public function testLaPagePorteLApplicationSurLeJourDeSonAdresse(): void
    {
        $client = self::createClient();
        $client->request('GET', self::DAY);

        self::assertResponseIsSuccessful();
        self::assertSelectorExists('html[lang="fr"]');
        self::assertSelectorExists('#app[data-date="2026-10-06"][data-timezone="Europe/Paris"][data-future-days="30"]');
        self::assertSelectorExists('#app[data-jira]');
        self::assertSelectorTextSame('title', 'DayTrack');
    }

    public function testLaPageDitOuEnEstLaConnexionAJira(): void
    {
        $client = self::createClient();
        $connection = self::getContainer()->get('doctrine.dbal.default_connection');
        $connection->executeStatement('DELETE FROM jira_connection');

        $client->request('GET', self::DAY);
        self::assertSelectorExists('#app[data-jira="unlinked"]');

        $client->request('PUT', '/api/jira', server: ['CONTENT_TYPE' => 'application/json', 'HTTP_SEC_FETCH_SITE' => 'same-origin'], content: '{"site": "https://jira", "email": "dev@daytrack.test", "token": "jeton-de-developpement"}');
        self::assertResponseIsSuccessful();
        $client->request('GET', self::DAY);
        self::assertSelectorExists('#app[data-jira="connected"]');

        $connection->executeStatement("UPDATE jira_connection SET refusal = 'refused'");
        $client->request('GET', self::DAY);
        self::assertSelectorExists('#app[data-jira="refused"][data-jira-scopes=""]');

        $connection->executeStatement("UPDATE jira_connection SET refusal = 'missing_scope', missing_scopes = '[\"write:jira-work\",\"read:jira-user\"]'");
        $client->request('GET', self::DAY);
        self::assertSelectorExists('#app[data-jira="missing_scope"][data-jira-scopes="write:jira-work read:jira-user"]');

        $connection->executeStatement('DELETE FROM jira_connection');
    }

    public function testLesReglagesOntLeurAdresse(): void
    {
        $client = self::createClient();
        $client->request('GET', '/reglages');

        self::assertResponseIsSuccessful();
        // Le jour à rouvrir en revenant, faute d'un autre retenu par l'onglet : aujourd'hui.
        self::assertSelectorExists('#app[data-screen="settings"][data-date="2026-10-06"][data-jira]');

        $client->request('GET', self::DAY);
        self::assertSelectorExists('#app[data-screen="day"]');
    }

    public function testLaBienvenueASonAdresseTantQueJiraNEstPasRelie(): void
    {
        $client = self::createClient();
        $connection = self::getContainer()->get('doctrine.dbal.default_connection');
        $connection->executeStatement('DELETE FROM jira_connection');

        $client->request('GET', '/bienvenue');
        self::assertResponseIsSuccessful();
        self::assertSelectorExists('#app[data-jira="unlinked"][data-date="2026-10-06"]');

        $client->request('PUT', '/api/jira', server: ['CONTENT_TYPE' => 'application/json', 'HTTP_SEC_FETCH_SITE' => 'same-origin'], content: '{"site": "https://jira", "email": "dev@daytrack.test", "token": "jeton-de-developpement"}');
        self::assertResponseIsSuccessful();
        $client->request('GET', '/bienvenue');
        self::assertResponseRedirects('/2026-10-06', 302);

        $connection->executeStatement('DELETE FROM jira_connection');
    }

    public function testLAdresseSansJourMeneAAujourdhui(): void
    {
        $client = self::createClient();
        $client->request('GET', '/');

        self::assertResponseRedirects('/2026-10-06', 302);
        self::assertResponseHeaderSame('Cache-Control', 'no-store, private');
    }

    public function testAujourdhuiEstLeJourDeLUtilisateurPasCeluiDeLHeureUniverselle(): void
    {
        // 23:50 en heure universelle, déjà 01:50 le lendemain à Paris.
        self::mockTime('2026-10-05 23:50:00 UTC');

        $client = self::createClient();
        $client->request('GET', '/');

        self::assertResponseRedirects('/2026-10-06');
    }

    public function testUnJourPasseOuJusquATrenteJoursDevantSOuvre(): void
    {
        $client = self::createClient();
        foreach (['/2019-01-01', '/2026-10-05', '/2026-10-07', '/2026-11-05', '/2028-02-29'] as $uri) {
            if ('/2028-02-29' === $uri) {
                self::mockTime('2028-02-01 09:00:00 Europe/Paris');
            }
            $client->request('GET', $uri);

            self::assertResponseIsSuccessful($uri);
            self::assertSelectorExists(\sprintf('#app[data-date="%s"]', substr($uri, 1)));
        }
    }

    public function testUnJourImpossibleOuTropLoinMeneAAujourdhui(): void
    {
        $client = self::createClient();
        foreach (['/2026-02-30', '/2026-13-01', '/2026-00-10', '/2027-02-29', '/2026-11-06', '/9999-12-31', '/2026-10-6', '/2026-1-5', '/2026-10-06x', '/20261006'] as $uri) {
            $client->request('GET', $uri);

            self::assertResponseRedirects('/2026-10-06', 302, $uri);
        }
    }

    public function testCeQuiNEstPasUnJourNExistePas(): void
    {
        $client = self::createClient();
        foreach (['/demain', '/2026-10-06/slots', '/api'] as $uri) {
            $client->request('GET', $uri);

            self::assertResponseStatusCodeSame(404, $uri);
        }
    }

    public function testParcourirDesJoursNEcritRien(): void
    {
        $client = self::createClient();
        $connection = self::getContainer()->get(Connection::class);
        $connection->executeStatement('DELETE FROM slot');
        $connection->executeStatement('DELETE FROM day');

        foreach (['/', self::DAY, '/2026-10-07', '/2026-11-05', '/2019-01-01', '/2026-02-30'] as $uri) {
            $client->request('GET', $uri);
        }

        self::assertSame(0, $connection->fetchOne('SELECT COUNT(*) FROM day'));
    }

    public function testLaPageNeSEcritPas(): void
    {
        $client = self::createClient();
        foreach (['/', self::DAY] as $uri) {
            $client->request('POST', $uri, server: ['HTTP_SEC_FETCH_SITE' => 'same-origin', 'CONTENT_TYPE' => 'application/json']);

            self::assertResponseStatusCodeSame(405, $uri);
        }
    }

    public function testParDefautPersonneNEstUnProxyDeConfiance(): void
    {
        $client = self::createClient();
        $client->request('GET', self::DAY, server: ['REMOTE_ADDR' => '172.18.0.2', 'HTTP_X_FORWARDED_PROTO' => 'https', 'HTTP_X_FORWARDED_HOST' => 'daytrack.example.com']);

        self::assertResponseIsSuccessful();
        self::assertFalse($client->getRequest()->isSecure());
        self::assertSame('localhost', $client->getRequest()->getHost());
    }

    public function testUnFichierDeLaV1ServiSurUnAutrePortCompteCommeModifie(): void
    {
        $_SERVER['DAYTRACK_OLD_COMPOSE'] = $_ENV['DAYTRACK_OLD_COMPOSE'] = 'default';
        $client = self::createClient();

        $client->request('GET', self::DAY, server: ['HTTP_HOST' => 'daytrack.localhost', 'HTTPS' => 'on']);
        self::assertSelectorExists('#app[data-old-compose="default"]');

        $client->request('GET', self::DAY, server: ['HTTP_HOST' => 'daytrack.localhost:8443', 'HTTPS' => 'on']);
        self::assertSelectorExists('#app[data-old-compose="custom"]');
    }

    public function testSansAncienFichierLePortNeChangeRien(): void
    {
        $client = self::createClient();
        $client->request('GET', self::DAY, server: ['HTTP_HOST' => 'daytrack.localhost:8443', 'HTTPS' => 'on']);

        self::assertSelectorExists('#app[data-old-compose=""]');
    }

    public function testDerriereUnProxyDeConfianceLeHttpsEtLeNomSontCeuxDuProxy(): void
    {
        $_SERVER['TRUSTED_PROXIES'] = $_ENV['TRUSTED_PROXIES'] = 'private_ranges';

        $client = self::createClient();
        $client->request('GET', self::DAY, server: ['REMOTE_ADDR' => '172.18.0.2', 'HTTP_X_FORWARDED_PROTO' => 'https', 'HTTP_X_FORWARDED_HOST' => 'daytrack.example.com', 'HTTP_X_FORWARDED_PORT' => '443']);

        self::assertResponseIsSuccessful();
        self::assertTrue($client->getRequest()->isSecure());
        self::assertSame('https://daytrack.example.com', $client->getRequest()->getSchemeAndHttpHost());
    }

    public function testUnProxyHorsDesAdressesDeConfianceNEstPasCru(): void
    {
        $_SERVER['TRUSTED_PROXIES'] = $_ENV['TRUSTED_PROXIES'] = 'private_ranges';

        $client = self::createClient();
        // Une adresse publique : Symfony range aussi les plages de documentation
        // (203.0.113.0/24…) parmi les privées.
        $client->request('GET', self::DAY, server: ['REMOTE_ADDR' => '8.8.4.4', 'HTTP_X_FORWARDED_PROTO' => 'https', 'HTTP_X_FORWARDED_HOST' => 'daytrack.example.com']);

        self::assertResponseIsSuccessful();
        self::assertFalse($client->getRequest()->isSecure());
    }
}
