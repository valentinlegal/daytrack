<?php

namespace App\Tests\Api;

use App\Day\SlotContent;
use App\Day\UserCalendar;
use App\Dev\Jira\Catalog;
use App\Entity\Recurrence;
use App\Recurrence\RecurrenceClash;
use App\Recurrence\Rhythm;
use App\Tests\Support\DayApi;
use App\Tests\Support\JiraApi;
use App\Tests\Support\RandomSuite;
use App\Tests\Support\RecurrenceApi;
use Random\Randomizer;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Uid\Uuid;

/**
 * Des suites de gestes tirées au hasard, jouées contre l'API comme le ferait la
 * page : poser, superposer, coller avec des trous, effacer, convertir en pause,
 * changer l'objectif — le mettre à 0h00, qui retire les blocs des récurrences, et en
 * revenir, qui les rend —, annuler — mêlés à des onglets en retard, des gestes envoyés
 * deux fois et des gestes refusés, dont des tickets que Jira ne connaît pas. Et les
 * récurrences : en créer une sur un bloc, chaque semaine, une semaine sur 2 à 4, ou chaque mois
 * au rang, au dernier ou à la date que le jour du bloc permet ; sur un bloc qui revient, la
 * changer, l'arrêter ou l'effacer avec les suivantes, l'allonger ou la raccourcir avec les
 * suivantes — le même contenu collé à un bord, ou un bord effacé —, la couper avec les suivantes
 * puis la coller ailleurs, l'arrêter ou la changer cette fois seulement par un geste ordinaire ;
 * et annuler puis rétablir tout cela en reliant les quarts d'heure à leur récurrence. Changer ses
 * heures autrement, ou depuis un jour passé, se refuse sans rien écrire. Une récurrence arrêtée
 * avant le jour joué n'y a plus de fois : ce qu'elle y avait posé se lit comme une saisie
 * ordinaire, son lien restant en base.
 *
 * Jamais deux récurrences sur un créneau : une création, une coupe, une fin repoussée, ou
 * annuler et rétablir, qui en mèneraient une sur le créneau d'une autre après aujourd'hui, sont
 * refusés sans rien écrire — 422 sous le rythme pour la fenêtre, 409 pour annuler et rétablir.
 * Annuler qui ramènerait une fois effacée sur le créneau qu'une autre a pris depuis grâce à ce
 * saut l'est de même. Le modèle le sait par sa propre recherche, refaite ici ; un autre onglet
 * crée d'autres récurrences ailleurs, les jours à venir, souvent sur un créneau que l'historique
 * voudrait rendre. Après chaque pas, aucune paire de la base ne se croise, et aucun quart d'heure n'est
 * écrit deux fois.
 *
 * Un modèle tenu à côté, quart d'heure par quart d'heure, dit ce que la journée
 * doit être : chaque contenu et la récurrence qui l'a posé, la fin de chaque récurrence,
 * les fois détachées et celles que le 0h00 retient. Après chaque geste, la base, les blocs
 * rendus et les chiffres doivent lui être identiques : ni double, ni fantôme, ni
 * chevauchement, et le travaillé égal à la somme des blocs. Pour finir, tout annuler ramène
 * à la journée vide et retire toutes les récurrences, tout rétablir ramène à la journée
 * d'avant, et le lendemain reçoit exactement ce que les récurrences y posent, sur les seuls
 * quarts d'heure libres. Le surlendemain, le jour joué est passé : sa fenêtre change le rythme
 * ou la fin à partir de demain, et y crée encore des récurrences.
 *
 * Un jour à venir se joue de même, sur les fois prévues de récurrences nées aujourd'hui :
 * elles se montrent et se comptent sans s'écrire, jusqu'à ce qu'un geste les touche, qu'un
 * envoi les pose ou que le jour vienne. Couper une récurrence ce jour-là en fait naître une
 * qui l'a déjà traité : elle y est écrite, jamais prévue. Le modèle les déduit de leurs
 * récurrences, sans le code de l'application, et le jour venu montre exactement ce qu'il
 * prévoyait, écrit.
 *
 * Chaque passage tire une graine neuve ; RANDOM_SEED en rejoue une. RANDOM_SEQUENCES
 * règle le nombre de suites, RANDOM_STEPS le nombre de pas de chacune : modérés par défaut,
 * pour l'intégration continue, autant qu'on veut en local.
 *
 * @phpstan-type Content array{string, ?string, ?string}
 * @phpstan-type Quarter array{string, ?string, ?string, ?string}
 * @phpstan-type Change array<string, ?string>
 * @phpstan-type Rewind array{recurrence: string, from: ?string, to: ?string}
 * @phpstan-type Gesture array{changes: list<Change>, recurrences: list<Rewind>, detaches?: list<string>}
 * @phpstan-type Step array{redo: Gesture, undo: Gesture, off: bool}
 * @phpstan-type Snapshot array{array<int, Quarter>, array<string, ?string>}
 * @phpstan-type Block array{int, int, Quarter}
 * @phpstan-type Rule array{kind: string, weekdays: list<int>, everyWeeks: int, monthWeek: ?int, monthDay: ?int}
 * @phpstan-type Repeat array{content: Content, start: int, end: int, rhythm: Rule, until: ?string, firstDay: string, posed: string, follows?: string, cutOn?: string}
 */
final class DayRandomTest extends WebTestCase
{
    use DayApi;
    use JiraApi;
    use RandomSuite;
    use RecurrenceApi;

    private const int SEQUENCES = 40;

    private const int STEPS = 30;

    private const int AHEAD_STEPS = 25;

    /** Les pas joués sur le jour devenu passé. */
    private const int PAST_STEPS = 8;

    private const int QUARTERS = 52;

    /** La fin d'une récurrence retirée : la veille de son premier jour, aujourd'hui. */
    private const string WITHDRAWN = '2026-10-05';

    /** Le mercredi, où les récurrences restantes se posent d'elles-mêmes. */
    private const string TOMORROW = '2026-10-07';

    /** Le jeudi, jour à venir où l'on joue sur les fois prévues. */
    private const string THURSDAY = '2026-10-08';

    /** Le vendredi, encore à venir le jeudi venu : on y pose un congé d'avance. */
    private const string FRIDAY = '2026-10-09';

    /** Les jours où un autre onglet crée ses récurrences : après tous ceux qu'on joue, et ouverts. */
    private const string ELSEWHERE_FROM = '2026-10-12';

    private const string ELSEWHERE_TO = '2026-11-05';

    /** « Jusqu'au » d'une récurrence née pour le jeudi : vide le plus souvent, parfois avant lui. */
    private const array AHEAD_UNTILS = [null, null, null, null, '2026-10-07', self::THURSDAY, '2026-10-09', '2026-11-30'];

    private const string UNKNOWN = '0199a3c4-5b6d-7e8f-9a0b-1c2d3e4f5a6b';

    /** Peu de contenus, pour que des voisins identiques se rencontrent souvent. */
    private const array CONTENTS = [
        ['work', 'SHOP-482', null],
        ['work', 'SHOP-482', 'Tests'],
        ['work', 'OPS-7', null],
        ['work', 'OPS-7', 'Revue'],
        ['pause', null, null],
    ];

    /** Le jour joué. */
    private string $date = self::TODAY;

    /** Aujourd'hui, à l'horloge. */
    private string $today = self::TODAY;

    /** @var array<int, Quarter> le modèle : chaque quart d'heure écrit du jour joué, par son début, et la récurrence qui l'a posé */
    private array $model = [];

    /** @var array<string, Repeat> chaque récurrence, par son identifiant : son rythme, son premier jour, et le dernier jour qu'elle a traité */
    private array $recurrences = [];

    /** @var array<string, string> celles qu'un autre onglet a créées ailleurs, et le jour où il l'a fait */
    private array $elsewhere = [];

    /** @var array<string, ?string> les recherches de conflit du modèle déjà faites */
    private array $clashes = [];

    /** @var array<string, bool> les paires de la base déjà jugées libres */
    private array $freePairs = [];

    /** @var array<string, bool> celles dont la fois du jour joué est détachée, et si c'est le 0h00 qui la retient */
    private array $skips = [];

    /** @var list<string> les fois détachées d'autres jours que celui qu'on joue, telles que la base les garde */
    private array $otherSkips = [];

    /** @var list<Step> chaque geste fait, et ce qui l'annule, comme la page les enverrait */
    private array $done = [];

    /** @var list<Step> chaque geste annulé, que rétablir referait */
    private array $undone = [];

    /** @var ?array{string, string, array<string, mixed>} la dernière requête passée : méthode, chemin, corps sans sa version */
    private ?array $last = null;

    /** La version que l'onglet tient : la dernière que l'API a rendue. */
    private int $version = 0;

    /** @var list<int> chaque version que l'onglet a tenue */
    private array $seen = [];

    /** La version de la ligne du jour, 0 tant qu'il n'en a pas. */
    private int $rowVersion = 0;

    private int $objective = 450;

    /**
     * Le 0h00, ou le retour, a changé ce que la grille montre, hors de l'historique ; ou le jour
     * à 0h00 n'a pas repris ce qu'annuler ou rétablir y reliait.
     */
    private bool $outside = false;

    /** Un quart d'heure lié à une récurrence a été écrit sur le jour à venir : par un envoi, ou relié à une récurrence née ce jour-là. */
    private bool $linkedWritten = false;

    /**
     * Annuler a repris à une récurrence un quart d'heure qui lui était écrit, sur le jour à
     * venir : un envoi l'y avait posé depuis le geste annulé.
     */
    private bool $reclaimed = false;

    /** @var list<string> les récurrences dont le dernier geste a rendu la fois à sa série sans l'écrire */
    private array $returned = [];

    /**
     * Envoyé, une fois au moins dans la suite : le jour a reçu ses récurrences pour de bon,
     * comme un jour venu, et annuler ne lui en rend plus de prévue. Tout annuler n'est plus exact.
     */
    private bool $settled = false;

    /**
     * Un envoi du jour joué en reste. Tant qu'il a quelque chose à dire — des tickets, ou des
     * heures dans Jira —, le jour n'en prévoit plus aucune, même née, changée ou étendue ensuite
     * (closes).
     */
    private bool $sendKept = false;

    /** Jira a des heures du jour joué : un envoi a réussi depuis le dernier renvoi vide. */
    private bool $inJira = false;

    /** Le jour joué était fermé après la dernière écriture : la suivante peut le rouvrir. */
    private bool $wasClosed = false;

    /** @var list<string> les récurrences qui avaient un bloc sur le jour joué après la dernière écriture */
    private array $linkedBefore = [];

    public function testDesSuitesDeGestesLaissentExactementLaJourneeAttendue(): void
    {
        $random = $this->randomizer();
        for ($sequence = 0; $sequence < self::sequences(); ++$sequence) {
            $this->start(self::TODAY);

            for ($step = 0; $step < self::steps(self::STEPS); ++$step) {
                $roll = $random->getInt(1, 100);
                $linked = $this->linkedBlocks();

                if ($roll <= 27) {
                    $this->gesture($random);
                } elseif ($roll <= 32) {
                    0 === $random->getInt(0, 2) ? $this->eraseElsewhere($random) : $this->elsewhere($random);
                } elseif ($roll <= 42) {
                    $this->createRecurrence($random);
                } elseif ($roll <= 58 && [] !== $linked) {
                    $this->onRecurringBlock($random, $linked[$random->getInt(0, \count($linked) - 1)]);
                    $this->takenElsewhere($random);
                } elseif ($roll > 58 && $roll <= 68 && [] !== $this->done) {
                    $this->undo();
                    $this->takenElsewhere($random);
                } elseif ($roll > 68 && $roll <= 72 && [] !== $this->undone) {
                    $this->redo();
                } elseif ($roll > 72 && $roll <= 77 && $this->version > 0) {
                    $this->refusedAsStale($random);
                } elseif ($roll > 77 && $roll <= 81 && null !== $this->last && $this->version > 0) {
                    // La même requête, partie deux fois : la seconde ne passe pas.
                    $this->refusedAsSentTwice($this->last);
                } elseif ($roll > 81 && $roll <= 93) {
                    $this->refusedAsInvalid($this->hostile($random));
                } elseif ($roll > 93) {
                    $this->changeObjective($this->objectiveFor($random));
                } else {
                    $this->gesture($random);
                }

                $this->assertMatchesModel();
            }

            // L'historique ne connaît que les gestes de la grille. Mis à 0h00, le jour perd les
            // blocs de ses récurrences ; revenu à un objectif, il les retrouve : la grille a
            // changé hors de lui. La page, qui ne défait un geste que si ses quarts d'heure sont
            // restés tels qu'il les a laissés, y verrait un conflit et oublierait son historique.
            // Les gestes absolus d'ici passent quand même, le modèle les suit un à un, mais ils
            // ne mènent plus à la journée vide ni à celle d'avant : ces deux-là ne se vérifient
            // que si le 0h00 et le retour n'ont rien changé à la grille. L'autre onglet retire
            // d'abord ce qu'il a créé ailleurs : l'historique retrouve chaque créneau qu'il rend.
            // Mis à 0h00, ce qu'annuler relie revient à sa série sans s'écrire, et rétablir le
            // détache de nouveau, comme la page.
            $this->withdrawElsewhere();
            $before = $this->snapshot();
            $detaches = [];
            foreach (array_reverse($this->done, true) as $index => ['undo' => $undo]) {
                self::assertTrue($this->patch($undo, true), 'Rien ne reprend plus les créneaux que l\'historique rend.');
                $detaches[$index] = $this->returned;
                if ($this->outside) {
                    $this->assertMatchesModel();
                }
            }
            if (!$this->outside) {
                self::assertSame([], $this->rows(), 'Tout annuler ramène à la journée vide.');
                self::assertSame([], array_filter($this->untils(), fn (?string $until, string $id): bool => $this->withdrawn($id) !== $until, \ARRAY_FILTER_USE_BOTH), 'Tout annuler retire toutes les récurrences.');
            }
            $this->assertMatchesModel();

            foreach ($this->done as $index => ['redo' => $redo]) {
                self::assertTrue($this->patch(self::detaching($redo, $detaches[$index] ?? [])));
                if ($this->outside) {
                    $this->assertMatchesModel();
                }
            }
            if (!$this->outside) {
                self::assertSame($before, $this->snapshot());
            }
            $this->assertMatchesModel();

            if (0 === $random->getInt(0, 1) && $this->endElsewhere($random)) {
                $this->touchEnded($random);
            }
            $this->assertTomorrow();
            $this->playPast($random);
        }
    }

    public function testDesSuitesDeGestesSurUnJourAVenirLaissentExactementSesSaisiesEtSesFoisPrevues(): void
    {
        $random = $this->randomizer();
        for ($sequence = 0; $sequence < self::sequences(); ++$sequence) {
            $this->start(self::THURSDAY);
            $this->prepareRecurrences($random);
            $this->read($this->day($this->date));
            $this->assertMatchesModel();
            // Une fois sur trois, la suite part d'un jour envoyé dont une récurrence a été
            // arrêtée avant lui, depuis un autre jour : ce qu'elle y a écrit n'en est plus une fois.
            if (0 === $random->getInt(0, 2)) {
                $this->endElsewhere($random);
            }
            $initial = $this->view();

            for ($step = 0; $step < self::steps(self::AHEAD_STEPS); ++$step) {
                $roll = $random->getInt(1, 100);

                $linked = $this->linkedBlocks();

                if ($roll <= 27) {
                    $this->gesture($random);
                } elseif ($roll <= 32) {
                    match ($random->getInt(0, 2)) {
                        0 => $this->takenOnceElsewhere($random),
                        1 => $this->eraseElsewhere($random),
                        default => $this->elsewhere($random),
                    };
                } elseif ($roll <= 46 && [] !== $this->done) {
                    $this->undo();
                    $this->takenElsewhere($random);
                } elseif ($roll > 46 && $roll <= 53 && [] !== $this->undone) {
                    $this->redo();
                } elseif ($roll > 53 && $roll <= 60 && [] !== $this->older()) {
                    $this->refusedAsLate($random);
                } elseif ($roll > 60 && $roll <= 67) {
                    $this->refusedAsInvalid($this->hostile($random));
                } elseif ($roll > 67 && $roll <= 74) {
                    $this->changeObjective($this->objectiveFor($random));
                } elseif ($roll > 74 && $roll <= 79 && $this->hasWork()) {
                    $this->sendDay(0 === $random->getInt(0, 3));
                } elseif ($roll > 74 && $roll <= 79 && $this->closes()) {
                    $this->resendEmpty();
                } elseif ($roll > 79 && $roll <= 84 && [] !== $linked) {
                    $this->eraseUndoRedo($random);
                    $this->takenOnceElsewhere($random);
                } elseif ($roll > 84 && [] !== $linked) {
                    $this->onRecurringBlock($random, $linked[$random->getInt(0, \count($linked) - 1)]);
                    $this->takenElsewhere($random);
                } else {
                    $this->gesture($random);
                }

                $this->assertMatchesModel();
            }

            // Comme aujourd'hui, l'historique ne mène au jour sans saisie et à la journée d'avant
            // que si le 0h00 et le retour n'ont rien changé à la grille, et qu'il se rejoue comme il
            // s'est rangé, à 0h00 ou non : à 0h00, rien n'est prévu. Un envoi n'y change rien :
            // il écrit ce que la journée montrait déjà. Mais ce qu'il a posé et qu'aucun
            // geste n'a touché depuis reste écrit ;
            // ce qu'il a posé, défait puis refait, redevient prévu : la journée montre la même
            // chose, sa base un peu moins. Et une fois prévue qu'un geste avait fait apparaître,
            // puis qu'un envoi a posée, n'est plus seulement prévue : annuler ce geste la lui
            // reprend comme à une saisie, et la détache. Envoyé, le jour ne prévoit plus rien :
            // tout annuler le vide. Hors de ces cas, l'historique est exact.
            $this->withdrawElsewhere();
            $before = $this->snapshot();
            foreach (array_reverse($this->done) as $step) {
                $this->replays($step);
            }
            $detaches = [];
            foreach (array_reverse($this->done, true) as $index => ['undo' => $undo]) {
                self::assertTrue($this->patch($undo, true));
                $detaches[$index] = $this->returned;
                if ($this->outside || $this->reclaimed) {
                    $this->assertMatchesModel();
                }
            }
            $this->assertMatchesModel();
            $exact = !$this->outside && !$this->reclaimed && !$this->settled;
            if ($exact) {
                self::assertSame($initial, $this->view(), 'Tout annuler ramène au jour sans saisie, qui montre exactement ses fois prévues.');
                // Une récurrence née d'une coupe, retirée par l'annulation, peut y garder la fois
                // qu'annuler lui a reprise : elle ne tombe plus ce jour-là.
                // Celle qu'un 0h00 retient l'est encore : rétablir la détachera de nouveau.
                self::assertSame([], array_filter($this->skips, fn (bool $held, string $id): bool => !$held && $this->reaches($id), \ARRAY_FILTER_USE_BOTH), 'Tout annuler rend leur fois à toutes les récurrences.');
                if (!$this->linkedWritten) {
                    self::assertSame([], $this->rows($this->date), 'Tout annuler n\'y laisse rien d\'écrit.');
                }
            }

            foreach ($this->done as $index => ['redo' => $redo]) {
                self::assertTrue($this->patch(self::detaching($redo, $detaches[$index] ?? [])));
                // Rétablir qui relie sur un jour à 0h00 ne ramène pas ce qu'il posait.
                $exact = $exact && [] === $this->returned;
                if (!$exact) {
                    $this->assertMatchesModel();
                }
            }
            if ($exact) {
                self::assertSame($before, $this->snapshot(), 'Tout rétablir ramène à la journée d\'avant.');
            }
            $this->assertMatchesModel();

            if (0 === $random->getInt(0, 1) && $this->endElsewhere($random)) {
                $this->touchEnded($random);
            }
            $this->assertComingDay($random);
            $this->assertLeaveCancelledOnComingDay($random);
        }
    }

    /**
     * Une suite neuve, sur une base vide, l'heure au mardi 15:20 : on joue $date.
     */
    private function start(string $date): void
    {
        self::mockTime('2026-10-06 15:20:00 Europe/Paris');
        self::purgeDatabase();
        $this->simulate('reinitialiser');
        $this->linkJira();
        $this->date = $date;
        $this->today = self::TODAY;
        $this->model = [];
        $this->recurrences = [];
        $this->skips = [];
        $this->otherSkips = [];
        $this->done = [];
        $this->undone = [];
        $this->last = null;
        $this->version = 0;
        $this->seen = [0];
        $this->rowVersion = 0;
        $this->objective = 450;
        $this->outside = false;
        $this->linkedWritten = false;
        $this->reclaimed = false;
        $this->settled = false;
        $this->sendKept = false;
        $this->inJira = false;
        $this->wasClosed = false;
        $this->linkedBefore = [];
        $this->elsewhere = [];
        $this->clashes = [];
        $this->freePairs = [];
    }

