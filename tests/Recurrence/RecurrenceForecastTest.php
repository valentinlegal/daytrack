<?php

namespace App\Tests\Recurrence;

use App\Day\SlotContent;
use App\Day\UserCalendar;
use App\Dev\Jira\Catalog;
use App\Entity\DaySend;
use App\Recurrence\RecurrenceClash;
use App\Recurrence\Rhythm;
use App\Repository\DayRepository;
use App\Repository\DaySendRepository;
use App\Repository\JiraConnectionRepository;
use App\Repository\RecurrenceRepository;
use App\Sending\Worklog;
use App\Tests\Support\DayApi;
use App\Tests\Support\JiraApi;
use App\Tests\Support\RecurrenceApi;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

/**
 * Les jours à venir montrent déjà leurs récurrences, comptées dans les chiffres, sans
 * qu'elles soient écrites : elles ne le sont qu'au jour venu, à l'envoi, ou quand un geste
 * les touche. Un jour mis à 0h00 après coup perd celles qui s'y étaient posées, et les
 * retrouve en revenant à un objectif.
 *
 * Elles naissent le mardi 6 octobre 2026 à 15:20, à Paris.
 */
final class RecurrenceForecastTest extends WebTestCase
{
    use DayApi;
    use JiraApi;
    use RecurrenceApi;

    private const string THURSDAY = '2026-10-08';

    public function testUnJourAVenirMontreSesRecurrencesSansRienEcrire(): void
    {
        [$daily] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        [$lunch, $today] = $this->repeat(1, self::pause('12:30', '13:30'));
        $rows = $this->dayRows();

        $thursday = $this->day(self::THURSDAY);

        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily', '12:30-13:30 pause ↻déjeuner'], self::arrows($thursday, [$daily => 'daily', $lunch => 'déjeuner']));
        self::assertSame(['worked' => 15, 'remaining' => 435, 'balance' => -435, 'projectedEnd' => null], self::arrayAt($thursday, 'figures'), 'Comptées dans les chiffres, la pause hors du travaillé.');
        self::assertSame('unsent', self::at($thursday, 'send', 'state'), 'Le bouton Jira propose de l\'envoyer.');
        self::assertSame([$daily, $lunch], array_keys(self::arrayAt($thursday, 'recurrences')), 'Leur rythme, pour la flèche et la fenêtre.');
        self::assertNotSame(0, $thursday['version'], 'Sa version dit ce qu\'il prévoit.');
        self::assertSame($thursday['version'], $this->day(self::THURSDAY)['version'], 'Relu sans changement, il garde sa version.');

        self::assertSame($rows, $this->dayRows(), 'Aucune ligne ne naît d\'une lecture.');
        self::assertSame([], $this->links(self::THURSDAY));
        self::assertSame([], $this->skips());
        self::assertArrayNotHasKey(self::THURSDAY, $this->marks(), 'Ses seules fois prévues ne le marquent pas au calendrier.');
        self::assertSame($rows, $this->dayRows(), 'Le calendrier n\'écrit rien non plus.');

        // Aujourd'hui, déjà posées, elles ne se prévoient pas une seconde fois.
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily', '12:30-13:30 pause ↻déjeuner'], self::arrows($this->day(), [$daily => 'daily', $lunch => 'déjeuner']));
        self::assertSame($today['version'], $this->day()['version']);
    }

    public function testUneFoisPrevueCedeAuxSaisiesEtNeTombeQueLesJoursTravailles(): void
    {
        // Saisis avant elle : ce qui est saisi l'emporte, quart d'heure par quart d'heure.
        $this->write(0, [self::work('09:30', '09:45', 'SHOP-482')], self::THURSDAY);
        [$daily] = $this->repeat(0, self::work('09:15', '10:00', 'OPS-12', 'Daily'), [1, 2, 3, 4, 5], '2026-10-15');
        $names = [$daily => 'daily'];

        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily', '09:30-09:45 SHOP-482', '09:45-10:00 OPS-12 « Daily » ↻daily'], self::arrows($this->day(self::THURSDAY), $names));
        self::assertSame(45, self::at($this->day(self::THURSDAY), 'figures', 'worked'));
        self::assertSame([], self::listAt($this->day('2026-10-10'), 'blocks'), 'Le samedi n\'est pas travaillé.');
        self::assertSame([], self::listAt($this->day('2026-10-16'), 'blocks'), 'Après sa fin, rien.');
        self::assertSame(['09:15-10:00 OPS-12 « Daily » ↻daily'], self::arrows($this->day('2026-10-15'), $names), 'Le jour de sa fin, encore.');
        self::assertSame([], self::listAt($this->day('2026-10-05'), 'blocks'), 'Avant son premier jour, rien.');

        // Un jour décoché des réglages ne prévoit plus rien.
        $this->setWorkingDay(5, false);
        self::assertSame([], self::listAt($this->day('2026-10-09'), 'blocks'));
        self::assertTrue(self::at($this->day('2026-10-09'), 'recurrencesHeld'));
    }

    public function testUnGesteSurUneFoisPrevueLaPoseDetacheeEtAnnulerLaRendALaPrevision(): void
    {
        [$daily] = $this->repeat(0, self::work('09:00', '10:00', 'OPS-12', 'Daily'));
        $names = [$daily => 'daily'];
        $thursday = $this->day(self::THURSDAY);

        // Un ticket posé par-dessus son deuxième quart d'heure.
        $after = $this->write(self::intAt($thursday, 'version'), [self::work('09:15', '09:30', 'SHOP-482')], self::THURSDAY);

        self::assertSame(['09:00-09:15 OPS-12 « Daily »', '09:15-09:30 SHOP-482', '09:30-10:00 OPS-12 « Daily »'], self::arrows($after, $names), 'Posée pour de bon, sans sa flèche.');
        self::assertSame([540 => null, 555 => null, 570 => null, 585 => null], $this->links(self::THURSDAY));
        self::assertSame([$daily.' '.self::THURSDAY], $this->skips());
        self::assertSame(['09:00-10:00 OPS-12 « Daily » ↻daily'], self::arrows($this->day('2026-10-09'), $names), 'Les autres jours la prévoient toujours.');

        // Annuler : chaque quart d'heure rendu à la récurrence, comme le fait l'historique.
        $undone = $this->write(self::intAt($after, 'version'), [self::linked(self::work('09:00', '10:00', 'OPS-12', 'Daily'), $daily)], self::THURSDAY);

        self::assertSame(['09:00-10:00 OPS-12 « Daily » ↻daily'], self::arrows($undone, $names));
        self::assertSame([], $this->links(self::THURSDAY), 'Rendue à la prévision, elle n\'est plus écrite.');
        self::assertSame([], $this->skips());
        self::assertSame(60, self::at($undone, 'figures', 'worked'));

        // Rétablir.
        $redone = $this->write(self::intAt($undone, 'version'), [
            self::work('09:00', '09:15', 'OPS-12', 'Daily'),
            self::work('09:15', '09:30', 'SHOP-482'),
            self::work('09:30', '10:00', 'OPS-12', 'Daily'),
        ], self::THURSDAY);
        self::assertSame(['09:00-09:15 OPS-12 « Daily »', '09:15-09:30 SHOP-482', '09:30-10:00 OPS-12 « Daily »'], self::arrows($redone, $names));
        self::assertSame([$daily.' '.self::THURSDAY], $this->skips());
    }

    public function testAnnulerRendLaPlaceQuUneAutreFoisPrevueAvaitPrise(): void
    {
        // Deux récurrences qui se chevauchent : la première l'emporte, la seconde se montre
        // sur ce qu'elle laisse libre. La fenêtre refuse la seconde ; écrite en base, comme
        // avant que le serveur refuse un créneau pris, elle reste possible.
        [$daily] = $this->repeat(0, self::work('09:00', '10:00', 'OPS-12', 'Daily'));
        [$status] = $this->putRecurrence(1, [self::work('09:30', '10:30', 'OPS-7')], self::weekly());
        self::assertSame(422, $status);
        $support = $this->storeRecurrence(SlotContent::work('OPS-7', null), '09:30', '10:30', Rhythm::weekly([1, 2, 3, 4, 5]), self::TODAY);
        $names = [$daily => 'daily', $support => 'support'];
        $thursday = $this->day(self::THURSDAY);
        self::assertSame(['09:00-10:00 OPS-12 « Daily » ↻daily', '10:00-10:30 OPS-7 ↻support'], self::arrows($thursday, $names));

        // Le Daily effacé : le support se montre sur toute sa plage.
        $erased = $this->write(self::intAt($thursday, 'version'), [self::clear('09:00', '10:00')], self::THURSDAY);
        self::assertSame(['09:30-10:30 OPS-7 ↻support'], self::arrows($erased, $names));

        // Annuler rend le Daily, et le support ne se détache pas pour autant.
        [$status, $undone] = $this->send('PATCH', '/api/days/'.self::THURSDAY.'/slots', [
            'version' => self::intAt($erased, 'version'),
            'changes' => [self::linked(self::work('09:00', '10:00', 'OPS-12', 'Daily'), $daily)],
            'restores' => true,
        ]);
        self::assertSame(200, $status, json_encode($undone, \JSON_THROW_ON_ERROR));
        self::assertSame(self::arrows($thursday, $names), self::arrows($undone, $names), 'La journée de départ, exactement.');
        self::assertSame([], $this->links(self::THURSDAY));
        self::assertSame([], array_values(array_filter($this->skips(), static fn (string $skip): bool => str_ends_with($skip, self::THURSDAY))), 'Rien n\'est détaché le jeudi.');
    }

    public function testRetablirUnEffacementSousUneRecurrencePlusRecenteLeRefait(): void
    {
        // La plus ancienne l'emporte au milieu ; la plus récente, plus large, se montre autour.
        // Écrite en base : la fenêtre la refuserait, le créneau du Daily étant pris.
        [$daily] = $this->repeat(0, self::work('09:30', '10:00', 'OPS-12', 'Daily'));
        $support = $this->storeRecurrence(SlotContent::work('OPS-7', null), '09:00', '10:30', Rhythm::weekly([1, 2, 3, 4, 5]), self::TODAY);
        $names = [$daily => 'daily', $support => 'support'];
        $thursday = $this->day(self::THURSDAY);
        self::assertSame(['09:00-09:30 OPS-7 ↻support', '09:30-10:00 OPS-12 « Daily » ↻daily', '10:00-10:30 OPS-7 ↻support'], self::arrows($thursday, $names));

        $erased = $this->write(self::intAt($thursday, 'version'), [self::clear('09:30', '10:00')], self::THURSDAY);
        self::assertSame(['09:00-10:30 OPS-7 ↻support'], self::arrows($erased, $names));
        [$status, $undone] = $this->send('PATCH', '/api/days/'.self::THURSDAY.'/slots', [
            'version' => self::intAt($erased, 'version'),
            'changes' => [self::linked(self::work('09:30', '10:00', 'OPS-12', 'Daily'), $daily)],
            'restores' => true,
        ]);
        self::assertSame(200, $status, json_encode($undone, \JSON_THROW_ON_ERROR));
        self::assertSame(self::arrows($thursday, $names), self::arrows($undone, $names));

        // Rétablir, comme la page : le quart d'heure rendu à la plus récente, qui ne passe pas
        // avant le Daily ; le Daily se détache de nouveau.
        $redone = $this->write(self::intAt($undone, 'version'), [self::linked(self::work('09:30', '10:00', 'OPS-7'), $support)], self::THURSDAY);
        self::assertSame(['09:00-10:30 OPS-7 ↻support'], self::arrows($redone, $names));
        self::assertSame([], $this->links(self::THURSDAY));
        self::assertSame([$daily.' '.self::THURSDAY], array_values(array_filter($this->skips(), static fn (string $skip): bool => str_ends_with($skip, self::THURSDAY))));
    }

