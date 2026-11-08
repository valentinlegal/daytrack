<?php

namespace App\Tests\Api;

use App\Tests\Support\DayApi;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

/**
 * L'API des journées, comme l'appelle la page de DayTrack, et comme pourraient
 * l'appeler un onglet en retard, un double envoi ou un appelant hostile.
 */
final class DayApiTest extends WebTestCase
{
    use DayApi;

    public function testOuvrirUnJourNEcritRien(): void
    {
        foreach (['2026-10-06', '2026-11-05', '2019-01-01'] as $date) {
            $day = $this->day($date);
            self::assertSame(0, $day['version']);
            self::assertSame([], $day['blocks']);
            self::assertSame(450, $day['objective']);
        }

        self::assertSame(0, $this->dayRows());
    }

    public function testUnJourImpossibleOuTropLoinNExistePas(): void
    {
        foreach (['2026-02-30', '2026-13-01', '2026-11-06', '2026-10-6', 'demain'] as $date) {
            $this->browser->request('GET', '/api/days/'.$date);
            self::assertResponseStatusCodeSame(404, $date);

            [$status] = $this->patchSlots(0, [self::work('09:00', '09:15', 'SHOP-482')], $date);
            self::assertSame(404, $status, $date);
        }

        self::assertSame(0, $this->dayRows());
    }

    public function testLaJourneeDExempleDonneSesChiffres(): void
    {
        $day = $this->write(0, [
            self::work('09:15', '09:30', 'OPS-12', 'Daily'),
            self::work('09:30', '11:15', 'SHOP-482', 'Mapping des colonnes'),
            self::work('11:15', '11:45', 'SHOP-519', 'Reproduction'),
            self::work('11:45', '12:30', 'SHOP-482', 'Tests'),
            self::pause('12:30', '13:30'),
            self::work('13:30', '14:00', 'OPS-12', 'Poker planning'),
            self::work('14:00', '15:15', 'SHOP-501'),
        ]);

        self::assertSame(['worked' => 300, 'remaining' => 150, 'balance' => -150, 'projectedEnd' => '17:45'], $day['figures'], 'À 15:20, le créneau en cours compte, même vide.');
        self::assertCount(7, self::listAt($day, 'blocks'));
        self::assertCount(24, $this->rows(), 'Une ligne par quart d\'heure occupé, pause comprise.');
    }

    public function testRemplacerEnSuperposantNeLaisseQueLeNouveauTicket(): void
    {
        $this->write(0, [self::work('09:00', '11:00', 'SHOP-482', 'Mapping')]);
        $day = $this->write(1, [self::work('09:30', '10:15', 'SHOP-519')]);

        self::assertSame([
            '09:00-09:30 SHOP-482 « Mapping »',
            '09:30-10:15 SHOP-519',
            '10:15-11:00 SHOP-482 « Mapping »',
        ], self::blocks($day));
        self::assertSame(120, self::at($day, 'figures', 'worked'), 'Le quart d\'heure remplacé n\'est pas compté deux fois.');
        self::assertCount(8, $this->rows());
    }

    public function testSupprimerPuisRecreerNeLaisseNiDoubleNiFantome(): void
    {
        $this->write(0, [self::work('14:00', '15:00', 'SHOP-501')]);
        $this->write(1, [self::clear('14:00', '15:00')]);
        $this->write(2, [self::work('14:00', '15:00', 'SHOP-501')]);
        $this->write(3, [self::clear('14:15', '14:30')]);
        $day = $this->write(4, [self::work('14:15', '14:30', 'SHOP-501')]);

        self::assertSame(['14:00-15:00 SHOP-501'], self::blocks($day));
        self::assertSame([840, 855, 870, 885], array_column($this->rows(), 'start'));
    }

