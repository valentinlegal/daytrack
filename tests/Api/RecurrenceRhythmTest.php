<?php

namespace App\Tests\Api;

use App\Tests\Support\DayApi;
use App\Tests\Support\RecurrenceApi;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

/**
 * Les rythmes d'une récurrence par l'API, comme la fenêtre les envoie : chaque semaine ou une
 * semaine sur 2, 3 ou 4 ; chaque mois, le n-ième jour de la semaine, le dernier, ou une date.
 * Un rythme mensuel est celui du jour du bloc. Ce que le serveur refuse sous son champ, sans
 * rien écrire, et ce qu'un appelant hostile envoie de travers.
 *
 * L'heure est figée au mardi 6 octobre 2026, 15:20 à Paris : le 1er mardi du mois, le 6.
 */
final class RecurrenceRhythmTest extends WebTestCase
{
    use DayApi;
    use RecurrenceApi;

    /** Le 4e et dernier mardi d'octobre 2026. */
    private const string LAST_TUESDAY = '2026-10-27';

    public function testChaqueRythmeSeCreeEtSeRelit(): void
    {
        $created = [
            [self::everyWeeks(2, [2, 4]), '07:00', '07:15', self::TODAY],
            [self::everyWeeks(3, [2]), '08:00', '08:15', self::TODAY],
            [self::everyWeeks(4, [1, 2]), '09:00', '09:15', self::TODAY],
            [self::monthlyWeekday(2, 1), '10:00', '10:15', self::TODAY],
            [self::monthlyDate(6), '19:45', '20:00', self::TODAY],
            [self::monthlyWeekday(2, 4), '11:00', '11:15', self::LAST_TUESDAY],
            [self::monthlyWeekday(2, -1), '12:00', '12:15', self::LAST_TUESDAY],
            [self::monthlyDate(27, '2027-10-27'), '13:00', '13:15', self::LAST_TUESDAY],
        ];
        foreach ($created as [$rule, $start, $end, $date]) {
            [$id, $day] = $this->repeatWith(self::intAt($this->day($date), 'version'), self::work($start, $end, 'OPS-7'), $rule, $date);

            $view = self::arrayAt($day, 'recurrences', $id);
            $expected = ['start' => $start, 'end' => $end] + $rule;
            unset($expected['until']);
            self::assertSame($expected, array_intersect_key($view, $expected), json_encode($rule, \JSON_THROW_ON_ERROR));
            self::assertSame($rule['until'], $view['until']);
            self::assertSame($date, $view['firstDay']);
            self::assertContains($start.'-'.$end.' OPS-7 ↻'.$id, self::arrows($day), 'Le bloc en est la première fois.');
            self::assertSame($view, self::arrayAt($this->day($date), 'recurrences', $id), 'Relue telle quelle.');
        }
        self::assertSame(\count($created), $this->recurrenceRows());
    }

