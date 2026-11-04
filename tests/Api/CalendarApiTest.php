<?php

namespace App\Tests\Api;

use App\Tests\Support\DayApi;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

/**
 * Les marques du calendrier : « Incomplet » et « Non envoyé », lues jour par jour sans
 * rien écrire, les jours mis à 0h00 qu'il grise, et la plage qu'un appelant peut demander.
 *
 * Aujourd'hui est le mardi 6 octobre 2026 ; le calendrier d'octobre va du lundi 28
 * septembre au dimanche 1er novembre. Chaque test part sans point de départ des jours
 * vides, sauf à le poser : aucun jour vide ne s'y signale.
 */
final class CalendarApiTest extends WebTestCase
{
    use DayApi;

    private const string FROM = '2026-09-28';
    private const string TO = '2026-11-01';

    public function testUnMoisSansSaisieNAAucuneMarqueEtRienNEstEcrit(): void
    {
        self::assertSame([], $this->marks());
        self::assertSame('{"marks":{},"daysOff":[],"workingDays":[1,2,3,4,5]}', $this->browser->getResponse()->getContent(), 'Un objet, même vide.');
        self::assertSame(0, $this->dayRows());
    }

    public function testUnJourPasseSousSonObjectifEstIncomplet(): void
    {
        $this->write(0, [self::work('09:00', '16:00', 'SHOP-482')], '2026-10-02');
        $this->write(0, [self::work('09:00', '16:30', 'SHOP-482')], '2026-10-01');
        $this->write(0, [self::work('09:00', '17:00', 'SHOP-482')], '2026-09-30');

        self::assertSame([
            '2026-09-30' => 'unsent',
            '2026-10-01' => 'unsent',
            '2026-10-02' => 'incomplete',
        ], $this->marks(), '7h00 sur 7h30 manque un quart d\'heure, 7h30 pile l\'atteint.');
    }

    public function testUnePauseNEntrePasDansLeTravailleMaisCommenceLaJournee(): void
    {
        $this->write(0, [self::work('09:00', '12:00', 'SHOP-482'), self::pause('12:00', '17:00')], '2026-10-02');
        $this->write(0, [self::pause('12:00', '13:00')], '2026-10-01');

        self::assertSame([
            '2026-10-01' => 'incomplete',
            '2026-10-02' => 'incomplete',
        ], $this->marks(), 'Une pause seule commence la journée, sans rien à envoyer.');
    }

    public function testAujourdHuiEtLesJoursAVenirNeSontJamaisIncomplets(): void
    {
        $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')]);
        $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')], '2026-10-07');
        $this->write(0, [self::pause('12:00', '13:00')], '2026-10-08');

        self::assertSame([
            '2026-10-06' => 'unsent',
            '2026-10-07' => 'unsent',
        ], $this->marks());
    }

    public function testSansPointDeDepartUnJourVideNAAucuneMarqueMemeAvecSonObjectif(): void
    {
        $this->putObjective(0, 300, '2026-10-02');
        $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')], '2026-10-01');
        $this->write(1, [self::clear('09:00', '10:00')], '2026-10-01');

        self::assertSame([], $this->marks(), 'Rien ne dit d\'où partent les jours vides : aucun ne se signale.');
        self::assertSame(2, $this->dayRows());
    }

    public function testUnJourOublieApresLePointDeDepartEstIncompletSansRienEcrire(): void
    {
        // Le mercredi 30 septembre à 10:00, la version arrive.
        $this->watchEmptyDaysSince('2026-09-30 10:00:00 Europe/Paris');

        self::assertSame([
            '2026-10-01' => 'incomplete',
            '2026-10-02' => 'incomplete',
            '2026-10-05' => 'incomplete',
        ], $this->marks(), 'Ni les jours d\'avant, ni celui du point de départ, ni le week-end, ni aujourd\'hui, ni ceux à venir.');
        self::assertSame([], $this->daysOff());
        foreach (['day', 'slot', 'day_send', 'settings'] as $table) {
            self::assertSame(0, $this->rowsIn($table), 'Parcourir des jours n\'écrit rien : '.$table);
        }
        self::assertSame('2026-09-30 08:00:00', $this->connection()->fetchOne('SELECT since FROM empty_day_watch'), 'Ni ne déplace le point de départ.');
    }

