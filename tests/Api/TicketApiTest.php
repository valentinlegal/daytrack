<?php

namespace App\Tests\Api;

use App\Dev\Jira\Catalog;
use App\Tests\Support\DayApi;
use App\Tests\Support\JiraApi;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

/**
 * Les tickets tels que Jira les décrit : celui qu'on tape, ceux de l'écran, et ceux
 * qu'une saisie veut poser — que le serveur vérifie lui-même, même quand l'écran l'a
 * déjà fait.
 */
final class TicketApiTest extends WebTestCase
{
    use DayApi;
    use JiraApi;

    private const string EXPORT = 'Export CSV des commandes filtrées par période et par statut';

    public function testUnTicketTapeRendSonTitreEtSonType(): void
    {
        $this->linkJira();

        self::assertSame(['status' => 'found', 'ticket' => ['title' => self::EXPORT, 'type' => 'Story', 'color' => 'vert'], 'refusal' => null], $this->lookup('SHOP-482'));
    }

    public function testUneSousTacheSAfficheAvecLeTypeDeSonParent(): void
    {
        $this->linkJira();

        self::assertSame(['status' => 'found', 'ticket' => ['title' => 'Reproduire le blocage du bouton Payer', 'type' => 'Bug', 'color' => 'rouge'], 'refusal' => null], $this->lookup('SHOP-531'));
    }

    public function testUnTicketQuiNExistePasEstIntrouvable(): void
    {
        $this->linkJira();

        self::assertSame(['status' => 'not_found', 'ticket' => null, 'refusal' => null], $this->lookup('SHOP-999'));
        self::assertSame(0, $this->ticketRows());
    }

    public function testUnTicketDecritIlYAMoinsDUneHeureSeLitSansJira(): void
    {
        $this->linkJira();
        $this->lookup('SHOP-482');
        $this->simulate('panne', ['panne' => true]);

        self::mockTime('2026-10-06 16:10:00 Europe/Paris');
        self::assertSame('found', self::at($this->lookup('SHOP-482'), 'status'));

        self::mockTime('2026-10-06 16:30:00 Europe/Paris');
        self::assertSame(['status' => 'unreachable', 'ticket' => ['title' => self::EXPORT, 'type' => 'Story', 'color' => 'vert'], 'refusal' => null], $this->lookup('SHOP-482'), 'Au-delà d\'une heure, Jira est redemandé ; muet, ce qu\'on savait reste.');
    }

    public function testUnJetonRefuseSeDitEtSInscritPourLeBandeau(): void
    {
        $this->linkJira();
        $this->simulate('jeton', ['refuse' => true]);

        self::assertSame(['status' => 'refused', 'ticket' => null, 'refusal' => 'refused'], $this->lookup('SHOP-482'));
        self::assertSame('refused', $this->refusal());

        $this->simulate('jeton', ['refuse' => false]);
        self::assertSame('found', self::at($this->lookup('SHOP-482'), 'status'));
        self::assertNull($this->refusal(), 'Une réponse de Jira efface le refus.');
    }

    public function testUnTicketLuNEffacePasLePerimetreQuiManque(): void
    {
        // Le jeton de la v1 lit les tickets, mais ne dit pas qui vous êtes.
        $this->linkJira(Catalog::SCOPED_TOKEN);
        $this->connection()->executeStatement('UPDATE jira_connection SET encrypted_token = ?', [$this->encrypted(Catalog::V1_SCOPED_TOKEN)]);

        [, $checked] = $this->send('POST', '/api/jira/check', []);
        self::assertSame(['missing_scope', ['read:jira-user']], [self::at($checked, 'status'), self::at($checked, 'missingScopes')]);

        $found = $this->lookup('SHOP-482');
        self::assertSame(['found', 'missing_scope'], [self::at($found, 'status'), self::at($found, 'refusal')]);
        [, $refreshed] = $this->send('POST', '/api/tickets/refresh', ['tickets' => ['OPS-12']]);
        self::assertSame('missing_scope', self::at($refreshed, 'refusal'));
        self::assertSame('missing_scope', $this->refusal(), 'Le bandeau nomme toujours le périmètre.');
    }

    public function testUnTitreLuSansJiraNeDitPasQueLeJetonPasse(): void
    {
        $this->linkJira();
        $this->lookup('SHOP-482');
        $this->simulate('jeton', ['refuse' => true]);
        $this->lookup('OPS-12');

        // SHOP-482 a été décrit il y a moins d'une heure : il se lit sans Jira, qui refuse
        // toujours le jeton.
        self::assertSame(['status' => 'found', 'ticket' => ['title' => self::EXPORT, 'type' => 'Story', 'color' => 'vert'], 'refusal' => 'refused'], $this->lookup('SHOP-482'));
    }