    public function testConvertirEnPauseRetireDuTravaille(): void
    {
        $this->write(0, [self::work('12:00', '14:00', 'SHOP-482', 'Tests')]);
        $day = $this->write(1, [self::pause('12:30', '13:30')]);

        self::assertSame(['12:00-12:30 SHOP-482 « Tests »', '12:30-13:30 pause', '13:30-14:00 SHOP-482 « Tests »'], self::blocks($day));
        self::assertSame(60, self::at($day, 'figures', 'worked'));
        self::assertSame([['start' => 750, 'kind' => 'pause', 'ticket' => null, 'comment' => null]], \array_slice($this->rows(), 2, 1));
    }

    public function testCollerParDessusAvecDesTrousRemplaceEtEfface(): void
    {
        $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')]);
        // Un bloc copié avec une case vide au milieu : la case vide efface sa cible.
        $day = $this->write(1, [self::work('09:00', '09:15', 'OPS-7'), self::clear('09:15', '09:30'), self::work('09:30', '09:45', 'OPS-7')]);

        self::assertSame(['09:00-09:15 OPS-7', '09:30-09:45 OPS-7', '09:45-10:00 SHOP-482'], self::blocks($day));
    }

    public function testUnOngletEnRetardNEcritRien(): void
    {
        $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')]);
        $this->write(1, [self::work('10:00', '11:00', 'OPS-7')]);

        // Un onglet ouvert avant ces deux gestes, qui n'en a vu que le premier.
        [$status, $body] = $this->patchSlots(1, [self::clear('09:00', '11:00')]);

        self::assertSame(409, $status);
        self::assertSame('stale', $body['error']);
        self::assertSame(2, self::at($body, 'day', 'version'), 'La réponse rend la journée à jour.');
        self::assertSame(['09:00-10:00 SHOP-482', '10:00-11:00 OPS-7'], self::blocks(self::arrayAt($body, 'day')));
        self::assertCount(8, $this->rows());
    }

    public function testEffacerUnJourJamaisSaisiNeLeCreePas(): void
    {
        // La touche Suppr sur une sélection vide d'un jour à venir.
        [$status, $day] = $this->patchSlots(0, [self::clear('10:00', '11:00')], '2026-10-20');

        self::assertSame(200, $status);
        self::assertSame(0, $day['version']);
        self::assertSame([], $day['blocks']);
        self::assertSame(0, $this->dayRows(), 'Il garderait l\'objectif habituel du moment, et ne suivrait plus celui des réglages.');

        [$status] = $this->patchSlots(2, [self::clear('10:00', '11:00')], '2026-10-20');
        self::assertSame(409, $status, 'Une version que la journée n\'a jamais eue reste périmée.');
    }

    public function testUnOngletQuiNAJamaisVuLaJourneeNeLaCreePasUneSecondeFois(): void
    {
        $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')]);

        [$status] = $this->patchSlots(0, [self::work('09:00', '10:00', 'OPS-7')]);

        self::assertSame(409, $status);
        self::assertSame(1, $this->dayRows());
        self::assertSame(array_fill(0, 4, 'SHOP-482'), array_column($this->rows(), 'ticket'));
    }

    public function testLeMemeGesteEnvoyeDeuxFoisNEnregistreQuUneSaisie(): void
    {
        $gesture = [self::work('09:00', '09:15', 'SHOP-482')];

        $this->write(0, $gesture);
        [$status] = $this->patchSlots(0, $gesture);

        self::assertSame(409, $status);
        self::assertCount(1, $this->rows());
        self::assertSame(1, $this->day()['version']);
    }

    public function testUnGesteRefuseNEcritRienDuTout(): void
    {
        $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')]);

        // Le premier créneau est juste, le second non : rien ne passe.
        [$status] = $this->patchSlots(1, [self::clear('09:00', '10:00'), self::work('10:00', '10:10', 'OPS-7')]);

        self::assertSame(422, $status);
        self::assertSame(['09:00-10:00 SHOP-482'], self::blocks($this->day()));
        self::assertSame(1, $this->day()['version']);
    }

