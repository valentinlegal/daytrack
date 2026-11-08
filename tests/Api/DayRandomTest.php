<?php

namespace App\Tests\Api;

use App\Tests\Support\DayApi;
use App\Tests\Support\JiraApi;
use App\Tests\Support\RandomSuite;
use Random\Randomizer;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

/**
 * Des suites de gestes tirées au hasard, jouées contre l'API comme le ferait la
 * page : poser, superposer, coller avec des trous, effacer, convertir en pause,
 * changer l'objectif, annuler — mêlés à des onglets en retard, des gestes envoyés
 * deux fois et des gestes refusés, dont des tickets que Jira ne connaît pas.
 *
 * Un modèle tenu à côté, quart d'heure par quart d'heure, dit ce que la journée
 * doit être. Après chaque geste, la base, les blocs rendus et les chiffres doivent
 * lui être identiques : ni double, ni fantôme, ni chevauchement, et le travaillé
 * égal à la somme des blocs. Pour finir, tout annuler ramène à la journée vide, et
 * tout rétablir à celle d'avant.
 *
 * Chaque passage tire une graine neuve ; RANDOM_SEED en rejoue une. RANDOM_SEQUENCES
 * règle le nombre de suites : modéré par défaut, pour l'intégration continue, autant
 * qu'on veut en local.
 */
final class DayRandomTest extends WebTestCase
{
    use DayApi;
    use JiraApi;
    use RandomSuite;

    private const int SEQUENCES = 40;

    private const int STEPS = 30;

    private const int QUARTERS = 52;

    /** Peu de contenus, pour que des voisins identiques se rencontrent souvent. */
    private const array CONTENTS = [
        ['work', 'SHOP-482', null],
        ['work', 'SHOP-482', 'Tests'],
        ['work', 'OPS-7', null],
        ['work', 'OPS-7', 'Revue'],
        ['pause', null, null],
    ];

    /** @var array<int, array{string, ?string, ?string}> le modèle : chaque quart d'heure occupé, par son début */
    private array $model = [];

    private int $version = 0;

    private int $objective = 450;

    public function testDesSuitesDeGestesLaissentExactementLaJourneeAttendue(): void
    {
        $random = $this->randomizer();
        $sequences = getenv('RANDOM_SEQUENCES');
        $sequences = false !== $sequences && '' !== $sequences ? (int) $sequences : self::SEQUENCES;
        for ($sequence = 0; $sequence < $sequences; ++$sequence) {
            self::purgeDatabase();
            $this->linkJira();
            $this->model = [];
            $this->version = 0;
            $this->objective = 450;

            /** @var list<array{list<array<string, ?string>>, list<array<string, ?string>>}> $done chaque geste et son inverse */
            $done = [];
            $last = null;

            for ($step = 0; $step < self::STEPS; ++$step) {
                $roll = $random->getInt(1, 100);

                if ($roll <= 55 || [] === $done) {
                    $gesture = $this->gesture($random);
                    $inverse = $this->inverse($gesture);
                    $this->apply($gesture);
                    $done[] = [$gesture, $inverse];
                    $last = $gesture;
                } elseif ($roll <= 70) {
                    [, $inverse] = array_pop($done);
                    $this->apply($inverse);
                    $last = $inverse;
                } elseif ($roll <= 78 && $this->version > 0) {
                    $this->refusedAsStale($this->version - $random->getInt(1, $this->version), $this->gesture($random));
                } elseif ($roll <= 85 && null !== $last && $this->version > 0) {
                    // La même requête, partie deux fois : la seconde ne passe pas.
                    $this->refusedAsStale($this->version - 1, $last);
                } elseif ($roll <= 93) {
                    $this->refusedAsInvalid($this->hostile($random));
                } else {
                    $this->changeObjective(15 * $random->getInt(0, 52));
                }

                $this->assertMatchesModel();
            }

            $before = $this->model;
            foreach (array_reverse($done) as [, $inverse]) {
                $this->apply($inverse);
            }
            self::assertSame([], $this->rows(), 'Tout annuler ramène à la journée vide.');
            $this->assertMatchesModel();

            foreach ($done as [$gesture]) {
                $this->apply($gesture);
            }
            self::assertSame($before, $this->model);
            $this->assertMatchesModel();
        }
    }

    /**
     * Un geste juste : un à trois créneaux disjoints, chacun rempli ou vidé.
     *
     * @return list<array<string, ?string>>
     */
    private function gesture(Randomizer $random): array
    {
        $changes = [];
        $taken = [];
        for ($count = $random->getInt(1, 3); \count($changes) < $count;) {
            $first = $random->getInt(0, self::QUARTERS - 1);
            $length = min($random->getInt(1, 8), self::QUARTERS - $first);
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
                : self::change($start, $end, self::CONTENTS[$pick]);
        }

        return $changes;
    }

    /**
     * Ce qui défait un geste : chaque quart d'heure qu'il touche reprend son contenu d'avant.
     *
     * @param list<array<string, ?string>> $gesture
     *
     * @return list<array<string, ?string>>
     */
    private function inverse(array $gesture): array
    {
        $inverse = [];
        foreach ($gesture as $change) {
            foreach (self::quartersOf($change) as $quarter) {
                $start = self::time($quarter);
                $end = self::time($quarter + 1);
                $before = $this->model[self::minute($quarter)] ?? null;
                $inverse[] = null === $before ? self::clear($start, $end) : self::change($start, $end, $before);
            }
        }

        return $inverse;
    }