    public function testAnnulerUnEffacementRendLaSaisieQuUneFoisPrevueAvaitCedee(): void
    {
        // Saisi avant que la récurrence naisse : elle lui cède son quart d'heure.
        $this->write(0, [self::work('09:30', '09:45', 'SHOP-482')], self::THURSDAY);
        [$daily] = $this->repeat(0, self::work('09:00', '10:00', 'OPS-12', 'Daily'));
        $names = [$daily => 'daily'];
        $thursday = $this->day(self::THURSDAY);
        $before = self::arrows($thursday, $names);
        self::assertSame(['09:00-09:30 OPS-12 « Daily » ↻daily', '09:30-09:45 SHOP-482', '09:45-10:00 OPS-12 « Daily » ↻daily'], $before);

        $erased = $this->write(self::intAt($thursday, 'version'), [self::clear('09:30', '09:45')], self::THURSDAY);
        self::assertSame(['09:00-10:00 OPS-12 « Daily » ↻daily'], self::arrows($erased, $names), 'Effacée, la saisie laisse la place au Daily.');

        [$status, $undone] = $this->send('PATCH', '/api/days/'.self::THURSDAY.'/slots', [
            'version' => self::intAt($erased, 'version'),
            'changes' => [self::work('09:30', '09:45', 'SHOP-482')],
            'restores' => true,
        ]);
        self::assertSame(200, $status, json_encode($undone, \JSON_THROW_ON_ERROR));
        self::assertSame($before, self::arrows($undone, $names), 'Le Daily garde sa flèche, et cède de nouveau.');
        self::assertSame([], $this->skips());
        self::assertSame([570 => null], $this->links(self::THURSDAY));

        // Le même ticket tapé par-dessus, sans annuler : un geste qui touche la fois prévue la détache.
        $erased = $this->write(self::intAt($undone, 'version'), [self::clear('09:30', '09:45')], self::THURSDAY);
        $typed = $this->write(self::intAt($erased, 'version'), [self::work('09:30', '09:45', 'SHOP-482')], self::THURSDAY);
        self::assertSame(['09:00-09:30 OPS-12 « Daily »', '09:30-09:45 SHOP-482', '09:45-10:00 OPS-12 « Daily »'], self::arrows($typed, $names));
        self::assertSame([$daily.' '.self::THURSDAY], $this->skips());
    }

    public function testUneFoisPoseeParLEnvoiNeReprendPasLaPlaceDUneSaisieEffacee(): void
    {
        $this->linkJira();
        $this->write(0, [self::work('09:30', '09:45', 'SHOP-482')], self::THURSDAY);
        [$support] = $this->repeat(0, self::work('09:00', '10:00', 'OPS-7'));
        $names = [$support => 'support'];
        // L'envoi pose la fois autour de la saisie, pour de bon : la saisie effacée ensuite
        // laisse un trou, comme un jour venu.
        [, $sent] = $this->send('POST', '/api/days/'.self::THURSDAY.'/send', ['version' => self::intAt($this->day(self::THURSDAY), 'version')]);
        self::assertSame([540 => $support, 555 => $support, 570 => null, 585 => $support], $this->links(self::THURSDAY));
        $freed = $this->write(self::intAt($sent, 'version'), [self::clear('09:30', '09:45')], self::THURSDAY);
        self::assertSame(['09:00-09:30 OPS-7 ↻support', '09:45-10:00 OPS-7 ↻support'], self::arrows($freed, $names));
        self::assertSame(45, self::at($freed, 'figures', 'worked'));
        self::assertSame([540 => $support, 555 => $support, 585 => $support], $this->links(self::THURSDAY));

        // Un quart d'heure effacé détache toute la fois.
        $day = $this->write(self::intAt($freed, 'version'), [self::clear('09:45', '10:00')], self::THURSDAY);
        self::assertSame(['09:00-09:30 OPS-7'], self::arrows($day, $names));
        self::assertSame([540 => null, 555 => null], $this->links(self::THURSDAY));
        self::assertSame([$support.' '.self::THURSDAY], $this->skips());

        // Annuler la rend, posée là où elle l'était.
        $undone = $this->write(self::intAt($day, 'version'), [self::linked(self::work('09:00', '09:30', 'OPS-7'), $support), self::linked(self::work('09:45', '10:00', 'OPS-7'), $support)], self::THURSDAY);
        self::assertSame(['09:00-09:30 OPS-7 ↻support', '09:45-10:00 OPS-7 ↻support'], self::arrows($undone, $names));
        self::assertSame([540 => $support, 555 => $support, 585 => $support], $this->links(self::THURSDAY));
        self::assertSame([], $this->skips());
        self::assertSame('modified', self::at($undone, 'send', 'state'), 'La saisie effacée manque toujours.');
    }

