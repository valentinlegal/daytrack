<?php

namespace App\Tests\Dev\Jira;

use App\Dev\Jira\Catalog;
use App\Dev\Jira\FakeJira;
use App\Dev\Jira\FakeJiraHttpClient;
use App\Dev\Jira\FakeJiraRequest;
use App\Dev\Jira\MemoryStore;
use App\Tests\Support\ReadsJson;
use PHPUnit\Framework\TestCase;
use Symfony\Contracts\HttpClient\Exception\TransportExceptionInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;
use Symfony\Contracts\HttpClient\ResponseInterface;

/**
 * Le Jira simulé, exercé comme DayTrack l'exercera : par un client HTTP.
 */
final class FakeJiraTest extends TestCase
{
    use ReadsJson;

    private const string DAY = '2026-10-06T09:30:00.000+0200';

    private FakeJira $jira;
    private HttpClientInterface $client;

    protected function setUp(): void
    {
        $this->jira = new FakeJira(new MemoryStore());
        $this->client = FakeJiraHttpClient::create($this->jira);
    }

    public function testUnJetonRefuseOuAbsentNOuvreRien(): void
    {
        self::assertSame(401, $this->get('/rest/api/3/myself', FakeJiraRequest::basic(Catalog::ACCOUNT_EMAIL, 'jeton-expire'))->getStatusCode());
        self::assertSame(401, $this->get('/rest/api/3/myself', null)->getStatusCode());
        self::assertSame(401, $this->get('/rest/api/3/issue/SHOP-482', FakeJiraRequest::basic('autre@daytrack.test', Catalog::API_TOKEN))->getStatusCode());
    }

    public function testIlDitLesTicketsQuIlConnait(): void
    {
        $catalog = (array) $this->jira->handle(new FakeJiraRequest('GET', '/_simulation/tickets'))->body;
        $tickets = (array) ($catalog['tickets'] ?? []);
        $projects = (array) ($catalog['projets'] ?? []);

        // Chaque ticket listé se lit, et un projet listé en a pour tout numéro.
        foreach (array_keys($tickets) as $key) {
            self::assertSame(200, $this->get('/rest/api/3/issue/'.$key)->getStatusCode(), (string) $key);
        }
        foreach (array_keys($projects) as $project) {
            self::assertSame(200, $this->get('/rest/api/3/issue/'.$project.'-12')->getStatusCode(), (string) $project);
        }
        self::assertArrayHasKey('SHOP-482', $tickets);
        self::assertArrayHasKey(Catalog::TRIAL, $projects);
        self::assertSame(404, $this->get('/rest/api/3/issue/ABC-12')->getStatusCode());
    }

    public function testLeSiteDonneSonIdentifiantSansJeton(): void
    {
        self::assertSame(Catalog::CLOUD_ID, self::at($this->get('/_edge/tenant_info', null)->toArray(), 'cloudId'));
    }

    public function testUnJetonAPerimetresNePasseQueParLaPasserelle(): void
    {
        $scoped = FakeJiraRequest::basic(Catalog::ACCOUNT_EMAIL, Catalog::SCOPED_TOKEN);

        self::assertSame(401, $this->get('/rest/api/3/myself', $scoped)->getStatusCode());
        self::assertSame(Catalog::ACCOUNT_ID, self::at($this->get(self::gateway('myself'), $scoped)->toArray(), 'accountId'));
        self::assertSame('SHOP-482', self::at($this->get(self::gateway('issue/SHOP-482'), $scoped)->toArray(), 'key'));
    }

    public function testUnJetonSansPerimetreNePassePasParLaPasserelle(): void
    {
        $response = $this->get(self::gateway('myself'));

        self::assertSame(401, $response->getStatusCode());
        self::assertSame('Unauthorized', self::at($response->toArray(false), 'message'));
    }