    public function testUnJourVideDAvantLePointDeDepartResteSansMarqueMemeAvecSonObjectif(): void
    {
        $this->putObjective(0, 300, '2026-10-01');
        $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')], '2026-09-30');
        $this->write(1, [self::clear('09:00', '10:00')], '2026-09-30');
        $this->watchEmptyDaysSince('2026-10-02 08:00:00 Europe/Paris');

        self::assertSame(['2026-10-05' => 'incomplete'], $this->marks(), 'Le 2, jour du point de départ, et ceux d\'avant ne se signalent pas.');
    }

    public function testUnJourCommenceAvantLePointDeDepartResteIncomplet(): void
    {
        $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')], '2026-09-29');
        $this->watchEmptyDaysSince('2026-10-02 08:00:00 Europe/Paris');

        self::assertSame(['2026-09-29' => 'incomplete', '2026-10-05' => 'incomplete'], $this->marks());
    }

    public function testLePointDeDepartSeLitDansLeFuseauDeLUtilisateur(): void
    {
        // 22:30 en heure universelle le 30 septembre : il est 00:30 le 1er octobre à Paris.
        $this->watchEmptyDaysSince('2026-09-30 22:30:00 UTC');
        self::assertSame(['2026-10-02' => 'incomplete', '2026-10-05' => 'incomplete'], $this->marks());

        // 21:30 : encore 23:30 le 30 septembre à Paris.
        $this->watchEmptyDaysSince('2026-09-30 21:30:00 UTC');
        self::assertSame([
            '2026-10-01' => 'incomplete',
            '2026-10-02' => 'incomplete',
            '2026-10-05' => 'incomplete',
        ], $this->marks());
    }

    public function testAMinuitAParisUnJourVideDevientIncomplet(): void
    {
        $this->watchEmptyDaysSince('2026-10-05 10:00:00 Europe/Paris');
        self::assertSame([], $this->marks());

        // 22:10 en heure universelle le 6 : il est 00:10 le 7 à Paris.
        self::mockTime('2026-10-06 22:10:00 UTC');
        self::assertSame(['2026-10-06' => 'incomplete'], $this->marks());

        self::mockTime('2026-10-06 21:50:00 UTC');
        self::assertSame([], $this->marks(), 'À 23:50 à Paris, c\'est encore aujourd\'hui.');
    }

    public function testUnJourMisAZeroEstGriseEtSansMarque(): void
    {
        $this->watchEmptyDaysSince('2026-09-30 10:00:00 Europe/Paris');
        [$status, $day] = $this->putObjective(0, 0, '2026-10-02');
        self::assertSame(200, $status);
        self::assertTrue($day['declaredOff']);
        self::assertTrue($day['working'], 'Les réglages le travaillent toujours.');

        self::assertSame(['2026-10-01' => 'incomplete', '2026-10-05' => 'incomplete'], $this->marks());
        self::assertSame(['2026-10-02'], $this->daysOff());
    }

    public function testUnJourMisAZeroSaisiQuandMemeGardeSonObjectifEtNEstJamaisIncomplet(): void
    {
        $this->watchEmptyDaysSince('2026-09-30 10:00:00 Europe/Paris');
        $this->putObjective(0, 0, '2026-10-02');

        $day = $this->write(1, [self::work('09:00', '10:00', 'SHOP-482')], '2026-10-02');
        self::assertSame(0, $day['objective'], '« Saisir quand même » laisse l\'objectif à 0h00.');
        self::assertTrue($day['declaredOff']);
        self::assertSame(['worked' => 60, 'remaining' => 0, 'balance' => 60, 'projectedEnd' => null], $day['figures'], 'Ses heures comptent en plus.');
        self::assertSame('unsent', $this->marks()['2026-10-02'] ?? null, 'Il s\'envoie comme les autres.');
        self::assertSame(['2026-10-02'], $this->daysOff(), 'Saisi, il reste grisé, comme un samedi saisi.');

        $this->write(2, [self::pause('09:00', '10:00')], '2026-10-02');
        self::assertArrayNotHasKey('2026-10-02', $this->marks(), 'Une pause seule n\'en fait pas un jour incomplet.');

        // Vidé, il redevient un jour de congé sans marque.
        $this->write(3, [self::clear('09:00', '10:00')], '2026-10-02');
        self::assertArrayNotHasKey('2026-10-02', $this->marks());
        self::assertSame(['2026-10-02'], $this->daysOff());
        self::assertTrue($this->day('2026-10-02')['declaredOff']);
    }