    public function testLaGrilleVaDe0700A2000(): void
    {
        $day = $this->write(0, [self::work('07:00', '07:15', 'SHOP-482'), self::work('19:45', '20:00', 'OPS-7')]);
        self::assertSame(['07:00-07:15 SHOP-482', '19:45-20:00 OPS-7'], self::blocks($day));

        $refused = [
            [self::work('06:45', '07:15', 'SHOP-482'), 'changes[0].start'],
            [self::work('19:45', '20:15', 'SHOP-482'), 'changes[0].end'],
            [self::work('20:00', '20:15', 'SHOP-482'), 'changes[0].start'],
            [self::work('07:00', '07:00', 'SHOP-482'), 'changes[0].end'],
            [self::work('10:00', '09:00', 'SHOP-482'), 'changes[0].end'],
            [self::work('09:10', '09:30', 'SHOP-482'), 'changes[0].start'],
            [self::work('09:00', '09:20', 'SHOP-482'), 'changes[0].end'],
            [self::work('24:00', '24:15', 'SHOP-482'), 'changes[0].start'],
            [self::work('9:00', '09:15', 'SHOP-482'), 'changes[0].start'],
            [self::work("09:00\n", '09:15', 'SHOP-482'), 'changes[0].start'],
        ];
        foreach ($refused as [$change, $field]) {
            [$status, $body] = $this->patchSlots(1, [$change]);
            self::assertSame(422, $status, json_encode($change, \JSON_THROW_ON_ERROR));
            self::assertContains($field, array_column(self::listAt($body, 'violations'), 'field'));
        }

        self::assertSame(1, $this->day()['version']);
    }

    public function testUnTicketSEcritCommeDansJira(): void
    {
        $day = $this->write(0, [self::work('09:00', '09:15', '  shop-482 ', '  Tests  ')]);
        self::assertSame(['09:00-09:15 SHOP-482 « Tests »'], self::blocks($day));

        foreach (['', '  ', 'SHOP', 'SHOP-', 'SHOP-0', '-482', '4SHOP-1', 'SHOP 482', 'S-1', 'SHOP-482;DROP TABLE slot', str_repeat('A', 46).'-1234'] as $ticket) {
            [$status, $body] = $this->patchSlots(1, [self::work('10:00', '10:15', $ticket)]);
            self::assertSame(422, $status, $ticket);
            self::assertSame(['changes[0].ticket'], array_column(self::listAt($body, 'violations'), 'field'), $ticket);
        }

        // Le même texte que l'écran, quand on quitte le champ Ticket.
        [, $body] = $this->patchSlots(1, [self::work('10:00', '10:15', 'pas un ticket')]);
        self::assertSame([['field' => 'changes[0].ticket', 'message' => 'Un identifiant de ticket s\'écrit comme SHOP-482.']], $body['violations']);
    }

    public function testUnCommentaireTientSurUneLigneDe500Caracteres(): void
    {
        $day = $this->write(0, [self::work('09:00', '09:15', 'SHOP-482', str_repeat('é', 500))]);
        self::assertSame(500, mb_strlen(self::stringAt($day, 'blocks', 0, 'comment')));

        foreach ([str_repeat('é', 501), "Tests\nunitaires", "Tests\tunitaires", "Tests\u{2028}unitaires", "Tests\u{2029}unitaires"] as $comment) {
            [$status, $body] = $this->patchSlots(1, [self::work('10:00', '10:15', 'SHOP-482', $comment)]);
            self::assertSame(422, $status);
            self::assertSame(['changes[0].comment'], array_column(self::listAt($body, 'violations'), 'field'));
        }
    }

