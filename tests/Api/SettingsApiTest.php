<?php

namespace App\Tests\Api;

use App\Dev\Jira\Catalog;
use App\Dev\Jira\FakeJira;
use App\Dev\Jira\FakeJiraHttpClient;
use App\Entity\IssueType;
use App\Entity\Ticket;
use App\Jira\JiraIssueType;
use App\Settings\Tint;
use App\Tests\Support\DayApi;
use App\Tests\Support\JiraApi;
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Contracts\HttpClient\ResponseInterface;

/**
 * Les réglages enregistrés par DayTrack, par leurs routes, comme la page Réglages s'en
 * sert — et comme un onglet resté ouvert ou un appelant hostile les appelleraient.
 */
final class SettingsApiTest extends WebTestCase
{
    use DayApi;
    use JiraApi;

    private const string TOMORROW = '2026-10-07';

    public function testLesReglagesParDefautSeLisentSansRienEcrire(): void
    {
        self::assertSame(['habitualObjective' => 450, 'workingDays' => [1, 2, 3, 4, 5], 'issueTypes' => []], $this->settings());
        self::assertSame(0, $this->settingsRows());
    }

    public function testLObjectifHabituelVaDe0hA13h(): void
    {
        foreach ([0, 780, 480] as $objective) {
            [$status, $body] = $this->setHabitual($objective);
            self::assertSame(200, $status, (string) $objective);
            self::assertSame($objective, self::at($body, 'habitualObjective'));
        }

        self::assertSame(480, $this->settings()['habitualObjective']);
        self::assertSame(1, $this->settingsRows(), 'Une seule ligne, quel que soit le nombre de réglages.');
    }

    /**
     * @return iterable<string, array{mixed, string}>
     */
    public static function refusedObjectives(): iterable
    {
        yield 'un quart d\'heure de trop' => [795, 'L\'objectif va de 0h00 à 13h00.'];
        yield 'sous zéro' => [-15, 'L\'objectif va de 0h00 à 13h00.'];
        yield 'hors du quart d\'heure' => [455, 'L\'objectif se règle au quart d\'heure.'];
        yield 'une durée écrite' => ['7h30', 'Valeur invalide.'];
        yield 'rien' => [null, 'Valeur invalide.'];
    }

    #[DataProvider('refusedObjectives')]
    public function testUnObjectifHabituelRefuseSeDitSousSonChampSansRienChanger(mixed $objective, string $message): void
    {
        $this->setHabitual(480);

        [$status, $body] = $this->send('PUT', '/api/settings/habitual-objective', ['objective' => $objective]);

        self::assertSame(422, $status);
        self::assertSame([['field' => 'objective', 'message' => $message]], self::at($body, 'violations'));
        self::assertSame(480, $this->settings()['habitualObjective']);
    }

    public function testUnChampInconnuOuManquantEstRefuse(): void
    {
        foreach ([['objective' => 480, 'workingDays' => [6]], []] as $body) {
            [$status] = $this->send('PUT', '/api/settings/habitual-objective', $body);
            self::assertSame(422, $status, json_encode($body, \JSON_THROW_ON_ERROR));
        }

        self::assertSame(0, $this->settingsRows());
    }

    public function testLObjectifHabituelVautPourChaqueJourneePasEncoreSaisie(): void
    {
        $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')]);

        $this->setHabitual(480);

        self::assertSame(450, $this->day()['objective'], 'Une journée déjà saisie garde le sien.');
        self::assertSame(480, $this->day()['habitualObjective'], '« Revenir à … » ramène à celui des réglages.');
        $tomorrow = $this->day(self::TOMORROW);
        self::assertSame(480, $tomorrow['objective']);
        self::assertSame(480, self::at($tomorrow, 'figures', 'remaining'));
        self::assertSame(1, $this->dayRows(), 'Lire une journée n\'écrit rien.');

        $written = $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')], self::TOMORROW);
        self::assertSame(480, $written['objective'], 'La journée naît avec l\'objectif habituel.');
    }