    public function testUnRythmeDeTraversSeRefuseSousSonChamp(): void
    {
        $change = [self::work('09:15', '09:30', 'OPS-12', 'Daily')];
        $weekly = self::everyWeeks(1, [2]);
        $rank = self::monthlyWeekday(2, 1);
        $date = self::monthlyDate(6);
        $everyWeeks = 'Une récurrence revient chaque semaine, ou une semaine sur 2, 3 ou 4.';
        $monthWeek = 'Un jour du mois se nomme du 1er au 4e, ou le dernier.';
        $oneWeekday = 'Le n-ième jour du mois a un seul jour de la semaine et son rang.';
        $onlyDate = 'Une date du mois n\'a que sa date.';

        $refused = [
            'chaque 0 semaine' => [['everyWeeks' => 0] + $weekly, 'recurrence.everyWeeks', $everyWeeks],
            'une semaine sur 5' => [['everyWeeks' => 5] + $weekly, 'recurrence.everyWeeks', $everyWeeks],
            'une semaine sur -1' => [['everyWeeks' => -1] + $weekly, 'recurrence.everyWeeks', $everyWeeks],
            'un genre inconnu' => [['kind' => 'yearly'] + $weekly, 'recurrence.kind', 'Rythme inconnu.'],
            'un genre vide' => [['kind' => ''] + $weekly, 'recurrence.kind', 'Rythme inconnu.'],
            'le 5e mardi' => [['monthWeek' => 5] + $rank, 'recurrence.monthWeek', $monthWeek],
            'le 0e mardi' => [['monthWeek' => 0] + $rank, 'recurrence.monthWeek', $monthWeek],
            'l\'avant-dernier mardi' => [['monthWeek' => -2] + $rank, 'recurrence.monthWeek', $monthWeek],
            'un rang sans rang' => [['monthWeek' => null] + $rank, 'recurrence.kind', $oneWeekday],
            'un rang à deux jours' => [['weekdays' => [2, 4]] + $rank, 'recurrence.kind', $oneWeekday],
            'un rang sans jour' => [['weekdays' => []] + $rank, 'recurrence.kind', $oneWeekday],
            'un rang une semaine sur deux' => [['everyWeeks' => 2] + $rank, 'recurrence.kind', $oneWeekday],
            'un rang et une date' => [['monthDay' => 6] + $rank, 'recurrence.kind', $oneWeekday],
            'une date et ses jours' => [['weekdays' => [2]] + $date, 'recurrence.kind', $onlyDate],
            'une date sans date' => [['monthDay' => null] + $date, 'recurrence.kind', $onlyDate],
            'une date et un rang' => [['monthWeek' => 1] + $date, 'recurrence.kind', $onlyDate],
            'une date une semaine sur deux' => [['everyWeeks' => 2] + $date, 'recurrence.kind', $onlyDate],
            'le 0 du mois' => [['monthDay' => 0] + $date, 'recurrence.monthDay', 'Une date du mois va du 1er au 31.'],
            'le 32 du mois' => [['monthDay' => 32] + $date, 'recurrence.monthDay', 'Une date du mois va du 1er au 31.'],
            'une semaine sans jour' => [['weekdays' => []] + $weekly, 'recurrence.weekdays', 'Choisissez au moins un jour.'],
            'une semaine sur deux sans jour' => [self::everyWeeks(2, []), 'recurrence.weekdays', 'Choisissez au moins un jour.'],
            'une semaine et une date' => [['monthDay' => 6] + $weekly, 'recurrence.kind', 'Chaque semaine n\'a pas de jour du mois.'],
            'une semaine et un rang' => [['monthWeek' => 1] + $weekly, 'recurrence.kind', 'Chaque semaine n\'a pas de jour du mois.'],
        ];
        foreach ($refused as $case => [$rule, $field, $message]) {
            [$status, $body] = $this->putRecurrence(0, $change, $rule);
            self::assertSame(422, $status, $case.' : '.json_encode($body, \JSON_THROW_ON_ERROR));
            self::assertSame([['field' => $field, 'message' => $message]], $body['violations'], $case);
        }

        self::assertSame(0, $this->dayRows(), 'Un refus n\'écrit rien.');
        self::assertSame(0, $this->recurrenceRows());
    }

    public function testUnRythmeMensuelEstCeluiDuJourDuBloc(): void
    {
        $change = [self::work('09:15', '09:30', 'OPS-12', 'Daily')];
        $notPermitted = [['field' => 'recurrence.rhythm', 'message' => 'Ce rythme ne tombe pas le jour du bloc. Rechargez la page.']];

        // Le 1er mardi, le 6 : ni le dernier, ni le 2e, ni un jeudi, ni le 7.
        foreach ([
            'le dernier mardi' => self::monthlyWeekday(2, -1),
            'le 2e mardi' => self::monthlyWeekday(2, 2),
            'le 1er jeudi' => self::monthlyWeekday(4, 1),
            'le 7' => self::monthlyDate(7),
            'le 31' => self::monthlyDate(31),
        ] as $case => $rule) {
            [$status, $body] = $this->putRecurrence(0, $change, $rule);
            self::assertSame(422, $status, $case);
            self::assertSame($notPermitted, $body['violations'], $case);
        }
        // Le 30 octobre, 5e vendredi : seulement le dernier.
        $friday = self::intAt($this->day('2026-10-30'), 'version');
        [$status, $body] = $this->putRecurrence($friday, $change, self::monthlyWeekday(5, 4), date: '2026-10-30');
        self::assertSame(422, $status);
        self::assertSame($notPermitted, $body['violations']);
        self::assertSame(0, $this->dayRows());
        self::assertSame(0, $this->recurrenceRows());
        $this->repeatWith($friday, $change[0], self::monthlyWeekday(5, -1), '2026-10-30');

        // Un samedi saisi quand même : sa date seulement, un rang tomberait toujours un jour
        // non travaillé.
        [$status, $body] = $this->putRecurrence(0, $change, self::monthlyWeekday(6, -1), date: '2026-10-31');
        self::assertSame(422, $status);
        self::assertSame([['field' => 'recurrence.weekdays', 'message' => 'Le samedi n\'est plus travaillé. Rechargez la page.']], $body['violations']);
        // Ailleurs que le dernier vendredi : le 31 décembre 2027 en est un.
        [$id, $day] = $this->repeatWith(0, self::work('10:00', '10:15', 'OPS-7'), self::monthlyDate(31), '2026-10-31');
        self::assertSame(['10:00-10:15 OPS-7 ↻31'], self::arrows($day, [$id => '31']));
        self::assertSame(2, $this->recurrenceRows());
    }