    public function testChaqueRefusDitLaLimiteQuIlApplique(): void
    {
        $this->write(0, [self::work('09:00', '09:15', 'SHOP-482')]);

        $refused = [
            [self::work('06:45', '07:15', 'SHOP-482'), 'changes[0].start', 'Un créneau commence sur un quart d\'heure, de 07:00 à 19:45.'],
            [self::work('19:45', '20:15', 'SHOP-482'), 'changes[0].end', 'Un créneau finit sur un quart d\'heure, de 07:15 à 20:00.'],
            [self::work('10:00', '10:15', str_repeat('A', 46).'-1234'), 'changes[0].ticket', 'Un identifiant de ticket tient en 50 caractères.'],
            [self::work('10:00', '10:15', 'SHOP-482', str_repeat('é', 501)), 'changes[0].comment', 'Le commentaire tient en 500 caractères.'],
            [self::work('10:00', '10:15', 'SHOP-482', "Tests\nunitaires"), 'changes[0].comment', 'Le commentaire tient sur une ligne.'],
        ];
        foreach ($refused as [$change, $field, $message]) {
            [, $body] = $this->patchSlots(1, [$change]);
            self::assertSame([['field' => $field, 'message' => $message]], $body['violations'], $message);
        }

        foreach ([795 => 'L\'objectif va de 0h00 à 13h00.', 451 => 'L\'objectif se règle au quart d\'heure.'] as $objective => $message) {
            [, $body] = $this->putObjective(1, $objective);
            self::assertSame([['field' => 'objective', 'message' => $message]], $body['violations'], $message);
        }
    }

    public function testUnCommentaireNeParleJamaisALaBase(): void
    {
        $comment = "Revue'); DROP TABLE slot; --";
        $day = $this->write(0, [self::work('09:00', '09:15', 'SHOP-482', $comment)]);

        self::assertSame($comment, self::at($day, 'blocks', 0, 'comment'));
        self::assertSame($comment, self::at($this->rows(), 0, 'comment'));
    }

    public function testUnCommentaireVideNEnEstPasUn(): void
    {
        $day = $this->write(0, [
            self::work('09:00', '09:15', 'SHOP-482', '   '),
            self::work('09:15', '09:30', 'SHOP-482', "\u{a0}"),
            self::work('09:30', '09:45', 'SHOP-482', "\u{200b}\n"),
            self::work('09:45', '10:00', 'SHOP-482'),
        ]);

        self::assertSame(['09:00-10:00 SHOP-482'], self::blocks($day));
    }

    public function testDeuxCommentairesQuiSeLisentPareilSontLeMeme(): void
    {
        $day = $this->write(0, [
            self::work('09:00', '09:15', 'SHOP-482', 'Revue de code'),
            self::work('09:15', '09:30', 'SHOP-482', "Revue\u{a0}de code\u{a0}"),
            self::work('09:30', '09:45', 'SHOP-482', "Revue  de\u{202f}\u{a0}code"),
        ]);

        self::assertSame(['09:00-09:45 SHOP-482 « Revue de code »'], self::blocks($day));
        self::assertSame(array_fill(0, 3, 'Revue de code'), array_column($this->rows(), 'comment'));
    }

    public function testUnCommentaireGardeCeQuiSeVoit(): void
    {
        // Un emoji composé tient par un caractère invisible, qu'il ne faut pas retirer.
        $comment = "Revue \u{1F469}\u{200D}\u{1F4BB} et café";
        $day = $this->write(0, [self::work('09:00', '09:15', 'SHOP-482', $comment)]);

        self::assertSame($comment, self::at($day, 'blocks', 0, 'comment'));
    }

    public function testUnePauseOuUnCreneauVideNePortentRien(): void
    {
        $refused = [
            ['start' => '12:00', 'end' => '13:00', 'kind' => 'pause', 'ticket' => 'SHOP-482'],
            ['start' => '12:00', 'end' => '13:00', 'kind' => 'pause', 'comment' => 'Déjeuner'],
            ['start' => '12:00', 'end' => '13:00', 'kind' => 'empty', 'ticket' => 'SHOP-482'],
            ['start' => '12:00', 'end' => '13:00', 'kind' => 'work'],
            ['start' => '12:00', 'end' => '13:00', 'kind' => 'meeting'],
        ];
        foreach ($refused as $change) {
            [$status] = $this->patchSlots(0, [$change]);
            self::assertSame(422, $status, json_encode($change, \JSON_THROW_ON_ERROR));
        }

        self::assertSame(0, $this->dayRows());
    }