    private static function sequences(): int
    {
        $sequences = getenv('RANDOM_SEQUENCES');

        return false !== $sequences && '' !== $sequences ? (int) $sequences : self::SEQUENCES;
    }

    /** Les pas d'une suite : $default, ou RANDOM_STEPS. */
    private static function steps(int $default): int
    {
        $steps = getenv('RANDOM_STEPS');

        return false !== $steps && '' !== $steps ? (int) $steps : $default;
    }

    /**
     * Une à trois récurrences nées aujourd'hui, chacune d'un bloc écrit dans la fenêtre, qui
     * tombent le plus souvent le jeudi, chaque semaine, une semaine sur 2 à 4, ou chaque mois ;
     * une sur trois chevauche la précédente, une sur trois la recouvre : refusées quand elles
     * se croiseraient après aujourd'hui, sans rien écrire.
     */
    private function prepareRecurrences(Randomizer $random): void
    {
        $version = 0;
        $previous = null;
        for ($count = $random->getInt(1, 3), $attempts = 0; \count($this->recurrences) < $count && $attempts < 12; ++$attempts) {
            $shape = null === $previous ? 2 : $random->getInt(0, 2);
            if (null !== $previous && 1 === $shape) {
                // Plus récente, elle recouvre la précédente : elle ne se montre qu'autour d'elle.
                $first = max(0, intdiv($previous[0] - 420, 15) - $random->getInt(0, 2));
                $last = min(self::QUARTERS, intdiv($previous[1] - 420, 15) + $random->getInt(0, 2));
            } else {
                $first = null !== $previous && 0 === $shape
                    ? intdiv($random->getInt($previous[0], $previous[1] - 15) - 420, 15)
                    : $random->getInt(0, self::QUARTERS - 1);
                $last = $first + min($random->getInt(1, 8), self::QUARTERS - $first);
            }
            $start = self::minute($first);
            $end = self::minute($last);
            $content = $this->content($random);
            $weekdays = $this->weekdays($random);
            if (!\in_array(4, $weekdays, true) && 0 !== $random->getInt(0, 3)) {
                $weekdays[] = 4;
                sort($weekdays);
            }
            // Une semaine sur n compte ses semaines depuis celle du mardi : le jeudi en est.
            $rhythm = match ($random->getInt(0, 5)) {
                0 => self::weeklyRule($weekdays, $random->getInt(2, 4)),
                1 => $this->rule($random, self::TODAY),
                default => self::weeklyRule($weekdays),
            };
            $until = self::AHEAD_UNTILS[$random->getInt(0, \count(self::AHEAD_UNTILS) - 1)];
            $candidate = ['content' => $content, 'start' => $start, 'end' => $end, 'rhythm' => $rhythm, 'until' => $until, 'firstDay' => self::TODAY, 'posed' => self::TODAY];
            $change = self::state(self::clock($start), self::clock($end), [...$content, null]);

            if ($this->refusedAsTaken($candidate, $this->recurrences, ['PUT', '/recurrence', ['changes' => [$change], 'recurrence' => $rhythm + ['until' => $until], 'replaces' => null]], self::TODAY, $version)) {
                continue;
            }
            [$id, $day] = $this->repeatWith($version, $change, $rhythm + ['until' => $until]);

            $version = self::intAt($day, 'version');
            $this->recurrences[$id] = $candidate;
            $previous = [$start, $end];
        }
        // Aujourd'hui, une récurrence posée par-dessus une autre en a détaché la fois : ce
        // n'est pas le jour qu'on joue.
        $this->otherSkips = $this->storedSkips();
    }

    /** Un geste juste, sans récurrence : un à trois créneaux disjoints, chacun rempli ou vidé. */
    private function gesture(Randomizer $random): void
    {
        $changes = $this->randomChanges($random);
        $before = $this->snapshot();
        $gesture = ['changes' => $changes, 'recurrences' => []];

        $this->patch($gesture);

        $this->record($before, self::touched($changes));
        $this->last = ['PATCH', '/slots', $gesture];
    }

    /**
     * « Enregistrer » dans la fenêtre d'un bloc, ou d'une sélection, la case cochée, à un rythme
     * que le jour permet. Refusée si elle tomberait sur le créneau d'une autre.
     *
     * @return bool elle est créée
     */
    private function createRecurrence(Randomizer $random): bool
    {
        $blocks = self::blocksOf($this->view());
        if ([] !== $blocks && 1 === $random->getInt(0, 1)) {
            [$start, $end, $quarter] = $blocks[$random->getInt(0, \count($blocks) - 1)];
            $content = 1 === $random->getInt(1, 2) ? [$quarter[0], $quarter[1], $quarter[2]] : $this->content($random);
        } else {
            $first = $random->getInt(0, self::QUARTERS - 1);
            $start = self::minute($first);
            $end = self::minute($first + min($random->getInt(1, 6), self::QUARTERS - $first));
            $content = $this->content($random);
        }
        // Souvent sur le créneau d'une récurrence, pour qu'elles se rencontrent.
        $repeats = array_values($this->recurrences);
        if ([] !== $repeats && 0 === $random->getInt(0, 3)) {
            $other = $repeats[$random->getInt(0, \count($repeats) - 1)];
            [$start, $end] = [$other['start'], $other['end']];
        }
        $rhythm = $this->rule($random, $this->date);

        return $this->putNew($start, $end, $content, $rhythm, $this->until($random), self::split($random, $start, $end, $content));
    }

    /**
     * Une récurrence neuve sur le jour joué, de $start à $end, que la fenêtre ou un collage
     * écrivent en $changes. Refusée si elle tomberait sur le créneau d'une autre. Collée, elle
     * nomme la coupée dont elle vient ($follows) : au même rythme, elle en reprend les fois
     * sautées après ce jour, qui ne prennent pas son créneau.
     *
     * @param Content      $content
     * @param Rule         $rhythm
     * @param list<Change> $changes
     *
     * @return bool elle est créée
     */
    private function putNew(int $start, int $end, array $content, array $rhythm, ?string $until, array $changes, ?string $follows = null): bool
    {
        $rule = $rhythm + ['until' => $until];
        $candidate = ['content' => $content, 'start' => $start, 'end' => $end, 'rhythm' => $rhythm, 'until' => $until, 'firstDay' => $this->date, 'posed' => max($this->date, $this->today)];
        $request = ['PUT', '/recurrence', ['changes' => $changes, 'recurrence' => $rule, 'replaces' => null] + (null === $follows ? [] : ['follows' => $follows])];
        $carries = null !== $follows && $rhythm === $this->recurrences[$follows]['rhythm'];
        if ($this->refusedAsPastedElsewhere($follows, $until, $request, $this->date, $this->version)
            || $this->refusedAsTaken($candidate, $this->recurrences, $request, $this->date, $this->version, $carries ? $follows : null, $this->date)) {
            return false;
        }
        $before = $this->snapshot();

        [$status, $day] = $this->putRecurrence($this->version, $changes, $rule, date: $this->date, follows: $follows);

        self::assertSame(200, $status, json_encode([$changes, $rule, $day], \JSON_THROW_ON_ERROR));
        $id = self::stringAt($day, 'untils', 0, 'recurrence');
        self::assertArrayNotHasKey($id, $this->recurrences);
        self::assertSame([['recurrence' => $id, 'before' => $this->dayBefore(), 'after' => $rule['until']]], $day['untils']);
        $this->recurrences[$id] = $this->following($candidate, $follows);
        if ($carries) {
            $this->carrySkips($follows, $id);
        }
        $quarters = self::between($start, $end);
        // Le bloc n'en est une fois que si elle tombe ce jour-là.
        $this->changeModel(array_fill_keys($quarters, $content), $this->falls($id) ? array_fill_keys($quarters, $id) : []);
        $this->wrote($day, false);

        $this->record($before, $quarters);
        $this->last = $request;

        return true;
    }

    /**
     * Un geste sur un bloc qui revient, comme la fenêtre ou la grille le demandent : avec les
     * suivantes — le changer, l'arrêter, l'effacer, l'allonger ou le raccourcir, le couper puis
     * le coller ailleurs —, ou cette fois seulement — l'arrêter par un geste ordinaire, le même
     * contenu sans lien.
     *
     * @param Block $block
     */
    private function onRecurringBlock(Randomizer $random, array $block): void
    {
        match ($random->getInt(0, 5)) {
            0 => $this->changeRecurrence($random, $block),
            1 => $this->stopRecurrence($random, $block),
            2 => $this->eraseFollowing($block),
            3 => $this->resizeRecurrence($random, $block),
            4 => $this->cutAndPaste($random, $block),
            default => $this->stopOnce($random, $block),
        };
    }

    /**
     * « Enregistrer » dans la fenêtre d'un bloc qui revient, la case cochée, avec les
     * suivantes : sa fin seule changée la garde ; un contenu ou un rythme changés la coupent à
     * ce jour — l'ancienne finit la veille, retirée si c'est son premier —, et la nouvelle part
     * de ce jour, qu'elle a déjà traité : elle y est écrite, jamais prévue. Une fin repoussée,
     * ou la nouvelle, qui tomberaient sur le créneau d'une autre se refusent.
     *
     * @param Block $block
     * @param bool  $cut   un autre contenu au même rythme : elle se coupe, et la nouvelle reprend ses fois sautées
     */
    private function changeRecurrence(Randomizer $random, array $block, bool $cut = false): void
    {
        [$start, $end, $quarter] = $block;
        $id = (string) $quarter[3];
        $old = $this->recurrences[$id] ?? self::fail('Une récurrence que le modèle ne connaît pas.');
        $content = $cut ? $this->otherContent($old['content']) : (1 === $random->getInt(0, 1) ? $old['content'] : $this->content($random));
        $rhythm = $cut || 1 === $random->getInt(0, 1) ? $old['rhythm'] : $this->rule($random, $this->date);
        $until = 0 === $random->getInt(0, 2) ? $old['until'] : $this->until($random);
        $rule = $rhythm + ['until' => $until];
        $changes = self::split($random, $start, $end, $content);
        $request = ['PUT', '/recurrence', ['changes' => $changes, 'recurrence' => $rule, 'replaces' => $this->seenInModel($id)]];
        $inPlace = $content === $old['content'] && $rhythm === $old['rhythm'];
        $others = $this->recurrences;
        $ended = $old;
        if ($inPlace) {
            $ended['until'] = $until;
            $candidate = self::isLonger($until, $old['until']) ? $ended : null;
            unset($others[$id]);
            // Repoussée, elle garde ses fois sautées : elles ne prennent pas le créneau.
            $own = $id;
        } else {
            $ended['until'] = $this->dayBefore();
            $others[$id] = $ended;
            $candidate = ['content' => $content, 'start' => $old['start'], 'end' => $old['end'], 'rhythm' => $rhythm, 'until' => $until, 'firstDay' => $this->date, 'posed' => max($this->date, $this->today)];
            // Au même rythme, la nouvelle reprend les fois sautées de l'ancienne après ce jour :
            // elles ne prennent pas le créneau. Celles d'avant ne tombent pas dans sa période.
            $own = $rhythm === $old['rhythm'] ? $id : null;
        }
        // Sa fin repoussée, ou la nouvelle qui la remplace, ne vont pas au-delà d'un collage.
        if ($this->refusedAsMovedLonger($id, $until, $request)
            || (null !== $candidate && $this->refusedAsTaken($candidate, $others, $request, $this->date, $this->version, $own))) {
            return;
        }
        $before = $this->snapshot();
        $planned = $this->planned();
        $occurrence = $this->occurrenceOf($id);

        [$status, $day] = $this->putRecurrence($this->version, $changes, $rule, $id, $this->date);

        self::assertSame(200, $status, json_encode([$changes, $rule, $id, $day], \JSON_THROW_ON_ERROR));
        $quarters = self::between($start, $end);
        if ($inPlace) {
            self::assertSame($until === $old['until'] ? [] : [['recurrence' => $id, 'before' => $old['until'], 'after' => $until]], $day['untils']);
            if ($until !== $old['until']) {
                $this->endOn($id, $until);
            }
            $this->changeModel(array_fill_keys($quarters, $content), array_fill_keys($quarters, $id), false, $planned);
        } else {
            $new = self::stringAt($day, 'untils', 1, 'recurrence');
            self::assertArrayNotHasKey($new, $this->recurrences);
            self::assertSame([
                ['recurrence' => $id, 'before' => $old['until'], 'after' => $this->dayBefore()],
                ['recurrence' => $new, 'before' => $this->dayBefore(), 'after' => $until],
            ], $day['untils']);
            $this->endOn($id, $this->dayBefore());
            $this->recurrences[$new] = $this->replacing(['content' => $content, 'start' => $old['start'], 'end' => $old['end'], 'rhythm' => $rhythm, 'until' => $until, 'firstDay' => $this->date, 'posed' => max($this->date, $this->today)], $id);
            if ($rhythm === $old['rhythm']) {
                $this->carrySkips($id, $new);
            }
            // Les autres morceaux de cette fois suivent le bloc.
            $all = array_values(array_unique([...$quarters, ...$occurrence]));
            $this->changeModel(array_fill_keys($all, $content), $this->falls($new) ? array_fill_keys($all, $new) : [], false, $planned);
        }
        $this->wrote($day, false);

        $this->record($before, $quarters);
        $this->last = $request;
    }

    /**
     * Coupée au même rythme, ses fois sautées après ce jour, détachées ou retenues, sont aussi
     * celles de la nouvelle ; l'ancienne garde les siennes, qu'annuler lui rend.
     *
     * @return list<string> celles de la nouvelle, « identifiant date »
     */
    private function carrySkips(string $old, string $new, ?string $after = null): array
    {
        $carried = [];
        foreach ($this->otherSkips as $skip) {
            $parts = explode(' ', $skip, 2);
            if ($parts[0] === $old && substr($parts[1], 0, 10) > ($after ?? $this->date)) {
                $carried[] = $new.' '.$parts[1];
            }
        }
        array_push($this->otherSkips, ...$carried);

        return $carried;
    }

    /**
     * Allonger ou raccourcir un bloc qui revient, avec les suivantes : le même ticket et le même
     * commentaire collés juste au-dessus, au-dessous ou des deux côtés de sa plage, ou un de ses
     * bords effacé. Ses heures changent à partir de ce jour : elle se coupe comme pour un autre
     * contenu — l'ancienne finit la veille, retirée si c'est son premier —, et la nouvelle, au
     * même rythme et à la même fin, part de ce jour, qu'elle a déjà traité, et reprend les fois
     * sautées de l'ancienne. Ce qui restait de la fois suit le bloc ; le bord effacé se vide.
     * Allongée sur le créneau d'une autre, elle se refuse sans rien écrire.
     *
     * @param Block $block
     */
    private function resizeRecurrence(Randomizer $random, array $block): void
    {
        $id = (string) $block[2][3];
        $old = $this->recurrences[$id] ?? self::fail('Une récurrence que le modèle ne connaît pas.');
        [$changes, $start, $end] = $this->resizing($random, $old);
        $rule = $old['rhythm'] + ['until' => $old['until']];
        $request = ['PUT', '/recurrence', ['changes' => $changes, 'recurrence' => $rule, 'replaces' => $this->seenInModel($id)]];
        $others = $this->recurrences;
        $ended = $old;
        $ended['until'] = $this->dayBefore();
        $others[$id] = $ended;
        $candidate = ['content' => $old['content'], 'start' => $start, 'end' => $end, 'rhythm' => $old['rhythm'], 'until' => $old['until'], 'firstDay' => $this->date, 'posed' => max($this->date, $this->today)];
        if ($this->refusedAsTaken($candidate, $others, $request, $this->date, $this->version, $id)) {
            return;
        }
        $before = $this->snapshot();
        $planned = $this->planned();
        $occurrence = $this->occurrenceOf($id);

        [$status, $day] = $this->putRecurrence($this->version, $changes, $rule, $id, $this->date);

        self::assertSame(200, $status, json_encode([$changes, $rule, $id, $day], \JSON_THROW_ON_ERROR));
        $new = self::stringAt($day, 'untils', 1, 'recurrence');
        self::assertArrayNotHasKey($new, $this->recurrences);
        self::assertSame([
            ['recurrence' => $id, 'before' => $old['until'], 'after' => $this->dayBefore()],
            ['recurrence' => $new, 'before' => $this->dayBefore(), 'after' => $old['until']],
        ], $day['untils']);
        $this->endOn($id, $this->dayBefore());
        $this->recurrences[$new] = $this->replacing($candidate, $id);
        $this->carrySkips($id, $new);
        $contents = [];
        foreach ($changes as $change) {
            foreach (self::quartersOf($change) as $quarter) {
                $contents[self::minute($quarter)] = 'empty' === $change['kind'] ? null : $old['content'];
            }
        }
        // Les autres morceaux de cette fois suivent le bloc, reliés à la nouvelle.
        foreach ($occurrence as $minute) {
            if (!\array_key_exists($minute, $contents)) {
                $contents[$minute] = $old['content'];
            }
        }
        $kept = array_keys(array_filter($contents, static fn (?array $content): bool => null !== $content));
        $this->changeModel($contents, $this->falls($new) ? array_fill_keys($kept, $new) : [], false, $planned);
        $this->wrote($day, false);

        $this->record($before, self::touched($changes));
        $this->last = $request;
    }

    /**
     * Le geste qui allonge ou raccourcit une récurrence, et ses heures après lui : allongée d'un à
     * trois quarts d'heure au-dessus, au-dessous ou des deux côtés, par ce seul prolongement ou
     * par le bloc entier recollé ; raccourcie d'un de ses bords, sans jamais disparaître.
     *
     * @param Repeat $old
     *
     * @return array{list<Change>, int, int}
     */
    private function resizing(Randomizer $random, array $old): array
    {
        [$start, $end, $content] = [$old['start'], $old['end'], $old['content']];
        $side = $random->getInt(0, 3);
        $up = 1 === $side || 3 === $side || 420 === $start ? 0 : min($start - 420, 15 * $random->getInt(1, 3));
        $down = 0 === $side || 3 === $side || 1200 === $end ? 0 : min(1200 - $end, 15 * $random->getInt(1, 3));
        if (0 === $up && 0 === $down && $end - $start > 15) {
            $cut = 15 * $random->getInt(1, intdiv($end - $start, 15) - 1);

            return 0 === $random->getInt(0, 1)
                ? [[self::clear(self::clock($start), self::clock($start + $cut))], $start + $cut, $end]
                : [[self::clear(self::clock($end - $cut), self::clock($end))], $start, $end - $cut];
        }
        // Un seul quart d'heure, au bord de la grille : il ne se raccourcit pas, il s'allonge.
        if (0 === $up && 0 === $down && 420 === $start) {
            $down = 15;
        } elseif (0 === $up && 0 === $down) {
            $up = 15;
        }
        if (0 === $random->getInt(0, 2)) {
            return [self::split($random, $start - $up, $end + $down, $content), $start - $up, $end + $down];
        }
        $changes = [];
        if ($up > 0) {
            $changes[] = self::state(self::clock($start - $up), self::clock($start), [...$content, null]);
        }
        if ($down > 0) {
            $changes[] = self::state(self::clock($end), self::clock($end + $down), [...$content, null]);
        }

        return [$changes, $start - $up, $end + $down];
    }

    /**
     * Couper un bloc qui revient avec les suivantes, puis le coller ailleurs. Couper l'arrête à
     * partir de ce jour, comme effacer avec les suivantes ; coller crée une récurrence neuve, du
     * même contenu, de la même longueur et à la même fin, là où l'on colle : sur le jour joué à
     * une autre heure, au même rythme, ou un autre jour, au rythme que ce jour permet de la même
     * sorte — le jour du collage pour un seul jour de la semaine, son rang ou sa date pour un
     * rythme mensuel. Sur un créneau pris, coller se refuse, sans rien écrire.
     *
     * @param Block $block
     */
    private function cutAndPaste(Randomizer $random, array $block): void
    {
        $id = (string) $block[2][3];
        $old = $this->recurrences[$id] ?? self::fail('Une récurrence que le modèle ne connaît pas.');
        $this->eraseFollowing($block);
        $this->assertMatchesModel();

        $length = intdiv($old['end'] - $old['start'], 15);
        $start = self::minute($random->getInt(0, self::QUARTERS - $length));
        $end = $start + 15 * $length;
        $from = self::dayNumber(self::ELSEWHERE_FROM);
        $last = min(self::dayNumber(self::ELSEWHERE_TO), null === $old['until'] ? \PHP_INT_MAX : self::dayNumber($old['until']));
        // Le collage nomme la coupée : au même rythme, la nouvelle en reprend les fois sautées.
        if ($last < $from || 0 === $random->getInt(0, 1)) {
            $this->putNew($start, $end, $old['content'], $old['rhythm'], $old['until'], [self::state(self::clock($start), self::clock($end), [...$old['content'], null])], $id);

            return;
        }
        do {
            $day = $from + $random->getInt(0, $last - $from);
        } while (self::dayOf($day)[0] > 5);
        $date = self::dateOf($day);
        $this->createElsewhere($date, ['content' => $old['content'], 'start' => $start, 'end' => $end, 'rhythm' => self::pastedRhythm($old['rhythm'], $date), 'until' => $old['until'], 'firstDay' => $date, 'posed' => $date], $id);
    }

