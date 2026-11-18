<?php

namespace App\Tests\Recurrence;

use App\Day\Quarter;
use App\Day\SlotContent;
use App\Day\UserCalendar;
use App\Entity\Recurrence;
use App\Recurrence\RecurrenceClash;
use App\Recurrence\RecurrenceView;
use App\Recurrence\Rhythm;
use App\Recurrence\RhythmKind;
use App\Settings\UserSettings;
use App\Tests\Support\RandomSuite;
use App\Tests\Support\ReadsJson;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Random\Randomizer;

/**
 * Les fois d'une récurrence : les jours où son rythme tombe, entre son premier jour et sa
 * fin, travaillés selon les réglages. La fenêtre les annonce, le serveur les pose : les
 * deux rejouent les mêmes cas.
 *
 * Deux récurrences qui voudraient le même créneau se cherchent de même (RecurrenceClash) :
 * sur les cas partagés, et sur des paires tirées au hasard, qu'un parcours jour par jour
 * départage. RANDOM_SEED rejoue un tirage, RANDOM_PAIRS en règle le nombre.
 *
 * @phpstan-type Spec array{kind: string, weekdays: list<int>, everyWeeks: int, monthWeek: ?int, monthDay: ?int, firstDay: string, until: ?string, start: int, end: int}
 */
final class RhythmTest extends TestCase
{
    use RandomSuite;
    use ReadsJson;

    private const string CASES = __DIR__.'/../cases/recurrences.json';

    /** Au-delà, une récurrence qui n'a plus de fois les chercherait sans fin. */
    private const int SEARCH_DAYS = 5 * 366;

    /** Les paires tirées à chaque passage, par défaut. */
    private const int PAIRS = 5000;

    /**
     * Les cas que le navigateur rejoue aussi (tests/front/grid/recurrence.test.ts).
     *
     * @param array<mixed> $case
     */
    #[DataProvider('sharedCases')]
    public function testLesFoisDesCasPartagesAvecLeNavigateur(array $case): void
    {
        $rhythm = self::rhythmOf(self::arrayAt($case, 'rhythm'));
        $until = self::at($case, 'until');
        self::assertTrue(null === $until || \is_string($until));
        $recurrence = new Recurrence(SlotContent::work('OPS-12', 'Daily'), 555, 570, $rhythm, self::date(self::stringAt($case, 'firstDay')), null === $until ? null : self::date($until), self::date(self::stringAt($case, 'firstDay')));

        /** @var list<int> $workingDays */
        $workingDays = self::arrayAt($case, 'workingDays');
        $count = self::intAt($case, 'count');
        $times = [];
        $date = self::date(self::stringAt($case, 'after'));
        for ($day = 0; $day < self::SEARCH_DAYS && \count($times) < $count; ++$day) {
            $date = $date->modify('+1 day');
            if ($recurrence->fallsOn($date) && UserSettings::worksOn($workingDays, $date)) {
                $times[] = $date->format('Y-m-d');
            }
        }

        self::assertSame(self::at($case, 'times'), $times);
    }

    /**
     * Le rythme que l'API rend d'une récurrence (RecurrenceView) a la forme de celui des cas :
     * c'est lui que la fenêtre relit pour calculer les mêmes fois.
     *
     * @param array<mixed> $case
     */
    #[DataProvider('sharedCases')]
    public function testLeRythmeRenduParLApiEstCeluiDesCas(array $case): void
    {
        $rhythm = self::rhythmOf(self::arrayAt($case, 'rhythm'));
        $recurrence = new Recurrence(SlotContent::pause(), Quarter::FIRST, Quarter::DAY_END, $rhythm, self::date('2026-10-06'), null, self::date('2026-10-06'));

        self::assertTrue($recurrence->rhythm()->equals($rhythm), 'Le rythme se relit tel qu\'il a été enregistré.');
        self::assertSame(self::at($case, 'rhythm'), array_intersect_key(RecurrenceView::of($recurrence), ['kind' => 0, 'weekdays' => 0, 'everyWeeks' => 0, 'monthWeek' => 0, 'monthDay' => 0]));
    }

    /**
     * @return iterable<string, array{array<mixed>}>
     */
    public static function sharedCases(): iterable
    {
        $json = file_get_contents(self::CASES);
        self::assertIsString($json);

        foreach (self::listAt(json_decode($json, true, flags: \JSON_THROW_ON_ERROR), 'cases') as $case) {
            yield self::stringAt($case, 'name') => [$case];
        }
    }

