<?php

namespace App\Tests\Api;

use App\Day\UserCalendar;
use App\Recurrence\RecurrenceClash;
use App\Repository\DaySendRepository;
use App\Repository\RecurrenceRepository;
use App\Tests\Support\DayApi;
use App\Tests\Support\RecurrenceApi;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

/**
 * Allonger, raccourcir, couper puis coller une récurrence avec les suivantes, par l'API
 * comme les envoie la grille. Allonger et raccourcir passent par la fenêtre, qui change les
 * heures à partir de ce jour : la plage d'avant, plus ce qui la prolonge du même ticket et du
 * même commentaire, moins ce qui en efface un bord, d'un seul tenant. Elle se coupe alors en
 * deux, et tout autre geste se refuse. Couper avec les suivantes l'arrête à partir de cette
 * fois, comme effacer ; coller en crée une neuve, là où l'on colle. Annuler et rétablir
 * chacun, sur un jour à venir où la fois n'est que prévue, le jour venu, le premier jour, aux
 * bornes de la grille, et depuis un onglet en retard ou un appelant hostile.
 *
 * L'heure est figée au mardi 6 octobre 2026, 15:20 à Paris : le Daily y naît, chaque jour
 * de la semaine.
 */
final class RecurrenceHoursTest extends WebTestCase
{
    use DayApi;
    use RecurrenceApi;

    private const string FIRST_DAY_BEFORE = '2026-10-05';

    private const string WEDNESDAY = '2026-10-07';

    private const string THURSDAY = '2026-10-08';

    private const string FRIDAY = '2026-10-09';

    private const string MONDAY = '2026-10-12';

    private const string NEXT_THURSDAY = '2026-10-15';

    /** Les jours qu'on regarde avant et après chaque geste. */
    private const array WEEK = [self::TODAY, self::WEDNESDAY, self::THURSDAY, self::FRIDAY, self::MONDAY, self::NEXT_THURSDAY];

    private const string NOT_ONE_RANGE = 'Une récurrence couvre une seule plage, d\'un seul ticket.';

    public function testAllongerParLeBasAvecLesSuivantesCoupeLaRecurrenceAPartirDeCeJour(): void
    {
        [$id] = $this->repeat(0, self::daily('09:15', '09:45'));
        $before = $this->week();

        // Le jeudi à venir, le même ticket et le même commentaire collés juste dessous.
        $longer = $this->saveRecurrence(self::intAt($this->day(self::THURSDAY), 'version'), [self::daily('09:45', '10:00')], self::weekly(), $id, self::THURSDAY);

        $new = self::stringAt($longer, 'untils', 1, 'recurrence');
        $names = [$id => 'daily', $new => 'allongé'];
        self::assertSame([
            ['recurrence' => $id, 'before' => null, 'after' => self::WEDNESDAY],
            ['recurrence' => $new, 'before' => self::WEDNESDAY, 'after' => null],
        ], $longer['untils']);
        self::assertSame(['09:15-10:00 OPS-12 « Daily » ↻allongé'], self::arrows($longer, $names), 'Un seul bloc, relié à la nouvelle.');
        self::assertSame([555 => $new, 570 => $new, 585 => $new], $this->links(self::THURSDAY), 'Écrite, le jour où la nouvelle naît.');
        self::assertSame(['start' => '09:15', 'end' => '10:00'], self::hours($longer, $new));
        self::assertSame(['firstDay' => self::THURSDAY, 'until' => null, 'posedThrough' => self::THURSDAY], $this->recurrenceRow($new));
        self::assertSame(45, self::at($longer, 'figures', 'worked'));
        // Les jours d'avant gardent l'ancienne ; ceux d'après prévoient la nouvelle, allongée.
        self::assertSame(['09:15-09:45 OPS-12 « Daily » ↻daily'], self::arrows($this->day(), $names));
        self::assertSame(['09:15-09:45 OPS-12 « Daily » ↻daily'], self::arrows($this->day(self::WEDNESDAY), $names));
        self::assertSame(['09:15-10:00 OPS-12 « Daily » ↻allongé'], self::arrows($this->day(self::FRIDAY), $names));
        self::assertSame(['09:15-10:00 OPS-12 « Daily » ↻allongé'], self::arrows($this->day(self::NEXT_THURSDAY), $names));
        $after = $this->week();

        // Annuler : la semaine d'avant, l'ancienne sans fin, la nouvelle retirée.
        $undone = $this->undo(self::intAt($longer, 'version'), [self::linked(self::daily('09:15', '09:45'), $id), self::clear('09:45', '10:00')], $longer, self::THURSDAY);
        self::assertSame($before, $this->week());
        self::assertSame([], $this->links(self::THURSDAY), 'De nouveau prévue, sans rien d\'écrit.');
        self::assertNull($this->recurrenceRow($id)['until']);
        self::assertSame(self::WEDNESDAY, $this->recurrenceRow($new)['until']);
        self::assertNotContains($id.' '.self::THURSDAY, $this->skips());

        // Rétablir refait l'allongement.
        $this->redo(self::intAt($undone, 'version'), [self::linked(self::daily('09:15', '10:00'), $new)], $longer, self::THURSDAY);
        self::assertSame($after, $this->week());
        self::assertSame([555 => $new, 570 => $new, 585 => $new], $this->links(self::THURSDAY));
        self::assertSame(self::WEDNESDAY, $this->recurrenceRow($id)['until']);
        self::assertNull($this->recurrenceRow($new)['until']);
        $this->assertNoClash();
    }

    public function testAllongerParLeHautAvecLesSuivantesLeJourVenu(): void
    {
        [$id] = $this->repeat(0, self::daily('09:15', '09:45'));
        self::mockTime('2026-10-08 08:00:00 Europe/Paris');
        $thursday = $this->day(self::THURSDAY);
        self::assertSame([555 => $id, 570 => $id], $this->links(self::THURSDAY), 'Posée, le jour venu.');
        $before = $this->week();

        $longer = $this->saveRecurrence(self::intAt($thursday, 'version'), [self::daily('09:00', '09:15')], self::weekly(), $id, self::THURSDAY);

        $new = self::stringAt($longer, 'untils', 1, 'recurrence');
        $names = [$id => 'daily', $new => 'allongé'];
        self::assertSame([
            ['recurrence' => $id, 'before' => null, 'after' => self::WEDNESDAY],
            ['recurrence' => $new, 'before' => self::WEDNESDAY, 'after' => null],
        ], $longer['untils']);
        self::assertSame(['09:00-09:45 OPS-12 « Daily » ↻allongé'], self::arrows($longer, $names));
        self::assertSame([540 => $new, 555 => $new, 570 => $new], $this->links(self::THURSDAY));
        self::assertSame(['start' => '09:00', 'end' => '09:45'], self::hours($longer, $new));
        self::assertSame([$id.' '.self::THURSDAY], $this->skips(), 'La coupe garde son saut.');
        // Les fois passées ne changent jamais.
        self::assertSame([555 => $id, 570 => $id], $this->links(self::WEDNESDAY));
        self::assertSame(['09:15-09:45 OPS-12 « Daily » ↻daily'], self::arrows($this->day(self::WEDNESDAY), $names));
        self::assertSame(['09:00-09:45 OPS-12 « Daily » ↻allongé'], self::arrows($this->day(self::FRIDAY), $names));
        $after = $this->week();

        $undone = $this->undo(self::intAt($longer, 'version'), [self::clear('09:00', '09:15'), self::linked(self::daily('09:15', '09:45'), $id)], $longer, self::THURSDAY);
        self::assertSame($before, $this->week());
        self::assertSame([555 => $id, 570 => $id], $this->links(self::THURSDAY));
        self::assertNotContains($id.' '.self::THURSDAY, $this->skips());
        self::assertNull($this->recurrenceRow($id)['until']);

        $this->redo(self::intAt($undone, 'version'), [self::linked(self::daily('09:00', '09:45'), $new)], $longer, self::THURSDAY);
        self::assertSame($after, $this->week());
        self::assertSame([540 => $new, 555 => $new, 570 => $new], $this->links(self::THURSDAY));
        $this->assertNoClash();
    }

    public function testAllongerDesDeuxCotesALaFois(): void
    {
        [$id] = $this->repeat(0, self::daily('09:15', '09:45'));
        $before = $this->week();

        // Collé au-dessus et au-dessous d'un coup, ou par-dessus le bloc entier : le même allongement.
        foreach ([
            'de part et d\'autre' => [self::daily('09:00', '09:15'), self::daily('09:45', '10:00')],
            'par-dessus le bloc' => [self::daily('09:00', '10:00')],
        ] as $case => $changes) {
            $longer = $this->saveRecurrence(self::intAt($this->day(self::FRIDAY), 'version'), $changes, self::weekly(), $id, self::FRIDAY);

            $new = self::stringAt($longer, 'untils', 1, 'recurrence');
            $names = [$id => 'daily', $new => 'allongé'];
            self::assertSame([
                ['recurrence' => $id, 'before' => null, 'after' => self::THURSDAY],
                ['recurrence' => $new, 'before' => self::THURSDAY, 'after' => null],
            ], $longer['untils'], $case);
            self::assertSame(['09:00-10:00 OPS-12 « Daily » ↻allongé'], self::arrows($longer, $names), $case);
            self::assertSame([540 => $new, 555 => $new, 570 => $new, 585 => $new], $this->links(self::FRIDAY), $case);
            self::assertSame(['start' => '09:00', 'end' => '10:00'], self::hours($longer, $new), $case);
            self::assertSame(['09:15-09:45 OPS-12 « Daily » ↻daily'], self::arrows($this->day(self::THURSDAY), $names), $case);
            self::assertSame(['09:00-10:00 OPS-12 « Daily » ↻allongé'], self::arrows($this->day(self::MONDAY), $names), $case);
            $after = $this->week();

            // Annuler, rétablir, puis annuler encore : le cas suivant part de la même semaine.
            $undo = [self::clear('09:00', '09:15'), self::linked(self::daily('09:15', '09:45'), $id), self::clear('09:45', '10:00')];
            $undone = $this->undo(self::intAt($longer, 'version'), $undo, $longer, self::FRIDAY);
            self::assertSame($before, $this->week(), $case);
            self::assertSame([], $this->links(self::FRIDAY), $case);
            $redone = $this->redo(self::intAt($undone, 'version'), [self::linked(self::daily('09:00', '10:00'), $new)], $longer, self::FRIDAY);
            self::assertSame($after, $this->week(), $case);
            $this->undo(self::intAt($redone, 'version'), $undo, $longer, self::FRIDAY);
            self::assertSame($before, $this->week(), $case);
        }
        $this->assertNoClash();
    }