    public function testUnOngletResteOuvertSurUnJourVidePrendLObjectifDuMoment(): void
    {
        self::assertSame(450, $this->day(self::TOMORROW)['objective']);

        // Un autre onglet change l'objectif habituel ; le premier saisit sur ce qu'il a vu.
        $this->setHabitual(360);
        [$status, $day] = $this->patchSlots(0, [self::work('09:00', '10:00', 'SHOP-482')], self::TOMORROW);

        self::assertSame(200, $status);
        self::assertSame(360, $day['objective'], 'La réponse dit l\'objectif avec lequel la journée est née.');
        self::assertSame(300, self::at($day, 'figures', 'remaining'));
    }

    public function testUneJourneeVideeSuitDeNouveauLObjectifHabituel(): void
    {
        // Un ticket posé par erreur sur demain, puis effacé : la journée a sa ligne, vide.
        $this->write(0, [self::work('09:00', '09:15', 'SHOP-482')], self::TOMORROW);
        $this->write(1, [self::clear('09:00', '09:15')], self::TOMORROW);
        $this->setHabitual(480);

        $tomorrow = $this->day(self::TOMORROW);
        self::assertSame(480, $tomorrow['objective'], 'Elle n\'est pas saisie : elle suit l\'habituel.');
        self::assertSame(480, self::at($tomorrow, 'figures', 'remaining'));

        // Saisie de nouveau, elle prend l'habituel du moment, et le garde.
        $written = $this->write(2, [self::work('09:00', '09:15', 'SHOP-482')], self::TOMORROW);
        self::assertSame(480, $written['objective']);
        $this->setHabitual(360);
        self::assertSame(480, $this->day(self::TOMORROW)['objective']);
    }

    public function testUnObjectifChoisiPourUnJourTientMemeVide(): void
    {
        // Un jour de congé, à 0h00, sans rien de saisi.
        [$status] = $this->putObjective(0, 0, self::TOMORROW);
        self::assertSame(200, $status);

        $this->setHabitual(480);

        self::assertSame(0, $this->day(self::TOMORROW)['objective']);
        self::assertSame(480, $this->day(self::TOMORROW)['habitualObjective']);
    }

    public function testUnObjectifHabituelAZeroDonneDesJourneesSansRienAFaire(): void
    {
        $this->setHabitual(0);

        $day = $this->day(self::TOMORROW);

        self::assertSame(0, $day['objective']);
        self::assertSame(0, self::at($day, 'figures', 'remaining'));
    }

    public function testLesJoursTravaillesSAllumentEtSEteignentUnParUn(): void
    {
        [$status, $body] = $this->setWorkingDay(6, true);
        self::assertSame(200, $status);
        self::assertSame([1, 2, 3, 4, 5, 6], self::at($body, 'workingDays'));

        [, $body] = $this->setWorkingDay(6, true);
        self::assertSame([1, 2, 3, 4, 5, 6], self::at($body, 'workingDays'), 'Allumer deux fois n\'ajoute rien.');

        [, $body] = $this->setWorkingDay(1, false);
        self::assertSame([2, 3, 4, 5, 6], self::at($body, 'workingDays'));

        [, $body] = $this->setWorkingDay(7, false);
        self::assertSame([2, 3, 4, 5, 6], self::at($body, 'workingDays'), 'Éteindre un jour éteint ne change rien.');
    }

    public function testLesSeptJoursPeuventSEteindre(): void
    {
        foreach (range(1, 7) as $day) {
            self::assertSame(200, $this->setWorkingDay($day, false)[0]);
        }

        self::assertSame([], $this->settings()['workingDays']);
    }

    public function testDeuxOngletsNeDefontPasCeQueLAutreARegle(): void
    {
        // Chaque bascule ne nomme que son jour : celle d'un onglet qui n'a pas vu le
        // samedi s'allumer ne l'éteint pas.
        $this->setWorkingDay(6, true);
        $this->setWorkingDay(1, false);
        $this->setHabitual(480);

        self::assertSame(['habitualObjective' => 480, 'workingDays' => [2, 3, 4, 5, 6], 'issueTypes' => []], $this->settings());
    }