    public function testUnJiraMuetSeDitSansToucherAuJeton(): void
    {
        $this->linkJira();
        $this->simulate('panne', ['panne' => true]);

        self::assertSame(['status' => 'unreachable', 'ticket' => null, 'refusal' => null], $this->lookup('SHOP-482'));
        self::assertNull($this->refusal());
    }

    public function testUnIdentifiantMalFormeNEstPasUnTicket(): void
    {
        [$status] = $this->send('POST', '/api/tickets/shop-482/lookup', []);

        self::assertSame(404, $status);
    }

    public function testUneSaisieDUnTicketIntrouvableEstRefuseeSousSonChamp(): void
    {
        $this->linkJira();

        [$status, $body] = $this->patchSlots(0, [self::work('09:00', '10:00', 'SHOP-482'), self::work('10:00', '10:30', 'SHOP-999', 'Revue')]);

        self::assertSame(422, $status);
        self::assertSame([['field' => 'changes[1].ticket', 'message' => 'Ticket introuvable dans Jira. Vérifiez l\'identifiant.']], self::at($body, 'violations'));
        self::assertSame([], $this->rows());
    }

    public function testUneSaisieDUnTicketConnuGardeSonTitreEtLeRend(): void
    {
        $this->linkJira();

        $day = $this->write(0, [self::work('09:00', '10:00', 'SHOP-519')]);

        self::assertSame(['SHOP-519' => ['title' => 'Le total du panier ignore la remise quand le code est saisi en minuscules', 'type' => 'Bug', 'color' => 'rouge']], self::at($day, 'tickets'));
        self::assertSame(self::at($day, 'tickets'), self::at($this->day(), 'tickets'));
    }

    public function testUnJiraMuetLaisseSaisirLeTicketSansTitre(): void
    {
        $this->linkJira();
        $this->simulate('panne', ['panne' => true]);

        $day = $this->write(0, [self::work('09:00', '10:00', 'SHOP-999')]);

        self::assertSame(['SHOP-999' => ['title' => null, 'type' => null, 'color' => null]], self::at($day, 'tickets'));
        self::assertNull($this->refusal());
    }

    public function testUnJetonRefuseLaisseSaisirEtAllumeLeBandeau(): void
    {
        $this->linkJira();
        $this->simulate('jeton', ['refuse' => true]);

        $day = $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')]);

        self::assertSame(['SHOP-482' => ['title' => null, 'type' => null, 'color' => null]], self::at($day, 'tickets'));
        self::assertSame('refused', $this->refusal());
    }

    public function testUnTicketDejaAccepteNeSeRedemandePlusAJira(): void
    {
        $this->linkJira();
        $this->simulate('panne', ['panne' => true]);
        $this->write(0, [self::work('09:00', '09:15', 'SHOP-999')]);
        $this->simulate('panne', ['panne' => false]);

        // Jira répondrait désormais qu'il n'existe pas. L'agrandir, l'effacer puis le
        // rendre, comme une annulation, et le reprendre un autre jour passent quand même :
        // l'envoi le rattrapera.
        $this->write(1, [self::work('09:00', '09:30', 'SHOP-999', 'Revue')]);
        $this->write(2, [self::clear('09:00', '09:30')]);
        $this->write(3, [self::work('09:00', '09:30', 'SHOP-999', 'Revue')]);
        $this->write(0, [self::work('11:00', '11:15', 'SHOP-999')], '2026-10-07');
    }

    public function testUnTicketDejaSaisiNeSeRedemandePasAJira(): void
    {
        // Une saisie d'avant la vérification des tickets, que DayTrack n'a jamais décrite.
        $this->write(0, [self::work('09:00', '09:15', 'SHOP-999')]);
        $this->connection()->executeStatement('DELETE FROM ticket');
        $this->linkJira();

        $this->write(1, [self::work('09:00', '09:30', 'SHOP-999', 'Revue')]);
        [$status] = $this->patchSlots(2, [self::work('10:00', '10:15', 'SHOP-998')]);

        self::assertSame(422, $status, 'Un ticket nouveau se vérifie toujours.');
    }

    public function testSansJiraReliePersonneNeVerifie(): void
    {
        $day = $this->write(0, [self::work('09:00', '10:00', 'SHOP-999')]);

        self::assertSame(['SHOP-999' => ['title' => null, 'type' => null, 'color' => null]], self::at($day, 'tickets'));
    }

    public function testUneFormeRefuseeNeVaPasJusquAJira(): void
    {
        $this->linkJira();
        $this->simulate('panne', ['panne' => true]);

        [$status, $body] = $this->patchSlots(0, [self::work('09:00', '10:00', 'SHOP-482'), self::work('10:05', '10:30', 'OPS-7')]);

        self::assertSame(422, $status);
        self::assertSame(['changes[1].start'], array_column(self::listAt($body, 'violations'), 'field'));
        self::assertSame(0, $this->ticketRows(), 'Un ticket vérifié pendant la panne serait entré en attente.');
    }