    public function testAllongerLePremierJourRetireLAncienne(): void
    {
        [$id] = $this->repeat(0, self::daily('09:15', '09:45'));
        $before = $this->week();

        $longer = $this->saveRecurrence(1, [self::daily('09:45', '10:00')], self::weekly(), $id);

        $new = self::stringAt($longer, 'untils', 1, 'recurrence');
        $names = [$id => 'daily', $new => 'allongé'];
        self::assertSame([
            ['recurrence' => $id, 'before' => null, 'after' => self::FIRST_DAY_BEFORE],
            ['recurrence' => $new, 'before' => self::FIRST_DAY_BEFORE, 'after' => null],
        ], $longer['untils'], 'Retirée, pas coupée : pour l\'utilisateur, la récurrence s\'allonge en place.');
        self::assertSame(['09:15-10:00 OPS-12 « Daily » ↻allongé'], self::arrows($longer, $names));
        self::assertSame([555 => $new, 570 => $new, 585 => $new], $this->links());
        self::assertSame(2, $this->recurrenceRows(), 'Retirée, pas supprimée : annuler la rend.');
        self::assertSame([$new], array_keys(self::arrayAt($this->day(self::THURSDAY), 'ongoing')));
        self::assertSame(['09:15-10:00 OPS-12 « Daily » ↻allongé'], self::arrows($this->day(self::THURSDAY), $names));
        $after = $this->week();

        $undone = $this->undo(self::intAt($longer, 'version'), [self::linked(self::daily('09:15', '09:45'), $id), self::clear('09:45', '10:00')], $longer);
        self::assertSame($before, $this->week());
        self::assertSame([555 => $id, 570 => $id], $this->links());
        self::assertNull($this->recurrenceRow($id)['until']);
        self::assertSame(self::FIRST_DAY_BEFORE, $this->recurrenceRow($new)['until']);
        self::assertNotContains($id.' '.self::TODAY, $this->skips());

        $this->redo(self::intAt($undone, 'version'), [self::linked(self::daily('09:15', '10:00'), $new)], $longer);
        self::assertSame($after, $this->week());
        self::assertSame(self::FIRST_DAY_BEFORE, $this->recurrenceRow($id)['until']);
        $this->assertNoClash();
    }

    public function testRaccourcirParLeBasAvecLesSuivantesSurUnJourAVenir(): void
    {
        [$id] = $this->repeat(0, self::daily('09:00', '10:00'));
        $before = $this->week();

        // Le bas du bloc effacé : ce qui reste est la nouvelle, le bord effacé est vide.
        $shorter = $this->saveRecurrence(self::intAt($this->day(self::THURSDAY), 'version'), [self::clear('09:45', '10:00')], self::weekly(), $id, self::THURSDAY);

        $new = self::stringAt($shorter, 'untils', 1, 'recurrence');
        $names = [$id => 'daily', $new => 'raccourci'];
        self::assertSame([
            ['recurrence' => $id, 'before' => null, 'after' => self::WEDNESDAY],
            ['recurrence' => $new, 'before' => self::WEDNESDAY, 'after' => null],
        ], $shorter['untils']);
        self::assertSame(['09:00-09:45 OPS-12 « Daily » ↻raccourci'], self::arrows($shorter, $names));
        self::assertSame([540 => $new, 555 => $new, 570 => $new], $this->links(self::THURSDAY), 'Le quart d\'heure effacé n\'est pas écrit.');
        self::assertSame(['start' => '09:00', 'end' => '09:45'], self::hours($shorter, $new));
        self::assertSame(45, self::at($shorter, 'figures', 'worked'));
        self::assertSame(['09:00-10:00 OPS-12 « Daily » ↻daily'], self::arrows($this->day(self::WEDNESDAY), $names));
        self::assertSame(['09:00-09:45 OPS-12 « Daily » ↻raccourci'], self::arrows($this->day(self::FRIDAY), $names));
        $after = $this->week();

        $undone = $this->undo(self::intAt($shorter, 'version'), [self::linked(self::daily('09:00', '10:00'), $id)], $shorter, self::THURSDAY);
        self::assertSame($before, $this->week());
        self::assertSame([], $this->links(self::THURSDAY));
        self::assertNull($this->recurrenceRow($id)['until']);
        self::assertSame(self::WEDNESDAY, $this->recurrenceRow($new)['until']);

        $this->redo(self::intAt($undone, 'version'), [self::linked(self::daily('09:00', '09:45'), $new), self::clear('09:45', '10:00')], $shorter, self::THURSDAY);
        self::assertSame($after, $this->week());
        self::assertSame([540 => $new, 555 => $new, 570 => $new], $this->links(self::THURSDAY));
        $this->assertNoClash();
    }

    public function testRaccourcirParLeHautAvecLesSuivantesLeJourVenu(): void
    {
        [$id] = $this->repeat(0, self::daily('09:00', '10:00'));
        self::mockTime('2026-10-08 08:00:00 Europe/Paris');
        $thursday = $this->day(self::THURSDAY);
        $before = $this->week();

        // Le haut effacé, sur plusieurs quarts d'heure.
        $shorter = $this->saveRecurrence(self::intAt($thursday, 'version'), [self::clear('09:00', '09:30')], self::weekly(), $id, self::THURSDAY);

        $new = self::stringAt($shorter, 'untils', 1, 'recurrence');
        $names = [$id => 'daily', $new => 'raccourci'];
        self::assertSame(['09:30-10:00 OPS-12 « Daily » ↻raccourci'], self::arrows($shorter, $names));
        self::assertSame([570 => $new, 585 => $new], $this->links(self::THURSDAY));
        self::assertSame(['start' => '09:30', 'end' => '10:00'], self::hours($shorter, $new));
        self::assertSame([$id.' '.self::THURSDAY], $this->skips());
        self::assertSame([540 => $id, 555 => $id, 570 => $id, 585 => $id], $this->links(self::WEDNESDAY), 'Les fois passées ne changent jamais.');
        self::assertSame(['09:30-10:00 OPS-12 « Daily » ↻raccourci'], self::arrows($this->day(self::NEXT_THURSDAY), $names));
        $after = $this->week();

        $undone = $this->undo(self::intAt($shorter, 'version'), [self::linked(self::daily('09:00', '10:00'), $id)], $shorter, self::THURSDAY);
        self::assertSame($before, $this->week());
        self::assertSame([540 => $id, 555 => $id, 570 => $id, 585 => $id], $this->links(self::THURSDAY));
        self::assertNotContains($id.' '.self::THURSDAY, $this->skips());

        $this->redo(self::intAt($undone, 'version'), [self::clear('09:00', '09:30'), self::linked(self::daily('09:30', '10:00'), $new)], $shorter, self::THURSDAY);
        self::assertSame($after, $this->week());
        $this->assertNoClash();
    }

    public function testAllongerGardeLesFoisEffaceesEtRetenuesDeLAncienne(): void
    {
        [$id] = $this->repeat(0, self::daily('09:15', '09:45'));
        // Sa fois du vendredi effacée, cette fois seulement ; le lundi mis à 0h00 d'avance.
        $this->write(self::intAt($this->day(self::FRIDAY), 'version'), [self::clear('09:15', '09:45')], self::FRIDAY);
        [$status] = $this->putObjective(self::intAt($this->day(self::MONDAY), 'version'), 0, self::MONDAY);
        self::assertSame(200, $status);

        $longer = $this->saveRecurrence(self::intAt($this->day(self::THURSDAY), 'version'), [self::daily('09:45', '10:00')], self::weekly(), $id, self::THURSDAY);

        $new = self::stringAt($longer, 'untils', 1, 'recurrence');
        $names = [$new => 'allongé'];
        self::assertSame([self::FRIDAY], self::arrayAt($longer, 'recurrences', $new, 'skipped'));
        self::assertSame([], self::listAt($this->day(self::FRIDAY), 'blocks'), 'La fois effacée ne revient pas, pas même allongée.');
        self::assertSame([], self::listAt($this->day(self::MONDAY), 'blocks'));
        self::assertSame(['09:15-10:00 OPS-12 « Daily » ↻allongé'], self::arrows($this->day(self::NEXT_THURSDAY), $names));

        // Le lundi revenu à son objectif reçoit la nouvelle, allongée.
        [$status, $monday] = $this->putObjective(self::intAt($this->day(self::MONDAY), 'version'), 450, self::MONDAY);
        self::assertSame(200, $status, json_encode($monday, \JSON_THROW_ON_ERROR));
        self::assertSame(['09:15-10:00 OPS-12 « Daily » ↻allongé'], self::arrows($monday, $names));
        $this->assertNoClash();
    }