    /**
     * Un geste qu'aucun écran n'envoie : hors de la grille, hors du quart d'heure, qui
     * se chevauche lui-même, ou dont un ticket n'existe pas dans Jira.
     *
     * @return list<array<string, ?string>>
     */
    private function hostile(Randomizer $random): array
    {
        return match ($random->getInt(0, 6)) {
            0 => [self::work('06:45', '07:15', 'SHOP-482')],
            1 => [self::work('19:45', '20:15', 'OPS-7')],
            2 => [self::work('10:05', '10:30', 'SHOP-482')],
            3 => [self::pause('12:00', '13:00'), self::work('12:45', '13:15', 'OPS-7')],
            4 => [self::work('10:00', '10:15', 'SHOP-999')],
            5 => [self::work('09:00', '09:30', 'SHOP-482'), self::clear('10:00', '10:30'), self::work('11:00', '11:15', 'SHOP-999', 'Revue')],
            default => [self::clear('09:00', '10:00'), self::work('10:00', '10:15', 'SHOP-0')],
        };
    }

    /**
     * @param list<array<string, ?string>> $gesture
     */
    private function apply(array $gesture): void
    {
        $day = $this->write($this->version, $gesture);

        // Effacer sur un jour jamais saisi ne le crée pas : il reste en version 0.
        $clearsOnly = [] === array_filter($gesture, static fn (array $change): bool => 'empty' !== $change['kind']);
        if (0 !== $this->version || !$clearsOnly) {
            ++$this->version;
        }

        foreach ($gesture as $change) {
            foreach (self::quartersOf($change) as $quarter) {
                if ('empty' === $change['kind']) {
                    unset($this->model[self::minute($quarter)]);
                } else {
                    $this->model[self::minute($quarter)] = [(string) $change['kind'], $change['ticket'] ?? null, $change['comment'] ?? null];
                }
            }
        }
        ksort($this->model);

        // Ce que rend le geste est ce que la grille affichera : il doit déjà être juste.
        $this->assertDay($day);
    }

    private function changeObjective(int $objective): void
    {
        [$status] = $this->putObjective($this->version, $objective);
        self::assertSame(200, $status);
        ++$this->version;
        $this->objective = $objective;
    }

    /**
     * @param list<array<string, ?string>> $gesture
     */
    private function refusedAsStale(int $version, array $gesture): void
    {
        [$status] = $this->patchSlots($version, $gesture);
        self::assertSame(409, $status, \sprintf('Version %d acceptée alors que la journée est en %d.', $version, $this->version));
    }

    /**
     * @param list<array<string, ?string>> $gesture
     */
    private function refusedAsInvalid(array $gesture): void
    {
        [$status] = $this->patchSlots($this->version, $gesture);
        self::assertSame(422, $status, json_encode($gesture, \JSON_THROW_ON_ERROR));
    }

    private function assertMatchesModel(): void
    {
        $expectedRows = [];
        foreach ($this->model as $start => [$kind, $ticket, $comment]) {
            $expectedRows[] = ['start' => $start, 'kind' => $kind, 'ticket' => $ticket, 'comment' => $comment];
        }
        self::assertSame($expectedRows, $this->rows(), 'La base tient exactement un créneau par quart d\'heure occupé.');

        $this->assertDay($this->day());
    }

    /**
     * @param array<mixed> $day
     */
    private function assertDay(array $day): void
    {
        self::assertSame($this->version, $day['version']);
        self::assertSame($this->objective, $day['objective']);

        $blocks = self::listAt($day, 'blocks');
        self::assertSame($this->expectedBlocks(), $blocks, 'Les blocs rendus sont ceux de la base.');

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

        $workQuarters = \count(array_filter($this->model, static fn (array $content): bool => 'work' === $content[0]));
        self::assertSame(15 * $workQuarters, $worked);
        self::assertSame([
            'worked' => $worked,
            'remaining' => max(0, $this->objective - $worked),
            'balance' => $worked - $this->objective,
        ], array_intersect_key(self::arrayAt($day, 'figures'), ['worked' => 0, 'remaining' => 0, 'balance' => 0]));
    }

    /**
     * Les blocs que le modèle donne, regroupés ici sans le code de l'application.
     *
     * @return list<array<string, ?string>>
     */
    private function expectedBlocks(): array
    {
        $blocks = [];
        $open = null;
        for ($quarter = 0; $quarter <= self::QUARTERS; ++$quarter) {
            $content = $this->model[self::minute($quarter)] ?? null;
            if (null !== $open && $content === $open[1]) {
                continue;
            }
            if (null !== $open) {
                $blocks[] = ['start' => self::time($open[0]), 'end' => self::time($quarter), 'kind' => $open[1][0], 'ticket' => $open[1][1], 'comment' => $open[1][2]];
            }
            $open = null === $content ? null : [$quarter, $content];
        }

        return $blocks;
    }

    /**
     * @param array{string, ?string, ?string} $content
     *
     * @return array<string, ?string>
     */
    private static function change(string $start, string $end, array $content): array
    {
        return 'pause' === $content[0] ? self::pause($start, $end) : self::work($start, $end, (string) $content[1], $content[2]);
    }

    /**
     * Les rangs des quarts d'heure d'un créneau, 0 pour 07:00.
     *
     * @param array<string, ?string> $change
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
        $minute = self::minute($quarter);

        return \sprintf('%02d:%02d', intdiv($minute, 60), $minute % 60);
    }

    private static function minuteOf(string $time): int
    {
        [$hours, $minutes] = explode(':', $time);

        return (int) $hours * 60 + (int) $minutes;
    }
}
