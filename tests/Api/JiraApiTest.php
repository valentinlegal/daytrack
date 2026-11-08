<?php

namespace App\Tests\Api;

use App\Dev\Jira\Catalog;
use App\Tests\Support\DayApi;
use App\Tests\Support\JiraApi;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

/**
 * La connexion à Jira, par ses routes, comme la bienvenue et les réglages s'en
 * servent — et comme une page hostile essaierait. Le jeton y entre et n'en ressort
 * jamais : ni dans une réponse, ni dans la base en clair, ni dans un journal.
 */
final class JiraApiTest extends WebTestCase
{
    use DayApi;
    use JiraApi;

    private const string GATEWAY = 'https://api.atlassian.com/ex/jira/'.Catalog::CLOUD_ID;

    /** @var list<string> chaque réponse reçue, pour vérifier qu'aucune ne porte le jeton */
    private array $responses = [];

    public function testSansConnexionDayTrackNEstPasRelie(): void
    {
        self::assertSame(['linked' => false], $this->state());
    }

    public function testTesterLaConnexionDonneLeCompteSansRienGarder(): void
    {
        [$status, $body] = $this->jiraForm('POST', '/api/jira/test', 'https://jira', Catalog::API_TOKEN);

        self::assertSame(200, $status);
        self::assertSame(['account' => Catalog::ACCOUNT_NAME], $body);
        self::assertSame(['linked' => false], $this->state());
        self::assertSame([], self::listAt($this->jiraState(), 'worklogs'));
    }

    public function testCommencerRelieEtGardeLeJetonChiffre(): void
    {
        [$status, $body] = $this->jiraForm('PUT', '/api/jira', 'jira', Catalog::API_TOKEN);

        self::assertSame(200, $status);
        self::assertSame(['linked' => true, 'site' => 'https://jira', 'email' => Catalog::ACCOUNT_EMAIL, 'account' => Catalog::ACCOUNT_NAME, 'refusal' => null, 'missingScopes' => []], $body);

        $row = $this->connectionRow();
        self::assertSame('https://jira', $row['api']);
        self::assertSame(Catalog::ACCOUNT_ID, $row['account_id']);
        self::assertStringNotContainsString(Catalog::API_TOKEN, $row['encrypted_token']);
        self::assertSame(Catalog::API_TOKEN, $this->cipher()->decrypt($row['encrypted_token']));
    }

    public function testUneEspaceInsecableEnFinDAdresseOuDEMailNeFaitPasRefuser(): void
    {
        // Alt+Espace sur un Mac : elle se tape sans se voir.
        $typed = ['site' => "https://jira\u{00A0}", 'email' => "\u{00A0}".Catalog::ACCOUNT_EMAIL."\u{00A0}", 'token' => Catalog::API_TOKEN];

        [$status, $body] = $this->send('POST', '/api/jira/test', $typed);
        self::assertSame(200, $status);
        self::assertSame(['account' => Catalog::ACCOUNT_NAME], $body);

        [$status, $body] = $this->send('PUT', '/api/jira', $typed);
        self::assertSame(200, $status);
        self::assertSame('https://jira', self::at($body, 'site'));
        self::assertSame(Catalog::ACCOUNT_EMAIL, self::at($body, 'email'));
        self::assertSame(Catalog::API_TOKEN, $this->cipher()->decrypt($this->connectionRow()['encrypted_token']), 'Le jeton, lui, est gardé tel qu\'il a été collé.');
    }

    public function testUnJetonAPerimetresSeRelieParLaPasserelle(): void
    {
        [$status] = $this->jiraForm('PUT', '/api/jira', 'https://jira', Catalog::SCOPED_TOKEN);

        self::assertSame(200, $status);
        self::assertSame(self::GATEWAY, $this->connectionRow()['api']);
        self::assertSame('https://jira', self::at($this->state(), 'site'));
    }