    public function testChangerLesHeuresAutrementQuEnAllongeantOuRaccourcissantSeRefuse(): void
    {
        [$id] = $this->repeat(0, self::daily('09:00', '10:00'));
        $before = $this->written();
        $thursday = self::intAt($this->day(self::THURSDAY), 'version');

        foreach ([
            'un effacement au milieu' => [self::clear('09:30', '09:45')],
            'tout effacé' => [self::clear('09:00', '10:00')],
            'les deux bords effacés, et tout le reste' => [self::clear('09:00', '09:30'), self::clear('09:30', '10:00')],
            'un autre ticket dessous' => [self::work('10:00', '10:15', 'OPS-7', 'Daily')],
            'un autre commentaire dessous' => [self::work('10:00', '10:15', 'OPS-12', 'Rétro')],
            'sans commentaire, dessus' => [self::work('08:45', '09:00', 'OPS-12')],
            'une pause dessus' => [self::pause('08:45', '09:00')],
            'un autre commentaire sur le bloc et dessous' => [self::work('09:00', '10:15', 'OPS-12', 'Rétro')],
            'raccourci et changé d\'un coup' => [self::clear('09:00', '09:15'), self::work('09:15', '10:00', 'OPS-12', 'Rétro')],
            'allongé de deux contenus' => [self::daily('10:00', '10:15'), self::work('10:15', '10:30', 'OPS-12', 'Rétro')],
            'un prolongement qui laisse un trou' => [self::daily('10:15', '10:30')],
            'allongé d\'un côté, un trou de l\'autre' => [self::daily('10:00', '10:15'), self::daily('08:30', '08:45')],
            'un effacement hors de sa plage' => [self::clear('10:00', '10:15')],
            'déplacée ailleurs, sa plage effacée' => [self::clear('09:00', '10:00'), self::daily('14:00', '15:00')],
            'décalée, un bord effacé et l\'autre allongé' => [self::clear('09:00', '09:15'), self::daily('10:00', '10:15')],
        ] as $case => $changes) {
            foreach ([self::TODAY => 1, self::THURSDAY => $thursday] as $date => $version) {
                [$status, $body] = $this->putRecurrence($version, $changes, self::weekly(), $id, $date);
                self::assertSame(422, $status, $case.' '.$date.' : '.json_encode($body, \JSON_THROW_ON_ERROR));
                self::assertSame([['field' => 'changes', 'message' => self::NOT_ONE_RANGE]], $body['violations'], $case);
            }
        }

        self::assertSame($before, $this->written(), 'Ni coupe, ni bloc, ni version.');
        self::assertSame(1, $this->recurrenceRows());

        // Les mêmes gestes passent cette fois seulement, par la grille.
        $day = $this->write($thursday, [self::clear('09:30', '09:45')], self::THURSDAY);
        self::assertSame(['09:00-09:30 OPS-12 « Daily »', '09:45-10:00 OPS-12 « Daily »'], self::arrows($day), 'Détachée, la fois perd sa flèche.');
        self::assertNull($this->recurrenceRow($id)['until']);
    }

    public function testDepuisUnJourPasseLesHeuresNeChangentPas(): void
    {
        [$id] = $this->repeat(0, self::daily('09:00', '10:00'));
        self::mockTime('2026-10-08 08:00:00 Europe/Paris');
        foreach ([self::TODAY, self::WEDNESDAY] as $date) {
            $version = self::intAt($this->day($date), 'version');
            $before = $this->written();

            // La page ne le demande jamais d'un jour passé : un appelant hostile.
            foreach ([
                'allongée par le bas' => [self::daily('10:00', '10:15')],
                'allongée par le haut' => [self::daily('08:45', '09:00')],
                'raccourcie' => [self::clear('09:45', '10:00')],
            ] as $case => $changes) {
                [$status, $body] = $this->putRecurrence($version, $changes, self::weekly(), $id, $date);
                self::assertSame(422, $status, $case.' '.$date.' : '.json_encode($body, \JSON_THROW_ON_ERROR));
                self::assertSame([['field' => 'changes', 'message' => self::NOT_ONE_RANGE]], $body['violations'], $case);
            }

            self::assertSame($before, $this->written(), $date);
            self::assertNull($this->recurrenceRow($id)['until']);
            self::assertSame([540 => $id, 555 => $id, 570 => $id, 585 => $id], $this->links($date));
        }
    }

    public function testAllongerSurLeCreneauDUneAutreRecurrenceSeRefuse(): void
    {
        [$daily] = $this->repeat(0, self::daily('09:15', '09:45'));
        // Le support, chaque vendredi à partir du 9, juste sous le Daily.
        [$support] = $this->repeatWith(self::intAt($this->day(self::FRIDAY), 'version'), self::support(), self::weekly([5]), self::FRIDAY);
        $before = $this->written();

        // Allongé dessous à partir du jeudi, ou d'aujourd'hui : le vendredi 9 est pris.
        foreach ([self::THURSDAY => self::intAt($this->day(self::THURSDAY), 'version'), self::TODAY => 1] as $date => $version) {
            [$status, $body] = $this->putRecurrence($version, [self::daily('09:45', '10:00')], self::weekly(), $daily, $date);
            self::assertSame(422, $status, $date.' : '.json_encode($body, \JSON_THROW_ON_ERROR));
            self::assertSame(self::taken('Support'), $body['violations'], $date);
        }
        self::assertSame($before, $this->written(), 'Ni coupe, ni bloc, ni version.');
        self::assertNull($this->recurrenceRow($daily)['until']);

        // Par le haut, rien n'est pris : il passe, et rien ne se croise.
        $day = $this->saveRecurrence(self::intAt($this->day(self::THURSDAY), 'version'), [self::daily('09:00', '09:15')], self::weekly(), $daily, self::THURSDAY);
        $new = self::stringAt($day, 'untils', 1, 'recurrence');
        $names = [$new => 'allongé', $support => 'support'];
        self::assertSame(['09:00-09:45 OPS-12 « Daily » ↻allongé', '09:45-10:00 OPS-7 « Support » ↻support'], self::arrows($this->day(self::FRIDAY), $names));
        $this->assertNoClash();
    }

    public function testAllongerSurUneSaisieOrdinaireNEstPasUnConflit(): void
    {
        [$daily] = $this->repeat(0, self::daily('09:15', '09:45'));
        // Saisi à la main le vendredi et le lundi, juste sous le Daily.
        $this->write(self::intAt($this->day(self::FRIDAY), 'version'), [self::work('09:45', '10:00', 'SHOP-482')], self::FRIDAY);
        $this->write(self::intAt($this->day(self::MONDAY), 'version'), [self::work('09:45', '10:00', 'SHOP-482', 'Tests')], self::MONDAY);

        $day = $this->saveRecurrence(self::intAt($this->day(self::THURSDAY), 'version'), [self::daily('09:45', '10:00')], self::weekly(), $daily, self::THURSDAY);

        $new = self::stringAt($day, 'untils', 1, 'recurrence');
        $names = [$new => 'allongé'];
        self::assertSame(['09:15-10:00 OPS-12 « Daily » ↻allongé'], self::arrows($day, $names));
        self::assertSame(['09:15-09:45 OPS-12 « Daily » ↻allongé', '09:45-10:00 SHOP-482'], self::arrows($this->day(self::FRIDAY), $names), 'La saisie garde son créneau.');
        self::assertSame(['09:15-09:45 OPS-12 « Daily » ↻allongé', '09:45-10:00 SHOP-482 « Tests »'], self::arrows($this->day(self::MONDAY), $names));
        self::assertSame(45, self::at($this->day(self::FRIDAY), 'figures', 'worked'), 'Aucun quart d\'heure compté deux fois.');

        // Le vendredi venu, la nouvelle s'y pose autour de la saisie.
        self::mockTime('2026-10-09 08:00:00 Europe/Paris');
        self::assertSame(['09:15-09:45 OPS-12 « Daily » ↻allongé', '09:45-10:00 SHOP-482'], self::arrows($this->day(self::FRIDAY), $names));
        self::assertSame([555 => $new, 570 => $new, 585 => null], $this->links(self::FRIDAY));
        $this->assertNoClash();
    }

    public function testUnOngletEnRetardNAllongePasEtUnDoubleClicNEcritQuUneFois(): void
    {
        [$id, $created] = $this->repeat(0, self::daily('09:15', '09:45'));

        // L'onglet 1 lit le jeudi ; l'onglet 2 y saisit autre chose.
        $seen = $this->day(self::THURSDAY);
        $this->write(self::intAt($seen, 'version'), [self::work('14:00', '14:15', 'SHOP-482')], self::THURSDAY);
        $before = $this->written();
        foreach ([[self::daily('09:45', '10:00')], [self::clear('09:30', '09:45')]] as $changes) {
            [$status, $body] = $this->putRecurrence(self::intAt($seen, 'version'), $changes, self::weekly(), $id, self::THURSDAY);
            self::assertSame(409, $status, json_encode($body, \JSON_THROW_ON_ERROR));
            self::assertSame('stale', $body['error']);
        }
        self::assertSame($before, $this->written());

        // L'onglet 1 relit le jeudi, fenêtre du Daily comprise ; l'onglet 2 lui donne une fin,
        // en place, depuis aujourd'hui : le jeudi ne change pas de version.
        $seen = $this->day(self::THURSDAY);
        $seenDaily = $this->seen($id);
        $this->saveRecurrence(self::intAt($created, 'version'), [self::daily('09:15', '09:45')], self::weekly(until: '2026-10-30'), $id);
        self::assertSame($seen['version'], $this->day(self::THURSDAY)['version']);
        $before = $this->written();
        [$status, $body] = $this->send('PUT', '/api/days/'.self::THURSDAY.'/recurrence', ['version' => self::intAt($seen, 'version'), 'changes' => [self::daily('09:45', '10:00')], 'recurrence' => self::weekly(), 'replaces' => $seenDaily]);
        self::assertSame(409, $status, 'La fenêtre a vu une autre fin : '.json_encode($body, \JSON_THROW_ON_ERROR));
        self::assertSame($before, $this->written());
        self::assertSame('2026-10-30', $this->recurrenceRow($id)['until']);

        // Allonger, envoyé deux fois de suite : la seconde arrive en retard.
        $request = ['version' => self::intAt($seen, 'version'), 'changes' => [self::daily('09:45', '10:00')], 'recurrence' => self::weekly(until: '2026-10-30'), 'replaces' => $this->seen($id)];
        [$first, $day] = $this->send('PUT', '/api/days/'.self::THURSDAY.'/recurrence', $request);
        self::assertSame(200, $first, json_encode($day, \JSON_THROW_ON_ERROR));
        $written = $this->written();
        [$second, $body] = $this->send('PUT', '/api/days/'.self::THURSDAY.'/recurrence', $request);
        self::assertSame(409, $second);
        self::assertSame('stale', $body['error']);
        self::assertSame($written, $this->written(), 'Le second envoi n\'écrit rien.');

        $new = self::stringAt($day, 'untils', 1, 'recurrence');
        self::assertSame(2, $this->recurrenceRows(), 'Une seule coupe.');
        self::assertSame([555 => $new, 570 => $new, 585 => $new, 840 => null], $this->links(self::THURSDAY));
        self::assertSame(['09:15-10:00 OPS-12 « Daily » ↻allongé', '14:00-14:15 SHOP-482'], self::arrows($this->day(self::THURSDAY), [$new => 'allongé']));
        self::assertSame('2026-10-30', $this->recurrenceRow($new)['until'], 'La nouvelle garde sa fin.');
        $this->assertNoClash();
    }