    public function testDeuxCreneauxDuMemeGesteNeSeChevauchentPas(): void
    {
        [$status, $body] = $this->patchSlots(0, [self::work('09:00', '10:00', 'SHOP-482'), self::work('09:45', '10:30', 'OPS-7')]);

        self::assertSame(422, $status);
        self::assertSame(['changes[1]'], array_column(self::listAt($body, 'violations'), 'field'));
        self::assertSame(0, $this->dayRows());
    }

    public function testUnGesteChangeAuMoinsUnCreneauEtAuPlusLaGrille(): void
    {
        [$status] = $this->patchSlots(0, []);
        self::assertSame(422, $status);

        $all = array_map(static fn (int $quarter): array => self::pause(\sprintf('%02d:%02d', intdiv($quarter, 60), $quarter % 60), \sprintf('%02d:%02d', intdiv($quarter + 15, 60), ($quarter + 15) % 60)), range(420, 1185, 15));
        self::assertCount(52, $all);
        $this->write(0, $all);

        [$status] = $this->patchSlots(1, [...$all, self::pause('09:00', '09:15')]);
        self::assertSame(422, $status);
    }

    public function testUnJsonMalFormeEstRefuseSansRienEcrire(): void
    {
        $uri = '/api/days/'.self::TODAY.'/slots';
        $change = [self::work('09:00', '09:15', 'SHOP-482')];

        $cases = [
            [400, '{"version": 0, "changes": [', 'application/json'],
            [415, json_encode(['version' => 0, 'changes' => $change], \JSON_THROW_ON_ERROR), 'text/plain'],
            [422, json_encode(['version' => '0', 'changes' => $change], \JSON_THROW_ON_ERROR), 'application/json'],
            [422, json_encode(['version' => -1, 'changes' => $change], \JSON_THROW_ON_ERROR), 'application/json'],
            [422, json_encode(['changes' => $change], \JSON_THROW_ON_ERROR), 'application/json'],
            [422, json_encode(['version' => 0, 'changes' => 'tout'], \JSON_THROW_ON_ERROR), 'application/json'],
            [422, json_encode(['version' => 0, 'changes' => $change, 'id' => 1], \JSON_THROW_ON_ERROR), 'application/json'],
            [422, json_encode(['version' => 0, 'changes' => [['start' => 900, 'end' => '09:15', 'kind' => 'pause']]], \JSON_THROW_ON_ERROR), 'application/json'],
            [422, '[]', 'application/json'],
        ];
        foreach ($cases as [$expected, $body, $contentType]) {
            [$status, $answer] = $this->send('PATCH', $uri, $body, contentType: $contentType);
            self::assertSame($expected, $status, $body);
            self::assertIsString($answer['error'] ?? null);
        }

        self::assertSame(0, $this->dayRows());
    }

    public function testUneValeurDeTravers(): void
    {
        [$status, $body] = $this->send('PATCH', '/api/days/'.self::TODAY.'/slots', ['version' => 'deux', 'changes' => [self::work('09:00', '09:15', 'SHOP-482')]]);

        self::assertSame(422, $status);
        self::assertSame([['field' => 'version', 'message' => 'Valeur invalide.']], $body['violations']);
    }

