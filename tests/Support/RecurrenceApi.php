<?php

namespace App\Tests\Support;

use App\Day\Quarter;
use App\Day\SlotContent;
use App\Day\UserCalendar;
use App\Entity\Recurrence;
use App\Recurrence\Rhythm;
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\Assert;
use Symfony\Component\Uid\Uuid;

/**
 * Enregistrer une récurrence comme le fait la fenêtre d'un ticket ou d'une pause, et
 * regarder ce que la base en garde. S'ajoute à DayApi, dont il reprend le navigateur.
 */
trait RecurrenceApi
{
    /**
     * « Enregistrer » dans la fenêtre, la case « Récurrence » cochée ($rule) ou décochée (null),
     * sur le bloc que portait la récurrence $replaces, vue telle que la base la garde. Le
     * collage d'une récurrence coupée nomme celle dont elle vient ($follows).
     *
     * @param list<array<string, ?string>> $changes
     * @param ?array<string, mixed>        $rule
     * @param array<string, string>        $server
     *
     * @return array{int, array<mixed>}
     */
    protected function putRecurrence(int $version, array $changes, ?array $rule, ?string $replaces = null, string $date = self::TODAY, array $server = self::SAME_ORIGIN, ?string $follows = null): array
    {
        $body = ['version' => $version, 'changes' => $changes, 'recurrence' => $rule, 'replaces' => null === $replaces ? null : $this->seen($replaces)];

        return $this->send('PUT', '/api/days/'.$date.'/recurrence', $body + (null === $follows ? [] : ['follows' => $follows]), $server);
    }

    /**
     * Ce que la fenêtre voit d'une récurrence, telle que la base la garde : ses jours et sa
     * fin. Une récurrence absente de la base se voit sans fin, du lundi au vendredi.
     *
     * @return array{id: string, weekdays: list<int>, until: ?string}
     */
    protected function seen(string $id): array
    {
        $row = Uuid::isValid($id) ? $this->connection()->fetchAssociative('SELECT weekdays, until FROM recurrence WHERE id = ?', [Uuid::fromString($id)->toBinary()]) : false;
        if (false === $row) {
            return ['id' => $id, 'weekdays' => [1, 2, 3, 4, 5], 'until' => null];
        }
        Assert::assertIsString($row['weekdays']);
        Assert::assertTrue(null === $row['until'] || \is_string($row['until']));
        $weekdays = json_decode($row['weekdays'], true, flags: \JSON_THROW_ON_ERROR);
        Assert::assertIsArray($weekdays);

        return ['id' => $id, 'weekdays' => array_values(array_map(static fn (mixed $day): int => \is_int($day) ? $day : throw new \UnexpectedValueException('Un jour de la semaine est un entier.'), $weekdays)), 'until' => $row['until']];
    }

    /**
     * Un enregistrement qui doit passer : rend la journée écrite, avec ses fins.
     *
     * @param list<array<string, ?string>> $changes
     * @param ?array<string, mixed>        $rule
     *
     * @return array<mixed>
     */
    protected function saveRecurrence(int $version, array $changes, ?array $rule, ?string $replaces = null, string $date = self::TODAY, ?string $follows = null): array
    {
        [$status, $day] = $this->putRecurrence($version, $changes, $rule, $replaces, $date, follows: $follows);
        Assert::assertSame(200, $status, json_encode($day, \JSON_THROW_ON_ERROR));

        return $day;
    }

    /**
     * Un geste de la grille qui rend aussi leur fin à des récurrences : annuler, rétablir.
     *
     * @param list<array<string, ?string>> $changes
     * @param list<array<string, ?string>> $rewinds
     * @param array<string, string>        $server
     *
     * @return array{int, array<mixed>}
     */
    protected function patchSlotsWith(int $version, array $changes, array $rewinds, string $date = self::TODAY, array $server = self::SAME_ORIGIN): array
    {
        return $this->send('PATCH', '/api/days/'.$date.'/slots', ['version' => $version, 'changes' => $changes, 'recurrences' => $rewinds], $server);
    }

    /**
     * @param list<array<string, ?string>> $changes
     * @param list<array<string, ?string>> $rewinds
     *
     * @return array<mixed>
     */
    protected function writeWith(int $version, array $changes, array $rewinds, string $date = self::TODAY): array
    {
        [$status, $day] = $this->patchSlotsWith($version, $changes, $rewinds, $date);
        Assert::assertSame(200, $status, json_encode($day, \JSON_THROW_ON_ERROR));

        return $day;
    }