    /**
     * Les conflits que le navigateur rejoue aussi : la première date où deux récurrences
     * voudraient le même créneau, la même quel que soit l'ordre où on les compare.
     *
     * @param array<mixed> $case
     */
    #[DataProvider('sharedConflicts')]
    public function testLesConflitsDesCasPartagesAvecLeNavigateur(array $case): void
    {
        $a = self::clashing(self::arrayAt($case, 'a'));
        $b = self::clashing(self::arrayAt($case, 'b'));
        $skipped = self::skippedOf($case, $a, $b);
        $closed = self::closedOf($case);
        $clash = self::at($case, 'clash');

        self::assertSame($clash, RecurrenceClash::first($a, $b, null, $skipped, $closed)?->format('Y-m-d'), 'a, puis b.');
        self::assertSame($clash, RecurrenceClash::first($b, $a, null, $skipped, $closed)?->format('Y-m-d'), 'b, puis a.');

        // La plus tôt parmi les autres, sans jamais elle-même.
        self::assertNull(RecurrenceClash::earliest($a, [$a], null, $skipped, $closed));
        $earliest = RecurrenceClash::earliest($a, [$a, $b], null, $skipped, $closed);
        self::assertSame(null === $clash ? null : [$b, $clash], null === $earliest ? null : [$earliest[0], $earliest[1]->format('Y-m-d')]);
    }

    /**
     * La recherche ne parcourt que les fois d'un rythme mensuel, ou un cycle de semaines :
     * jour après jour, on ne trouve rien plus tôt.
     *
     * @param array<mixed> $case
     */
    #[DataProvider('sharedConflicts')]
    public function testUnConflitEstLePremierJourCommun(array $case): void
    {
        $a = self::clashing(self::arrayAt($case, 'a'));
        $b = self::clashing(self::arrayAt($case, 'b'));
        $skipped = self::skippedOf($case, $a, $b);
        $closed = self::closedOf($case);
        $clash = self::at($case, 'clash');
        self::assertTrue(null === $clash || \is_string($clash));
        $crosses = $a->start < $b->end && $b->start < $a->end;
        $takes = static fn (Recurrence $recurrence, \DateTimeImmutable $date): bool => $recurrence->fallsOn($date)
            && !\in_array($date->format('Y-m-d'), $skipped[$recurrence->id->toRfc4122()] ?? [], true)
            && !\in_array($date->format('Y-m-d'), $closed, true);

        $first = null;
        $last = self::date($clash ?? '2030-12-31');
        for ($date = max($a->firstDay, $b->firstDay); null === $first && $date <= $last; $date = $date->modify('+1 day')) {
            if ($crosses && $takes($a, $date) && $takes($b, $date)) {
                $first = $date->format('Y-m-d');
            }
        }

        self::assertSame($clash, $first);
    }

    /**
     * @return iterable<string, array{array<mixed>}>
     */
    public static function sharedConflicts(): iterable
    {
        $json = file_get_contents(self::CASES);
        self::assertIsString($json);

        foreach (self::listAt(json_decode($json, true, flags: \JSON_THROW_ON_ERROR), 'conflicts') as $case) {
            yield self::stringAt($case, 'name') => [$case];
        }
    }

    public function testAMemeDateLaPlusAncienneEstNommee(): void
    {
        $first = self::date('2026-10-08');
        $older = new Recurrence(SlotContent::work('OPS-7', 'Rétrospective'), 840, 900, Rhythm::weekly([4], 2), $first, null, $first);
        $newer = new Recurrence(SlotContent::pause(), 870, 930, Rhythm::weekly([4]), $first, null, $first);
        $candidate = new Recurrence(SlotContent::work('OPS-12', 'Démo'), 840, 900, Rhythm::weekly([4]), self::date('2026-10-15'), null, self::date('2026-10-15'));

        // Toutes deux le 22 octobre ; la pause tombe aussi le 15, avant.
        self::assertSame([$newer, '2026-10-15'], self::named(RecurrenceClash::earliest($candidate, [$older, $newer])));
        $newer->endOn(self::date('2026-10-15'));
        self::assertSame([$newer, '2026-10-15'], self::named(RecurrenceClash::earliest($candidate, [$newer, $older])));
        $newer->endOn(self::date('2026-10-14'));
        self::assertSame([$older, '2026-10-22'], self::named(RecurrenceClash::earliest($candidate, [$newer, $older])), 'Finie la veille, la pause ne prend plus rien.');

        // Le même jour : la plus ancienne, quel que soit l'ordre où on les donne.
        $newer->endOn(null);
        $later = new Recurrence(SlotContent::pause(), 870, 930, Rhythm::weekly([4]), self::date('2026-10-22'), null, self::date('2026-10-22'));
        self::assertSame([$older, '2026-10-22'], self::named(RecurrenceClash::earliest($candidate, [$later, $older])));
        self::assertSame([$older, '2026-10-22'], self::named(RecurrenceClash::earliest($candidate, [$older, $later])));
    }