    public function testLesBornesDeLaGrilleSAllongentEtPasAuDela(): void
    {
        [$morning] = $this->repeat(0, self::work('07:15', '07:30', 'OPS-12', 'Matin'));
        [$evening] = $this->repeat(1, self::work('19:30', '19:45', 'OPS-7', 'Soir'));
        $version = self::intAt($this->day(self::THURSDAY), 'version');
        $before = $this->written();

        // Un quart d'heure de trop, d'un côté ou de l'autre : refusé sous son champ, rien ne bouge.
        foreach ([
            [self::work('06:45', '07:15', 'OPS-12', 'Matin'), $morning, 'changes[0].start'],
            [self::work('19:45', '20:15', 'OPS-7', 'Soir'), $evening, 'changes[0].end'],
        ] as [$change, $id, $field]) {
            [$status, $body] = $this->putRecurrence($version, [$change], self::weekly(), $id, self::THURSDAY);
            self::assertSame(422, $status, $field);
            self::assertContains($field, array_column(self::listAt($body, 'violations'), 'field'));
        }
        self::assertSame($before, $this->written());

        // Jusqu'à 07:00, et jusqu'à 20:00.
        $day = $this->saveRecurrence($version, [self::work('07:00', '07:15', 'OPS-12', 'Matin')], self::weekly(), $morning, self::THURSDAY);
        $longMorning = self::stringAt($day, 'untils', 1, 'recurrence');
        $day = $this->saveRecurrence(self::intAt($day, 'version'), [self::work('19:45', '20:00', 'OPS-7', 'Soir')], self::weekly(), $evening, self::THURSDAY);
        $longEvening = self::stringAt($day, 'untils', 1, 'recurrence');

        $names = [$longMorning => 'matin', $longEvening => 'soir'];
        self::assertSame(['07:00-07:30 OPS-12 « Matin » ↻matin', '19:30-20:00 OPS-7 « Soir » ↻soir'], self::arrows($day, $names));
        self::assertSame([420 => $longMorning, 435 => $longMorning, 1170 => $longEvening, 1185 => $longEvening], $this->links(self::THURSDAY));
        self::assertSame(['start' => '07:00', 'end' => '07:30'], self::hours($day, $longMorning));
        self::assertSame(['start' => '19:30', 'end' => '20:00'], self::hours($day, $longEvening));
        self::assertSame(['07:00-07:30 OPS-12 « Matin » ↻matin', '19:30-20:00 OPS-7 « Soir » ↻soir'], self::arrows($this->day(self::FRIDAY), $names));

        // Raccourcies jusqu'à un seul quart d'heure, au bord de la grille.
        $day = $this->saveRecurrence(self::intAt($this->day(self::FRIDAY), 'version'), [self::clear('07:15', '07:30')], self::weekly(), $longMorning, self::FRIDAY);
        $shortMorning = self::stringAt($day, 'untils', 1, 'recurrence');
        $day = $this->saveRecurrence(self::intAt($day, 'version'), [self::clear('19:30', '19:45')], self::weekly(), $longEvening, self::FRIDAY);
        $shortEvening = self::stringAt($day, 'untils', 1, 'recurrence');
        self::assertSame(['07:00-07:15 OPS-12 « Matin » ↻matin', '19:45-20:00 OPS-7 « Soir » ↻soir'], self::arrows($this->day(self::MONDAY), [$shortMorning => 'matin', $shortEvening => 'soir']));
        $this->assertNoClash();
    }

    public function testCouperAvecLesSuivantesPuisCollerUnAutreJourDeLaSemaine(): void
    {
        // Le poker planning, un mardi sur deux, de 10:00 à 10:30, depuis aujourd'hui.
        [$poker] = $this->repeatWith(0, self::poker('10:00', '10:30'), self::everyWeeks(2, [2]));
        $names = [$poker => 'poker'];
        $tuesday = $this->day('2026-10-20');
        self::assertSame(['10:00-10:30 OPS-12 « Poker planning » ↻poker'], self::arrows($tuesday, $names));

        // Coupé avec les suivantes le mardi 20 : arrêté à partir de cette fois, comme effacé.
        $cut = $this->saveRecurrence(self::intAt($tuesday, 'version'), [self::clear('10:00', '10:30')], null, $poker, '2026-10-20');
        self::assertSame([['recurrence' => $poker, 'before' => null, 'after' => '2026-10-19']], $cut['untils']);
        self::assertSame([], self::listAt($cut, 'blocks'));
        self::assertSame([], self::listAt($this->day('2026-11-03'), 'blocks'));

        // Collé le mercredi 21 à 10:00 : un mercredi sur deux, à partir de ce jour.
        [$pasted, $day] = $this->repeatWith(self::intAt($this->day('2026-10-21'), 'version'), self::poker('10:00', '10:30'), self::everyWeeks(2, [3]), '2026-10-21');
        $names[$pasted] = 'collé';
        self::assertSame(['10:00-10:30 OPS-12 « Poker planning » ↻collé'], self::arrows($day, $names));
        self::assertSame(['firstDay' => '2026-10-21', 'until' => null, 'posedThrough' => '2026-10-21'], $this->recurrenceRow($pasted));
        self::assertSame(['10:00-10:30 OPS-12 « Poker planning » ↻collé'], self::arrows($this->day('2026-11-04'), $names));
        self::assertSame([], self::listAt($this->day('2026-10-28'), 'blocks'), 'Un mercredi sur deux.');
        self::assertSame([], self::listAt($this->day('2026-11-03'), 'blocks'));
        self::assertSame(['10:00-10:30 OPS-12 « Poker planning » ↻poker'], self::arrows($this->day(), $names), 'Les fois d\'avant la coupe ne changent pas.');
        $this->assertNoClash();

        // Annuler le collage la retire ; annuler la coupe rend l'ancienne.
        $undone = $this->undo(self::intAt($day, 'version'), [self::clear('10:00', '10:30')], $day, '2026-10-21');
        self::assertSame([], self::listAt($undone, 'blocks'));
        self::assertSame('2026-10-20', $this->recurrenceRow($pasted)['until']);
        self::assertSame([], self::listAt($this->day('2026-11-04'), 'blocks'));
        $this->undo(self::intAt($cut, 'version'), [self::linked(self::poker('10:00', '10:30'), $poker)], $cut, '2026-10-20');
        self::assertNull($this->recurrenceRow($poker)['until']);
        self::assertSame(['10:00-10:30 OPS-12 « Poker planning » ↻poker'], self::arrows($this->day('2026-10-20'), $names));
        self::assertSame(['10:00-10:30 OPS-12 « Poker planning » ↻poker'], self::arrows($this->day('2026-11-03'), $names));
        self::assertSame([], $this->links('2026-10-20'), 'De nouveau prévue, sans rien d\'écrit.');
        $this->assertNoClash();
    }

    public function testCouperAvecLesSuivantesPuisCollerUnAutreJourDuMois(): void
    {
        // La démo, le 3e vendredi du mois, depuis le vendredi 16 octobre.
        [$demo] = $this->repeatWith(self::intAt($this->day('2026-10-16'), 'version'), self::demo(), self::monthlyWeekday(5, 3), '2026-10-16');
        $names = [$demo => 'démo'];

        // Coupée avec les suivantes le jour même de sa première fois : retirée.
        $cut = $this->saveRecurrence(self::intAt($this->day('2026-10-16'), 'version'), [self::clear('14:00', '15:00')], null, $demo, '2026-10-16');
        self::assertSame([['recurrence' => $demo, 'before' => null, 'after' => '2026-10-15']], $cut['untils']);
        self::assertSame([], self::listAt($cut, 'blocks'));

        // Collée le jeudi 22, le 4e jeudi du mois.
        [$pasted, $day] = $this->repeatWith(self::intAt($this->day('2026-10-22'), 'version'), self::demo(), self::monthlyWeekday(4, 4), '2026-10-22');
        $names[$pasted] = 'collée';
        self::assertSame(['14:00-15:00 OPS-12 « Démo » ↻collée'], self::arrows($day, $names));
        self::assertSame(['kind' => 'monthly_weekday', 'weekdays' => [4], 'monthWeek' => 4], array_intersect_key(self::arrayAt($day, 'recurrences', $pasted), ['kind' => 0, 'weekdays' => 0, 'monthWeek' => 0]));
        self::assertSame([], self::listAt($this->day('2026-10-29'), 'blocks'), 'Le 5e jeudi n\'est pas le 4e.');
        self::assertSame([], self::listAt($this->day('2026-10-16'), 'blocks'));
        $this->assertNoClash();

        // Annuler le collage la retire ; annuler la coupe rend l'ancienne.
        $unpasted = $this->undo(self::intAt($day, 'version'), [self::clear('14:00', '15:00')], $day, '2026-10-22');
        self::assertSame([], self::listAt($unpasted, 'blocks'));
        self::assertSame('2026-10-21', $this->recurrenceRow($pasted)['until']);
        $uncut = $this->undo(self::intAt($cut, 'version'), [self::linked(self::demo(), $demo)], $cut, '2026-10-16');
        self::assertSame(['14:00-15:00 OPS-12 « Démo » ↻démo'], self::arrows($uncut, $names));
        self::assertNull($this->recurrenceRow($demo)['until']);

        // Rétablir l'un puis l'autre : en novembre, le 3e vendredi est libre, le 4e jeudi pris.
        $this->redo(self::intAt($uncut, 'version'), [self::clear('14:00', '15:00')], $cut, '2026-10-16');
        $this->redo(self::intAt($unpasted, 'version'), [self::linked(self::demo(), $pasted)], $day, '2026-10-22');
        self::mockTime('2026-11-19 08:00:00 Europe/Paris');
        self::assertSame([], self::listAt($this->day('2026-11-20'), 'blocks'));
        self::assertSame(['14:00-15:00 OPS-12 « Démo » ↻collée'], self::arrows($this->day('2026-11-26'), $names), 'Le 4e jeudi de novembre.');
        self::assertSame([], self::listAt($this->day('2026-11-19'), 'blocks'));
        $this->assertNoClash();
    }