    public function testDesRythmesDeTraversSontRefusesSansPlanter(): void
    {
        $change = [self::work('09:15', '09:30', 'OPS-12', 'Daily')];
        $rank = self::monthlyWeekday(2, 1);

        foreach ([
            ['everyWeeks' => '2'] + $rank,
            ['everyWeeks' => null] + self::everyWeeks(2, [2]),
            ['everyWeeks' => true] + self::everyWeeks(2, [2]),
            ['kind' => 1] + $rank,
            ['kind' => null] + $rank,
            ['kind' => ['weekly']] + $rank,
            ['monthWeek' => '1'] + $rank,
            ['monthDay' => '6'] + self::monthlyDate(6),
            ['monthDay' => [6]] + self::monthlyDate(6),
            ['weekdays' => 2] + $rank,
            // Un champ que la fenêtre n'envoie pas.
            ['everyMonths' => 1] + $rank,
            ['monthweek' => 1] + $rank,
        ] as $rule) {
            [$status, $body] = $this->putRecurrence(0, $change, $rule);
            self::assertSame(422, $status, json_encode($rule, \JSON_THROW_ON_ERROR).' : '.json_encode($body, \JSON_THROW_ON_ERROR));
        }
        [$status, $body] = $this->putRecurrence(0, $change, ['everyMonths' => 1] + $rank);
        self::assertContains('recurrence.everyMonths', array_column(self::listAt($body, 'violations'), 'field'), 'Refusé sous son nom.');

        self::assertSame(0, $this->dayRows());
        self::assertSame(0, $this->recurrenceRows());
    }

    public function testLesBordsDeLaGrille(): void
    {
        // De 07:00 à 07:15, et de 19:45 à 20:00 : chacun à son rythme.
        [$morning] = $this->repeatWith(0, self::work('07:00', '07:15', 'OPS-7', 'Matin'), self::monthlyDate(6));
        [$evening] = $this->repeatWith(1, self::work('19:45', '20:00', 'OPS-7', 'Soir'), self::everyWeeks(4, [2]));

        // Toute la grille les croise : le 6 novembre, puis le 3 novembre — le soir, plus tôt.
        [$status, $body] = $this->putRecurrence(2, [self::pause('07:00', '20:00')], self::weekly([1, 2, 3, 4, 5]));
        self::assertSame(422, $status);
        self::assertSame([['field' => 'recurrence.rhythm', 'message' => "Ce créneau est déjà pris par la récurrence «\u{a0}Soir\u{a0}»."]], $body['violations']);
        // De 07:15 à 19:45 : elle les touche sans les croiser.
        [$all, $day] = $this->repeatWith(2, self::pause('07:15', '19:45'), self::weekly([1, 2, 3, 4, 5]));
        self::assertSame(['07:00-07:15 OPS-7 « Matin » ↻matin', '07:15-19:45 pause ↻pause', '19:45-20:00 OPS-7 « Soir » ↻soir'], self::arrows($day, [$morning => 'matin', $evening => 'soir', $all => 'pause']));

        // Hors de la grille : refusé avant tout rythme.
        foreach ([self::work('06:45', '07:15', 'OPS-7'), self::work('19:45', '20:15', 'OPS-7')] as $change) {
            [$status] = $this->putRecurrence(3, [$change], self::monthlyDate(6));
            self::assertSame(422, $status);
        }
        self::assertSame(3, $this->recurrenceRows());
    }
}