    /**
     * Une récurrence créée sur un bloc : son identifiant, et la journée écrite.
     *
     * @param array<string, ?string> $change
     * @param list<int>              $weekdays
     *
     * @return array{string, array<mixed>}
     */
    protected function repeat(int $version, array $change, array $weekdays = [1, 2, 3, 4, 5], ?string $until = null, string $date = self::TODAY): array
    {
        $day = $this->saveRecurrence($version, [$change], self::weekly($weekdays, $until), null, $date);
        $untils = self::listAt($day, 'untils');
        Assert::assertCount(1, $untils);

        return [self::stringAt($untils, 0, 'recurrence'), $day];
    }

    /**
     * Une récurrence créée sur un bloc, à n'importe quel rythme : son identifiant, et la
     * journée écrite.
     *
     * @param array<string, ?string> $change
     * @param array<string, mixed>   $rule
     *
     * @return array{string, array<mixed>}
     */
    protected function repeatWith(int $version, array $change, array $rule, string $date = self::TODAY): array
    {
        $day = $this->saveRecurrence($version, [$change], $rule, null, $date);
        $untils = self::listAt($day, 'untils');
        Assert::assertCount(1, $untils);

        return [self::stringAt($untils, 0, 'recurrence'), $day];
    }

    /**
     * @param list<int> $weekdays
     *
     * @return array{weekdays: list<int>, until: ?string}
     */
    protected static function weekly(array $weekdays = [1, 2, 3, 4, 5], ?string $until = null): array
    {
        return ['weekdays' => $weekdays, 'until' => $until];
    }

    /**
     * « Une semaine sur $everyWeeks », ses jours, comme la fenêtre l'envoie : tout le rythme.
     *
     * @param list<int> $weekdays
     *
     * @return array{kind: string, weekdays: list<int>, everyWeeks: int, monthWeek: null, monthDay: null, until: ?string}
     */
    protected static function everyWeeks(int $everyWeeks, array $weekdays, ?string $until = null): array
    {
        return ['kind' => 'weekly', 'weekdays' => $weekdays, 'everyWeeks' => $everyWeeks, 'monthWeek' => null, 'monthDay' => null, 'until' => $until];
    }

    /**
     * « Le 3e vendredi du mois » : monthlyWeekday(5, 3) ; « le dernier vendredi » : monthlyWeekday(5, -1).
     *
     * @return array{kind: string, weekdays: list<int>, everyWeeks: int, monthWeek: int, monthDay: null, until: ?string}
     */
    protected static function monthlyWeekday(int $weekday, int $week, ?string $until = null): array
    {
        return ['kind' => 'monthly_weekday', 'weekdays' => [$weekday], 'everyWeeks' => 1, 'monthWeek' => $week, 'monthDay' => null, 'until' => $until];
    }

    /**
     * « Le 16 de chaque mois ».
     *
     * @return array{kind: string, weekdays: list<int>, everyWeeks: int, monthWeek: null, monthDay: int, until: ?string}
     */
    protected static function monthlyDate(int $day, ?string $until = null): array
    {
        return ['kind' => 'monthly_date', 'weekdays' => [], 'everyWeeks' => 1, 'monthWeek' => null, 'monthDay' => $day, 'until' => $until];
    }

    /**
     * Une récurrence écrite directement en base, sans passer par la fenêtre : de quoi garder
     * deux récurrences qui se croisent, comme celles d'avant que le serveur refuse un créneau
     * pris, ou qui ne se croiseraient qu'au-delà de la recherche (RecurrenceClash). Elle a
     * traité son premier jour, comme si elle y était née d'un bloc.
     */
    protected function storeRecurrence(SlotContent $content, string $start, string $end, Rhythm $rhythm, string $firstDay, ?string $until = null): string
    {
        $first = UserCalendar::date($firstDay) ?? throw new \LogicException($firstDay.' n\'est pas une date.');
        $recurrence = new Recurrence(
            $content,
            Quarter::parse($start) ?? throw new \LogicException($start),
            Quarter::parse($end) ?? throw new \LogicException($end),
            $rhythm,
            $first,
            null === $until ? null : UserCalendar::date($until),
            $first,
        );
        $entityManager = static::getContainer()->get(EntityManagerInterface::class);
        $entityManager->persist($recurrence);
        $entityManager->flush();

        return $recurrence->id->toRfc4122();
    }