    public function testCollerUneRecurrenceCoupeeSurUnCreneauPrisSeRefuse(): void
    {
        [$poker] = $this->repeatWith(0, self::poker('10:00', '10:30'), self::everyWeeks(2, [2]));
        // La rétrospective, chaque mercredi à partir du 28 octobre, de 10:00 à 11:00.
        $this->repeatWith(self::intAt($this->day('2026-10-28'), 'version'), self::work('10:00', '11:00', 'OPS-7', 'Rétrospective'), self::weekly([3]), '2026-10-28');
        $this->saveRecurrence(self::intAt($this->day('2026-10-20'), 'version'), [self::clear('10:00', '10:30')], null, $poker, '2026-10-20');
        $before = $this->written();
        $version = self::intAt($this->day('2026-10-21'), 'version');

        // Un mercredi sur deux depuis le 21, à 10:00 : la rétrospective le prend le 4 novembre.
        [$status, $body] = $this->putRecurrence($version, [self::poker('10:00', '10:30')], self::everyWeeks(2, [3]), date: '2026-10-21');

        self::assertSame(422, $status, json_encode($body, \JSON_THROW_ON_ERROR));
        self::assertSame(self::taken('Rétrospective'), $body['violations']);
        self::assertSame($before, $this->written(), 'Rien n\'est collé.');
        self::assertSame([], self::listAt($this->day('2026-10-21'), 'blocks'));

        // Collé à 11:00, le créneau est libre.
        [$pasted, $day] = $this->repeatWith($version, self::poker('11:00', '11:30'), self::everyWeeks(2, [3]), '2026-10-21');
        self::assertSame(['11:00-11:30 OPS-12 « Poker planning » ↻collé'], self::arrows($day, [$pasted => 'collé']));
        $this->assertNoClash();
    }

    public function testDeplacerUneRecurrenceGardeSesFoisDetacheesEffaceesEtRetenues(): void
    {
        [$id] = $this->repeat(0, self::daily('09:15', '09:45'));
        // Sa fois du jeudi détachée, celle du vendredi effacée, cette fois seulement ; le lundi mis à 0h00 d'avance.
        $this->write(self::intAt($this->day(self::THURSDAY), 'version'), [self::work('09:15', '09:30', 'OPS-7', 'Support')], self::THURSDAY);
        $this->write(self::intAt($this->day(self::FRIDAY), 'version'), [self::clear('09:15', '09:45')], self::FRIDAY);
        [$status] = $this->putObjective(self::intAt($this->day(self::MONDAY), 'version'), 0, self::MONDAY);
        self::assertSame(200, $status);
        $skipped = [$id.' '.self::THURSDAY, $id.' '.self::FRIDAY, $id.' '.self::MONDAY];
        self::assertSame($skipped, $this->skips());

        // Coupé avec les suivantes ce mardi, puis collé à 10:00 le même jour, au même rythme.
        $cut = $this->saveRecurrence(self::intAt($this->day(), 'version'), [self::clear('09:15', '09:45')], null, $id);
        $before = $this->week();
        $pasted = $this->saveRecurrence(self::intAt($cut, 'version'), [self::daily('10:00', '10:30')], self::weekly(), null, self::TODAY, $id);

        $new = self::stringAt($pasted, 'untils', 0, 'recurrence');
        $names = [$new => 'collé'];
        self::assertSame([['recurrence' => $new, 'before' => self::FIRST_DAY_BEFORE, 'after' => null]], $pasted['untils']);
        self::assertSame([self::THURSDAY, self::FRIDAY], self::arrayAt($pasted, 'recurrences', $new, 'skipped'));
        $carried = [...$skipped, $new.' '.self::THURSDAY, $new.' '.self::FRIDAY, $new.' '.self::MONDAY];
        sort($carried);
        self::assertSame($carried, $this->skips(), 'La coupée garde les siennes, la nouvelle les reprend.');
        self::assertSame(['10:00-10:30 OPS-12 « Daily » ↻collé'], self::arrows($this->day(self::WEDNESDAY), $names));
        self::assertSame(['09:15-09:30 OPS-7 « Support »', '09:30-09:45 OPS-12 « Daily »'], self::arrows($this->day(self::THURSDAY), $names), 'La fois détachée ne revient pas, pas même déplacée.');
        self::assertSame([], self::listAt($this->day(self::FRIDAY), 'blocks'));
        self::assertSame([], self::listAt($this->day(self::MONDAY), 'blocks'));
        self::assertSame(['10:00-10:30 OPS-12 « Daily » ↻collé'], self::arrows($this->day(self::NEXT_THURSDAY), $names));
        $this->assertNoClash();
        $after = $this->week();

        // Annuler le collage la retire ; la coupée garde ses fois sautées. Rétablir le refait.
        $undone = $this->undo(self::intAt($pasted, 'version'), [self::clear('10:00', '10:30')], $pasted);
        self::assertSame($before, $this->week());
        self::assertSame(self::FIRST_DAY_BEFORE, $this->recurrenceRow($new)['until']);
        self::assertSame($carried, $this->skips());
        $this->redo(self::intAt($undone, 'version'), [self::linked(self::daily('10:00', '10:30'), $new)], $pasted);
        self::assertSame($after, $this->week());

        // Le lundi revenu à son objectif reçoit la nouvelle, déplacée.
        [$status, $monday] = $this->putObjective(self::intAt($this->day(self::MONDAY), 'version'), 450, self::MONDAY);
        self::assertSame(200, $status, json_encode($monday, \JSON_THROW_ON_ERROR));
        self::assertSame(['10:00-10:30 OPS-12 « Daily » ↻collé'], self::arrows($monday, $names));
        $this->assertNoClash();
    }

    public function testRetablirLeCollageDUneRecurrenceDontLaCoupeAEteAnnuleeSeRefuse(): void
    {
        [$poker, $cut, $pasted, $names] = $this->movePoker();

        // Annuler le collage, puis la coupe : elle est revenue à sa place.
        $unpasted = $this->undo(self::intAt($pasted, 'version'), [self::clear('10:00', '10:30')], $pasted, '2026-10-21');
        $uncut = $this->undo(self::intAt($cut, 'version'), [self::linked(self::poker('10:00', '10:30'), $poker)], $cut, '2026-10-20');
        $new = self::stringAt($pasted, 'untils', 0, 'recurrence');
        $before = $this->written();

        // Rétablir le collage la ferait revenir deux fois : le mardi et le mercredi.
        [$status, $body] = $this->rewound(self::intAt($unpasted, 'version'), [self::linked(self::poker('10:00', '10:30'), $new)], $pasted, false, '2026-10-21');

        self::assertSame(422, $status, json_encode($body, \JSON_THROW_ON_ERROR));
        self::assertSame([['field' => 'recurrences', 'message' => 'Rétablissez d\'abord la coupe du mardi 20 octobre.']], $body['violations']);
        self::assertSame($before, $this->written(), 'Rien n\'est rétabli.');
        self::assertSame(['10:00-10:30 OPS-12 « Poker planning » ↻poker'], self::arrows($this->day('2026-10-27'), $names));
        self::assertSame([], self::listAt($this->day('2026-10-28'), 'blocks'));

        // Rétablir la coupe d'abord, puis le collage : elle est de nouveau déplacée.
        $this->redo(self::intAt($uncut, 'version'), [self::clear('10:00', '10:30')], $cut, '2026-10-20');
        $this->redo(self::intAt($unpasted, 'version'), [self::linked(self::poker('10:00', '10:30'), $new)], $pasted, '2026-10-21');
        self::assertSame([], self::listAt($this->day('2026-10-27'), 'blocks'));
        self::assertSame(['10:00-10:30 OPS-12 « Poker planning » ↻collé'], self::arrows($this->day('2026-10-28'), $names));
        $this->assertNoClash();
    }

    public function testAnnulerLaCoupeDUneRecurrenceDontLeCollageEstEncoreLaSeRefuse(): void
    {
        [$poker, $cut, $pasted, $names] = $this->movePoker();
        $before = $this->written();

        // Annuler la coupe la ferait revenir le mardi, sans la retirer du mercredi.
        [$status, $body] = $this->rewound(self::intAt($cut, 'version'), [self::linked(self::poker('10:00', '10:30'), $poker)], $cut, true, '2026-10-20');

        self::assertSame(422, $status, json_encode($body, \JSON_THROW_ON_ERROR));
        self::assertSame([['field' => 'recurrences', 'message' => 'Annulez d\'abord le collage du mercredi 21 octobre.']], $body['violations']);
        self::assertSame($before, $this->written(), 'Rien n\'est annulé.');

        // Annuler le collage d'abord, puis la coupe : elle revient à sa place, et seulement là.
        $this->undo(self::intAt($pasted, 'version'), [self::clear('10:00', '10:30')], $pasted, '2026-10-21');
        $this->undo(self::intAt($cut, 'version'), [self::linked(self::poker('10:00', '10:30'), $poker)], $cut, '2026-10-20');
        self::assertSame(['10:00-10:30 OPS-12 « Poker planning » ↻poker'], self::arrows($this->day('2026-10-27'), $names));
        self::assertSame([], self::listAt($this->day('2026-10-28'), 'blocks'));
        $this->assertNoClash();
    }

    public function testCollerUneRecurrenceDontLaCoupeAEteAnnuleeSeRefuse(): void
    {
        [$poker] = $this->repeatWith(0, self::poker('10:00', '10:30'), self::weekly([2]));
        $cut = $this->saveRecurrence(self::intAt($this->day('2026-10-20'), 'version'), [self::clear('10:00', '10:30')], null, $poker, '2026-10-20');
        $this->undo(self::intAt($cut, 'version'), [self::linked(self::poker('10:00', '10:30'), $poker)], $cut, '2026-10-20');
        $before = $this->written();

        // Collée le jeudi 22, elle reviendrait deux fois : le mardi, où l'annulation l'a rendue, et le jeudi.
        [$status, $body] = $this->putRecurrence(self::intAt($this->day('2026-10-22'), 'version'), [self::poker('10:00', '10:30')], self::weekly([4]), date: '2026-10-22', follows: $poker);

        self::assertSame(422, $status, json_encode($body, \JSON_THROW_ON_ERROR));
        self::assertSame([['field' => 'follows', 'message' => 'La coupe de cette récurrence a été annulée. Rien n\'est collé.']], $body['violations']);
        self::assertSame($before, $this->written(), 'Rien n\'est collé.');
    }