    public function testRevenirALObjectifHabituelDefaitLeConge(): void
    {
        $this->watchEmptyDaysSince('2026-09-30 10:00:00 Europe/Paris');
        $this->putObjective(0, 0, '2026-10-02');

        [$status, $day] = $this->putObjective(1, 450, '2026-10-02');
        self::assertSame(200, $status);
        self::assertFalse($day['declaredOff']);
        self::assertSame(450, $day['objective']);
        self::assertSame('incomplete', $this->marks()['2026-10-02'] ?? null);
        self::assertSame([], $this->daysOff());
    }

    public function testUnObjectifHabituelAZeroNeGriseNiNeSignaleAucunJour(): void
    {
        $this->watchEmptyDaysSince('2026-09-30 10:00:00 Europe/Paris');
        [$status] = $this->send('PUT', '/api/settings/habitual-objective', ['objective' => 0]);
        self::assertSame(200, $status);
        $this->write(0, [self::pause('12:00', '13:00')], '2026-10-01');

        self::assertSame([], $this->marks(), 'Aucun jour n\'est sous un objectif de 0h00.');
        self::assertSame([], $this->daysOff(), 'Aucun n\'a été déclaré.');
        self::assertFalse($this->day('2026-10-02')['declaredOff']);
        self::assertFalse($this->day('2026-10-01')['declaredOff']);
    }

    public function testUnOngletResteOuvertNeSaisitRienSurUnJourMisAZeroAilleurs(): void
    {
        $this->watchEmptyDaysSince('2026-09-30 10:00:00 Europe/Paris');
        self::assertSame(0, $this->day('2026-10-02')['version'], 'L\'onglet resté ouvert l\'a lu vide.');

        // Un autre onglet le met à 0h00.
        $this->putObjective(0, 0, '2026-10-02');

        // L'onglet resté ouvert y glisse un ticket, puis remet l'objectif : rien ne passe.
        [$status, $body] = $this->patchSlots(0, [self::work('09:00', '10:00', 'SHOP-482')], '2026-10-02');
        self::assertSame(409, $status);
        self::assertTrue(self::at($body, 'day', 'declaredOff'), 'La réponse rend le jour tel qu\'il est.');
        [$status] = $this->putObjective(0, 450, '2026-10-02');
        self::assertSame(409, $status);

        self::assertSame([], $this->rows('2026-10-02'));
        self::assertSame(0, $this->day('2026-10-02')['objective']);
        self::assertArrayNotHasKey('2026-10-02', $this->marks());
        self::assertSame(['2026-10-02'], $this->daysOff());
    }

    public function testUnObjectifAZeroNEstJamaisManque(): void
    {
        $this->putObjective(0, 0, '2026-10-02');
        $this->write(1, [self::pause('12:00', '13:00')], '2026-10-02');

        self::assertSame([], $this->marks());
    }

    public function testUnJourNonTravailleNEstJamaisIncomplet(): void
    {
        $this->write(0, [self::work('09:00', '10:00', 'OPS-7')], '2026-10-03');
        $this->write(0, [self::pause('09:00', '10:00')], '2026-10-04');

        self::assertSame(['2026-10-03' => 'unsent'], $this->marks());
    }

    public function testCocherLeSamediVautPourLesAnciensSamedis(): void
    {
        $this->write(0, [self::work('09:00', '10:00', 'OPS-7')], '2026-10-03');
        $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')], '2026-10-02');

        [$status] = $this->send('PUT', '/api/settings/working-days/6', ['worked' => true]);
        self::assertSame(200, $status);
        [$status] = $this->send('PUT', '/api/settings/working-days/5', ['worked' => false]);
        self::assertSame(200, $status);

        self::assertSame([
            '2026-10-02' => 'unsent',
            '2026-10-03' => 'incomplete',
        ], $this->marks());
        self::assertSame([1, 2, 3, 4, 6], $this->lastJson()['workingDays'] ?? null, 'Le calendrier grise d\'après les mêmes réglages.');
    }