    public function testLaPasserelleRefuseCeQueLePerimetreNePermetPas(): void
    {
        $v1 = $this->get(self::gateway('myself'), FakeJiraRequest::basic(Catalog::ACCOUNT_EMAIL, Catalog::V1_SCOPED_TOKEN));
        $readOnly = $this->client->request('POST', self::gateway('issue/SHOP-482/worklog'), [
            'headers' => ['Authorization' => FakeJiraRequest::basic(Catalog::ACCOUNT_EMAIL, Catalog::READ_ONLY_TOKEN)],
            'json' => ['started' => self::DAY, 'timeSpentSeconds' => 900],
        ]);

        self::assertSame(401, $v1->getStatusCode());
        self::assertSame('Unauthorized; scope does not match', self::at($v1->toArray(false), 'message'));
        self::assertSame(401, $readOnly->getStatusCode());
        self::assertSame('Unauthorized; scope does not match', self::at($readOnly->toArray(false), 'message'));
        self::assertSame([], $this->myWorklogs('SHOP-482'));
    }

    /**
     * C'est ainsi que DayTrack vérifie, à la connexion, qu'un jeton peut envoyer des
     * heures sans en écrire : le périmètre se juge avant le ticket.
     */
    public function testLaPasserelleJugeLePerimetreAvantLeTicket(): void
    {
        $probe = fn (string $token): int => $this->client->request('POST', self::gateway('issue/DAYTRACK-0/worklog'), [
            'headers' => ['Authorization' => FakeJiraRequest::basic(Catalog::ACCOUNT_EMAIL, $token)],
            'json' => [],
        ])->getStatusCode();

        self::assertSame(404, $probe(Catalog::SCOPED_TOKEN));
        self::assertSame(401, $probe(Catalog::READ_ONLY_TOKEN));
    }

    public function testUneAdresseDePasserelleQuiNeDesignePasLeSiteEstIntrouvable(): void
    {
        $response = $this->get('/ex/jira/00000000-0000-0000-0000-000000000000/rest/api/3/myself', FakeJiraRequest::basic(Catalog::ACCOUNT_EMAIL, Catalog::SCOPED_TOKEN));

        self::assertSame(404, $response->getStatusCode());
    }

    public function testUnJetonSeRefuseALaDemandePuisRepasse(): void
    {
        self::assertSame(204, $this->jira->handle(new FakeJiraRequest('POST', '/_simulation/jeton', body: '{"refuse": true}'))->status);
        self::assertSame(401, $this->get('/rest/api/3/myself')->getStatusCode());
        self::assertSame(401, $this->get(self::gateway('myself'), FakeJiraRequest::basic(Catalog::ACCOUNT_EMAIL, Catalog::SCOPED_TOKEN))->getStatusCode());

        $this->jira->handle(new FakeJiraRequest('POST', '/_simulation/jeton', body: '{"refuse": false}'));

        self::assertSame(200, $this->get('/rest/api/3/myself')->getStatusCode());
    }

    public function testUnJiraEnPanneNeRepondQueParUneErreur(): void
    {
        self::assertSame(204, $this->jira->handle(new FakeJiraRequest('POST', '/_simulation/panne', body: '{"panne": true}'))->status);
        self::assertSame(503, $this->get('/rest/api/3/issue/SHOP-482')->getStatusCode());
        self::assertSame(503, $this->get('/_edge/tenant_info', null)->getStatusCode());

        $this->jira->handle(new FakeJiraRequest('POST', '/_simulation/reinitialiser'));

        self::assertSame(200, $this->get('/rest/api/3/issue/SHOP-482')->getStatusCode());
    }

    public function testUnePanneSePoseParUnCorpsDeLaBonneForme(): void
    {
        self::assertSame(400, $this->jira->handle(new FakeJiraRequest('POST', '/_simulation/panne', body: '{"panne": "oui"}'))->status);
    }

    public function testPersonneNeRepondAilleursQueChezLeJiraSimule(): void
    {
        $this->expectException(TransportExceptionInterface::class);

        $this->client->request('GET', 'https://exemple.atlassian.net/rest/api/3/myself')->getStatusCode();
    }

    public function testLeCompteSeReconnait(): void
    {
        $myself = $this->get('/rest/api/3/myself')->toArray();

        self::assertSame(Catalog::ACCOUNT_ID, self::at($myself, 'accountId'));
        self::assertSame(Catalog::ACCOUNT_NAME, self::at($myself, 'displayName'));
    }