    public function testUnJourHorsDeLaSemaineOuUneBasculeMalDiteSontRefuses(): void
    {
        foreach (['0', '8', '10', 'lundi'] as $day) {
            [$status] = $this->send('PUT', '/api/settings/working-days/'.$day, ['worked' => true]);
            self::assertSame(404, $status, $day);
        }

        foreach ([['worked' => 'oui'], ['worked' => 1], ['worked' => null], [], ['worked' => true, 'day' => 6]] as $body) {
            [$status] = $this->send('PUT', '/api/settings/working-days/6', $body);
            self::assertSame(422, $status, json_encode($body, \JSON_THROW_ON_ERROR));
        }

        self::assertSame(0, $this->settingsRows());
    }

    public function testLesTypesDesSaisiesEtDesFavorisSeListentDuPlusUtiliseAuMoinsUtilise(): void
    {
        $this->linkJira();
        $this->write(0, [
            self::work('09:00', '10:15', 'OPS-12'),
            self::work('10:15', '10:45', 'SHOP-482'),
            self::work('10:45', '11:15', 'SHOP-498'),
        ]);
        self::assertSame(201, $this->send('POST', '/api/favorites', ['ticket' => 'SHOP-519'])[0]);
        // Connu de DayTrack, mais ni dans une saisie ni dans un favori.
        self::assertSame(200, $this->send('POST', '/api/tickets/SHOP-377/lookup', [])[0]);

        $types = self::listAt($this->settings(), 'issueTypes');

        self::assertSame(['Tâche bleu', 'Story vert', 'Bug rouge'], array_map(static fn (mixed $type): string => self::stringAt($type, 'name').' '.self::stringAt($type, 'color'), $types));
    }

    public function testUneTeinteChoisieVautPartoutOuLeTypeSAffiche(): void
    {
        $this->linkJira();
        $this->write(0, [self::work('09:00', '10:00', 'SHOP-482'), self::work('10:00', '10:30', 'SHOP-498')]);
        $story = self::stringAt($this->settings(), 'issueTypes', 0, 'id');

        [$status, $body] = $this->recolor($story, 'cyan');

        self::assertSame(200, $status);
        self::assertSame([['id' => $story, 'name' => 'Story', 'color' => 'cyan']], self::at($body, 'issueTypes'));
        $day = $this->day();
        self::assertSame('cyan', self::at($day, 'tickets', 'SHOP-482', 'color'));
        self::assertSame('cyan', self::at($day, 'tickets', 'SHOP-498', 'color'), 'Tous les tickets du type la prennent.');
    }

    public function testUneTeinteInconnueOuUnTypeDisparuSontRefuses(): void
    {
        $this->linkJira();
        $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')]);
        $story = self::stringAt($this->settings(), 'issueTypes', 0, 'id');

        foreach (['turquoise', 'Cyan', '', null] as $color) {
            [$status, $body] = $this->recolor($story, $color);
            self::assertSame(422, $status, (string) $color);
            self::assertSame([['field' => 'color', 'message' => 'Valeur invalide.']], self::at($body, 'violations'), (string) $color);
        }

        [$status, $body] = $this->recolor('0192f1a0-0000-7000-8000-000000000000', 'cyan');
        self::assertSame(404, $status);
        self::assertSame('not_found', $body['error']);
        self::assertSame('vert', self::at($body, 'issueTypes', 0, 'color'), 'La réponse rend les réglages, pour que l\'écran s\'y remette.');

        self::assertSame(404, $this->recolor('story', 'cyan')[0]);
        self::assertSame('vert', self::at($this->settings(), 'issueTypes', 0, 'color'));
    }