    /**
     * Un jour déjà venu ne reçoit jamais rien après coup : un conflit ne compte qu'après
     * aujourd'hui. Les cas partagés cherchent sans borne ; la recherche part sinon du lendemain.
     */
    public function testUnConflitNeCompteQuApresAujourdHui(): void
    {
        $content = SlotContent::work('OPS-12', 'Daily');
        $at = static fn (string $first, ?string $until, Rhythm $rhythm, int $start = 840, int $end = 900): Recurrence => new Recurrence($content, $start, $end, $rhythm, self::date($first), null === $until ? null : self::date($until), self::date($first));

        // Les deux jeudis de 2016 et 2017 que des essais ont laissés : finis, ils ne prennent plus rien.
        $old = $at('2016-01-07', '2017-06-29', Rhythm::weekly([4]));
        $again = $at('2016-03-03', null, Rhythm::weekly([4], 2));
        self::assertSame('2016-03-03', RecurrenceClash::first($old, $again)?->format('Y-m-d'));
        self::assertNull(RecurrenceClash::first($old, $again, self::date('2026-10-06')));
        self::assertNull(RecurrenceClash::first($again, $old, self::date('2026-10-06')));
        // Sans fin, la plus ancienne prend toujours son créneau.
        $endless = $at('2016-01-07', null, Rhythm::weekly([4]));
        self::assertSame('2026-10-15', RecurrenceClash::first($endless, $again, self::date('2026-10-06'))?->format('Y-m-d'), 'Le premier jeudi de sa semaine, après aujourd\'hui.');

        $daily = $at('2026-10-06', null, Rhythm::weekly([1, 2, 3, 4, 5]), 555, 570);
        $today = $at('2026-10-06', '2026-10-06', Rhythm::weekly([2]), 555, 570);
        $thursday = $at('2026-10-06', '2026-10-08', Rhythm::weekly([2, 4]), 555, 570);
        self::assertSame('2026-10-06', RecurrenceClash::first($daily, $today)?->format('Y-m-d'));
        self::assertNull(RecurrenceClash::first($daily, $today, self::date('2026-10-06')), 'Le jour même : déjà venu.');
        self::assertSame('2026-10-08', RecurrenceClash::first($daily, $thursday, self::date('2026-10-06'))?->format('Y-m-d'), 'La première date après lui.');
        self::assertSame('2026-10-08', RecurrenceClash::first($daily, $thursday, self::date('2026-10-07'))?->format('Y-m-d'), 'Le lendemain d\'aujourd\'hui compte.');
        self::assertNull(RecurrenceClash::first($daily, $thursday, self::date('2026-10-08')));

        // Un rythme mensuel aussi : le 6 d'octobre passé, celui de novembre compte.
        $sixth = $at('2026-10-06', null, Rhythm::monthlyDate(6), 555, 570);
        self::assertSame('2026-11-06', RecurrenceClash::first($sixth, $daily, self::date('2026-10-06'))?->format('Y-m-d'));
        self::assertSame('2026-11-06', RecurrenceClash::first($daily, $sixth, self::date('2026-10-06'))?->format('Y-m-d'));
        // Le 6 tombe un samedi en février et en mars 2027 : celui d'avril, un mardi.
        self::assertSame('2027-04-06', RecurrenceClash::first($sixth, $daily, self::date('2027-01-06'))?->format('Y-m-d'));

        // La plus tôt parmi les autres, après aujourd'hui.
        self::assertSame([$thursday, '2026-10-08'], self::named(RecurrenceClash::earliest($daily, [$today, $sixth, $thursday], self::date('2026-10-06'))));
        self::assertSame([$sixth, '2026-11-06'], self::named(RecurrenceClash::earliest($daily, [$today, $sixth, $thursday], self::date('2026-10-08'))));
        self::assertNull(RecurrenceClash::earliest($daily, [$today, $thursday], self::date('2026-10-08')));
    }

    public function testUneRecurrenceRetireeNeCroiseRien(): void
    {
        $first = self::date('2026-10-06');
        $daily = new Recurrence(SlotContent::work('OPS-12', 'Daily'), 555, 570, Rhythm::weekly([1, 2, 3, 4, 5]), $first, null, $first);
        $support = new Recurrence(SlotContent::work('OPS-7', null), 555, 570, Rhythm::monthlyDate(16), self::date('2026-10-16'), null, self::date('2026-10-16'));
        self::assertSame('2026-10-16', RecurrenceClash::first($daily, $support)?->format('Y-m-d'));

        $daily->endOn($daily->withdrawnUntil());

        self::assertNull(RecurrenceClash::first($daily, $support));
        self::assertNull(RecurrenceClash::first($support, $daily));
    }