    public function testLObjectifDuJourVaDe0h00A13h00AuQuartDHeure(): void
    {
        [$status, $day] = $this->putObjective(0, 360);
        self::assertSame(200, $status);
        self::assertSame(['worked' => 0, 'remaining' => 360, 'balance' => -360, 'projectedEnd' => '21:15'], $day['figures']);
        self::assertSame(450, $day['habitualObjective']);

        foreach ([0, 780] as $version => $objective) {
            [$status, $day] = $this->putObjective($version + 1, $objective);
            self::assertSame(200, $status);
            self::assertSame($objective, $day['objective']);
        }

        foreach ([795, -15, 10, 451] as $objective) {
            [$status, $body] = $this->putObjective(3, $objective);
            self::assertSame(422, $status, (string) $objective);
            self::assertSame(['objective'], array_column(self::listAt($body, 'violations'), 'field'));
        }

        self::assertSame(780, $this->day()['objective']);
    }

    public function testRevenirALHabituelRendSonSuiviAUnJourVide(): void
    {
        $this->putObjective(0, 360);
        [$status, $day] = $this->putObjective(1, 450);
        self::assertSame(200, $status);
        self::assertSame(450, $day['objective']);

        [$status] = $this->send('PUT', '/api/settings/habitual-objective', ['objective' => 480]);
        self::assertSame(200, $status);

        self::assertSame(480, $this->day()['objective'], 'Il suit l\'habituel, comme un jour jamais touché.');
    }

    public function testUnObjectifChoisiAutreQueLHabituelNeSuitPasLHabituel(): void
    {
        $this->putObjective(0, 360);
        [$status] = $this->send('PUT', '/api/settings/habitual-objective', ['objective' => 480]);
        self::assertSame(200, $status);

        self::assertSame(360, $this->day()['objective']);
    }

    public function testRevenirALHabituelSeJugeSurLHabituelDuServeur(): void
    {
        // Un onglet resté ouvert propose 7h30, alors que l'habituel est passé à 8h00 : 7h30
        // est un choix pour ce jour-là.
        [$status] = $this->send('PUT', '/api/settings/habitual-objective', ['objective' => 480]);
        self::assertSame(200, $status);
        $this->putObjective(0, 450);
        [$status] = $this->send('PUT', '/api/settings/habitual-objective', ['objective' => 510]);
        self::assertSame(200, $status);

        self::assertSame(450, $this->day()['objective']);
    }

    public function testUnJourRevenuALHabituelPuisSaisiPuisVideReprendLHabituelDuMoment(): void
    {
        $this->putObjective(0, 360);
        $this->putObjective(1, 450);
        $this->write(2, [self::work('09:00', '09:15', 'SHOP-482')]);
        [$status] = $this->send('PUT', '/api/settings/habitual-objective', ['objective' => 480]);
        self::assertSame(200, $status);
        self::assertSame(450, $this->day()['objective'], 'Saisi, il garde l\'objectif sous lequel il a été saisi.');

        $this->write(3, [self::clear('09:00', '09:15')]);

        self::assertSame(480, $this->day()['objective']);
    }

    public function testUnJourPrendLObjectifHabituelASaPremiereSaisieEtLeGarde(): void
    {
        $day = $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')]);
        self::assertSame(450, $day['objective']);

        [$status] = $this->putObjective(0, 300);
        self::assertSame(409, $status, 'Un onglet en retard ne change pas non plus l\'objectif.');
        self::assertSame(450, $this->day()['objective']);
    }

    public function testLaFinPrevueNExisteQueLeJourMeme(): void
    {
        $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')]);
        $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')], '2026-10-05');
        $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')], '2026-10-07');

        self::assertSame('21:45', self::at($this->day(), 'figures', 'projectedEnd'), 'Il reste 6h30 depuis 15:15, le début du créneau en cours.');
        self::assertNull(self::at($this->day('2026-10-05'), 'figures', 'projectedEnd'));
        self::assertNull(self::at($this->day('2026-10-07'), 'figures', 'projectedEnd'));
    }

