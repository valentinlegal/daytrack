<?php

namespace App\Tests\Recurrence;

use App\Day\UserCalendar;
use App\Dev\Jira\Catalog;
use App\Recurrence\RecurrencePoser;
use App\Repository\RecurrenceRepository;
use App\Tests\Support\DayApi;
use App\Tests\Support\JiraApi;
use App\Tests\Support\RecurrenceApi;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Uid\Uuid;

/**
 * Les récurrences se posent d'elles-mêmes le jour venu, et sur les jours venus sans que
 * DayTrack ait été ouvert : sur les seuls quarts d'heure libres, les jours où elles tombent,
 * travaillés selon les réglages, sans objectif mis à 0h00, et jamais après coup sur un jour
 * déjà venu.
 *
 * Elles naissent le mardi 6 octobre 2026 à 15:20, à Paris ; l'horloge avance ensuite.
 */
final class RecurrencePoserTest extends WebTestCase
{
    use DayApi;
    use JiraApi;
    use RecurrenceApi;

    public function testUnJourOublieRecoitSesRecurrences(): void
    {
        [$daily] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        [$lunch] = $this->repeat(1, self::pause('12:30', '13:30'));

        // DayTrack reste fermé du mercredi au lundi matin.
        self::mockTime('2026-10-12 08:30:00 Europe/Paris');
        $monday = $this->day('2026-10-12');

        $names = [$daily => 'daily', $lunch => 'déjeuner'];
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily', '12:30-13:30 pause ↻déjeuner'], self::arrows($monday, $names));
        self::assertSame(15, self::at($monday, 'figures', 'worked'), 'La pause n\'entre pas dans le temps travaillé.');
        foreach (['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12'] as $date) {
            self::assertSame([555 => $daily, 750 => $lunch, 765 => $lunch, 780 => $lunch, 795 => $lunch], $this->links($date), $date);
            self::assertSame(1, $this->day($date)['version'], $date.' : née de ses récurrences.');
        }
        self::assertSame(['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12'], $this->dates(), 'Le samedi et le dimanche ne reçoivent rien.');
        self::assertSame('2026-10-12', $this->recurrenceRow($daily)['posedThrough']);
        self::assertSame('2026-10-12', $this->recurrenceRow($lunch)['posedThrough']);
    }

    public function testUnJourNonTravailleNEnRecoitAucuneMemeRecocheEnsuite(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        $this->setWorkingDay(3, false);

        self::mockTime('2026-10-08 08:00:00 Europe/Paris');
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($this->day('2026-10-08'), [$id => 'daily']));

        $wednesday = $this->day('2026-10-07');
        self::assertSame([], $wednesday['blocks']);
        self::assertFalse($wednesday['working']);
        self::assertTrue($wednesday['recurrencesHeld'], 'La journée vide dit que ses récurrences ne s\'y posent pas.');
        self::assertNotContains('2026-10-07', $this->dates());