    public function testUnJourGardeLObjectifQuIlAvaitASaPremiereSaisie(): void
    {
        $this->write(0, [self::work('09:00', '15:00', 'SHOP-482')], '2026-10-02');
        [$status] = $this->send('PUT', '/api/settings/habitual-objective', ['objective' => 360]);
        self::assertSame(200, $status);

        self::assertSame(['2026-10-02' => 'incomplete'], $this->marks(), 'Changer l\'habituel ne touche pas une journée déjà saisie.');
    }

    public function testLaPlageVaDuPremierAuDernierJourCompris(): void
    {
        foreach (['2026-09-27', '2026-09-28', '2026-11-01', '2026-11-02'] as $date) {
            $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')], $date);
        }

        self::assertSame(['2026-09-28' => 'incomplete', '2026-11-01' => 'unsent'], $this->marks());
        self::assertSame(['2026-09-27' => 'unsent'], $this->marks('2026-09-27', '2026-09-27'), 'Un dimanche n\'est jamais incomplet.');
    }

    public function testAMinuitAParisLaVeilleDevientPassee(): void
    {
        $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')]);
        self::assertSame(['2026-10-06' => 'unsent'], $this->marks());

        // 22:10 en heure universelle le 6 : il est 00:10 le 7 à Paris.
        self::mockTime('2026-10-06 22:10:00 UTC');
        self::assertSame(['2026-10-06' => 'incomplete'], $this->marks());

        self::mockTime('2026-10-06 21:50:00 UTC');
        self::assertSame(['2026-10-06' => 'unsent'], $this->marks(), 'À 23:50 à Paris, c\'est encore aujourd\'hui.');
    }

    public function testUnePlageImpossibleOuTropLongueNExistePas(): void
    {
        foreach ([
            ['2026-10-02', '2026-10-01'],
            ['2026-09-28', '2026-11-09'],
            ['2026-02-30', '2026-03-01'],
            ['2026-10-01', '2026-13-01'],
            ['2026-10-1', '2026-10-31'],
            ['0000-00-00', '2026-10-31'],
        ] as [$from, $to]) {
            $this->browser->request('GET', '/api/calendar/'.$from.'/'.$to);
            self::assertResponseStatusCodeSame(404, $from.' '.$to);
        }

        self::assertSame([], $this->marks('2026-09-28', '2026-11-08'), 'Six semaines passent.');
    }

    public function testLeCalendrierNeSEcritPas(): void
    {
        [$status] = $this->send('POST', '/api/calendar/'.self::FROM.'/'.self::TO, []);
        self::assertSame(405, $status);
    }

    /**
     * @return array<mixed>
     */
    private function lastJson(): array
    {
        $json = json_decode((string) $this->browser->getResponse()->getContent(), true, flags: \JSON_THROW_ON_ERROR);
        self::assertIsArray($json);

        return $json;
    }

    /**
     * @return array<mixed>
     */
    private function marks(string $from = self::FROM, string $to = self::TO): array
    {
        return self::arrayAt($this->calendar($from, $to), 'marks');
    }

    /**
     * @return array<mixed>
     */
    private function daysOff(string $from = self::FROM, string $to = self::TO): array
    {
        return self::arrayAt($this->calendar($from, $to), 'daysOff');
    }

    /**
     * @return array<mixed>
     */
    private function calendar(string $from, string $to): array
    {
        $this->browser->request('GET', '/api/calendar/'.$from.'/'.$to);
        self::assertResponseIsSuccessful();
        $calendar = json_decode((string) $this->browser->getResponse()->getContent(), true, flags: \JSON_THROW_ON_ERROR);
        self::assertIsArray($calendar);
        self::assertSame(['marks', 'daysOff', 'workingDays'], array_keys($calendar));

        return $calendar;
    }

    private function rowsIn(string $table): int
    {
        $count = $this->connection()->fetchOne('SELECT COUNT(*) FROM '.$table);
        self::assertIsNumeric($count);

        return (int) $count;
    }
}