    public function testAMinuitLeJourChangeSelonLHeureDeParis(): void
    {
        // 23:50 en heure universelle le 5 : il est 01:50 le 6 à Paris.
        self::mockTime('2026-10-05 23:50:00 UTC');
        $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')]);

        self::assertSame('14:30', self::at($this->day(), 'figures', 'projectedEnd'));
        self::assertNull(self::at($this->day('2026-10-05'), 'figures', 'projectedEnd'));

        // La limite des 30 jours suit le même minuit.
        $this->browser->request('GET', '/api/days/2026-11-05');
        self::assertResponseIsSuccessful();
    }

    public function testUnJourNonTravailleSeLitSansObjectif(): void
    {
        $saturday = $this->day('2026-10-03');
        self::assertFalse($saturday['working']);
        self::assertSame(0, $saturday['objective']);
        self::assertSame(450, $saturday['habitualObjective'], '« Revenir à … » garde l\'objectif habituel.');
        self::assertSame([1, 2, 3, 4, 5], $saturday['workingDays']);
        self::assertSame(['worked' => 0, 'remaining' => 0, 'balance' => 0, 'projectedEnd' => null], $saturday['figures']);

        $friday = $this->day('2026-10-02');
        self::assertTrue($friday['working']);
        self::assertSame(450, $friday['objective']);
        self::assertSame(0, $this->dayRows(), 'Lire un samedi n\'écrit rien.');
    }

    public function testUnJourNonTravailleSeSaisitQuandMemeEtToutYCompteEnPlus(): void
    {
        $day = $this->write(0, [self::work('09:00', '12:00', 'OPS-7'), self::pause('12:00', '12:30')], '2026-10-03');

        self::assertSame(['09:00-12:00 OPS-7', '12:00-12:30 pause'], self::blocks($day));
        self::assertSame(['worked' => 180, 'remaining' => 0, 'balance' => 180, 'projectedEnd' => null], $day['figures']);
    }

    public function testUnJourNonTravailleRefuseUnObjectif(): void
    {
        foreach (['2026-10-03', '2026-10-04', '2026-10-10'] as $date) {
            [$status, $body] = $this->putObjective(0, 300, $date);
            self::assertSame(422, $status, $date);
            self::assertSame([['field' => 'objective', 'message' => 'Ce jour n\'est pas travaillé : il n\'a pas d\'objectif.']], $body['violations']);
        }
        self::assertSame(0, $this->dayRows());

        $this->write(0, [self::work('09:00', '10:00', 'OPS-7')], '2026-10-03');
        [$status] = $this->putObjective(1, 300, '2026-10-03');
        self::assertSame(422, $status, 'Même saisi, un samedi n\'a pas d\'objectif.');
        self::assertSame(1, self::at($this->day('2026-10-03'), 'version'), 'Le refus n\'écrit rien.');
    }

    public function testUnJourQuiCesseDEtreTravailleRetrouveSonObjectifQuandIlLeRedevient(): void
    {
        $this->setWorkingDay(6, true);
        [$status, $day] = $this->putObjective(0, 300, '2026-10-03');
        self::assertSame(200, $status);
        self::assertTrue($day['working']);
        self::assertSame(300, $day['objective']);

        $this->setWorkingDay(6, false);
        $day = $this->day('2026-10-03');
        self::assertFalse($day['working']);
        self::assertSame(0, $day['objective']);

        $this->setWorkingDay(6, true);
        self::assertSame(300, $this->day('2026-10-03')['objective']);
    }

    public function testSansAucunJourTravailleToutJourSeLitSansObjectif(): void
    {
        foreach (range(1, 5) as $day) {
            $this->setWorkingDay($day, false);
        }

        $day = $this->day();
        self::assertFalse($day['working']);
        self::assertSame([], $day['workingDays']);
        self::assertSame(0, $day['objective']);
    }

    private function setWorkingDay(int $day, bool $worked): void
    {
        [$status] = $this->send('PUT', '/api/settings/working-days/'.$day, ['worked' => $worked]);
        self::assertSame(200, $status);
    }
}
