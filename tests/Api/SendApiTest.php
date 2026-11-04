<?php

namespace App\Tests\Api;

use App\Dev\Jira\Catalog;
use App\Dev\Jira\FakeJiraRequest;
use App\Jira\JiraWorklog;
use App\Tests\Support\DayApi;
use App\Tests\Support\JiraApi;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Clock\Clock;

/**
 * L'envoi d'une journée sur Jira, par sa route, contre le Jira simulé : ce qui arrive
 * dans Jira, ce qui n'y arrive pas et se dit ticket par ticket, et l'état gardé du
 * jour. Aucun test n'atteint un vrai Jira.
 */
final class SendApiTest extends WebTestCase
{
    use DayApi;
    use JiraApi;

    private const string DAY = '2026-10-06';

    public function testUneJourneeEnvoyeeEstDansJiraEtSeDitEnvoyee(): void
    {
        $this->linkJira();
        $day = $this->write(0, [
            self::work('09:30', '10:15', 'SHOP-482', 'Revue de code'),
            self::pause('12:00', '13:00'),
            self::work('14:00', '14:30', 'OPS-12'),
            self::work('15:00', '15:15', 'SHOP-482', 'Revue de code'),
        ]);

        self::assertSame('unsent', self::at($day, 'send', 'state'));

        [$status, $sent] = $this->sendDay(self::intAt($day, 'version'));

        self::assertSame(200, $status, (string) json_encode($sent));
        self::assertSame('sent', self::at($sent, 'send', 'state'));
        self::assertSame(['date' => self::DAY, 'time' => '15:20'], self::at($sent, 'send', 'sentAt'));
        // Une saisie par ticket et par commentaire, à l'heure de son premier quart
        // d'heure ; la pause n'est pas envoyée.
        self::assertSame([
            'OPS-12 2026-10-06T14:00:00.000+0200 1800',
            'SHOP-482 2026-10-06T09:30:00.000+0200 3600 « Revue de code »',
        ], $this->myWorklogs());
        self::assertSame('sent', self::at($this->day(), 'send', 'state'), 'Un rechargement le retrouve.');
    }

    public function testChaqueEcritureDemandeAJiraDeNePrevenirPersonneEtDeSuivreLeResteAFaire(): void
    {
        $this->linkJira();
        $day = $this->write(0, [self::work('09:30', '10:30', 'SHOP-482')]);
        $day = $this->sendOk($day);
        $day = $this->write(self::intAt($day, 'version'), [self::work('10:30', '10:45', 'SHOP-482'), self::work('11:00', '11:15', 'OPS-7')]);
        $day = $this->sendOk($day);
        $day = $this->write(self::intAt($day, 'version'), [self::clear('11:00', '11:15')]);
        $this->sendOk($day);

        $writes = $this->writes();
        self::assertSame(['POST', 'PUT', 'POST', 'DELETE'], array_column($writes, 'method'));
        foreach ($writes as $write) {
            self::assertSame(['notifyUsers' => 'false', 'adjustEstimate' => 'auto'], $write['query']);
        }

        // 4h00 au départ, 1h15 sur SHOP-482 ; OPS-7 a rendu le quart d'heure retiré.
        self::assertSame(Catalog::INITIAL_ESTIMATE_SECONDS - 4500, $this->remaining('SHOP-482'));
        self::assertSame(Catalog::INITIAL_ESTIMATE_SECONDS, $this->remaining('OPS-7'));
    }

    public function testRenvoyerDixFoisNeLaissePasDixTraces(): void
    {
        $this->linkJira();
        $day = $this->write(0, [self::work('09:30', '09:45', 'SHOP-482', 'Revue')]);
        $day = $this->sendOk($day);
        $id = $this->worklogIds()[0];

        foreach ([self::work('09:30', '10:00', 'SHOP-482', 'Revue'), self::clear('09:45', '10:00'), self::work('09:30', '09:45', 'SHOP-482', 'Tests')] as $change) {
            $day = $this->write(self::intAt($day, 'version'), [$change]);
            self::assertSame('modified', self::at($day, 'send', 'state'));
            $day = $this->sendOk($day);
        }

        self::assertSame([$id], $this->worklogIds(), 'Une seule saisie, qui garde son identifiant.');
        self::assertSame(['SHOP-482 2026-10-06T09:30:00.000+0200 900 « Tests »'], $this->myWorklogs());
        self::assertSame(['POST', 'PUT', 'PUT', 'PUT'], array_column($this->writes(), 'method'));
    }