    public function testUnTypeAppartientASonJiraQuelleQueSoitLAdresseDeLAPI(): void
    {
        $this->linkJira();
        self::assertSame(Catalog::CLOUD_ID, $this->connection()->fetchOne('SELECT instance FROM jira_connection'));
        $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')]);
        $this->recolor(self::stringAt($this->settings(), 'issueTypes', 0, 'id'), 'cyan');

        // Le même compte passe au jeton à périmètres : l'API passe par la passerelle, le
        // Jira reste le même, et ses types aussi.
        $this->linkJira(Catalog::SCOPED_TOKEN);
        self::assertSame(200, $this->send('POST', '/api/tickets/SHOP-482/lookup', [])[0]);

        self::assertSame(Catalog::CLOUD_ID, $this->connection()->fetchOne('SELECT instance FROM jira_connection'));
        self::assertSame('cyan', self::at($this->day(), 'tickets', 'SHOP-482', 'color'));
        self::assertSame(1, $this->rowsIn('issue_type'));
    }

    public function testRelierUnAutreJiraNeRenommeNiNeReteintLesTypesDuPremier(): void
    {
        $this->linkJira();
        $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')]);
        $this->recolor(self::stringAt($this->settings(), 'issueTypes', 0, 'id'), 'cyan');

        // Un autre Jira, dont les types recommencent aussi à 10000. Le Jira simulé n'a
        // qu'un site : il en tient lieu.
        $this->connection()->executeStatement("UPDATE jira_connection SET instance = 'autre-jira'");
        $this->connection()->executeStatement('UPDATE ticket SET read_at = NULL');
        self::assertSame(200, $this->send('POST', '/api/tickets/SHOP-482/lookup', [])[0]);

        self::assertSame('vert', self::at($this->day(), 'tickets', 'SHOP-482', 'color'), 'Le Story de l\'autre Jira prend sa propre teinte de départ.');
        self::assertSame([['name' => 'Story', 'color' => 'vert']], array_map(
            static fn (mixed $type): array => ['name' => self::stringAt($type, 'name'), 'color' => self::stringAt($type, 'color')],
            self::listAt($this->settings(), 'issueTypes'),
        ), 'Les réglages ne montrent que les types du Jira relié.');
        self::assertSame(
            [Catalog::CLOUD_ID.' Story cyan', 'autre-jira Story vert'],
            $this->connection()->fetchFirstColumn("SELECT instance || ' ' || name || ' ' || color FROM issue_type ORDER BY instance"),
        );
    }

    public function testUnJiraReconnuASonAdresseGardeSesTypesQuandIlDitSonIdentifiant(): void
    {
        $this->linkJira();
        $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')]);
        $this->recolor(self::stringAt($this->settings(), 'issueTypes', 0, 'id'), 'cyan');
        // Comme une base d'avant les réglages, ou un site resté muet à la première liaison.
        $this->connection()->executeStatement("UPDATE jira_connection SET instance = 'https://jira'");
        $this->connection()->executeStatement("UPDATE issue_type SET instance = 'https://jira'");

        // Le jeton renouvelé, sur le même site : le site dit cette fois son identifiant.
        $this->linkJira();
        $this->connection()->executeStatement('UPDATE ticket SET read_at = NULL');
        self::assertSame(200, $this->send('POST', '/api/tickets/SHOP-482/lookup', [])[0]);

        self::assertSame(Catalog::CLOUD_ID, $this->connection()->fetchOne('SELECT instance FROM jira_connection'));
        self::assertSame([Catalog::CLOUD_ID.' Story cyan'], $this->connection()->fetchFirstColumn("SELECT instance || ' ' || name || ' ' || color FROM issue_type"));
        self::assertSame('cyan', self::at($this->day(), 'tickets', 'SHOP-482', 'color'));
    }