    /**
     * Un créneau rendu à la récurrence qui l'avait posé, comme annuler et rétablir le font.
     *
     * @param array<string, ?string> $change
     *
     * @return array<string, ?string>
     */
    protected static function linked(array $change, string $recurrence): array
    {
        return $change + ['recurrence' => $recurrence];
    }

    /**
     * Les blocs d'une journée rendue, chacun suivi de la récurrence qui l'a posé, nommée par
     * $names : « 09:15-09:30 OPS-12 « Daily » ↻daily ».
     *
     * @param array<mixed>          $day
     * @param array<string, string> $names chaque récurrence par son identifiant
     *
     * @return list<string>
     */
    protected static function arrows(array $day, array $names = []): array
    {
        $recurrences = array_map(static function (array $block) use ($names): string {
            $recurrence = self::at($block, 'recurrence');
            Assert::assertTrue(null === $recurrence || \is_string($recurrence));

            return null === $recurrence ? '' : ' ↻'.($names[$recurrence] ?? $recurrence);
        }, self::listAt($day, 'blocks'));

        return array_map(static fn (string $block, string $recurrence): string => $block.$recurrence, self::blocks($day), $recurrences);
    }

    /**
     * La récurrence de chaque quart d'heure occupé d'un jour, dans la base, par son début.
     *
     * @return array<int, ?string>
     */
    protected function links(string $date = self::TODAY): array
    {
        $links = [];
        foreach ($this->connection()->fetchAllAssociative(
            'SELECT slot.start, slot.recurrence_id FROM slot JOIN day ON day.id = slot.day_id WHERE day.date = ? ORDER BY slot.start',
            [$date],
        ) as $row) {
            Assert::assertIsInt($row['start']);
            $links[$row['start']] = \is_string($row['recurrence_id']) ? Uuid::fromBinary($row['recurrence_id'])->toRfc4122() : null;
        }

        return $links;
    }

    /**
     * Ce que la base garde d'une récurrence : son premier jour, sa fin, son dernier jour traité.
     *
     * @return array{firstDay: string, until: ?string, posedThrough: string}
     */
    protected function recurrenceRow(string $id): array
    {
        $row = $this->connection()->fetchAssociative('SELECT first_day, until, posed_through FROM recurrence WHERE id = ?', [Uuid::fromString($id)->toBinary()]);
        Assert::assertIsArray($row, 'Récurrence absente de la base : '.$id);
        Assert::assertIsString($row['first_day']);
        Assert::assertTrue(null === $row['until'] || \is_string($row['until']));
        Assert::assertIsString($row['posed_through']);

        return ['firstDay' => $row['first_day'], 'until' => $row['until'], 'posedThrough' => $row['posed_through']];
    }

    protected function recurrenceRows(): int
    {
        $count = $this->connection()->fetchOne('SELECT COUNT(*) FROM recurrence');
        Assert::assertIsNumeric($count);

        return (int) $count;
    }

    /**
     * Les fois détachées, « identifiant date », dans l'ordre. Avec $held, seulement celles qu'un
     * jour mis à 0h00 retient, ou seulement les autres.
     *
     * @return list<string>
     */
    protected function skips(?bool $held = null): array
    {
        $rows = array_filter(
            $this->connection()->fetchAllAssociative('SELECT recurrence_id, date, held FROM recurrence_skip'),
            static fn (array $row): bool => null === $held || $held === (bool) $row['held'],
        );
        $skips = array_map(static function (array $row): string {
            Assert::assertIsString($row['recurrence_id']);
            Assert::assertIsString($row['date']);

            return Uuid::fromBinary($row['recurrence_id'])->toRfc4122().' '.$row['date'];
        }, array_values($rows));
        sort($skips);

        return $skips;
    }

    protected function setWorkingDay(int $day, bool $worked): void
    {
        [$status] = $this->send('PUT', '/api/settings/working-days/'.$day, ['worked' => $worked]);
        Assert::assertSame(200, $status);
    }
}
