<?php

namespace App\Tests\Api;

use App\Database\LockedTransaction;
use App\Day\DayWriter;
use App\Day\Quarter;
use App\Day\SlotContent;
use App\Day\UserCalendar;
use App\Recurrence\RecurrenceClash;
use App\Recurrence\RecurrenceForecast;
use App\Recurrence\RecurrencePoser;
use App\Recurrence\RecurrenceRefused;
use App\Recurrence\RecurrenceSpec;
use App\Recurrence\Rhythm;
use App\Repository\DayRepository;
use App\Repository\DaySendRepository;
use App\Repository\RecurrenceRepository;
use App\Sending\SendClosure;
use App\Settings\UserSettings;
use App\Tests\Support\DayApi;
use App\Tests\Support\RecurrenceApi;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\Decorator\EntityManagerDecorator;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Jamais deux récurrences sur un même créneau : celle qu'on crée, qu'on coupe « cette fois
 * et les suivantes », dont on repousse la fin, ou qu'annuler et rétablir feraient revenir, se
 * refuse si une autre y revient un même jour — sans rien écrire. Une saisie ordinaire n'est
 * pas un conflit, et une semaine sur deux décalée d'une semaine alterne avec l'autre. Par
 * l'API, comme les envoie la page, et depuis un onglet resté ouvert ou un autre worker.
 *
 * L'heure est figée au mardi 6 octobre 2026, 15:20 à Paris. La rétrospective revient un
 * jeudi sur deux à partir du 8 octobre ; la démo, les autres jeudis, ou chaque jeudi.
 */
final class RecurrenceConflictTest extends WebTestCase
{
    use DayApi;
    use RecurrenceApi;

    private const string WEDNESDAY = '2026-10-07';

    private const string THURSDAY = '2026-10-08';

    private const string NEXT_THURSDAY = '2026-10-15';

    private const string MONDAY = '2026-10-12';

    public function testUneRecurrenceSurLeCreneauDUneAutreSeRefuseSansRienEcrire(): void
    {
        [$retro] = $this->repeatWith(0, self::retro(), self::everyWeeks(2, [4]), self::THURSDAY);
        $before = $this->written();
        $version = self::intAt($this->day(self::NEXT_THURSDAY), 'version');
        self::assertSame(0, $version, 'La rétrospective ne tombe pas le 15.');

        // Chaque jeudi : elle tomberait sur la rétrospective le 22.
        [$status, $body] = $this->putRecurrence($version, [self::demo()], self::weekly([4]), date: self::NEXT_THURSDAY);

        self::assertSame(422, $status, json_encode($body, \JSON_THROW_ON_ERROR));
        self::assertSame(self::taken('Rétrospective'), $body['violations']);
        self::assertSame($before, $this->written(), 'Ni récurrence, ni bloc, ni version.');
        self::assertSame([], self::listAt($this->day(self::NEXT_THURSDAY), 'blocks'));
        self::assertSame(0, self::intAt($this->day(self::NEXT_THURSDAY), 'version'));
        self::assertSame(['14:00-15:00 OPS-7 « Rétrospective » ↻rétro'], self::arrows($this->day('2026-10-22'), [$retro => 'rétro']));

        // Depuis aujourd'hui, un jeudi créé d'un mardi : le même refus, même si le bloc du
        // mardi n'en est pas une fois.
        [$status, $body] = $this->putRecurrence(0, [self::demo()], self::weekly([2, 4]));
        self::assertSame(422, $status);
        self::assertSame(self::taken('Rétrospective'), $body['violations']);
        self::assertSame($before, $this->written());
    }

    public function testLeRefusNommeLaRecurrenceParSonCommentaireSonTicketOuLaPause(): void
    {
        $this->repeatWith(0, self::work('09:00', '09:30', 'OPS-12'), self::weekly([1, 2]));
        $this->repeatWith(1, self::pause('12:30', '13:30'), self::weekly([1, 2, 3, 4, 5]));

        [$status, $body] = $this->putRecurrence(2, [self::work('09:15', '09:45', 'SHOP-482', 'Tests')], self::weekly([1]));
        self::assertSame(422, $status);
        self::assertSame(self::taken('OPS-12'), $body['violations'], 'Sans commentaire, son ticket.');

        [$status, $body] = $this->putRecurrence(2, [self::work('13:15', '13:45', 'SHOP-482')], self::monthlyDate(6));
        self::assertSame(422, $status);
        self::assertSame([['field' => 'recurrence.rhythm', 'message' => 'Ce créneau est déjà pris par la pause.']], $body['violations']);

        self::assertSame(2, $this->recurrenceRows());
    }