    /**
     * @param array<string, ?string> $fields
     */
    #[DataProvider('refusals')]
    public function testUnRefusSeDitSousSonChampEtNeGardeRien(array $fields, string $field, string $message, bool $down = false): void
    {
        if ($down) {
            $this->simulate('panne', ['panne' => true]);
        }

        [$status, $body] = $this->send('PUT', '/api/jira', $fields);

        self::assertSame(422, $status);
        self::assertSame([['field' => $field, 'message' => $message]], self::at($body, 'violations'));
        self::assertSame(['linked' => false], $this->state());
    }

    /**
     * @return iterable<string, array{0: array<string, ?string>, 1: string, 2: string, 3?: bool}>
     */
    public static function refusals(): iterable
    {
        $valid = ['site' => 'https://jira', 'email' => Catalog::ACCOUNT_EMAIL];

        yield 'un jeton que Jira refuse' => [$valid + ['token' => 'jeton-expire'], 'token', 'Jira refuse cette adresse e-mail ou ce jeton. Vérifiez-les, ou créez un nouveau jeton.'];
        yield 'un e-mail d\'un autre compte' => [['email' => 'autre@daytrack.test'] + $valid + ['token' => Catalog::API_TOKEN], 'token', 'Jira refuse cette adresse e-mail ou ce jeton. Vérifiez-les, ou créez un nouveau jeton.'];
        yield 'un jeton qui ne peut pas envoyer d\'heures' => [$valid + ['token' => Catalog::READ_ONLY_TOKEN], 'token', 'Il manque à ce jeton un périmètre dont DayTrack a besoin. Créez-en un nouveau avec read:jira-work, write:jira-work et read:jira-user.'];
        yield 'un jeton qui ne peut pas lire les tickets' => [$valid + ['token' => Catalog::WRITE_ONLY_TOKEN], 'token', 'Il manque à ce jeton un périmètre dont DayTrack a besoin. Créez-en un nouveau avec read:jira-work, write:jira-work et read:jira-user.'];
        yield 'un jeton à deux périmètres, selon la v1' => [$valid + ['token' => Catalog::V1_SCOPED_TOKEN], 'token', 'Il manque à ce jeton un périmètre dont DayTrack a besoin. Créez-en un nouveau avec read:jira-work, write:jira-work et read:jira-user.'];
        yield 'une adresse où personne ne répond' => [['site' => 'https://exemple.atlassian.net'] + $valid + ['token' => Catalog::API_TOKEN], 'site', 'Jira ne répond pas à cette adresse. Vérifiez-la.'];
        yield 'un Jira en panne' => [$valid + ['token' => Catalog::API_TOKEN], 'site', 'Jira ne répond pas à cette adresse. Vérifiez-la.', true];
        yield 'aucun jeton, et aucun d\'enregistré' => [$valid, 'token', 'Indiquez votre jeton d\'API.'];
        yield 'aucune adresse' => [['site' => '  '] + $valid + ['token' => Catalog::API_TOKEN], 'site', 'Indiquez l\'adresse de Jira.'];
        yield 'deux mots pour adresse' => [['site' => 'mon jira'] + $valid + ['token' => Catalog::API_TOKEN], 'site', 'Une adresse de Jira s\'écrit comme https://exemple.atlassian.net.'];
        yield 'aucun e-mail' => [['email' => null] + $valid + ['token' => Catalog::API_TOKEN], 'email', 'Indiquez votre adresse e-mail.'];
        yield 'un e-mail sans arobase' => [['email' => 'dev.daytrack.test'] + $valid + ['token' => Catalog::API_TOKEN], 'email', 'Une adresse e-mail s\'écrit comme camille.martin@exemple.fr.'];
        yield 'un e-mail trop long' => [['email' => 'camille.martin@'.str_repeat(str_repeat('a', 59).'.', 4).'fr'] + $valid + ['token' => Catalog::API_TOKEN], 'email', 'Une adresse e-mail tient en 255 caractères.'];
        yield 'un jeton coupé par une espace' => [$valid + ['token' => 'jeton de developpement'], 'token', 'Un jeton d\'API tient sur une ligne, sans espace.'];
    }