    public function testUnTicketRendSonTitreEtSonType(): void
    {
        $issue = $this->get('/rest/api/3/issue/SHOP-530?fields=summary,issuetype,parent')->toArray();

        self::assertSame('Le bouton Payer reste désactivé après une erreur de validation', self::at($issue, 'fields', 'summary'));
        self::assertSame(['id' => '10004', 'name' => 'Bug', 'subtask' => false, 'hierarchyLevel' => 0], self::at($issue, 'fields', 'issuetype'));
    }

    public function testUneSousTacheRendSonParent(): void
    {
        $issue = $this->get('/rest/api/3/issue/SHOP-531')->toArray();

        self::assertTrue(self::at($issue, 'fields', 'issuetype', 'subtask'));
        self::assertSame('SHOP-530', self::at($issue, 'fields', 'parent', 'key'));
        self::assertSame('Bug', self::at($issue, 'fields', 'parent', 'fields', 'issuetype', 'name'));
    }

    public function testUnTicketInconnuEstIntrouvable(): void
    {
        $response = $this->get('/rest/api/3/issue/SHOP-999');

        self::assertSame(404, $response->getStatusCode());
        self::assertSame(['Issue does not exist or you do not have permission to see it.'], self::at($response->toArray(false), 'errorMessages'));
    }

    public function testLaRechercheParIdentifiantNeRendQueLesTicketsQuiExistent(): void
    {
        $result = $this->get('/rest/api/3/search/jql?fields=summary,issuetype&jql='.rawurlencode('issueKey in (SHOP-482, SHOP-999, FERME-3)'))->toArray();

        self::assertSame(['SHOP-482', 'FERME-3'], array_column(self::listAt($result, 'issues'), 'key'));
        self::assertSame('Export CSV des commandes filtrées par période et par statut', self::at($result, 'issues', 0, 'fields', 'summary'));
        self::assertArrayNotHasKey('status', self::arrayAt($result, 'issues', 0, 'fields'));
    }

    public function testSansChampsDemandesLaRechercheNeRendQueLesIdentifiantsNumeriques(): void
    {
        $result = $this->get('/rest/api/3/search/jql?jql='.rawurlencode('key = SHOP-482'))->toArray();

        self::assertSame([['id' => Catalog::issueId('SHOP-482')]], self::listAt($result, 'issues'));
    }

    public function testUneRechercheSansAucunTicketExistantEstRefusee(): void
    {
        self::assertSame(400, $this->get('/rest/api/3/search/jql?jql='.rawurlencode('key = SHOP-999'))->getStatusCode());
        self::assertSame(400, $this->get('/rest/api/3/search/jql?jql='.rawurlencode('issueKey in (SHOP-998, SHOP-999)'))->getStatusCode());
    }

    public function testUneSaisieSAjouteSeRelitPuisSeSupprime(): void
    {
        $created = $this->addWorklog('SHOP-482', 5400);

        self::assertSame(201, $created->getStatusCode());
        $id = self::stringAt($created->toArray(), 'id');

        $mine = $this->myWorklogs('SHOP-482');
        self::assertCount(1, $mine);
        self::assertSame(5400, self::at($mine, 0, 'timeSpentSeconds'));
        self::assertSame(self::DAY, self::at($mine, 0, 'started'));
        // Comme Jira Cloud : l'identifiant numérique du ticket, et pas d'e-mail.
        self::assertSame(Catalog::issueId('SHOP-482'), self::at($mine, 0, 'issueId'));
        self::assertArrayNotHasKey('emailAddress', self::arrayAt($mine, 0, 'author'));

        self::assertSame(204, $this->request('DELETE', '/rest/api/3/issue/SHOP-482/worklog/'.$id)->getStatusCode());
        self::assertSame([], $this->myWorklogs('SHOP-482'));
        self::assertSame(404, $this->request('DELETE', '/rest/api/3/issue/SHOP-482/worklog/'.$id)->getStatusCode());
    }