    /**
     * Un rythme mensuel se choisit parmi ceux que le jour du bloc permet : son rang du 1er au
     * 4e, « le dernier » s'il l'est, ou sa date. Un rythme à la semaine, toujours.
     */
    public function testUnRythmeMensuelEstCeluiDuJourDuBloc(): void
    {
        $days = [
            // Le 3e vendredi d'octobre 2026, pas le dernier.
            '2026-10-16' => [Rhythm::monthlyWeekday(5, 3), Rhythm::monthlyDate(16)],
            // Le 4e, pas le dernier : il y en a cinq.
            '2026-10-23' => [Rhythm::monthlyWeekday(5, 4), Rhythm::monthlyDate(23)],
            // Le 5e : seulement le dernier.
            '2026-10-30' => [Rhythm::monthlyWeekday(5, Rhythm::LAST), Rhythm::monthlyDate(30)],
            // Le 4e et le dernier d'un mois de quatre vendredis.
            '2026-11-27' => [Rhythm::monthlyWeekday(5, 4), Rhythm::monthlyWeekday(5, Rhythm::LAST), Rhythm::monthlyDate(27)],
            // Le 1er jour du mois, un lundi.
            '2027-02-01' => [Rhythm::monthlyWeekday(1, 1), Rhythm::monthlyDate(1)],
            // Le 29 février d'une année bissextile, dernier mardi.
            '2028-02-29' => [Rhythm::monthlyWeekday(2, Rhythm::LAST), Rhythm::monthlyDate(29)],
            // Un 31, dimanche : un jour non travaillé a ses rythmes aussi, les réglages jugent ailleurs.
            '2027-01-31' => [Rhythm::monthlyWeekday(7, Rhythm::LAST), Rhythm::monthlyDate(31)],
        ];
        $candidates = [Rhythm::monthlyDate(1), Rhythm::monthlyDate(16), Rhythm::monthlyDate(23), Rhythm::monthlyDate(27), Rhythm::monthlyDate(29), Rhythm::monthlyDate(30), Rhythm::monthlyDate(31)];
        foreach (range(1, 7) as $weekday) {
            foreach ([1, 2, 3, 4, Rhythm::LAST] as $week) {
                $candidates[] = Rhythm::monthlyWeekday($weekday, $week);
            }
        }

        foreach ($days as $value => $permitted) {
            $date = self::date($value);
            foreach ($candidates as $rhythm) {
                $expected = [] !== array_filter($permitted, static fn (Rhythm $one): bool => $one->equals($rhythm));
                self::assertSame($expected, $rhythm->permittedBy($date), \sprintf('%s : %s', $value, json_encode([$rhythm->weekdays, $rhythm->monthWeek, $rhythm->monthDay], \JSON_THROW_ON_ERROR)));
                // Permis, il tombe ce jour-là.
                self::assertSame($expected, $expected && $rhythm->fallsOn($date, $date));
            }
            self::assertTrue(Rhythm::weekly([1])->permittedBy($date), 'Créée un autre jour que les siens, une semaine n\'en a simplement pas de fois.');
            self::assertTrue(Rhythm::weekly([3], 4)->permittedBy($date));
        }
    }

    public function testLeJourDUnRythmeMensuelDansChaqueMois(): void
    {
        $cases = [
            'le 31 d\'un mois de 30' => [Rhythm::monthlyDate(31), 2026, 11, null],
            'le 31 d\'un mois de 31' => [Rhythm::monthlyDate(31), 2026, 10, '2026-10-31'],
            'le 30 février' => [Rhythm::monthlyDate(30), 2028, 2, null],
            'le 29 février d\'une année bissextile' => [Rhythm::monthlyDate(29), 2028, 2, '2028-02-29'],
            'le 29 février d\'une année qui ne l\'est pas' => [Rhythm::monthlyDate(29), 2027, 2, null],
            'le 29 février d\'une année séculaire qui ne l\'est pas' => [Rhythm::monthlyDate(29), 2100, 2, null],
            'le 29 février d\'une année séculaire qui l\'est' => [Rhythm::monthlyDate(29), 2000, 2, '2000-02-29'],
            'le dernier vendredi d\'un mois de cinq vendredis' => [Rhythm::monthlyWeekday(5, Rhythm::LAST), 2027, 1, '2027-01-29'],
            'le dernier vendredi d\'un mois de quatre' => [Rhythm::monthlyWeekday(5, Rhythm::LAST), 2026, 11, '2026-11-27'],
            'le dernier vendredi, le dernier jour du mois' => [Rhythm::monthlyWeekday(5, Rhythm::LAST), 2026, 7, '2026-07-31'],
            'le 4e jeudi en décembre' => [Rhythm::monthlyWeekday(4, 4), 2026, 12, '2026-12-24'],
            'le 4e jeudi d\'un mois qui commence un jeudi' => [Rhythm::monthlyWeekday(4, 4), 2027, 4, '2027-04-22'],
            'le 1er lundi, le premier jour du mois' => [Rhythm::monthlyWeekday(1, 1), 2027, 2, '2027-02-01'],
            'le 1er lundi, le lendemain d\'un premier dimanche' => [Rhythm::monthlyWeekday(1, 1), 2026, 11, '2026-11-02'],
            'le 3e vendredi' => [Rhythm::monthlyWeekday(5, 3), 2026, 10, '2026-10-16'],
            'une semaine n\'a pas de jour du mois' => [Rhythm::weekly([5]), 2026, 10, null],
        ];
        foreach ($cases as $case => [$rhythm, $year, $month, $expected]) {
            self::assertSame($expected, $rhythm->dayIn($year, $month)?->format('Y-m-d'), $case);
        }
    }