    public function testChaqueChampVideSeRefuseDUnSeulEnvoi(): void
    {
        [$status, $body] = $this->send('PUT', '/api/jira', ['site' => '', 'email' => '', 'token' => '']);

        self::assertSame(422, $status);
        self::assertSame([
            ['field' => 'site', 'message' => 'Indiquez l\'adresse de Jira.'],
            ['field' => 'email', 'message' => 'Indiquez votre adresse e-mail.'],
            ['field' => 'token', 'message' => 'Indiquez votre jeton d\'API.'],
        ], self::sortedByField(self::listAt($body, 'violations')));

        // Relié, le jeton enregistré tient lieu du jeton qu'on ne recolle pas.
        $this->linkJira();
        [, $body] = $this->send('PUT', '/api/jira', ['site' => '', 'email' => Catalog::ACCOUNT_EMAIL]);
        self::assertSame([['field' => 'site', 'message' => 'Indiquez l\'adresse de Jira.']], self::at($body, 'violations'));
    }

    public function testUnChampInconnuEstRefuse(): void
    {
        [$status] = $this->send('PUT', '/api/jira', ['site' => 'https://jira', 'email' => Catalog::ACCOUNT_EMAIL, 'token' => Catalog::API_TOKEN, 'api' => 'https://evil.example']);

        self::assertSame(422, $status);
        self::assertSame(['linked' => false], $this->state());
    }

    public function testUnRefusLaisseLAncienneConnexionEnPlace(): void
    {
        $this->linkJira();
        $before = $this->connectionRow();

        [$status] = $this->jiraForm('PUT', '/api/jira', 'https://jira', 'jeton-expire');

        self::assertSame(422, $status);
        self::assertSame($before, $this->connectionRow());
        self::assertSame(Catalog::ACCOUNT_NAME, self::at($this->state(), 'account'));
    }

    public function testSansJetonCEstLEnregistreQuiSert(): void
    {
        $this->linkJira(Catalog::SCOPED_TOKEN);

        [$status] = $this->jiraForm('PUT', '/api/jira', 'https://jira/browse/SHOP-482', null);

        self::assertSame(200, $status);
        self::assertSame(Catalog::SCOPED_TOKEN, $this->cipher()->decrypt($this->connectionRow()['encrypted_token']));
    }

    public function testLeJetonEnregistreQuiNePassePlusSeDitCommeTel(): void
    {
        $this->linkJira();
        $this->simulate('jeton', ['refuse' => true]);

        [$status, $body] = $this->jiraForm('PUT', '/api/jira', 'https://jira', null);

        self::assertSame(422, $status);
        self::assertSame([['field' => 'token', 'message' => 'Jira refuse le jeton enregistré, il a sans doute expiré. Créez-en un nouveau, puis collez-le ici.']], self::at($body, 'violations'));
    }

    public function testChangerDeCompteDemandeSonJeton(): void
    {
        $this->linkJira();

        [$status, $body] = $this->send('PUT', '/api/jira', ['site' => 'https://jira', 'email' => 'autre@daytrack.test']);

        self::assertSame(422, $status);
        self::assertSame([['field' => 'token', 'message' => 'Jira refuse cette adresse e-mail ou ce jeton. Vérifiez-les, ou créez un nouveau jeton.']], self::at($body, 'violations'));
    }

    public function testLeJetonEnregistreNeSuitPasVersUneAdresseQuiNEstPasCelleDAtlassian(): void
    {
        $this->linkJira();

        [$status, $body] = $this->jiraForm('POST', '/api/jira/test', 'https://evil.example', null);

        self::assertSame(422, $status);
        self::assertSame([['field' => 'token', 'message' => 'Pour une adresse qui n\'est pas celle d\'Atlassian, collez de nouveau le jeton.']], self::at($body, 'violations'));
    }

    public function testLeJetonEnregistreSuitVersUnAutreSiteDAtlassian(): void
    {
        $this->linkJira();

        // Le Jira simulé ne répond pas à cette adresse : le refus vient de Jira, pas de
        // DayTrack, donc le jeton a pu partir.
        [$status, $body] = $this->jiraForm('POST', '/api/jira/test', 'https://exemple.atlassian.net', null);

        self::assertSame(422, $status);
        self::assertSame('site', self::at($body, 'violations', 0, 'field'));
    }