    public function testLireUnJourMontreDejaLaDemiHeureDuCollegue(): void
    {
        $worklogs = self::listAt($this->get('/rest/api/3/issue/OPS-12/worklog?'.self::dayRange('2026-10-06'))->toArray(), 'worklogs');

        self::assertCount(1, $worklogs);
        self::assertSame(Catalog::COLLEAGUE_ID, self::at($worklogs, 0, 'author', 'accountId'));
        self::assertSame('2026-10-06T09:30:00.000+0200', self::at($worklogs, 0, 'started'));
    }

    public function testLeCollegueSePoseAussiSurDemande(): void
    {
        self::assertSame(204, $this->jira->handle(new FakeJiraRequest('POST', '/_simulation/collegue', body: '{"jour": "2026-12-01"}'))->status);

        $worklogs = self::listAt($this->get('/rest/api/3/issue/OPS-12/worklog')->toArray(), 'worklogs');
        self::assertSame('2026-12-01T09:30:00.000+0100', self::at($worklogs, 0, 'started'));
        self::assertSame(400, $this->jira->handle(new FakeJiraRequest('POST', '/_simulation/collegue', body: '{"jour": "demain"}'))->status);
    }

    public function testSupprimerLaDemiHeureDuCollegueReussitCommeDansJiraEtSeVoitAuJournal(): void
    {
        $this->addWorklog('SHOP-482', 900);
        $colleague = self::stringAt(self::listAt($this->get('/rest/api/3/issue/OPS-12/worklog')->toArray(), 'worklogs'), 0, 'id');

        self::assertSame(204, $this->request('DELETE', '/rest/api/3/issue/OPS-12/worklog/'.$colleague)->getStatusCode());

        self::assertSame([], self::listAt($this->get('/rest/api/3/issue/OPS-12/worklog')->toArray(), 'worklogs'));
        $alerts = array_filter(
            self::listAt($this->jira->handle(new FakeJiraRequest('GET', '/_simulation'))->body, 'journal'),
            static fn (array $entry): bool => isset($entry['alerte']),
        );
        self::assertCount(1, $alerts);
    }

    public function testLesFiltresDeDateNeRendentQueLeJourDemande(): void
    {
        $this->addWorklog('SHOP-482', 900);
        $this->request('POST', '/rest/api/3/issue/SHOP-482/worklog', ['started' => '2026-10-07T09:30:00.000+0200', 'timeSpentSeconds' => 1800])->getStatusCode();

        $worklogs = self::listAt($this->get('/rest/api/3/issue/SHOP-482/worklog?'.self::dayRange('2026-10-07'))->toArray(), 'worklogs');

        self::assertCount(1, $worklogs);
        self::assertSame(1800, self::at($worklogs, 0, 'timeSpentSeconds'));
    }

    public function testUneSaisieMalFormeeEstRefusee(): void
    {
        self::assertSame(400, $this->request('POST', '/rest/api/3/issue/SHOP-482/worklog', ['started' => '2026-10-06 09:30', 'timeSpentSeconds' => 900])->getStatusCode());
        self::assertSame(400, $this->request('POST', '/rest/api/3/issue/SHOP-482/worklog', ['started' => self::DAY, 'timeSpentSeconds' => 0])->getStatusCode());
        self::assertSame(400, $this->request('POST', '/rest/api/3/issue/SHOP-482/worklog', ['started' => self::DAY])->getStatusCode());
        self::assertSame(404, $this->addWorklog('SHOP-999', 900)->getStatusCode());
    }