    /**
     * Le jour que la recherche des conflits prend dans un mois est exactement celui où le
     * rythme tombe : chaque rythme mensuel, chaque mois de cinq ans, bissextiles compris.
     */
    public function testLeJourDuMoisEstLeSeulOuLeRythmeTombe(): void
    {
        $rhythms = array_map(static fn (int $day): Rhythm => Rhythm::monthlyDate($day), range(1, 31));
        foreach (range(1, 7) as $weekday) {
            foreach ([1, 2, 3, 4, Rhythm::LAST] as $week) {
                $rhythms[] = Rhythm::monthlyWeekday($weekday, $week);
            }
        }
        $origin = self::date('2020-01-01');

        for ($month = self::date('2026-01-01'); $month < self::date('2031-01-01'); $month = $month->modify('first day of next month')) {
            $days = [];
            for ($date = $month; $date->format('m') === $month->format('m'); $date = $date->modify('+1 day')) {
                $days[] = $date;
            }
            foreach ($rhythms as $rhythm) {
                $falls = array_values(array_map(static fn (\DateTimeImmutable $date): string => $date->format('Y-m-d'), array_filter($days, static fn (\DateTimeImmutable $date): bool => $rhythm->fallsOn($date, $origin))));
                $day = $rhythm->dayIn((int) $month->format('Y'), (int) $month->format('n'));
                self::assertSame($falls, null === $day ? [] : [$day->format('Y-m-d')], $month->format('Y-m').' '.json_encode([$rhythm->weekdays, $rhythm->monthWeek, $rhythm->monthDay], \JSON_THROW_ON_ERROR));
            }
        }
    }

    public function testLesJoursDUneSemaineSeRangentUneFoisChacun(): void
    {
        $rhythm = Rhythm::weekly([5, 1, 3, 1]);

        self::assertSame([1, 3, 5], $rhythm->weekdays);
        self::assertTrue($rhythm->equals(Rhythm::weekly([1, 3, 5])));
        self::assertFalse($rhythm->equals(Rhythm::weekly([1, 3, 5], 2)));
        self::assertFalse($rhythm->equals(Rhythm::weekly([1, 3])));
    }

    public function testUnRythmeImpossibleSeRefuse(): void
    {
        $impossible = [
            'aucun jour' => static fn (): Rhythm => Rhythm::weekly([]),
            'un jour 0' => static fn (): Rhythm => Rhythm::weekly([0]),
            'un jour 8' => static fn (): Rhythm => Rhythm::weekly([1, 8]),
            'chaque 0 semaine' => static fn (): Rhythm => Rhythm::weekly([1], 0),
            'une semaine sur 5' => static fn (): Rhythm => Rhythm::weekly([1], 5),
            'le 5e vendredi' => static fn (): Rhythm => Rhythm::monthlyWeekday(5, 5),
            'le 0e vendredi' => static fn (): Rhythm => Rhythm::monthlyWeekday(5, 0),
            'le 1er jour 8' => static fn (): Rhythm => Rhythm::monthlyWeekday(8, 1),
            'le 0 du mois' => static fn (): Rhythm => Rhythm::monthlyDate(0),
            'le 32 du mois' => static fn (): Rhythm => Rhythm::monthlyDate(32),
        ];
        foreach ($impossible as $case => $rhythm) {
            try {
                $rhythm();
                self::fail($case.' a été accepté.');
            } catch (\InvalidArgumentException) {
                self::addToAssertionCount(1);
            }
        }
    }

    public function testUneRecurrenceCouvreDesQuartsDHeureDeLaGrille(): void
    {
        $daily = SlotContent::work('OPS-12', 'Daily');
        $first = self::date('2026-10-06');

        $edges = new Recurrence($daily, Quarter::FIRST, Quarter::DAY_END, Rhythm::weekly([1]), $first, null, $first);
        self::assertCount(52, $edges->quarters(), 'De 07:00 à 20:00, toute la grille.');

        foreach ([[405, 420], [420, 1215], [425, 450], [555, 560], [555, 555], [570, 555]] as [$start, $end]) {
            try {
                new Recurrence($daily, $start, $end, Rhythm::weekly([1]), $first, null, $first);
                self::fail(Quarter::format($start).'–'.Quarter::format($end).' a été accepté.');
            } catch (\InvalidArgumentException) {
                self::addToAssertionCount(1);
            }
        }
    }

    public function testUneRecurrenceRetireeNeTombePlusJamais(): void
    {
        $first = self::date('2026-10-06');
        $recurrence = new Recurrence(SlotContent::pause(), 750, 810, Rhythm::weekly([1, 2, 3, 4, 5, 6, 7]), $first, null, $first);
        self::assertTrue($recurrence->fallsOn($first));

        $recurrence->endOn($recurrence->withdrawnUntil());

        self::assertSame('2026-10-05', $recurrence->until?->format('Y-m-d'));
        for ($date = $first->modify('-7 days'); $date < $first->modify('+30 days'); $date = $date->modify('+1 day')) {
            self::assertFalse($recurrence->fallsOn($date), $date->format('Y-m-d'));
        }

        // Rétablir lui rend sa fin.
        $recurrence->endOn(null);
        self::assertTrue($recurrence->fallsOn($first->modify('+7 days')));
        self::assertFalse($recurrence->fallsOn($first->modify('-1 day')), 'Rien avant son premier jour.');
    }