        // Recoché, il ne reçoit rien après coup : c'est un jour déjà venu.
        $this->setWorkingDay(3, true);
        self::mockTime('2026-10-09 08:00:00 Europe/Paris');
        self::assertSame([], $this->day('2026-10-07')['blocks']);
        self::assertSame([555 => $id], $this->links('2026-10-09'));
    }

    public function testUnSamediTravailleNeRecoitQueCeQuiTombeLeSamedi(): void
    {
        $this->setWorkingDay(6, true);
        [$weekdays] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        [$saturdays] = $this->repeat(1, self::work('10:00', '12:00', 'OPS-7', 'Astreinte'), [6]);

        self::mockTime('2026-10-11 10:00:00 Europe/Paris');
        $this->day('2026-10-11');

        self::assertSame([600 => $saturdays, 615 => $saturdays, 630 => $saturdays, 645 => $saturdays, 660 => $saturdays, 675 => $saturdays, 690 => $saturdays, 705 => $saturdays], $this->links('2026-10-10'));
        self::assertSame([555 => $weekdays], $this->links('2026-10-09'));
        self::assertNotContains('2026-10-11', $this->dates(), 'Le dimanche n\'est pas travaillé.');
    }

    public function testUnJourMisA0h00NEnRecoitAucuneEtSaisirQuandMemeNEnPosePas(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        // Un congé posé la veille.
        [$status] = $this->putObjective(self::intAt($this->day('2026-10-07'), 'version'), 0, '2026-10-07');
        self::assertSame(200, $status);

        self::mockTime('2026-10-08 08:00:00 Europe/Paris');
        $wednesday = $this->day('2026-10-07');
        self::assertSame([555 => $id], $this->links('2026-10-08'));

        self::assertSame([], $wednesday['blocks']);
        self::assertTrue($wednesday['declaredOff']);
        self::assertTrue($wednesday['recurrencesHeld']);
        self::assertSame(1, $wednesday['version'], 'Rien ne s\'y est écrit.');

        $day = $this->write(1, [self::work('14:00', '15:00', 'SHOP-482')], '2026-10-07');
        self::assertSame(['14:00-15:00 SHOP-482'], self::arrows($day));
        self::assertFalse($day['recurrencesHeld']);

        self::mockTime('2026-10-09 08:00:00 Europe/Paris');
        self::assertSame(['14:00-15:00 SHOP-482'], self::arrows($this->day('2026-10-07')));
    }

    public function testUnJourRemisALHabituelPrendCeluiDuMomentQuandElleSYPose(): void
    {
        [$status] = $this->send('PUT', '/api/settings/habitual-objective', ['objective' => 420]);
        self::assertSame(200, $status);
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        // Un congé posé sur le mercredi, puis retiré : sa ligne reste, vide, à 7h00 non choisi.
        [$status] = $this->putObjective(self::intAt($this->day('2026-10-07'), 'version'), 0, '2026-10-07');
        self::assertSame(200, $status);
        [$status, $wednesday] = $this->putObjective(1, 420, '2026-10-07');
        self::assertSame(200, $status);
        self::assertSame(420, $wednesday['objective']);
        self::assertSame(['objective' => 420, 'chosen' => false], $this->objectiveRow('2026-10-07'));
        [$status] = $this->send('PUT', '/api/settings/habitual-objective', ['objective' => 450]);
        self::assertSame(200, $status);

        self::mockTime('2026-10-07 08:00:00 Europe/Paris');
        $wednesday = $this->day('2026-10-07');

        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($wednesday, [$id => 'daily']));
        self::assertSame(450, $wednesday['objective'], 'Remplie, elle garde l\'habituel du jour où elle s\'est remplie.');
        self::assertSame(['objective' => 450, 'chosen' => false], $this->objectiveRow('2026-10-07'));
        self::assertSame(435, self::at($wednesday, 'figures', 'remaining'));
    }

    public function testUnObjectifHabituelA0h00NeFermeAucunJour(): void
    {
        [$status] = $this->send('PUT', '/api/settings/habitual-objective', ['objective' => 0]);
        self::assertSame(200, $status);
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));

        self::mockTime('2026-10-07 08:00:00 Europe/Paris');

        self::assertFalse($this->day('2026-10-07')['declaredOff']);
        self::assertSame([555 => $id], $this->links('2026-10-07'));
    }

    public function testUnCreneauDejaPrisNeRecoitQueLesQuartsDHeureLibres(): void
    {
        // Saisis avant que la récurrence naisse : ce qui est déjà saisi l'emporte.
        $this->write(0, [self::work('09:15', '09:30', 'SHOP-482')], '2026-10-07');
        $this->write(0, [self::pause('09:00', '09:15'), self::work('09:15', '10:00', 'OPS-7')], '2026-10-08');
        [$id] = $this->repeat(0, self::work('09:00', '10:00', 'OPS-12', 'Daily'));

        self::mockTime('2026-10-08 08:00:00 Europe/Paris');

        $wednesday = $this->day('2026-10-07');
        self::assertSame(['09:00-09:15 OPS-12 « Daily » ↻daily', '09:15-09:30 SHOP-482', '09:30-10:00 OPS-12 « Daily » ↻daily'], self::arrows($wednesday, [$id => 'daily']));
        self::assertSame(60, self::at($wednesday, 'figures', 'worked'), 'Le quart d\'heure déjà pris n\'est pas compté deux fois.');
        self::assertSame(2, $wednesday['version'], 'Sa version avance : un onglet qui ne l\'a pas vue est en retard.');
        self::assertCount(4, $this->rows('2026-10-07'));

        $thursday = $this->day('2026-10-08');
        self::assertSame(['09:00-09:15 pause', '09:15-10:00 OPS-7'], self::arrows($thursday), 'Ce qui est déjà saisi l\'emporte.');
        self::assertSame(1, $thursday['version'], 'Rien posé, rien écrit.');
    }

    public function testLesBordsDeLaGrilleSePosent(): void
    {
        $first = self::stringAt($this->saveRecurrence(0, [self::work('07:00', '07:15', 'OPS-7')], self::weekly()), 'untils', 0, 'recurrence');
        $last = self::stringAt($this->saveRecurrence(1, [self::work('19:45', '20:00', 'OPS-7', 'Astreinte')], self::weekly()), 'untils', 0, 'recurrence');

        self::mockTime('2026-10-07 06:00:00 Europe/Paris');

        self::assertSame(['07:00-07:15 OPS-7 ↻première', '19:45-20:00 OPS-7 « Astreinte » ↻dernière'], self::arrows($this->day('2026-10-07'), [$first => 'première', $last => 'dernière']));
        self::assertSame([420 => $first, 1185 => $last], $this->links('2026-10-07'));
    }

    public function testTouteLaGrilleSePose(): void
    {
        $this->write(0, [self::work('12:00', '12:15', 'SHOP-482')], '2026-10-07');
        $day = $this->saveRecurrence(0, [self::pause('07:00', '20:00')], self::weekly());
        $id = self::stringAt($day, 'untils', 0, 'recurrence');

        self::mockTime('2026-10-07 08:00:00 Europe/Paris');

        self::assertSame(['07:00-12:00 pause ↻journée', '12:00-12:15 SHOP-482', '12:15-20:00 pause ↻journée'], self::arrows($this->day('2026-10-07'), [$id => 'journée']));
        self::assertCount(52, $this->rows('2026-10-07'));
    }

    public function testUneFinCompteLeJourMemeEtRienApres(): void
    {
        [$once] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'), until: self::TODAY);
        [$twice] = $this->repeat(1, self::work('10:00', '10:15', 'OPS-7'), until: '2026-10-07');

        self::mockTime('2026-10-09 08:00:00 Europe/Paris');
        $this->day('2026-10-09');

        self::assertSame([600 => $twice], $this->links('2026-10-07'));
        self::assertSame(['2026-10-06', '2026-10-07'], $this->dates());
        self::assertSame([], static::getContainer()->get(RecurrenceRepository::class)->due(self::date('2026-10-09')), 'Finies, elles n\'ont plus rien à traiter.');
        self::assertSame(self::TODAY, $this->recurrenceRow($once)['until']);
    }

    public function testUneFoisDetacheeNeSeReposeJamais(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        // « Cette fois seulement », sur un jour à venir.
        $recurrences = static::getContainer()->get(RecurrenceRepository::class);
        $recurrences->skip($recurrences->byId(Uuid::fromString($id)) ?? throw new \LogicException(), self::date('2026-10-08'));
        static::getContainer()->get(EntityManagerInterface::class)->flush();

        self::mockTime('2026-10-09 08:00:00 Europe/Paris');
        $this->day('2026-10-09');

        self::assertSame([555 => $id], $this->links('2026-10-07'));
        self::assertSame([], $this->links('2026-10-08'));
        self::assertNotContains('2026-10-08', $this->dates());
        self::assertSame([555 => $id], $this->links('2026-10-09'));
    }

    public function testUneFoisEffaceeLeJourVenuNeRevientPas(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        self::mockTime('2026-10-07 08:00:00 Europe/Paris');
        $day = $this->write(self::intAt($this->day('2026-10-07'), 'version'), [self::clear('09:15', '09:30')], '2026-10-07');
        self::assertSame([], $day['blocks']);

        self::mockTime('2026-10-07 18:00:00 Europe/Paris');
        self::assertSame([], $this->day('2026-10-07')['blocks']);
        self::mockTime('2026-10-08 08:00:00 Europe/Paris');
        self::assertSame([], $this->day('2026-10-07')['blocks']);
        self::assertSame([555 => $id], $this->links('2026-10-08'), 'Seule cette fois-là a été effacée.');
    }

    public function testUneRecurrenceRetireeNeSePoseJamais(): void
    {
        // Créée puis annulée.
        [$undone] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        $this->writeWith(1, [self::clear('09:15', '09:30')], [['recurrence' => $undone, 'from' => null, 'to' => '2026-10-05']]);
        // Créée puis décochée le jour même.
        [$stopped] = $this->repeat(2, self::work('10:00', '10:15', 'OPS-7'));
        $this->saveRecurrence(3, [self::work('10:00', '10:15', 'OPS-7')], null, $stopped);

        self::mockTime('2026-10-13 08:00:00 Europe/Paris');
        $this->day('2026-10-13');

        self::assertSame([self::TODAY], $this->dates());
        self::assertSame('2026-10-05', $this->recurrenceRow($undone)['until']);
        self::assertSame('2026-10-05', $this->recurrenceRow($stopped)['until']);
    }

    public function testCreeeDepuisUnJourPasseElleSePoseAPartirDeDemain(): void
    {
        // Le jeudi 1er octobre, vu depuis le mardi 6.
        $day = $this->saveRecurrence(0, [self::work('09:15', '09:30', 'OPS-12', 'Daily')], self::weekly(), null, '2026-10-01');
        $id = self::stringAt($day, 'untils', 0, 'recurrence');
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($day, [$id => 'daily']));
        self::assertSame(['firstDay' => '2026-10-01', 'until' => null, 'posedThrough' => self::TODAY], $this->recurrenceRow($id));

        foreach (['2026-10-02', '2026-10-05', self::TODAY] as $date) {
            self::assertSame([], $this->day($date)['blocks'], $date);
        }
        self::assertSame(['2026-10-01'], $this->dates());

        self::mockTime('2026-10-07 08:00:00 Europe/Paris');
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($this->day('2026-10-07'), [$id => 'daily']));
        self::assertSame([], $this->day(self::TODAY)['blocks']);
    }

    public function testUnOngletQuiNAPasVuLaPoseEstEnRetard(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        $wednesday = $this->write(self::intAt($this->day('2026-10-07'), 'version'), [self::work('14:00', '15:00', 'SHOP-482')], '2026-10-07');
        $thursday = $this->day('2026-10-08');
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($thursday, [$id => 'daily']), 'Le jeudi prévoit son Daily.');
        self::assertSame([], $this->links('2026-10-08'));

        // Deux onglets restés ouverts depuis la veille, sur ces deux jours à venir.
        self::mockTime('2026-10-08 08:00:00 Europe/Paris');

        [$status, $body] = $this->patchSlots(self::intAt($wednesday, 'version'), [self::clear('14:00', '15:00')], '2026-10-07');
        self::assertSame(409, $status);
        self::assertSame(2, self::at($body, 'day', 'version'));
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily', '14:00-15:00 SHOP-482'], self::arrows(self::arrayAt($body, 'day'), [$id => 'daily']));

        $seen = self::intAt($thursday, 'version');
        [$status, $body] = $this->patchSlots($seen, [self::work('11:00', '11:15', 'OPS-7')], '2026-10-08');
        self::assertSame(409, $status);
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows(self::arrayAt($body, 'day'), [$id => 'daily']));

        [$status] = $this->putObjective($seen, 300, '2026-10-08');
        self::assertSame(409, $status);
        [$status] = $this->putRecurrence($seen, [self::work('16:00', '16:15', 'OPS-7')], self::weekly(), null, '2026-10-08');
        self::assertSame(409, $status);

        self::assertSame([555 => $id], $this->links('2026-10-08'));
        self::assertSame(1, $this->recurrenceRows());

        // Remis à jour, il écrit.
        $day = $this->write(1, [self::work('11:00', '11:15', 'OPS-7')], '2026-10-08');
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily', '11:00-11:15 OPS-7'], self::arrows($day, [$id => 'daily']));
    }

    public function testDeuxPassagesDeSuiteNePosentQuUneFois(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:45', 'OPS-12', 'Daily'));
        self::mockTime('2026-10-07 00:00:01 Europe/Paris');
        $first = $this->day('2026-10-07');

        $poser = static::getContainer()->get(RecurrencePoser::class);
        $poser->pose();
        $poser->pose();
        $this->marks();
        self::mockTime('2026-10-07 23:59:59 Europe/Paris');
        $last = $this->day('2026-10-07');

        self::assertSame($first['version'], $last['version']);
        self::assertSame([555 => $id, 570 => $id], $this->links('2026-10-07'));
        self::assertSame([self::TODAY, '2026-10-07'], $this->dates());
    }

    public function testRienAPoserNEcritRienEtNePrendPasLeVerrou(): void
    {
        $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')], '2026-10-07');
        $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));

        // Un autre worker tient le verrou de la base ; celui-ci ne l'attend pas.
        $path = $this->connection()->getParams()['path'] ?? null;
        self::assertIsString($path);
        $other = new \PDO('sqlite:'.$path, options: [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION]);
        $native = $this->connection()->getNativeConnection();
        self::assertInstanceOf(\PDO::class, $native);
        $native->setAttribute(\PDO::ATTR_TIMEOUT, 0);
        $other->exec('BEGIN IMMEDIATE');

        try {
            static::getContainer()->get(RecurrencePoser::class)->pose();
            self::assertSame(['09:00-10:00 SHOP-482'], self::blocks($this->day('2026-10-07')));
            self::assertSame(1, $this->day(self::TODAY)['version']);
            $this->marks();
        } finally {
            $other->exec('ROLLBACK');
        }
    }

    public function testUneFinRepousseeApresCoupNePoseRienSurUnJourDejaVenu(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'), until: '2026-10-07');
        [$stopped] = $this->repeat(1, self::work('10:00', '10:15', 'OPS-7'));
        $this->saveRecurrence(2, [self::work('10:00', '10:15', 'OPS-7')], null, $stopped);

        self::mockTime('2026-10-12 08:00:00 Europe/Paris');
        $wednesday = $this->day('2026-10-07');
        self::assertSame([555 => $id], $this->links('2026-10-07'));

        // Repoussée sans fin depuis le mercredi, par une fin rendue : une fois passée ne se
        // change plus dans la fenêtre.
        $this->writeWith(self::intAt($wednesday, 'version'), [['start' => '19:45', 'end' => '20:00', 'kind' => 'empty']], [['recurrence' => $id, 'from' => '2026-10-07', 'to' => null]], '2026-10-07');
        // Rendue par annuler, depuis le mardi.
        $this->writeWith(3, [self::linked(self::work('10:00', '10:15', 'OPS-7'), $stopped)], [['recurrence' => $stopped, 'from' => '2026-10-05', 'to' => null]]);

        foreach (['2026-10-08', '2026-10-09', '2026-10-12'] as $date) {
            self::assertSame([], $this->day($date)['blocks'], $date);
        }
        self::assertSame('2026-10-12', $this->recurrenceRow($id)['posedThrough']);
        self::assertSame('2026-10-12', $this->recurrenceRow($stopped)['posedThrough']);

        self::mockTime('2026-10-13 08:00:00 Europe/Paris');
        $this->day('2026-10-13');
        self::assertSame([555 => $id, 600 => $stopped], $this->links('2026-10-13'));
    }

    public function testUneSemaineSurDeuxNePoseRienLesSemainesSans(): void
    {
        [$id] = $this->repeatWith(0, self::work('09:15', '09:30', 'OPS-12', 'Poker'), self::everyWeeks(2, [2, 4]));

        self::mockTime('2026-10-23 08:00:00 Europe/Paris');
        $this->day('2026-10-23');

        self::assertSame([self::TODAY, '2026-10-08', '2026-10-20', '2026-10-22'], $this->dates(), 'Ses semaines se comptent depuis celle du mardi 6.');
        foreach (['2026-10-08', '2026-10-20', '2026-10-22'] as $date) {
            self::assertSame([555 => $id], $this->links($date), $date);
        }
        self::assertSame('2026-10-23', $this->recurrenceRow($id)['posedThrough']);
    }

    public function testUneSemaineSurQuatreRevientQuatreSemainesPlusTard(): void
    {
        // Le lundi, créée un mardi : sa semaine est celle du lundi 5, déjà passé.
        [$id] = $this->repeatWith(0, self::work('09:15', '09:30', 'OPS-12', 'Revue'), self::everyWeeks(4, [1]));

        self::mockTime('2026-12-01 08:00:00 Europe/Paris');
        $this->day('2026-12-01');

        self::assertSame([self::TODAY, '2026-11-02', '2026-11-30'], $this->dates());
        self::assertSame([555 => null], $this->links(self::TODAY), 'Le bloc du mardi n\'en est pas une fois.');
        self::assertSame([555 => $id], $this->links('2026-11-02'));
        self::assertSame([555 => $id], $this->links('2026-11-30'));
    }

    public function testLe3eEtLeDernierVendrediSePosentChaqueMois(): void
    {
        [$third] = $this->repeatWith(self::intAt($this->day('2026-10-16'), 'version'), self::work('14:00', '15:00', 'OPS-7', 'Dépendances'), self::monthlyWeekday(5, 3), '2026-10-16');
        [$last] = $this->repeatWith(self::intAt($this->day('2026-10-30'), 'version'), self::work('16:00', '17:00', 'OPS-7', 'Bilan'), self::monthlyWeekday(5, -1), '2026-10-30');

        self::mockTime('2027-01-30 08:00:00 Europe/Paris');
        $this->day('2027-01-30');

        // Janvier 2027 a cinq vendredis : le dernier est le 29, pas le 22.
        self::assertSame(['2026-10-16', '2026-10-30', '2026-11-20', '2026-11-27', '2026-12-18', '2026-12-25', '2027-01-15', '2027-01-29'], $this->dates());
        foreach (['2026-11-20', '2026-12-18', '2027-01-15'] as $date) {
            self::assertSame(array_fill_keys([840, 855, 870, 885], $third), $this->links($date), $date);
        }
        foreach (['2026-11-27', '2026-12-25', '2027-01-29'] as $date) {
            self::assertSame(array_fill_keys([960, 975, 990, 1005], $last), $this->links($date), $date);
        }
    }

    public function testLe31NeSePoseQueLesMoisQuiEnOntUnTravaille(): void
    {
        self::mockTime('2026-12-01 08:00:00 Europe/Paris');
        [$id] = $this->repeatWith(0, self::work('09:15', '09:30', 'OPS-12', 'Clôture'), self::monthlyDate(31), '2026-12-31');

        self::mockTime('2027-05-01 08:00:00 Europe/Paris');
        $this->day('2027-05-01');

        // Le 31 janvier 2027 est un dimanche ; février et avril n'en ont pas.
        self::assertSame(['2026-12-31', '2027-03-31'], $this->dates());
        self::assertSame([555 => $id], $this->links('2027-03-31'));
        $sunday = $this->day('2027-01-31');
        self::assertSame([], $sunday['blocks']);
        self::assertTrue($sunday['recurrencesHeld'], 'Un jour non travaillé dit qu\'elle ne s\'y pose pas.');
        self::assertFalse($this->day('2027-04-30')['recurrencesHeld'], 'Un mois sans 31 n\'a rien à dire.');
        self::assertSame('2027-05-01', $this->recurrenceRow($id)['posedThrough']);
    }

    public function testUnJourOublieDansUneSemaineSansFoisNeRecoitRien(): void
    {
        [$id] = $this->repeatWith(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'), self::everyWeeks(2, [1, 2, 3, 4, 5]));

        // DayTrack reste fermé du mercredi 7 au vendredi 16, dans la semaine sans.
        self::mockTime('2026-10-16 08:00:00 Europe/Paris');
        $this->day('2026-10-16');

        self::assertSame([self::TODAY, '2026-10-07', '2026-10-08', '2026-10-09'], $this->dates());
        self::assertSame('2026-10-16', $this->recurrenceRow($id)['posedThrough']);

        self::mockTime('2026-10-20 08:00:00 Europe/Paris');
        $this->day('2026-10-20');
        self::assertSame([self::TODAY, '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-19', '2026-10-20'], $this->dates());
    }

    public function testChangerLeRythmeAvecLesSuivantesGardeCeQuiEstDejaPose(): void
    {
        [$daily] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        self::mockTime('2026-10-08 08:00:00 Europe/Paris');

        // Le jeudi 8, 2e jeudi du mois : le 2e jeudi de chaque mois, à partir de cette fois.
        $day = $this->saveRecurrence(self::intAt($this->day('2026-10-08'), 'version'), [self::work('09:15', '09:30', 'OPS-12', 'Daily')], self::monthlyWeekday(4, 2), $daily, '2026-10-08');
        $monthly = self::stringAt($day, 'untils', 1, 'recurrence');

        self::mockTime('2026-11-13 08:00:00 Europe/Paris');
        $this->day('2026-11-13');

        foreach ([self::TODAY, '2026-10-07'] as $date) {
            self::assertSame([555 => $daily], $this->links($date), $date.' : déjà posé, il le reste.');
        }
        self::assertSame([555 => $monthly], $this->links('2026-10-08'));
        self::assertSame([self::TODAY, '2026-10-07', '2026-10-08', '2026-11-12'], $this->dates());
        self::assertSame([555 => $monthly], $this->links('2026-11-12'));
    }

    public function testLeCalendrierPoseAvantDeLire(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        self::mockTime('2026-10-09 08:00:00 Europe/Paris');

        $this->marks();

        self::assertSame([555 => $id], $this->links('2026-10-08'));
        self::assertSame([self::TODAY, '2026-10-07', '2026-10-08', '2026-10-09'], $this->dates());
    }

    public function testUnEnvoiPartAvecCeQueLaJourneeARecu(): void
    {
        $this->linkJira();
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        self::mockTime('2026-10-07 18:00:00 Europe/Paris');

        // L'onglet du mercredi, ouvert vide la veille, envoie ce qu'il croit vide.
        [$status, $body] = $this->send('POST', '/api/days/2026-10-07/send', ['version' => 0]);
        self::assertSame(409, $status);
        self::assertSame('stale', $body['error']);
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows(self::arrayAt($body, 'day'), [$id => 'daily']));

        [$status, $sent] = $this->send('POST', '/api/days/2026-10-07/send', ['version' => self::intAt($body, 'day', 'version')]);
        self::assertSame(200, $status, (string) json_encode($sent));
        self::assertSame('sent', self::at($sent, 'send', 'state'));
        $worklogs = array_values(array_filter(self::listAt($this->jiraState(), 'worklogs'), static fn (array $worklog): bool => Catalog::ACCOUNT_ID === $worklog['authorId']));
        self::assertCount(1, $worklogs);
        self::assertSame('OPS-12', $worklogs[0]['issueKey']);
        self::assertSame(900, $worklogs[0]['timeSpentSeconds']);
        self::assertSame('2026-10-07T09:15:00.000+0200', $worklogs[0]['started']);
    }

    /**
     * Les jours qui ont une ligne dans la base.
     *
     * @return list<string>
     */
    private function dates(): array
    {
        return array_map(static function (mixed $date): string {
            self::assertIsString($date);

            return $date;
        }, $this->connection()->fetchFirstColumn('SELECT date FROM day ORDER BY date'));
    }

    /**
     * L'objectif d'un jour dans la base, et s'il a été choisi pour lui.
     *
     * @return array{objective: int, chosen: bool}
     */
    private function objectiveRow(string $date): array
    {
        $row = $this->connection()->fetchAssociative('SELECT objective, objective_chosen FROM day WHERE date = ?', [$date]);
        self::assertIsArray($row, 'Journée absente de la base : '.$date);
        self::assertIsInt($row['objective']);

        return ['objective' => $row['objective'], 'chosen' => 1 === $row['objective_chosen']];
    }

    private static function date(string $date): \DateTimeImmutable
    {
        return UserCalendar::date($date) ?? throw new \LogicException($date.' n\'est pas une date.');
    }
}