    public function testRelierUnAutreSiteFaitRelireLesTitres(): void
    {
        $this->linkJira();
        $this->write(0, [self::work('09:00', '09:30', 'SHOP-482')]);
        self::assertNotNull($this->connection()->fetchOne('SELECT read_at FROM ticket WHERE ticket_key = ?', ['SHOP-482']));

        $this->linkJira(Catalog::SCOPED_TOKEN);

        self::assertNull($this->connection()->fetchOne('SELECT read_at FROM ticket WHERE ticket_key = ?', ['SHOP-482']));
        self::assertSame('Export CSV des commandes filtrées par période et par statut', $this->connection()->fetchOne('SELECT title FROM ticket WHERE ticket_key = ?', ['SHOP-482']), 'Le titre reste affiché en attendant.');
    }

    public function testLaVerificationDitSiLeJetonPasseToujours(): void
    {
        self::assertSame(['status' => 'not_linked', 'account' => null, 'missingScopes' => []], $this->check());

        $this->linkJira();
        self::assertSame(['status' => 'connected', 'account' => Catalog::ACCOUNT_NAME, 'missingScopes' => []], $this->check());

        $this->simulate('jeton', ['refuse' => true]);
        self::assertSame(['status' => 'refused', 'account' => null, 'missingScopes' => []], $this->check());
        self::assertSame('refused', self::at($this->state(), 'refusal'));

        $this->simulate('jeton', ['refuse' => false]);
        self::assertSame(['status' => 'connected', 'account' => Catalog::ACCOUNT_NAME, 'missingScopes' => []], $this->check());
        self::assertNull(self::at($this->state(), 'refusal'));
    }

    public function testUnPerimetreQuiManqueAuJetonEnregistreSeNomme(): void
    {
        $this->linkJira(Catalog::SCOPED_TOKEN);
        // Un jeton fait selon le README de la v1, repris tel quel : read:jira-user lui manque.
        $this->connection()->executeStatement('UPDATE jira_connection SET encrypted_token = ?', [$this->cipher()->encrypt(Catalog::V1_SCOPED_TOKEN)]);

        self::assertSame(['status' => 'missing_scope', 'account' => null, 'missingScopes' => ['read:jira-user']], $this->check());
        self::assertSame('missing_scope', self::at($this->state(), 'refusal'));
        self::assertSame(['read:jira-user'], self::at($this->state(), 'missingScopes'));
        self::assertSame([], self::listAt($this->jiraState(), 'worklogs'), 'Éprouver les périmètres n\'écrit rien dans Jira.');

        $this->linkJira(Catalog::SCOPED_TOKEN);
        self::assertNull(self::at($this->state(), 'refusal'));
        self::assertSame([], self::at($this->state(), 'missingScopes'));
    }

    public function testUnJetonRefuseNeNommeAucunPerimetre(): void
    {
        $this->linkJira(Catalog::SCOPED_TOKEN);
        $this->simulate('jeton', ['refuse' => true]);

        self::assertSame(['status' => 'refused', 'account' => null, 'missingScopes' => []], $this->check());
    }

    public function testUnJiraEnPanneNeDitRienDuJeton(): void
    {
        $this->linkJira();
        $this->simulate('panne', ['panne' => true]);

        self::assertSame(['status' => 'unreachable', 'account' => null, 'missingScopes' => []], $this->check());
        self::assertNull(self::at($this->state(), 'refusal'));
    }

    public function testUnJetonQuiNeSeDechiffrePlusSeDitRefuse(): void
    {
        $this->linkJira();
        // Chiffré par une autre installation, ou la clé de celle-ci perdue.
        $this->connection()->executeStatement('UPDATE jira_connection SET encrypted_token = ?', ['v1:'.base64_encode(random_bytes(64))]);

        self::assertSame(['status' => 'refused', 'account' => null, 'missingScopes' => []], $this->check());
        self::assertSame('refused', self::at($this->state(), 'refusal'));
    }