    public function testUneRecurrenceDeplaceeQuOnChangeEnsuiteNeRevitPasNonPlusASesDeuxPlaces(): void
    {
        [$poker, $cut, $pasted, $names] = $this->movePoker();
        $new = self::stringAt($pasted, 'untils', 0, 'recurrence');
        // Le mercredi 28, la collée change de commentaire avec les suivantes : elle reste là depuis le 21.
        $moved = $this->saveRecurrence(self::intAt($this->day('2026-10-28'), 'version'), [self::work('10:00', '10:30', 'OPS-12', 'Planning')], self::weekly([3]), $new, '2026-10-28');
        $before = $this->written();

        [$status, $body] = $this->rewound(self::intAt($cut, 'version'), [self::linked(self::poker('10:00', '10:30'), $poker)], $cut, true, '2026-10-20');

        self::assertSame(422, $status, json_encode($body, \JSON_THROW_ON_ERROR));
        self::assertSame([['field' => 'recurrences', 'message' => 'Annulez d\'abord le collage du mercredi 21 octobre.']], $body['violations']);
        self::assertSame($before, $this->written());

        // Effacée avec les suivantes depuis le 21, elle n'est plus là : annuler la coupe la rend au mardi.
        $later = self::stringAt($moved, 'untils', 1, 'recurrence');
        $this->saveRecurrence(self::intAt($this->day('2026-10-28'), 'version'), [self::clear('10:00', '10:30')], null, $later, '2026-10-28');
        $this->saveRecurrence(self::intAt($this->day('2026-10-21'), 'version'), [self::clear('10:00', '10:30')], null, $new, '2026-10-21');
        $this->undo(self::intAt($this->day('2026-10-20'), 'version'), [self::linked(self::poker('10:00', '10:30'), $poker)], $cut, '2026-10-20');
        self::assertSame(['10:00-10:30 OPS-12 « Poker planning » ↻poker'], self::arrows($this->day('2026-10-27'), $names));
        self::assertSame([], self::listAt($this->day('2026-10-28'), 'blocks'));
        $this->assertNoClash();
    }

    public function testUneRecurrenceDeplaceeDeuxFoisNeRevitNiASaPremierePlaceNiASaDerniere(): void
    {
        [$poker, $cut, $pasted, $names] = $this->movePoker();
        $moved = self::stringAt($pasted, 'untils', 0, 'recurrence');
        // Recoupée le mercredi 21, le jour même du collage, puis collée le jeudi 22, chaque jeudi.
        $recut = $this->saveRecurrence(self::intAt($pasted, 'version'), [self::clear('10:00', '10:30')], null, $moved, '2026-10-21');
        $again = $this->saveRecurrence(self::intAt($this->day('2026-10-22'), 'version'), [self::poker('10:00', '10:30')], self::weekly([4]), null, '2026-10-22', $moved);
        $last = self::stringAt($again, 'untils', 0, 'recurrence');
        $names[$last] = 'recollé';
        $before = $this->written();

        // La coupe du mardi ne s'annule pas tant que le dernier collage est là, même par-dessus la collée retirée.
        [$status, $body] = $this->rewound(self::intAt($cut, 'version'), [self::linked(self::poker('10:00', '10:30'), $poker)], $cut, true, '2026-10-20');

        self::assertSame(422, $status, json_encode($body, \JSON_THROW_ON_ERROR));
        self::assertSame([['field' => 'recurrences', 'message' => 'Annulez d\'abord le collage du jeudi 22 octobre.']], $body['violations']);
        self::assertSame($before, $this->written());

        // Tout défait dans l'ordre, la coupée revient ; le dernier collage ne se rétablit pas par-dessus.
        $unpastedAgain = $this->undo(self::intAt($again, 'version'), [self::clear('10:00', '10:30')], $again, '2026-10-22');
        $uncut = $this->undo(self::intAt($recut, 'version'), [self::linked(self::poker('10:00', '10:30'), $moved)], $recut, '2026-10-21');
        $this->undo(self::intAt($uncut, 'version'), [self::clear('10:00', '10:30')], $pasted, '2026-10-21');
        $this->undo(self::intAt($this->day('2026-10-20'), 'version'), [self::linked(self::poker('10:00', '10:30'), $poker)], $cut, '2026-10-20');
        self::assertSame(['10:00-10:30 OPS-12 « Poker planning » ↻poker'], self::arrows($this->day('2026-10-27'), $names));
        $before = $this->written();

        [$status, $body] = $this->rewound(self::intAt($unpastedAgain, 'version'), [self::linked(self::poker('10:00', '10:30'), $last)], $again, false, '2026-10-22');

        self::assertSame(422, $status, json_encode($body, \JSON_THROW_ON_ERROR));
        self::assertSame([['field' => 'recurrences', 'message' => 'Rétablissez d\'abord la coupe du mercredi 21 octobre.']], $body['violations']);
        self::assertSame($before, $this->written());
        self::assertSame([], self::listAt($this->day('2026-10-29'), 'blocks'));
        $this->assertNoClash();
    }

    public function testUneColleeRemplaceeLeJourDuCollageContinueLaCoupee(): void
    {
        [$poker, $cut, $pasted] = $this->movePoker();
        $moved = self::stringAt($pasted, 'untils', 0, 'recurrence');
        // Le mercredi 21, jour du collage, la collée change de commentaire avec les suivantes : retirée, une autre la remplace.
        $this->saveRecurrence(self::intAt($pasted, 'version'), [self::work('10:00', '10:30', 'OPS-12', 'Planning')], self::weekly([3]), $moved, '2026-10-21');
        $before = $this->written();

        [$status, $body] = $this->rewound(self::intAt($cut, 'version'), [self::linked(self::poker('10:00', '10:30'), $poker)], $cut, true, '2026-10-20');

        self::assertSame(422, $status, json_encode($body, \JSON_THROW_ON_ERROR));
        self::assertSame([['field' => 'recurrences', 'message' => 'Annulez d\'abord le collage du mercredi 21 octobre.']], $body['violations']);
        self::assertSame($before, $this->written());
    }

    public function testUneCoupeeDejaColleeNeSeCollePasUneSecondeFois(): void
    {
        [$poker] = $this->movePoker();
        $before = $this->written();

        // Un onglet dupliqué avant le premier collage colle la même coupe le jeudi.
        [$status, $body] = $this->putRecurrence(self::intAt($this->day('2026-10-22'), 'version'), [self::poker('10:00', '10:30')], self::weekly([4]), date: '2026-10-22', follows: $poker);

        self::assertSame(422, $status, json_encode($body, \JSON_THROW_ON_ERROR));
        self::assertSame([['field' => 'follows', 'message' => 'Cette récurrence a déjà été collée le mercredi 21 octobre. Rien n\'est collé.']], $body['violations']);
        self::assertSame($before, $this->written());
    }

    public function testUneCoupePlusTotQuiFinitAvantLeCollageSeColle(): void
    {
        [$poker, , , $names] = $this->movePoker();
        // Recoupée plus tôt, le mardi 13 : elle finit le 12, et le presse-papier garde « jusqu'au 19 ».
        $this->saveRecurrence(self::intAt($this->day('2026-10-13'), 'version'), [self::clear('10:00', '10:30')], null, $poker, '2026-10-13');

        // Collée chaque jeudi jusqu'au 19 : elle finit avant le collage du 21, rien n'est doublé.
        $thursdays = $this->saveRecurrence(self::intAt($this->day('2026-10-15'), 'version'), [self::poker('10:00', '10:30')], self::weekly([4], '2026-10-19'), null, '2026-10-15', $poker);
        $names[self::stringAt($thursdays, 'untils', 0, 'recurrence')] = 'jeudi';
        self::assertSame(['10:00-10:30 OPS-12 « Poker planning » ↻jeudi'], self::arrows($this->day('2026-10-15'), $names));

        // Sans fin, elle irait au-delà : refusée.
        [$status, $body] = $this->putRecurrence(self::intAt($this->day('2026-10-16'), 'version'), [self::poker('10:00', '10:30')], self::weekly([5]), date: '2026-10-16', follows: $poker);
        self::assertSame(422, $status, json_encode($body, \JSON_THROW_ON_ERROR));
        self::assertSame([['field' => 'follows', 'message' => 'Cette récurrence a déjà été collée le mercredi 21 octobre. Rien n\'est collé.']], $body['violations']);
        $this->assertNoClash();
    }

    public function testUneColleeFinieAvantAujourdhuiNEmpechePasDeRepousserLaCoupee(): void
    {
        [$poker] = $this->repeatWith(0, self::poker('10:00', '10:30'), self::weekly([2]));
        $this->saveRecurrence(self::intAt($this->day('2026-10-20'), 'version'), [self::clear('10:00', '10:30')], null, $poker, '2026-10-20');
        $this->saveRecurrence(self::intAt($this->day('2026-10-21'), 'version'), [self::poker('10:00', '10:30')], self::weekly([3], '2026-10-28'), null, '2026-10-21', $poker);
        self::mockTime('2026-11-02 08:00:00 Europe/Paris');

        // Depuis le mardi 13 octobre, passé : sa fin vidée la fait revenir à partir de demain, sans
        // rien doubler, la collée finie depuis le 28.
        $this->saveRecurrence(self::intAt($this->day('2026-10-13'), 'version'), [self::poker('10:00', '10:30')], self::weekly([2]), $poker, '2026-10-13');

        self::assertNull($this->recurrenceRow($poker)['until']);
        self::assertSame(['10:00-10:30 OPS-12 « Poker planning » ↻poker'], self::arrows($this->day('2026-11-03'), [$poker => 'poker']));
    }