    public function testUneFinNeRemontePasAvantLaVeilleDuPremierJour(): void
    {
        $first = self::date('2026-10-06');
        $recurrence = new Recurrence(SlotContent::pause(), 750, 810, Rhythm::weekly([2]), $first, null, $first);

        $this->expectException(\InvalidArgumentException::class);
        $recurrence->endOn(self::date('2026-10-04'));
    }

    public function testLeDernierJourTraiteNeReculeJamais(): void
    {
        $first = self::date('2026-10-06');
        $recurrence = new Recurrence(SlotContent::pause(), 750, 810, Rhythm::weekly([2]), $first, null, self::date('2026-10-08'));

        $recurrence->posedUntil(self::date('2026-10-07'));
        self::assertSame('2026-10-08', $recurrence->posedThrough->format('Y-m-d'));

        $recurrence->posedUntil(self::date('2026-10-09'));
        self::assertSame('2026-10-09', $recurrence->posedThrough->format('Y-m-d'));
    }

    /**
     * Des paires tirées au hasard — chaque genre de rythme, une semaine sur 1 à 4, les rangs, le
     * dernier, les dates du 1er au 31, des premiers jours et des fins variés, des fins d'année,
     * des années bissextiles, des heures qui se touchent ou se croisent d'un quart d'heure — et
     * la recherche comparée, dans les deux sens, à une force brute qui parcourt chaque jour sur
     * la même borne : trois ans entre deux rythmes à la semaine, où la recherche est exacte ;
     * 28 ans dès qu'un rythme est mensuel. La force brute ne doit rien au code de l'application.
     */
    public function testLaRechercheDesConflitsEgaleUnParcoursJourParJour(): void
    {
        $random = $this->randomizer();
        $calendar = self::calendar();
        $pairs = getenv('RANDOM_PAIRS');
        $count = false !== $pairs && '' !== $pairs ? (int) $pairs : self::PAIRS;
        $clashes = 0;
        for ($pair = 0; $pair < $count; ++$pair) {
            $a = self::randomSpec($random, null);
            $b = self::randomSpec($random, $a);
            // Un jour sur deux, la recherche part du lendemain d'aujourd'hui, quelque part autour d'elles.
            $after = 0 === $random->getInt(0, 1) ? null : self::date($a['firstDay'])->modify(\sprintf('%+d days', $random->getInt(-60, 400)));
            $expected = self::bruteClash($a, $b, $calendar, $after?->format('Y-m-d'));
            $message = json_encode(['a' => $a, 'b' => $b, 'after' => $after?->format('Y-m-d')], \JSON_THROW_ON_ERROR);

            self::assertSame($expected, RecurrenceClash::first(self::fromSpec($a), self::fromSpec($b), $after)?->format('Y-m-d'), 'a, puis b : '.$message);
            self::assertSame($expected, RecurrenceClash::first(self::fromSpec($b), self::fromSpec($a), $after)?->format('Y-m-d'), 'b, puis a : '.$message);
            $clashes += null === $expected ? 0 : 1;
        }

        // Le tirage trouve des conflits, et des paires qui n'en ont pas.
        self::assertGreaterThan($count / 10, $clashes);
        self::assertLessThan($count * 9 / 10, $clashes);
    }