    /**
     * Le rythme d'une récurrence coupée, collée le jour $date : un seul jour de la semaine devient
     * le sien ; plusieurs restent ; un rythme mensuel prend le rang ou la date de ce jour — le
     * dernier s'il l'était et que ce jour l'est aussi.
     *
     * @param Rule $rhythm
     *
     * @return Rule
     */
    private static function pastedRhythm(array $rhythm, string $date): array
    {
        if ('weekly' === $rhythm['kind']) {
            return 1 === \count($rhythm['weekdays']) ? self::weeklyRule([self::dayOf(self::dayNumber($date))[0]], $rhythm['everyWeeks']) : $rhythm;
        }
        $rules = array_values(array_filter(self::monthlyRules($date), static fn (array $rule): bool => $rule['kind'] === $rhythm['kind']));
        foreach ($rules as $rule) {
            if (-1 === $rhythm['monthWeek'] && -1 === $rule['monthWeek']) {
                return $rule;
            }
        }

        return $rules[0] ?? self::fail('Un jour permet toujours un rythme mensuel de chaque sorte.');
    }

    /**
     * « Enregistrer » dans la fenêtre d'un bloc qui revient, la case décochée, avec les
     * suivantes : la récurrence s'arrête la veille — retirée si c'est son premier jour —, la
     * fois garde son contenu, écrite sans lien, et rien n'y est sauté : elle ne va plus
     * jusqu'à ce jour.
     *
     * @param Block $block
     */
    private function stopRecurrence(Randomizer $random, array $block): void
    {
        [$start, $end, $quarter] = $block;
        $id = (string) $quarter[3];
        $old = $this->recurrences[$id] ?? self::fail('Une récurrence que le modèle ne connaît pas.');
        $content = 0 === $random->getInt(0, 2) ? $this->content($random) : [$quarter[0], $quarter[1], $quarter[2]];
        $changes = self::split($random, $start, $end, $content);
        $before = $this->snapshot();
        $planned = $this->planned();
        $shown = $this->shown();
        $occurrence = $this->occurrenceOf($id);

        [$status, $day] = $this->putRecurrence($this->version, $changes, null, $id, $this->date);

        self::assertSame(200, $status, json_encode([$changes, $id, $day], \JSON_THROW_ON_ERROR));
        self::assertSame([['recurrence' => $id, 'before' => $old['until'], 'after' => $this->dayBefore()]], $day['untils']);
        $this->endOn($id, $this->dayBefore());
        $quarters = self::between($start, $end);
        $contents = array_fill_keys($quarters, $content);
        foreach ($occurrence as $minute) {
            $contents[$minute] ??= [$shown[$minute][0], $shown[$minute][1], $shown[$minute][2]];
        }
        $this->changeModel($contents, [], false, $planned);
        unset($this->skips[$id]);
        $this->wrote($day, false);

        $this->record($before, $quarters);
        $this->last = ['PUT', '/recurrence', ['changes' => $changes, 'recurrence' => null, 'replaces' => ['id' => $id, 'weekdays' => $old['rhythm']['weekdays'], 'until' => $old['until']]]];
    }

    /**
     * La corbeille de la fenêtre d'un bloc qui revient, avec les suivantes : comme la page,
     * toute la fois s'efface — ses morceaux écrits ou prévus —, la récurrence s'arrête la
     * veille, et rien n'y est sauté. Un jour jamais saisi ne naît pas.
     *
     * @param Block $block
     */
    private function eraseFollowing(array $block): void
    {
        $id = (string) $block[2][3];
        $old = $this->recurrences[$id] ?? self::fail('Une récurrence que le modèle ne connaît pas.');
        $occurrence = $this->occurrenceOf($id);
        $changes = array_map(static fn (array $run): array => self::clear(self::clock($run[0]), self::clock($run[1])), self::runs($occurrence));
        $before = $this->snapshot();
        $planned = $this->planned();

        [$status, $day] = $this->putRecurrence($this->version, $changes, null, $id, $this->date);

        self::assertSame(200, $status, json_encode([$changes, $id, $day], \JSON_THROW_ON_ERROR));
        self::assertSame([['recurrence' => $id, 'before' => $old['until'], 'after' => $this->dayBefore()]], $day['untils']);
        $this->endOn($id, $this->dayBefore());
        $this->changeModel(array_fill_keys($occurrence, null), [], false, $planned);
        unset($this->skips[$id]);
        $this->wrote($day, false);

        $this->record($before, $occurrence);
        $this->last = ['PUT', '/recurrence', ['changes' => $changes, 'recurrence' => null, 'replaces' => ['id' => $id, 'weekdays' => $old['rhythm']['weekdays'], 'until' => $old['until']]]];
    }

    /**
     * La case décochée, cette fois seulement : un geste ordinaire, le contenu du bloc — ou un
     * autre, changé dans la fenêtre — sans lien. La fois se détache, la récurrence continue.
     *
     * @param Block $block
     */
    private function stopOnce(Randomizer $random, array $block): void
    {
        [$start, $end, $quarter] = $block;
        $content = 0 === $random->getInt(0, 2) ? $this->content($random) : [$quarter[0], $quarter[1], $quarter[2]];
        $changes = [self::state(self::clock($start), self::clock($end), [...$content, null])];
        $before = $this->snapshot();
        $gesture = ['changes' => $changes, 'recurrences' => []];

        $this->patch($gesture);

        $this->record($before, self::touched($changes));
        $this->last = ['PATCH', '/slots', $gesture];
    }

    /**
     * Un bloc qui revient, effacé tout entier, puis annulé, puis rétabli, coup sur coup : une
     * récurrence plus récente qui le recouvre se montre à sa place, la lui rend, puis la
     * reprend. Annuler ramène exactement la journée d'avant, rétablir celle d'après.
     */
    private function eraseUndoRedo(Randomizer $random): void
    {
        $linked = $this->linkedBlocks();
        [$start, $end] = $linked[$random->getInt(0, \count($linked) - 1)];
        $changes = [self::clear(self::clock($start), self::clock($end))];
        $before = $this->snapshot();

        $this->patch(['changes' => $changes, 'recurrences' => []]);
        $this->record($before, self::touched($changes));
        $after = $this->snapshot();
        $this->assertMatchesModel();

        $this->undo();
        self::assertSame($before, $this->snapshot(), 'Annuler l\'effacement rend la journée d\'avant.');
        $this->assertMatchesModel();

        $this->redo();
        self::assertSame($after, $this->snapshot(), 'Rétablir l\'effacement le refait.');
        $this->last = ['PATCH', '/slots', ['changes' => $changes, 'recurrences' => []]];
    }

    /**
     * Un geste rangé pendant le 0h00 d'un jour à venir — rien n'y est prévu — ne se rejoue pas à
     * l'identique une fois revenu à un objectif, où ses récurrences se prévoient de nouveau, ni
     * l'inverse : l'historique n'est plus exact.
     *
     * @param Step $step
     */
    private function replays(array $step): void
    {
        if ($step['off'] !== $this->offAhead()) {
            $this->outside = true;
        }
    }

    /**
     * Rétablir un geste dont l'annulation a rendu des fois à leur série sans les écrire : la page
     * les nomme, et elles sont de nouveau détachées.
     *
     * @param Gesture      $redo
     * @param list<string> $detaches
     *
     * @return Gesture
     */
    private static function detaching(array $redo, array $detaches): array
    {
        return [] === $detaches ? $redo : $redo + ['detaches' => $detaches];
    }

    /** Un jour à venir mis à 0h00 : rien n'y est prévu. */
    private function offAhead(): bool
    {
        return $this->ahead() && 0 === $this->objective;
    }

    /**
     * Ctrl+Z : le dernier geste fait, défait, récurrences reliées et fins rendues comprises.
     * Refusé quand il ramènerait une récurrence sur un créneau qu'une autre a pris depuis :
     * rien ne change, et le geste reste à annuler.
     */
    private function undo(): void
    {
        $step = array_pop($this->done) ?? self::fail('Rien à annuler.');
        if (!$this->patch($step['undo'], true)) {
            $this->done[] = $step;

            return;
        }
        $this->replays($step);
        $step['redo'] = self::detaching(self::withoutDetaches($step['redo']), $this->returned);

        $this->undone[] = $step;
        $this->last = ['PATCH', '/slots', $step['undo']];
    }

    /** Ctrl+Maj+Z : le dernier geste défait, refait ; refusé de même. */
    private function redo(): void
    {
        $step = array_pop($this->undone) ?? self::fail('Rien à rétablir.');
        if (!$this->patch($step['redo'])) {
            $this->undone[] = $step;

            return;
        }
        $this->replays($step);
        $step['redo'] = self::withoutDetaches($step['redo']);

        $this->done[] = $step;
        $this->last = ['PATCH', '/slots', $step['redo']];
    }