    public function testLaFinDUneCoupeeNeSeRepoussePasAuDelaDeSonCollage(): void
    {
        [$poker, , , $names] = $this->movePoker();
        $before = $this->written();

        // Le mardi 13, avant la coupe, sa fenêtre la ferait revenir chaque mardi, sans fin.
        [$status, $body] = $this->putRecurrence(self::intAt($this->day('2026-10-13'), 'version'), [self::poker('10:00', '10:30')], self::weekly([2]), $poker, '2026-10-13');

        self::assertSame(422, $status, json_encode($body, \JSON_THROW_ON_ERROR));
        self::assertSame([['field' => 'recurrence.until', 'message' => 'Annulez d\'abord le collage du mercredi 21 octobre.']], $body['violations']);
        self::assertSame($before, $this->written());

        // Jusqu'au mardi 20, la veille du collage : elle revient ce mardi-là, et pas au-delà.
        $this->saveRecurrence(self::intAt($this->day('2026-10-13'), 'version'), [self::poker('10:00', '10:30')], self::weekly([2], '2026-10-20'), $poker, '2026-10-13');
        self::assertSame(['10:00-10:30 OPS-12 « Poker planning » ↻poker'], self::arrows($this->day('2026-10-20'), $names));
        self::assertSame([], self::listAt($this->day('2026-10-27'), 'blocks'));
    }

    public function testLaFenetreDUneCoupeeQuiChangeAutreChoseNeVaPasNonPlusAuDelaDeSonCollage(): void
    {
        [$poker, , , $names] = $this->movePoker();
        $before = $this->written();

        // Le mardi 13, avant la coupe : un autre commentaire, « Jusqu'au » vidé. La nouvelle
        // reviendrait chaque mardi, sans fin, à côté de la collée du mercredi.
        [$status, $body] = $this->putRecurrence(self::intAt($this->day('2026-10-13'), 'version'), [self::work('10:00', '10:30', 'OPS-12', 'Planning')], self::weekly([2]), $poker, '2026-10-13');

        self::assertSame(422, $status, json_encode($body, \JSON_THROW_ON_ERROR));
        self::assertSame([['field' => 'recurrence.until', 'message' => 'Annulez d\'abord le collage du mercredi 21 octobre.']], $body['violations']);
        self::assertSame($before, $this->written(), 'Rien n\'est changé.');

        // Le mercredi 14, le mardi 13 passé : un autre rythme partirait de demain, sans fin. Refusé de même.
        self::mockTime('2026-10-14 08:00:00 Europe/Paris');
        $version = self::intAt($this->day('2026-10-13'), 'version');
        $before = $this->written();
        [$status, $body] = $this->putRecurrence($version, [self::poker('10:00', '10:30')], self::weekly([2, 4]), $poker, '2026-10-13');

        self::assertSame(422, $status, json_encode($body, \JSON_THROW_ON_ERROR));
        self::assertSame([['field' => 'recurrence.until', 'message' => 'Annulez d\'abord le collage du mercredi 21 octobre.']], $body['violations']);
        self::assertSame($before, $this->written(), 'Rien n\'est changé.');

        // Jusqu'au mardi 20, la veille du collage : la nouvelle revient le jeudi 15 et le mardi 20, pas au-delà.
        $saved = $this->saveRecurrence($version, [self::poker('10:00', '10:30')], self::weekly([2, 4], '2026-10-20'), $poker, '2026-10-13');
        $names[self::stringAt($saved, 'untils', 1, 'recurrence')] = 'mardi et jeudi';
        self::assertSame(['10:00-10:30 OPS-12 « Poker planning » ↻mardi et jeudi'], self::arrows($this->day('2026-10-15'), $names));
        self::assertSame(['10:00-10:30 OPS-12 « Poker planning » ↻mardi et jeudi'], self::arrows($this->day('2026-10-20'), $names));
        self::assertSame([], self::listAt($this->day('2026-10-22'), 'blocks'));
        self::assertSame(['10:00-10:30 OPS-12 « Poker planning » ↻collé'], self::arrows($this->day('2026-10-28'), $names));
        $this->assertNoClash();
    }

    public function testRetablirUnCollageQuUnOngletDupliqueAColleAilleursSeRefuse(): void
    {
        [$poker, , $pasted, $names] = $this->movePoker();
        $moved = self::stringAt($pasted, 'untils', 0, 'recurrence');
        // Le collage du mercredi 21 annulé ; un onglet dupliqué après la coupe colle la même le
        // vendredi 23, chaque vendredi.
        $unpasted = $this->undo(self::intAt($pasted, 'version'), [self::clear('10:00', '10:30')], $pasted, '2026-10-21');
        $friday = $this->saveRecurrence(self::intAt($this->day('2026-10-23'), 'version'), [self::poker('10:00', '10:30')], self::weekly([5]), null, '2026-10-23', $poker);
        $names[self::stringAt($friday, 'untils', 0, 'recurrence')] = 'vendredi';
        $before = $this->written();

        // Rétablir le collage du mercredi la ferait revivre le mercredi et le vendredi.
        [$status, $body] = $this->rewound(self::intAt($unpasted, 'version'), [self::linked(self::poker('10:00', '10:30'), $moved)], $pasted, false, '2026-10-21');

        self::assertSame(422, $status, json_encode($body, \JSON_THROW_ON_ERROR));
        self::assertSame([['field' => 'recurrences', 'message' => 'Annulez d\'abord le collage du vendredi 23 octobre.']], $body['violations']);
        self::assertSame($before, $this->written(), 'Rien n\'est rétabli.');
        self::assertSame([], self::listAt($this->day('2026-10-28'), 'blocks'));
        self::assertSame(['10:00-10:30 OPS-12 « Poker planning » ↻vendredi'], self::arrows($this->day('2026-10-30'), $names));

        // Le collage du vendredi annulé, celui du mercredi se rétablit, seul.
        $this->undo(self::intAt($friday, 'version'), [self::clear('10:00', '10:30')], $friday, '2026-10-23');
        $this->redo(self::intAt($unpasted, 'version'), [self::linked(self::poker('10:00', '10:30'), $moved)], $pasted, '2026-10-21');
        self::assertSame(['10:00-10:30 OPS-12 « Poker planning » ↻collé'], self::arrows($this->day('2026-10-28'), $names));
        self::assertSame([], self::listAt($this->day('2026-10-30'), 'blocks'));
        $this->assertNoClash();
    }

    public function testColleeLeJourDUneFoisEffaceeElleSYPoseEtReprendLesSuivantes(): void
    {
        [$id] = $this->repeat(0, self::daily('09:15', '09:45'));
        $this->write(self::intAt($this->day(self::FRIDAY), 'version'), [self::clear('09:15', '09:45')], self::FRIDAY);
        $this->write(self::intAt($this->day(self::MONDAY), 'version'), [self::clear('09:15', '09:45')], self::MONDAY);
        $this->saveRecurrence(self::intAt($this->day(), 'version'), [self::clear('09:15', '09:45')], null, $id);

        $pasted = $this->saveRecurrence(self::intAt($this->day(self::FRIDAY), 'version'), [self::daily('10:00', '10:30')], self::weekly(), null, self::FRIDAY, $id);

        $new = self::stringAt($pasted, 'untils', 0, 'recurrence');
        self::assertSame([600 => $new, 615 => $new], $this->links(self::FRIDAY), 'Ce jour-là, le collage la pose.');
        self::assertSame([$id.' '.self::FRIDAY, $id.' '.self::MONDAY, $new.' '.self::MONDAY], self::sorted($this->skips(), [$id, $new]));
        self::assertSame([], self::listAt($this->day(self::MONDAY), 'blocks'));
        self::assertSame(['10:00-10:30 OPS-12 « Daily » ↻collé'], self::arrows($this->day(self::NEXT_THURSDAY), [$new => 'collé']));
        $this->assertNoClash();
    }

    public function testColleeLeJourDUneFoisEffaceeSurLeCreneauDUneAutreCeJourLaSeRefuse(): void
    {
        [$id] = $this->repeat(0, self::daily('09:15', '09:45'));
        $this->write(self::intAt($this->day(self::FRIDAY), 'version'), [self::clear('09:15', '09:45')], self::FRIDAY);
        // La démo, ce vendredi seulement, de 10:15 à 11:00.
        $this->repeatWith(self::intAt($this->day(self::FRIDAY), 'version'), self::work('10:15', '11:00', 'OPS-7', 'Démo'), self::weekly([5], self::FRIDAY), self::FRIDAY);
        $this->saveRecurrence(self::intAt($this->day(), 'version'), [self::clear('09:15', '09:45')], null, $id);
        $before = $this->written();

        // La fois effacée du vendredi ne lui libère pas ce créneau : la nouvelle s'y poserait.
        [$status, $body] = $this->putRecurrence(self::intAt($this->day(self::FRIDAY), 'version'), [self::daily('10:00', '10:30')], self::weekly(), null, self::FRIDAY, follows: $id);

        self::assertSame(422, $status, json_encode($body, \JSON_THROW_ON_ERROR));
        self::assertSame(self::taken('Démo'), $body['violations']);
        self::assertSame($before, $this->written());
    }

    public function testUneSourceEncoreLaSeRefuseInconnueOuDUnAutreRythmeElleNeDonneRien(): void
    {
        [$id] = $this->repeat(0, self::daily('09:15', '09:45'));
        $this->write(self::intAt($this->day(self::FRIDAY), 'version'), [self::clear('09:15', '09:45')], self::FRIDAY);
        $skipped = [$id.' '.self::FRIDAY];

        // Encore là ce mercredi, elle se refuse : elle reviendrait deux fois. Inconnue, rien n'est
        // repris, et rien n'est refusé.
        [$status, $body] = $this->putRecurrence(self::intAt($this->day(self::WEDNESDAY), 'version'), [self::daily('10:00', '10:30')], self::weekly(), null, self::WEDNESDAY, follows: $id);
        self::assertSame(422, $status, json_encode($body, \JSON_THROW_ON_ERROR));
        self::assertSame('follows', self::stringAt($body, 'violations', 0, 'field'));
        $unknown = $this->saveRecurrence(self::intAt($this->day(self::WEDNESDAY), 'version'), [self::daily('11:00', '11:30')], self::weekly(), null, self::WEDNESDAY, '0199a3c4-5b6d-7e8f-9a0b-1c2d3e4f5a6b');
        self::assertSame($skipped, $this->skips());
        $names = [$id => 'daily', self::stringAt($unknown, 'untils', 0, 'recurrence') => 'inconnue'];
        self::assertSame(['09:15-09:45 OPS-12 « Daily » ↻daily', '11:00-11:30 OPS-12 « Daily » ↻inconnue'], self::arrows($this->day(self::WEDNESDAY), $names));

        // Coupée le jeudi, puis collée à 12:00 du mardi au vendredi : un autre rythme.
        $cut = $this->saveRecurrence(self::intAt($this->day(self::THURSDAY), 'version'), [self::clear('09:15', '09:45')], null, $id, self::THURSDAY);
        $other = $this->saveRecurrence(self::intAt($cut, 'version'), [self::daily('12:00', '12:30')], self::weekly([2, 3, 4, 5]), null, self::THURSDAY, $id);
        $names[self::stringAt($other, 'untils', 0, 'recurrence')] = 'autre';
        self::assertSame($skipped, $this->skips());
        self::assertSame(['11:00-11:30 OPS-12 « Daily » ↻inconnue', '12:00-12:30 OPS-12 « Daily » ↻autre'], self::arrows($this->day(self::FRIDAY), $names));
        $this->assertNoClash();
    }