    /**
     * Une récurrence tirée au hasard, souvent proche de $near : mêmes jours, premiers jours
     * voisins, heures qui se touchent ou se croisent.
     *
     * @param ?Spec $near
     *
     * @return Spec
     */
    private static function randomSpec(Randomizer $random, ?array $near): array
    {
        $roll = $random->getInt(0, 3);
        $nearWeekday = null === $near ? null : ($near['weekdays'][0] ?? null);
        $weekday = null !== $nearWeekday && 0 !== $random->getInt(0, 2) ? $nearWeekday : $random->getInt(1, 7);
        if ($roll <= 1) {
            $weekdays = null !== $near && [] !== $near['weekdays'] && 0 === $random->getInt(0, 2)
                ? $near['weekdays']
                : array_values(array_unique([$weekday, ...array_filter(range(1, 7), static fn (): bool => 0 === $random->getInt(0, 4))]));
            sort($weekdays);
            $rhythm = ['kind' => 'weekly', 'weekdays' => $weekdays, 'everyWeeks' => $random->getInt(1, 4), 'monthWeek' => null, 'monthDay' => null];
        } elseif (2 === $roll) {
            $rhythm = ['kind' => 'monthly_weekday', 'weekdays' => [$weekday], 'everyWeeks' => 1, 'monthWeek' => 0 === $random->getInt(0, 4) ? Rhythm::LAST : $random->getInt(1, 4), 'monthDay' => null];
        } else {
            $rhythm = ['kind' => 'monthly_date', 'weekdays' => [], 'everyWeeks' => 1, 'monthWeek' => null, 'monthDay' => 0 === $random->getInt(0, 2) ? $random->getInt(28, 31) : $random->getInt(1, 31)];
        }

        $first = match (null === $near ? $random->getInt(0, 3) : $random->getInt(0, 5)) {
            // Une fin d'année.
            0 => self::date(\sprintf('%d-12-%02d', $random->getInt(2026, 2030), $random->getInt(15, 31)))->modify(\sprintf('+%d days', $random->getInt(0, 20))),
            // Autour du 29 février 2028.
            1 => self::date('2028-02-29')->modify(\sprintf('%+d days', $random->getInt(-40, 40))),
            // Près de l'autre.
            2, 3, 4 => null === $near ? self::date('2026-10-06') : self::date($near['firstDay'])->modify(\sprintf('%+d days', $random->getInt(-90, 90))),
            default => self::date('2026-01-01')->modify(\sprintf('+%d days', $random->getInt(0, 5 * 365))),
        };
        $until = match ($random->getInt(0, 5)) {
            0, 1, 2 => null,
            // Retirée : la veille de son premier jour.
            3 => $first->modify('-1 day'),
            4 => $first->modify(\sprintf('+%d days', $random->getInt(0, 120))),
            default => $first->modify(\sprintf('+%d days', $random->getInt(0, 3 * 365))),
        };

        if (null === $near) {
            $start = Quarter::FIRST + Quarter::MINUTES * $random->getInt(0, 8);
            $end = $start + Quarter::MINUTES * $random->getInt(1, 4);
        } else {
            [$start, $end] = match ($random->getInt(0, 4)) {
                // Juste après, ou juste avant : elles se touchent.
                0 => [$near['end'], $near['end'] + Quarter::MINUTES * $random->getInt(1, 3)],
                1 => [max(Quarter::FIRST, $near['start'] - Quarter::MINUTES * $random->getInt(1, 3)), $near['start']],
                // Un seul quart d'heure en commun, à un bord.
                2 => [$near['end'] - Quarter::MINUTES, $near['end'] + Quarter::MINUTES * $random->getInt(0, 2)],
                3 => [$near['start'], $near['end']],
                default => [$s = Quarter::FIRST + Quarter::MINUTES * $random->getInt(0, 8), $s + Quarter::MINUTES * $random->getInt(1, 4)],
            };
            if ($start >= $end) {
                $end = $start + Quarter::MINUTES;
            }
        }

        return $rhythm + ['firstDay' => $first->format('Y-m-d'), 'until' => $until?->format('Y-m-d'), 'start' => $start, 'end' => $end];
    }

    /**
     * @param Spec $spec
     */
    private static function fromSpec(array $spec): Recurrence
    {
        $first = self::date($spec['firstDay']);

        return new Recurrence(SlotContent::work('OPS-12', 'Daily'), $spec['start'], $spec['end'], self::rhythmOf($spec), $first, null === $spec['until'] ? null : self::date($spec['until']), $first);
    }

    /**
     * La première date commune, jour après jour, sur la borne de la recherche, après $after.
     *
     * @param Spec                                                                                  $a
     * @param Spec                                                                                  $b
     * @param array{index: array<string, int>, days: list<array{string, int, int, int, int, bool}>} $calendar
     * @param ?string                                                                               $after    aujourd'hui : la recherche part du lendemain
     */
    private static function bruteClash(array $a, array $b, array $calendar, ?string $after = null): ?string
    {
        if ($a['start'] >= $b['end'] || $b['start'] >= $a['end']) {
            return null;
        }
        $index = $calendar['index'];
        $fromDate = max($a['firstDay'], $b['firstDay'], ...(null === $after ? [] : [self::date($after)->modify('+1 day')->format('Y-m-d')]));
        $from = $index[$fromDate];
        $monthly = 'weekly' !== $a['kind'] || 'weekly' !== $b['kind'];
        $limit = $index[self::date($fromDate)->modify($monthly ? '+28 years' : '+3 years')->format('Y-m-d')];
        $to = $limit;
        foreach ([$a['until'], $b['until']] as $until) {
            if (null !== $until) {
                $to = min($to, $index[$until] ?? -1);
            }
        }
        for ($day = $from; $day <= $to; ++$day) {
            if (self::bruteFalls($a, $day, $calendar) && self::bruteFalls($b, $day, $calendar)) {
                return $calendar['days'][$day][0];
            }
        }

        return null;
    }

