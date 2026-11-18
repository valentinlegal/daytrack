<?php

namespace App\Tests\Api;

use App\Tests\Support\DayApi;
use App\Tests\Support\JiraApi;
use App\Tests\Support\RecurrenceApi;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

/**
 * Les récurrences par l'API des journées : « Enregistrer » dans la fenêtre d'un bloc, la
 * case « Récurrence » cochée ou décochée, et les gestes ordinaires de la grille sur un bloc
 * qui revient — comme les envoie la page, et comme pourraient les envoyer un onglet en
 * retard ou un appelant hostile.
 *
 * L'heure est figée au mardi 6 octobre 2026, 15:20 à Paris.
 */
final class RecurrenceApiTest extends WebTestCase
{
    use DayApi;
    use JiraApi;
    use RecurrenceApi;

    public function testCocherLaCaseCreeLaRecurrenceDuBloc(): void
    {
        [$id, $day] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));

        self::assertSame(1, $day['version']);
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($day, [$id => 'daily']));
        self::assertEquals([$id => [
            'start' => '09:15',
            'end' => '09:30',
            'kind' => 'weekly',
            'weekdays' => [1, 2, 3, 4, 5],
            'everyWeeks' => 1,
            'monthWeek' => null,
            'monthDay' => null,
            'firstDay' => self::TODAY,
            'until' => null,
            'slot' => ['kind' => 'work', 'ticket' => 'OPS-12', 'comment' => 'Daily'],
            'skipped' => [],
        ]], $day['recurrences']);
        self::assertSame([['recurrence' => $id, 'before' => '2026-10-05', 'after' => null]], $day['untils'], 'Annuler la retire : sa fin redevient la veille de son premier jour.');
        self::assertFalse($day['recurrencesHeld']);

        self::assertSame(['firstDay' => self::TODAY, 'until' => null, 'posedThrough' => self::TODAY], $this->recurrenceRow($id));
        self::assertSame([555 => $id], $this->links());
        self::assertSame(self::arrows($day), self::arrows($this->day()), 'Un rechargement retrouve la flèche.');
        self::assertArrayNotHasKey('untils', $this->day());
    }

    public function testUnJourSansRecurrenceRendUnObjetVide(): void
    {
        $day = $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')]);

        self::assertSame([null], array_column(self::listAt($day, 'blocks'), 'recurrence'));
        self::assertStringContainsString('"recurrences":{}', (string) $this->browser->getResponse()->getContent(), 'Un objet même vide.');
    }

    public function testUnePauseSeRepeteAussiEtNeCompteJamaisCommeDuTravail(): void
    {
        [$id, $day] = $this->repeat(0, self::pause('12:30', '13:30'));

        self::assertSame(['12:30-13:30 pause ↻déjeuner'], self::arrows($day, [$id => 'déjeuner']));
        self::assertSame(['start' => '12:30', 'end' => '13:30'], array_intersect_key(self::arrayAt($day, 'recurrences', $id), ['start' => 0, 'end' => 0]));
        self::assertSame(0, self::at($day, 'figures', 'worked'));
    }

    public function testCreerSurUneSaisieNeRemplaceQueLaPlageDeLaFenetre(): void
    {
        $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')]);

        [$id, $day] = $this->repeat(1, self::work('09:15', '09:30', 'OPS-12', 'Daily'));

        self::assertSame(['09:00-09:15 SHOP-482', '09:15-09:30 OPS-12 « Daily » ↻daily', '09:30-10:00 SHOP-482'], self::arrows($day, [$id => 'daily']));
        self::assertSame([540 => null, 555 => $id, 570 => null, 585 => null], $this->links());
    }

    public function testCocherLaCaseSurUnBlocExistantLeRelie(): void
    {
        $this->write(0, [self::work('09:15', '09:45', 'OPS-12', 'Daily')]);

        // « Modifier le ticket » sur le bloc, la case cochée, sans rien changer d'autre.
        [$id, $day] = $this->repeat(1, self::work('09:15', '09:45', 'OPS-12', 'Daily'));

        self::assertSame(['09:15-09:45 OPS-12 « Daily » ↻daily'], self::arrows($day, [$id => 'daily']));
        self::assertCount(2, $this->rows(), 'Ni double ni fantôme : les mêmes quarts d\'heure, reliés.');
    }

    public function testDeuxCreneauxVoisinsDuMemeContenuFontUneSeulePlage(): void
    {
        $day = $this->saveRecurrence(0, [self::work('09:15', '09:30', 'OPS-12', 'Daily'), self::work('09:30', '09:45', 'OPS-12', 'Daily')], self::weekly());

        $id = self::stringAt($day, 'untils', 0, 'recurrence');
        self::assertSame('09:45', self::at($day, 'recurrences', $id, 'end'));
    }

    public function testUneRecurrenceCouvreUneSeulePlageDUnSeulContenu(): void
    {
        $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')]);

        $refused = [
            'deux contenus' => [self::work('09:15', '09:30', 'OPS-12', 'Daily'), self::work('09:30', '09:45', 'OPS-12')],
            'un trou' => [self::work('09:15', '09:30', 'OPS-12'), self::work('09:45', '10:00', 'OPS-12')],
            'un effacement' => [self::clear('09:15', '09:30')],
            'un effacement à côté' => [self::work('09:15', '09:30', 'OPS-12'), self::clear('09:30', '09:45')],
        ];
        foreach ($refused as $case => $changes) {
            [$status, $body] = $this->putRecurrence(1, $changes, self::weekly());
            self::assertSame(422, $status, $case);
            self::assertSame([['field' => 'changes', 'message' => 'Une récurrence couvre une seule plage, d\'un seul ticket.']], $body['violations'], $case);
        }

        // Ni cochée ni reliée : rien à enregistrer pour une récurrence.
        [$status, $body] = $this->putRecurrence(1, [self::work('09:15', '09:30', 'OPS-12')], null);
        self::assertSame(422, $status);
        self::assertSame(['changes'], array_column(self::listAt($body, 'violations'), 'field'));

        self::assertSame(1, $this->day()['version'], 'Un refus n\'écrit rien.');
        self::assertSame(0, $this->recurrenceRows());
        self::assertSame(['09:00-10:00 SHOP-482'], self::blocks($this->day()));
    }

    public function testLesJoursSeChoisissentParmiLesJoursTravailles(): void
    {
        $change = [self::work('09:15', '09:30', 'OPS-12', 'Daily')];

        $refused = [
            [[], 'recurrence.weekdays', 'Choisissez au moins un jour.'],
            [[6], 'recurrence.weekdays', 'Le samedi n\'est plus travaillé. Rechargez la page.'],
            [[1, 2, 7], 'recurrence.weekdays', 'Le dimanche n\'est plus travaillé. Rechargez la page.'],
            [[0], 'recurrence.weekdays[0]', 'Un jour de la semaine va du lundi au dimanche.'],
            [[1, 8], 'recurrence.weekdays[1]', 'Un jour de la semaine va du lundi au dimanche.'],
            [[1, 1], 'recurrence.weekdays', 'Un jour ne se choisit qu\'une fois.'],
        ];
        foreach ($refused as [$weekdays, $field, $message]) {
            [$status, $body] = $this->putRecurrence(0, $change, self::weekly($weekdays));
            self::assertSame(422, $status, json_encode($weekdays, \JSON_THROW_ON_ERROR));
            self::assertSame([['field' => $field, 'message' => $message]], $body['violations'], json_encode($weekdays, \JSON_THROW_ON_ERROR));
        }

        // Un onglet ouvert avant qu'on décoche le jeudi dans les réglages.
        $this->setWorkingDay(4, false);
        [$status, $body] = $this->putRecurrence(0, $change, self::weekly());
        self::assertSame(422, $status);
        self::assertSame([['field' => 'recurrence.weekdays', 'message' => 'Le jeudi n\'est plus travaillé. Rechargez la page.']], $body['violations']);

        // Un samedi travaillé se choisit.
        $this->setWorkingDay(6, true);
        [$id] = $this->repeat(0, $change[0], [2, 6]);
        self::assertSame([2, 6], self::at($this->day(), 'recurrences', $id, 'weekdays'));

        self::assertSame(1, $this->recurrenceRows());
    }

    public function testDesJoursDeTraversSontRefusesSansPlanter(): void
    {
        $change = [self::work('09:15', '09:30', 'OPS-12', 'Daily')];

        foreach (['lundi', null, 1, [1.5], ['1'], [true], [[1]], [null]] as $weekdays) {
            [$status, $body] = $this->putRecurrence(0, $change, ['weekdays' => $weekdays, 'until' => null]);
            self::assertSame(422, $status, json_encode($weekdays, \JSON_THROW_ON_ERROR).' : '.json_encode($body, \JSON_THROW_ON_ERROR));
        }
        foreach ([[], ['until' => null], 'chaque semaine', [1, 2]] as $rule) {
            [$status] = $this->send('PUT', '/api/days/'.self::TODAY.'/recurrence', ['version' => 0, 'changes' => $change, 'recurrence' => $rule, 'replaces' => null]);
            self::assertSame(422, $status, json_encode($rule, \JSON_THROW_ON_ERROR));
        }

        self::assertSame(0, $this->dayRows());
        self::assertSame(0, $this->recurrenceRows());
    }

    public function testJusquAuNeVaPasAvantLeJourDuBloc(): void
    {
        $change = [self::work('09:15', '09:30', 'OPS-12', 'Daily')];

        [$status, $body] = $this->putRecurrence(0, $change, self::weekly(until: '2026-10-05'));
        self::assertSame(422, $status);
        self::assertSame([['field' => 'recurrence.until', 'message' => 'Choisissez un jour à partir du mardi 6 octobre.']], $body['violations']);

        [$status, $body] = $this->putRecurrence(0, $change, self::weekly(until: '2026-09-30'), date: '2026-10-01');
        self::assertSame(422, $status);
        self::assertSame([['field' => 'recurrence.until', 'message' => 'Choisissez un jour à partir du jeudi 1er octobre.']], $body['violations']);

        // D'une autre année que celle d'aujourd'hui, il dit la sienne, comme la fenêtre.
        self::mockTime('2026-12-28 10:00:00 Europe/Paris');
        [$status, $body] = $this->putRecurrence(0, $change, self::weekly(until: '2027-01-04'), date: '2027-01-05');
        self::assertSame(422, $status);
        self::assertSame([['field' => 'recurrence.until', 'message' => 'Choisissez un jour à partir du mardi 5 janvier 2027.']], $body['violations']);
        self::mockTime('2026-10-06 15:20:00 Europe/Paris');

        foreach (['2026-02-30', '06/10/2026', '2026-10-6', 'demain'] as $until) {
            [$status, $body] = $this->putRecurrence(0, $change, self::weekly(until: $until));
            self::assertSame(422, $status, $until);
            self::assertSame([['field' => 'recurrence.until', 'message' => 'Une date s\'écrit AAAA-MM-JJ.']], $body['violations'], $until);
        }
        self::assertSame(0, $this->dayRows());

        // Le jour même : une fin acceptée, qui ne tombe qu'aujourd'hui.
        [$id] = $this->repeat(0, $change[0], until: self::TODAY);
        self::assertSame(self::TODAY, $this->recurrenceRow($id)['until']);
    }

    public function testChangerSeulementLaFinGardeLaMemeRecurrence(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));

        $day = $this->saveRecurrence(1, [self::work('09:15', '09:30', 'OPS-12', 'Daily')], self::weekly(until: '2026-10-30'), $id);

        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($day, [$id => 'daily']));
        self::assertSame([['recurrence' => $id, 'before' => null, 'after' => '2026-10-30']], $day['untils']);
        self::assertSame('2026-10-30', self::at($day, 'recurrences', $id, 'until'));
        self::assertSame(1, $this->recurrenceRows());

        // Rien de changé : rien à annuler.
        $day = $this->saveRecurrence(2, [self::work('09:15', '09:30', 'OPS-12', 'Daily')], self::weekly(until: '2026-10-30'), $id);
        self::assertSame([], $day['untils']);
        self::assertSame(3, $day['version']);
    }

    public function testChangerLeContenuCoupeLaRecurrenceACeJour(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        self::mockTime('2026-10-08 08:00:00 Europe/Paris');
        $day = $this->day('2026-10-08');
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($day, [$id => 'daily']));

        $day = $this->saveRecurrence(self::intAt($day, 'version'), [self::work('09:15', '09:30', 'OPS-12', 'Rétro')], self::weekly(), $id, '2026-10-08');

        $new = self::stringAt($day, 'untils', 1, 'recurrence');
        self::assertSame([
            ['recurrence' => $id, 'before' => null, 'after' => '2026-10-07'],
            ['recurrence' => $new, 'before' => '2026-10-07', 'after' => null],
        ], $day['untils']);
        self::assertSame(['09:15-09:30 OPS-12 « Rétro » ↻rétro'], self::arrows($day, [$new => 'rétro']));
        self::assertSame(['firstDay' => '2026-10-08', 'until' => null, 'posedThrough' => '2026-10-08'], $this->recurrenceRow($new));
        self::assertSame('2026-10-07', $this->recurrenceRow($id)['until']);

        // Les fois passées ne changent jamais.
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($this->day('2026-10-07'), [$id => 'daily']));
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($this->day(self::TODAY), [$id => 'daily']));

        // Les suivantes viennent de la nouvelle.
        self::mockTime('2026-10-09 08:00:00 Europe/Paris');
        self::assertSame(['09:15-09:30 OPS-12 « Rétro » ↻rétro'], self::arrows($this->day('2026-10-09'), [$new => 'rétro']));
    }

    public function testChangerLesJoursCoupeAussiLaRecurrence(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        self::mockTime('2026-10-07 08:00:00 Europe/Paris');
        $version = self::intAt($this->day('2026-10-07'), 'version');

        $day = $this->saveRecurrence($version, [self::work('09:15', '09:30', 'OPS-12', 'Daily')], self::weekly([1, 3]), $id, '2026-10-07');

        $new = self::stringAt($day, 'untils', 1, 'recurrence');
        self::assertNotSame($id, $new);
        self::assertSame([1, 3], self::at($day, 'recurrences', $new, 'weekdays'));
        self::assertSame('2026-10-06', $this->recurrenceRow($id)['until']);
    }

    public function testChangerUneRecurrenceLeJourOuElleEstNeeLaRemplace(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:45', 'OPS-12', 'Daily'));

        $day = $this->saveRecurrence(1, [self::pause('09:15', '09:45')], self::weekly(), $id);

        $new = self::stringAt($day, 'untils', 1, 'recurrence');
        self::assertSame([
            ['recurrence' => $id, 'before' => null, 'after' => '2026-10-05'],
            ['recurrence' => $new, 'before' => '2026-10-05', 'after' => null],
        ], $day['untils'], 'Retirée : elle ne tombe plus jamais.');
        self::assertSame(['09:15-09:45 pause ↻pause'], self::arrows($day, [$new => 'pause']));
        self::assertSame([$new], array_keys(self::arrayAt($day, 'recurrences')));
    }

    public function testChangerUnMorceauDeLaFoisEmporteLesAutres(): void
    {
        // La récurrence a posé deux morceaux ce jour-là : une saisie à la main, d'avant elle,
        // l'a coupée en deux.
        $this->write(0, [self::work('09:30', '09:45', 'SHOP-482')], '2026-10-08');
        [$id] = $this->repeat(0, self::work('09:00', '10:00', 'OPS-12', 'Daily'));
        self::mockTime('2026-10-08 08:00:00 Europe/Paris');
        $day = $this->day('2026-10-08');
        self::assertSame(['09:00-09:30 OPS-12 « Daily » ↻daily', '09:30-09:45 SHOP-482', '09:45-10:00 OPS-12 « Daily » ↻daily'], self::arrows($day, [$id => 'daily']));

        $day = $this->saveRecurrence(self::intAt($day, 'version'), [self::work('09:00', '09:30', 'OPS-12', 'Rétro')], self::weekly(), $id, '2026-10-08');

        $new = self::stringAt($day, 'untils', 1, 'recurrence');
        self::assertSame(['09:00-09:30 OPS-12 « Rétro » ↻rétro', '09:30-09:45 SHOP-482', '09:45-10:00 OPS-12 « Rétro » ↻rétro'], self::arrows($day, [$new => 'rétro']));
        self::assertSame(['start' => '09:00', 'end' => '10:00'], array_intersect_key(self::arrayAt($day, 'recurrences', $new), ['start' => 0, 'end' => 0]), 'La nouvelle garde la plage de l\'ancienne.');
    }

    public function testLaFenetreDUnBlocQuiRevientNeSortPasDeSaPlage(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));

        // La fenêtre ne change pas les heures d'un bloc en même temps que son contenu : un
        // appelant qui le fait relierait un quart d'heure hors de la plage de la récurrence,
        // qu'annuler ne pourrait plus rendre. Seuls le même ticket et le même commentaire
        // l'allongent (RecurrenceHoursTest).
        foreach ([
            'sa fin changée, son commentaire aussi' => [self::work('09:15', '09:45', 'OPS-12', 'Rétro'), self::weekly(until: '2026-10-30')],
            'son contenu changé' => [self::work('09:00', '09:30', 'OPS-12', 'Rétro'), self::weekly()],
        ] as $case => [$change, $rule]) {
            [$status, $body] = $this->putRecurrence(1, [$change], $rule, $id);
            self::assertSame(422, $status, $case.' : '.json_encode($body, \JSON_THROW_ON_ERROR));
            self::assertSame(['changes'], array_column(self::listAt($body, 'violations'), 'field'), $case);
        }

        self::assertSame([555 => $id], $this->links());
        self::assertSame(1, $this->recurrenceRows());

        // Décochée, la case n'en relie aucun : le bloc s'écrit tel quel.
        $day = $this->saveRecurrence(1, [self::work('09:15', '09:45', 'OPS-12', 'Daily')], null, $id);
        self::assertSame(['09:15-09:45 OPS-12 « Daily »'], self::arrows($day));
    }

    public function testDecocherLaCaseArreteLaRecurrenceAPartirDeCetteFois(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        self::mockTime('2026-10-08 08:00:00 Europe/Paris');
        $version = self::intAt($this->day('2026-10-08'), 'version');

        $day = $this->saveRecurrence($version, [self::work('09:15', '09:30', 'OPS-12', 'Daily')], null, $id, '2026-10-08');

        self::assertSame(['09:15-09:30 OPS-12 « Daily »'], self::arrows($day), 'Le bloc reste, sans flèche.');
        self::assertSame([['recurrence' => $id, 'before' => null, 'after' => '2026-10-07']], $day['untils']);
        self::assertSame([555 => null], $this->links('2026-10-08'));
        self::assertSame([], $this->skips(), 'Elle ne va plus jusqu\'à ce jour : rien n\'y est à sauter.');
        self::assertSame([555 => $id], $this->links('2026-10-07'), 'Les fois passées ne changent jamais.');

        self::mockTime('2026-10-12 08:00:00 Europe/Paris');
        self::assertSame([], self::blocks($this->day('2026-10-12')));
        self::assertSame(['2026-10-06', '2026-10-07', '2026-10-08'], $this->connection()->fetchFirstColumn('SELECT date FROM day ORDER BY date'));
    }

    public function testDecocherLaCaseLeJourOuElleEstNeeLaRetire(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:45', 'OPS-12', 'Daily'));

        // La fenêtre ne s'ouvre que sur un bloc : l'autre morceau de la fois suit.
        $day = $this->saveRecurrence(1, [self::work('09:15', '09:30', 'OPS-12', 'Daily')], null, $id);

        self::assertSame(['09:15-09:45 OPS-12 « Daily »'], self::arrows($day));
        self::assertSame([['recurrence' => $id, 'before' => null, 'after' => '2026-10-05']], $day['untils']);

        self::mockTime('2026-10-13 08:00:00 Europe/Paris');
        self::assertSame([], self::blocks($this->day('2026-10-13')));
        self::assertSame(1, $this->dayRows());
    }

    public function testUneRecurrenceChangeeAilleursNeSeRemplacePas(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        $change = [self::work('09:15', '09:30', 'OPS-12', 'Rétro')];

        // Inconnue.
        [$status, $body] = $this->putRecurrence(1, $change, self::weekly(), '0199a3c4-5b6d-7e8f-9a0b-1c2d3e4f5a6b');
        self::assertSame(409, $status);
        self::assertSame('stale', $body['error']);

        // Aucun quart d'heure ne lui est relié ce jour-là : un jour à venir où elle ne s'est pas encore posée.
        [$status] = $this->putRecurrence(0, $change, self::weekly(), $id, '2026-10-07');
        self::assertSame(409, $status);

        // Finie ailleurs avant ce jour — une fin rendue par annuler, depuis un autre jour —,
        // alors que ce jour garde sa fois.
        self::mockTime('2026-10-08 08:00:00 Europe/Paris');
        $tuesday = $this->day('2026-10-07');
        $this->writeWith(self::intAt($tuesday, 'version'), [['start' => '19:45', 'end' => '20:00', 'kind' => 'empty']], [['recurrence' => $id, 'from' => null, 'to' => '2026-10-07']], '2026-10-07');
        $thursday = $this->day('2026-10-08');
        self::assertSame([555 => $id], $this->links('2026-10-08'));
        [$status, $body] = $this->putRecurrence(self::intAt($thursday, 'version'), $change, self::weekly(), $id, '2026-10-08');
        self::assertSame(409, $status);
        self::assertSame(self::arrows($thursday), self::arrows(self::arrayAt($body, 'day')));

        self::assertSame(1, $this->recurrenceRows(), 'Aucun refus n\'a créé de récurrence.');
    }

    public function testUneRecurrenceChangeeDepuisQueLaFenetreLaVueNeSeRemplacePas(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        self::mockTime('2026-10-08 08:00:00 Europe/Paris');
        $thursday = $this->day('2026-10-08');
        // La fenêtre du Daily de jeudi s'ouvre : sans fin, du lundi au vendredi.
        $seen = $this->seen($id);
        self::assertSame(['id' => $id, 'weekdays' => [1, 2, 3, 4, 5], 'until' => null], $seen);

        // Un autre onglet lui donne une fin, depuis la fois de mercredi : jeudi ne bouge pas.
        $wednesday = $this->day('2026-10-07');
        $this->saveRecurrence(self::intAt($wednesday, 'version'), [self::work('09:15', '09:30', 'OPS-12', 'Daily')], self::weekly(until: '2026-10-09'), $id, '2026-10-07');
        self::assertSame($thursday['version'], $this->day('2026-10-08')['version']);

        // La fenêtre de jeudi enregistre ce qu'elle croit : sa fin, ou un autre ticket.
        $version = self::intAt($thursday, 'version');
        $uri = '/api/days/2026-10-08/recurrence';
        foreach ([
            [self::work('09:15', '09:30', 'OPS-12', 'Daily'), self::weekly(until: '2026-10-30')],
            [self::work('09:15', '09:30', 'OPS-12', 'Rétro'), self::weekly()],
            [self::work('09:15', '09:30', 'OPS-12', 'Daily'), null],
        ] as [$change, $rule]) {
            [$status, $body] = $this->send('PUT', $uri, ['version' => $version, 'changes' => [$change], 'recurrence' => $rule, 'replaces' => $seen]);
            self::assertSame(409, $status, json_encode($rule, \JSON_THROW_ON_ERROR));
            self::assertSame('stale', $body['error']);
            self::assertSame('2026-10-09', self::at($body, 'day', 'recurrences', $id, 'until'), 'La journée rendue montre la récurrence à jour.');
        }
        // Des jours qu'elle n'a jamais eus : pas davantage.
        [$status] = $this->send('PUT', $uri, ['version' => $version, 'changes' => [self::work('09:15', '09:30', 'OPS-12', 'Daily')], 'recurrence' => self::weekly(until: '2026-10-30'), 'replaces' => ['weekdays' => [1, 2], 'until' => '2026-10-09'] + $seen]);
        self::assertSame(409, $status);

        self::assertSame(['firstDay' => self::TODAY, 'until' => '2026-10-09', 'posedThrough' => '2026-10-08'], $this->recurrenceRow($id));
        self::assertSame(1, $this->recurrenceRows());
        self::assertSame($version, $this->day('2026-10-08')['version']);

        // Remise à jour, elle enregistre.
        $day = $this->saveRecurrence($version, [self::work('09:15', '09:30', 'OPS-12', 'Daily')], self::weekly(until: '2026-10-30'), $id, '2026-10-08');
        self::assertSame([['recurrence' => $id, 'before' => '2026-10-09', 'after' => '2026-10-30']], $day['untils']);
    }

    public function testCeQueLaFenetreAVuSeRefuseDeTraversSousSonNom(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        $uri = '/api/days/'.self::TODAY.'/recurrence';
        $body = ['version' => 1, 'changes' => [self::work('09:15', '09:30', 'OPS-12', 'Daily')], 'recurrence' => self::weekly(until: '2026-10-30')];
        $seen = $this->seen($id);

        foreach ([
            'replaces.id' => ['id' => 'daily'] + $seen,
            'replaces.id vide' => ['id' => ''] + $seen,
            'replaces.weekdays[0]' => ['weekdays' => [0]] + $seen,
            'replaces.weekdays' => ['weekdays' => [1, 2, 3, 4, 5, 6, 7, 1]] + $seen,
            'replaces.until' => ['until' => 'demain'] + $seen,
            'replaces.firstDay' => $seen + ['firstDay' => self::TODAY],
        ] as $field => $replaces) {
            [$status, $answer] = $this->send('PUT', $uri, $body + ['replaces' => $replaces]);
            self::assertSame(422, $status, $field);
            self::assertContains(explode(' ', $field)[0], array_column(self::listAt($answer, 'violations'), 'field'), $field.' : '.json_encode($answer, \JSON_THROW_ON_ERROR));
        }
        // Sans ce qu'elle a vu, la fenêtre ne remplace rien.
        foreach ([$id, ['id' => $id], ['id' => $id, 'weekdays' => 'lundi', 'until' => null], ['id' => $id, 'weekdays' => ['1'], 'until' => null]] as $replaces) {
            [$status] = $this->send('PUT', $uri, $body + ['replaces' => $replaces]);
            self::assertSame(422, $status, json_encode($replaces, \JSON_THROW_ON_ERROR));
        }

        self::assertNull($this->recurrenceRow($id)['until']);
        self::assertSame(1, $this->day()['version']);
    }

    public function testUnJourDecocheDepuisResteALaRecurrenceQuiLAvait(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        $this->setWorkingDay(3, false);
        $daily = [self::work('09:15', '09:30', 'OPS-12', 'Daily')];

        // Sa fin change : le mercredi lui reste.
        $day = $this->saveRecurrence(1, $daily, self::weekly(until: '2026-10-30'), $id);
        self::assertSame([['recurrence' => $id, 'before' => null, 'after' => '2026-10-30']], $day['untils']);
        // Son ticket change : la nouvelle le garde aussi.
        $day = $this->saveRecurrence(2, [self::work('09:15', '09:30', 'OPS-12', 'Rétro')], self::weekly(until: '2026-10-30'), $id);
        $new = self::stringAt($day, 'untils', 1, 'recurrence');
        self::assertSame([1, 2, 3, 4, 5], self::at($day, 'recurrences', $new, 'weekdays'));

        // Un jour non travaillé qu'elle n'avait pas se refuse, comme à la création.
        [$status, $body] = $this->putRecurrence(3, [self::work('09:15', '09:30', 'OPS-12', 'Rétro')], self::weekly([1, 2, 3, 4, 5, 6]), $new);
        self::assertSame(422, $status);
        self::assertSame([['field' => 'recurrence.weekdays', 'message' => 'Le samedi n\'est plus travaillé. Rechargez la page.']], $body['violations']);
        [$status, $body] = $this->putRecurrence(3, [self::work('14:00', '14:15', 'OPS-7')], self::weekly([1, 3]));
        self::assertSame(422, $status);
        self::assertSame([['field' => 'recurrence.weekdays', 'message' => 'Le mercredi n\'est plus travaillé. Rechargez la page.']], $body['violations']);

        // Le mercredi ne reçoit rien : il n'est plus travaillé.
        self::mockTime('2026-10-08 08:00:00 Europe/Paris');
        self::assertSame([], $this->day('2026-10-07')['blocks']);
        self::assertSame([555 => $new], $this->links('2026-10-08'));
    }

    public function testAnnulerUneFinSeuleNeRendAucunCreneau(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        $saved = $this->saveRecurrence(1, [self::work('09:15', '09:30', 'OPS-12', 'Daily')], self::weekly(until: '2026-10-30'), $id);
        self::assertSame('2026-10-30', $this->recurrenceRow($id)['until']);

        $this->writeWith(self::intAt($saved, 'version'), [], [['recurrence' => $id, 'from' => '2026-10-30', 'to' => null]]);

        self::assertNull($this->recurrenceRow($id)['until']);
        self::assertSame([555 => $id], $this->links());
        [$status, $body] = $this->patchSlotsWith(self::intAt($this->day(self::TODAY), 'version'), [], []);
        self::assertSame(422, $status);
        self::assertSame([['field' => 'changes', 'message' => 'Le geste ne change aucun créneau.']], $body['violations']);
    }

    public function testDepuisUnJourPasseLeRythmeChangeAPartirDeDemain(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        self::mockTime('2026-10-08 08:00:00 Europe/Paris');
        $tuesday = $this->day(self::TODAY);

        $day = $this->saveRecurrence(self::intAt($tuesday, 'version'), [self::work('09:15', '09:30', 'OPS-12', 'Daily')], self::weekly([1, 2]), $id);

        $new = self::stringAt($day, 'untils', 1, 'recurrence');
        self::assertSame([
            ['recurrence' => $id, 'before' => null, 'after' => '2026-10-08'],
            ['recurrence' => $new, 'before' => '2026-10-08', 'after' => null],
        ], $day['untils']);
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($day, [$id => 'daily']), 'Le bloc passé reste une fois de l\'ancienne.');
        self::assertSame(['firstDay' => self::TODAY, 'until' => '2026-10-08', 'posedThrough' => '2026-10-08'], $this->recurrenceRow($id));
        self::assertSame(['firstDay' => '2026-10-09', 'until' => null, 'posedThrough' => '2026-10-08'], $this->recurrenceRow($new));
        // Les fois passées et celle d'aujourd'hui ne changent jamais.
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($this->day('2026-10-07'), [$id => 'daily']));
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($this->day('2026-10-08'), [$id => 'daily']));

        // Vendredi, la nouvelle ne tombe pas ; lundi, si.
        self::mockTime('2026-10-12 08:00:00 Europe/Paris');
        self::assertSame([], self::arrows($this->day('2026-10-09')));
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($this->day('2026-10-12'), [$new => 'daily']));
    }

    public function testDepuisUnJourPasseCeQuOnChangeAuBlocNeVautQuePourCetteFois(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        self::mockTime('2026-10-08 08:00:00 Europe/Paris');
        $tuesday = $this->day(self::TODAY);

        $day = $this->saveRecurrence(self::intAt($tuesday, 'version'), [self::work('09:15', '09:30', 'OPS-12', 'Rétro')], self::weekly(), $id);

        self::assertSame([], $day['untils']);
        self::assertSame(['09:15-09:30 OPS-12 « Rétro »'], self::arrows($day));
        self::assertSame([$id.' '.self::TODAY], $this->skips());
        self::assertSame(['firstDay' => self::TODAY, 'until' => null, 'posedThrough' => '2026-10-08'], $this->recurrenceRow($id));
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($this->day('2026-10-08'), [$id => 'daily']));
        self::assertSame(1, $this->recurrenceRows());
    }

    public function testDepuisUnJourPasseDecocherLaCaseLArreteApresAujourdhui(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        self::mockTime('2026-10-08 08:00:00 Europe/Paris');
        $tuesday = $this->day(self::TODAY);

        $day = $this->saveRecurrence(self::intAt($tuesday, 'version'), [self::work('09:15', '09:30', 'OPS-12', 'Daily')], null, $id);

        self::assertSame([['recurrence' => $id, 'before' => null, 'after' => '2026-10-08']], $day['untils']);
        self::assertSame(['09:15-09:30 OPS-12 « Daily »'], self::arrows($day), 'Le bloc reste, sans flèche.');
        self::assertSame(['firstDay' => self::TODAY, 'until' => '2026-10-08', 'posedThrough' => '2026-10-08'], $this->recurrenceRow($id));
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($this->day('2026-10-08'), [$id => 'daily']));

        // Annuler rend la fin et la flèche.
        $this->writeWith(self::intAt($day, 'version'), [self::linked(self::work('09:15', '09:30', 'OPS-12', 'Daily'), $id)], [['recurrence' => $id, 'from' => '2026-10-08', 'to' => null]]);
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($this->day(self::TODAY), [$id => 'daily']));
        self::assertNull($this->recurrenceRow($id)['until']);
        self::assertSame([], $this->skips());
    }

    public function testDepuisUnJourPasseLaFinNeVaPasAvantDemainNiAujourdhui(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        self::mockTime('2026-10-08 08:00:00 Europe/Paris');
        $version = self::intAt($this->day(self::TODAY), 'version');
        $daily = [self::work('09:15', '09:30', 'OPS-12', 'Daily')];

        // Seule la fin change : elle va jusqu'à aujourd'hui au moins, où elle s'est posée.
        [$status, $body] = $this->putRecurrence($version, $daily, self::weekly(until: '2026-10-07'), $id);
        self::assertSame(422, $status);
        self::assertSame([['field' => 'recurrence.until', 'message' => 'Choisissez un jour à partir du jeudi 8 octobre.']], $body['violations']);
        // Le rythme change : la nouvelle part de demain.
        [$status, $body] = $this->putRecurrence($version, $daily, self::weekly([1, 2], '2026-10-08'), $id);
        self::assertSame(422, $status);
        self::assertSame([['field' => 'recurrence.until', 'message' => 'Choisissez un jour à partir du vendredi 9 octobre.']], $body['violations']);
        self::assertSame(['firstDay' => self::TODAY, 'until' => null, 'posedThrough' => '2026-10-08'], $this->recurrenceRow($id));

        $day = $this->saveRecurrence($version, $daily, self::weekly(until: '2026-10-08'), $id);
        self::assertSame([['recurrence' => $id, 'before' => null, 'after' => '2026-10-08']], $day['untils']);
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($day, [$id => 'daily']));
        self::assertSame(1, $this->recurrenceRows());
    }

    public function testUnBlocQueLeRythmeNeCouvrePasNePortePasLaRecurrence(): void
    {
        // Mardi, pour chaque lundi : la récurrence naît, le bloc n'en est pas une fois.
        [$id, $day] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'), [1]);
        self::assertSame(['09:15-09:30 OPS-12 « Daily »'], self::arrows($day));
        self::assertSame([555 => null], $this->links());
        self::assertSame(['firstDay' => self::TODAY, 'until' => null, 'posedThrough' => self::TODAY], $this->recurrenceRow($id));
        self::mockTime('2026-10-12 08:00:00 Europe/Paris');
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($this->day('2026-10-12'), [$id => 'daily']));

        // Couper un mardi pour les seuls lundi et mercredi laisse le mardi sans flèche.
        [$point] = $this->repeat(0, self::work('11:00', '11:15', 'OPS-7', 'Point'), date: '2026-10-13');
        $version = self::intAt($this->day('2026-10-13'), 'version');
        $day = $this->saveRecurrence($version, [self::work('11:00', '11:15', 'OPS-7', 'Point')], self::weekly([1, 3]), $point, '2026-10-13');
        self::assertSame(['11:00-11:15 OPS-7 « Point »'], self::arrows($day));
        self::assertSame('2026-10-12', $this->recurrenceRow($point)['until']);
    }

    public function testAnnulerNeRelieQuUnJourOuLaRecurrenceTombe(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));

        foreach (['2026-10-05' => 'avant son premier jour', '2026-10-10' => 'un samedi'] as $date => $case) {
            [$status] = $this->patchSlotsWith(0, [self::linked(self::work('09:15', '09:30', 'OPS-12', 'Daily'), $id)], [], $date);
            self::assertSame(409, $status, $case);
        }
    }

    public function testUnOngletEnRetardNEnregistreRien(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        $this->write(1, [self::work('10:00', '11:00', 'SHOP-482')]);

        [$status, $body] = $this->putRecurrence(1, [self::work('09:15', '09:30', 'OPS-12', 'Rétro')], self::weekly(), $id);
        self::assertSame(409, $status);
        self::assertSame(2, self::at($body, 'day', 'version'));

        [$status] = $this->putRecurrence(0, [self::work('14:00', '14:30', 'OPS-7')], self::weekly());
        self::assertSame(409, $status, 'La même création, envoyée deux fois.');

        self::assertSame(1, $this->recurrenceRows());
        self::assertSame(['firstDay' => self::TODAY, 'until' => null, 'posedThrough' => self::TODAY], $this->recurrenceRow($id));
    }

    public function testUnCreneauDeLaFenetreNePortePasDeRecurrence(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));

        [$status, $body] = $this->putRecurrence(1, [self::linked(self::work('09:15', '09:30', 'OPS-12', 'Daily'), $id)], self::weekly(until: '2026-10-30'), $id);

        self::assertSame(422, $status);
        self::assertSame(['Un créneau de la fenêtre ne porte pas de récurrence : c\'est elle qui le pose.'], array_column(self::listAt($body, 'violations'), 'message'));
        self::assertNull($this->recurrenceRow($id)['until']);
    }

    public function testUnTicketQueJiraNeConnaitPasNeSeRepetePas(): void
    {
        $this->linkJira();

        [$status, $body] = $this->putRecurrence(0, [self::work('09:15', '09:30', 'SHOP-999')], self::weekly());

        self::assertSame(422, $status);
        self::assertSame([['field' => 'changes[0].ticket', 'message' => 'Ticket introuvable dans Jira. Vérifiez l\'identifiant.']], $body['violations']);
        self::assertSame(0, $this->dayRows());
        self::assertSame(0, $this->recurrenceRows());
    }

    public function testLesBornesDeLaGrilleSeRepetent(): void
    {
        $day = $this->saveRecurrence(0, [self::work('07:00', '07:15', 'OPS-7')], self::weekly());
        $day = $this->saveRecurrence(1, [self::work('19:45', '20:00', 'OPS-7')], self::weekly());
        self::assertSame(['07:00-07:15 OPS-7', '19:45-20:00 OPS-7'], self::blocks($day));

        foreach ([['06:45', '07:00', 'changes[0].start'], ['19:45', '20:15', 'changes[0].end'], ['09:10', '09:25', 'changes[0].start']] as [$start, $end, $field]) {
            [$status, $body] = $this->putRecurrence(2, [self::work($start, $end, 'OPS-7')], self::weekly());
            self::assertSame(422, $status, $start);
            self::assertContains($field, array_column(self::listAt($body, 'violations'), 'field'));
        }
        self::assertSame(2, $this->recurrenceRows());
    }

    public function testUnAutreSiteNeFaitRienEnregistrer(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));

        foreach ([[], ['HTTP_SEC_FETCH_SITE' => 'cross-site', 'HTTP_ORIGIN' => 'https://evil.example'], ['HTTP_ORIGIN' => 'null']] as $server) {
            [$status, $body] = $this->putRecurrence(1, [self::work('14:00', '14:30', 'OPS-7')], self::weekly(), server: $server);
            self::assertSame(403, $status);
            self::assertSame('cross_origin', $body['error']);

            [$status] = $this->putRecurrence(1, [self::work('09:15', '09:30', 'OPS-12', 'Daily')], null, $id, server: $server);
            self::assertSame(403, $status);

            [$status] = $this->patchSlotsWith(1, [self::clear('09:15', '09:30')], [['recurrence' => $id, 'from' => null, 'to' => '2026-10-05']], server: $server);
            self::assertSame(403, $status);
        }

        self::assertSame(1, $this->recurrenceRows());
        self::assertNull($this->recurrenceRow($id)['until']);
        self::assertSame([555 => $id], $this->links());
    }

    public function testUnChampInconnuSeRefuseSousSonNom(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));

        $uri = '/api/days/'.self::TODAY.'/recurrence';
        $cases = [
            'recurrence.every' => ['version' => 1, 'changes' => [self::work('14:00', '14:30', 'OPS-7')], 'recurrence' => ['weekdays' => [1], 'until' => null, 'every' => 2], 'replaces' => null],
            'changes[0].repeat' => ['version' => 1, 'changes' => [self::work('14:00', '14:30', 'OPS-7') + ['repeat' => true]], 'recurrence' => self::weekly(), 'replaces' => null],
            'replace' => ['version' => 1, 'changes' => [self::work('14:00', '14:30', 'OPS-7')], 'recurrence' => self::weekly(), 'replace' => $id],
        ];
        foreach ($cases as $field => $body) {
            [$status, $answer] = $this->send('PUT', $uri, $body);
            self::assertSame(422, $status, $field);
            self::assertContains(['field' => $field, 'message' => 'Valeur invalide.'], self::listAt($answer, 'violations'), $field);
        }

        [$status, $answer] = $this->patchSlotsWith(1, [self::clear('09:15', '09:30')], [['recurrence' => $id, 'from' => null, 'to' => '2026-10-05', 'until' => null]]);
        self::assertSame(422, $status);
        self::assertContains(['field' => 'recurrences[0].until', 'message' => 'Valeur invalide.'], self::listAt($answer, 'violations'));

        self::assertSame(1, $this->recurrenceRows());
        self::assertSame(1, $this->day()['version']);
    }

    public function testEffacerUneFoisLaDetacheEtAnnulerLaRend(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:45', 'OPS-12', 'Daily'));

        // Effacer un seul quart d'heure : la fois entière se détache, l'autre garde son contenu.
        $day = $this->write(1, [self::clear('09:15', '09:30')]);
        self::assertSame(['09:30-09:45 OPS-12 « Daily »'], self::arrows($day));
        self::assertSame([570 => null], $this->links());
        self::assertSame([$id.' '.self::TODAY], $this->skips());
        self::assertStringContainsString('"recurrences":{}', (string) $this->browser->getResponse()->getContent(), 'Un objet même vide.');

        // Annuler : les deux quarts d'heure reviennent à leur récurrence.
        $day = $this->write(2, [self::linked(self::work('09:15', '09:30', 'OPS-12', 'Daily'), $id), self::linked(self::work('09:30', '09:45', 'OPS-12', 'Daily'), $id)]);
        self::assertSame(['09:15-09:45 OPS-12 « Daily » ↻daily'], self::arrows($day, [$id => 'daily']));
        self::assertSame([], $this->skips());
        self::assertSame([$id], array_keys(self::arrayAt($day, 'recurrences')));

        // Rétablir la détache de nouveau.
        $this->write(3, [self::clear('09:15', '09:30'), self::work('09:30', '09:45', 'OPS-12', 'Daily')]);
        self::assertSame([$id.' '.self::TODAY], $this->skips());
    }

    public function testToutGesteQuiPrendUnQuartDHeureDetacheLaFoisEntiere(): void
    {
        $gestures = [
            'coller par-dessus' => [self::work('09:30', '09:45', 'SHOP-482')],
            'convertir en pause' => [self::pause('09:15', '09:30')],
            'remplacer le commentaire' => [self::work('09:15', '09:45', 'OPS-12', 'Retro')],
            'glisser un autre bloc' => [self::work('09:00', '09:30', 'OPS-7')],
        ];
        foreach ($gestures as $gesture => $changes) {
            self::purgeDatabase();
            [$id] = $this->repeat(0, self::work('09:15', '09:45', 'OPS-12', 'Daily'));

            $day = $this->write(1, $changes);

            self::assertSame([], array_filter(array_column(self::listAt($day, 'blocks'), 'recurrence'), static fn (mixed $recurrence): bool => null !== $recurrence), $gesture);
            self::assertSame([$id.' '.self::TODAY], $this->skips(), $gesture);
            self::assertNull($this->recurrenceRow($id)['until'], $gesture.' : seule cette fois change.');
        }
    }

    public function testUnGesteACoteNeTouchePasLaFois(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:45', 'OPS-12', 'Daily'));

        $day = $this->write(1, [self::work('09:00', '09:15', 'OPS-12', 'Daily'), self::work('09:45', '10:00', 'OPS-12', 'Daily')]);

        // Même contenu de part et d'autre, mais sans récurrence : trois blocs.
        self::assertSame(['09:00-09:15 OPS-12 « Daily »', '09:15-09:45 OPS-12 « Daily » ↻daily', '09:45-10:00 OPS-12 « Daily »'], self::arrows($day, [$id => 'daily']));
        self::assertSame([], $this->skips());
    }

    public function testAnnulerLaCreationRetireLaRecurrenceEtRetablirLaRend(): void
    {
        $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')]);
        [$id] = $this->repeat(1, self::work('09:15', '09:30', 'OPS-12', 'Daily'));

        // Annuler : le quart d'heure d'avant, et la fin d'avant.
        $day = $this->writeWith(2, [self::work('09:15', '09:30', 'SHOP-482')], [['recurrence' => $id, 'from' => null, 'to' => '2026-10-05']]);
        self::assertSame(['09:00-10:00 SHOP-482'], self::arrows($day));
        self::assertSame('2026-10-05', $this->recurrenceRow($id)['until']);

        // Rétablir.
        $day = $this->writeWith(3, [self::linked(self::work('09:15', '09:30', 'OPS-12', 'Daily'), $id)], [['recurrence' => $id, 'from' => '2026-10-05', 'to' => null]]);
        self::assertSame(['09:00-09:15 SHOP-482', '09:15-09:30 OPS-12 « Daily » ↻daily', '09:30-10:00 SHOP-482'], self::arrows($day, [$id => 'daily']));
        self::assertNull($this->recurrenceRow($id)['until']);
        self::assertSame([], $this->skips());

        self::mockTime('2026-10-07 08:00:00 Europe/Paris');
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($this->day('2026-10-07'), [$id => 'daily']));
    }

    public function testAnnulerUnChangementRendLaRecurrenceDAvant(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        self::mockTime('2026-10-08 08:00:00 Europe/Paris');
        $version = self::intAt($this->day('2026-10-08'), 'version');
        $day = $this->saveRecurrence($version, [self::work('09:15', '09:30', 'OPS-12', 'Rétro')], self::weekly(), $id, '2026-10-08');
        $new = self::stringAt($day, 'untils', 1, 'recurrence');

        $day = $this->writeWith(self::intAt($day, 'version'), [self::linked(self::work('09:15', '09:30', 'OPS-12', 'Daily'), $id)], [
            ['recurrence' => $id, 'from' => '2026-10-07', 'to' => null],
            ['recurrence' => $new, 'from' => null, 'to' => '2026-10-07'],
        ], '2026-10-08');

        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($day, [$id => 'daily']));
        self::assertNull($this->recurrenceRow($id)['until']);
        self::assertSame('2026-10-07', $this->recurrenceRow($new)['until']);

        self::mockTime('2026-10-09 08:00:00 Europe/Paris');
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($this->day('2026-10-09'), [$id => 'daily']));
    }

    public function testAnnulerUneFinQuiAChangeAilleursNeDefaitRien(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));
        // Un autre onglet repousse sa fin, depuis le même bloc.
        $this->saveRecurrence(1, [self::work('09:15', '09:30', 'OPS-12', 'Daily')], self::weekly(until: '2026-10-30'), $id);

        // L'annulation de la création, partie d'un onglet qui ne l'a pas vu, sur une autre journée.
        [$status, $body] = $this->patchSlotsWith(0, [self::work('14:00', '14:15', 'OPS-7')], [['recurrence' => $id, 'from' => null, 'to' => '2026-10-05']], '2026-10-07');

        self::assertSame(409, $status);
        self::assertSame('stale', $body['error']);
        self::assertSame('2026-10-30', $this->recurrenceRow($id)['until']);
        self::assertSame(1, $this->dayRows(), 'Rien n\'est écrit, pas même la journée.');
    }

    public function testUneFinRendueDoitEtreUneFinQuElleAPuAvoir(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'));

        $cases = [
            'avant la veille de son premier jour' => [['recurrence' => $id, 'from' => null, 'to' => '2026-09-01'], 409],
            'une récurrence inconnue' => [['recurrence' => '0199a3c4-5b6d-7e8f-9a0b-1c2d3e4f5a6b', 'from' => null, 'to' => null], 409],
            'pas une date' => [['recurrence' => $id, 'from' => null, 'to' => '05/10/2026'], 422],
            'pas une récurrence' => [['recurrence' => 'daily', 'from' => null, 'to' => null], 422],
            'une récurrence vide' => [['recurrence' => '', 'from' => null, 'to' => null], 422],
        ];
        foreach ($cases as $case => [$rewind, $expected]) {
            [$status] = $this->patchSlotsWith(1, [self::work('14:00', '14:15', 'OPS-7')], [$rewind]);
            self::assertSame($expected, $status, $case);
        }

        $three = array_fill(0, 3, ['recurrence' => $id, 'from' => null, 'to' => null]);
        [$status, $body] = $this->patchSlotsWith(1, [self::work('14:00', '14:15', 'OPS-7')], $three);
        self::assertSame(422, $status);
        self::assertSame([['field' => 'recurrences', 'message' => 'Un geste change au plus deux récurrences.']], $body['violations']);

        self::assertSame(1, $this->day()['version']);
        self::assertNull($this->recurrenceRow($id)['until']);
    }

    public function testUnCreneauNeSeRelieQuAuContenuEtALaPlageDeSaRecurrence(): void
    {
        [$id] = $this->repeat(0, self::work('09:15', '09:45', 'OPS-12', 'Daily'));
        $this->write(1, [self::clear('09:15', '09:45')]);

        $refused = [
            'un autre ticket' => self::linked(self::work('09:15', '09:30', 'OPS-7', 'Daily'), $id),
            'un autre commentaire' => self::linked(self::work('09:15', '09:30', 'OPS-12', 'Rétro'), $id),
            'une pause' => self::linked(self::pause('09:15', '09:30'), $id),
            'hors de sa plage' => self::linked(self::work('09:30', '10:00', 'OPS-12', 'Daily'), $id),
            'avant sa plage' => self::linked(self::work('09:00', '09:15', 'OPS-12', 'Daily'), $id),
            'un effacement' => self::linked(self::clear('09:15', '09:30'), $id),
            'une récurrence inconnue' => self::linked(self::work('09:15', '09:30', 'OPS-12', 'Daily'), '0199a3c4-5b6d-7e8f-9a0b-1c2d3e4f5a6b'),
        ];
        foreach ($refused as $case => $change) {
            [$status, $body] = $this->patchSlots(2, [self::work('11:00', '11:15', 'SHOP-482'), $change]);
            self::assertSame(422, $status, $case);
            self::assertSame([['field' => 'changes[1].recurrence', 'message' => 'Ce créneau n\'appartient pas à cette récurrence.']], $body['violations'], $case);
        }

        [$status, $body] = $this->patchSlots(2, [self::linked(self::work('09:15', '09:30', 'OPS-12', 'Daily'), 'daily')]);
        self::assertSame(422, $status);
        self::assertSame([['field' => 'changes[0].recurrence', 'message' => 'Récurrence inconnue.']], $body['violations']);

        self::assertSame(2, $this->day()['version']);
        self::assertSame([$id.' '.self::TODAY], $this->skips());

        // Une partie de sa plage, à son contenu, se relie.
        $day = $this->write(2, [self::linked(self::work('09:30', '09:45', 'OPS-12', 'Daily'), $id)]);
        self::assertSame(['09:30-09:45 OPS-12 « Daily » ↻daily'], self::arrows($day, [$id => 'daily']));
        self::assertSame([], $this->skips());
    }

    public function testUnLienAUnTicketQueJiraNeConnaitPlusSeRelieQuandMeme(): void
    {
        // Le ticket a été accepté à la création ; Jira ne le connaît plus à l'annulation.
        $this->linkJira();
        $this->simulate('panne', ['panne' => true]);
        [$id] = $this->repeat(0, self::work('09:15', '09:30', 'SHOP-999'));
        $this->write(1, [self::clear('09:15', '09:30')]);
        $this->simulate('panne', ['panne' => false]);

        $day = $this->write(2, [self::linked(self::work('09:15', '09:30', 'SHOP-999'), $id)]);

        self::assertSame(['09:15-09:30 SHOP-999 ↻id'], self::arrows($day, [$id => 'id']));
    }

    public function testUnJourFermeEtVideDitQueSesRecurrencesNeSyPosentPas(): void
    {
        $this->repeat(0, self::work('09:15', '09:30', 'OPS-12', 'Daily'), [1, 2, 3, 4, 5]);
        [, $tuesdays] = $this->repeat(1, self::work('10:00', '10:15', 'OPS-7'), [2]);
        self::assertFalse($tuesdays['recurrencesHeld']);

        // Mis à 0h00 : un congé, sur le mercredi tel qu'il se montre, ses fois prévues comprises.
        [$status] = $this->putObjective(self::intAt($this->day('2026-10-07'), 'version'), 0, '2026-10-07');
        self::assertSame(200, $status);
        self::assertTrue($this->day('2026-10-07')['recurrencesHeld']);

        // Un samedi : aucune ne tombe.
        self::assertFalse($this->day('2026-10-10')['recurrencesHeld']);

        // Un jour décoché des réglages, où elles tombaient.
        $this->setWorkingDay(4, false);
        self::assertTrue($this->day('2026-10-08')['recurrencesHeld']);

        // Avant leur premier jour, il n'y en avait pas.
        self::assertFalse($this->day('2026-10-01')['recurrencesHeld']);

        // Saisi quand même, il n'est plus vide.
        $this->write(1, [self::work('14:00', '14:15', 'SHOP-482')], '2026-10-07');
        self::assertFalse($this->day('2026-10-07')['recurrencesHeld']);
        self::assertSame(2, $this->dayRows(), 'Lire ces jours n\'a rien écrit.');
    }
}