    public function testUneReponseDuJiraQuOnVientDeRemplacerNeDitRienDuNouveau(): void
    {
        // Pendant que Jira répond, on relie un autre Jira (dans un autre onglet).
        $fake = static::getContainer()->get(FakeJira::class); // @phpstan-ignore symfonyContainer.serviceNotFound
        self::assertInstanceOf(FakeJira::class, $fake);
        $jira = FakeJiraHttpClient::create($fake);
        $relinked = false;
        $connection = $this->connection();
        static::getContainer()->set('jira.client', new MockHttpClient(static function (string $method, string $url, array $options) use ($jira, $connection, &$relinked): ResponseInterface {
            if (!$relinked && str_contains($url, '/issue/SHOP-482')) {
                $relinked = true;
                $connection->executeStatement("UPDATE jira_connection SET instance = 'autre-jira'");
            }

            return $jira->request($method, $url, $options);
        }));
        $this->linkJira();

        [$status, $body] = $this->send('POST', '/api/tickets/SHOP-482/lookup', []);

        self::assertSame(200, $status);
        self::assertTrue($relinked);
        self::assertSame('unreachable', self::at($body, 'status'), 'Ce que l\'ancien Jira dit vaut un Jira muet.');
        self::assertSame(0, $this->rowsIn('issue_type'), 'Aucun type de l\'ancien Jira n\'est rangé sous le nouveau.');
    }

    public function testUnTicketQueLeJiraRelieNeConnaitPasPerdCeQuEnDisaitUnAutre(): void
    {
        $entityManager = static::getContainer()->get(EntityManagerInterface::class);
        $type = new IssueType('ancien-jira', new JiraIssueType('10001', 'Story', 0), Tint::Vert);
        $ticket = new Ticket('SHOP-999');
        $ticket->describe('Titre venu de l\'ancien Jira', $type, new \DateTimeImmutable('2026-10-01 09:00 UTC'));
        $entityManager->persist($type);
        $entityManager->persist($ticket);
        $entityManager->flush();
        $this->linkJira();

        self::assertSame('not_found', self::at($this->send('POST', '/api/tickets/SHOP-999/lookup', [])[1], 'status'));

        self::assertSame([null, null], array_values((array) $this->connection()->fetchAssociative('SELECT title, type_id FROM ticket WHERE ticket_key = ?', ['SHOP-999'])));
    }

    public function testUneAutrePageNeChangeAucunReglage(): void
    {
        $hostile = ['HTTP_SEC_FETCH_SITE' => 'cross-site', 'HTTP_ORIGIN' => 'https://evil.example'];

        foreach ([
            ['/api/settings/habitual-objective', ['objective' => 0]],
            ['/api/settings/working-days/6', ['worked' => true]],
            ['/api/settings/issue-types/0192f1a0-0000-7000-8000-000000000000', ['color' => 'rouge']],
        ] as [$uri, $body]) {
            [$status, $response] = $this->send('PUT', $uri, $body, $hostile);
            self::assertSame(403, $status, $uri);
            self::assertSame('cross_origin', $response['error'], $uri);
        }

        self::assertSame(0, $this->settingsRows());
    }

    /**
     * @return array<mixed>
     */
    private function settings(): array
    {
        [$status, $body] = $this->send('GET', '/api/settings', '');
        self::assertSame(200, $status);

        return $body;
    }

    /**
     * @return array{int, array<mixed>}
     */
    private function setHabitual(int $objective): array
    {
        return $this->send('PUT', '/api/settings/habitual-objective', ['objective' => $objective]);
    }

    /**
     * @return array{int, array<mixed>}
     */
    private function setWorkingDay(int $day, bool $worked): array
    {
        return $this->send('PUT', '/api/settings/working-days/'.$day, ['worked' => $worked]);
    }

    /**
     * @return array{int, array<mixed>}
     */
    private function recolor(string $id, ?string $color): array
    {
        return $this->send('PUT', '/api/settings/issue-types/'.$id, ['color' => $color]);
    }

    private function settingsRows(): int
    {
        return $this->rowsIn('settings');
    }

    private function rowsIn(string $table): int
    {
        $count = $this->connection()->fetchOne('SELECT COUNT(*) FROM '.$table);
        self::assertIsNumeric($count);

        return (int) $count;
    }
}