    /**
     * @param Spec                                                                                  $spec
     * @param array{index: array<string, int>, days: list<array{string, int, int, int, int, bool}>} $calendar
     */
    private static function bruteFalls(array $spec, int $day, array $calendar): bool
    {
        [, $weekday, $week, $monthDay, $rank, $last] = $calendar['days'][$day];

        return match ($spec['kind']) {
            'weekly' => \in_array($weekday, $spec['weekdays'], true) && 0 === ($week - $calendar['days'][$calendar['index'][$spec['firstDay']]][2]) % $spec['everyWeeks'],
            'monthly_weekday' => [$weekday] === $spec['weekdays'] && (Rhythm::LAST === $spec['monthWeek'] ? $last : $rank === $spec['monthWeek']),
            default => $monthDay === $spec['monthDay'],
        };
    }

    /**
     * Chaque jour de 2024 à 2062, compté depuis le lundi 1er janvier 2024 : sa date, son jour
     * de la semaine, sa semaine, son jour du mois, son rang dans le mois, et s'il est le
     * dernier de ce jour de la semaine dans son mois.
     *
     * @return array{index: array<string, int>, days: list<array{string, int, int, int, int, bool}>}
     */
    private static function calendar(): array
    {
        $days = [];
        $index = [];
        $date = self::date('2024-01-01');
        for ($day = 0; $date->format('Y') < '2063'; ++$day, $date = $date->modify('+1 day')) {
            $monthDay = (int) $date->format('j');
            $days[] = [$date->format('Y-m-d'), $day % 7 + 1, intdiv($day, 7), $monthDay, intdiv($monthDay - 1, 7) + 1, $monthDay + 7 > (int) $date->format('t')];
            $index[$date->format('Y-m-d')] = $day;
        }
        self::assertSame(1, (int) self::date('2024-01-01')->format('N'), 'Le calendrier part d\'un lundi.');

        return ['index' => $index, 'days' => $days];
    }

    /**
     * Une récurrence des cas partagés, sur son créneau.
     *
     * @param array<mixed> $side
     */
    private static function clashing(array $side): Recurrence
    {
        $first = self::date(self::stringAt($side, 'firstDay'));
        $until = self::at($side, 'until');
        self::assertTrue(null === $until || \is_string($until));

        return new Recurrence(
            SlotContent::work('OPS-12', 'Daily'),
            Quarter::parse(self::stringAt($side, 'start')) ?? throw new \LogicException('Heure de début illisible.'),
            Quarter::parse(self::stringAt($side, 'end')) ?? throw new \LogicException('Heure de fin illisible.'),
            self::rhythmOf(self::arrayAt($side, 'rhythm')),
            $first,
            null === $until ? null : self::date($until),
            $first,
        );
    }

    /**
     * Les fois sautées des deux côtés d'un conflit partagé, par l'identifiant de chacune.
     *
     * @param array<mixed> $case
     *
     * @return array<string, list<string>>
     */
    private static function skippedOf(array $case, Recurrence $a, Recurrence $b): array
    {
        $skipped = [];
        foreach (['a' => $a, 'b' => $b] as $side => $recurrence) {
            $dates = self::arrayAt($case, $side)['skipped'] ?? [];
            self::assertIsArray($dates);
            $skipped[$recurrence->id->toRfc4122()] = array_values(array_map(static fn (mixed $date): string => \is_string($date) ? $date : throw new \LogicException('Une fois sautée illisible.'), $dates));
        }

        return $skipped;
    }

    /**
     * Les jours envoyés d'un conflit partagé, qui ne comptent pour aucune.
     *
     * @param array<mixed> $case
     *
     * @return list<string>
     */
    private static function closedOf(array $case): array
    {
        $dates = $case['closed'] ?? [];
        self::assertIsArray($dates);

        return array_values(array_map(static fn (mixed $date): string => \is_string($date) ? $date : throw new \LogicException('Un jour envoyé illisible.'), $dates));
    }

    /**
     * @param ?array{Recurrence, \DateTimeImmutable} $clash
     *
     * @return ?array{Recurrence, string}
     */
    private static function named(?array $clash): ?array
    {
        return null === $clash ? null : [$clash[0], $clash[1]->format('Y-m-d')];
    }

    /**
     * @param array<mixed> $rhythm
     */
    private static function rhythmOf(array $rhythm): Rhythm
    {
        /** @var list<int> $weekdays */
        $weekdays = self::arrayAt($rhythm, 'weekdays');

        return match (RhythmKind::from(self::stringAt($rhythm, 'kind'))) {
            RhythmKind::Weekly => Rhythm::weekly($weekdays, self::intAt($rhythm, 'everyWeeks')),
            RhythmKind::MonthlyWeekday => Rhythm::monthlyWeekday($weekdays[0] ?? 0, self::intAt($rhythm, 'monthWeek')),
            RhythmKind::MonthlyDate => Rhythm::monthlyDate(self::intAt($rhythm, 'monthDay')),
        };
    }

    private static function date(string $date): \DateTimeImmutable
    {
        return UserCalendar::date($date) ?? throw new \LogicException($date.' n\'est pas une date.');
    }
}