    public function testUnEnvoiQuiNeChangeRienNEcritRien(): void
    {
        $this->linkJira();
        $day = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'SHOP-482')]));

        // Une pause ajoutée ne change rien à ce qui part.
        $day = $this->write(self::intAt($day, 'version'), [self::pause('12:00', '12:30')]);
        self::assertSame('sent', self::at($day, 'send', 'state'));
        $this->sendOk($day);

        self::assertSame(['POST'], array_column($this->writes(), 'method'));
    }

    public function testDefaireUneModificationRendLaJourneeEnvoyee(): void
    {
        $this->linkJira();
        $day = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'SHOP-482')]));

        $day = $this->write(self::intAt($day, 'version'), [self::work('10:30', '10:45', 'SHOP-482')]);
        self::assertSame('modified', self::at($day, 'send', 'state'));
        $day = $this->write(self::intAt($day, 'version'), [self::clear('10:30', '10:45')]);
        self::assertSame('sent', self::at($day, 'send', 'state'));
    }

    public function testLesHeuresDUnCollegueNeSontJamaisTouchees(): void
    {
        $this->linkJira();
        $day = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'OPS-12')]));
        $day = $this->write(self::intAt($day, 'version'), [self::clear('09:30', '10:30')]);
        $this->sendOk($day);

        $colleague = array_values(array_filter(self::listAt($this->jiraState(), 'worklogs'), static fn (array $worklog): bool => Catalog::COLLEAGUE_ID === $worklog['authorId']));
        self::assertCount(1, $colleague);
        self::assertSame(1800, $colleague[0]['timeSpentSeconds']);
        self::assertSame([], array_filter(self::listAt($this->jiraState(), 'journal'), static fn (array $entry): bool => isset($entry['alerte'])));
    }

    public function testDesHeuresSaisiesDansJiraPourUnTicketDeLaJourneeSontRemplaceesSansDouble(): void
    {
        $this->linkJira();
        $this->jiraRequest('POST', 'issue/SHOP-482/worklog', ['started' => '2026-10-06T16:00:00.000+0200', 'timeSpentSeconds' => 3600]);
        $this->jiraRequest('POST', 'issue/SHOP-482/worklog', ['started' => '2026-10-06T17:00:00.000+0200', 'timeSpentSeconds' => 900]);
        // Un autre jour n'est pas concerné.
        $this->jiraRequest('POST', 'issue/SHOP-482/worklog', ['started' => '2026-10-07T09:00:00.000+0200', 'timeSpentSeconds' => 900]);

        $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'SHOP-482')]));

        self::assertSame([
            'SHOP-482 2026-10-06T09:30:00.000+0200 3600',
            'SHOP-482 2026-10-07T09:00:00.000+0200 900',
        ], $this->myWorklogs());
    }

    public function testUnTicketRetireDepuisLEnvoiSeRetireDeJiraAuRenvoi(): void
    {
        $this->linkJira();
        $day = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'SHOP-482'), self::work('10:30', '11:00', 'OPS-7')]));

        $day = $this->write(self::intAt($day, 'version'), [self::clear('10:30', '11:00')]);

        self::assertSame('modified', self::at($day, 'send', 'state'));
        self::assertSame(['OPS-7'], self::at($day, 'send', 'removed'));
        self::assertArrayHasKey('OPS-7', self::arrayAt($day, 'tickets'), 'La confirmation le montre à 0h00, avec son titre.');

        $day = $this->sendOk($day);

        self::assertSame(['SHOP-482 2026-10-06T09:30:00.000+0200 3600'], $this->myWorklogs());
        self::assertSame('sent', self::at($day, 'send', 'state'));
        self::assertSame(['OPS-7'], self::at($day, 'send', 'removed'), 'Le détail de cet envoi dit ce qu\'il a retiré de Jira.');

        // Modifiée ensuite, puis renvoyée : ce ticket-là n'a plus rien à voir avec elle.
        $day = $this->write(self::intAt($day, 'version'), [self::work('11:00', '11:30', 'SHOP-482')]);
        self::assertSame([], self::at($day, 'send', 'removed'), 'Jira n\'en a plus rien : le renvoi ne le montre plus.');
        $day = $this->sendOk($day);
        self::assertSame([], self::at($day, 'send', 'removed'));
    }

    public function testUneJourneeVideeApresUnEnvoiSeRenvoiePuisNAPlusRienAEnvoyer(): void
    {
        $this->linkJira();
        $day = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'SHOP-482')]));

        $day = $this->write(self::intAt($day, 'version'), [self::clear('09:30', '10:30')]);
        self::assertSame('modified', self::at($day, 'send', 'state'));
        self::assertSame(['2026-10-06' => 'modified'], $this->marks());

        $day = $this->sendOk($day);

        self::assertSame([], $this->myWorklogs());
        self::assertSame('nothing', self::at($day, 'send', 'state'));
        self::assertSame([], $this->marks());

        // Une nouvelle saisie repart d'une journée jamais envoyée.
        $day = $this->write(self::intAt($day, 'version'), [self::work('09:30', '09:45', 'OPS-7')]);
        self::assertSame('unsent', self::at($day, 'send', 'state'));
    }

    public function testUnJourPasseEnvoyePuisVideEstIncompletEtSeRenvoieQuandMeme(): void
    {
        $this->watchEmptyDaysSince('2026-09-30 10:00:00 Europe/Paris');
        $this->linkJira();
        $day = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'SHOP-482')], '2026-10-05'), '2026-10-05');

        $day = $this->write(self::intAt($day, 'version'), [self::clear('09:30', '10:30')], '2026-10-05');
        self::assertSame('modified', self::at($day, 'send', 'state'), 'Le bouton dit toujours « Renvoyer sur Jira ».');
        self::assertSame('incomplete', self::at($this->marks(), '2026-10-05'), 'Une seule marque : le losange l\'emporte sur « Modifié ».');

        $day = $this->sendOk($day, '2026-10-05');
        self::assertSame([], $this->myWorklogs());
        self::assertSame('nothing', self::at($day, 'send', 'state'));
        self::assertSame('incomplete', self::at($this->marks(), '2026-10-05'), 'Toujours vide, toujours oublié.');
    }

    public function testLeCalendrierLitLEtatDeChaqueJour(): void
    {
        $this->linkJira();
        $sent = $this->sendOk($this->write(0, [self::work('07:00', '14:30', 'SHOP-482')], '2026-10-05'), '2026-10-05');
        $modified = $this->sendOk($this->write(0, [self::work('07:00', '14:30', 'SHOP-482')], '2026-10-02'), '2026-10-02');
        $this->write(self::intAt($modified, 'version'), [self::work('14:30', '15:00', 'OPS-7')], '2026-10-02');
        $incomplete = $this->sendOk($this->write(0, [self::work('09:00', '10:00', 'SHOP-482')], '2026-10-01'), '2026-10-01');
        $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')]);

        self::assertSame('sent', self::at($sent, 'send', 'state'));
        self::assertSame('sent', self::at($incomplete, 'send', 'state'));
        self::assertSame([
            '2026-10-01' => 'incomplete',
            '2026-10-02' => 'modified',
            '2026-10-05' => 'sent',
            '2026-10-06' => 'unsent',
        ], $this->marks());
    }

    public function testUnOngletEnRetardNEnvoieRien(): void
    {
        $this->linkJira();
        $day = $this->write(0, [self::work('09:30', '10:30', 'SHOP-482')]);
        $this->write(self::intAt($day, 'version'), [self::work('10:30', '10:45', 'SHOP-482')]);

        [$status, $body] = $this->sendDay(self::intAt($day, 'version'));

        self::assertSame(409, $status);
        self::assertSame('stale', $body['error']);
        self::assertSame(['09:30-10:45 SHOP-482'], self::blocks(self::arrayAt($body, 'day')));
        self::assertSame([], $this->writes());
    }

    public function testUneJourneeSansRienAEnvoyerNEnvoieRien(): void
    {
        $this->linkJira();

        [$status, $body] = $this->sendDay(0);
        self::assertSame(409, $status);
        self::assertSame('nothing', $body['error']);

        $day = $this->write(0, [self::pause('12:00', '13:00')]);
        [$status, $body] = $this->sendDay(self::intAt($day, 'version'));
        self::assertSame(409, $status);
        self::assertSame('nothing', $body['error']);
        self::assertSame('nothing', self::at($body, 'day', 'send', 'state'));
        self::assertSame(0, $this->dayRows() - 1, 'Rien d\'autre ne s\'est créé.');
        self::assertSame([], $this->writes());
    }

    public function testDeuxEnvoisNePartentJamaisEnsemble(): void
    {
        $this->linkJira();
        $day = $this->write(0, [self::work('09:30', '10:30', 'SHOP-482')]);
        $this->sendOk($day);
        $this->connection()->executeStatement("UPDATE day_send SET sending_since = '2026-10-06 13:18:00'");

        [$status, $body] = $this->sendDay(self::intAt($day, 'version'));

        self::assertSame(409, $status);
        self::assertSame('sending', $body['error']);
        self::assertSame('sending', self::at($body, 'day', 'send', 'state'));
        self::assertSame('sent', self::at($this->marks(), self::DAY), 'Le calendrier garde sa marque.');

        // Un envoi interrompu depuis plus de cinq minutes ne retient plus rien.
        $this->connection()->executeStatement("UPDATE day_send SET sending_since = '2026-10-06 13:15:00'");
        self::assertSame(200, $this->sendDay(self::intAt($day, 'version'))[0]);
    }

    public function testSansJiraRelieRienNePart(): void
    {
        $day = $this->write(0, [self::work('09:30', '10:30', 'SHOP-482')]);

        [$status, $body] = $this->sendDay(self::intAt($day, 'version'));

        self::assertSame(409, $status);
        self::assertSame('unlinked', self::at($body, 'error'));
        self::assertSame(0, $this->connection()->fetchOne('SELECT COUNT(*) FROM day_send'), 'Aucun envoi ne se garde.');
        self::assertSame('unsent', self::at($this->day(), 'send', 'state'));
    }

    public function testUneJourneeEnvoyeeSousUnCompteNeLEstPasSousUnAutre(): void
    {
        $this->linkJira();
        $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'SHOP-482', 'Revue')]));

        // Relié au compte d'un autre, qui n'en a rien reçu : la journée et le calendrier
        // le disent, et l'envoyer sous ce compte ne touche pas aux heures du premier.
        $this->linkJira(email: Catalog::COLLEAGUE_EMAIL);
        $day = $this->day();
        self::assertSame('unsent', self::at($day, 'send', 'state'));
        self::assertSame([self::DAY => 'unsent'], $this->marks());
        self::assertSame('sent', self::at($this->sendOk($day), 'send', 'state'));
        self::assertSame(['SHOP-482 2026-10-06T09:30:00.000+0200 3600 « Revue »'], $this->myWorklogs());
        $colleague = [
            'OPS-12 2026-10-06T09:30:00.000+0200 1800',
            'SHOP-482 2026-10-06T09:30:00.000+0200 3600 « Revue »',
        ];
        self::assertSame($colleague, $this->worklogsOf(Catalog::COLLEAGUE_ID));

        // Revenu au premier compte, la journée se retrouve envoyée, et la renvoyer
        // changée ne retire que ses heures à lui.
        $this->linkJira();
        $day = $this->day();
        self::assertSame('sent', self::at($day, 'send', 'state'));
        $day = $this->sendOk($this->write(self::intAt($day, 'version'), [self::work('09:30', '10:30', 'OPS-7')]));
        self::assertSame('sent', self::at($day, 'send', 'state'));
        self::assertSame(['OPS-7 2026-10-06T09:30:00.000+0200 3600'], $this->myWorklogs());
        self::assertSame($colleague, $this->worklogsOf(Catalog::COLLEAGUE_ID));

        // Et pour l'autre compte, la journée a changé depuis son envoi.
        $this->linkJira(email: Catalog::COLLEAGUE_EMAIL);
        self::assertSame('modified', self::at($this->day(), 'send', 'state'));
    }

    public function testLeMemeJiraQuiDitEnfinSonIdentifiantGardeLEtatDEnvoiDeSesJournees(): void
    {
        $this->linkJira();
        $day = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'SHOP-482'), self::work('10:30', '11:00', 'OPS-7')]));
        // Comme une base d'avant, ou un site resté muet à la première liaison.
        $this->connection()->executeStatement("UPDATE jira_connection SET instance = 'https://jira'");
        $this->connection()->executeStatement("UPDATE day_send SET instance = 'https://jira'");
        $day = $this->write(self::intAt($day, 'version'), [self::clear('10:30', '11:00')]);

        // Le jeton renouvelé, sur le même site : le site dit cette fois son identifiant.
        $this->linkJira();

        self::assertSame(Catalog::CLOUD_ID, $this->connection()->fetchOne('SELECT DISTINCT instance FROM day_send'));
        self::assertSame('modified', self::at($this->day(), 'send', 'state'));
        // Le renvoi retire de Jira le ticket que la journée a quitté.
        self::assertSame('sent', self::at($this->sendOk($this->day()), 'send', 'state'));
        self::assertSame(['SHOP-482 2026-10-06T09:30:00.000+0200 3600'], $this->myWorklogs());
    }

    public function testUnePageDUnAutreSiteNePeutPasEnvoyer(): void
    {
        $this->linkJira();
        $day = $this->write(0, [self::work('09:30', '10:30', 'SHOP-482')]);

        [$status] = $this->sendDay(self::intAt($day, 'version'), server: ['HTTP_SEC_FETCH_SITE' => 'cross-site']);
        self::assertSame(403, $status);
        [$status] = $this->send('POST', '/api/days/'.self::DAY.'/send', 'version=1', contentType: 'application/x-www-form-urlencoded');
        self::assertSame(415, $status);

        self::assertSame([], $this->writes());
        self::assertSame('unsent', self::at($this->day(), 'send', 'state'));
    }

    public function testUnEnvoiMalFormeEstRefuse(): void
    {
        $this->linkJira();

        self::assertSame(422, $this->send('POST', '/api/days/'.self::DAY.'/send', ['version' => -1])[0]);
        self::assertSame(422, $this->send('POST', '/api/days/'.self::DAY.'/send', ['version' => 1, 'force' => true])[0]);
        self::assertSame(422, $this->send('POST', '/api/days/'.self::DAY.'/send', [])[0]);
        self::assertSame(404, $this->send('POST', '/api/days/2026-11-06/send', ['version' => 0])[0], 'Au-delà des trente jours.');
        self::assertSame(404, $this->send('POST', '/api/days/2026-02-30/send', ['version' => 0])[0]);
    }

    public function testUnTicketFermeFaitUnEnvoiPartielQuiSeDitTicketParTicket(): void
    {
        $this->linkJira();
        $day = $this->write(0, [self::work('09:30', '10:30', 'SHOP-482'), self::work('10:30', '11:00', 'FERME-1')]);

        $day = $this->sendOk($day);

        self::assertSame('partial', self::at($day, 'send', 'state'));
        self::assertSame(['SHOP-482' => null, 'FERME-1' => 'closed'], self::at($day, 'send', 'outcomes'));
        self::assertNull(self::at($day, 'send', 'sentAt'));
        self::assertSame(['date' => self::DAY, 'time' => '15:20'], self::at($day, 'send', 'attemptedAt'));
        self::assertSame(['SHOP-482 2026-10-06T09:30:00.000+0200 3600'], $this->myWorklogs());
        self::assertSame('partial', self::at($this->day(), 'send', 'state'), 'Un rechargement le retrouve.');
        self::assertSame(['2026-10-06' => 'unsent'], $this->marks());

        // Modifiée ensuite, elle repart de la confirmation : elle n'a jamais été envoyée en entier.
        $day = $this->write(self::intAt($day, 'version'), [self::work('10:30', '11:00', 'OPS-7')]);
        self::assertSame('unsent', self::at($day, 'send', 'state'));
        // Jira a refusé FERME-1 : rien n'y est à retirer.
        self::assertSame([], self::at($day, 'send', 'removed'));

        $day = $this->sendOk($day);
        self::assertSame('sent', self::at($day, 'send', 'state'));
    }

    public function testUnTicketTermineQueJiraAccepteSEnvoieCommeLesAutres(): void
    {
        $this->linkJira();
        $day = $this->write(0, [self::work('09:30', '10:30', Catalog::DONE.'-1', 'Heures en retard')]);

        // DayTrack ne refuse rien de lui-même : seul un refus de Jira fait un ticket
        // « fermé ».
        $day = $this->sendOk($day);

        self::assertSame('sent', self::at($day, 'send', 'state'));
        self::assertSame([Catalog::DONE.'-1 2026-10-06T09:30:00.000+0200 3600 « Heures en retard »'], $this->myWorklogs());
    }

    public function testChaqueRefusDeJiraSeDitParSaPropreRaison(): void
    {
        $this->linkJira();
        $day = $this->write(0, [
            self::work('09:00', '09:30', 'SHOP-482'),
            self::work('09:30', '10:00', 'FERME-1'),
            self::work('10:00', '10:30', Catalog::FORBIDDEN.'-1'),
            self::work('10:30', '11:00', 'OPS-7'),
        ]);
        // OPS-7 supprimé de Jira depuis qu'il a été saisi.
        $this->connection()->executeStatement("UPDATE slot SET ticket = 'SUPPRIME-1' WHERE ticket = 'OPS-7'");
        $this->connection()->executeStatement('UPDATE day SET version = version + 1');

        $day = $this->sendOk($this->day());

        self::assertSame('partial', self::at($day, 'send', 'state'));
        self::assertSame([
            'SHOP-482' => null,
            'FERME-1' => 'closed',
            Catalog::FORBIDDEN.'-1' => 'rejected',
            'SUPPRIME-1' => 'not_found',
        ], self::at($day, 'send', 'outcomes'));
        self::assertSame(['SHOP-482 2026-10-06T09:00:00.000+0200 1800'], $this->myWorklogs());
    }

    public function testUnEnvoiPartielApresUnEnvoiCompletRepartDuRenvoi(): void
    {
        $this->linkJira();
        $day = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'SHOP-482')]));
        $day = $this->sendOk($this->write(self::intAt($day, 'version'), [self::work('10:30', '11:00', 'FERME-1')]));

        self::assertSame('partial', self::at($day, 'send', 'state'));
        self::assertSame(['date' => self::DAY, 'time' => '15:20'], self::at($day, 'send', 'sentAt'));

        $day = $this->write(self::intAt($day, 'version'), [self::clear('10:30', '11:00')]);
        self::assertSame('sent', self::at($day, 'send', 'state'), 'Revenue à ce qui est dans Jira.');
        $day = $this->write(self::intAt($day, 'version'), [self::work('10:30', '11:00', 'OPS-7')]);
        self::assertSame('modified', self::at($day, 'send', 'state'));
    }

    public function testDesHeuresQueLaRelectureNeRetrouvePasFontUnEnvoiPartiel(): void
    {
        $this->linkJira();
        $day = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'SHOP-482'), self::work('10:30', '11:00', 'ECART-1')]));

        self::assertSame('partial', self::at($day, 'send', 'state'));
        self::assertSame(['SHOP-482' => null, 'ECART-1' => 'mismatch'], self::at($day, 'send', 'outcomes'));
        self::assertSame(['POST', 'POST'], array_column($this->writes(), 'method'), 'Jira a dit avoir tout pris : rien ne se réécrit à l\'aveugle.');
    }

    public function testDesHeuresAccepteesPuisPerduesDisentCeQueJiraEnAGarde(): void
    {
        $this->linkJira();
        $day = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'SHOP-482'), self::work('10:30', '11:00', 'ECART-1')]));

        self::assertSame(['ECART-1' => 0], self::at($day, 'send', 'inJira'));
    }

    public function testUneRelectureSansReponseSeDitNonVerifieeEtLEssaiSuivantNEcritPasDeDouble(): void
    {
        $this->linkJira();
        $day = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'MUET-1'), self::work('10:30', '11:00', 'SHOP-482')]));

        self::assertSame('unverified', self::at($day, 'send', 'state'));
        self::assertNull(self::at($day, 'send', 'failure'));
        self::assertSame(['MUET-1' => 'unverified', 'SHOP-482' => null], self::at($day, 'send', 'outcomes'));
        self::assertSame([
            'MUET-1 2026-10-06T09:30:00.000+0200 3600',
            'SHOP-482 2026-10-06T10:30:00.000+0200 1800',
        ], $this->myWorklogs(), 'Jira a bien ces heures : l\'écran ne peut pas dire qu\'il n\'a rien.');
        self::assertSame('unverified', self::at($this->day(), 'send', 'state'), 'Un rechargement le retrouve.');
        self::assertSame(['2026-10-06' => 'unsent'], $this->marks(), 'Non vérifiée, la journée reste non envoyée.');

        $writes = \count($this->writes());
        $day = $this->sendOk($day);

        self::assertSame('sent', self::at($day, 'send', 'state'));
        self::assertCount($writes, $this->writes(), 'L\'essai suivant relit, et n\'a rien à écrire.');
    }

    public function testUnJetonRefuseALaRelectureSeDitNonVerifieEtRienNEstPerdu(): void
    {
        $this->linkJira();
        $day = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'JETON-1')]));

        self::assertSame('unverified', self::at($day, 'send', 'state'));
        self::assertSame('refused', self::at($day, 'send', 'failure'));
        self::assertSame(['JETON-1' => 'unverified'], self::at($day, 'send', 'outcomes'));
        self::assertSame(['JETON-1 2026-10-06T09:30:00.000+0200 3600'], $this->myWorklogs());
        $this->browser->request('GET', '/api/jira');
        self::assertSame('refused', self::at(json_decode((string) $this->browser->getResponse()->getContent(), true), 'refusal'));

        $this->simulate('jeton', ['refuse' => false]);
        $writes = \count($this->writes());
        $day = $this->sendOk($day);

        self::assertSame('sent', self::at($day, 'send', 'state'));
        self::assertCount($writes, $this->writes(), 'Rien ne part en double.');
    }

    public function testUnJetonRefuseEnPleinEnvoiNOublieAucuneEcriture(): void
    {
        $this->linkJira();

        // Les écritures partent ensemble : JETON-1 passe, puis le jeton est refusé à OPS-7.
        $day = $this->sendOk($this->write(0, [
            self::work('09:00', '09:30', 'SHOP-482'),
            self::work('09:30', '10:00', 'JETON-1'),
            self::work('10:00', '10:30', 'OPS-7'),
        ]));

        self::assertSame('unverified', self::at($day, 'send', 'state'));
        self::assertSame('refused', self::at($day, 'send', 'failure'));
        self::assertSame(['SHOP-482' => 'unverified', 'JETON-1' => 'unverified', 'OPS-7' => 'token_refused'], self::at($day, 'send', 'outcomes'));

        // Vidée ensuite, la journée retire bien de Jira ce que cet essai a pu y laisser.
        $this->simulate('jeton', ['refuse' => false]);
        $day = $this->write(self::intAt($day, 'version'), [self::clear('09:00', '10:30')]);
        self::assertSame(['JETON-1', 'SHOP-482'], $this->sorted(self::arrayAt($day, 'send', 'removed')));
        $day = $this->sendOk($day);
        self::assertSame([], $this->myWorklogs());
        self::assertSame('nothing', self::at($day, 'send', 'state'));
    }

    public function testReessayerUnEnvoiNonVerifiePendantUnePanneNeDitPasJiraVide(): void
    {
        $this->linkJira();
        $day = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'MUET-1'), self::work('10:30', '11:00', 'SHOP-482')]));
        self::assertSame('unverified', self::at($day, 'send', 'state'));

        $this->simulate('panne', ['panne' => true]);
        $day = $this->sendOk($day);
        $this->simulate('panne', ['panne' => false]);

        self::assertSame('unverified', self::at($day, 'send', 'state'), 'Jira a ces heures : ce n\'est pas un échec.');
        self::assertSame(['MUET-1' => 'unverified', 'SHOP-482' => 'unverified'], self::at($day, 'send', 'outcomes'));
        self::assertCount(2, $this->myWorklogs());

        $this->simulate('jeton', ['refuse' => true]);
        $day = $this->sendOk($day);
        $this->simulate('jeton', ['refuse' => false]);

        self::assertSame('unverified', self::at($day, 'send', 'state'));
        self::assertSame('refused', self::at($day, 'send', 'failure'));

        $day = $this->sendOk($day);
        self::assertSame('sent', self::at($day, 'send', 'state'));
        self::assertCount(2, $this->myWorklogs(), 'Sans double.');
    }

    public function testUneEcritureSansReponseNeDevientJamaisAccepteeNiAbsente(): void
    {
        $this->linkJira();
        $day = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'SOURD-1')]));

        self::assertSame('unverified', self::at($day, 'send', 'state'));
        self::assertSame(['SOURD-1' => 'unanswered'], self::at($day, 'send', 'outcomes'), 'Jira n\'a rien dit : rien ne dit qu\'il a accepté.');

        $this->simulate('panne', ['panne' => true]);
        $day = $this->sendOk($day);
        $this->simulate('panne', ['panne' => false]);

        self::assertSame(['SOURD-1' => 'unanswered'], self::at($day, 'send', 'outcomes'), 'Réessayer en panne n\'y change rien.');

        $writes = \count($this->writes());
        $day = $this->sendOk($day);
        self::assertSame('sent', self::at($day, 'send', 'state'));
        self::assertCount($writes, $this->writes(), 'Jira l\'avait enregistrée : sans double.');
        self::assertCount(1, $this->myWorklogs());
    }

    public function testUnTicketEcritQuiNeSeLitPlusAuRenvoiNeSeDitPasAbsent(): void
    {
        $this->linkJira();
        $day = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'MUET-1'), self::work('10:30', '11:00', 'SHOP-482')]));
        $day = $this->sendOk($day);
        self::assertSame('sent', self::at($day, 'send', 'state'));

        // Une saisie de plus sur le ticket : sa prochaine lecture tombe en panne, pas celle de SHOP-482.
        $this->jiraRequest('POST', 'issue/MUET-1/worklog', ['started' => '2026-10-06T16:00:00.000+0200', 'timeSpentSeconds' => 900]);
        $day = $this->sendOk($this->write(self::intAt($day, 'version'), [self::work('11:00', '11:30', 'SHOP-482')]));

        self::assertSame('unverified', self::at($day, 'send', 'state'));
        self::assertSame('unanswered', self::at($day, 'send', 'outcomes', 'MUET-1'), 'Jira a ses heures : il n\'est pas « non envoyé ».');
        self::assertNull(self::at($day, 'send', 'outcomes', 'SHOP-482'));
        self::assertNotEmpty($this->worklogsOf(Catalog::COLLEAGUE_ID), 'Les heures du collègue sont là.');
    }

    public function testApresUnEssaiQuiAEcritUneJourneeModifieeNEstPlusDiteAcceptee(): void
    {
        $this->linkJira();
        $day = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'MUET-1')]));
        self::assertSame(['MUET-1' => 'unverified'], self::at($day, 'send', 'outcomes'));

        // La durée change : Jira n'a jamais reçu celle-là, et l'envoi s'arrête en panne.
        $day = $this->write(self::intAt($day, 'version'), [self::work('10:30', '11:30', 'MUET-1')]);
        $this->simulate('panne', ['panne' => true]);
        $day = $this->sendOk($day);
        $this->simulate('panne', ['panne' => false]);

        self::assertSame('unverified', self::at($day, 'send', 'state'));
        self::assertSame(['MUET-1' => 'unanswered'], self::at($day, 'send', 'outcomes'));
    }

    public function testUnTicketRemplaceApresUnEssaiQuiAEcritResteNomme(): void
    {
        $this->linkJira();
        $day = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'MUET-1')]));
        $day = $this->write(self::intAt($day, 'version'), [self::work('09:30', '10:30', 'SHOP-482')]);
        $this->simulate('panne', ['panne' => true]);
        $day = $this->sendOk($day);
        $this->simulate('panne', ['panne' => false]);

        self::assertSame('unverified', self::at($day, 'send', 'state'));
        self::assertSame(['MUET-1'], self::at($day, 'send', 'removed'));
        self::assertSame(['SHOP-482' => 'unreachable', 'MUET-1' => 'unanswered'], self::at($day, 'send', 'outcomes'));
    }

    public function testUnTicketRetireQueJiraARenduNeSeRetirePasDeuxFois(): void
    {
        $this->linkJira();
        $day = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'OPS-7'), self::work('10:30', '11:00', 'SHOP-482')]));
        $day = $this->sendOk($this->write(self::intAt($day, 'version'), [self::work('09:30', '10:30', 'FERME-1')]));

        self::assertSame('partial', self::at($day, 'send', 'state'));
        self::assertSame(['OPS-7'], self::at($day, 'send', 'removed'), 'Le résultat le montre, retiré.');
        self::assertNull(self::at($day, 'send', 'outcomes', 'OPS-7'));

        $day = $this->write(self::intAt($day, 'version'), [self::work('11:00', '11:15', 'SHOP-482')]);
        self::assertSame([], self::at($day, 'send', 'removed'), 'La confirmation ne dit plus qu\'il sera retiré.');
    }

    public function testUnEnvoiInterrompuPuisEnPanneNeDitPasJiraVideNiEnvoye(): void
    {
        $this->linkJira();
        $day = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'SHOP-482')]));
        $sent = $day;
        $day = $this->write(self::intAt($day, 'version'), [self::work('10:30', '11:00', 'OPS-7')]);

        // Un renvoi que le serveur n'a jamais fini : il a pu écrire.
        $this->connection()->executeStatement("UPDATE day_send SET sending_since = '2026-10-06 13:00:00', touched = '[\"SHOP-482\",\"OPS-7\"]'");
        $this->simulate('panne', ['panne' => true]);
        $day = $this->sendOk($day);
        $this->simulate('panne', ['panne' => false]);

        self::assertSame('unverified', self::at($day, 'send', 'state'));

        // Revenue à ce qui avait été envoyé, la journée ne se redit pas envoyée.
        $day = $this->write(self::intAt($day, 'version'), [self::clear('10:30', '11:00')]);
        self::assertNotSame('sent', self::at($day, 'send', 'state'));
        self::assertSame(self::at($sent, 'blocks'), self::at($day, 'blocks'));
    }

    public function testUnNouveauTicketApresUnEssaiQuiAEcritSeDitNonEnvoye(): void
    {
        $this->linkJira();
        $day = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'MUET-1')]));
        $day = $this->write(self::intAt($day, 'version'), [self::work('10:30', '11:00', 'SHOP-482')]);

        $this->simulate('panne', ['panne' => true]);
        $day = $this->sendOk($day);
        $this->simulate('panne', ['panne' => false]);

        self::assertSame('unverified', self::at($day, 'send', 'state'));
        self::assertSame(['MUET-1' => 'unanswered', 'SHOP-482' => 'unreachable'], self::at($day, 'send', 'outcomes'));
    }

    public function testUneJourneeVideePendantUnePanneDitCeQueJiraGarde(): void
    {
        $this->linkJira();
        $day = $this->sendOk($this->write(0, [self::work('09:30', '10:00', 'SHOP-482')]));
        self::assertSame('sent', self::at($day, 'send', 'state'));
        $day = $this->write(self::intAt($day, 'version'), [self::clear('09:30', '10:00')]);

        $this->simulate('panne', ['panne' => true]);
        $day = $this->sendOk($day);
        $this->simulate('panne', ['panne' => false]);

        self::assertSame('failed', self::at($day, 'send', 'state'));
        self::assertSame(['SHOP-482'], self::at($day, 'send', 'removed'));
        self::assertSame(['SHOP-482' => 'unreachable'], self::at($day, 'send', 'outcomes'));
        self::assertSame(['SHOP-482' => 30], self::at($day, 'send', 'inJira'));

        $day = $this->sendOk($day);
        self::assertSame('nothing', self::at($day, 'send', 'state'));
        self::assertSame([], $this->myWorklogs());
    }

    public function testUnPremierEnvoiEnPanneResteUnEchec(): void
    {
        $this->linkJira();
        $day = $this->write(0, [self::work('09:30', '10:30', 'SHOP-482')]);

        $this->simulate('panne', ['panne' => true]);
        $day = $this->sendOk($day);
        $day = $this->sendOk($day);
        $this->simulate('panne', ['panne' => false]);

        self::assertSame('failed', self::at($day, 'send', 'state'), 'Aucun essai n\'a rien écrit : Jira n\'a rien reçu.');
        self::assertSame([], self::at($day, 'send', 'outcomes'));
    }

    public function testUnTicketEnvoyeEnPartieDitCeQueJiraEnAGarde(): void
    {
        $this->linkJira();
        $day = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'MOITIE-1', 'Revue'), self::work('10:30', '11:00', 'MOITIE-1', 'Tests')]));

        self::assertSame('partial', self::at($day, 'send', 'state'));
        self::assertSame(['MOITIE-1' => 'unreachable'], self::at($day, 'send', 'outcomes'));
        self::assertSame(['MOITIE-1' => 60], self::at($day, 'send', 'inJira'), 'Jira a 1h00 sur 1h30.');
        self::assertSame(['MOITIE-1' => 60], self::at($this->day(), 'send', 'inJira'), 'Un rechargement le retrouve.');
    }

    public function testUnTicketRefuseSansHeuresDansJiraNeDitQueSaRaison(): void
    {
        $this->linkJira();
        $day = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'SHOP-482'), self::work('10:30', '11:00', 'FERME-1')]));

        self::assertSame(['SHOP-482' => null, 'FERME-1' => 'closed'], self::at($day, 'send', 'outcomes'));
        self::assertSame([], self::at($day, 'send', 'inJira'));
    }

    public function testUnTicketRetireQueJiraGardeEnPartieLeDit(): void
    {
        $this->linkJira();
        $day = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'MOITIE-1', 'Revue'), self::work('10:30', '11:00', 'MOITIE-1', 'Tests'), self::work('11:00', '11:30', 'SHOP-482')]));
        $day = $this->sendOk($day);
        self::assertSame('sent', self::at($day, 'send', 'state'));

        // Deux saisies à retirer : Jira en perd une sur deux.
        $day = $this->sendOk($this->write(self::intAt($day, 'version'), [self::clear('09:30', '11:00')]));

        self::assertSame('partial', self::at($day, 'send', 'state'));
        self::assertSame(['MOITIE-1'], self::at($day, 'send', 'removed'));
        self::assertSame('unreachable', self::at($day, 'send', 'outcomes', 'MOITIE-1'));
        self::assertIsInt(self::at($day, 'send', 'inJira', 'MOITIE-1'));
        self::assertGreaterThan(0, self::at($day, 'send', 'inJira', 'MOITIE-1'));
    }

    public function testUnTicketEnPanneFaitUnEnvoiPartiel(): void
    {
        $this->linkJira();
        $day = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'SHOP-482'), self::work('10:30', '11:00', 'PANNE-1')]));

        self::assertSame('partial', self::at($day, 'send', 'state'));
        self::assertSame(['SHOP-482' => null, 'PANNE-1' => 'unreachable'], self::at($day, 'send', 'outcomes'));
    }

    public function testUnJiraEnPanneFaitEchouerLEnvoiSansRienEcrire(): void
    {
        $this->linkJira();
        $day = $this->write(0, [self::work('09:30', '10:30', 'SHOP-482')]);
        $this->simulate('panne', ['panne' => true]);

        $day = $this->sendOk($day);

        self::assertSame('failed', self::at($day, 'send', 'state'));
        self::assertSame('unreachable', self::at($day, 'send', 'failure'));
        $this->simulate('panne', ['panne' => false]);
        self::assertSame([], $this->myWorklogs());
        self::assertSame([], $this->writes());
    }

    public function testUnJetonRefuseFaitEchouerLEnvoiEtLeBandeauLeDit(): void
    {
        $this->linkJira();
        $day = $this->write(0, [self::work('09:30', '10:30', 'SHOP-482')]);
        $this->simulate('jeton', ['refuse' => true]);

        $day = $this->sendOk($day);

        self::assertSame('failed', self::at($day, 'send', 'state'));
        self::assertSame('refused', self::at($day, 'send', 'failure'));
        $this->browser->request('GET', '/api/jira');
        self::assertSame('refused', self::at(json_decode((string) $this->browser->getResponse()->getContent(), true), 'refusal'));
    }

    public function testUnAjoutSansReponseSeRelitAvantDEtreCompleteEtNeLaissePasDeDouble(): void
    {
        $this->linkJira();

        $day = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'LENT-1')]));

        self::assertSame('sent', self::at($day, 'send', 'state'));
        self::assertSame(['LENT-1 2026-10-06T09:30:00.000+0200 3600'], $this->myWorklogs());
        self::assertSame(['POST'], array_column($this->writes(), 'method'));
    }

    public function testUneEcritureEnPanneNeSeCompleteQuAuProchainEssai(): void
    {
        $this->linkJira();

        // Deux commentaires, deux ajouts : Jira tombe en panne sur le second. Il a pu
        // l'enregistrer plus tard : il ne se refait pas dans le même envoi.
        $day = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'MOITIE-1', 'Revue'), self::work('10:30', '11:00', 'MOITIE-1', 'Tests')]));

        self::assertSame('partial', self::at($day, 'send', 'state'));
        self::assertSame(['MOITIE-1' => 'unreachable'], self::at($day, 'send', 'outcomes'));
        self::assertSame(['MOITIE-1 2026-10-06T09:30:00.000+0200 3600 « Revue »'], $this->myWorklogs());

        // Le prochain essai relit, puis complète : sans double.
        $day = $this->sendOk($day);

        self::assertSame('sent', self::at($day, 'send', 'state'));
        self::assertSame([
            'MOITIE-1 2026-10-06T09:30:00.000+0200 3600 « Revue »',
            'MOITIE-1 2026-10-06T10:30:00.000+0200 1800 « Tests »',
        ], $this->myWorklogs());
    }

    public function testUnEssaiQuiAEcritDansJiraNeLaissePlusRedireEnvoye(): void
    {
        $this->linkJira();
        $sent = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'SHOP-482')]));

        // Le bloc remplacé par FERME-1 : SHOP-482 se retire de Jira, FERME-1 est refusé.
        $day = $this->write(self::intAt($sent, 'version'), [self::work('09:30', '10:30', 'FERME-1')]);
        $day = $this->sendOk($day);
        self::assertSame('partial', self::at($day, 'send', 'state'));
        self::assertSame([], $this->myWorklogs());

        // Revenue à ce qui avait été envoyé, la journée n'est plus dans Jira : à renvoyer.
        $day = $this->write(self::intAt($day, 'version'), [self::work('09:30', '10:30', 'SHOP-482')]);
        self::assertSame('modified', self::at($day, 'send', 'state'));
        self::assertSame(['2026-10-06' => 'modified'], $this->marks());

        $day = $this->sendOk($day);
        self::assertSame('sent', self::at($day, 'send', 'state'));
        self::assertSame(['SHOP-482 2026-10-06T09:30:00.000+0200 3600'], $this->myWorklogs());
    }

    public function testUnEnvoiInterrompuNeLaissePlusRedireEnvoye(): void
    {
        $this->linkJira();
        $day = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'SHOP-482')]));

        // Un envoi parti il y a plus de cinq minutes, que le serveur n'a jamais fini : il a pu écrire.
        $this->connection()->executeStatement("UPDATE day_send SET sending_since = '2026-10-06 13:00:00'");

        self::assertSame('modified', self::at($this->day(), 'send', 'state'));
        self::assertSame(['2026-10-06' => 'modified'], $this->marks());
        self::assertSame('sent', self::at($this->sendOk($day), 'send', 'state'));
    }

    public function testCeQuiRendDuResteAFairePartAvantCeQuiEnPrend(): void
    {
        $this->linkJira();
        // 4h00 envoyées sur SHOP-482 : son reste à faire tombe à zéro.
        $day = $this->sendOk($this->write(0, [self::work('09:00', '13:00', 'SHOP-482', 'Revue')]));
        self::assertSame(0, $this->remaining('SHOP-482'));

        // Revue raccourcie d'une heure, une heure de Tests ajoutée : la correction rend une
        // heure, que l'ajout reprend. Dans l'autre ordre, Jira garderait une heure de trop.
        $day = $this->write(self::intAt($day, 'version'), [self::work('12:00', '13:00', 'SHOP-482', 'Tests')]);
        $this->sendOk($day);

        self::assertSame(0, $this->remaining('SHOP-482'));
    }

    public function testUnJiraQuiDemandeDeRalentirEstAttendu(): void
    {
        $this->linkJira();
        $before = Clock::get()->now();

        $day = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'QUOTA-1')]));

        self::assertSame('sent', self::at($day, 'send', 'state'));
        self::assertSame(['POST', 'POST'], array_column($this->writes(), 'method'));
        self::assertSame([429, 201], array_column($this->writes(), 'status'));
        self::assertGreaterThanOrEqual(Catalog::RETRY_AFTER_SECONDS, Clock::get()->now()->getTimestamp() - $before->getTimestamp(), 'L\'attente demandée a été respectée.');
    }

    public function testUnJourPasseOuNonTravailleSEnvoieAussi(): void
    {
        $this->linkJira();

        $saturday = $this->sendOk($this->write(0, [self::work('09:30', '10:30', 'SHOP-482')], '2026-10-03'), '2026-10-03');

        self::assertSame('sent', self::at($saturday, 'send', 'state'));
        self::assertSame(['SHOP-482 2026-10-03T09:30:00.000+0200 3600'], $this->myWorklogs());
    }

    public function testLesBornesDeLaJourneeArriventTellesQuelles(): void
    {
        $this->linkJira();

        $this->sendOk($this->write(0, [self::work('07:00', '07:15', 'SHOP-482'), self::work('19:45', '20:00', 'OPS-7')]));

        self::assertSame([
            'OPS-7 2026-10-06T19:45:00.000+0200 900',
            'SHOP-482 2026-10-06T07:00:00.000+0200 900',
        ], $this->myWorklogs());
    }

    /**
     * @param array<string, string> $server
     *
     * @return array{int, array<mixed>}
     */
    private function sendDay(int $version, string $date = self::DAY, array $server = self::SAME_ORIGIN): array
    {
        return $this->send('POST', '/api/days/'.$date.'/send', ['version' => $version], $server);
    }

    /**
     * Un envoi que DayTrack accepte de faire, quel qu'en soit le résultat.
     *
     * @param array<mixed> $day
     *
     * @return array<mixed>
     */
    private function sendOk(array $day, string $date = self::DAY): array
    {
        [$status, $sent] = $this->sendDay(self::intAt($day, 'version'), $date);
        self::assertSame(200, $status, (string) json_encode($sent));

        return $sent;
    }

    /**
     * @param array<mixed> $tickets
     *
     * @return list<mixed>
     */
    private function sorted(array $tickets): array
    {
        $tickets = array_values($tickets);
        sort($tickets);

        return $tickets;
    }

    /**
     * Les saisies de l'utilisateur dans le Jira simulé, d'un coup d'œil.
     *
     * @return list<string>
     */
    private function myWorklogs(): array
    {
        return $this->worklogsOf(Catalog::ACCOUNT_ID);
    }

    /**
     * Celles d'un compte.
     *
     * @return list<string>
     */
    private function worklogsOf(string $author): array
    {
        $worklogs = [];
        foreach (self::listAt($this->jiraState(), 'worklogs') as $worklog) {
            if ($author !== $worklog['authorId']) {
                continue;
            }
            $comment = null === $worklog['comment'] ? null : self::textOf($worklog['comment']);
            $worklogs[] = self::stringAt($worklog, 'issueKey').' '.self::stringAt($worklog, 'started').' '.self::intAt($worklog, 'timeSpentSeconds').(null === $comment ? '' : ' « '.$comment.' »');
        }
        sort($worklogs);

        return $worklogs;
    }

    /**
     * @return list<string>
     */
    private function worklogIds(): array
    {
        return array_values(array_map(
            static fn (array $worklog): string => self::stringAt($worklog, 'id'),
            array_filter(self::listAt($this->jiraState(), 'worklogs'), static fn (array $worklog): bool => Catalog::ACCOUNT_ID === $worklog['authorId']),
        ));
    }

    /**
     * Les écritures que le Jira simulé a reçues de DayTrack, hors celles que le test a
     * faites lui-même.
     *
     * @return list<array<mixed>>
     */
    private function writes(): array
    {
        return array_values(array_filter(
            self::listAt($this->jiraState(), 'journal'),
            static fn (array $entry): bool => isset($entry['method']) && !\in_array($entry['path'], ['/rest/api/3/issue/DAYTRACK-0/worklog'], true) && 'test' !== (\is_array($entry['query'] ?? null) ? ($entry['query']['source'] ?? null) : null),
        ));
    }

    private function remaining(string $key): int
    {
        return self::intAt($this->jiraState(), 'resteAFaire', $key);
    }

    /**
     * Une saisie posée dans le Jira simulé comme l'utilisateur l'aurait fait dans Jira.
     *
     * @param array<string, mixed> $body
     */
    private function jiraRequest(string $method, string $route, array $body): void
    {
        $response = $this->fakeJira()->handle(new FakeJiraRequest(
            $method,
            '/rest/api/3/'.$route,
            ['source' => 'test'],
            FakeJiraRequest::basic(Catalog::ACCOUNT_EMAIL, Catalog::API_TOKEN),
            json_encode($body, \JSON_THROW_ON_ERROR),
        ));
        self::assertLessThan(300, $response->status);
    }

    /**
     * @return array<mixed>
     */
    private function marks(): array
    {
        $this->browser->request('GET', '/api/calendar/2026-09-28/2026-11-08');
        self::assertResponseIsSuccessful();
        $marks = json_decode((string) $this->browser->getResponse()->getContent(), true, flags: \JSON_THROW_ON_ERROR);
        self::assertIsArray($marks);
        self::assertIsArray($marks['marks']);

        return $marks['marks'];
    }

    private static function textOf(mixed $document): string
    {
        return JiraWorklog::textOf($document) ?? '';
    }
}