    public function testUneSemaineSurDeuxDecaleeDUneSemaineAlterneAvecLAutre(): void
    {
        [$retro] = $this->repeatWith(0, self::retro(), self::everyWeeks(2, [4]), self::THURSDAY);

        [$demo, $day] = $this->repeatWith(0, self::demo(), self::everyWeeks(2, [4]), self::NEXT_THURSDAY);

        $names = [$retro => 'rétro', $demo => 'démo'];
        self::assertSame(['14:00-15:00 OPS-12 « Démo » ↻démo'], self::arrows($day, $names));
        foreach (['2026-10-22' => 'rétro', '2026-10-29' => 'démo', '2026-11-05' => 'rétro'] as $date => $name) {
            self::assertSame([$name], array_map(static fn (string $arrow): string => explode('↻', $arrow)[1], self::arrows($this->day($date), $names)), $date);
        }
        self::assertSame(2, $this->recurrenceRows());
    }

    public function testChangerAvecLesSuivantesVersUnCreneauPrisSeRefuse(): void
    {
        [$retro] = $this->repeatWith(0, self::retro(), self::everyWeeks(2, [4]), self::THURSDAY);
        [$demo] = $this->repeatWith(0, self::demo(), self::everyWeeks(2, [4]), self::NEXT_THURSDAY);
        $thursday = $this->day('2026-10-29');
        $before = $this->written();

        // La démo, à partir du 29 : chaque jeudi, elle tomberait sur la rétrospective le 5.
        [$status, $body] = $this->putRecurrence(self::intAt($thursday, 'version'), [self::demo()], self::weekly([4]), $demo, '2026-10-29');
        self::assertSame(422, $status, json_encode($body, \JSON_THROW_ON_ERROR));
        self::assertSame(self::taken('Rétrospective'), $body['violations']);
        // Ou une semaine sur trois : le 19 novembre.
        [$status, $body] = $this->putRecurrence(self::intAt($thursday, 'version'), [self::demo()], self::everyWeeks(3, [4]), $demo, '2026-10-29');
        self::assertSame(422, $status);
        self::assertSame(self::taken('Rétrospective'), $body['violations']);
        self::assertSame($before, $this->written(), 'La démo n\'est pas coupée.');
        self::assertNull($this->recurrenceRow($demo)['until']);

        // Son commentaire seul, avec les suivantes : coupée, elle garde son alternance.
        $day = $this->saveRecurrence(self::intAt($thursday, 'version'), [self::work('14:00', '15:00', 'OPS-12', 'Démo de sprint')], self::everyWeeks(2, [4]), $demo, '2026-10-29');
        $new = self::stringAt($day, 'untils', 1, 'recurrence');
        self::assertSame('2026-10-28', $this->recurrenceRow($demo)['until']);
        self::assertSame(['14:00-15:00 OPS-12 « Démo de sprint » ↻sprint'], self::arrows($day, [$new => 'sprint']));
        self::assertSame(['14:00-15:00 OPS-7 « Rétrospective » ↻rétro'], self::arrows($this->day('2026-11-05'), [$retro => 'rétro']));

        // Rien n'y croise rien.
        $this->assertNoClash();
    }

    public function testUneSaisieOrdinaireNEstPasUnConflit(): void
    {
        $this->write(0, [self::work('14:00', '15:00', 'SHOP-482')], self::NEXT_THURSDAY);
        $this->write(0, [self::work('14:30', '14:45', 'SHOP-482', 'Tests')], '2026-10-22');

        [$demo, $day] = $this->repeatWith(0, self::demo(), self::weekly([4]), self::THURSDAY);

        $names = [$demo => 'démo'];
        self::assertSame(['14:00-15:00 OPS-12 « Démo » ↻démo'], self::arrows($day, $names));
        self::assertSame(['14:00-15:00 SHOP-482'], self::arrows($this->day(self::NEXT_THURSDAY)), 'La saisie garde son créneau.');
        self::assertSame(['14:00-14:30 OPS-12 « Démo » ↻démo', '14:30-14:45 SHOP-482 « Tests »', '14:45-15:00 OPS-12 « Démo » ↻démo'], self::arrows($this->day('2026-10-22'), $names), 'La récurrence se pose autour.');
    }

    public function testRepousserLaFinEnPlaceJusquAuPremierJourDUneAutreSeRefuse(): void
    {
        [$daily] = $this->repeatWith(0, self::daily(), self::weekly(until: '2026-10-09'));
        // La suite, sur le même créneau, à partir du lundi.
        [$support] = $this->repeatWith(0, self::work('09:15', '09:30', 'OPS-7', 'Support'), self::weekly(), self::MONDAY);
        $before = $this->written();

        [$status, $body] = $this->putRecurrence(1, [self::daily()], self::weekly(until: self::MONDAY), $daily);
        self::assertSame(422, $status, json_encode($body, \JSON_THROW_ON_ERROR));
        self::assertSame(self::taken('Support'), $body['violations']);
        [$status, $body] = $this->putRecurrence(1, [self::daily()], self::weekly(), $daily);
        self::assertSame(422, $status, 'Sans fin : pas davantage.');
        self::assertSame(self::taken('Support'), $body['violations']);
        self::assertSame($before, $this->written());

        // Jusqu'au dimanche, la veille : rien ne tombe sur la suite.
        $day = $this->saveRecurrence(1, [self::daily()], self::weekly(until: '2026-10-11'), $daily);
        self::assertSame([['recurrence' => $daily, 'before' => '2026-10-09', 'after' => '2026-10-11']], $day['untils']);
        // Avancée : toujours permis.
        $day = $this->saveRecurrence(2, [self::daily()], self::weekly(until: self::THURSDAY), $daily);
        self::assertSame([['recurrence' => $daily, 'before' => '2026-10-11', 'after' => self::THURSDAY]], $day['untils']);
        self::assertNull($this->recurrenceRow($support)['until']);
        $this->assertNoClash();
    }