    public function testUneAutrePageNePeutNiRelierNiTester(): void
    {
        $hostile = ['HTTP_SEC_FETCH_SITE' => 'cross-site', 'HTTP_ORIGIN' => 'https://evil.example'];
        $fields = ['site' => 'https://jira', 'email' => Catalog::ACCOUNT_EMAIL, 'token' => Catalog::API_TOKEN];

        foreach (['PUT /api/jira', 'POST /api/jira/test', 'POST /api/jira/check'] as $route) {
            [$method, $uri] = explode(' ', $route);
            [$status] = $this->send($method, $uri, $fields, $hostile);
            self::assertSame(403, $status, $route);
        }

        self::assertSame(['linked' => false], $this->state());
    }

    public function testLeJetonNeSortJamais(): void
    {
        $log = self::$kernel?->getLogDir().'/test.log';
        $logged = is_file($log) ? (int) filesize($log) : 0;

        foreach ([Catalog::API_TOKEN, Catalog::SCOPED_TOKEN, Catalog::READ_ONLY_TOKEN, 'jeton-expire', 'jeton avec espaces'] as $token) {
            $this->jiraForm('POST', '/api/jira/test', 'https://jira', $token);
            $this->jiraForm('PUT', '/api/jira', 'https://jira', $token);
            $this->jiraForm('PUT', '/api/jira', 'https://exemple.atlassian.net', $token);
        }
        $this->simulate('jeton', ['refuse' => true]);
        $this->check();
        $this->state();

        foreach ([Catalog::API_TOKEN, Catalog::SCOPED_TOKEN, Catalog::READ_ONLY_TOKEN, 'jeton-expire', 'jeton avec espaces'] as $token) {
            foreach ($this->responses as $response) {
                self::assertStringNotContainsString($token, $response);
                self::assertStringNotContainsString(base64_encode(Catalog::ACCOUNT_EMAIL.':'.$token), $response);
            }
            $written = is_file($log) ? (string) file_get_contents($log, offset: $logged) : '';
            self::assertStringNotContainsString($token, $written);
            self::assertStringNotContainsString(base64_encode(Catalog::ACCOUNT_EMAIL.':'.$token), $written);
            self::assertStringNotContainsString($token, (string) json_encode($this->connectionRow()));
        }
    }

    /**
     * @return array{int, array<mixed>}
     */
    private function jiraForm(string $method, string $uri, string $site, ?string $token): array
    {
        $fields = ['site' => $site, 'email' => Catalog::ACCOUNT_EMAIL];
        if (null !== $token) {
            $fields['token'] = $token;
        }

        $response = $this->send($method, $uri, $fields);
        $this->responses[] = (string) $this->browser->getResponse()->getContent();

        return $response;
    }

    /**
     * Les refus dans l'ordre de l'écran : l'adresse, l'e-mail, le jeton.
     *
     * @param list<mixed> $violations
     *
     * @return list<mixed>
     */
    private static function sortedByField(array $violations): array
    {
        $order = ['site' => 0, 'email' => 1, 'token' => 2];
        usort($violations, static fn (mixed $a, mixed $b): int => ($order[\is_array($a) && \is_string($a['field'] ?? null) ? $a['field'] : ''] ?? 9) <=> ($order[\is_array($b) && \is_string($b['field'] ?? null) ? $b['field'] : ''] ?? 9));

        return $violations;
    }

    /**
     * @return array<mixed>
     */
    private function state(): array
    {
        $this->browser->request('GET', '/api/jira');
        $this->responses[] = (string) $this->browser->getResponse()->getContent();
        self::assertResponseIsSuccessful();

        return $this->json();
    }

    /**
     * @return array<mixed>
     */
    private function check(): array
    {
        [$status, $body] = $this->send('POST', '/api/jira/check', []);
        $this->responses[] = (string) $this->browser->getResponse()->getContent();
        self::assertSame(200, $status);

        return $body;
    }

    /**
     * @return array{api: string, account_id: string, encrypted_token: string}
     */
    private function connectionRow(): array
    {
        $row = $this->connection()->fetchAssociative('SELECT api, account_id, encrypted_token FROM jira_connection');
        self::assertIsArray($row);
        self::assertIsString($row['api']);
        self::assertIsString($row['account_id']);
        self::assertIsString($row['encrypted_token']);

        return ['api' => $row['api'], 'account_id' => $row['account_id'], 'encrypted_token' => $row['encrypted_token']];
    }
}