    /**
     * Rétablir nomme une fois que la journée ne peut plus détacher de nouveau : revenue à un
     * objectif, elle la porte ou la prévoit ; ou la série ne tombe plus ce jour-là sans que le
     * geste ait changé sa fin. Refusé, rien ne s'écrit.
     *
     * @param Gesture $gesture
     */
    private function detachTakes(array $gesture): bool
    {
        $rewound = array_column($gesture['recurrences'], 'recurrence');
        foreach ($gesture['detaches'] ?? [] as $id) {
            if (0 !== $this->objective || [] !== $this->quartersLinkedTo($id) || (!\in_array($id, $rewound, true) && !$this->falls($id))) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param Gesture $gesture
     *
     * @return Gesture
     */
    private static function withoutDetaches(array $gesture): array
    {
        return ['changes' => $gesture['changes'], 'recurrences' => $gesture['recurrences']];
    }

    /**
     * Un geste de la grille, que la page envoie par PATCH : joué contre l'API, puis sur le
     * modèle. Annuler dit qu'il rend une journée d'avant ($restores), rétablir jamais.
     *
     * Une fin rendue qui mènerait sa récurrence sur le créneau d'une autre après aujourd'hui
     * fait refuser le geste, comme des créneaux changés ailleurs : rien ne s'écrit.
     *
     * @param Gesture $gesture
     *
     * @return bool le geste est passé
     */
    private function patch(array $gesture, bool $restores = false): bool
    {
        $body = ['version' => $this->version, 'changes' => $gesture['changes'], 'recurrences' => $gesture['recurrences']];
        $body = $restores ? $body + ['restores' => true] : $body;
        $body = isset($gesture['detaches']) ? $body + ['detaches' => $gesture['detaches']] : $body;
        $this->returned = [];
        $moved = $this->movedRefusal($gesture['recurrences']);
        if (null !== $moved) {
            $writes = $this->writes();
            $stored = $this->storedRecurrences();
            [$status, $answer] = $this->send('PATCH', '/api/days/'.$this->date.'/slots', $body);
            self::assertSame(422, $status, json_encode([$gesture, $restores, $answer], \JSON_THROW_ON_ERROR));
            self::assertSame([['field' => 'recurrences', 'message' => $moved]], self::at($answer, 'violations'));
            self::assertSame($writes, $this->writes(), 'Rien ne s\'écrit.');
            self::assertSame($stored, $this->storedRecurrences(), 'Aucune fin ne change.');

            return false;
        }
        if ($this->rewindTakes($gesture['recurrences']) || $this->relinkTakes($gesture) || $this->detachTakes($gesture)) {
            $writes = $this->writes();
            $stored = $this->storedRecurrences();
            [$status, $answer] = $this->send('PATCH', '/api/days/'.$this->date.'/slots', $body);
            self::assertSame(409, $status, json_encode([$gesture, $restores, $answer], \JSON_THROW_ON_ERROR));
            self::assertSame('stale', self::at($answer, 'error'));
            self::assertSame($writes, $this->writes(), 'Rien ne s\'écrit.');
            self::assertSame($stored, $this->storedRecurrences(), 'Aucune fin ne change.');
            self::assertSame($this->version, self::at($answer, 'day', 'version'));

            return false;
        }
        [$status, $day] = $this->send('PATCH', '/api/days/'.$this->date.'/slots', $body);
        self::assertSame(200, $status, json_encode([$gesture, $restores, $day], \JSON_THROW_ON_ERROR));

        // Ce que le jour prévoyait avant le geste, que les fins rendues ne changent qu'ensuite.
        $planned = $this->planned();
        foreach ($gesture['recurrences'] as $rewind) {
            self::assertArrayHasKey($rewind['recurrence'], $this->recurrences);
            $this->endOn($rewind['recurrence'], $rewind['to']);
        }

        $contents = [];
        $links = [];
        foreach ($gesture['changes'] as $change) {
            foreach (self::quartersOf($change) as $quarter) {
                $minute = self::minute($quarter);
                $contents[$minute] = 'empty' === $change['kind'] ? null : [(string) $change['kind'], $change['ticket'] ?? null, $change['comment'] ?? null];
                if (isset($change['recurrence'])) {
                    $links[$minute] = $change['recurrence'];
                }
            }
        }
        // Mis à 0h00, le jour ne reprend aucune fois : un quart d'heure qu'annuler ou rétablir
        // relie reste vide, et sa récurrence retient la fois, comme si le 0h00 l'avait retirée —
        // sauf une récurrence qui y a encore ses quarts d'heure. Rétablir détache de nouveau ce
        // qu'annuler a ainsi rendu (detaches).
        $kept = $links;
        $returned = [];
        if (0 === $this->objective) {
            foreach ($links as $minute => $id) {
                if ([] === $this->quartersLinkedTo($id)) {
                    $contents[$minute] = null;
                    $returned[$id] = true;
                    unset($kept[$minute]);
                }
            }
        }
        $this->changeModel($contents, $kept, $restores, $planned);
        foreach (array_keys($returned) as $id) {
            $this->skips[$id] = true;
        }
        $this->returned = array_map('strval', array_keys($returned));
        // Rétablir qui relie ne ramène pas non plus ce qu'il posait : seul ce qu'annuler rend se
        // refait exactement, par detaches.
        if ([] !== $returned && !$restores) {
            $this->outside = true;
        }
        foreach ($gesture['detaches'] ?? [] as $id) {
            if ($this->falls($id)) {
                $this->skips[$id] = false;
            } else {
                unset($this->skips[$id]);
            }
        }
        // Une fin rendue qui l'arrête avant ce jour, sans qu'aucun quart d'heure ne soit relié —
        // rétablir un effacement ou un arrêt avec les suivantes, annuler une création — n'y
        // laisse pas de saut, comme le geste d'origine. Rétablir une coupe garde le sien.
        if ([] === $links) {
            foreach ($gesture['recurrences'] as $rewind) {
                if (!$this->reaches($rewind['recurrence'])) {
                    unset($this->skips[$rewind['recurrence']]);
                }
            }
        }

        // Effacer, ou rendre une fois à sa prévision, sur un jour jamais saisi ne le crée pas ;
        // une fin rendue, si. Ce que rend le geste est ce que la grille affichera : il doit
        // déjà être juste.
        $this->wrote($day, [] !== $gesture['recurrences']);

        return true;
    }

    /**
     * Le modèle d'un geste, écrit ici sans le code de l'application : chaque quart d'heure
     * nommé prend son contenu, posé par la récurrence que $links lui donne ou à la main.
     *
     * Un quart d'heure pris à sa récurrence — écrit lié ou prévu — détache toute la fois de
     * ce jour : ses autres quarts d'heure, écrits ou prévus, s'écrivent sans son lien, et rien
     * ne la repose ni ne la prévoit plus quand il ne lui reste rien. Sauf un quart d'heure
     * seulement prévu, que le geste rend à une récurrence qui l'y prévoit encore et passe
     * avant elle — la plus ancienne —, ou qu'annuler ($restores) réécrit : la fois prévue lui
     * cède, sans se détacher. Relier un
     * quart d'heure à sa récurrence la lui rend : un jour à venir où elle l'y prévoit encore
     * n'y écrit rien, la fois redevient prévue.
     *
     * Ce qui était prévu se lit avant le geste ($planned) ; les fins qu'il change, déjà
     * changées, disent qui le prévoit encore.
     *
     * @param array<int, ?Content> $contents
     * @param array<int, string>   $links
     * @param ?array<int, string>  $planned  les fois prévues avant le geste, si ses fins ont déjà changé dans le modèle
     */
    private function changeModel(array $contents, array $links, bool $restores = false, ?array $planned = null): void
    {
        $planned ??= $this->planned();
        $detached = [];
        foreach ($contents as $minute => $content) {
            $link = $links[$minute] ?? null;
            $saved = $this->model[$minute][3] ?? null;
            $before = $saved ?? $planned[$minute] ?? null;
            if (null === $before || $link === $before) {
                continue;
            }
            $yields = null === $saved && ($restores && null !== $content || null !== $link && $this->plans($link) && strcmp($link, $before) < 0);
            if (!$yields) {
                $detached[$before] = true;
            }
            // Reprise à une récurrence que le geste retire — une coupe annulée —, la fois ne
            // se montre plus nulle part : rien n'est inexact.
            if ($restores && null !== $saved && $this->ahead() && $this->falls($saved)) {
                $this->reclaimed = true;
            }
        }
        $occurrences = $planned;
        foreach ($this->model as $minute => $quarter) {
            if (null !== $quarter[3]) {
                $occurrences[$minute] = $quarter[3];
            }
        }
        foreach ($occurrences as $minute => $id) {
            if (isset($detached[$id]) && !\array_key_exists($minute, $contents)) {
                $contents[$minute] = $this->recurrences[$id]['content'];
            }
        }
        $written = $links;
        foreach ($links as $minute => $id) {
            if (($this->model[$minute][3] ?? null) !== $id && $this->plans($id)) {
                $contents[$minute] = null;
                unset($written[$minute]);
            }
        }
        if ($this->ahead() && [] !== $written) {
            $this->linkedWritten = true;
        }

        foreach ($contents as $minute => $content) {
            if (null === $content) {
                unset($this->model[$minute]);
            } else {
                $this->model[$minute] = [$content[0], $content[1], $content[2], $written[$minute] ?? null];
            }
        }
        ksort($this->model);

        foreach (array_keys($detached) as $recurrence) {
            if ([] === $this->quartersLinkedTo($recurrence)) {
                $this->skips[$recurrence] ??= false;
            }
        }
        foreach ($links as $recurrence) {
            unset($this->skips[$recurrence]);
        }
    }

    /**
     * Une écriture passée : la ligne du jour avance d'une version, ou naît si l'écriture
     * crée le jour ou y laisse une saisie, et l'onglet tient la version rendue.
     *
     * @param array<mixed> $day
     */
    private function wrote(array $day, bool $creates): void
    {
        if (0 !== $this->rowVersion) {
            ++$this->rowVersion;
        } elseif ($creates || [] !== $this->model) {
            $this->rowVersion = 1;
        }
        $this->reopenIfEmptied();
        $this->read($day);
    }

    /**
     * Un envoi qui n'a plus rien à dire s'oublie ; un jour à venir qu'il fermait, et qu'aucun ne
     * ferme plus, redevient un jour comme un autre (SendClosure::reopen) : ce que l'envoi y
     * avait posé et que sa récurrence y attend encore redevient prévu ; ce qu'une récurrence
     * arrêtée avant lui y avait posé reste, sans lien. Puis une récurrence qui voudrait le
     * créneau d'une autre y cède sa fois : celle dont le bloc y était écrit garde le sien, sinon la
     * plus ancienne. La veut celle qui y tombe et dont la fois n'y est pas effacée, ou effacée par
     * le geste même qui le rouvre — annuler la ramène.
     */
    private function reopenIfEmptied(): void
    {
        $was = $this->wasClosed;
        if (!$this->closes()) {
            $this->sendKept = false;
        }
        if ($was && !$this->closes() && $this->ahead()) {
            // Celles dont un bloc y est écrit, avant que ce que l'envoi y a posé redevienne prévu, ou
            // avant le geste qui le rouvre.
            $before = array_values(array_unique([...$this->linkedIds(), ...$this->linkedBefore]));
            $earlier = $this->linkedBefore;
            foreach ($this->model as $minute => $quarter) {
                $id = $quarter[3];
                if (null === $id || $this->treated($id)) {
                    continue;
                }
                if (0 !== $this->objective && $this->falls($id) && !\array_key_exists($id, $this->skips)) {
                    unset($this->model[$minute]);
                } else {
                    $this->model[$minute] = [$quarter[0], $quarter[1], $quarter[2], null];
                }
            }
            $written = static fn (string $id): bool => \in_array($id, $before, true);
            $wanting = array_values(array_filter(
                array_map('strval', array_keys($this->recurrences)),
                fn (string $id): bool => $this->falls($id) && (\in_array($id, $earlier, true) || false !== ($this->skips[$id] ?? null)),
            ));
            usort($wanting, static fn (string $a, string $b): int => [!$written($a), $a] <=> [!$written($b), $b]);
            $kept = [];
            foreach ($wanting as $id) {
                $own = $this->recurrences[$id];
                $disputed = [] !== array_filter($kept, fn (string $other): bool => $own['start'] < $this->recurrences[$other]['end'] && $this->recurrences[$other]['start'] < $own['end']);
                if ($disputed && !$written($id)) {
                    $this->skips[$id] = false;
                } else {
                    $kept[] = $id;
                }
            }
        }
        $this->wasClosed = $this->closes();
        $this->linkedBefore = $this->linkedIds();
    }

    /**
     * Les récurrences qui ont un bloc sur le jour joué, chacune une fois.
     *
     * @return list<string>
     */
    private function linkedIds(): array
    {
        return array_values(array_unique(array_filter(array_map(static fn (array $quarter): ?string => $quarter[3], $this->model), static fn (?string $id): bool => null !== $id)));
    }

    /**
     * Un envoi du jour joué en reste, qui a encore quelque chose à dire : le jour a des tickets,
     * ou Jira des heures de lui (DaySendRepository::closesToRecurrences).
     */
    private function closes(): bool
    {
        return $this->sendKept && ($this->inJira || [] !== array_filter($this->model, static fn (array $quarter): bool => 'work' === $quarter[0]));
    }

    /**
     * La journée rendue par l'API : l'onglet en tient la version, et elle doit être celle du
     * modèle.
     *
     * @param array<mixed> $day
     */
    private function read(array $day): void
    {
        $this->version = self::intAt($day, 'version');
        $this->seen[] = $this->version;
        $this->assertDay($day);
    }

    /**
     * Range un geste réussi : ce qui le rétablit et ce qui l'annule. Rétablir se vide.
     *
     * @param Snapshot  $before
     * @param list<int> $touched les quarts d'heure qu'il nomme, par leur début
     */
    private function record(array $before, array $touched): void
    {
        $after = $this->snapshot();
        $this->done[] = ['redo' => $this->leading($before, $after, $touched), 'undo' => $this->leading($after, $before, $touched), 'off' => $this->offAhead()];
        $this->undone = [];
    }

    /**
     * Le geste qui mène d'un état de la journée à un autre, quart d'heure par quart d'heure :
     * chacun qui change, ou que le geste d'origine nomme, et la fin de chaque récurrence qui
     * change. Une récurrence absente d'un état n'existait pas encore : elle y est retirée, la
     * veille de son premier jour. Chaque quart d'heure se rend comme la page le voit : une fois
     * prévue reliée à sa récurrence, une fois d'une récurrence arrêtée avant ce jour sans lien.
     *
     * @param Snapshot  $from
     * @param Snapshot  $to
     * @param list<int> $touched
     *
     * @return Gesture
     */
    private function leading(array $from, array $to, array $touched): array
    {
        [$fromModel, $fromUntils] = $from;
        [$toModel, $toUntils] = $to;

        $minutes = array_unique([...array_keys($fromModel), ...array_keys($toModel), ...$touched]);
        sort($minutes);
        $changes = [];
        foreach ($minutes as $minute) {
            $target = $toModel[$minute] ?? null;
            if (($fromModel[$minute] ?? null) === $target && !\in_array($minute, $touched, true)) {
                continue;
            }
            $start = self::clock($minute);
            $end = self::clock($minute + 15);
            $changes[] = null === $target ? self::clear($start, $end) : self::state($start, $end, $target);
        }

        $rewinds = [];
        foreach (array_keys($fromUntils + $toUntils) as $id) {
            $was = \array_key_exists($id, $fromUntils) ? $fromUntils[$id] : $this->withdrawn($id);
            $becomes = \array_key_exists($id, $toUntils) ? $toUntils[$id] : $this->withdrawn($id);
            if ($was !== $becomes) {
                $rewinds[] = ['recurrence' => $id, 'from' => $was, 'to' => $becomes];
            }
        }

        return ['changes' => $changes, 'recurrences' => $rewinds];
    }

    /**
     * L'objectif du jour, hors de l'historique. Mis à 0h00, le jour perd les blocs que ses
     * récurrences y ont posés, et chacune les retient ; revenu à un objectif, il retrouve ce
     * qu'elles retenaient : prévu de nouveau un jour à venir, reposé sur les quarts d'heure
     * libres sinon.
     */
    private function changeObjective(int $objective): void
    {
        $shown = $this->shown();
        $planned = $this->planned();

        [$status, $day] = $this->putObjective($this->version, $objective, $this->date);

        self::assertSame(200, $status, json_encode([$objective, $day], \JSON_THROW_ON_ERROR));
        $wasOff = 0 === $this->objective;
        $this->objective = $objective;
        if (!$wasOff && 0 === $objective) {
            $this->hold($planned);
        } elseif ($wasOff && 0 !== $objective) {
            $this->release();
        }
        $this->wrote($day, true);
        if ($shown !== $this->shown()) {
            $this->outside = true;
        }
    }

    /**
     * Mis à 0h00 : chaque saisie liée à une récurrence qui va jusqu'à ce jour s'efface, et la
     * récurrence retient sa fois, si rien ne la détachait déjà ; chaque récurrence prévue ce
     * jour-là la retient de même, pour la rendre si le jour vient avant le retour à un objectif.
     *
     * @param array<int, string> $planned les fois prévues avant le passage à 0h00
     */
    private function hold(array $planned): void
    {
        $held = array_fill_keys($planned, true);
        foreach ($this->model as $minute => $quarter) {
            if (null !== $quarter[3] && $this->reaches($quarter[3])) {
                unset($this->model[$minute]);
                $held[$quarter[3]] = true;
            }
        }
        foreach (array_keys($held) as $id) {
            $this->skips[$id] ??= true;
        }
    }

    /**
     * Revenu à un objectif : chaque fois retenue est rendue. Celle qui tombe encore ce jour-là
     * est prévue de nouveau un jour à venir, sinon reposée, la plus ancienne d'abord, sur les
     * quarts d'heure libres.
     */
    private function release(): void
    {
        $released = array_keys(array_filter($this->skips, static fn (bool $held): bool => $held));
        sort($released, \SORT_STRING);
        foreach ($released as $id) {
            unset($this->skips[$id]);
        }
        foreach ($released as $id) {
            if (!$this->falls($id) || $this->plans($id)) {
                continue;
            }
            $recurrence = $this->recurrences[$id];
            foreach (self::between($recurrence['start'], $recurrence['end']) as $minute) {
                $this->model[$minute] ??= [...$recurrence['content'], $id];
            }
        }
        ksort($this->model);
    }

    /** Un tiers des changements met le jour à 0h00 ; mis à 0h00, il en revient le plus souvent. */
    private function objectiveFor(Randomizer $random): int
    {
        if (0 === $this->objective) {
            return 0 === $random->getInt(0, 1) ? 450 : 15 * $random->getInt(0, 52);
        }

        return 0 === $random->getInt(0, 2) ? 0 : 15 * $random->getInt(1, 52);
    }

    /**
     * « Envoyer sur Jira » : un jour à venir y reçoit ses fois prévues pour de bon, liées, et
     * ce qui part est exactement ce qu'il montre. Jira en panne, rien n'y part, mais l'envoi
     * garde ce qu'il a posé : le jour reste fermé tant qu'il a des tickets.
     */
    private function sendDay(bool $down = false): void
    {
        $shown = $this->shown();
        $planned = $this->planned();
        $before = $this->worklogs();

        if ($down) {
            $this->simulate('panne', ['panne' => true]);
        }
        [$status, $day] = $this->send('POST', '/api/days/'.$this->date.'/send', ['version' => $this->version]);
        if ($down) {
            $this->simulate('panne', ['panne' => false]);
        }

        self::assertSame(200, $status, json_encode($day, \JSON_THROW_ON_ERROR));
        self::assertSame($down ? 'failed' : 'sent', self::at($day, 'send', 'state'));
        foreach ($planned as $minute => $id) {
            $this->model[$minute] = [...$this->recurrences[$id]['content'], $id];
        }
        ksort($this->model);
        $this->settled = true;
        $this->sendKept = true;
        $this->inJira = $this->inJira || !$down;
        if ([] === $planned) {
            $this->wasClosed = $this->closes();
            $this->linkedBefore = $this->linkedIds();
            $this->read($day);
        } else {
            $this->linkedWritten = true;
            $this->wrote($day, true);
        }
        self::assertSame($shown, $this->shown(), 'L\'envoi ne change rien à ce que la journée montre.');
        self::assertSame($down ? $before : $this->expectedWorklogs(), $this->worklogs(), 'Jira a reçu ce que la journée montre, ticket par ticket, ou rien en panne.');
    }

    /**
     * Vidé de ses tickets, un jour dont Jira a encore des heures se renvoie vide : Jira se vide,
     * son envoi n'a plus rien à dire, et il redevient un jour comme un autre — ce que l'envoi y
     * avait posé redevient prévu.
     */
    private function resendEmpty(): void
    {
        [$status, $day] = $this->send('POST', '/api/days/'.$this->date.'/send', ['version' => $this->version]);

        self::assertSame(200, $status, json_encode($day, \JSON_THROW_ON_ERROR));
        self::assertSame([], $this->worklogs(), 'Jira n\'a plus rien du jour joué.');
        $this->inJira = false;
        $before = $this->model;
        $this->reopenIfEmptied();
        // Rouvert, il avance d'une version s'il a rendu ce que l'envoi avait posé.
        if ($before !== $this->model) {
            ++$this->rowVersion;
        }
        $this->read($day);
        self::assertSame([] === array_filter($this->shown(), static fn (array $quarter): bool => 'work' === $quarter[0]) ? 'nothing' : 'unsent', self::at($day, 'send', 'state'));
    }

    /**
     * Un autre onglet, depuis un autre jour, rend à une récurrence qui a écrit ici une fin
     * d'avant ce jour — il annule le geste qui l'avait repoussée — : ce qu'elle y avait posé
     * n'en est plus une fois. La page le voit sans flèche, fondu avec ses voisins au même
     * contenu, le lien restant en base. Hors de l'historique du jour joué. Sans rien d'écrit
     * par une récurrence, un jour à venir est d'abord envoyé, s'il a du travail ; aujourd'hui,
     * une récurrence y naît d'abord.
     *
     * @return bool une récurrence a été arrêtée
     */
    private function endElsewhere(Randomizer $random): bool
    {
        if ([] === $this->writtenLinks()) {
            if (!$this->ahead()) {
                $this->createRecurrence($random);
                $this->assertMatchesModel();
            } elseif ($this->hasWork()) {
                $this->sendDay();
                $this->assertMatchesModel();
            }
        }
        $ids = $this->writtenLinks();
        if ([] === $ids) {
            return false;
        }
        $id = $ids[$random->getInt(0, \count($ids) - 1)];
        $to = max($this->dayBefore(), $this->withdrawn($id));
        // Un lundi passé, qui n'est ni le jour joué ni ceux qu'on vérifie ensuite.
        $other = '2026-10-05';

        [$status, $answer] = $this->patchSlotsWith(self::intAt($this->day($other), 'version'), [], [['recurrence' => $id, 'from' => $this->recurrences[$id]['until'], 'to' => $to]], $other);

        self::assertSame(200, $status, json_encode($answer, \JSON_THROW_ON_ERROR));
        $this->endOn($id, $to);
        // Ses fois prévues ici, s'il en restait, ne le sont plus : la version le dit.
        $this->read($this->day($this->date));
        $this->assertMatchesModel();

        return true;
    }

    /**
     * Quelques gestes après coup, dont certains sur ce qu'une récurrence arrêtée avait posé :
     * ils y passent comme sur une saisie ordinaire, et le reste de ce qu'elle avait posé suit,
     * sans changer à l'écran.
     */
    private function touchEnded(Randomizer $random): void
    {
        for ($step = $random->getInt(1, 4); $step > 0; --$step) {
            $ended = array_keys(array_filter($this->shown(), fn (array $quarter): bool => null !== $quarter[3] && !$this->reaches($quarter[3])));
            $linked = $this->linkedBlocks();
            $roll = $random->getInt(0, 3);
            if ($roll <= 1 && [] !== $ended) {
                $minute = $ended[$random->getInt(0, \count($ended) - 1)];
                $pick = $random->getInt(0, \count(self::CONTENTS));
                $change = \count(self::CONTENTS) === $pick ? self::clear(self::clock($minute), self::clock($minute + 15)) : self::state(self::clock($minute), self::clock($minute + 15), [...self::CONTENTS[$pick], null]);
                $before = $this->snapshot();
                $this->patch(['changes' => [$change], 'recurrences' => []]);
                $this->record($before, [$minute]);
            } elseif (2 === $roll && [] !== $linked) {
                $this->onRecurringBlock($random, $linked[$random->getInt(0, \count($linked) - 1)]);
            } else {
                $this->gesture($random);
            }
            $this->assertMatchesModel();
        }
    }

    /**
     * Les récurrences qui ont écrit un quart d'heure du jour joué, et y vont encore.
     *
     * @return list<string>
     */
    private function writtenLinks(): array
    {
        $ids = [];
        foreach ($this->model as $quarter) {
            if (null !== $quarter[3] && $this->reaches($quarter[3])) {
                $ids[$quarter[3]] = $quarter[3];
            }
        }

        return array_values($ids);
    }

    /**
     * Un onglet en retard, qui croit à une récurrence que la journée n'a plus, ou dont la
     * fenêtre a vu une récurrence que l'autre onglet a changée depuis.
     */
    private function refusedAsStale(Randomizer $random): void
    {
        $stale = $this->version - $random->getInt(1, $this->version);
        $any = array_key_first($this->recurrences);
        $unlinked = array_values(array_filter(array_keys($this->recurrences), fn (string $id): bool => [] === $this->quartersLinkedTo($id)));
        $replaced = [] === $unlinked ? self::UNKNOWN : $unlinked[$random->getInt(0, \count($unlinked) - 1)];
        $linked = $this->linkedBlocks();

        [$method, $path, $body, $version] = match ([] === $linked ? $random->getInt(0, 3) : $random->getInt(0, 4)) {
            0 => ['PATCH', '/slots', ['changes' => $this->randomChanges($random)], $stale],
            1 => ['PUT', '/recurrence', ['changes' => [self::work('10:00', '10:15', 'SHOP-482')], 'recurrence' => self::weekly(), 'replaces' => null], $stale],
            // Annuler une fin qu'un autre onglet a changée depuis.
            2 => null === $any
                ? ['PATCH', '/slots', ['changes' => $this->randomChanges($random), 'recurrences' => [['recurrence' => self::UNKNOWN, 'from' => null, 'to' => null]]], $this->version]
                : ['PATCH', '/slots', ['changes' => $this->randomChanges($random), 'recurrences' => [['recurrence' => $any, 'from' => null === $this->recurrences[$any]['until'] ? '2026-12-31' : null, 'to' => null]]], $this->version],
            // La fenêtre d'un bloc dont la récurrence a disparu de ce jour.
            3 => ['PUT', '/recurrence', ['changes' => [self::work('10:00', '10:15', 'SHOP-482')], 'recurrence' => self::weekly(), 'replaces' => $this->seenInModel($replaced)], $this->version],
            // La fenêtre d'un bloc qui revient, ouverte avant qu'un autre onglet change sa fin.
            default => $this->seenBeforeChange($linked[$random->getInt(0, \count($linked) - 1)]),
        };

        [$status, $answer] = $this->send($method, '/api/days/'.$this->date.$path, $body + ['version' => $version]);
        self::assertSame(409, $status, \sprintf('%s %s en version %d, la journée en %d : %s', $method, $path, $version, $this->version, json_encode([$body, $answer], \JSON_THROW_ON_ERROR)));
    }

    /**
     * Un onglet resté sur une version lue avant un autre geste : quoi qu'il écrive — un geste,
     * l'objectif, l'envoi —, il reçoit le refus, relit la journée telle qu'elle est, et rien
     * ne s'écrit.
     */
    private function refusedAsLate(Randomizer $random): void
    {
        $older = $this->older();
        $late = $older[$random->getInt(0, \count($older) - 1)];
        [$method, $path, $body] = match ($random->getInt(0, 2)) {
            0 => ['PATCH', '/slots', ['changes' => $this->randomChanges($random)]],
            1 => ['PUT', '/objective', ['objective' => 15 * $random->getInt(0, 52)]],
            default => ['POST', '/send', []],
        };

        [$status, $answer] = $this->send($method, '/api/days/'.$this->date.$path, $body + ['version' => $late]);

        self::assertSame(409, $status, \sprintf('%s %s en version %d, la journée en %d : %s', $method, $path, $late, $this->version, json_encode([$body, $answer], \JSON_THROW_ON_ERROR)));
        self::assertSame('stale', self::at($answer, 'error'));
        self::assertSame($this->version, self::at($answer, 'day', 'version'), 'L\'onglet relit la journée telle qu\'elle est.');
        self::assertSame(self::expectedBlocks($this->view()), self::listAt($answer, 'day', 'blocks'));
    }

    /**
     * Les versions que l'onglet a tenues et que la journée n'a plus.
     *
     * @return list<int>
     */
    private function older(): array
    {
        return array_values(array_filter(array_unique($this->seen), fn (int $version): bool => $version !== $this->version));
    }

    /**
     * @param array{string, string, array<string, mixed>} $request
     */
    private function refusedAsSentTwice(array $request): void
    {
        [$method, $path, $body] = $request;
        [$status] = $this->send($method, '/api/days/'.$this->date.$path, $body + ['version' => $this->version - 1]);
        self::assertSame(409, $status, \sprintf('Version %d acceptée alors que la journée est en %d.', $this->version - 1, $this->version));
    }

    /**
     * @param array{string, string, array<string, mixed>} $request
     */
    private function refusedAsInvalid(array $request): void
    {
        [$method, $path, $body] = $request;
        [$status, $answer] = $this->send($method, '/api/days/'.$this->date.$path, $body + ['version' => $this->version]);
        self::assertSame(422, $status, json_encode([$method, $body, $answer], \JSON_THROW_ON_ERROR));
    }

    /**
     * Une requête qu'aucun écran n'envoie : hors de la grille, hors du quart d'heure, qui se
     * chevauche elle-même, dont un ticket n'existe pas dans Jira, une récurrence de deux
     * plages ou sans jour, à un rythme que le jour du bloc ne permet pas, aux heures changées
     * autrement qu'en l'allongeant ou en la raccourcissant d'un bord, ou un quart d'heure relié
     * à une récurrence qui ne l'a pas posé.
     *
     * @return array{string, string, array<string, mixed>}
     */
    private function hostile(Randomizer $random): array
    {
        $patch = static fn (array $changes): array => ['PATCH', '/slots', ['changes' => $changes]];
        $put = static fn (array $changes, ?array $rule = null): array => ['PUT', '/recurrence', ['changes' => $changes, 'recurrence' => $rule ?? self::weekly(), 'replaces' => null]];
        $ids = array_keys($this->recurrences);
        $any = [] === $ids ? null : $ids[$random->getInt(0, \count($ids) - 1)];
        $linked = $this->linkedBlocks();

        $date = new \DateTimeImmutable($this->date);
        $weekday = (int) $date->format('N');

        return match ($random->getInt(0, 20)) {
            // Un rythme que le jour ne permet pas, ou de travers.
            17 => $put([self::work('10:00', '10:15', 'SHOP-482')], self::monthlyWeekday($weekday, -1)),
            18 => $put([self::work('10:00', '10:15', 'SHOP-482')], self::monthlyDate((int) $date->format('j') + 1)),
            19 => $put([self::work('10:00', '10:15', 'SHOP-482')], self::everyWeeks(5, [$weekday])),
            20 => $put([self::work('10:00', '10:15', 'SHOP-482')], self::monthlyWeekday($weekday, (intdiv((int) $date->format('j') - 1, 7) + 1) % 4 + 1)),
            0 => $patch([self::work('06:45', '07:15', 'SHOP-482')]),
            1 => $patch([self::work('19:45', '20:15', 'OPS-7')]),
            2 => $patch([self::work('10:05', '10:30', 'SHOP-482')]),
            3 => $patch([self::pause('12:00', '13:00'), self::work('12:45', '13:15', 'OPS-7')]),
            4 => $patch([self::work('10:00', '10:15', 'SHOP-999')]),
            5 => $patch([self::work('09:00', '09:30', 'SHOP-482'), self::clear('10:00', '10:30'), self::work('11:00', '11:15', 'SHOP-999', 'Revue')]),
            6 => $patch([self::clear('09:00', '10:00'), self::work('10:00', '10:15', 'SHOP-0')]),
            7 => $put([self::work('10:00', '10:15', 'SHOP-482'), self::work('10:15', '10:30', 'OPS-7')]),
            8 => $put([self::work('10:00', '10:15', 'SHOP-482'), self::work('10:30', '10:45', 'SHOP-482')]),
            9 => $put([self::work('10:00', '10:15', 'SHOP-482')], ['weekdays' => [], 'until' => null]),
            10 => $put([self::pause('12:00', '13:00')], ['weekdays' => [2, 6], 'until' => null]),
            11 => $put([self::pause('12:00', '13:00')], ['weekdays' => [2], 'until' => self::WITHDRAWN]),
            12 => $put([self::linked(self::work('10:00', '10:15', 'SHOP-482'), $any ?? self::UNKNOWN)]),
            13 => $put([self::work('10:00', '10:15', 'SHOP-999')]),
            14 => null === $any
                ? $patch([self::linked(self::work('10:00', '10:15', 'SHOP-482'), self::UNKNOWN)])
                : $patch([self::state(self::clock($this->recurrences[$any]['start']), self::clock($this->recurrences[$any]['start'] + 15), [...$this->otherContent($this->recurrences[$any]['content']), $any])]),
            15 => null === $any
                ? $patch([self::linked(self::work('10:00', '10:15', 'SHOP-482'), 'daily')])
                : $patch([$this->outsideOf($any)]),
            default => [] === $linked
                ? $put([self::work('10:00', '10:15', 'SHOP-482')], ['weekdays' => [0], 'until' => null])
                : $this->reshaped($random, $linked[$random->getInt(0, \count($linked) - 1)]),
        };
    }

    /**
     * Un quart d'heure relié à sa récurrence, à son contenu, mais hors de sa plage.
     *
     * @return Change
     */
    private function outsideOf(string $id): array
    {
        $recurrence = $this->recurrences[$id] ?? self::fail('Une récurrence que le modèle ne connaît pas.');
        $minute = $recurrence['start'] > 420 ? $recurrence['start'] - 15 : ($recurrence['end'] < 1200 ? $recurrence['end'] : null);
        if (null === $minute) {
            // Toute la grille : hors de sa plage n'existe pas, un autre contenu, si.
            return self::state('07:00', '07:15', [...$this->otherContent($recurrence['content']), $id]);
        }

        return self::state(self::clock($minute), self::clock($minute + 15), [...$recurrence['content'], $id]);
    }

    /**
     * La fenêtre d'un bloc qui revient, qui en change les heures autrement qu'en l'allongeant ou
     * en la raccourcissant d'un bord : un autre contenu juste à côté de sa plage, le même après
     * un trou, un effacement au milieu, ou tout effacé, la case cochée.
     *
     * @param Block $block
     *
     * @return array{string, string, array<string, mixed>}
     */
    private function reshaped(Randomizer $random, array $block): array
    {
        $id = (string) $block[2][3];
        $recurrence = $this->recurrences[$id] ?? self::fail('Une récurrence que le modèle ne connaît pas.');
        [$start, $end, $content] = [$recurrence['start'], $recurrence['end'], $recurrence['content']];
        $beside = $end < 1200 ? $end : ($start > 420 ? $start - 15 : null);
        $gap = $end <= 1170 ? $end + 15 : ($start >= 450 ? $start - 30 : null);
        $changes = match ($random->getInt(0, 3)) {
            0 => null === $beside ? null : [self::state(self::clock($beside), self::clock($beside + 15), [...$this->otherContent($content), null])],
            1 => null === $gap ? null : [self::state(self::clock($gap), self::clock($gap + 15), [...$content, null])],
            2 => $end - $start < 45 ? null : [self::clear(self::clock($start + 15), self::clock($start + 30))],
            default => null,
        };

        return ['PUT', '/recurrence', ['changes' => $changes ?? [self::clear(self::clock($start), self::clock($end))], 'recurrence' => $recurrence['rhythm'] + ['until' => $recurrence['until']], 'replaces' => $this->seenInModel($id)]];
    }

    /**
     * Une récurrence telle qu'une fenêtre ouverte maintenant la voit : celle du modèle.
     *
     * @return array{id: string, weekdays: list<int>, until: ?string}
     */
    private function seenInModel(string $id): array
    {
        $recurrence = $this->recurrences[$id] ?? null;

        return ['id' => $id, 'weekdays' => $recurrence['rhythm']['weekdays'] ?? [1, 2, 3, 4, 5], 'until' => $recurrence['until'] ?? null];
    }

    /**
     * La fenêtre d'un bloc qui revient, qui en change la fin, ouverte avant qu'un autre onglet
     * la change : ce qu'elle en a vu n'est plus vrai, la journée n'ayant pas bougé.
     *
     * @param Block $block
     *
     * @return array{string, string, array<string, mixed>, int}
     */
    private function seenBeforeChange(array $block): array
    {
        [$start, $end, $quarter] = $block;
        $id = (string) $quarter[3];
        $seen = $this->seenInModel($id);
        $other = '2026-12-31' === $seen['until'] ? null : '2026-12-31';
        $rhythm = $this->recurrences[$id]['rhythm'] ?? self::fail('Une récurrence que le modèle ne connaît pas.');

        return ['PUT', '/recurrence', ['changes' => [self::state(self::clock($start), self::clock($end), [$quarter[0], $quarter[1], $quarter[2], null])], 'recurrence' => $rhythm + ['until' => '2026-11-30'], 'replaces' => ['until' => $other] + $seen], $this->version];
    }

    /**
     * La base, puis la journée lue, sont celles du modèle ; et la lire n'écrit rien.
     */
    private function assertMatchesModel(): void
    {
        $expectedRows = [];
        $expectedLinks = [];
        foreach ($this->model as $start => [$kind, $ticket, $comment, $recurrence]) {
            $expectedRows[] = ['start' => $start, 'kind' => $kind, 'ticket' => $ticket, 'comment' => $comment];
            $expectedLinks[$start] = $recurrence;
        }
        self::assertSame($expectedRows, $this->rows($this->date), 'La base tient exactement un créneau par quart d\'heure écrit.');
        self::assertSame($expectedLinks, $this->links($this->date), 'Chaque quart d\'heure garde la récurrence qui l\'a posé, et aucune autre.');

        $untils = $this->untils();
        ksort($untils);
        self::assertSame($untils, $this->storedUntils(), 'La fin de chaque récurrence est celle du modèle.');
        self::assertSame($this->expectedSkips(), $this->storedSkips(), 'Les fois détachées, et celles que le 0h00 retient, sont celles du modèle.');

        $writes = $this->writes();
        $day = $this->day($this->date);
        self::assertSame($writes, $this->writes(), 'Lire la journée n\'écrit rien.');
        self::assertSame($this->version, $day['version'], 'Relue sans changement, la journée garde sa version.');
        $this->assertDay($day);
        $this->assertNeverTwice();
    }

    /**
     * Ce que la base garde, tous jours confondus : aucun quart d'heure écrit deux fois, et
     * aucune paire de récurrences qui se croise après aujourd'hui (RecurrenceClash).
     */
    private function assertNeverTwice(): void
    {
        self::assertSame([], $this->connection()->fetchAllAssociative('SELECT day_id, start FROM slot GROUP BY day_id, start HAVING COUNT(*) > 1'), 'Un quart d\'heure écrit deux fois.');

        $today = UserCalendar::date($this->today) ?? self::fail('Aujourd\'hui n\'est pas une date.');
        $recurrences = [];
        // Une fois détachée ou effacée ne prend pas le créneau ; un 0h00 garde le sien.
        $stored = [];
        foreach ($this->storedSkips() as $skip) {
            $parts = explode(' ', $skip);
            if (2 === \count($parts) && $parts[1] > $this->today) {
                $stored[$parts[0]][] = $parts[1];
            }
        }
        // Un jour à venir qu'un envoi ferme ne reçoit plus rien d'aucune : il a des tickets, ou
        // Jira des heures de lui.
        $closed = array_map(static fn (mixed $date): string => \is_string($date) ? $date : self::fail('Un jour illisible.'), $this->connection()->fetchFirstColumn(
            "SELECT DISTINCT day.date FROM day_send JOIN day ON day.id = day_send.day_id WHERE day.date > ? AND (day_send.touched <> '[]' OR EXISTS (SELECT 1 FROM slot WHERE slot.day_id = day.id AND slot.ticket IS NOT NULL)) ORDER BY day.date",
            [$this->today],
        ));
        $skipped = [];
        foreach ($this->connection()->fetchAllAssociative('SELECT * FROM recurrence ORDER BY id') as $row) {
            self::assertIsString($row['id']);
            self::assertIsString($row['weekdays']);
            self::assertIsString($row['first_day']);
            self::assertTrue(null === $row['until'] || \is_string($row['until']));
            /** @var list<int> $weekdays */
            $weekdays = json_decode($row['weekdays'], true, flags: \JSON_THROW_ON_ERROR);
            $rhythm = match ($row['rhythm_kind']) {
                'weekly' => Rhythm::weekly($weekdays, self::number($row['every_weeks'])),
                'monthly_weekday' => Rhythm::monthlyWeekday($weekdays[0] ?? 0, self::number($row['month_week'])),
                default => Rhythm::monthlyDate(self::number($row['month_day'])),
            };
            $content = \is_string($row['ticket']) ? SlotContent::work($row['ticket'], \is_string($row['comment']) ? $row['comment'] : null) : SlotContent::pause();
            $first = UserCalendar::date($row['first_day']) ?? self::fail('Premier jour illisible.');
            $id = Uuid::fromBinary($row['id'])->toRfc4122();
            $dates = $stored[$id] ?? [];
            $key = $id.' '.($row['until'] ?? '…').' '.implode(',', $dates);
            $recurrences[$key] = new Recurrence($content, self::number($row['start']), self::number($row['end']), $rhythm, $first, null === $row['until'] ? null : UserCalendar::date($row['until']), $first);
            $skipped[$recurrences[$key]->id->toRfc4122()] = $dates;
        }
        foreach ($recurrences as $one => $a) {
            foreach ($recurrences as $other => $b) {
                $pair = $one.' '.$other.' '.$this->today;
                if ($one >= $other || isset($this->freePairs[$pair])) {
                    continue;
                }
                self::assertNull(RecurrenceClash::first($a, $b, $today, $skipped, $closed), 'Deux récurrences de la base se croisent : '.$pair);
                $this->freePairs[$pair] = true;
            }
        }
    }

    /**
     * @param array<mixed> $day
     */
    private function assertDay(array $day): void
    {
        $version = self::intAt($day, 'version');
        self::assertSame($this->rowVersion, $version & 0xFFFFFFFF, 'La version porte celle de la ligne du jour.');
        $ended = [] !== array_filter($this->model, fn (array $quarter): bool => null !== $quarter[3] && !$this->reaches($quarter[3]));
        self::assertSame([] === $this->planned() && !$ended, $version === $this->rowVersion, 'Sans fois prévue ni flèche partie, la version est celle de la ligne ; sinon, elle dit aussi ce qu\'elle prévoit et les flèches qu\'elle ne montre plus.');
        self::assertSame($this->objective, $day['objective']);
        self::assertSame(0 === $this->objective, $day['declaredOff']);
        self::assertSame($this->recurrencesHeld(), $day['recurrencesHeld']);

        $shown = $this->view();
        $blocks = self::listAt($day, 'blocks');
        self::assertSame(self::expectedBlocks($shown), $blocks, 'Les blocs rendus sont les saisies de la base et les fois prévues, sans le lien des récurrences arrêtées avant ce jour.');

        $views = self::arrayAt($day, 'recurrences');
        ksort($views);
        self::assertSame($this->expectedViews(), $views, 'La journée décrit les récurrences de ses blocs, et elles seules.');
        $ongoing = self::arrayAt($day, 'ongoing');
        ksort($ongoing);
        self::assertSame($this->expectedOngoing(), $ongoing, 'Et toutes celles qui prennent encore un créneau, de ce jour ou d\'après.');

        $worked = 0;
        $previousEnd = 0;
        foreach ($blocks as $block) {
            $start = self::minuteOf(self::stringAt($block, 'start'));
            $end = self::minuteOf(self::stringAt($block, 'end'));
            self::assertGreaterThanOrEqual($previousEnd, $start, 'Deux blocs se chevauchent.');
            $previousEnd = $end;
            if ('work' === $block['kind']) {
                $worked += $end - $start;
            }
        }

        $workQuarters = \count(array_filter($shown, static fn (array $quarter): bool => 'work' === $quarter[0]));
        self::assertSame(15 * $workQuarters, $worked);
        self::assertSame([
            'worked' => $worked,
            'remaining' => max(0, $this->objective - $worked),
            'balance' => $worked - $this->objective,
        ], array_intersect_key(self::arrayAt($day, 'figures'), ['worked' => 0, 'remaining' => 0, 'balance' => 0]));
    }

    /**
     * Le lendemain venu, chaque récurrence qui y tombe s'y pose, la plus ancienne d'abord,
     * sur les quarts d'heure que les précédentes ont laissés libres.
     */
    private function assertTomorrow(): void
    {
        $this->advanceClock(self::TOMORROW);

        $expected = [];
        $ids = array_map('strval', array_keys($this->recurrences));
        sort($ids, \SORT_STRING);
        foreach ($ids as $id) {
            $recurrence = $this->recurrences[$id];
            if (!self::fallsOn($recurrence, self::TOMORROW)) {
                continue;
            }
            foreach (self::between($recurrence['start'], $recurrence['end']) as $minute) {
                $expected[$minute] ??= [...$recurrence['content'], $id];
            }
        }
        ksort($expected);

        $day = $this->day(self::TOMORROW);
        self::assertSame(self::expectedBlocks($expected), self::listAt($day, 'blocks'), 'Le lendemain reçoit ce que ses récurrences y posent, sur les quarts d\'heure libres.');
        self::assertSame(array_map(static fn (array $quarter): string => $quarter[3], $expected), $this->links(self::TOMORROW));
        self::assertSame([] === $expected ? 0 : 1, $day['version']);
        self::assertSame(self::expectedBlocks($this->view()), self::listAt($this->day($this->date), 'blocks'), 'Hier ne reçoit rien de plus.');
    }

    /**
     * Le jeudi venu, ses fois prévues s'écrivent, liées : il montre exactement ce qu'il
     * prévoyait, et l'onglet resté sur la veille reçoit le refus. Une fois sur trois, il est
     * d'abord mis à 0h00 — un congé posé d'avance — : le jour venu n'y pose rien, et le congé
     * annulé rend ce que ses récurrences y retenaient, posé sur les quarts d'heure libres.
     */
    private function assertComingDay(Randomizer $random): void
    {
        if (0 !== $this->objective && 0 === $random->getInt(0, 2)) {
            $this->changeObjective(0);
            $this->assertMatchesModel();
        }
        $shown = $this->shown();
        $planned = $this->planned();
        $late = $this->version;

        $this->advanceClock(self::THURSDAY);
        $this->model = $shown;
        $expected = self::expectedBlocks($this->view());
        $day = $this->day($this->date);

        self::assertSame($expected, self::listAt($day, 'blocks'), 'Le jour venu montre exactement ce qu\'il prévoyait.');
        if ([] !== $planned) {
            $this->wrote($day, true);
        } else {
            $this->read($day);
        }
        $this->assertMatchesModel();

        if ([] === $planned) {
            self::assertSame($late, $this->version, 'Rien de prévu, rien de posé : la journée garde sa version.');
        } else {
            [$status, $body] = $this->patchSlots($late, [self::work('19:45', '20:00', 'OPS-7')], $this->date);
            self::assertSame(409, $status, 'L\'onglet resté sur la veille les a vues prévues : posées, la journée a changé.');
            self::assertSame($expected, self::listAt($body, 'day', 'blocks'));
        }

        if (0 === $this->objective) {
            $this->changeObjective(0 === $random->getInt(0, 1) ? 450 : 15 * $random->getInt(1, 52));
            $this->assertMatchesModel();
        }
    }

    /**
     * Le jeudi venu, le vendredi est encore à venir, et neuf : un congé y est posé d'avance —
     * ses fois prévues se retiennent —, le vendredi vient sans rien y poser, puis le congé est
     * annulé : ce que ses récurrences y retenaient s'y pose, sur les quarts d'heure libres.
     */
    private function assertLeaveCancelledOnComingDay(Randomizer $random): void
    {
        $this->date = self::FRIDAY;
        $this->model = [];
        $this->settled = false;
        $this->sendKept = false;
        $this->inJira = false;
        $this->wasClosed = false;
        $this->linkedBefore = [];
        $this->skips = [];
        $this->otherSkips = $this->storedSkips();
        $this->rowVersion = 0;
        $this->objective = 450;
        $this->seen = [];
        $this->read($this->day($this->date));
        $this->assertMatchesModel();

        $this->changeObjective(0);
        $this->assertMatchesModel();

        $this->advanceClock(self::FRIDAY);
        $this->read($this->day($this->date));
        $this->assertMatchesModel();

        $this->changeObjective(0 === $random->getInt(0, 1) ? 450 : 15 * $random->getInt(1, 52));
        $this->assertMatchesModel();
    }

    /** Fermé à 0h00, vide, et une récurrence y tombe : la journée le dit. */
    private function recurrencesHeld(): bool
    {
        if (0 !== $this->objective || [] !== $this->shown()) {
            return false;
        }
        foreach (array_keys($this->recurrences) as $id) {
            if ($this->falls($id)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Ce que la journée dit de chaque récurrence de ses blocs, par son identifiant.
     *
     * @return array<string, array<string, mixed>>
     */
    private function expectedViews(): array
    {
        $views = [];
        foreach ($this->view() as $quarter) {
            $id = $quarter[3];
            if (null === $id || isset($views[$id])) {
                continue;
            }
            $views[$id] = $this->viewOf($id);
        }
        ksort($views);

        return $views;
    }

    /**
     * Celles qui prennent encore un créneau, de ce jour ou d'après : sans fin, ou finies ni
     * avant ce jour, ni aujourd'hui ou avant, ni retirées.
     *
     * @return array<string, array<string, mixed>>
     */
    private function expectedOngoing(): array
    {
        $views = [];
        foreach ($this->recurrences as $id => $recurrence) {
            $until = $recurrence['until'];
            if (null === $until || ($until > $this->today && $until >= $recurrence['firstDay'])) {
                $views[$id] = $this->viewOf($id);
            }
        }
        ksort($views);

        return $views;
    }

    /**
     * Une récurrence telle que l'API la rend.
     *
     * @return array<string, mixed>
     */
    private function viewOf(string $id): array
    {
        $recurrence = $this->recurrences[$id] ?? self::fail('Une récurrence que le modèle ne connaît pas.');
        [$kind, $ticket, $comment] = $recurrence['content'];

        return [
            'start' => self::clock($recurrence['start']),
            'end' => self::clock($recurrence['end']),
            ...$recurrence['rhythm'],
            'firstDay' => $recurrence['firstDay'],
            'until' => $recurrence['until'],
            'slot' => ['kind' => $kind, 'ticket' => $ticket, 'comment' => $comment],
            'skipped' => array_keys($this->skippedOf($id)),
        ];
    }

    /**
     * Les fois prévues du jour joué, par quart d'heure : la récurrence de chacun. Aucune un
     * jour déjà venu ou envoyé, ni mis à 0h00. Sinon, chaque récurrence qui y tombe, qui ne l'a pas
     * déjà traité, sans fois détachée ni retenue, la plus ancienne d'abord, sur les quarts
     * d'heure que ni les saisies ni les précédentes n'ont pris.
     *
     * @return array<int, string>
     */
    private function planned(): array
    {
        if (!$this->ahead() || 0 === $this->objective || $this->closes()) {
            return [];
        }
        $ids = array_map('strval', array_keys($this->recurrences));
        sort($ids, \SORT_STRING);
        $planned = [];
        foreach ($ids as $id) {
            if (!$this->falls($id) || $this->treated($id) || \array_key_exists($id, $this->skips)) {
                continue;
            }
            foreach (self::between($this->recurrences[$id]['start'], $this->recurrences[$id]['end']) as $minute) {
                if (!isset($this->model[$minute]) && !isset($planned[$minute])) {
                    $planned[$minute] = $id;
                }
            }
        }
        ksort($planned);

        return $planned;
    }

    /**
     * Ce que la journée montre : ses saisies, et ses fois prévues, reliées à leur récurrence.
     *
     * @return array<int, Quarter>
     */
    private function shown(): array
    {
        $shown = $this->model;
        foreach ($this->planned() as $minute => $id) {
            $shown[$minute] = [...$this->recurrences[$id]['content'], $id];
        }
        ksort($shown);

        return $shown;
    }

    /**
     * Ce que la page voit : ce que la journée montre, sans le lien des récurrences arrêtées ou
     * retirées avant ce jour, qui n'y ont plus de fois.
     *
     * @return array<int, Quarter>
     */
    private function view(): array
    {
        $view = [];
        foreach ($this->shown() as $minute => $quarter) {
            $view[$minute] = null === $quarter[3] || $this->reaches($quarter[3]) ? $quarter : [$quarter[0], $quarter[1], $quarter[2], null];
        }

        return $view;
    }

    /**
     * Un autre onglet, sur un jour à venir après tous ceux qu'on joue : il y crée une
     * récurrence, à un rythme que ce jour permet — le dernier vendredi du mois, parfois —,
     * souvent sur le créneau d'une que l'historique a arrêtée et voudrait rendre, chaque jour
     * de la semaine — et Ctrl+Z, ou Ctrl+Maj+Z, qui la rendrait, est refusé. Elle-même est
     * refusée si elle en croise une autre. Ou il retire une de celles qu'il a créées. Rien ne
     * tombe sur les jours joués : seule la recherche des conflits la voit.
     */
    private function elsewhere(Randomizer $random, bool $taking = false): void
    {
        if (!$taking && [] !== $this->elsewhere && 0 === $random->getInt(0, 3)) {
            $ids = array_keys($this->elsewhere);
            $this->withdrawElsewhere($ids[$random->getInt(0, \count($ids) - 1)]);

            return;
        }
        $from = self::dayNumber(self::ELSEWHERE_FROM);
        do {
            $day = $from + $random->getInt(0, self::dayNumber(self::ELSEWHERE_TO) - $from);
        } while (self::dayOf($day)[0] > 5);
        $date = self::dateOf($day);
        $ids = array_map('strval', array_keys($this->recurrences));
        $ended = array_values(array_filter($ids, fn (string $id): bool => !$this->reaches($id)));
        $pool = [] !== $ended && 0 !== $random->getInt(0, 2) ? $ended : $ids;
        if ([] !== $pool && 0 !== $random->getInt(0, 3)) {
            $other = $this->recurrences[$pool[$random->getInt(0, \count($pool) - 1)]];
            [$start, $end] = [$other['start'], $other['end']];
        } else {
            $first = $random->getInt(0, self::QUARTERS - 1);
            [$start, $end] = [self::minute($first), self::minute($first + min($random->getInt(1, 6), self::QUARTERS - $first))];
        }
        $content = $this->content($random);
        $rhythm = $this->rule($random, $date);
        $monthly = self::monthlyRules($date);
        if (\count($monthly) > 2 || -1 === $monthly[0]['monthWeek']) {
            // Le dernier de ce jour de la semaine dans le mois : une fois sur deux, c'est lui.
            $rhythm = 0 === $random->getInt(0, 1) ? $monthly[\count($monthly) - 2] : $rhythm;
        }
        $until = 0 === $random->getInt(0, 2) ? self::dateOf($day + $random->getInt(0, 60)) : null;
        // Le geste que l'historique referait en premier rendrait une fin : son créneau, ses
        // jours de la semaine — ou chaque jour ouvré —, pour que la rendre tombe sur un créneau pris.
        $returned = $taking || 0 !== $random->getInt(0, 2) ? $this->returned() : null;
        if (null !== $returned) {
            $taken = $this->recurrences[$returned[0]];
            [$start, $end] = [$taken['start'], $taken['end']];
            $rhythm = self::weeklyRule('weekly' === $taken['rhythm']['kind'] ? $taken['rhythm']['weekdays'] : [1, 2, 3, 4, 5]);
            $until = null;
        }
        if (!$this->createElsewhere($date, ['content' => $content, 'start' => $start, 'end' => $end, 'rhythm' => $rhythm, 'until' => $until, 'firstDay' => $date, 'posed' => $date])) {
            return;
        }
        if (null !== $returned) {
            $this->assertMatchesModel();
            'undo' === $returned[1] ? $this->undo() : $this->redo();
        }
    }

    /**
     * L'autre onglet crée $candidate le jour $date, d'un bloc écrit dans la fenêtre ou collé :
     * refusée si elle tomberait sur le créneau d'une autre. Rien ne tombe sur les jours joués.
     * Collée, elle nomme la coupée dont elle vient ($follows) : au même rythme, elle en reprend
     * les fois sautées après $date, et celle de $date, que le collage pose, non.
     *
     * @param Repeat $candidate
     *
     * @return bool elle est créée
     */
    private function createElsewhere(string $date, array $candidate, ?string $follows = null): bool
    {
        $rule = $candidate['rhythm'] + ['until' => $candidate['until']];
        $changes = [self::state(self::clock($candidate['start']), self::clock($candidate['end']), [...$candidate['content'], null])];
        $version = self::intAt($this->day($date), 'version');
        $request = ['PUT', '/recurrence', ['changes' => $changes, 'recurrence' => $rule, 'replaces' => null] + (null === $follows ? [] : ['follows' => $follows])];
        $carries = null !== $follows && $candidate['rhythm'] === $this->recurrences[$follows]['rhythm'];
        if ($this->refusedAsPastedElsewhere($follows, $candidate['until'], $request, $date, $version)
            || $this->refusedAsTaken($candidate, $this->recurrences, $request, $date, $version, $carries ? $follows : null, $date)) {
            return false;
        }

        $day = $this->saveRecurrence($version, $changes, $rule, null, $date, $follows);

        $id = self::stringAt($day, 'untils', 0, 'recurrence');
        self::assertArrayNotHasKey($id, $this->recurrences);
        $this->recurrences[$id] = $this->following($candidate, $follows);
        $this->elsewhere[$id] = $date;
        $carried = $carries ? $this->carrySkips($follows, $id, $date) : [];
        $this->syncOtherSkips();
        self::assertSame($carried, array_values(array_filter($this->otherSkips, static fn (string $skip): bool => str_starts_with($skip, $id.' '))), 'Collée, elle reprend les fois sautées de la coupée après ce jour, et elles seules.');

        return true;
    }

    /**
     * Un autre onglet efface, cette fois seulement, une fois prévue d'une récurrence, un jour à
     * venir après ceux qu'on joue : elle n'y prend plus son créneau. Une fois sur deux, il y crée
     * aussitôt une récurrence qui ne tombe que ce jour-là, sur ce créneau libéré. Couper ensuite
     * la première au même rythme, depuis le jour joué, lui garde cette fois effacée : la nouvelle
     * ne revient pas ce jour-là, et ne croise pas l'autre.
     */
    private function eraseElsewhere(Randomizer $random): void
    {
        $ids = array_map('strval', array_keys($this->recurrences));
        if ([] === $ids) {
            return;
        }
        $id = $ids[$random->getInt(0, \count($ids) - 1)];
        $from = self::dayNumber(self::ELSEWHERE_FROM);
        $falling = array_values(array_filter(
            range($from, self::dayNumber(self::ELSEWHERE_TO)),
            fn (int $day): bool => self::dayOf($day)[0] <= 5 && self::fallsOn($this->recurrences[$id], self::dateOf($day)),
        ));
        if ([] === $falling) {
            return;
        }
        $date = self::dateOf($falling[$random->getInt(0, \count($falling) - 1)]);
        $shown = $this->day($date);
        $changes = [];
        foreach (self::listAt($shown, 'blocks') as $block) {
            if ($id === self::at($block, 'recurrence')) {
                $changes[] = self::clear(self::stringAt($block, 'start'), self::stringAt($block, 'end'));
            }
        }
        if ([] === $changes) {
            // Elle n'y montre rien : déjà effacée, ou cachée par une autre.
            return;
        }

        $this->write(self::intAt($shown, 'version'), $changes, $date);

        $this->syncOtherSkips();
        self::assertContains($id.' '.$date, $this->otherSkips, 'Effacée en entier, la fois est sautée.');
        $this->assertMatchesModel();
        if (0 === $random->getInt(0, 1)) {
            $this->cutOnPlayedDay($random, $id);

            return;
        }
        $taken = $this->recurrences[$id];
        $rhythm = self::weeklyRule([self::dayOf(self::dayNumber($date))[0]]);
        $content = $this->content($random);
        $candidate = ['content' => $content, 'start' => $taken['start'], 'end' => $taken['end'], 'rhythm' => $rhythm, 'until' => $date, 'firstDay' => $date, 'posed' => $date];
        $changes = [self::state(self::clock($taken['start']), self::clock($taken['end']), [...$content, null])];
        $version = self::intAt($this->day($date), 'version');
        $request = ['PUT', '/recurrence', ['changes' => $changes, 'recurrence' => $rhythm + ['until' => $date], 'replaces' => null]];
        if ($this->refusedAsTaken($candidate, $this->recurrences, $request, $date, $version)) {
            return;
        }

        $day = $this->saveRecurrence($version, $changes, $rhythm + ['until' => $date], null, $date);

        $created = self::stringAt($day, 'untils', 0, 'recurrence');
        self::assertArrayNotHasKey($created, $this->recurrences);
        $this->recurrences[$created] = $candidate;
        $this->elsewhere[$created] = $date;
        $this->syncOtherSkips();
        $this->assertMatchesModel();
        $this->cutOnPlayedDay($random, $id);
    }

    /**
     * Le plus souvent, la page coupe aussitôt cette récurrence sur le jour joué, s'il en porte
     * un bloc : un autre contenu, au même rythme, avec les suivantes ; ou parfois elle la coupe
     * avec les suivantes et la colle ailleurs, ce jour-là ou un autre — au même rythme, la
     * collée reprend la fois effacée, si elle vient après le jour du collage.
     */
    private function cutOnPlayedDay(Randomizer $random, string $id): void
    {
        $blocks = array_values(array_filter($this->linkedBlocks(), static fn (array $block): bool => $id === $block[2][3]));
        if ([] !== $blocks && 0 !== $random->getInt(0, 2)) {
            $block = $blocks[$random->getInt(0, \count($blocks) - 1)];
            if (0 === $random->getInt(0, 3)) {
                $this->cutAndPaste($random, $block);
            } else {
                $this->changeRecurrence($random, $block, true);
            }
            $this->assertMatchesModel();
        }
    }

    /**
     * Le jour à venir joué, une de ses fois effacée ou détachée cette fois seulement : un autre
     * onglet, la veille, crée une récurrence qui ne tombe que ce jour-là, sur ce créneau que le
     * saut a libéré. La page relit la journée, où elle se montre ; Ctrl+Z, qui y ramènerait la
     * fois effacée, est refusé sans rien écrire. Puis l'autre onglet annule sa création : la
     * journée redevient celle d'avant, que l'historique sait défaire.
     */
    private function takenOnceElsewhere(Randomizer $random): void
    {
        $freed = $this->ahead() && self::THURSDAY === $this->date
            ? array_keys(array_filter($this->skips, fn (bool $held, string $id): bool => !$held && $this->falls($id), \ARRAY_FILTER_USE_BOTH))
            : [];
        if ([] === $freed) {
            return;
        }
        $taken = $this->recurrences[$freed[$random->getInt(0, \count($freed) - 1)]];
        $rhythm = self::weeklyRule([4]);
        $content = $this->content($random);
        $candidate = ['content' => $content, 'start' => $taken['start'], 'end' => $taken['end'], 'rhythm' => $rhythm, 'until' => $this->date, 'firstDay' => self::TOMORROW, 'posed' => self::TOMORROW];
        $changes = [self::state(self::clock($taken['start']), self::clock($taken['end']), [...$content, null])];
        $version = self::intAt($this->day(self::TOMORROW), 'version');
        $request = ['PUT', '/recurrence', ['changes' => $changes, 'recurrence' => $rhythm + ['until' => $this->date], 'replaces' => null]];
        if ($this->refusedAsTaken($candidate, $this->recurrences, $request, self::TOMORROW, $version)) {
            return;
        }
        $shown = $this->shown();

        $day = $this->saveRecurrence($version, $changes, $rhythm + ['until' => $this->date], null, self::TOMORROW);

        $id = self::stringAt($day, 'untils', 0, 'recurrence');
        self::assertArrayNotHasKey($id, $this->recurrences);
        $this->recurrences[$id] = $candidate;
        $this->elsewhere[$id] = self::TOMORROW;
        $this->syncOtherSkips();
        $this->read($this->day($this->date));
        $this->assertMatchesModel();
        $step = end($this->done);
        if (false !== $step && $this->relinkTakes($step['undo'])) {
            $this->undo();
            $this->assertMatchesModel();
        }

        $this->withdrawElsewhere($id);
        $this->read($this->day($this->date));
        self::assertSame($shown, $this->shown(), 'Retirée, elle ne laisse rien sur le jour joué.');
    }

    /**
     * Une fois sur deux, après un geste qu'annuler ou rétablir défairait en repoussant une fin,
     * un autre onglet prend aussitôt le créneau qu'elle retrouverait.
     */
    private function takenElsewhere(Randomizer $random): void
    {
        if (null !== $this->returned() && 0 === $random->getInt(0, 1)) {
            $this->assertMatchesModel();
            $this->elsewhere($random, true);
        }
    }

    /**
     * La récurrence dont annuler, ou rétablir, le prochain geste repousserait la fin, s'il y en
     * a une, et lequel des deux.
     *
     * @return ?array{string, 'undo'|'redo'}
     */
    private function returned(): ?array
    {
        foreach (['undo' => end($this->done), 'redo' => end($this->undone)] as $way => $step) {
            if (false === $step) {
                continue;
            }
            foreach ($step[$way]['recurrences'] as $rewind) {
                if (self::isLonger($rewind['to'], $rewind['from'])) {
                    return [$rewind['recurrence'], $way];
                }
            }
        }

        return null;
    }

    /**
     * L'autre onglet annule la création de celles qu'il a créées ailleurs, ou de l'une d'elles :
     * retirées, elles ne prennent plus aucun créneau.
     */
    private function withdrawElsewhere(?string $only = null): void
    {
        foreach ($this->elsewhere as $id => $date) {
            if (null !== $only && $only !== $id) {
                continue;
            }
            $to = $this->withdrawn($id);
            $from = $this->recurrences[$id]['until'];
            if ($from !== $to) {
                $this->writeWith(self::intAt($this->day($date), 'version'), [], [['recurrence' => $id, 'from' => $from, 'to' => $to]], $date);
                $this->endOn($id, $to);
            }
            unset($this->elsewhere[$id]);
        }
        $this->syncOtherSkips();
    }

    /** Les fois détachées des autres jours que celui qu'on joue, telles que la base les garde. */
    private function syncOtherSkips(): void
    {
        $this->otherSkips = array_values(array_filter($this->storedSkips(), fn (string $skip): bool => explode(' ', $skip)[1] !== $this->date));
    }

    /**
     * Le surlendemain, le jour joué est passé : quelques gestes encore, la fenêtre de ses blocs
     * qui reviennent — un rythme changé part de demain, une fin changée seule change en place,
     * décocher la case l'arrête après aujourd'hui, ses heures ne changent pas —, une récurrence
     * qui y naît encore, et annuler et rétablir tout cela. Rien ne s'y pose plus : un jour déjà
     * venu ne reçoit jamais rien après coup.
     */
    private function playPast(Randomizer $random): void
    {
        $this->advanceClock(self::THURSDAY);
        $this->read($this->day($this->date));
        $this->done = [];
        $this->undone = [];
        $this->assertMatchesModel();

        for ($step = 0; $step < self::steps(self::PAST_STEPS); ++$step) {
            $linked = $this->linkedBlocks();
            $roll = $random->getInt(0, 9);
            if ($roll <= 2 && [] !== $linked) {
                $this->changePast($random, $linked[$random->getInt(0, \count($linked) - 1)]);
            } elseif ($roll <= 4) {
                $this->createRecurrence($random);
            } elseif ($roll <= 6 && [] !== $this->done) {
                $this->undo();
            } elseif (7 === $roll && [] !== $this->undone) {
                $this->redo();
            } elseif (8 === $roll && [] !== $linked) {
                $this->resizedInPast($random, $linked[$random->getInt(0, \count($linked) - 1)]);
            } else {
                $this->gesture($random);
            }
            $this->assertMatchesModel();
        }
    }

    /**
     * Sur le jour passé, allonger ou raccourcir un bloc qui revient avec les suivantes : les fois
     * passées ne changent jamais, et ses heures ne changent pas à partir de demain. Refusé sous
     * le geste, sans rien écrire.
     *
     * @param Block $block
     */
    private function resizedInPast(Randomizer $random, array $block): void
    {
        $id = (string) $block[2][3];
        $old = $this->recurrences[$id] ?? self::fail('Une récurrence que le modèle ne connaît pas.');
        [$changes] = $this->resizing($random, $old);
        $writes = $this->writes();
        $stored = $this->storedRecurrences();

        [$status, $answer] = $this->putRecurrence($this->version, $changes, $old['rhythm'] + ['until' => $old['until']], $id, $this->date);

        self::assertSame(422, $status, json_encode([$changes, $answer], \JSON_THROW_ON_ERROR));
        self::assertSame([['field' => 'changes', 'message' => 'Une récurrence couvre une seule plage, d\'un seul ticket.']], self::at($answer, 'violations'));
        self::assertSame($writes, $this->writes(), 'Rien ne s\'écrit.');
        self::assertSame($stored, $this->storedRecurrences(), 'Aucune fin ne change.');
    }

    /**
     * La fenêtre d'un bloc qui revient, sur le jour passé. Les fois passées ne changent jamais :
     * un rythme changé part de demain, l'ancienne finissant aujourd'hui ; une fin changée seule
     * change en place ; décocher la case l'arrête après aujourd'hui. Ce qu'on change au bloc ne
     * vaut que pour cette fois, qu'il détache, à moins d'en garder le contenu et la case.
     *
     * @param Block $block
     */
    private function changePast(Randomizer $random, array $block): void
    {
        [$start, $end, $quarter] = $block;
        $id = (string) $quarter[3];
        $old = $this->recurrences[$id] ?? self::fail('Une récurrence que le modèle ne connaît pas.');
        $content = 0 === $random->getInt(0, 2) ? $this->content($random) : [$quarter[0], $quarter[1], $quarter[2]];
        $today = self::dayNumber($this->today);
        // Décochée ; un autre rythme, sans fin ou à partir de demain ; ou sa fin seule, pas avant aujourd'hui.
        [$rhythm, $until] = match ($random->getInt(0, 2)) {
            0 => [null, null],
            1 => [$this->rule($random, $this->date), 0 === $random->getInt(0, 3) ? self::dateOf($today + 1 + $random->getInt(0, 40)) : null],
            default => [$old['rhythm'], 0 === $random->getInt(0, 1) ? null : self::dateOf($today + $random->getInt(0, 40))],
        };
        $rule = null === $rhythm ? null : $rhythm + ['until' => $until];
        $before = $old['until'];
        $last = null === $before || $before > $this->today ? $this->today : $before;
        $others = $this->recurrences;
        $candidate = null;
        $untils = [];
        $ended = $old;
        if (null === $rhythm || $rhythm !== $old['rhythm']) {
            if ($last !== $before) {
                $ended['until'] = $last;
                $others[$id] = $ended;
                $untils[] = ['recurrence' => $id, 'before' => $before, 'after' => $last];
            }
            if (null !== $rhythm) {
                $candidate = ['content' => $old['content'], 'start' => $old['start'], 'end' => $old['end'], 'rhythm' => $rhythm, 'until' => $until, 'firstDay' => self::dateOf($today + 1), 'posed' => $this->today];
            }
        } elseif ($until !== $before) {
            $ended['until'] = $until;
            $others[$id] = $ended;
            $untils[] = ['recurrence' => $id, 'before' => $before, 'after' => $until];
            if (self::isLonger($until, $before)) {
                $candidate = $ended;
                $own = $id;
                unset($others[$id]);
            }
        }
        $changes = [self::state(self::clock($start), self::clock($end), [...$content, null])];
        $request = ['PUT', '/recurrence', ['changes' => $changes, 'recurrence' => $rule, 'replaces' => $this->seenInModel($id)]];
        if ((null !== $rhythm && $this->refusedAsMovedLonger($id, $until, $request))
            || (null !== $candidate && $this->refusedAsTaken($candidate, $others, $request, $this->date, $this->version, $own ?? null))) {
            return;
        }
        $snapshot = $this->snapshot();

        [$status, $day] = $this->putRecurrence($this->version, $changes, $rule, $id, $this->date);

        self::assertSame(200, $status, json_encode([$changes, $rule, $id, $day], \JSON_THROW_ON_ERROR));
        foreach ($untils as $change) {
            $this->endOn($id, $change['after']);
        }
        if (null !== $rhythm && $rhythm !== $old['rhythm'] && null !== $candidate) {
            $new = self::stringAt($day, 'untils', \count($untils), 'recurrence');
            self::assertArrayNotHasKey($new, $this->recurrences);
            $untils[] = ['recurrence' => $new, 'before' => $this->today, 'after' => $until];
            $this->recurrences[$new] = $candidate;
        }
        self::assertSame($untils, $day['untils']);
        $quarters = self::between($start, $end);
        $keeps = null !== $rule && $content === $old['content'];
        $this->changeModel(array_fill_keys($quarters, $content), $keeps ? array_fill_keys($quarters, $id) : []);
        $this->wrote($day, false);

        $this->record($snapshot, $quarters);
        $this->last = $request;
    }

    /**
     * Une récurrence qu'une écriture mènerait sur le créneau d'une autre après aujourd'hui : le
     * serveur la refuse sous le rythme, en nommant l'autre, et rien ne s'écrit.
     *
     * @param Repeat                                      $candidate
     * @param array<string, Repeat>                       $others    les autres, telles que l'écriture les laisserait
     * @param array{string, string, array<string, mixed>} $request
     * @param ?string                                     $own       la récurrence qu'est le candidat, sa fin repoussée, ou dont il reprend les fois sautées : elles comptent
     * @param ?string                                     $after     seules comptent celles d'après ce jour
     *
     * @return bool elle est refusée
     */
    private function refusedAsTaken(array $candidate, array $others, array $request, string $date, int $version, ?string $own = null, ?string $after = null): bool
    {
        $clash = $this->earliest($candidate, $others, $own, $after);
        if (null === $clash) {
            return false;
        }
        $writes = $this->writes();
        $stored = $this->storedRecurrences();
        [$method, $path, $body] = $request;

        [$status, $answer] = $this->send($method, '/api/days/'.$date.$path, $body + ['version' => $version]);

        self::assertSame(422, $status, json_encode([$body, $clash, $answer], \JSON_THROW_ON_ERROR));
        self::assertSame([['field' => 'recurrence.rhythm', 'message' => $this->takenBy($clash[0])]], self::at($answer, 'violations'), json_encode([$body, $clash], \JSON_THROW_ON_ERROR));
        self::assertSame($writes, $this->writes(), 'Un créneau pris n\'écrit rien.');
        self::assertSame($stored, $this->storedRecurrences(), 'Ni récurrence, ni fin.');

        return true;
    }

    /**
     * Collée après une coupe, elle continue la coupée ($follows), qui ne va plus jusqu'à ce jour :
     * la coupe a eu lieu le lendemain de sa fin. Inconnue, rien.
     *
     * @param Repeat $candidate
     *
     * @return Repeat
     */
    private function following(array $candidate, ?string $follows): array
    {
        $until = null === $follows ? null : ($this->recurrences[$follows]['until'] ?? null);
        if (null === $follows || null === $until) {
            return $candidate;
        }
        self::assertLessThan($candidate['firstDay'], $until, 'La coupée ne va plus jusqu\'au jour du collage.');

        return $candidate + ['follows' => $follows, 'cutOn' => self::dateOf(self::dayNumber($until) + 1)];
    }

    /**
     * Annuler ou rétablir ferait revivre une récurrence déplacée à ses deux places : chaque fin
     * rendue d'abord, puis chacune qui s'allonge jugée. Collée, la coupée irait jusqu'à son
     * premier jour ; coupée, elle irait jusqu'au premier jour d'une collée encore là. Ce que le
     * serveur dit alors, ou null.
     *
     * @param list<Rewind> $rewinds
     */
    private function movedRefusal(array $rewinds): ?string
    {
        $after = $this->recurrences;
        foreach ($rewinds as $rewind) {
            if (isset($after[$rewind['recurrence']])) {
                $after[$rewind['recurrence']]['until'] = $rewind['to'];
            }
        }
        ksort($after);
        $reaches = static fn (array $repeat, string $date): bool => null === $repeat['until'] || $repeat['until'] >= $date;
        foreach ($rewinds as $rewind) {
            $id = $rewind['recurrence'];
            if (!isset($after[$id]) || !self::isLonger($rewind['to'], $rewind['from'])) {
                continue;
            }
            $moved = $after[$id];
            if (!self::withdrawnRepeat($moved) && isset($moved['follows'], $moved['cutOn'])) {
                $sourceId = $moved['follows'];
                while (isset($after[$sourceId]['follows']) && self::withdrawnRepeat($after[$sourceId])) {
                    $sourceId = $after[$sourceId]['follows'];
                }
                $source = $after[$sourceId] ?? null;
                if (null !== $source && !self::withdrawnRepeat($source) && $reaches($source, $moved['firstDay'])) {
                    return \sprintf('Rétablissez d\'abord la coupe du %s.', self::frenchDay($moved['cutOn']));
                }
                // Une autre collée de la même coupe, encore là sur sa période : un onglet dupliqué
                // l'a collée ailleurs pendant que celle-ci était annulée (DayWriter::pastedTwin).
                foreach (null === $source ? [] : self::liveFollowersIn($after, $sourceId) as $twinId => $twin) {
                    if ($twinId !== $id && $reaches($moved, $twin['firstDay']) && $reaches($twin, $moved['firstDay'])) {
                        return \sprintf('Annulez d\'abord le collage du %s.', self::frenchDay($twin['firstDay']));
                    }
                }
            }
            foreach (self::liveFollowersIn($after, $id) as $follower) {
                if ($reaches($moved, $follower['firstDay'])) {
                    return \sprintf('Annulez d\'abord le collage du %s.', self::frenchDay($follower['firstDay']));
                }
            }
        }

        return null;
    }

    /**
     * Les collées encore là qui continuent $id, par identifiant : une collée retirée renvoie aux
     * siennes (DayWriter::liveFollowers).
     *
     * @param array<string, Repeat> $all
     *
     * @return array<string, Repeat>
     */
    private static function liveFollowersIn(array $all, string $id): array
    {
        $followers = array_filter($all, static fn (array $repeat): bool => ($repeat['follows'] ?? null) === $id);
        ksort($followers);
        $live = [];
        foreach ($followers as $followerId => $follower) {
            $live += self::withdrawnRepeat($follower) ? self::liveFollowersIn($all, $followerId) : [$followerId => $follower];
        }

        return $live;
    }

    /** @param Repeat $repeat */
    private static function withdrawnRepeat(array $repeat): bool
    {
        return null !== $repeat['until'] && $repeat['until'] < $repeat['firstDay'];
    }

    /**
     * Une collée remplacée le jour même de son collage — un autre contenu, d'autres heures —
     * passe la main : la nouvelle continue sa coupée (DayWriter::saveRecurrence).
     *
     * @param Repeat $candidate
     *
     * @return Repeat
     */
    private function replacing(array $candidate, string $old): array
    {
        $replaced = $this->recurrences[$old] ?? null;

        return null !== $replaced && isset($replaced['follows']) && $this->date <= $replaced['firstDay'] ? $this->following($candidate, $old) : $candidate;
    }

    /**
     * La fenêtre repousserait la fin de $id au-delà du collage d'une collée encore là — ou la
     * nouvelle récurrence qui la remplace, jusqu'à $until : refusé sous « Jusqu'au », rien ne
     * s'écrit (DayWriter::assertMovedLonger).
     *
     * @param array{string, string, array<string, mixed>} $request
     */
    private function refusedAsMovedLonger(string $id, ?string $until, array $request): bool
    {
        $old = $this->recurrences[$id] ?? self::fail('Une récurrence que le modèle ne connaît pas.');
        $tomorrow = self::dateOf(self::dayNumber($this->today) + 1);
        $follower = null;
        foreach (self::isLonger($until, $old['until']) ? self::liveFollowersIn($this->recurrences, $id) : [] as $live) {
            // Une collée finie avant demain ne gêne pas : les fois passées ne changent jamais.
            if ((null === $until || $until >= $live['firstDay']) && (null === $live['until'] || $live['until'] >= $tomorrow)) {
                $follower = $live;
                break;
            }
        }
        if (null === $follower) {
            return false;
        }

        return $this->refusedUnder($request, $this->date, $this->version, 'recurrence.until', \sprintf('Annulez d\'abord le collage du %s.', self::frenchDay($follower['firstDay'])));
    }

    /**
     * Collée, la coupée a déjà une collée encore là pendant sa période ($until) : un onglet
     * dupliqué la collerait deux fois.
     * Refusé sous `follows`, rien ne s'écrit (DayWriter::followed).
     *
     * @param array{string, string, array<string, mixed>} $request
     */
    private function refusedAsPastedElsewhere(?string $follows, ?string $until, array $request, string $date, int $version): bool
    {
        $pasted = null;
        foreach (null === $follows ? [] : self::liveFollowersIn($this->recurrences, $follows) as $live) {
            if ((null === $until || $until >= $live['firstDay']) && (null === $live['until'] || $live['until'] >= $date)) {
                $pasted = $live;
                break;
            }
        }
        if (null === $pasted) {
            return false;
        }

        return $this->refusedUnder($request, $date, $version, 'follows', \sprintf('Cette récurrence a déjà été collée le %s. Rien n\'est collé.', self::frenchDay($pasted['firstDay'])));
    }

    /**
     * La requête, refusée sous ce champ avec ce message, sans rien écrire.
     *
     * @param array{string, string, array<string, mixed>} $request
     */
    private function refusedUnder(array $request, string $date, int $version, string $field, string $message): bool
    {
        $writes = $this->writes();
        $stored = $this->storedRecurrences();
        [$method, $path, $body] = $request;

        [$status, $answer] = $this->send($method, '/api/days/'.$date.$path, $body + ['version' => $version]);

        self::assertSame(422, $status, json_encode([$body, $answer], \JSON_THROW_ON_ERROR));
        self::assertSame([['field' => $field, 'message' => $message]], self::at($answer, 'violations'));
        self::assertSame($writes, $this->writes(), 'Rien ne s\'écrit.');
        self::assertSame($stored, $this->storedRecurrences(), 'Ni récurrence, ni fin.');

        return true;
    }

    /** « mardi 6 octobre », « jeudi 1er octobre », comme le serveur les écrit. */
    private static function frenchDay(string $date): string
    {
        $days = [1 => 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
        $months = [1 => 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
        $day = (int) substr($date, 8, 2);
        $weekday = (int) gmdate('N', self::dayNumber($date) * 86400);

        return \sprintf('%s %s %s', $days[$weekday], 1 === $day ? '1er' : (string) $day, $months[(int) substr($date, 5, 2)]);
    }

    /**
     * Annuler ou rétablir rendrait à une récurrence une fin qui la mène sur le créneau d'une
     * autre après aujourd'hui : chaque fin rendue d'abord, puis chacune qui s'allonge jugée.
     *
     * @param list<Rewind> $rewinds
     */
    private function rewindTakes(array $rewinds): bool
    {
        $after = $this->recurrences;
        foreach ($rewinds as $rewind) {
            if (isset($after[$rewind['recurrence']])) {
                $ended = $after[$rewind['recurrence']];
                $ended['until'] = $rewind['to'];
                $after[$rewind['recurrence']] = $ended;
            }
        }
        foreach ($rewinds as $rewind) {
            $id = $rewind['recurrence'];
            if (!isset($after[$id]) || !self::isLonger($rewind['to'], $rewind['from'])) {
                continue;
            }
            $others = $after;
            unset($others[$id]);
            if (null !== $this->earliest($after[$id], $others, $id)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Annuler relierait un quart d'heure du jour à venir à une récurrence dont la fois y est
     * effacée ou détachée, cette fois seulement, et une autre — ses fins rendues d'abord — y
     * a pris le créneau depuis : elle y tombe, sa fois n'est pas sautée, leurs heures se
     * croisent, et rien ne les croisait jusque-là.
     *
     * @param Gesture $gesture
     */
    private function relinkTakes(array $gesture): bool
    {
        if (!$this->ahead()) {
            return false;
        }
        $after = $this->recurrences;
        foreach ($gesture['recurrences'] as $rewind) {
            if (isset($after[$rewind['recurrence']])) {
                $after[$rewind['recurrence']]['until'] = $rewind['to'];
            }
        }
        foreach ($gesture['changes'] as $change) {
            $id = $change['recurrence'] ?? null;
            if (null === $id || !isset($after[$id]) || false !== ($this->skips[$id] ?? null)) {
                continue;
            }
            foreach ($after as $otherId => $other) {
                if ($otherId !== $id
                    && $after[$id]['start'] < $other['end'] && $other['start'] < $after[$id]['end']
                    && self::fallsOn($other, $this->date)
                    && !isset($this->skippedOf($otherId)[$this->date])
                    && !isset($this->closed()[$this->date])
                    && null === $this->clash($after[$id], $other, $this->skippedOf($id), $this->skippedOf($otherId))) {
                    return true;
                }
            }
        }

        return false;
    }

    /** Une fin qui va plus loin que l'autre : sans fin, ou plus tard. */
    private static function isLonger(?string $until, ?string $than): bool
    {
        return null !== $than && (null === $until || $until > $than);
    }

    /**
     * Parmi $others, celle qui prend le créneau le plus tôt après aujourd'hui — la plus
     * ancienne, à date égale —, et ce jour-là ; null si le créneau est libre.
     *
     * @param Repeat                $candidate
     * @param array<string, Repeat> $others
     * @param ?string               $own       la récurrence qu'est le candidat, s'il en est une, ou dont il reprend les fois sautées
     * @param ?string               $after     seules comptent ses fois sautées d'après ce jour
     *
     * @return ?array{string, string}
     */
    private function earliest(array $candidate, array $others, ?string $own = null, ?string $after = null): ?array
    {
        $found = null;
        $skipped = array_filter($this->skippedOf($own), static fn (string $date): bool => null === $after || $date > $after, \ARRAY_FILTER_USE_KEY);
        foreach ($others as $id => $other) {
            $date = $this->clash($candidate, $other, $skipped, $this->skippedOf($id));
            if (null !== $date && (null === $found || strcmp($date.$id, $found[1].$found[0]) < 0)) {
                $found = [$id, $date];
            }
        }

        return $found;
    }

    /**
     * La première date après aujourd'hui où elles tombent toutes les deux sur des heures qui se
     * croisent, ou null : la règle du serveur, refaite ici sans son code. Deux rythmes à la
     * semaine se répètent ensemble en douze semaines au plus : treize suffisent. Avec un rythme
     * mensuel, ses seules fois, sur 28 ans. Une fois détachée ou effacée ne prend pas le
     * créneau, ni un jour à venir envoyé ; les bornes se comptent après la dernière.
     *
     * @param Repeat             $a
     * @param Repeat             $b
     * @param array<string, int> $aSkipped ses fois sautées après aujourd'hui, par date
     * @param array<string, int> $bSkipped
     */
    private function clash(array $a, array $b, array $aSkipped = [], array $bSkipped = []): ?string
    {
        if ($a['start'] >= $b['end'] || $b['start'] >= $a['end']) {
            return null;
        }
        // Un jour à venir envoyé ne reçoit plus aucune récurrence : une fois sautée pour toutes.
        $aSkipped += $this->closed();
        $bSkipped += $this->closed();
        ksort($aSkipped);
        ksort($bSkipped);
        $key = serialize([$a['start'], $a['end'], $a['rhythm'], $a['firstDay'], $a['until'], $b['start'], $b['end'], $b['rhythm'], $b['firstDay'], $b['until'], $this->today, $aSkipped, $bSkipped]);
        if (\array_key_exists($key, $this->clashes)) {
            return $this->clashes[$key];
        }
        $from = max(self::dayNumber($a['firstDay']), self::dayNumber($b['firstDay']), self::dayNumber($this->today) + 1);
        $to = \PHP_INT_MAX;
        foreach ([$a['until'], $b['until']] as $until) {
            if (null !== $until) {
                $to = min($to, self::dayNumber($until));
            }
        }
        $found = null;
        // Les bornes se comptent après la dernière fois sautée.
        $base = $from;
        foreach ([...array_keys($aSkipped), ...array_keys($bSkipped)] as $skipped) {
            $base = max($base, self::dayNumber($skipped) + 1);
        }
        if ('weekly' !== $a['rhythm']['kind'] || 'weekly' !== $b['rhythm']['kind']) {
            [$monthly, $monthlySkipped, $other, $otherSkipped] = 'weekly' !== $a['rhythm']['kind'] ? [$a, $aSkipped, $b, $bSkipped] : [$b, $bSkipped, $a, $aSkipped];
            $to = min($to, self::dayNumber(new \DateTimeImmutable(self::dateOf($base))->modify('+28 years')->format('Y-m-d')));
            [$year, $month] = array_map('intval', explode('-', self::dateOf($from)));
            while (null === $found && self::dayNumber(\sprintf('%04d-%02d-01', $year, $month)) <= $to) {
                $day = self::monthDay($monthly['rhythm'], $year, $month);
                if (null !== $day && $day >= $from && $day <= $to && self::takes($monthly, $monthlySkipped, $day) && self::takes($other, $otherSkipped, $day)) {
                    $found = self::dateOf($day);
                }
                [$year, $month] = 12 === $month ? [$year + 1, 1] : [$year, $month + 1];
            }
        } else {
            for ($day = $from, $last = min($to, $base + 7 * 13); null === $found && $day <= $last; ++$day) {
                if (self::takes($a, $aSkipped, $day) && self::takes($b, $bSkipped, $day)) {
                    $found = self::dateOf($day);
                }
            }
        }

        return $this->clashes[$key] = $found;
    }

    /**
     * Elle se poserait ce jour-là, compté depuis 1970 : elle y tombe, et cette fois n'est pas sautée.
     *
     * @param Repeat             $repeat
     * @param array<string, int> $skipped
     */
    private static function takes(array $repeat, array $skipped, int $day): bool
    {
        return self::fallsOn($repeat, self::dateOf($day)) && !isset($skipped[self::dateOf($day)]);
    }

    /**
     * Le jour où un rythme mensuel tombe dans un mois, compté depuis 1970, ou null : le 31
     * d'un mois de 30 jours.
     *
     * @param Rule $rule
     */
    private static function monthDay(array $rule, int $year, int $month): ?int
    {
        $first = self::dayNumber(\sprintf('%04d-%02d-01', $year, $month));
        [$weekday, , $length] = self::dayOf($first);
        if ('monthly_date' === $rule['kind']) {
            return $rule['monthDay'] <= $length ? $first + (int) $rule['monthDay'] - 1 : null;
        }
        // Le premier de ce jour de la semaine dans le mois, puis de sept en sept.
        $offset = (($rule['weekdays'][0] ?? 1) - $weekday + 7) % 7;
        $count = intdiv($length - 1 - $offset, 7) + 1;

        return $first + $offset + 7 * (-1 === $rule['monthWeek'] ? $count - 1 : (int) $rule['monthWeek'] - 1);
    }

    /**
     * Elle tombe ce jour-là : entre son premier jour et sa fin, et selon son rythme — écrit ici
     * sans le code de l'application, en jours comptés depuis 1970.
     *
     * @param Repeat $recurrence
     */
    private static function fallsOn(array $recurrence, string $date): bool
    {
        if ($date < $recurrence['firstDay'] || (null !== $recurrence['until'] && $date > $recurrence['until'])) {
            return false;
        }
        $rule = $recurrence['rhythm'];
        $day = self::dayNumber($date);
        [$weekday, $monthDay, $length] = self::dayOf($day);
        $first = self::dayNumber($recurrence['firstDay']);

        return match ($rule['kind']) {
            // Ses semaines se comptent de lundi en lundi, depuis celle de son premier jour.
            'weekly' => \in_array($weekday, $rule['weekdays'], true)
                && 0 === intdiv(($day - $weekday) - ($first - self::dayOf($first)[0]), 7) % $rule['everyWeeks'],
            'monthly_weekday' => [$weekday] === $rule['weekdays']
                && (-1 === $rule['monthWeek'] ? $monthDay + 7 > $length : intdiv($monthDay - 1, 7) + 1 === $rule['monthWeek']),
            default => $monthDay === $rule['monthDay'],
        };
    }

    private static function dayNumber(string $date): int
    {
        [$year, $month, $day] = array_map('intval', explode('-', $date));

        return intdiv((int) gmmktime(0, 0, 0, $month, $day, $year), 86400);
    }

    private static function dateOf(int $day): string
    {
        return gmdate('Y-m-d', $day * 86400);
    }

    /**
     * Son jour de la semaine, du lundi (1) au dimanche (7), son jour du mois, et la longueur
     * de son mois. Le 1er janvier 1970 était un jeudi.
     *
     * @return array{int, int, int}
     */
    private static function dayOf(int $day): array
    {
        return [($day + 3) % 7 + 1, (int) gmdate('j', $day * 86400), (int) gmdate('t', $day * 86400)];
    }

    private static function number(mixed $value): int
    {
        self::assertIsInt($value);

        return $value;
    }

    /**
     * Ce que la fenêtre dit sous le rythme quand le créneau est pris.
     */
    private function takenBy(string $id): string
    {
        [$kind, $ticket, $comment] = $this->recurrences[$id]['content'] ?? self::fail('Une récurrence que le modèle ne connaît pas.');

        return 'pause' === $kind ? 'Ce créneau est déjà pris par la pause.' : \sprintf("Ce créneau est déjà pris par la récurrence «\u{a0}%s\u{a0}».", $comment ?? $ticket);
    }

    /**
     * Les récurrences de la base, leurs fins et leurs derniers jours traités.
     *
     * @return list<array<string, mixed>>
     */
    private function storedRecurrences(): array
    {
        return $this->connection()->fetchAllAssociative('SELECT HEX(id) AS id, until, posed_through FROM recurrence ORDER BY id');
    }

    /**
     * Un rythme que le jour $date permet, comme la fenêtre les propose : le plus souvent chaque
     * semaine, parfois une semaine sur 2 à 4, parfois chaque mois — au rang du jour, au dernier
     * s'il l'est, ou à sa date.
     *
     * @return Rule
     */
    private function rule(Randomizer $random, string $date): array
    {
        $monthly = self::monthlyRules($date);

        return match ($random->getInt(0, 9)) {
            0, 1, 2, 3, 4 => self::weeklyRule($this->weekdays($random)),
            5, 6 => self::weeklyRule($this->weekdays($random), $random->getInt(2, 4)),
            default => $monthly[$random->getInt(0, \count($monthly) - 1)],
        };
    }

    /**
     * Les rythmes mensuels que ce jour permet : son rang du 1er au 4e, le dernier s'il l'est,
     * et sa date.
     *
     * @return non-empty-list<Rule>
     */
    private static function monthlyRules(string $date): array
    {
        [$weekday, $monthDay, $length] = self::dayOf(self::dayNumber($date));
        $rules = [];
        if ($monthDay <= 28) {
            $rules[] = ['kind' => 'monthly_weekday', 'weekdays' => [$weekday], 'everyWeeks' => 1, 'monthWeek' => intdiv($monthDay - 1, 7) + 1, 'monthDay' => null];
        }
        if ($monthDay + 7 > $length) {
            $rules[] = ['kind' => 'monthly_weekday', 'weekdays' => [$weekday], 'everyWeeks' => 1, 'monthWeek' => -1, 'monthDay' => null];
        }
        $rules[] = ['kind' => 'monthly_date', 'weekdays' => [], 'everyWeeks' => 1, 'monthWeek' => null, 'monthDay' => $monthDay];

        return $rules;
    }

    /**
     * @param list<int> $weekdays
     *
     * @return Rule
     */
    private static function weeklyRule(array $weekdays, int $everyWeeks = 1): array
    {
        return ['kind' => 'weekly', 'weekdays' => $weekdays, 'everyWeeks' => $everyWeeks, 'monthWeek' => null, 'monthDay' => null];
    }

    /**
     * Sa fin change sur le serveur : les jours venus jusqu'à aujourd'hui sont désormais traités.
     */
    private function endOn(string $id, ?string $until): void
    {
        self::assertArrayHasKey($id, $this->recurrences);
        $this->recurrences[$id]['until'] = $until;
        $this->recurrences[$id]['posed'] = max($this->recurrences[$id]['posed'], $this->today);
    }

    /**
     * L'horloge avance à $date, 08:00 : à la prochaine requête, le poseur traite chaque
     * récurrence qui a encore des jours à traiter — ni retirée, ni finie avant le premier qui
     * lui reste — jusqu'à ce jour.
     */
    private function advanceClock(string $date): void
    {
        self::mockTime($date.' 08:00:00 Europe/Paris');
        $this->today = $date;
        foreach ($this->recurrences as $id => $recurrence) {
            $until = $recurrence['until'];
            if ($recurrence['posed'] < $date && (null === $until || ($until > $recurrence['posed'] && $until >= $recurrence['firstDay']))) {
                $this->recurrences[$id]['posed'] = $date;
            }
        }
    }

    private function ahead(): bool
    {
        return $this->date > $this->today;
    }

    /**
     * Le jour joué, s'il est à venir et qu'un envoi le ferme : aucune récurrence n'y prend plus de
     * créneau (DaySendRepository::closedAfter).
     *
     * @return array<string, int>
     */
    private function closed(): array
    {
        return $this->closes() && $this->ahead() ? [$this->date => 1] : [];
    }

    /** Elle tombe le jour joué : son premier jour est passé, elle n'est pas finie, et son rythme y tombe. */
    private function falls(string $id): bool
    {
        return self::fallsOn($this->recurrences[$id] ?? self::fail('Une récurrence que le modèle ne connaît pas.'), $this->date);
    }

    /** Elle n'est pas finie avant le jour joué. */
    private function reaches(string $id): bool
    {
        $until = $this->recurrences[$id]['until'] ?? null;

        return null === $until || $until >= $this->date;
    }

    /** Elle prévoit encore sa fois du jour joué : un jour à venir, ni envoyé ni mis à 0h00, où elle tombe, et qu'elle n'a pas déjà traité. */
    private function plans(string $id): bool
    {
        return $this->ahead() && 0 !== $this->objective && !$this->closes() && $this->falls($id) && !$this->treated($id);
    }

    /**
     * Elle a déjà traité le jour joué : née d'une coupe ce jour-là, elle y a écrit sa fois.
     * Tant que le jour est à venir, rien d'autre ne l'a fait avancer.
     */
    private function treated(string $id): bool
    {
        return $this->date <= ($this->recurrences[$id]['posed'] ?? self::fail('Une récurrence que le modèle ne connaît pas.'));
    }

    /** La veille du jour joué : la fin d'une récurrence arrêtée ou coupée à partir de lui. */
    private function dayBefore(): string
    {
        return new \DateTimeImmutable($this->date)->modify('-1 day')->format('Y-m-d');
    }

    /** La fin d'une récurrence retirée : la veille de son premier jour. */
    private function withdrawn(string $id): string
    {
        $firstDay = $this->recurrences[$id]['firstDay'] ?? self::fail('Une récurrence que le modèle ne connaît pas.');

        return new \DateTimeImmutable($firstDay)->modify('-1 day')->format('Y-m-d');
    }

    private function hasWork(): bool
    {
        return [] !== array_filter($this->shown(), static fn (array $quarter): bool => 'work' === $quarter[0]);
    }

    /**
     * La fin de chaque récurrence, dans la base, par son identifiant. Chacune a son premier
     * jour, et le dernier jour qu'elle a traité : celui de l'horloge quand le poseur l'a
     * trouvée à traiter ou qu'une fin a changé, celui d'une coupe ou d'une création qui l'a
     * fait naître — le vendredi venu, celles qui finissaient avant en sont restées au jeudi.
     *
     * @return array<string, ?string>
     */
    private function storedUntils(): array
    {
        $untils = [];
        foreach ($this->connection()->fetchAllAssociative('SELECT id, until, first_day, posed_through FROM recurrence') as $row) {
            self::assertTrue(null === $row['until'] || \is_string($row['until']));
            self::assertIsString($row['id']);
            $id = Uuid::fromBinary($row['id'])->toRfc4122();
            $recurrence = $this->recurrences[$id] ?? self::fail('Une récurrence que le modèle ne connaît pas.');
            self::assertSame([$recurrence['firstDay'], $recurrence['posed']], [$row['first_day'], $row['posed_through']], 'Son premier jour, et le dernier qu\'elle a traité.');
            $untils[$id] = $row['until'];
        }
        ksort($untils);

        return $untils;
    }

    /**
     * Les fois détachées de la base, « identifiant date », suivies de « retenue » pour celles
     * qu'un passage à 0h00 a retirées.
     *
     * @return list<string>
     */
    private function storedSkips(): array
    {
        $skips = array_map(static function (array $row): string {
            self::assertIsString($row['recurrence_id']);
            self::assertIsString($row['date']);

            return Uuid::fromBinary($row['recurrence_id'])->toRfc4122().' '.$row['date'].(\in_array($row['held'], [1, '1', true], true) ? ' retenue' : '');
        }, $this->connection()->fetchAllAssociative('SELECT recurrence_id, date, held FROM recurrence_skip'));
        sort($skips);

        return $skips;
    }

    /**
     * Les fois détachées ou effacées d'une récurrence après aujourd'hui, telles que le modèle
     * les attend : elles ne prennent pas son créneau. Celles qu'un 0h00 retient le gardent.
     *
     * @return array<string, int>
     */
    private function skippedOf(?string $id): array
    {
        $dates = [];
        foreach (null === $id ? [] : $this->expectedSkips() as $skip) {
            $parts = explode(' ', $skip);
            if (2 === \count($parts) && $parts[0] === $id && $parts[1] > $this->today) {
                $dates[$parts[1]] = 1;
            }
        }

        return $dates;
    }

    /**
     * @return list<string>
     */
    private function expectedSkips(): array
    {
        $skips = $this->otherSkips;
        foreach ($this->skips as $id => $held) {
            $skips[] = $id.' '.$this->date.($held ? ' retenue' : '');
        }
        sort($skips);

        return $skips;
    }

    /**
     * De quoi voir qu'une lecture n'a rien écrit : les journées, leurs versions, leurs
     * créneaux, les fois détachées.
     *
     * @return array<string, mixed>
     */
    private function writes(): array
    {
        $writes = $this->connection()->fetchAssociative('SELECT (SELECT COUNT(*) FROM day) AS days, (SELECT COALESCE(SUM(version), 0) FROM day) AS versions, (SELECT COUNT(*) FROM slot) AS slots, (SELECT COUNT(*) FROM recurrence_skip) AS skips');
        self::assertIsArray($writes);

        return $writes;
    }

    /**
     * Ce que Jira doit avoir du jour joué, en secondes par ticket : ce que la journée montre.
     *
     * @return array<string, int>
     */
    private function expectedWorklogs(): array
    {
        $seconds = [];
        foreach ($this->shown() as $quarter) {
            if ('work' === $quarter[0]) {
                $ticket = (string) $quarter[1];
                $seconds[$ticket] = ($seconds[$ticket] ?? 0) + 900;
            }
        }
        ksort($seconds);

        return $seconds;
    }

    /**
     * Ce que le compte relié a dans le Jira simulé, en secondes par ticket : tout sur le jour joué.
     *
     * @return array<string, int>
     */
    private function worklogs(): array
    {
        $seconds = [];
        foreach (self::listAt($this->jiraState(), 'worklogs') as $worklog) {
            if (Catalog::ACCOUNT_ID !== $worklog['authorId']) {
                continue;
            }
            self::assertSame($this->date, substr(self::stringAt($worklog, 'started'), 0, 10));
            $ticket = self::stringAt($worklog, 'issueKey');
            $seconds[$ticket] = ($seconds[$ticket] ?? 0) + self::intAt($worklog, 'timeSpentSeconds');
        }
        ksort($seconds);

        return $seconds;
    }

    /**
     * @return array<string, ?string>
     */
    private function untils(): array
    {
        return array_map(static fn (array $recurrence): ?string => $recurrence['until'], $this->recurrences);
    }

    /**
     * Ce que la page voit de la journée, et la fin de chaque récurrence.
     *
     * @return Snapshot
     */
    private function snapshot(): array
    {
        return [$this->view(), $this->untils()];
    }

    /**
     * Les quarts d'heure écrits qu'une récurrence a posés ce jour-là, et qui lui sont restés.
     *
     * @return list<int>
     */
    private function quartersLinkedTo(string $id): array
    {
        return array_keys(array_filter($this->model, static fn (array $quarter): bool => $id === $quarter[3]));
    }

    /**
     * Sa fois du jour joué, quart d'heure par quart d'heure : écrite ou prévue.
     *
     * @return list<int>
     */
    private function occurrenceOf(string $id): array
    {
        return array_keys(array_filter($this->shown(), static fn (array $quarter): bool => $id === $quarter[3]));
    }

    /**
     * Les blocs que porte une récurrence, posés ou prévus, tels que la page les voit.
     *
     * @return list<Block>
     */
    private function linkedBlocks(): array
    {
        return array_values(array_filter(self::blocksOf($this->view()), static fn (array $block): bool => null !== $block[2][3]));
    }

    /**
     * Un à trois créneaux disjoints, chacun rempli ou vidé ; souvent sur un bloc qui revient.
     *
     * @return list<Change>
     */
    private function randomChanges(Randomizer $random): array
    {
        $linked = $this->linkedBlocks();
        $changes = [];
        $taken = [];
        for ($count = $random->getInt(1, 3); \count($changes) < $count;) {
            $length = null;
            if ([] === $changes && [] !== $linked && 0 === $random->getInt(0, 2)) {
                [$blockStart, $blockEnd] = $linked[$random->getInt(0, \count($linked) - 1)];
                if (0 === $random->getInt(0, 1)) {
                    // Le bloc qui revient, tout entier, comme on le sélectionne.
                    $first = intdiv($blockStart - 420, 15);
                    $length = intdiv($blockEnd - $blockStart, 15);
                } else {
                    // Sur un de ses quarts d'heure.
                    $first = intdiv($random->getInt($blockStart, $blockEnd - 15) - 420, 15);
                }
            } else {
                $first = $random->getInt(0, self::QUARTERS - 1);
            }
            $length ??= min($random->getInt(1, 8), self::QUARTERS - $first);
            $quarters = range($first, $first + $length - 1);
            if ([] !== array_intersect($quarters, $taken)) {
                continue;
            }
            $taken = [...$taken, ...$quarters];

            $start = self::time($first);
            $end = self::time($first + $length);
            $pick = $random->getInt(0, \count(self::CONTENTS));
            $changes[] = \count(self::CONTENTS) === $pick
                ? self::clear($start, $end)
                : self::state($start, $end, [...self::CONTENTS[$pick], null]);
        }

        return $changes;
    }

    /**
     * @return Content
     */
    private function content(Randomizer $random): array
    {
        return self::CONTENTS[$random->getInt(0, \count(self::CONTENTS) - 1)];
    }

    /**
     * Un autre contenu que celui-là.
     *
     * @param Content $content
     *
     * @return Content
     */
    private function otherContent(array $content): array
    {
        foreach (self::CONTENTS as $other) {
            if ($other !== $content) {
                return $other;
            }
        }

        return self::fail('Un seul contenu.');
    }

    /**
     * Des jours parmi ceux travaillés, dans l'ordre, au moins un.
     *
     * @return list<int>
     */
    private function weekdays(Randomizer $random): array
    {
        do {
            $weekdays = array_values(array_filter([1, 2, 3, 4, 5], static fn (): bool => 1 === $random->getInt(0, 1)));
        } while ([] === $weekdays);

        return $weekdays;
    }

    /** « Jusqu'au », vide le plus souvent, sinon un jour à partir du jour joué. */
    private function until(Randomizer $random): ?string
    {
        if (0 !== $random->getInt(0, 2)) {
            return null;
        }
        $date = new \DateTimeImmutable($this->date)->modify(\sprintf('+%d days', $random->getInt(0, 40)));

        return $date->format('Y-m-d');
    }

    /**
     * Une plage écrite par la fenêtre : un créneau, ou deux voisins au même contenu.
     *
     * @param Content $content
     *
     * @return list<Change>
     */
    private static function split(Randomizer $random, int $start, int $end, array $content): array
    {
        if ($end - $start < 30 || 0 !== $random->getInt(0, 2)) {
            return [self::state(self::clock($start), self::clock($end), [...$content, null])];
        }
        $middle = $start + 15 * $random->getInt(1, intdiv($end - $start, 15) - 1);

        return [self::state(self::clock($start), self::clock($middle), [...$content, null]), self::state(self::clock($middle), self::clock($end), [...$content, null])];
    }

    /**
     * Les blocs d'un modèle : les quarts d'heure voisins au même contenu et à la même
     * récurrence, regroupés ici sans le code de l'application.
     *
     * @param array<int, Quarter> $model
     *
     * @return list<Block>
     */
    private static function blocksOf(array $model): array
    {
        $blocks = [];
        $open = null;
        for ($quarter = 0; $quarter <= self::QUARTERS; ++$quarter) {
            $state = $model[self::minute($quarter)] ?? null;
            if (null !== $open && $state === $open[1]) {
                continue;
            }
            if (null !== $open) {
                $blocks[] = [self::minute($open[0]), self::minute($quarter), $open[1]];
            }
            $open = null === $state ? null : [$quarter, $state];
        }

        return $blocks;
    }

    /**
     * Les blocs que l'API doit rendre pour un modèle.
     *
     * @param array<int, Quarter> $model
     *
     * @return list<array<string, ?string>>
     */
    private static function expectedBlocks(array $model): array
    {
        return array_map(static fn (array $block): array => [
            'start' => self::clock($block[0]),
            'end' => self::clock($block[1]),
            'kind' => $block[2][0],
            'ticket' => $block[2][1],
            'comment' => $block[2][2],
            'recurrence' => $block[2][3],
        ], self::blocksOf($model));
    }

    /**
     * Un créneau qui reprend un état du modèle : son contenu, et sa récurrence s'il en a une.
     *
     * @param Quarter $state
     *
     * @return Change
     */
    private static function state(string $start, string $end, array $state): array
    {
        $change = 'pause' === $state[0] ? self::pause($start, $end) : self::work($start, $end, (string) $state[1], $state[2]);

        return null === $state[3] ? $change : self::linked($change, $state[3]);
    }

    /**
     * Les débuts des quarts d'heure qu'un geste nomme.
     *
     * @param list<Change> $changes
     *
     * @return list<int>
     */
    private static function touched(array $changes): array
    {
        $minutes = [];
        foreach ($changes as $change) {
            foreach (self::quartersOf($change) as $quarter) {
                $minutes[] = self::minute($quarter);
            }
        }

        return $minutes;
    }

    /**
     * Des quarts d'heure, regroupés en plages qui se suivent : début et fin de chacune.
     *
     * @param list<int> $minutes
     *
     * @return list<array{int, int}>
     */
    private static function runs(array $minutes): array
    {
        sort($minutes);
        $runs = [];
        foreach ($minutes as $minute) {
            $last = array_key_last($runs);
            if (null !== $last && $runs[$last][1] === $minute) {
                $runs[$last][1] = $minute + 15;
            } else {
                $runs[] = [$minute, $minute + 15];
            }
        }

        return $runs;
    }

    /**
     * @return list<int>
     */
    private static function between(int $start, int $end): array
    {
        return range($start, $end - 15, 15);
    }

    /**
     * Les rangs des quarts d'heure d'un créneau, 0 pour 07:00.
     *
     * @param Change $change
     *
     * @return list<int>
     */
    private static function quartersOf(array $change): array
    {
        $first = intdiv(self::minuteOf((string) $change['start']) - 420, 15);
        $end = intdiv(self::minuteOf((string) $change['end']) - 420, 15);

        return range($first, $end - 1);
    }

    private static function minute(int $quarter): int
    {
        return 420 + 15 * $quarter;
    }

    private static function time(int $quarter): string
    {
        return self::clock(self::minute($quarter));
    }

    private static function clock(int $minute): string
    {
        return \sprintf('%02d:%02d', intdiv($minute, 60), $minute % 60);
    }

    private static function minuteOf(string $time): int
    {
        [$hours, $minutes] = explode(':', $time);

        return (int) $hours * 60 + (int) $minutes;
    }
}