    public function testUneSourceMalFormeeSeRefuseSousSonNom(): void
    {
        [$id] = $this->repeat(0, self::daily('09:15', '09:45'));
        $cut = $this->saveRecurrence(self::intAt($this->day(), 'version'), [self::clear('09:15', '09:45')], null, $id);
        $before = $this->written();

        foreach (['daily', '42', '', 'ZZZZZZZZ-5b6d-7e8f-9a0b-1c2d3e4f5a6b'] as $follows) {
            [$status, $body] = $this->putRecurrence(self::intAt($cut, 'version'), [self::daily('10:00', '10:30')], self::weekly(), follows: $follows);

            self::assertSame(422, $status, $follows.' : '.json_encode($body, \JSON_THROW_ON_ERROR));
            self::assertSame([['field' => 'follows', 'message' => 'Récurrence inconnue.']], $body['violations'], $follows);
        }
        foreach ([42, ['id' => $id], true] as $follows) {
            [$status] = $this->send('PUT', '/api/days/'.self::TODAY.'/recurrence', ['version' => self::intAt($cut, 'version'), 'changes' => [self::daily('10:00', '10:30')], 'recurrence' => self::weekly(), 'replaces' => null, 'follows' => $follows]);
            self::assertSame(422, $status, json_encode($follows, \JSON_THROW_ON_ERROR));
        }
        self::assertSame($before, $this->written());
    }

    /**
     * @return array<string, ?string>
     */
    private static function daily(string $start, string $end): array
    {
        return self::work($start, $end, 'OPS-12', 'Daily');
    }

    /**
     * @return array<string, ?string>
     */
    private static function support(): array
    {
        return self::work('09:45', '10:00', 'OPS-7', 'Support');
    }

    /**
     * @return array<string, ?string>
     */
    private static function poker(string $start, string $end): array
    {
        return self::work($start, $end, 'OPS-12', 'Poker planning');
    }

    /**
     * @return array<string, ?string>
     */
    private static function demo(): array
    {
        return self::work('14:00', '15:00', 'OPS-12', 'Démo');
    }

    /**
     * Des fois sautées « identifiant date », rangées dans l'ordre des récurrences données, puis
     * de leurs dates : ce qu'une lecture compare sans dépendre de l'ordre des identifiants.
     *
     * @param list<string> $skips
     * @param list<string> $ids
     *
     * @return list<string>
     */
    private static function sorted(array $skips, array $ids): array
    {
        usort($skips, static function (string $a, string $b) use ($ids): int {
            [$aId, $aDate] = explode(' ', $a, 2);
            [$bId, $bDate] = explode(' ', $b, 2);

            return [array_search($aId, $ids, true), $aDate] <=> [array_search($bId, $ids, true), $bDate];
        });

        return $skips;
    }

    /**
     * Les heures d'une récurrence, telles que la journée les décrit.
     *
     * @param array<mixed> $day
     *
     * @return array<mixed>
     */
    private static function hours(array $day, string $id): array
    {
        return array_intersect_key(self::arrayAt($day, 'recurrences', $id), ['start' => 0, 'end' => 0]);
    }

    /**
     * Ce que la page montre de chaque jour qu'on regarde, chaque bloc suivi de la récurrence
     * qui l'a posé, par son identifiant.
     *
     * @return array<string, list<string>>
     */
    private function week(): array
    {
        $week = [];
        foreach (self::WEEK as $date) {
            $week[$date] = self::arrows($this->day($date));
        }

        return $week;
    }

    /**
     * Annuler, comme la page : chaque créneau d'avant, relié à la récurrence qui l'avait posé,
     * les fins que le geste annulé avait changées rendues, et le drapeau qui dit qu'une journée
     * d'avant revient.
     *
     * @param list<array<string, ?string>> $changes
     * @param array<mixed>                 $saved   la réponse de l'enregistrement annulé, avec ses fins
     *
     * @return array<mixed>
     */
    private function undo(int $version, array $changes, array $saved, string $date = self::TODAY): array
    {
        [$status, $day] = $this->send('PATCH', '/api/days/'.$date.'/slots', ['version' => $version, 'changes' => $changes, 'recurrences' => self::rewinds($saved, true), 'restores' => true]);
        self::assertSame(200, $status, json_encode($day, \JSON_THROW_ON_ERROR));

        return $day;
    }

    /**
     * Le poker planning de chaque mardi, déplacé : coupé avec les suivantes le mardi 20, puis
     * collé le mercredi 21 à la même heure, chaque mercredi.
     *
     * @return array{string, array<mixed>, array<mixed>, array<string, string>} la coupée, la coupe, le collage, et leurs noms
     */
    private function movePoker(): array
    {
        [$poker] = $this->repeatWith(0, self::poker('10:00', '10:30'), self::weekly([2]));
        $cut = $this->saveRecurrence(self::intAt($this->day('2026-10-20'), 'version'), [self::clear('10:00', '10:30')], null, $poker, '2026-10-20');
        $pasted = $this->saveRecurrence(self::intAt($this->day('2026-10-21'), 'version'), [self::poker('10:00', '10:30')], self::weekly([3]), null, '2026-10-21', $poker);
        $names = [$poker => 'poker', self::stringAt($pasted, 'untils', 0, 'recurrence') => 'collé'];
        self::assertSame([], self::listAt($this->day('2026-10-27'), 'blocks'));
        self::assertSame(['10:00-10:30 OPS-12 « Poker planning » ↻collé'], self::arrows($this->day('2026-10-28'), $names));

        return [$poker, $cut, $pasted, $names];
    }

    /**
     * Annuler ($undo) ou rétablir, comme la page, sans présumer de la réponse.
     *
     * @param list<array<string, ?string>> $changes
     * @param array<mixed>                 $saved
     *
     * @return array{int, array<mixed>}
     */
    private function rewound(int $version, array $changes, array $saved, bool $undo, string $date): array
    {
        return $this->send('PATCH', '/api/days/'.$date.'/slots', ['version' => $version, 'changes' => $changes, 'recurrences' => self::rewinds($saved, $undo)] + ($undo ? ['restores' => true] : []));
    }

    /**
     * Rétablir, comme la page : chaque créneau d'après, et les fins d'après.
     *
     * @param list<array<string, ?string>> $changes
     * @param array<mixed>                 $saved
     *
     * @return array<mixed>
     */
    private function redo(int $version, array $changes, array $saved, string $date = self::TODAY): array
    {
        return $this->writeWith($version, $changes, self::rewinds($saved, false), $date);
    }

    /**
     * Les fins qu'annuler ($undo) ou rétablir rendent, d'après celles que l'enregistrement a rendues.
     *
     * @param array<mixed> $saved
     *
     * @return list<array<string, ?string>>
     */
    private static function rewinds(array $saved, bool $undo): array
    {
        $rewinds = [];
        foreach (self::listAt($saved, 'untils') as $until) {
            $before = self::at($until, 'before');
            $after = self::at($until, 'after');
            self::assertTrue(null === $before || \is_string($before));
            self::assertTrue(null === $after || \is_string($after));
            $rewinds[] = ['recurrence' => self::stringAt($until, 'recurrence'), 'from' => $undo ? $after : $before, 'to' => $undo ? $before : $after];
        }

        return $rewinds;
    }

    /**
     * Chaque paire de récurrences de la base, telle qu'elle est : aucune ne croise l'autre
     * après aujourd'hui.
     */
    private function assertNoClash(): void
    {
        $entityManager = static::getContainer()->get(EntityManagerInterface::class);
        $entityManager->clear();
        $today = static::getContainer()->get(UserCalendar::class)->today();
        $repository = static::getContainer()->get(RecurrenceRepository::class);
        $recurrences = $repository->findAll();
        $skipped = $repository->skippedAfter($today);
        $closed = static::getContainer()->get(DaySendRepository::class)->closedAfter($today);
        foreach ($recurrences as $one) {
            foreach ($recurrences as $other) {
                if ($one !== $other) {
                    self::assertNull(RecurrenceClash::first($one, $other, $today, $skipped, $closed), $one->id.' croise '.$other->id);
                }
            }
        }
    }

    /**
     * Tout ce qu'une écriture laisserait : les journées et leurs versions, leurs créneaux, les
     * récurrences et leurs fins, les fois détachées.
     *
     * @return array<string, mixed>
     */
    private function written(): array
    {
        $connection = $this->connection();

        return [
            'days' => $connection->fetchAllAssociative('SELECT date, version, objective FROM day ORDER BY date'),
            'slots' => $connection->fetchAllAssociative('SELECT day.date, slot.start, slot.kind, slot.ticket, slot.comment, HEX(slot.recurrence_id) AS recurrence FROM slot JOIN day ON day.id = slot.day_id ORDER BY day.date, slot.start'),
            'recurrences' => $connection->fetchAllAssociative('SELECT HEX(id) AS id, start, "end", first_day, until, posed_through FROM recurrence ORDER BY id'),
            'skips' => $this->skips(),
        ];
    }

    /**
     * @return list<array{field: string, message: string}>
     */
    private static function taken(string $name): array
    {
        // Les guillemets tiennent à leur mot, par des espaces insécables.
        return [['field' => 'recurrence.rhythm', 'message' => "Ce créneau est déjà pris par la récurrence «\u{a0}{$name}\u{a0}»."]];
    }
}