    public function testDepuisUnJourPasseUnRythmeQuiCroiseUneAutreSeRefuse(): void
    {
        [$daily] = $this->repeatWith(0, self::daily(), self::weekly([1, 2]));
        [$wednesday] = $this->repeatWith(0, self::work('09:15', '09:30', 'OPS-7', 'Mercredi'), self::weekly([3]), self::WEDNESDAY);
        self::mockTime('2026-10-13 08:00:00 Europe/Paris');
        // Le lundi 12, déjà venu : la fenêtre de son Daily.
        $monday = $this->day(self::MONDAY);
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($monday, [$daily => 'daily']));
        $before = $this->written();

        // À partir de demain, du lundi au mercredi : le mercredi est pris.
        [$status, $body] = $this->putRecurrence(self::intAt($monday, 'version'), [self::daily()], self::weekly([1, 2, 3]), $daily, self::MONDAY);
        self::assertSame(422, $status, json_encode($body, \JSON_THROW_ON_ERROR));
        self::assertSame(self::taken('Mercredi'), $body['violations']);
        self::assertSame($before, $this->written());

        // Le lundi, le mardi et le jeudi : rien de pris.
        $day = $this->saveRecurrence(self::intAt($monday, 'version'), [self::daily()], self::weekly([1, 2, 4]), $daily, self::MONDAY);
        self::assertSame('2026-10-13', $this->recurrenceRow($daily)['until']);
        self::assertSame(['firstDay' => '2026-10-14', 'until' => null, 'posedThrough' => '2026-10-13'], $this->recurrenceRow(self::stringAt($day, 'untils', 1, 'recurrence')));
        self::assertNull($this->recurrenceRow($wednesday)['until']);
        $this->assertNoClash();
    }

    public function testUnRythmeMensuelCroiseCeluiDeLaSemaine(): void
    {
        // Chaque vendredi, puis le 3e vendredi du mois : pris dès le 16.
        [$fridays] = $this->repeatWith(0, self::retro(), self::weekly([5]), '2026-10-09');
        $third = $this->day('2026-10-16');
        [$status, $body] = $this->putRecurrence(self::intAt($third, 'version'), [self::demo()], self::monthlyWeekday(5, 3), date: '2026-10-16');
        self::assertSame(422, $status, json_encode($body, \JSON_THROW_ON_ERROR));
        self::assertSame(self::taken('Rétrospective'), $body['violations']);
        // Le dernier vendredi, le 30 : pris aussi.
        [$status, $body] = $this->putRecurrence(self::intAt($this->day('2026-10-30'), 'version'), [self::demo()], self::monthlyWeekday(5, Rhythm::LAST), date: '2026-10-30');
        self::assertSame(422, $status);
        self::assertSame(self::taken('Rétrospective'), $body['violations']);
        self::assertSame(1, $this->recurrenceRows());

        // Dans l'autre sens : le 3e vendredi d'abord, chaque vendredi ensuite.
        $this->saveRecurrence(self::intAt($this->day('2026-10-09'), 'version'), [self::retro()], null, $fridays, '2026-10-09');
        [$monthly] = $this->repeatWith(self::intAt($this->day('2026-10-16'), 'version'), self::demo(), self::monthlyWeekday(5, 3), '2026-10-16');
        [$status, $body] = $this->putRecurrence(self::intAt($this->day('2026-10-23'), 'version'), [self::retro()], self::weekly([5]), date: '2026-10-23');
        self::assertSame(422, $status);
        self::assertSame(self::taken('Démo'), $body['violations'], 'Le 20 novembre, le 3e vendredi.');

        // Le 16 de chaque mois, et un vendredi sur deux : le 16 juillet 2027 tombe un vendredi
        // de la semaine. Jusqu'au 30 juin, jamais un 16.
        $this->saveRecurrence(self::intAt($this->day('2026-10-16'), 'version'), [self::demo()], null, $monthly, '2026-10-16');
        [$sixteenth] = $this->repeatWith(self::intAt($this->day('2026-10-16'), 'version'), self::work('14:00', '15:00', 'OPS-12', 'Dépendances'), self::monthlyDate(16), '2026-10-16');
        $version = self::intAt($this->day('2026-10-09'), 'version');
        [$status, $body] = $this->putRecurrence($version, [self::retro()], self::everyWeeks(2, [5]), date: '2026-10-09');
        self::assertSame(422, $status);
        self::assertSame(self::taken('Dépendances'), $body['violations']);
        [$status, $body] = $this->putRecurrence($version, [self::retro()], self::everyWeeks(2, [5], '2027-07-16'), date: '2026-10-09');
        self::assertSame(422, $status, 'Jusqu\'au 16 juillet compris.');
        [$alternate] = $this->repeatWith($version, self::retro(), self::everyWeeks(2, [5], '2027-06-30'), '2026-10-09');

        self::assertNull($this->recurrenceRow($sixteenth)['until']);
        self::assertSame('2027-06-30', $this->recurrenceRow($alternate)['until']);
        $this->assertNoClash();
    }

    public function testUnOngletResteOuvertPendantQuOnCreaitLAutreAilleurs(): void
    {
        // L'onglet du 15 lit sa journée…
        $seen = $this->day(self::NEXT_THURSDAY);
        // … un autre crée la rétrospective depuis le 8 : elle ne tombe pas le 15, dont la
        // version ne bouge pas.
        $this->repeatWith(0, self::retro(), self::everyWeeks(2, [4]), self::THURSDAY);
        self::assertSame($seen['version'], $this->day(self::NEXT_THURSDAY)['version']);
        $before = $this->written();

        [$status, $body] = $this->putRecurrence(self::intAt($seen, 'version'), [self::demo()], self::weekly([4]), date: self::NEXT_THURSDAY);

        self::assertSame(422, $status, json_encode($body, \JSON_THROW_ON_ERROR));
        self::assertSame(self::taken('Rétrospective'), $body['violations']);
        self::assertSame($before, $this->written());
        // Relue, la journée nomme la rétrospective parmi celles qui vont encore jusqu'à elle.
        self::assertCount(1, self::arrayAt($this->day(self::NEXT_THURSDAY), 'ongoing'));
    }

    public function testDeuxCreationsSimultaneesQuiSeCroisentNePassentPasToutesLesDeux(): void
    {
        // L'autre worker : son propre noyau, sa propre connexion au même fichier.
        $other = static::createKernel();
        $other->boot();

        try {
            // Il n'existe que dans le conteneur des tests, que l'analyse ne lit pas.
            $otherContainer = $other->getContainer()->get('test.service_container'); // @phpstan-ignore symfonyContainer.serviceNotFound
            self::assertInstanceOf(ContainerInterface::class, $otherContainer);
            $otherWriter = $otherContainer->get(DayWriter::class);

            // Celui-ci crée la démo chaque jeudi depuis le 15 ; l'autre, la rétrospective un
            // jeudi sur deux depuis le 8, avant que celui-ci ait le verrou.
            $container = static::getContainer();
            $entityManager = $container->get(EntityManagerInterface::class);
            $racing = new class($entityManager, $otherWriter) extends EntityManagerDecorator {
                private bool $raced = false;

                public function __construct(EntityManagerInterface $wrapped, private readonly DayWriter $other)
                {
                    parent::__construct($wrapped);
                }

                public function getConnection(): Connection
                {
                    if (!$this->raced) {
                        $this->raced = true;
                        $this->other->saveRecurrence(self::date('2026-10-08'), 0, self::quarters('Rétrospective'), new RecurrenceSpec(Rhythm::weekly([4], 2), null), null);
                    }

                    return parent::getConnection();
                }

                /** @return array<int, SlotContent> */
                public static function quarters(string $comment): array
                {
                    return array_fill_keys(Quarter::between(840, 900), SlotContent::work('OPS-7', $comment));
                }

                public static function date(string $date): \DateTimeImmutable
                {
                    return UserCalendar::date($date) ?? throw new \LogicException($date);
                }
            };
            $writer = new DayWriter(
                $entityManager,
                new LockedTransaction($racing),
                $container->get(DayRepository::class),
                $container->get(UserSettings::class),
                $container->get(RecurrenceRepository::class),
                $container->get(RecurrencePoser::class),
                $container->get(UserCalendar::class),
                $container->get(RecurrenceForecast::class),
                $container->get(SendClosure::class),
                $container->get(DaySendRepository::class),
            );

            try {
                $writer->saveRecurrence(UserCalendar::date(self::NEXT_THURSDAY) ?? throw new \LogicException(), 0, array_fill_keys(Quarter::between(840, 900), SlotContent::work('OPS-12', 'Démo')), new RecurrenceSpec(Rhythm::weekly([4]), null), null);
                self::fail('Les deux récurrences sont passées.');
            } catch (RecurrenceRefused $refused) {
                self::assertSame('recurrence.rhythm', $refused->field);
                self::assertSame("Ce créneau est déjà pris par la récurrence «\u{a0}Rétrospective\u{a0}».", $refused->getMessage());
            }
        } finally {
            $other->shutdown();
        }

        self::assertSame(1, $this->recurrenceRows(), 'Seule la première est passée.');
        self::assertSame([], $this->rows(self::NEXT_THURSDAY));
        self::assertSame(0, $this->day(self::NEXT_THURSDAY)['version']);
        self::assertSame(['14:00-15:00 OPS-7 « Rétrospective »'], self::blocks($this->day('2026-10-22')));
    }

    public function testAnnulerUnArretSurUnCreneauPrisDepuisSeRefuse(): void
    {
        foreach ([
            'case décochée' => [self::daily()],
            'effacée avec les suivantes' => [self::clear('09:15', '09:30')],
        ] as $case => $changes) {
            self::purgeDatabase();
            [$daily] = $this->repeat(0, self::daily());
            // Arrêtée à partir du jeudi.
            $stopped = $this->saveRecurrence(self::intAt($this->day(self::THURSDAY), 'version'), $changes, null, $daily, self::THURSDAY);
            self::assertSame([['recurrence' => $daily, 'before' => null, 'after' => self::WEDNESDAY]], $stopped['untils'], $case);
            // Un autre onglet reprend le créneau dès le lundi.
            [$support, $created] = $this->repeatWith(0, self::work('09:15', '09:30', 'OPS-7', 'Support'), self::weekly(), self::MONDAY);
            $before = $this->written();

            $undo = ['version' => self::intAt($stopped, 'version'), 'changes' => [self::linked(self::daily(), $daily)], 'recurrences' => [['recurrence' => $daily, 'from' => self::WEDNESDAY, 'to' => null]], 'restores' => true];
            [$status, $body] = $this->send('PATCH', '/api/days/'.self::THURSDAY.'/slots', $undo);

            self::assertSame(409, $status, $case.' : '.json_encode($body, \JSON_THROW_ON_ERROR));
            self::assertSame('stale', $body['error'], $case);
            self::assertSame($before, $this->written(), $case.' : rien n\'est annulé.');
            self::assertSame(self::WEDNESDAY, $this->recurrenceRow($daily)['until'], $case);

            // L'autre onglet annule sa création : annuler passe.
            $this->writeWith(self::intAt($created, 'version'), [self::clear('09:15', '09:30')], [['recurrence' => $support, 'from' => null, 'to' => '2026-10-11']], self::MONDAY);
            [$status, $body] = $this->send('PATCH', '/api/days/'.self::THURSDAY.'/slots', $undo);
            self::assertSame(200, $status, $case.' : '.json_encode($body, \JSON_THROW_ON_ERROR));
            self::assertNull($this->recurrenceRow($daily)['until'], $case);
            self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($body, [$daily => 'daily']), $case);
            $this->assertNoClash();
        }
    }

    public function testRetablirUneCreationSurUnCreneauPrisDepuisSeRefuse(): void
    {
        [$daily, $created] = $this->repeat(0, self::daily());
        $undone = $this->writeWith(self::intAt($created, 'version'), [self::clear('09:15', '09:30')], [['recurrence' => $daily, 'from' => null, 'to' => '2026-10-05']]);
        // Le créneau libéré, un autre onglet y crée le support depuis jeudi.
        $this->repeatWith(self::intAt($this->day(self::THURSDAY), 'version'), self::work('09:15', '09:30', 'OPS-7', 'Support'), self::weekly(), self::THURSDAY);
        $before = $this->written();

        [$status, $body] = $this->patchSlotsWith(self::intAt($undone, 'version'), [self::linked(self::daily(), $daily)], [['recurrence' => $daily, 'from' => '2026-10-05', 'to' => null]]);

        self::assertSame(409, $status, json_encode($body, \JSON_THROW_ON_ERROR));
        self::assertSame($before, $this->written(), 'Rien n\'est rétabli.');
        self::assertSame('2026-10-05', $this->recurrenceRow($daily)['until']);

        // Rétablie jusqu'au mercredi seulement, la veille du support : elle passe. Une page ne
        // l'enverrait pas, mais un créneau libre suffit au serveur.
        $day = $this->writeWith(self::intAt($undone, 'version'), [self::linked(self::daily(), $daily)], [['recurrence' => $daily, 'from' => '2026-10-05', 'to' => self::WEDNESDAY]]);
        self::assertSame(['09:15-09:30 OPS-12 « Daily » ↻daily'], self::arrows($day, [$daily => 'daily']));
        $this->assertNoClash();
    }

    public function testUnCreneauPrisSeulementAujourdHuiOuAvantNeComptePas(): void
    {
        // Des essais de 2016 et 2017, finis depuis longtemps, sur le créneau du Daily.
        $this->storeRecurrence(SlotContent::work('OPS-7', 'Essai'), '09:00', '10:00', Rhythm::weekly([1, 2, 3, 4, 5]), '2016-01-04', '2017-06-30');
        [$daily] = $this->repeat(0, self::daily());

        // Le créneau du Daily, jusqu'à aujourd'hui seulement : un jour déjà venu ne reçoit
        // jamais rien après coup, rien à refuser.
        [$today, $day] = $this->repeat(1, self::work('09:15', '09:30', 'OPS-7', 'Aujourd\'hui'), [2], self::TODAY);
        self::assertSame(['09:15-09:30 OPS-7 « Aujourd\'hui » ↻aujourd\'hui'], self::arrows($day, [$today => 'aujourd\'hui']), 'La fenêtre écrit son bloc, et le Daily cède sa fois.');
        self::assertSame([$daily.' '.self::TODAY], $this->skips());
        // Jusqu'à demain : pris.
        [$status, $body] = $this->putRecurrence(2, [self::work('09:15', '09:30', 'OPS-7', 'Demain')], self::weekly([2, 3], self::WEDNESDAY));
        self::assertSame(422, $status);
        self::assertSame(self::taken('Daily'), $body['violations']);

        // Depuis un jour passé, une récurrence finie avant aujourd'hui.
        self::mockTime('2026-10-13 08:00:00 Europe/Paris');
        [$past] = $this->repeat(self::intAt($this->day(self::THURSDAY), 'version'), self::work('09:15', '09:30', 'SHOP-482'), [4], self::THURSDAY, self::THURSDAY);
        self::assertSame(['firstDay' => self::THURSDAY, 'until' => self::THURSDAY, 'posedThrough' => '2026-10-13'], $this->recurrenceRow($past));
        self::assertSame(4, $this->recurrenceRows());
        $this->assertNoClash();
    }

    public function testLaJourneeRendLesRecurrencesQuiOntEncoreDesJoursAVenir(): void
    {
        $this->write(0, [self::work('16:00', '16:15', 'SHOP-482')]);
        self::assertStringContainsString('"ongoing":{}', (string) $this->browser->getResponse()->getContent(), 'Un objet même vide.');

        [$daily] = $this->repeat(1, self::daily());
        [$untilThursday] = $this->repeat(2, self::work('10:00', '10:15', 'OPS-7'), until: self::THURSDAY);
        [$untilWednesday] = $this->repeat(3, self::pause('12:00', '12:15'), until: self::WEDNESDAY);
        [$withdrawn] = $this->repeat(4, self::work('11:00', '11:15', 'OPS-7', 'Retirée'));
        $this->saveRecurrence(5, [self::work('11:00', '11:15', 'OPS-7', 'Retirée')], null, $withdrawn);
        [$later] = $this->repeatWith(self::intAt($this->day('2026-10-16'), 'version'), self::retro(), self::monthlyWeekday(5, 3), '2026-10-16');
        // Jusqu'à aujourd'hui : elle ne prend plus aucun créneau, même aujourd'hui.
        [$endsToday] = $this->repeat(6, self::work('17:00', '17:15', 'OPS-7'), until: self::TODAY);

        $thursday = $this->day(self::THURSDAY);
        // Ni finie aujourd'hui ou avant, ni retirée ; finie la veille du jour lu, ou partant plus
        // tard, si : le serveur juge un créneau sur toutes celles-là.
        self::assertSame([$daily, $untilThursday, $untilWednesday, $later], array_keys(self::arrayAt($thursday, 'ongoing')));
        self::assertSame([$daily, $untilThursday], array_keys(self::arrayAt($thursday, 'recurrences')), 'Seules celles de ses blocs.');
        self::assertSame([
            'start' => '14:00',
            'end' => '15:00',
            'kind' => 'monthly_weekday',
            'weekdays' => [5],
            'everyWeeks' => 1,
            'monthWeek' => 3,
            'monthDay' => null,
            'firstDay' => '2026-10-16',
            'until' => null,
            'slot' => ['kind' => 'work', 'ticket' => 'OPS-7', 'comment' => 'Rétrospective'],
            'skipped' => [],
        ], self::arrayAt($thursday, 'ongoing', $later));
        self::assertSame(['kind' => 'pause', 'ticket' => null, 'comment' => null], self::arrayAt($this->day(), 'ongoing', $untilWednesday, 'slot'));

        $today = $this->day();
        self::assertSame([$daily, $untilThursday, $untilWednesday, $later], array_keys(self::arrayAt($today, 'ongoing')));
        self::assertArrayHasKey($endsToday, self::arrayAt($today, 'recurrences'), 'Son bloc d\'aujourd\'hui garde sa flèche.');
        self::assertSame([$daily, $untilThursday, $untilWednesday, $later], array_keys(self::arrayAt($this->day('2026-10-09'), 'ongoing')));
        self::mockTime('2026-10-08 08:00:00 Europe/Paris');
        self::assertSame([$daily, $later], array_keys(self::arrayAt($this->day('2026-10-09'), 'ongoing')), 'Finies aujourd\'hui ou avant, elles ne prennent plus rien.');
    }

    public function testUneFoisEffaceeCetteFoisSeulementNePrendPlusLeCreneau(): void
    {
        // La rétrospective, un jeudi sur deux du 8 au 22 octobre ; sa fois du 22 effacée, cette
        // fois seulement.
        [$retro] = $this->repeatWith(0, self::retro(), self::everyWeeks(2, [4], '2026-10-22'), self::THURSDAY);
        $this->write(self::intAt($this->day('2026-10-22'), 'version'), [self::clear('14:00', '15:00')], '2026-10-22');
        self::assertSame([$retro.' 2026-10-22'], $this->skips());
        self::assertSame(['2026-10-22'], self::arrayAt($this->day(self::NEXT_THURSDAY), 'ongoing', $retro, 'skipped'), 'La journée dit ses fois sautées à venir.');
        self::assertSame(['2026-10-22'], self::arrayAt($this->day(self::THURSDAY), 'recurrences', $retro, 'skipped'));

        // Chaque jeudi depuis le 15 : la rétrospective n'y revient plus.
        $day = $this->saveRecurrence(0, [self::demo()], self::weekly([4]), null, self::NEXT_THURSDAY);
        self::assertCount(1, self::listAt($day, 'untils'));
        self::assertSame(['14:00-15:00 OPS-12 « Démo »'], self::blocks($this->day('2026-10-22')));
        self::assertSame(2, $this->recurrenceRows());
        $this->assertNoClash();
    }

    public function testUneFoisSauteeNeLibereQueSonJour(): void
    {
        // Sans fin, sa fois du 22 effacée : celle du 5 novembre prend encore le créneau.
        $this->repeatWith(0, self::retro(), self::everyWeeks(2, [4]), self::THURSDAY);
        $this->write(self::intAt($this->day('2026-10-22'), 'version'), [self::clear('14:00', '15:00')], '2026-10-22');
        $before = $this->written();

        [$status, $body] = $this->putRecurrence(0, [self::demo()], self::weekly([4]), date: self::NEXT_THURSDAY);

        self::assertSame(422, $status, json_encode($body, \JSON_THROW_ON_ERROR));
        self::assertSame(self::taken('Rétrospective'), $body['violations']);
        self::assertSame($before, $this->written());
    }

    public function testUneFoisRetenueParUnJourA0h00GardeSonCreneau(): void
    {
        // Le jeudi 22 mis à 0h00 retient la fois de la rétrospective : revenir à un objectif la rendrait.
        [$retro] = $this->repeatWith(0, self::retro(), self::everyWeeks(2, [4], '2026-10-22'), self::THURSDAY);
        $this->putObjective(self::intAt($this->day('2026-10-22'), 'version'), 0, '2026-10-22');
        self::assertSame([$retro.' 2026-10-22'], $this->skips());
        self::assertSame([], self::arrayAt($this->day(self::NEXT_THURSDAY), 'ongoing', $retro, 'skipped'));

        [$status, $body] = $this->putRecurrence(0, [self::demo()], self::weekly([4]), date: self::NEXT_THURSDAY);

        self::assertSame(422, $status, json_encode($body, \JSON_THROW_ON_ERROR));
        self::assertSame(self::taken('Rétrospective'), $body['violations']);
    }

    public function testAnnulerNeRamenePasUneFoisSauteeSurLeCreneauQuUneAutreAPrisDepuis(): void
    {
        // La rétrospective, un jeudi sur deux du 8 au 22 octobre ; sa fois du 22 effacée, cette
        // fois seulement. La démo, chaque jeudi depuis le 15, passe grâce à ce saut.
        [$retro] = $this->repeatWith(0, self::retro(), self::everyWeeks(2, [4], '2026-10-22'), self::THURSDAY);
        $this->write(self::intAt($this->day('2026-10-22'), 'version'), [self::clear('14:00', '15:00')], '2026-10-22');
        [$demo] = $this->repeatWith(0, self::demo(), self::weekly([4]), self::NEXT_THURSDAY);
        $names = [$retro => 'rétro', $demo => 'démo'];
        $before = $this->written();

        // Annuler l'effacement, la journée relue : la rétrospective y reviendrait sur la démo.
        $undo = ['version' => self::intAt($this->day('2026-10-22'), 'version'), 'changes' => [self::linked(self::retro(), $retro)], 'recurrences' => [], 'restores' => true];
        [$status, $body] = $this->send('PATCH', '/api/days/2026-10-22/slots', $undo);

        self::assertSame(409, $status, json_encode($body, \JSON_THROW_ON_ERROR));
        self::assertSame('stale', $body['error']);
        self::assertSame($before, $this->written(), 'Rien n\'est annulé.');
        self::assertSame(['14:00-15:00 OPS-12 « Démo » ↻démo'], self::arrows($this->day('2026-10-22'), $names));
        $this->assertNoClash();

        // La fois de la démo effacée à son tour, cette fois seulement : le créneau est libre,
        // annuler passe.
        $this->write(self::intAt($this->day('2026-10-22'), 'version'), [self::clear('14:00', '15:00')], '2026-10-22');
        [$status, $day] = $this->send('PATCH', '/api/days/2026-10-22/slots', ['version' => self::intAt($this->day('2026-10-22'), 'version')] + $undo);
        self::assertSame(200, $status, json_encode($day, \JSON_THROW_ON_ERROR));
        self::assertSame(['14:00-15:00 OPS-7 « Rétrospective » ↻rétro'], self::arrows($day, $names));
        self::assertSame([$demo.' 2026-10-22'], $this->skips());
        $this->assertNoClash();
    }

    public function testUnAutreCommentaireAvecLesSuivantesGardeSesFoisSauteesQuiNePrennentRien(): void
    {
        // La démo, chaque jeudi depuis le 15, sa fois du 29 effacée ; la revue, ce seul jeudi 29,
        // à sa place.
        [$demo] = $this->repeatWith(0, self::demo(), self::weekly([4]), self::NEXT_THURSDAY);
        $this->write(self::intAt($this->day('2026-10-29'), 'version'), [self::clear('14:00', '15:00')], '2026-10-29');
        $this->repeatWith(self::intAt($this->day('2026-10-29'), 'version'), self::retro(), self::weekly([4], '2026-10-29'), '2026-10-29');

        // Le 22, un autre commentaire avec les suivantes, au même rythme : coupée, la démo garde sa
        // fois du 29 effacée, et ne croise pas la revue — la fenêtre n'avait rien annoncé.
        $day = $this->saveRecurrence(self::intAt($this->day('2026-10-22'), 'version'), [self::work('14:00', '15:00', 'OPS-12', 'Démo de sprint')], self::weekly([4]), $demo, '2026-10-22');

        $new = self::stringAt($day, 'untils', 1, 'recurrence');
        self::assertSame('2026-10-21', $this->recurrenceRow($demo)['until']);
        self::assertSame(['2026-10-29'], self::arrayAt($day, 'recurrences', $new, 'skipped'));
        self::assertSame(['14:00-15:00 OPS-7 « Rétrospective »'], self::blocks($this->day('2026-10-29')));
        self::assertSame(['14:00-15:00 OPS-12 « Démo de sprint » ↻sprint'], self::arrows($this->day('2026-11-05'), [$new => 'sprint']));
        self::assertSame(3, $this->recurrenceRows());
        $this->assertNoClash();
    }

    public function testUneFinRepousseeGardeSesFoisSauteesQuiNePrennentRien(): void
    {
        // La démo, chaque jeudi du 15 octobre au 5 novembre, sa fois du 29 effacée ; la revue,
        // ce seul jeudi 29, à sa place.
        [$demo] = $this->repeatWith(0, self::demo(), self::weekly([4], '2026-11-05'), self::NEXT_THURSDAY);
        $this->write(self::intAt($this->day('2026-10-29'), 'version'), [self::clear('14:00', '15:00')], '2026-10-29');
        $this->repeatWith(self::intAt($this->day('2026-10-29'), 'version'), self::retro(), self::weekly([4], '2026-10-29'), '2026-10-29');

        // Sa fin repoussée au 19 novembre : sa fois du 29 reste effacée, elle ne croise pas la revue.
        $day = $this->saveRecurrence(self::intAt($this->day(self::NEXT_THURSDAY), 'version'), [self::demo()], self::weekly([4], '2026-11-19'), $demo, self::NEXT_THURSDAY);

        self::assertSame([['recurrence' => $demo, 'before' => '2026-11-05', 'after' => '2026-11-19']], $day['untils']);
        self::assertSame(['14:00-15:00 OPS-7 « Rétrospective »'], self::blocks($this->day('2026-10-29')));
        self::assertSame(2, $this->recurrenceRows());
        $this->assertNoClash();
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
            'recurrences' => $connection->fetchAllAssociative('SELECT HEX(id) AS id, first_day, until, posed_through FROM recurrence ORDER BY id'),
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

    /**
     * @return array<string, ?string>
     */
    private static function retro(): array
    {
        return self::work('14:00', '15:00', 'OPS-7', 'Rétrospective');
    }

    /**
     * @return array<string, ?string>
     */
    private static function demo(): array
    {
        return self::work('14:00', '15:00', 'OPS-12', 'Démo');
    }

    /**
     * @return array<string, ?string>
     */
    private static function daily(): array
    {
        return self::work('09:15', '09:30', 'OPS-12', 'Daily');
    }
}