    public function testUnFavoriIntrouvableEstRefuseSousSonChamp(): void
    {
        $this->linkJira();

        [$status, $body] = $this->send('POST', '/api/favorites', ['ticket' => 'SHOP-999']);
        self::assertSame(422, $status);
        self::assertSame([['field' => 'ticket', 'message' => 'Ticket introuvable dans Jira. Vérifiez l\'identifiant.']], self::at($body, 'violations'));

        [$status, $body] = $this->send('POST', '/api/favorites', ['ticket' => 'SHOP-482']);
        self::assertSame(201, $status);
        self::assertSame(['SHOP-482' => ['title' => self::EXPORT, 'type' => 'Story', 'color' => 'vert']], self::at($body, 'tickets'));
    }

    public function testUnFavoriAccepteJiraMuetSeRedemandeUneFoisJiraRevenu(): void
    {
        $this->linkJira();
        $this->simulate('jeton', ['refuse' => true]);
        [$status, $favorite] = $this->send('POST', '/api/favorites', ['ticket' => 'SHOP-999']);
        self::assertSame(201, $status, 'Jira qui refuse le jeton ne peut rien vérifier : le ticket passe.');
        $id = self::at($favorite, 'favorites', 0, 'id');
        self::assertIsString($id);
        [$status] = $this->send('DELETE', '/api/favorites/'.$id, []);
        self::assertSame(200, $status);
        $this->simulate('jeton', ['refuse' => false]);

        [$status, $body] = $this->send('POST', '/api/favorites', ['ticket' => 'SHOP-999']);

        self::assertSame(422, $status);
        self::assertSame([['field' => 'ticket', 'message' => 'Ticket introuvable dans Jira. Vérifiez l\'identifiant.']], self::at($body, 'violations'));
    }

    public function testUnFavoriDUnTicketQueLaGrillePorteNeSeRedemandePas(): void
    {
        $this->linkJira();
        $this->simulate('panne', ['panne' => true]);
        $this->write(0, [self::work('09:00', '09:15', 'SHOP-999')]);
        $this->simulate('panne', ['panne' => false]);

        [$status] = $this->send('POST', '/api/favorites', ['ticket' => 'SHOP-999']);

        self::assertSame(201, $status, '« Ajouter aux favoris » sur un bloc ne se refuse pas.');
    }

    public function testLesTitresDeLEcranSeRelisentQuandIlsOntVieilli(): void
    {
        $this->linkJira();
        $this->simulate('panne', ['panne' => true]);
        $this->write(0, [self::work('09:00', '10:00', 'SHOP-482'), self::work('10:00', '10:30', 'OPS-12')]);
        $this->simulate('panne', ['panne' => false]);

        [$status, $body] = $this->send('POST', '/api/tickets/refresh', ['tickets' => ['SHOP-482', 'OPS-12', 'SHOP-999']]);

        self::assertSame(200, $status);
        self::assertSame([
            'tickets' => [
                'OPS-12' => ['title' => 'Cérémonies d\'équipe', 'type' => 'Tâche', 'color' => 'bleu'],
                'SHOP-482' => ['title' => self::EXPORT, 'type' => 'Story', 'color' => 'vert'],
            ],
            'refusal' => null,
        ], self::sortedTickets($body));
    }

    public function testDeuxTicketsNouveauxDUnMemeTypeNeCreentQuUnType(): void
    {
        $this->linkJira();

        // Deux Story jamais vues, dans une même saisie puis une même relecture.
        $this->write(0, [self::work('09:00', '10:00', 'SHOP-482'), self::work('10:00', '10:30', 'SHOP-501')]);
        self::assertResponseIsSuccessful();
        [$status] = $this->send('POST', '/api/tickets/refresh', ['tickets' => ['SHOP-498', 'SHOP-482', 'SHOP-501']]);
        self::assertSame(200, $status);

        self::assertEquals(1, $this->connection()->fetchOne('SELECT COUNT(*) FROM issue_type WHERE jira_id = ?', ['10001']));
    }

    public function testUneRelectureDitLeJetonRefuse(): void
    {
        $this->linkJira();
        $this->simulate('jeton', ['refuse' => true]);

        [$status, $body] = $this->send('POST', '/api/tickets/refresh', ['tickets' => ['SHOP-482']]);

        self::assertSame(200, $status);
        self::assertSame('refused', self::at($body, 'refusal'));
    }