    public function testAnnulerSeDitParUnBooleenEtRienDAutre(): void
    {
        [$daily] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        $version = self::intAt($this->day(self::THURSDAY), 'version');

        foreach (['oui', 1, 0, null, [true]] as $restores) {
            [$status, $body] = $this->send('PATCH', '/api/days/'.self::THURSDAY.'/slots', [
                'version' => $version,
                'changes' => [self::work('14:00', '14:15', 'SHOP-482')],
                'restores' => $restores,
            ]);
            self::assertSame(422, $status, json_encode($restores, \JSON_THROW_ON_ERROR));
            self::assertStringContainsString('restores', json_encode($body, \JSON_THROW_ON_ERROR));
        }
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($this->day(self::THURSDAY), [$daily => 'daily']), 'Rien n\'est écrit.');
        self::assertSame([], $this->links(self::THURSDAY));
    }

    public function testUnAppelantQuiNeNommeQuUnQuartDHeureDetacheQuandMemeLaFoisEntiere(): void
    {
        [$daily] = $this->repeat(0, self::work('09:00', '10:00', 'OPS-12', 'Daily'));

        // Sans les autres quarts d'heure de la fois, que le navigateur nomme d'ordinaire.
        $day = $this->write(self::intAt($this->day(self::THURSDAY), 'version'), [self::clear('09:30', '09:45')], self::THURSDAY);

        self::assertSame(['09:00-09:30 OPS-12 « Daily »', '09:45-10:00 OPS-12 « Daily »'], self::arrows($day, [$daily => 'daily']));
        self::assertSame([540 => null, 555 => null, 585 => null], $this->links(self::THURSDAY));
        self::assertSame([$daily.' '.self::THURSDAY], $this->skips());
    }

    public function testEffacerUneFoisPrevueEntiereNeCreePasLaJournee(): void
    {
        [$daily] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        $rows = $this->dayRows();

        $day = $this->write(self::intAt($this->day(self::THURSDAY), 'version'), [self::clear('09:15', '09:30')], self::THURSDAY);

        self::assertSame([], self::listAt($day, 'blocks'));
        self::assertSame(0, $day['version'], 'Rien n\'y est saisi : la journée n\'existe toujours pas.');
        self::assertSame($rows, $this->dayRows());
        self::assertSame([$daily.' '.self::THURSDAY], $this->skips());

        $undone = $this->write(0, [self::linked(self::work('09:15', '09:30', 'OPS-12', 'Daily'), $daily)], self::THURSDAY);
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($undone, [$daily => 'daily']));
        self::assertSame($rows, $this->dayRows(), 'Rendue à la prévision, elle ne crée pas la journée non plus.');
        self::assertSame([], $this->skips());
    }

    public function testUnJourDejaTraiteGardeLaFoisRendueParAnnuler(): void
    {
        // Née d'un bloc d'un jeudi à venir : ce jeudi est déjà traité, sa fois y est écrite.
        [$daily, $thursday] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'), date: self::THURSDAY);
        self::assertSame([555 => $daily], $this->links(self::THURSDAY));

        $erased = $this->write(self::intAt($thursday, 'version'), [self::clear('09:15', '09:30')], self::THURSDAY);
        self::assertSame([], self::listAt($erased, 'blocks'));
        $undone = $this->write(self::intAt($erased, 'version'), [self::linked(self::work('09:15', '09:30', 'OPS-12', 'Daily'), $daily)], self::THURSDAY);

        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($undone, [$daily => 'daily']));
        self::assertSame([555 => $daily], $this->links(self::THURSDAY), 'Rien ne la prévoit ce jour-là : elle est écrite.');
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($this->day('2026-10-09'), [$daily => 'daily']), 'Le lendemain la prévoit.');
    }

    public function testLaFenetreDUneFoisPrevueLaGardePrevueSiRienNeChange(): void
    {
        [$daily] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        $thursday = $this->day(self::THURSDAY);

        // « Jusqu'au » réglé depuis le jeudi, la case cochée, rien d'autre.
        $day = $this->saveRecurrence(self::intAt($thursday, 'version'), [self::work('09:15', '09:30', 'OPS-12', 'Daily')], self::weekly([1, 2, 3, 4, 5], '2026-10-09'), $daily, self::THURSDAY);

        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($day, [$daily => 'daily']));
        self::assertSame([], $this->links(self::THURSDAY), 'Toujours prévue, pas écrite.');
        self::assertSame('2026-10-09', $this->recurrenceRow($daily)['until']);
        self::assertSame([], self::listAt($this->day('2026-10-12'), 'blocks'));

        // Décochée depuis le jeudi : elle s'arrête la veille, et le bloc du jeudi reste, écrit, sans flèche.
        $day = $this->saveRecurrence(self::intAt($day, 'version'), [self::work('09:15', '09:30', 'OPS-12', 'Daily')], null, $daily, self::THURSDAY);
        self::assertSame(['09:15-09:30 OPS-12 « Daily »'], self::arrows($day));
        self::assertSame([555 => null], $this->links(self::THURSDAY));
        self::assertSame('2026-10-07', $this->recurrenceRow($daily)['until']);
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($this->day('2026-10-07'), [$daily => 'daily']), 'Le mercredi la prévoit encore.');
    }

    public function testUnOngletEnRetardSurUnJourAVenirRecoitLeRefus(): void
    {
        [$daily, $today] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        $seen = self::intAt($this->day(self::THURSDAY), 'version');

        // Un autre onglet touche la fois prévue du jeudi : elle s'y pose.
        $this->write($seen, [self::work('09:15', '09:30', 'SHOP-482')], self::THURSDAY);
        [$status, $body] = $this->patchSlots($seen, [self::work('14:00', '14:15', 'OPS-7')], self::THURSDAY);
        self::assertSame(409, $status);
        self::assertSame(['09:15-09:30 SHOP-482'], self::blocks(self::arrayAt($body, 'day')));

        // Un autre onglet arrête la récurrence depuis aujourd'hui : le vendredi ne la prévoit
        // plus, sans que la journée du vendredi ait changé.
        $friday = $this->day('2026-10-09');
        $this->saveRecurrence(self::intAt($today, 'version'), [self::work('09:15', '09:30', 'OPS-12', 'Daily')], self::weekly([1, 2, 3, 4, 5], self::TODAY), $daily);
        foreach ([
            $this->patchSlots(self::intAt($friday, 'version'), [self::work('14:00', '14:15', 'OPS-7')], '2026-10-09'),
            $this->putObjective(self::intAt($friday, 'version'), 300, '2026-10-09'),
            $this->putRecurrence(self::intAt($friday, 'version'), [self::work('16:00', '16:15', 'OPS-7')], self::weekly(), null, '2026-10-09'),
        ] as [$status, $body]) {
            self::assertSame(409, $status);
            self::assertSame([], self::listAt(self::arrayAt($body, 'day'), 'blocks'), 'La journée relue ne la prévoit plus.');
        }
        self::assertSame(0, self::at($this->day('2026-10-09'), 'version'));
    }

    public function testAMinuitLeJourAVenirDevientLeJourVenu(): void
    {
        [$daily] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        $wednesday = $this->day('2026-10-07');

        self::mockTime('2026-10-07 00:00:05 Europe/Paris');
        // L'onglet resté ouvert sur le mercredi l'a vu prévu : posée, la journée a changé.
        [$status, $body] = $this->patchSlots(self::intAt($wednesday, 'version'), [self::work('14:00', '14:15', 'OPS-7')], '2026-10-07');
        self::assertSame(409, $status);
        $day = self::arrayAt($body, 'day');
        self::assertSame(self::arrows($wednesday, [$daily => 'daily']), self::arrows($day, [$daily => 'daily']), 'Le même bloc, désormais écrit.');
        self::assertSame(1, $day['version']);
        self::assertSame([555 => $daily], $this->links('2026-10-07'));
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($this->day('2026-10-08'), [$daily => 'daily']), 'Le jeudi la prévoit toujours.');
        self::assertSame([], $this->links('2026-10-08'));
    }

    public function testEnvoyerUnJourAVenirEnvoieAussiSesRecurrences(): void
    {
        $this->linkJira();
        [$daily] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        $thursday = $this->write(self::intAt($this->day(self::THURSDAY), 'version'), [self::work('14:00', '15:00', 'SHOP-482')], self::THURSDAY);
        self::assertSame([840 => null, 855 => null, 870 => null, 885 => null], $this->links(self::THURSDAY));

        [$status, $sent] = $this->send('POST', '/api/days/'.self::THURSDAY.'/send', ['version' => self::intAt($thursday, 'version')]);

        self::assertSame(200, $status, json_encode($sent, \JSON_THROW_ON_ERROR));
        self::assertSame('sent', self::at($sent, 'send', 'state'));
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily', '14:00-15:00 SHOP-482'], self::arrows($sent, [$daily => 'daily']));
        self::assertSame([555 => $daily, 840 => null, 855 => null, 870 => null, 885 => null], $this->links(self::THURSDAY), 'Posée pour de bon, avec sa flèche.');
        self::assertSame(['OPS-12 2026-10-08 900', 'SHOP-482 2026-10-08 3600'], $this->worklogs());
        self::assertSame('sent', self::at($this->marks(), self::THURSDAY));

        // Le jour venu, rien ne se pose deux fois.
        self::mockTime('2026-10-08 08:00:00 Europe/Paris');
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily', '14:00-15:00 SHOP-482'], self::arrows($this->day(self::THURSDAY), [$daily => 'daily']));
        self::assertSame('sent', self::at($this->day(self::THURSDAY), 'send', 'state'));
    }

    public function testUneSemaineSurNSeMontreSeulementSesSemaines(): void
    {
        [$poker] = $this->repeatWith(0, self::work('13:30', '14:00', 'OPS-7', 'Poker'), self::everyWeeks(2, [2, 4]));
        [$review] = $this->repeatWith(1, self::work('09:15', '09:30', 'OPS-12', 'Revue'), self::everyWeeks(4, [1]));
        $names = [$poker => 'poker', $review => 'revue'];
        $rows = $this->dayRows();

        $expected = [
            self::THURSDAY => ['13:30-14:00 OPS-7 « Poker » ↻poker'],
            '2026-10-12' => [],
            '2026-10-13' => [],
            '2026-10-15' => [],
            '2026-10-19' => [],
            '2026-10-20' => ['13:30-14:00 OPS-7 « Poker » ↻poker'],
            '2026-10-22' => ['13:30-14:00 OPS-7 « Poker » ↻poker'],
            '2026-10-26' => [],
            '2026-11-02' => ['09:15-09:30 OPS-12 « Revue » ↻revue'],
            '2026-11-03' => ['13:30-14:00 OPS-7 « Poker » ↻poker'],
        ];
        foreach ($expected as $date => $blocks) {
            $day = $this->day($date);
            self::assertSame($blocks, self::arrows($day, $names), $date);
            if ([] === $blocks) {
                self::assertSame(0, $day['version'], $date.' : une semaine sans, rien de prévu.');
                self::assertFalse($day['recurrencesHeld']);
            }
        }
        self::assertSame($rows, $this->dayRows(), 'Rien ne s\'écrit.');
    }

    public function testUnRythmeMensuelSeMontreSesSeulsJours(): void
    {
        [$third] = $this->repeatWith(self::intAt($this->day('2026-10-16'), 'version'), self::work('14:00', '15:00', 'OPS-7', 'Dépendances'), self::monthlyWeekday(5, 3), '2026-10-16');
        [$last] = $this->repeatWith(self::intAt($this->day('2026-10-30'), 'version'), self::work('16:00', '17:00', 'OPS-7', 'Bilan'), self::monthlyWeekday(5, -1), '2026-10-30');
        $names = [$third => '3e', $last => 'dernier'];

        self::mockTime('2026-11-01 08:00:00 Europe/Paris');
        self::assertSame(['14:00-15:00 OPS-7 « Dépendances » ↻3e'], self::arrows($this->day('2026-11-20'), $names));
        self::assertSame(['16:00-17:00 OPS-7 « Bilan » ↻dernier'], self::arrows($this->day('2026-11-27'), $names), 'Le 4e vendredi de novembre en est le dernier.');
        self::assertSame([], self::arrows($this->day('2026-11-13')));

        self::mockTime('2027-01-01 08:00:00 Europe/Paris');
        self::assertSame(['14:00-15:00 OPS-7 « Dépendances » ↻3e'], self::arrows($this->day('2027-01-15'), $names));
        self::assertSame([], self::arrows($this->day('2027-01-22')), 'Un mois de cinq vendredis : le 4e n\'est pas le dernier.');
        self::assertSame(['16:00-17:00 OPS-7 « Bilan » ↻dernier'], self::arrows($this->day('2027-01-29'), $names));
    }

    public function testLe31SeMontreSeulementLesMoisQuiEnOntUnTravaille(): void
    {
        self::mockTime('2026-12-01 08:00:00 Europe/Paris');
        [$closing] = $this->repeatWith(self::intAt($this->day('2026-12-31'), 'version'), self::work('09:15', '09:30', 'OPS-12', 'Clôture'), self::monthlyDate(31), '2026-12-31');
        self::mockTime('2027-01-02 08:00:00 Europe/Paris');
        $sunday = $this->day('2027-01-31');
        self::assertSame([], $sunday['blocks']);
        self::assertTrue($sunday['recurrencesHeld']);
        self::mockTime('2027-03-02 08:00:00 Europe/Paris');
        self::assertSame(['09:15-09:30 OPS-12 « Clôture » ↻clôture'], self::arrows($this->day('2027-03-31'), [$closing => 'clôture']));
        self::assertSame([], self::arrows($this->day('2027-03-30')));
        self::assertSame([], $this->links('2027-03-31'), 'Prévue, pas écrite.');
    }

    public function testChangerLeRythmeAvecLesSuivantesSurUnJourAVenir(): void
    {
        [$daily] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));

        // Le jeudi : un jeudi sur deux, à partir de cette fois.
        $cut = $this->saveRecurrence(self::intAt($this->day(self::THURSDAY), 'version'), [self::work('09:15', '09:30', 'OPS-12', 'Daily')], self::everyWeeks(2, [4]), $daily, self::THURSDAY);
        $new = self::stringAt($cut, 'untils', 1, 'recurrence');
        $names = [$daily => 'daily', $new => 'jeudis'];

        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻jeudis'], self::arrows($cut, $names));
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($this->day('2026-10-07'), $names), 'La veille garde l\'ancienne.');
        self::assertSame([555 => $daily], $this->links(), 'Déjà posée aujourd\'hui, elle le reste.');
        self::assertSame([], self::arrows($this->day('2026-10-09')));
        self::assertSame([], self::arrows($this->day('2026-10-15')), 'Sa semaine sans.');
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻jeudis'], self::arrows($this->day('2026-10-22'), $names));
    }

    public function testUnJourAVenirSansSaisieSEnvoieEtNaitDeSesRecurrences(): void
    {
        $this->linkJira();
        [$daily] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        $rows = $this->dayRows();

        [$status, $sent] = $this->send('POST', '/api/days/'.self::THURSDAY.'/send', ['version' => self::intAt($this->day(self::THURSDAY), 'version')]);

        self::assertSame(200, $status, json_encode($sent, \JSON_THROW_ON_ERROR));
        self::assertSame('sent', self::at($sent, 'send', 'state'));
        self::assertSame($rows + 1, $this->dayRows());
        self::assertSame([555 => $daily], $this->links(self::THURSDAY));
        self::assertSame(['OPS-12 2026-10-08 900'], $this->worklogs());
    }

    public function testUnEnvoiQuiNAPasVuLaRecurrenceChangerNePartPas(): void
    {
        $this->linkJira();
        [$daily, $today] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        // La confirmation de l'envoi du jeudi est ouverte ; un autre onglet change le Daily
        // à partir de mercredi.
        $seen = self::intAt($this->day(self::THURSDAY), 'version');
        $wednesday = $this->day('2026-10-07');
        $this->saveRecurrence(self::intAt($wednesday, 'version'), [self::work('09:15', '09:30', 'OPS-12', 'Rétro')], self::weekly(), $daily, '2026-10-07');

        [$status, $body] = $this->send('POST', '/api/days/'.self::THURSDAY.'/send', ['version' => $seen]);

        self::assertSame(409, $status);
        self::assertSame('stale', $body['error']);
        self::assertSame(['09:15-09:30 OPS-12 « Rétro »'], self::blocks(self::arrayAt($body, 'day')));
        self::assertSame([], $this->worklogs(), 'Rien n\'est parti.');
        self::assertSame([], $this->links(self::THURSDAY));
        self::assertSame(self::intAt($today, 'version'), self::intAt($this->day(), 'version'));
    }

    public function testUnJourAVenirSeMarqueSurSesSeulesSaisies(): void
    {
        $this->linkJira();
        [$daily] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        self::assertArrayNotHasKey(self::THURSDAY, $this->marks());

        $thursday = $this->write(self::intAt($this->day(self::THURSDAY), 'version'), [self::work('14:00', '14:15', 'SHOP-482')], self::THURSDAY);
        self::assertSame('unsent', self::at($this->marks(), self::THURSDAY), 'Une saisie de plus le marque.');

        // Envoyé, puis la fois du Daily effacée puis rendue par annuler : envoyé, le jour a reçu
        // ses récurrences pour de bon, et annuler la lui rend posée, comme un jour venu. Il
        // montre ce qu'il a envoyé : il reste envoyé.
        [, $sent] = $this->send('POST', '/api/days/'.self::THURSDAY.'/send', ['version' => self::intAt($thursday, 'version')]);
        $erased = $this->write(self::intAt($sent, 'version'), [self::clear('09:15', '09:30')], self::THURSDAY);
        self::assertSame('modified', self::at($erased, 'send', 'state'));
        self::assertSame('modified', self::at($this->marks(), self::THURSDAY));
        $undone = $this->write(self::intAt($erased, 'version'), [self::linked(self::work('09:15', '09:30', 'OPS-12', 'Daily'), $daily)], self::THURSDAY);
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily', '14:00-14:15 SHOP-482'], self::arrows($undone, [$daily => 'daily']));
        self::assertSame([555 => $daily, 840 => null], $this->links(self::THURSDAY));
        self::assertSame([], $this->skips());
        self::assertSame('sent', self::at($undone, 'send', 'state'));
        self::assertSame('sent', self::at($this->marks(), self::THURSDAY));
    }

    public function testUnJourAVenirEnvoyeGardeCeQueLEnvoiYAPose(): void
    {
        $this->linkJira();
        [$daily] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        [$point] = $this->repeat(self::intAt($this->day(), 'version'), self::work('16:00', '16:15', 'OPS-7', 'Point'), [2]);
        $thursday = $this->write(self::intAt($this->day(self::THURSDAY), 'version'), [self::work('14:00', '14:15', 'SHOP-482')], self::THURSDAY);
        [$status, $sent] = $this->send('POST', '/api/days/'.self::THURSDAY.'/send', ['version' => self::intAt($thursday, 'version')]);
        self::assertSame(200, $status, json_encode($sent, \JSON_THROW_ON_ERROR));
        self::assertSame('sent', self::at($sent, 'send', 'state'));
        $sentAs = ['09:15-09:30 OPS-12 « Daily » ↻daily', '14:00-14:15 SHOP-482'];
        self::assertSame($sentAs, self::arrows($sent, [$daily => 'daily']));
        $links = $this->links(self::THURSDAY);
        $worklogs = $this->worklogs();

        // Une récurrence née ensuite, chaque mardi et jeudi à 17:00.
        [$revue] = $this->repeat(self::intAt($this->day(), 'version'), self::work('17:00', '17:15', 'OPS-7', 'Revue'), [2, 4]);
        $this->assertSentAs($sent, 'créée');
        // Le Daily changé avec les suivantes à partir de mercredi : la fois que l'envoi a posée
        // reste telle quelle, sans flèche, comme celle d'une récurrence arrêtée avant elle. Sa
        // flèche partie, l'onglet qui la montrait encore est en retard : annuler un geste sur
        // elle y rendrait un lien qui n'a plus où aller.
        $cut = $this->saveRecurrence(self::intAt($this->day('2026-10-07'), 'version'), [self::work('09:15', '09:30', 'OPS-12', 'Rétro')], self::weekly(), $daily, '2026-10-07');
        $retro = self::stringAt($cut, 'untils', 1, 'recurrence');
        [$status] = $this->patchSlots(self::intAt($sent, 'version'), [self::clear('09:15', '09:30')], self::THURSDAY);
        self::assertSame(409, $status);
        $unlinked = $this->day(self::THURSDAY);
        self::assertSame(self::blocks($sent), self::blocks($unlinked));
        $sent = $unlinked;
        self::assertSame(['09:15-09:30 OPS-12 « Daily »', '14:00-14:15 SHOP-482'], self::arrows($this->assertSentAs($sent, 'changée')));
        // Le Point du mardi étendu au jeudi, à partir d'aujourd'hui.
        $extended = $this->saveRecurrence(self::intAt($this->day(), 'version'), [self::work('16:00', '16:15', 'OPS-7', 'Point')], self::weekly([2, 4]), $point);
        $points = self::stringAt($extended, 'untils', 1, 'recurrence');
        $this->assertSentAs($sent, 'étendue');

        self::assertSame([self::THURSDAY], self::at($this->day(), 'settledAhead'), 'La fenêtre d\'une récurrence ne l\'annonce pas.');
        $names = [$revue => 'revue', $retro => 'rétro', $points => 'point'];
        self::assertSame(['09:15-09:30 OPS-12 « Rétro » ↻rétro', '16:00-16:15 OPS-7 « Point » ↻point', '17:00-17:15 OPS-7 « Revue » ↻revue'], self::arrows($this->day('2026-10-15'), $names), 'Le jeudi d\'après, pas envoyé, les montre.');
        self::assertSame($links, $this->links(self::THURSDAY), 'Rien n\'est écrit.');

        // Un onglet resté ouvert sur le jeudi envoyé n'est pas en retard : rien n'y a changé.
        $written = $this->write(self::intAt($sent, 'version'), [self::work('15:00', '15:15', 'SHOP-482')], self::THURSDAY);
        self::assertSame('modified', self::at($written, 'send', 'state'));
        $sent = $this->write(self::intAt($written, 'version'), [self::clear('15:00', '15:15')], self::THURSDAY);

        // Le jour venu, rien ne s'y pose : ni la récurrence née après l'envoi, ni celles qui
        // ont changé ou se sont étendues.
        self::mockTime('2026-10-08 08:00:00 Europe/Paris');
        self::assertSame(['09:15-09:30 OPS-12 « Daily »', '14:00-14:15 SHOP-482'], self::arrows($this->assertSentAs($sent, 'le jour venu')));
        self::assertSame($links, $this->links(self::THURSDAY));
        self::assertSame($worklogs, $this->worklogs());
        self::mockTime('2026-10-15 08:00:00 Europe/Paris');
        self::assertSame(['09:15-09:30 OPS-12 « Rétro » ↻rétro', '16:00-16:15 OPS-7 « Point » ↻point', '17:00-17:15 OPS-7 « Revue » ↻revue'], self::arrows($this->day('2026-10-15'), $names), 'Le jeudi d\'après les reçoit.');
    }

    public function testUnEnvoiQuiEchoueAPoseLesRecurrencesPourDeBon(): void
    {
        $this->linkJira();
        [$daily] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));

        $this->simulate('panne', ['panne' => true]);
        [$status, $failed] = $this->send('POST', '/api/days/'.self::THURSDAY.'/send', ['version' => self::intAt($this->day(self::THURSDAY), 'version')]);
        $this->simulate('panne', ['panne' => false]);
        self::assertSame(200, $status, json_encode($failed, \JSON_THROW_ON_ERROR));
        self::assertNotSame('sent', self::at($failed, 'send', 'state'));
        self::assertSame([555 => $daily], $this->links(self::THURSDAY));

        // Une récurrence née ensuite ne s'y montre pas, et le prochain essai ne l'envoie pas.
        $this->repeat(self::intAt($this->day(), 'version'), self::work('17:00', '17:15', 'OPS-7', 'Revue'), [2, 4]);
        $thursday = $this->day(self::THURSDAY);
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($thursday, [$daily => 'daily']));
        self::assertSame(self::intAt($failed, 'version'), self::intAt($thursday, 'version'));
        [$status, $sent] = $this->send('POST', '/api/days/'.self::THURSDAY.'/send', ['version' => self::intAt($thursday, 'version')]);
        self::assertSame(200, $status, json_encode($sent, \JSON_THROW_ON_ERROR));
        self::assertSame('sent', self::at($sent, 'send', 'state'));
        self::assertSame(['OPS-12 2026-10-08 900'], $this->worklogs());
    }

    public function testUnePauseQueLEnvoiAPoseeRedevientPrevueQuandLeJourEstRenvoyeVide(): void
    {
        $this->linkJira();
        [$lunch] = $this->repeat(0, self::pause('12:30', '13:00'));
        $thursday = $this->write(self::intAt($this->day(self::THURSDAY), 'version'), [self::work('14:00', '14:15', 'SHOP-482')], self::THURSDAY);
        [, $sent] = $this->send('POST', '/api/days/'.self::THURSDAY.'/send', ['version' => self::intAt($thursday, 'version')]);
        self::assertSame([750 => $lunch, 765 => $lunch, 840 => null], $this->links(self::THURSDAY), 'L\'envoi l\'a posée.');
        $emptied = $this->write(self::intAt($sent, 'version'), [self::clear('14:00', '14:15')], self::THURSDAY);
        [$status, $resent] = $this->send('POST', '/api/days/'.self::THURSDAY.'/send', ['version' => self::intAt($emptied, 'version')]);

        // Renvoyé vide, le jour n'a plus d'envoi : la pause redevient prévue, comme les autres
        // fois de ce jour.
        self::assertSame(200, $status, json_encode($resent, \JSON_THROW_ON_ERROR));
        self::assertSame('nothing', self::at($resent, 'send', 'state'));
        self::assertSame(['12:30-13:00 pause ↻déjeuner'], self::arrows($resent, [$lunch => 'déjeuner']));
        self::assertSame([], $this->links(self::THURSDAY), 'Prévue, pas écrite.');
        self::assertSame([], $this->skips());

        // Changée avec les suivantes depuis mercredi, elle suit sa série.
        $cut = $this->saveRecurrence(self::intAt($this->day('2026-10-07'), 'version'), [self::pause('12:00', '13:00')], self::weekly(), $lunch, '2026-10-07');
        $longer = self::stringAt($cut, 'untils', 1, 'recurrence');
        self::assertSame(['12:00-13:00 pause ↻plus long'], self::arrows($this->day(self::THURSDAY), [$longer => 'plus long']));
        self::assertSame([], $this->links(self::THURSDAY));
    }

    public function testUnePauseDUneRecurrenceArreteeAvantLeJourRenvoyeVideResteSansFleche(): void
    {
        $this->linkJira();
        [$lunch] = $this->repeat(0, self::pause('12:30', '13:00'));
        $thursday = $this->write(self::intAt($this->day(self::THURSDAY), 'version'), [self::work('14:00', '14:15', 'SHOP-482')], self::THURSDAY);
        [, $sent] = $this->send('POST', '/api/days/'.self::THURSDAY.'/send', ['version' => self::intAt($thursday, 'version')]);
        // Arrêtée à partir de mercredi : la fois que l'envoi a posée jeudi reste, sans flèche.
        $this->saveRecurrence(self::intAt($this->day('2026-10-07'), 'version'), [self::pause('12:30', '13:00')], null, $lunch, '2026-10-07');
        $emptied = $this->write(self::intAt($this->day(self::THURSDAY), 'version'), [self::clear('14:00', '14:15')], self::THURSDAY);
        [$status, $resent] = $this->send('POST', '/api/days/'.self::THURSDAY.'/send', ['version' => self::intAt($emptied, 'version')]);

        // Rouvert, il la garde telle qu'il la montrait : une saisie ordinaire, qui ne revient
        // pas avec sa série si on la prolonge.
        self::assertSame(200, $status, json_encode($resent, \JSON_THROW_ON_ERROR));
        self::assertSame(['12:30-13:00 pause'], self::arrows($resent));
        self::assertSame([750 => null, 765 => null], $this->links(self::THURSDAY), 'Écrite, sans lien.');
    }

    public function testUnJourAVenirDontLEnvoiAEchoueSansRienEcrireSeRouvreQuandOnLeVide(): void
    {
        $this->linkJira();
        [$daily] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        [$lunch] = $this->repeat(self::intAt($this->day(), 'version'), self::pause('12:30', '13:00'));
        $thursday = $this->write(self::intAt($this->day(self::THURSDAY), 'version'), [self::work('14:00', '14:15', 'SHOP-482')], self::THURSDAY);
        $this->simulate('panne', ['panne' => true]);
        [, $failed] = $this->send('POST', '/api/days/'.self::THURSDAY.'/send', ['version' => self::intAt($thursday, 'version')]);
        $this->simulate('panne', ['panne' => false]);
        self::assertSame('failed', self::at($failed, 'send', 'state'));
        [$revue] = $this->repeat(self::intAt($this->day(), 'version'), self::work('17:00', '17:15', 'OPS-7', 'Revue'), [2, 4]);
        $names = [$daily => 'daily', $lunch => 'déjeuner', $revue => 'revue'];
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily', '12:30-13:00 pause ↻déjeuner', '14:00-14:15 SHOP-482'], self::arrows($this->day(self::THURSDAY), $names), 'Tant qu\'il a ses tickets, l\'envoi raté le garde tel qu\'il l\'a posé.');
        self::assertSame([self::THURSDAY], self::at($this->day(), 'settledAhead'));

        // Vidé de ses tickets, le Daily effacé cette fois seulement : Jira n'a rien de lui, son
        // envoi n'a plus rien à dire. Il redevient un jour à venir comme un autre : la revue née
        // depuis s'y montre, et la pause redevient prévue.
        $kept = $this->write(self::intAt($failed, 'version'), [self::clear('14:00', '14:15')], self::THURSDAY);
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily', '12:30-13:00 pause ↻déjeuner'], self::arrows($kept, $names), 'Un ticket posé le ferme encore.');
        $emptied = $this->write(self::intAt($kept, 'version'), [self::clear('09:15', '09:30')], self::THURSDAY);
        self::assertSame(['12:30-13:00 pause ↻déjeuner', '17:00-17:15 OPS-7 « Revue » ↻revue'], self::arrows($emptied, $names));
        self::assertSame('unsent', self::at($emptied, 'send', 'state'));
        self::assertSame([], self::at($emptied, 'settledAhead'));
        self::assertSame([], $this->links(self::THURSDAY), 'Prévues, pas écrites.');
        self::assertSame([$daily.' '.self::THURSDAY], $this->skips(), 'Seul le Daily effacé reste effacé.');
        self::assertSame(0, $this->sendRows());

        // Un ticket saisi ensuite ne le referme pas : rien n'est encore parti.
        $written = $this->write(self::intAt($emptied, 'version'), [self::work('15:00', '15:15', 'SHOP-482')], self::THURSDAY);
        self::assertSame(['12:30-13:00 pause ↻déjeuner', '15:00-15:15 SHOP-482', '17:00-17:15 OPS-7 « Revue » ↻revue'], self::arrows($written, $names));
        self::assertSame('unsent', self::at($written, 'send', 'state'));
        self::assertSame($written, $this->day(self::THURSDAY));
    }

    public function testUnEnvoiRateQuUnAutreOngletAVideSansRienEcrireNeFermePlusLeJour(): void
    {
        $this->linkJira();
        $thursday = $this->write(self::intAt($this->day(self::THURSDAY), 'version'), [self::work('14:00', '14:15', 'SHOP-482')], self::THURSDAY);
        [$revue] = $this->repeat(self::intAt($this->day(), 'version'), self::work('17:00', '17:15', 'OPS-7', 'Revue'), [2, 4]);
        $this->simulate('panne', ['panne' => true]);
        $this->send('POST', '/api/days/'.self::THURSDAY.'/send', ['version' => self::intAt($this->day(self::THURSDAY), 'version')]);
        $this->simulate('panne', ['panne' => false]);
        self::assertSame(['14:00-14:15 SHOP-482', '17:00-17:15 OPS-7 « Revue »'], self::blocks($this->day(self::THURSDAY)));
        // Un envoi raté d'une version d'avant cette règle, sur une journée vidée depuis : il ne
        // laisse rien dans Jira, et ne la ferme pas.
        $this->connection()->executeStatement('DELETE FROM slot');
        $this->connection()->executeStatement('UPDATE day SET version = version + 1');
        self::assertSame(1, $this->sendRows());

        $day = $this->day(self::THURSDAY);
        self::assertSame(['17:00-17:15 OPS-7 « Revue » ↻revue'], self::arrows($day, [$revue => 'revue']));
        self::assertSame([], self::at($day, 'settledAhead'));

        // Le premier geste l'oublie : le ticket saisi ne le referme pas.
        $written = $this->write(self::intAt($day, 'version'), [self::work('15:00', '15:15', 'SHOP-482')], self::THURSDAY);
        self::assertSame(['15:00-15:15 SHOP-482', '17:00-17:15 OPS-7 « Revue » ↻revue'], self::arrows($written, [$revue => 'revue']));
        self::assertSame(0, $this->sendRows());
        unset($thursday);
    }

    public function testUnOngletQuiMontreEncoreLaFlecheDUneRecurrenceArreteeAilleursEstEnRetard(): void
    {
        $this->linkJira();
        [$daily] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        [, $sent] = $this->send('POST', '/api/days/'.self::THURSDAY.'/send', ['version' => self::intAt($this->day(self::THURSDAY), 'version')]);
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($sent, [$daily => 'daily']));

        // Dans un autre onglet, depuis mercredi, le Daily est arrêté avec les suivantes : la fois
        // que l'envoi a posée jeudi perd sa flèche, et la journée change de version.
        $this->saveRecurrence(self::intAt($this->day('2026-10-07'), 'version'), [self::work('09:15', '09:30', 'OPS-12', 'Daily')], null, $daily, '2026-10-07');
        $unlinked = $this->day(self::THURSDAY);
        self::assertSame(['09:15-09:30 OPS-12 « Daily »'], self::arrows($unlinked));
        self::assertNotSame(self::intAt($sent, 'version'), self::intAt($unlinked, 'version'));
        self::assertSame($unlinked['version'], $this->day(self::THURSDAY)['version'], 'Relue, elle garde sa nouvelle version.');

        // L'onglet resté ouvert l'efface cette fois seulement : il est en retard, rien ne s'écrit.
        [$status, $late] = $this->patchSlots(self::intAt($sent, 'version'), [self::clear('09:15', '09:30')], self::THURSDAY);
        self::assertSame(409, $status);
        self::assertSame(self::arrows($unlinked), self::arrows(self::arrayAt($late, 'day')));
        self::assertSame([555 => $daily], $this->links(self::THURSDAY));

        // Relu, il l'efface, puis Ctrl+Z la rend.
        $erased = $this->write(self::intAt($unlinked, 'version'), [self::clear('09:15', '09:30')], self::THURSDAY);
        self::assertSame([], self::listAt($erased, 'blocks'));
        [$status, $undone] = $this->restore(self::intAt($erased, 'version'), [self::work('09:15', '09:30', 'OPS-12', 'Daily')], self::THURSDAY);
        self::assertSame(200, $status, json_encode($undone, \JSON_THROW_ON_ERROR));
        self::assertSame(['09:15-09:30 OPS-12 « Daily »'], self::arrows($undone));
        self::assertSame('sent', self::at($undone, 'send', 'state'));
    }

    public function testUnOngletQuiMontreEncoreLaFlecheDUneRecurrenceChangeeAilleursEstEnRetard(): void
    {
        $this->linkJira();
        [$daily] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        [, $sent] = $this->send('POST', '/api/days/'.self::THURSDAY.'/send', ['version' => self::intAt($this->day(self::THURSDAY), 'version')]);

        // Changée avec les suivantes depuis mercredi : la fois de jeudi reste telle quelle, sans flèche.
        $this->saveRecurrence(self::intAt($this->day('2026-10-07'), 'version'), [self::work('09:15', '09:30', 'OPS-12', 'Rétro')], self::weekly(), $daily, '2026-10-07');
        [$status] = $this->patchSlots(self::intAt($sent, 'version'), [self::clear('09:15', '09:30')], self::THURSDAY);
        self::assertSame(409, $status);

        // Rien d'autre ne change la version : une récurrence qui va encore jusqu'à lui garde sa flèche.
        $read = $this->day(self::THURSDAY);
        $this->repeat(self::intAt($this->day(), 'version'), self::work('17:00', '17:15', 'OPS-7', 'Revue'), [2, 4]);
        self::assertSame($read['version'], $this->day(self::THURSDAY)['version']);
    }

    public function testUneRecurrenceNeSeRefusePasPourUnCreneauQuElleNePrendraitQueSurUnJourEnvoye(): void
    {
        $this->linkJira();
        // Une revue chaque jeudi à 17:00 jusqu'à ce jeudi-ci, que l'envoi y pose.
        [$revue] = $this->repeat(0, self::work('17:00', '17:15', 'OPS-7', 'Revue'), [2, 4], self::THURSDAY);
        [, $sent] = $this->send('POST', '/api/days/'.self::THURSDAY.'/send', ['version' => self::intAt($this->day(self::THURSDAY), 'version')]);
        self::assertSame('sent', self::at($sent, 'send', 'state'));
        self::assertSame([self::THURSDAY], self::at($this->day(), 'settledAhead'));

        // Chaque jeudi à 17:00, à partir d'aujourd'hui : leur seule fois commune est ce jeudi
        // envoyé, où aucune ne se posera plus. Elle se crée.
        [$status, $created] = $this->putRecurrence(self::intAt($this->day(), 'version'), [self::work('17:00', '17:15', 'OPS-7', 'Point')], self::weekly([4]), date: self::TODAY);
        self::assertSame(200, $status, json_encode($created, \JSON_THROW_ON_ERROR));
        $point = self::stringAt($created, 'untils', 0, 'recurrence');
        self::assertSame(['17:00-17:15 OPS-7 « Revue » ↻revue'], self::arrows($this->day(self::THURSDAY), [$revue => 'revue']), 'Le jeudi envoyé ne change pas.');
        self::assertSame(['17:00-17:15 OPS-7 « Point » ↻point'], self::arrows($this->day('2026-10-15'), [$point => 'point']));
        $this->assertNoClash();

        // Sur un jour qui n'est pas envoyé, le même créneau se refuse.
        [$status, $refused] = $this->putRecurrence(self::intAt($this->day('2026-10-15'), 'version'), [self::work('17:00', '17:15', 'OPS-7', 'Autre')], self::weekly([4]), date: '2026-10-15');
        self::assertSame(422, $status, json_encode($refused, \JSON_THROW_ON_ERROR));
    }

    public function testUnJourEnvoyeRouvertNeDonneJamaisLeMemeCreneauADeuxRecurrences(): void
    {
        $this->linkJira();
        // Une pause chaque jeudi à 12:30 jusqu'à ce jeudi-ci, que l'envoi y pose avec un ticket.
        [$lunch] = $this->repeat(0, self::pause('12:30', '13:00'), [2, 4], self::THURSDAY);
        $thursday = $this->write(self::intAt($this->day(self::THURSDAY), 'version'), [self::work('14:00', '14:15', 'SHOP-482')], self::THURSDAY);
        [, $sent] = $this->send('POST', '/api/days/'.self::THURSDAY.'/send', ['version' => self::intAt($thursday, 'version')]);
        // Fermé, ce jeudi laisse naître, depuis mercredi, une autre pause chaque mardi et jeudi à 12:45.
        [$break] = $this->repeat(self::intAt($this->day('2026-10-07'), 'version'), self::pause('12:45', '13:15'), [2, 4], date: '2026-10-07');

        // Vidé et renvoyé vide, il se rouvre : la plus ancienne garde son créneau, l'autre y cède
        // sa fois, comme effacée cette fois seulement.
        $emptied = $this->write(self::intAt($sent, 'version'), [self::clear('14:00', '14:15')], self::THURSDAY);
        [$status, $resent] = $this->send('POST', '/api/days/'.self::THURSDAY.'/send', ['version' => self::intAt($emptied, 'version')]);
        self::assertSame(200, $status, json_encode($resent, \JSON_THROW_ON_ERROR));
        self::assertSame(['12:30-13:00 pause ↻déjeuner'], self::arrows($resent, [$lunch => 'déjeuner', $break => 'pause']));
        self::assertSame([$break.' '.self::THURSDAY], $this->skips());
        $this->assertNoClash();
        self::assertSame(['12:45-13:15 pause ↻pause'], self::arrows($this->day('2026-10-13'), [$lunch => 'déjeuner', $break => 'pause']), 'Le mardi d\'après, la seule qui y tombe.');
    }

    public function testCtrlZRendLaFoisQuUnJourRouvertParLeMemeGesteAvaitEffacee(): void
    {
        $this->linkJira();
        // Une pause le mardi et le jeudi jusqu'à ce jeudi-ci, que l'envoi raté y pose avec un ticket.
        [$lunch] = $this->repeat(0, self::pause('12:30', '13:00'), [2, 4], self::THURSDAY);
        $thursday = $this->write(self::intAt($this->day(self::THURSDAY), 'version'), [self::work('14:00', '14:15', 'SHOP-482')], self::THURSDAY);
        $this->simulate('panne', ['panne' => true]);
        [, $failed] = $this->send('POST', '/api/days/'.self::THURSDAY.'/send', ['version' => self::intAt($thursday, 'version')]);
        $this->simulate('panne', ['panne' => false]);
        // Fermé, il laisse naître, depuis mercredi, une autre pause sur son créneau.
        [$break] = $this->repeat(self::intAt($this->day('2026-10-07'), 'version'), self::pause('12:45', '13:15'), [2, 4], date: '2026-10-07');

        // Tout effacé d'un geste : la pause cette fois seulement, et le dernier ticket, qui le rouvre.
        // La plus ancienne garde le créneau, même effacée ce jour-là : l'autre y cède sa fois.
        $erased = $this->write(self::intAt($failed, 'version'), [self::clear('12:30', '13:00'), self::clear('14:00', '14:15')], self::THURSDAY);
        self::assertSame([], self::listAt($erased, 'blocks'));
        self::assertSame(self::sortedSkips($lunch, $break), $this->skips());

        // Ctrl+Z rend la pause et le ticket, sans refus : aucune autre ne l'attendait.
        [$status, $undone] = $this->restore(self::intAt($erased, 'version'), [self::linked(self::pause('12:30', '13:00'), $lunch), self::work('14:00', '14:15', 'SHOP-482')], self::THURSDAY);
        self::assertSame(200, $status, json_encode($undone, \JSON_THROW_ON_ERROR));
        self::assertSame(['12:30-13:00 pause ↻déjeuner', '14:00-14:15 SHOP-482'], self::arrows($undone, [$lunch => 'déjeuner', $break => 'pause']));
        self::assertSame([$break.' '.self::THURSDAY], $this->skips());
        $this->assertNoClash();
    }

    public function testUnJourRouvertGardeLaPausePoseeParLEnvoiFaceAUneAutreEffaceeAvant(): void
    {
        $this->linkJira();
        // Une pause le mardi et le jeudi jusqu'à ce jeudi-ci, effacée ce jeudi cette fois seulement.
        [$lunch] = $this->repeat(0, self::pause('12:30', '13:00'), [2, 4], self::THURSDAY);
        $this->write(self::intAt($this->day(self::THURSDAY), 'version'), [self::clear('12:30', '13:00')], self::THURSDAY);
        // Une autre, depuis mercredi : leur seule fois commune est sautée, elle se crée.
        [$break] = $this->repeat(self::intAt($this->day('2026-10-07'), 'version'), self::pause('12:45', '13:15'), [2, 4], date: '2026-10-07');
        $thursday = $this->write(self::intAt($this->day(self::THURSDAY), 'version'), [self::work('14:00', '14:15', 'SHOP-482')], self::THURSDAY);
        $this->simulate('panne', ['panne' => true]);
        [, $failed] = $this->send('POST', '/api/days/'.self::THURSDAY.'/send', ['version' => self::intAt($thursday, 'version')]);
        $this->simulate('panne', ['panne' => false]);
        self::assertSame([765 => $break, 780 => $break, 840 => null], $this->links(self::THURSDAY), 'L\'envoi raté l\'a posée.');

        // Vidé, il se rouvre : la pause que l'envoi y avait posée garde son créneau, et redevient prévue.
        $emptied = $this->write(self::intAt($failed, 'version'), [self::clear('14:00', '14:15')], self::THURSDAY);
        self::assertSame(['12:45-13:15 pause ↻pause'], self::arrows($emptied, [$lunch => 'déjeuner', $break => 'pause']));
        self::assertSame([$lunch.' '.self::THURSDAY], $this->skips());
        self::assertSame([], $this->links(self::THURSDAY));
        $this->assertNoClash();
    }

    public function testUnJourRouvertMontreLaPauseNeePendantQuIlEtaitEnvoyeFaceAUneAutreEffaceeAvant(): void
    {
        $this->linkJira();
        // Une pause le mardi et le jeudi jusqu'à ce jeudi-ci, effacée ce jeudi cette fois seulement.
        [$lunch] = $this->repeat(0, self::pause('12:30', '13:00'), [2, 4], self::THURSDAY);
        $this->write(self::intAt($this->day(self::THURSDAY), 'version'), [self::clear('12:30', '13:00')], self::THURSDAY);
        $thursday = $this->write(self::intAt($this->day(self::THURSDAY), 'version'), [self::work('14:00', '14:15', 'SHOP-482')], self::THURSDAY);
        [, $sent] = $this->send('POST', '/api/days/'.self::THURSDAY.'/send', ['version' => self::intAt($thursday, 'version')]);
        // Envoyé, il laisse naître, depuis mercredi, une autre pause sur ce créneau ; il ne la montre pas.
        [$break] = $this->repeat(self::intAt($this->day('2026-10-07'), 'version'), self::pause('12:45', '13:15'), [2, 4], date: '2026-10-07');
        self::assertSame(['14:00-14:15 SHOP-482'], self::blocks($this->day(self::THURSDAY)));

        // Vidé et renvoyé vide, il se rouvre : la pause effacée avant ne revient pas, et ne garde
        // rien ; l'autre s'y montre, comme sur un jour qui n'aurait jamais été envoyé.
        $emptied = $this->write(self::intAt($sent, 'version'), [self::clear('14:00', '14:15')], self::THURSDAY);
        [$status, $resent] = $this->send('POST', '/api/days/'.self::THURSDAY.'/send', ['version' => self::intAt($emptied, 'version')]);
        self::assertSame(200, $status, json_encode($resent, \JSON_THROW_ON_ERROR));
        self::assertSame(['12:45-13:15 pause ↻pause'], self::arrows($resent, [$lunch => 'déjeuner', $break => 'pause']));
        self::assertSame([$lunch.' '.self::THURSDAY], $this->skips());
        $this->assertNoClash();
    }

    public function testUnJourAVenirVideEtRenvoyeVideRecoitDeNouveauSesRecurrences(): void
    {
        $this->linkJira();
        $thursday = $this->write(self::intAt($this->day(self::THURSDAY), 'version'), [self::work('14:00', '14:15', 'SHOP-482')], self::THURSDAY);
        [, $sent] = $this->send('POST', '/api/days/'.self::THURSDAY.'/send', ['version' => self::intAt($thursday, 'version')]);
        [$revue] = $this->repeat(self::intAt($this->day(), 'version'), self::work('17:00', '17:15', 'OPS-7', 'Revue'), [2, 4]);
        self::assertSame(['14:00-14:15 SHOP-482'], self::blocks($this->day(self::THURSDAY)));

        // Vidé, il garde son envoi tant que Jira a ses heures : rien ne s'y montre.
        $emptied = $this->write(self::intAt($sent, 'version'), [self::clear('14:00', '14:15')], self::THURSDAY);
        self::assertSame([], self::listAt($emptied, 'blocks'));
        self::assertSame('modified', self::at($emptied, 'send', 'state'));

        // Renvoyé vide, Jira n'a plus rien de lui, et lui plus d'envoi : il redevient un jour à
        // venir comme un autre, et l'onglet qui l'a vu sans la revue est en retard.
        [$status, $resent] = $this->send('POST', '/api/days/'.self::THURSDAY.'/send', ['version' => self::intAt($emptied, 'version')]);
        self::assertSame(200, $status, json_encode($resent, \JSON_THROW_ON_ERROR));
        self::assertSame([], $this->worklogs());
        self::assertSame(['17:00-17:15 OPS-7 « Revue » ↻revue'], self::arrows($resent, [$revue => 'revue']));
        self::assertSame('unsent', self::at($resent, 'send', 'state'));
        self::assertSame([], self::at($resent, 'settledAhead'));
        self::assertNotSame(self::intAt($emptied, 'version'), self::intAt($resent, 'version'));
        [$status] = $this->patchSlots(self::intAt($emptied, 'version'), [self::work('15:00', '15:15', 'SHOP-482')], self::THURSDAY);
        self::assertSame(409, $status);
        self::assertSame([], $this->links(self::THURSDAY), 'Prévue, pas écrite.');
    }

    public function testUnJourAVenirEnvoyeMisA0h00NeRetrouveQueCeQueLEnvoiYAvaitPose(): void
    {
        $this->linkJira();
        [$daily] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        [, $sent] = $this->send('POST', '/api/days/'.self::THURSDAY.'/send', ['version' => self::intAt($this->day(self::THURSDAY), 'version')]);
        [$revue] = $this->repeat(self::intAt($this->day(), 'version'), self::work('17:00', '17:15', 'OPS-7', 'Revue'), [2, 4]);

        [$status, $off] = $this->putObjective(self::intAt($sent, 'version'), 0, self::THURSDAY);
        self::assertSame(200, $status);
        self::assertSame([], self::listAt($off, 'blocks'));
        self::assertSame([$daily.' '.self::THURSDAY], $this->skips(), 'Seule la fois posée par l\'envoi est retenue.');

        [$status, $back] = $this->putObjective(self::intAt($off, 'version'), 450, self::THURSDAY);
        self::assertSame(200, $status);
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($back, [$daily => 'daily', $revue => 'revue']));
        self::assertSame([555 => $daily], $this->links(self::THURSDAY), 'Rendue posée, comme un jour venu.');
        self::assertSame([], $this->skips());
        self::assertSame('sent', self::at($back, 'send', 'state'));
    }

    public function testUnJourAVenirEnvoyeParLaV1GardeCeQueLEnvoiYAPose(): void
    {
        $this->linkJira();
        $this->write(self::intAt($this->day(self::THURSDAY), 'version'), [self::work('14:00', '14:15', 'SHOP-482')], self::THURSDAY);
        // La v1 l'avait envoyé d'avance : la reprise en garde l'envoi, que la v2 n'a pas fait.
        $container = static::getContainer();
        $entityManager = $container->get(EntityManagerInterface::class);
        $day = $container->get(DayRepository::class)->findWithSlots(UserCalendar::date(self::THURSDAY) ?? self::fail('Une date.'));
        self::assertNotNull($day);
        $worklogs = Worklog::ofDay($day->grid(), $day->date, $container->get(UserCalendar::class));
        $entityManager->persist(DaySend::fromV1($day, $container->get(JiraConnectionRepository::class)->current(), new \DateTimeImmutable('2026-10-05 10:00'), $worklogs, true, ['SHOP-482']));
        $entityManager->flush();
        // Le vendredi, envoyé sous un compte qui n'est plus relié : il se dit non envoyé, et
        // reste fermé aux récurrences.
        $this->write(self::intAt($this->day('2026-10-09'), 'version'), [self::work('14:00', '14:15', 'SHOP-482')], '2026-10-09');
        // Chaque requête refait le noyau : son gestionnaire d'entités aussi.
        $container = static::getContainer();
        $entityManager = $container->get(EntityManagerInterface::class);
        $friday = $container->get(DayRepository::class)->findWithSlots(UserCalendar::date('2026-10-09') ?? self::fail('Une date.'));
        self::assertNotNull($friday);
        $entityManager->persist(DaySend::fromV1($friday, null, new \DateTimeImmutable('2026-10-05 10:00'), Worklog::ofDay($friday->grid(), $friday->date, $container->get(UserCalendar::class)), true, ['SHOP-482']));
        $entityManager->flush();
        $sent = $this->day(self::THURSDAY);
        self::assertSame('sent', self::at($sent, 'send', 'state'));
        $other = $this->day('2026-10-09');
        self::assertSame('unsent', self::at($other, 'send', 'state'));

        $this->repeat(self::intAt($this->day(), 'version'), self::work('17:00', '17:15', 'OPS-7', 'Revue'), [2, 4, 5]);
        self::assertSame(['14:00-14:15 SHOP-482'], self::blocks($this->assertSentAs($sent, 'repris de la v1')));
        self::assertSame([self::THURSDAY, '2026-10-09'], self::at($this->day(), 'settledAhead'));
        $friday = $this->day('2026-10-09');
        self::assertSame(['14:00-14:15 SHOP-482'], self::blocks($friday));
        self::assertSame(self::intAt($other, 'version'), self::intAt($friday, 'version'), 'Envoyé sous un autre compte, il ne change pas.');
        self::assertSame(['17:00-17:15 OPS-7 « Revue » ↻'.self::stringAt(self::listAt($this->day('2026-10-16'), 'blocks'), 0, 'recurrence')], self::arrows($this->day('2026-10-16')), 'Le vendredi d\'après la montre.');

        // Le jour venu, rien ne s'y pose.
        self::mockTime('2026-10-08 08:00:00 Europe/Paris');
        self::assertSame(['14:00-14:15 SHOP-482'], self::blocks($this->assertSentAs($sent, 'le jour venu')));
    }

    public function testMettreAujourdHuiA0h00RetireSesRecurrencesEtRevenirLesRend(): void
    {
        [$daily] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        [$lunch] = $this->repeat(1, self::pause('12:30', '13:30'));
        [$poker, $day] = $this->repeat(2, self::work('13:30', '14:00', 'OPS-12', 'Poker planning'), [2]);
        $day = $this->write(self::intAt($day, 'version'), [self::work('14:00', '15:00', 'SHOP-482')]);
        $names = [$daily => 'daily', $lunch => 'déjeuner', $poker => 'poker'];

        [$status, $off] = $this->putObjective(self::intAt($day, 'version'), 0);

        self::assertSame(200, $status);
        self::assertSame(['14:00-15:00 SHOP-482'], self::arrows($off, $names), 'Ses autres tickets restent.');
        self::assertTrue($off['declaredOff']);
        self::assertSame(['worked' => 60, 'remaining' => 0, 'balance' => 60, 'projectedEnd' => null], self::arrayAt($off, 'figures'));
        self::assertSame([840 => null, 855 => null, 870 => null, 885 => null], $this->links());

        [$status, $back] = $this->putObjective(self::intAt($off, 'version'), 450);

        self::assertSame(200, $status);
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily', '12:30-13:30 pause ↻déjeuner', '13:30-14:00 OPS-12 « Poker planning » ↻poker', '14:00-15:00 SHOP-482'], self::arrows($back, $names));
        self::assertSame([], $this->skips());

        // Un autre objectif que l'habituel les rend aussi.
        [, $off] = $this->putObjective(self::intAt($back, 'version'), 0);
        [, $back] = $this->putObjective(self::intAt($off, 'version'), 240);
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily', '12:30-13:30 pause ↻déjeuner', '13:30-14:00 OPS-12 « Poker planning » ↻poker', '14:00-15:00 SHOP-482'], self::arrows($back, $names));
    }

    public function testRevenirAUnObjectifNeRendQueCeQueLe0h00ARetire(): void
    {
        [$daily] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        [$lunch, $day] = $this->repeat(1, self::pause('12:30', '13:30'));
        // Le déjeuner, effacé cette fois seulement ; le Daily, détaché par un commentaire.
        $day = $this->write(self::intAt($day, 'version'), [self::clear('12:30', '13:30'), self::work('09:15', '09:30', 'OPS-12', 'Daily court')]);
        // Une récurrence arrêtée depuis aujourd'hui garde son bloc, sans flèche.
        [$stopped, $day] = $this->repeat(self::intAt($day, 'version'), self::work('16:00', '16:15', 'OPS-7'));
        $day = $this->saveRecurrence(self::intAt($day, 'version'), [self::work('16:00', '16:15', 'OPS-7')], null, $stopped);
        self::assertSame(['09:15-09:30 OPS-12 « Daily court »', '16:00-16:15 OPS-7'], self::arrows($day));

        [, $off] = $this->putObjective(self::intAt($day, 'version'), 0);
        self::assertSame(['09:15-09:30 OPS-12 « Daily court »', '16:00-16:15 OPS-7'], self::arrows($off), 'Sans flèche, ce ne sont plus des fois.');
        // Saisi quand même, sur la plage du déjeuner.
        $off = $this->write(self::intAt($off, 'version'), [self::work('12:30', '12:45', 'OPS-7')]);
        [, $back] = $this->putObjective(self::intAt($off, 'version'), 450);

        self::assertSame(['09:15-09:30 OPS-12 « Daily court »', '12:30-12:45 OPS-7', '16:00-16:15 OPS-7'], self::arrows($back));
        // L'arrêtée ne va plus jusqu'à aujourd'hui : rien n'y est sauté, et rien ne l'y rend.
        $detached = [$daily.' '.self::TODAY, $lunch.' '.self::TODAY];
        sort($detached);
        self::assertSame($detached, $this->skips(), 'Les fois détachées le restent.');
    }

    public function testUnJourPasseRevenuAUnObjectifRecoitSesFoisRetireesEtSeulementElles(): void
    {
        [$daily, $day] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        [, $off] = $this->putObjective(self::intAt($day, 'version'), 0);
        // Une récurrence née depuis un jour passé ne remplit pas les jours d'avant aujourd'hui.
        self::mockTime('2026-10-08 10:00:00 Europe/Paris');
        $monday = $this->day('2026-10-05');
        [$late] = $this->repeat(self::intAt($monday, 'version'), self::work('11:00', '11:15', 'OPS-7'), date: '2026-10-05');

        [$status, $back] = $this->putObjective(self::intAt($off, 'version'), 450);

        self::assertSame(200, $status);
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($back, [$daily => 'daily', $late => 'late']), 'Le mardi passé retrouve son Daily, et rien d\'autre.');
    }

    public function testUnCongeAVenirNeMontrePlusSesRecurrencesEtLesRetrouve(): void
    {
        [$daily] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        $thursday = $this->day(self::THURSDAY);

        [$status, $off] = $this->putObjective(self::intAt($thursday, 'version'), 0, self::THURSDAY);

        self::assertSame(200, $status);
        self::assertSame([], self::listAt($off, 'blocks'));
        self::assertTrue($off['recurrencesHeld'], 'La journée vide dit que ses récurrences ne s\'y posent pas.');
        self::assertSame([$daily.' '.self::THURSDAY], $this->skips(), 'Prévue, elle est retenue.');

        [$status, $back] = $this->putObjective(self::intAt($off, 'version'), 450, self::THURSDAY);
        self::assertSame(200, $status);
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($back, [$daily => 'daily']));
        self::assertSame([], $this->links(self::THURSDAY), 'Prévue de nouveau, pas écrite.');

        // Envoyé, puis mis à 0h00 : la fois posée par l'envoi se retire, et revient prévue.
        $this->linkJira();
        [, $sent] = $this->send('POST', '/api/days/'.self::THURSDAY.'/send', ['version' => self::intAt($back, 'version')]);
        self::assertSame([555 => $daily], $this->links(self::THURSDAY));
        [, $off] = $this->putObjective(self::intAt($sent, 'version'), 0, self::THURSDAY);
        self::assertSame([], self::listAt($off, 'blocks'));
        self::assertSame('modified', self::at($off, 'send', 'state'));
        [, $back] = $this->putObjective(self::intAt($off, 'version'), 450, self::THURSDAY);
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($back, [$daily => 'daily']));
        self::assertSame('sent', self::at($back, 'send', 'state'));
    }

    public function testUnCongePoseDAvanceEtAnnuleLeJourVenuRendSesRecurrences(): void
    {
        [$daily] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        [$status, $off] = $this->putObjective(self::intAt($this->day(self::THURSDAY), 'version'), 0, self::THURSDAY);
        self::assertSame(200, $status);

        // Le jeudi vient, toujours à 0h00 : rien ne s'y pose.
        self::mockTime('2026-10-08 10:00:00 Europe/Paris');
        $thursday = $this->day(self::THURSDAY);
        self::assertSame([], self::listAt($thursday, 'blocks'));
        self::assertSame(self::intAt($off, 'version'), self::intAt($thursday, 'version'));

        // Le congé annulé : le Daily que la fenêtre annonçait retirer revient, posé.
        [$status, $back] = $this->putObjective(self::intAt($thursday, 'version'), 450, self::THURSDAY);
        self::assertSame(200, $status);
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($back, [$daily => 'daily']));
        self::assertSame([555 => $daily], $this->links(self::THURSDAY));
        self::assertSame([], $this->skips());
        // Et le vendredi, qui n'a jamais été à 0h00, l'a reçu comme d'habitude le jour venu.
        self::mockTime('2026-10-09 10:00:00 Europe/Paris');
        $this->day('2026-10-09');
        self::assertSame([555 => $daily], $this->links('2026-10-09'));
    }

    public function testAnnulerSurUnCongeAVenirRendLaFoisASaSerieQuiLaRetient(): void
    {
        $this->linkJira();
        [$daily] = $this->repeat(0, self::work('14:00', '14:30', 'OPS-12', 'Daily'));
        $names = [$daily => 'daily'];
        $thursday = $this->write(self::intAt($this->day(self::THURSDAY), 'version'), [self::work('09:00', '09:45', 'SHOP-482')], self::THURSDAY);
        // Le Daily effacé cette fois seulement, puis le jeudi mis à 0h00.
        $erased = $this->write(self::intAt($thursday, 'version'), [self::clear('14:00', '14:30')], self::THURSDAY);
        [, $off] = $this->putObjective(self::intAt($erased, 'version'), 0, self::THURSDAY);
        self::assertSame([], $this->skips(held: true), 'Effacé avant, il n\'est pas retenu.');

        // Ctrl+Z, comme la page : l'effacement défait, chaque quart d'heure relié au Daily.
        [$status, $undone] = $this->restore(self::intAt($off, 'version'), [self::linked(self::work('14:00', '14:30', 'OPS-12', 'Daily'), $daily)], self::THURSDAY);

        self::assertSame(200, $status, json_encode($undone, \JSON_THROW_ON_ERROR));
        self::assertTrue($undone['declaredOff']);
        self::assertSame(['09:00-09:45 SHOP-482'], self::arrows($undone, $names), 'Le jour reste un congé.');
        self::assertSame(45, self::at($undone, 'figures', 'worked'));
        self::assertSame([540 => null, 555 => null, 570 => null], $this->links(self::THURSDAY), 'Rien d\'autre ne s\'écrit.');
        self::assertSame([$daily.' '.self::THURSDAY], $this->skips(held: true), 'Le Daily la retient, comme le 0h00 l\'aurait fait.');
        self::assertSame([], $this->skips(held: false));

        // « Revenir à 7h30 » la ramène, prévue.
        [, $back] = $this->putObjective(self::intAt($undone, 'version'), 450, self::THURSDAY);
        self::assertSame(['09:00-09:45 SHOP-482', '14:00-14:30 OPS-12 « Daily » ↻daily'], self::arrows($back, $names));
        self::assertSame([540 => null, 555 => null, 570 => null], $this->links(self::THURSDAY), 'Prévue, pas écrite.');
        self::assertSame([], $this->skips());

        // Un onglet reste ouvert sur le jeudi. Dans un autre, le commentaire du Daily change à
        // partir du mercredi, avec les suivantes : la fois du jeudi suit sa série.
        $cut = $this->saveRecurrence(self::intAt($this->day('2026-10-07'), 'version'), [self::work('14:00', '14:30', 'OPS-12', 'Rétro')], self::weekly(), $daily, '2026-10-07');
        $retro = self::stringAt($cut, 'untils', 1, 'recurrence');
        $thursday = $this->day(self::THURSDAY);
        self::assertSame(['09:00-09:45 SHOP-482', '14:00-14:30 OPS-12 « Rétro » ↻rétro'], self::arrows($thursday, [$retro => 'rétro']));
        self::assertNotSame(self::intAt($back, 'version'), self::intAt($thursday, 'version'));

        // L'onglet resté ouvert envoie l'ancien commentaire : refusé, rien ne part.
        [$status, $body] = $this->send('POST', '/api/days/'.self::THURSDAY.'/send', ['version' => self::intAt($back, 'version')]);
        self::assertSame(409, $status);
        self::assertSame('stale', $body['error']);
        self::assertSame([], $this->worklogs());
    }

    public function testRetablirSurUnCongeDetacheDeNouveauLaFoisQuAnnulerAvaitRendue(): void
    {
        [$daily] = $this->repeat(0, self::work('14:00', '14:30', 'OPS-12', 'Daily'));
        $erased = $this->write(self::intAt($this->day(self::THURSDAY), 'version'), [self::clear('14:00', '14:30'), self::work('09:00', '09:15', 'SHOP-482')], self::THURSDAY);
        [, $off] = $this->putObjective(self::intAt($erased, 'version'), 0, self::THURSDAY);
        [, $undone] = $this->restore(self::intAt($off, 'version'), [self::linked(self::work('14:00', '14:30', 'OPS-12', 'Daily'), $daily)], self::THURSDAY);
        self::assertSame([$daily.' '.self::THURSDAY], $this->skips(held: true));

        // Ctrl+Maj+Z, comme la page : l'effacement refait, et le Daily nommé.
        [$status, $redone] = $this->send('PATCH', '/api/days/'.self::THURSDAY.'/slots', [
            'version' => self::intAt($undone, 'version'),
            'changes' => [self::clear('14:00', '14:30')],
            'detaches' => [$daily],
        ]);

        self::assertSame(200, $status, json_encode($redone, \JSON_THROW_ON_ERROR));
        self::assertSame(['09:00-09:15 SHOP-482'], self::arrows($redone));
        self::assertSame([$daily.' '.self::THURSDAY], $this->skips(held: false), 'De nouveau effacée, cette fois seulement.');
        self::assertSame([], $this->skips(held: true));

        // Revenu à 7h30, le jour ne la retrouve pas : elle était effacée.
        [, $back] = $this->putObjective(self::intAt($redone, 'version'), 450, self::THURSDAY);
        self::assertSame(['09:00-09:15 SHOP-482'], self::arrows($back));
        self::assertSame(['14:00-14:30 OPS-12 « Daily » ↻daily'], self::arrows($this->day('2026-10-09'), [$daily => 'daily']), 'Le lendemain la prévoit toujours.');
    }

    public function testRetablirSurUnCongeRefuseUneSerieMeneeAilleursEntreTemps(): void
    {
        [$daily] = $this->repeat(0, self::work('14:00', '14:30', 'OPS-12', 'Daily'));
        $erased = $this->write(self::intAt($this->day(self::THURSDAY), 'version'), [self::clear('14:00', '14:30'), self::work('09:00', '09:15', 'SHOP-482')], self::THURSDAY);
        [, $off] = $this->putObjective(self::intAt($erased, 'version'), 0, self::THURSDAY);
        [, $undone] = $this->restore(self::intAt($off, 'version'), [self::linked(self::work('14:00', '14:30', 'OPS-12', 'Daily'), $daily)], self::THURSDAY);
        // Ailleurs, le Daily change à partir du mercredi : il ne tombe plus le jeudi, et la
        // suite reprend la fois retenue. Le jeudi à 0h00 n'en change pas de version.
        $this->saveRecurrence(self::intAt($this->day('2026-10-07'), 'version'), [self::work('14:00', '14:30', 'OPS-12', 'Rétro')], self::weekly(), $daily, '2026-10-07');
        self::assertSame(self::intAt($undone, 'version'), self::intAt($this->day(self::THURSDAY), 'version'));
        $skips = $this->skips(held: true);

        [$status, $body] = $this->send('PATCH', '/api/days/'.self::THURSDAY.'/slots', [
            'version' => self::intAt($undone, 'version'),
            'changes' => [self::clear('14:00', '14:30')],
            'detaches' => [$daily],
        ]);

        self::assertSame(409, $status);
        self::assertSame('stale', $body['error']);
        self::assertSame($skips, $this->skips(held: true), 'La fois reste retenue par la suite : l\'objectif la rendra.');
    }

    public function testRetablirNeDetacheQuUneFoisQueLaJourneeNePortePas(): void
    {
        [$daily, $today] = $this->repeat(0, self::work('14:00', '14:30', 'OPS-12', 'Daily'));
        $rows = $this->dayRows();
        $skips = $this->skips();

        foreach ([
            'posée ce jour-là' => [self::TODAY, $daily, $today],
            'prévue un jour travaillé' => [self::THURSDAY, $daily, $this->day(self::THURSDAY)],
            'inconnue' => [self::THURSDAY, '01900000-0000-7000-8000-000000000000', $this->day(self::THURSDAY)],
        ] as $case => [$date, $id, $day]) {
            [$status, $body] = $this->send('PATCH', '/api/days/'.$date.'/slots', [
                'version' => self::intAt($day, 'version'),
                'changes' => [self::clear('16:00', '16:15')],
                'detaches' => [$id],
            ]);
            self::assertSame(409, $status, $case);
            self::assertSame('stale', $body['error'], $case);
        }
        foreach (['', 'pas-une-recurrence', 12] as $id) {
            [$status, $body] = $this->send('PATCH', '/api/days/'.self::THURSDAY.'/slots', [
                'version' => self::intAt($this->day(self::THURSDAY), 'version'),
                'changes' => [self::clear('16:00', '16:15')],
                'detaches' => [$id],
            ]);
            self::assertSame(422, $status, json_encode($id, \JSON_THROW_ON_ERROR));
            self::assertStringContainsString('detaches', json_encode($body, \JSON_THROW_ON_ERROR));
        }
        self::assertSame($rows, $this->dayRows(), 'Rien ne s\'écrit.');
        self::assertSame($skips, $this->skips());
    }

    public function testAnnulerSurUnCongeAVenirRetireCeQueLeGesteAvaitPoseSurLaFois(): void
    {
        [$daily] = $this->repeat(0, self::work('14:00', '14:30', 'OPS-12', 'Daily'));
        // Un ticket tapé sur son premier quart d'heure : le Daily se détache, écrit sans flèche.
        $typed = $this->write(self::intAt($this->day(self::THURSDAY), 'version'), [self::work('14:00', '14:15', 'SHOP-482')], self::THURSDAY);
        self::assertSame(['14:00-14:15 SHOP-482', '14:15-14:30 OPS-12 « Daily »'], self::arrows($typed));
        [, $off] = $this->putObjective(self::intAt($typed, 'version'), 0, self::THURSDAY);
        self::assertSame(['14:00-14:15 SHOP-482', '14:15-14:30 OPS-12 « Daily »'], self::arrows($off), 'Sans flèche, ce sont des saisies : le 0h00 les garde.');

        // Ctrl+Z : le geste défait, la fois rendue au Daily, qui la retient.
        [$status, $undone] = $this->restore(self::intAt($off, 'version'), [self::linked(self::work('14:00', '14:30', 'OPS-12', 'Daily'), $daily)], self::THURSDAY);

        self::assertSame(200, $status, json_encode($undone, \JSON_THROW_ON_ERROR));
        self::assertSame([], self::listAt($undone, 'blocks'));
        self::assertSame([], $this->links(self::THURSDAY));
        self::assertSame([$daily.' '.self::THURSDAY], $this->skips(held: true));

        [, $back] = $this->putObjective(self::intAt($undone, 'version'), 450, self::THURSDAY);
        self::assertSame(['14:00-14:30 OPS-12 « Daily » ↻daily'], self::arrows($back, [$daily => 'daily']));
    }

    public function testAnnulerSurAujourdhuiA0h00NeReposePasLaFoisEtRevenirLaRend(): void
    {
        [$daily, $day] = $this->repeat(0, self::work('14:00', '14:30', 'OPS-12', 'Daily'));
        $erased = $this->write(self::intAt($day, 'version'), [self::clear('14:00', '14:30')]);
        [, $off] = $this->putObjective(self::intAt($erased, 'version'), 0);

        [$status, $undone] = $this->restore(self::intAt($off, 'version'), [self::linked(self::work('14:00', '14:30', 'OPS-12', 'Daily'), $daily)]);

        self::assertSame(200, $status, json_encode($undone, \JSON_THROW_ON_ERROR));
        self::assertSame([], self::listAt($undone, 'blocks'));
        self::assertSame(0, self::at($undone, 'figures', 'worked'));
        self::assertSame([], $this->links());
        self::assertSame([$daily.' '.self::TODAY], $this->skips(held: true));

        // Revenu à 7h30, aujourd'hui la reçoit sur ses quarts d'heure libres, comme le 0h00 l'aurait rendue.
        [, $back] = $this->putObjective(self::intAt($undone, 'version'), 450);
        self::assertSame(['14:00-14:30 OPS-12 « Daily » ↻daily'], self::arrows($back, [$daily => 'daily']));
        self::assertSame([840 => $daily, 855 => $daily], $this->links());
        self::assertSame([], $this->skips());
    }

    public function testAnnulerSurUnJourAVenirNonTravailleNYPosePasLaFois(): void
    {
        [$daily] = $this->repeat(0, self::work('14:00', '14:30', 'OPS-12', 'Daily'));
        $friday = '2026-10-09';
        $erased = $this->write(self::intAt($this->day($friday), 'version'), [self::clear('14:00', '14:30'), self::work('09:00', '09:15', 'SHOP-482')], $friday);
        self::assertSame([$daily.' '.$friday], $this->skips());
        $this->setWorkingDay(5, false);

        [$status, $undone] = $this->restore(self::intAt($this->day($friday), 'version'), [self::linked(self::work('14:00', '14:30', 'OPS-12', 'Daily'), $daily)], $friday);

        self::assertSame(200, $status, json_encode($undone, \JSON_THROW_ON_ERROR));
        self::assertSame(['09:00-09:15 SHOP-482'], self::arrows($undone), 'Un jour non travaillé ne reçoit aucune récurrence.');
        self::assertSame([540 => null], $this->links($friday));
        self::assertSame([], $this->skips(), 'La fois revient à sa série.');

        // Le vendredi de nouveau travaillé la prévoit, comme ses autres fois.
        $this->setWorkingDay(5, true);
        self::assertSame(['09:00-09:15 SHOP-482', '14:00-14:30 OPS-12 « Daily » ↻daily'], self::arrows($this->day($friday), [$daily => 'daily']));
        self::assertNotSame(self::intAt($erased, 'version'), self::intAt($this->day($friday), 'version'));
    }

    public function testUnObjectifHabituelA0h00NeRetireRien(): void
    {
        [$status] = $this->send('PUT', '/api/settings/habitual-objective', ['objective' => 0]);
        self::assertSame(200, $status);
        [$daily, $day] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        [, $chosen] = $this->putObjective(self::intAt($day, 'version'), 120);

        // Remise à l'habituel, à 0h00 : ce n'est pas un congé.
        [$status, $back] = $this->putObjective(self::intAt($chosen, 'version'), 0);

        self::assertSame(200, $status);
        self::assertFalse($back['declaredOff']);
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($back, [$daily => 'daily']));
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($this->day(self::THURSDAY), [$daily => 'daily']));
    }

    public function testLesBornesDeLaJourneeSePrevoientEtSeDetachent(): void
    {
        [$morning] = $this->repeat(0, self::work('07:00', '07:15', 'OPS-12', 'Matin'));
        [$evening] = $this->repeat(1, self::work('19:45', '20:00', 'OPS-7', 'Soir'));
        $names = [$morning => 'matin', $evening => 'soir'];
        $thursday = $this->day(self::THURSDAY);
        self::assertSame(['07:00-07:15 OPS-12 « Matin » ↻matin', '19:45-20:00 OPS-7 « Soir » ↻soir'], self::arrows($thursday, $names));
        self::assertSame(30, self::at($thursday, 'figures', 'worked'));

        $day = $this->write(self::intAt($thursday, 'version'), [self::pause('07:00', '07:15'), self::clear('19:45', '20:00')], self::THURSDAY);

        self::assertSame(['07:00-07:15 pause'], self::arrows($day, $names));
        self::assertSame(self::sortedSkips($morning, $evening), $this->skips());
        // Un quart d'heure de trop, au-delà de 20:00 : refusé, rien ne bouge.
        [$status] = $this->patchSlots(self::intAt($day, 'version'), [self::work('19:45', '20:15', 'OPS-7')], self::THURSDAY);
        self::assertSame(422, $status);
        self::assertSame(['07:00-07:15 pause'], self::arrows($this->day(self::THURSDAY), $names));
    }

    /**
     * Le jeudi tel que l'envoi l'a laissé : les mêmes blocs, le même travaillé, la même
     * version, et toujours envoyé, sur son bouton comme au calendrier. Rend la journée relue.
     *
     * @param array<mixed> $sent
     *
     * @return array<mixed>
     */
    private function assertSentAs(array $sent, string $when): array
    {
        $thursday = $this->day(self::THURSDAY);
        self::assertSame(self::blocks($sent), self::blocks($thursday), $when);
        self::assertSame(self::at($sent, 'figures', 'worked'), self::at($thursday, 'figures', 'worked'), $when);
        self::assertSame(self::intAt($sent, 'version'), self::intAt($thursday, 'version'), $when.' : un onglet resté ouvert n\'est pas en retard.');
        self::assertSame('sent', self::at($thursday, 'send', 'state'), $when);
        self::assertSame('sent', self::at($this->marks(), self::THURSDAY), $when);

        return $thursday;
    }

    /**
     * Ctrl+Z, comme la page l'envoie : les quarts d'heure d'avant le geste, et le drapeau d'annuler.
     *
     * @param list<array<string, mixed>> $changes
     *
     * @return array{int, array<mixed>}
     */
    private function restore(int $version, array $changes, string $date = self::TODAY): array
    {
        return $this->send('PATCH', '/api/days/'.$date.'/slots', ['version' => $version, 'changes' => $changes, 'restores' => true]);
    }

    /** Les envois en base, tous jours et comptes confondus. */
    private function sendRows(): int
    {
        $count = $this->connection()->fetchOne('SELECT COUNT(*) FROM day_send');
        self::assertIsNumeric($count);

        return (int) $count;
    }

    /**
     * Chaque paire de récurrences de la base : aucune ne croise l'autre après aujourd'hui, les
     * jours qu'un envoi ferme comptant pour aucune.
     */
    private function assertNoClash(): void
    {
        $container = static::getContainer();
        $container->get(EntityManagerInterface::class)->clear();
        $today = $container->get(UserCalendar::class)->today();
        $repository = $container->get(RecurrenceRepository::class);
        $recurrences = $repository->findAll();
        $skipped = $repository->skippedAfter($today);
        $closed = $container->get(DaySendRepository::class)->closedAfter($today);
        foreach ($recurrences as $one) {
            foreach ($recurrences as $other) {
                if ($one !== $other) {
                    self::assertNull(RecurrenceClash::first($one, $other, $today, $skipped, $closed), $one->id.' croise '.$other->id);
                }
            }
        }
    }

    /**
     * @return list<string>
     */
    private static function sortedSkips(string ...$recurrences): array
    {
        $skips = array_map(static fn (string $recurrence): string => $recurrence.' '.self::THURSDAY, $recurrences);
        sort($skips);

        return $skips;
    }

    /**
     * Les heures que le compte relié a dans le Jira simulé : « ticket jour secondes ».
     *
     * @return list<string>
     */
    private function worklogs(): array
    {
        $worklogs = [];
        foreach (self::listAt($this->jiraState(), 'worklogs') as $worklog) {
            if (Catalog::ACCOUNT_ID !== $worklog['authorId']) {
                continue;
            }
            $worklogs[] = self::stringAt($worklog, 'issueKey').' '.substr(self::stringAt($worklog, 'started'), 0, 10).' '.self::intAt($worklog, 'timeSpentSeconds');
        }
        sort($worklogs);

        return $worklogs;
    }
}