    public function testUnCommentaireNePasseQuAuFormatDesDocumentsDAtlassian(): void
    {
        $plain = $this->request('POST', '/rest/api/3/issue/SHOP-482/worklog', ['started' => self::DAY, 'timeSpentSeconds' => 900, 'comment' => 'Revue de code']);
        self::assertSame(400, $plain->getStatusCode());

        $document = ['type' => 'doc', 'version' => 1, 'content' => [['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => 'Revue de code']]]]];
        $created = $this->request('POST', '/rest/api/3/issue/SHOP-482/worklog', ['started' => self::DAY, 'timeSpentSeconds' => 900, 'comment' => $document]);
        self::assertSame(201, $created->getStatusCode());
        self::assertSame($document, self::at($this->myWorklogs('SHOP-482'), 0, 'comment'));
    }

    public function testUnTicketAQuotaDemandeDeReessayerApresUnDelai(): void
    {
        $limited = $this->addWorklog('QUOTA-1', 900);

        self::assertSame(429, $limited->getStatusCode());
        self::assertSame([(string) Catalog::RETRY_AFTER_SECONDS], $limited->getHeaders(false)['retry-after']);
        self::assertSame([], $this->myWorklogs('QUOTA-1'));

        self::assertSame(201, $this->addWorklog('QUOTA-1', 900)->getStatusCode());
        self::assertCount(1, $this->myWorklogs('QUOTA-1'));
    }

    public function testUnTicketFermeRefuseLesHeures(): void
    {
        $response = $this->addWorklog('FERME-1', 900);

        self::assertSame(400, $response->getStatusCode());
        self::assertSame(['You can not log work on an issue that is closed.'], self::at($response->toArray(false), 'errorMessages'));
        self::assertSame('Fermé', self::at($this->get('/rest/api/3/issue/FERME-1')->toArray(), 'fields', 'status', 'name'));
    }

    public function testUnTicketTermineAccepteEncoreLesHeures(): void
    {
        self::assertSame(201, $this->addWorklog(Catalog::DONE.'-1', 900)->getStatusCode());
        self::assertSame('done', self::at($this->get('/rest/api/3/issue/'.Catalog::DONE.'-1')->toArray(), 'fields', 'status', 'statusCategory', 'key'));
    }

    public function testUnTicketOuvertPeutRefuserLesHeuresAUnCompte(): void
    {
        self::assertSame(403, $this->addWorklog(Catalog::FORBIDDEN.'-1', 900)->getStatusCode());
        self::assertSame('new', self::at($this->get('/rest/api/3/issue/'.Catalog::FORBIDDEN.'-1')->toArray(), 'fields', 'status', 'statusCategory', 'key'));
    }

    public function testLeCollegueSeRelieAussiEtNeVoitQueSonCompte(): void
    {
        $colleague = FakeJiraRequest::basic(Catalog::COLLEAGUE_EMAIL, Catalog::API_TOKEN);

        self::assertSame(Catalog::COLLEAGUE_ID, self::at($this->get('/rest/api/3/myself', $colleague)->toArray(), 'accountId'));
        self::assertSame(401, $this->get('/rest/api/3/myself', FakeJiraRequest::basic('inconnu@daytrack.test', Catalog::API_TOKEN))->getStatusCode());
    }

    public function testUnTicketEnPanneEchoueSurSesHeuresMaisSeVerifie(): void
    {
        self::assertSame(200, $this->get('/rest/api/3/issue/PANNE-1')->getStatusCode());
        self::assertSame(500, $this->addWorklog('PANNE-1', 900)->getStatusCode());
        self::assertSame(500, $this->get('/rest/api/3/issue/PANNE-1/worklog')->getStatusCode());
    }

    public function testUnTicketAMoitieNAccepteQuUneSaisieSurDeux(): void
    {
        self::assertSame(201, $this->addWorklog('MOITIE-1', 900)->getStatusCode());
        self::assertSame(503, $this->addWorklog('MOITIE-1', 900)->getStatusCode());
        self::assertSame(201, $this->addWorklog('MOITIE-1', 900)->getStatusCode());

        self::assertCount(2, $this->myWorklogs('MOITIE-1'));
    }

    public function testUnTicketEnEcartAccepteLesHeuresPuisNeLesMontrePas(): void
    {
        self::assertSame(201, $this->addWorklog('ECART-1', 900)->getStatusCode());
        self::assertSame([], $this->myWorklogs('ECART-1'));
    }

    public function testUnTicketLentFaitDepasserLeDelaiMaisEnregistreQuandMeme(): void
    {
        $response = $this->client->request('POST', '/rest/api/3/issue/LENT-1/worklog', [
            'headers' => ['Authorization' => FakeJiraRequest::basic(Catalog::ACCOUNT_EMAIL, Catalog::API_TOKEN)],
            'json' => ['started' => self::DAY, 'timeSpentSeconds' => 900],
            'timeout' => 1,
        ]);

        try {
            $response->getContent();
            self::fail('Le délai d\'attente aurait dû être dépassé.');
        } catch (TransportExceptionInterface) {
        }

        self::assertCount(1, $this->myWorklogs('LENT-1'));
    }

    public function testUneSaisieSeCorrigeSurPlaceEtGardeSonIdentifiant(): void
    {
        $id = self::stringAt($this->addWorklog('SHOP-482', 900)->toArray(), 'id');
        $document = ['type' => 'doc', 'version' => 1, 'content' => [['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => 'Revue']]]]];

        $updated = $this->request('PUT', '/rest/api/3/issue/SHOP-482/worklog/'.$id.'?notifyUsers=false', ['timeSpentSeconds' => 1800, 'comment' => $document]);

        self::assertSame(200, $updated->getStatusCode());
        self::assertSame($id, self::at($updated->toArray(), 'id'));
        $worklogs = $this->myWorklogs('SHOP-482');
        self::assertCount(1, $worklogs);
        self::assertSame(1800, self::at($worklogs, 0, 'timeSpentSeconds'));
        self::assertSame(self::DAY, self::at($worklogs, 0, 'started'));
        self::assertSame($document, self::at($worklogs, 0, 'comment'));

        // Comme Jira : un commentaire nul reste tel quel, un document vide l'efface.
        $this->request('PUT', '/rest/api/3/issue/SHOP-482/worklog/'.$id, ['comment' => null])->getStatusCode();
        self::assertSame($document, self::at($this->myWorklogs('SHOP-482'), 0, 'comment'));
        $empty = ['type' => 'doc', 'version' => 1, 'content' => []];
        $this->request('PUT', '/rest/api/3/issue/SHOP-482/worklog/'.$id, ['comment' => $empty])->getStatusCode();
        self::assertSame($empty, self::at($this->myWorklogs('SHOP-482'), 0, 'comment'));
    }

    public function testUneCorrectionMalFormeeOuIntrouvableEstRefusee(): void
    {
        $id = self::stringAt($this->addWorklog('SHOP-482', 900)->toArray(), 'id');

        self::assertSame(400, $this->request('PUT', '/rest/api/3/issue/SHOP-482/worklog/'.$id, ['timeSpentSeconds' => 0])->getStatusCode());
        self::assertSame(400, $this->request('PUT', '/rest/api/3/issue/SHOP-482/worklog/'.$id, ['started' => '2026-10-06 09:30'])->getStatusCode());
        self::assertSame(400, $this->request('PUT', '/rest/api/3/issue/SHOP-482/worklog/'.$id, ['comment' => 'texte brut'])->getStatusCode());
        self::assertSame(404, $this->request('PUT', '/rest/api/3/issue/SHOP-482/worklog/99999', ['timeSpentSeconds' => 900])->getStatusCode());
        self::assertSame(404, $this->request('PUT', '/rest/api/3/issue/SHOP-498/worklog/'.$id, ['timeSpentSeconds' => 900])->getStatusCode());
        self::assertSame(900, self::at($this->myWorklogs('SHOP-482'), 0, 'timeSpentSeconds'));
    }

    public function testCorrigerLaDemiHeureDuCollegueReussitCommeDansJiraEtSeVoitAuJournal(): void
    {
        $this->jira->handle(new FakeJiraRequest('POST', '/_simulation/collegue', body: '{"jour": "2026-10-06"}'));
        $colleague = self::stringAt(self::listAt($this->get('/rest/api/3/issue/OPS-12/worklog')->toArray(), 'worklogs'), 0, 'id');

        self::assertSame(200, $this->request('PUT', '/rest/api/3/issue/OPS-12/worklog/'.$colleague, ['timeSpentSeconds' => 900])->getStatusCode());

        $journal = self::listAt($this->jira->handle(new FakeJiraRequest('GET', '/_simulation'))->body, 'journal');
        self::assertSame('Saisie d\'un autre utilisateur modifiée', self::at($journal, 0, 'alerte'));
    }

    public function testLeResteAFaireSuitLesHeuresSansDescendreSousZero(): void
    {
        $remaining = fn (): mixed => self::at($this->get('/rest/api/3/issue/SHOP-482?fields=timetracking')->toArray(), 'fields', 'timetracking', 'remainingEstimateSeconds');

        self::assertSame(Catalog::INITIAL_ESTIMATE_SECONDS, $remaining());

        $id = self::stringAt($this->addWorklog('SHOP-482', 3600)->toArray(), 'id');
        self::assertSame(10800, $remaining());

        // Une correction l'ajuste de la différence.
        $this->request('PUT', '/rest/api/3/issue/SHOP-482/worklog/'.$id, ['timeSpentSeconds' => 5400])->getStatusCode();
        self::assertSame(9000, $remaining());

        // Au-delà du reste, il s'arrête à zéro, et une suppression rend ensuite ce qu'elle retire.
        $beyond = self::stringAt($this->addWorklog('SHOP-482', 36000)->toArray(), 'id');
        self::assertSame(0, $remaining());
        $this->request('DELETE', '/rest/api/3/issue/SHOP-482/worklog/'.$beyond)->getStatusCode();
        self::assertSame(36000, $remaining());

        // « leave » n'y touche pas ; une autre façon de l'ajuster n'est pas simulée.
        $this->request('DELETE', '/rest/api/3/issue/SHOP-482/worklog/'.$id.'?adjustEstimate=leave')->getStatusCode();
        self::assertSame(36000, $remaining());
        self::assertSame(400, $this->request('POST', '/rest/api/3/issue/SHOP-482/worklog?adjustEstimate=new', ['started' => self::DAY, 'timeSpentSeconds' => 900])->getStatusCode());
    }

    public function testLesSaisiesSeLisentParPage(): void
    {
        foreach ([900, 1800, 2700] as $seconds) {
            $this->addWorklog('SHOP-482', $seconds);
        }

        $page = $this->get('/rest/api/3/issue/SHOP-482/worklog?startAt=1&maxResults=1')->toArray();

        self::assertSame(3, self::at($page, 'total'));
        self::assertSame(1, self::at($page, 'startAt'));
        self::assertSame([1800], array_column(self::listAt($page, 'worklogs'), 'timeSpentSeconds'));
    }

    public function testUnTicketFermeSeReconnaitASaCategorieDeStatut(): void
    {
        self::assertSame('done', self::at($this->get('/rest/api/3/issue/FERME-1?fields=status')->toArray(), 'fields', 'status', 'statusCategory', 'key'));
        self::assertSame('new', self::at($this->get('/rest/api/3/issue/SHOP-482?fields=status')->toArray(), 'fields', 'status', 'statusCategory', 'key'));
    }

    public function testUnTicketFermeOuEnPanneRefuseAussiLesCorrectionsEtLesSuppressions(): void
    {
        self::assertSame(400, $this->request('PUT', '/rest/api/3/issue/FERME-1/worklog/10000', ['timeSpentSeconds' => 900])->getStatusCode());
        self::assertSame(400, $this->request('DELETE', '/rest/api/3/issue/FERME-1/worklog/10000')->getStatusCode());
        self::assertSame(500, $this->request('PUT', '/rest/api/3/issue/PANNE-1/worklog/10000', ['timeSpentSeconds' => 900])->getStatusCode());
    }

    public function testUnTicketAQuotaLimiteAussiLesCorrectionsEtLesSuppressions(): void
    {
        $this->addWorklog('QUOTA-1', 900);
        $id = self::stringAt($this->addWorklog('QUOTA-1', 900)->toArray(), 'id');

        self::assertSame(429, $this->request('PUT', '/rest/api/3/issue/QUOTA-1/worklog/'.$id, ['timeSpentSeconds' => 1800])->getStatusCode());
        self::assertSame(200, $this->request('PUT', '/rest/api/3/issue/QUOTA-1/worklog/'.$id, ['timeSpentSeconds' => 1800])->getStatusCode());
        self::assertSame(429, $this->request('DELETE', '/rest/api/3/issue/QUOTA-1/worklog/'.$id)->getStatusCode());
        self::assertSame(204, $this->request('DELETE', '/rest/api/3/issue/QUOTA-1/worklog/'.$id)->getStatusCode());
    }

    public function testLeJournalNoteSiJiraDevaitPrevenirLesObservateurs(): void
    {
        $this->addWorklog('SHOP-482', 900);
        $this->request('POST', '/rest/api/3/issue/SHOP-498/worklog', ['started' => self::DAY, 'timeSpentSeconds' => 900])->getStatusCode();

        $journal = self::listAt($this->jira->handle(new FakeJiraRequest('GET', '/_simulation'))->body, 'journal');

        self::assertSame(['notifyUsers' => 'false'], self::at($journal, 0, 'query'));
        self::assertNull(self::at($journal, 1, 'query'));
    }

    public function testLeJournalGardeCeQuiAEteEcrit(): void
    {
        $this->addWorklog('SHOP-482', 900);
        $this->addWorklog('FERME-1', 900);

        $journal = self::listAt($this->jira->handle(new FakeJiraRequest('GET', '/_simulation'))->body, 'journal');

        self::assertSame([201, 400], array_column($journal, 'status'));
        self::assertSame(['started' => self::DAY, 'timeSpentSeconds' => 900], self::at($journal, 0, 'body'));
    }

    public function testLaRemiseAZeroEffaceTout(): void
    {
        $this->addWorklog('SHOP-482', 900);

        self::assertSame(204, $this->jira->handle(new FakeJiraRequest('POST', '/_simulation/reinitialiser'))->status);
        self::assertSame([], $this->myWorklogs('SHOP-482'));
    }

    /** Les bornes d'un jour de Paris, comme DayTrack les passera : startedAfter et startedBefore, en millisecondes. */
    private static function dayRange(string $day): string
    {
        $start = new \DateTimeImmutable($day, new \DateTimeZone('Europe/Paris'));

        return http_build_query(['startedAfter' => $start->format('Uv'), 'startedBefore' => $start->modify('+1 day')->format('Uv')]);
    }

    /** Un appel de l'API par la passerelle d'Atlassian, au site du Jira simulé. */
    private static function gateway(string $route): string
    {
        return 'https://api.atlassian.com/ex/jira/'.Catalog::CLOUD_ID.'/rest/api/3/'.$route;
    }

    private function get(string $path, ?string $authorization = 'défaut'): ResponseInterface
    {
        return $this->client->request('GET', $path, [
            'headers' => null === $authorization ? [] : ['Authorization' => 'défaut' === $authorization ? FakeJiraRequest::basic(Catalog::ACCOUNT_EMAIL, Catalog::API_TOKEN) : $authorization],
        ]);
    }

    /**
     * @param array<string, mixed>|null $json
     */
    private function request(string $method, string $path, ?array $json = null): ResponseInterface
    {
        $options = ['headers' => ['Authorization' => FakeJiraRequest::basic(Catalog::ACCOUNT_EMAIL, Catalog::API_TOKEN)]];
        if (null !== $json) {
            $options['json'] = $json;
        }

        return $this->client->request($method, $path, $options);
    }

    private function addWorklog(string $key, int $seconds): ResponseInterface
    {
        $response = $this->request('POST', '/rest/api/3/issue/'.$key.'/worklog?notifyUsers=false', ['started' => self::DAY, 'timeSpentSeconds' => $seconds]);
        // Lire le statut marque la réponse comme vue : un refus attendu ne lève pas
        // d'exception à la destruction de la réponse.
        $response->getStatusCode();

        return $response;
    }

    /**
     * @return list<array<mixed>>
     */
    private function myWorklogs(string $key): array
    {
        return array_values(array_filter(
            self::listAt($this->get('/rest/api/3/issue/'.$key.'/worklog')->toArray(), 'worklogs'),
            static fn (array $worklog): bool => Catalog::ACCOUNT_ID === self::at($worklog, 'author', 'accountId'),
        ));
    }
}