    public function testUneRelectureRendLEtatDuJetonMemeSansRienRelire(): void
    {
        $this->linkJira();
        $this->lookup('SHOP-482');
        $this->simulate('jeton', ['refuse' => true]);
        $this->lookup('SHOP-999');
        self::assertSame('refused', $this->refusal());

        // Le titre est frais : rien ne part vers Jira, et le refus enregistré se dit quand même.
        [, $body] = $this->send('POST', '/api/tickets/refresh', ['tickets' => ['SHOP-482']]);
        self::assertSame('refused', self::at($body, 'refusal'));

        // Jira répond de nouveau, mais seulement « introuvable » : rien n'est dit du jeton.
        $this->simulate('jeton', ['refuse' => false]);
        [, $body] = $this->send('POST', '/api/tickets/refresh', ['tickets' => ['SHOP-999']]);
        self::assertSame('refused', self::at($body, 'refusal'));

        [, $body] = $this->send('POST', '/api/tickets/refresh', ['tickets' => ['OPS-12']]);
        self::assertNull(self::at($body, 'refusal'), 'Un ticket décrit dit que le jeton passe de nouveau.');
    }

    public function testUneRelectureRefuseCeQuiNEstPasUnTicket(): void
    {
        [$status] = $this->send('POST', '/api/tickets/refresh', ['tickets' => ['SHOP-482', 'pas un ticket']]);
        self::assertSame(422, $status);

        [$status] = $this->send('POST', '/api/tickets/refresh', ['tickets' => array_map(static fn (int $n): string => 'SHOP-'.$n, range(1, 201))]);
        self::assertSame(422, $status);

        // La même forme qu'une saisie, longueur comprise.
        [$status, $body] = $this->send('POST', '/api/tickets/refresh', ['tickets' => ['SHOP-482', str_repeat('A', 46).'-1234']]);
        self::assertSame(422, $status);
        self::assertSame([['field' => 'tickets[1]', 'message' => 'Un identifiant de ticket tient en 50 caractères.']], self::at($body, 'violations'));
        self::assertSame(0, $this->ticketRows());
    }

    public function testUnIdentifiantTropLongSeDitIntrouvableSansDemanderAJira(): void
    {
        $this->linkJira();
        // Muet, Jira ferait dire « ne répond pas » : « introuvable » ne vient pas de lui.
        $this->simulate('panne', ['panne' => true]);

        self::assertSame(['status' => 'not_found', 'ticket' => null, 'refusal' => null], $this->lookup(str_repeat('A', 46).'-1234'));
        self::assertSame(0, $this->ticketRows());
        // Cinquante caractères passent : la recherche répond, Jira muet ou non.
        self::assertSame('unreachable', self::at($this->lookup(str_repeat('A', 45).'-1234'), 'status'));
    }

    public function testParcourirUnJourNAppelleNiNEcritRien(): void
    {
        $this->linkJira();
        $this->simulate('panne', ['panne' => true]);

        self::assertSame([], self::at($this->day('2026-10-20'), 'tickets'));
        self::assertSame(0, $this->ticketRows());
    }

    public function testUneAutrePageNePeutPasFaireChercherUnTicket(): void
    {
        $this->linkJira();

        [$status] = $this->send('POST', '/api/tickets/SHOP-482/lookup', [], ['HTTP_SEC_FETCH_SITE' => 'cross-site']);
        self::assertSame(403, $status);

        // Une image d'une autre page ne fait pas non plus écrire DayTrack : la recherche
        // n'existe pas en GET.
        $this->browser->request('GET', '/api/tickets/SHOP-482/lookup', server: ['HTTP_SEC_FETCH_SITE' => 'cross-site']);
        self::assertSame(405, $this->browser->getResponse()->getStatusCode());
        self::assertSame(0, $this->ticketRows());
    }

    public function testUneAutrePageNePeutPasFaireRelireLesTitres(): void
    {
        [$status] = $this->send('POST', '/api/tickets/refresh', ['tickets' => ['SHOP-482']], ['HTTP_SEC_FETCH_SITE' => 'cross-site']);

        self::assertSame(403, $status);
    }

    /**
     * @return array<mixed>
     */
    private function lookup(string $key): array
    {
        [$status, $body] = $this->send('POST', '/api/tickets/'.$key.'/lookup', []);
        self::assertSame(200, $status);

        return $body;
    }

    private function refusal(): mixed
    {
        $this->browser->request('GET', '/api/jira');

        return self::at($this->json(), 'refusal');
    }

    /** Le jeton tel que la base le garde, chiffré par la clé de cette installation. */
    private function encrypted(string $token): string
    {
        return $this->cipher()->encrypt($token);
    }

    private function ticketRows(): int
    {
        $count = $this->connection()->fetchOne('SELECT COUNT(*) FROM ticket');
        self::assertIsNumeric($count);

        return (int) $count;
    }

    /**
     * @param array<mixed> $body
     *
     * @return array<mixed>
     */
    private static function sortedTickets(array $body): array
    {
        $tickets = self::arrayAt($body, 'tickets');
        ksort($tickets);

        return ['tickets' => $tickets, 'refusal' => $body['refusal'] ?? null];
    }
}
