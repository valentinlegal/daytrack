<?php

namespace App\Recurrence;

/**
 * Le rythme d'une récurrence : les jours où elle tombe, comptés depuis son premier jour.
 *
 * Le navigateur calcule les mêmes fois (assets/grid/recurrence.ts), sur les cas de
 * tests/cases/recurrences.json : la fenêtre les annonce, le serveur les pose. Les jours
 * se comptent en dates du calendrier, jamais en durées : un changement d'heure n'y change
 * rien.
 */
final readonly class Rhythm
{
    /** Le dernier jour de la semaine du mois, pour MonthlyWeekday. */
    public const int LAST = -1;

    public const int MAX_EVERY_WEEKS = 4;

    /**
     * @param list<int> $weekdays en jours de la semaine ISO, du lundi (1) au dimanche (7), dans l'ordre
     */
    private function __construct(
        public RhythmKind $kind,
        public array $weekdays,
        public int $everyWeeks,
        public ?int $monthWeek,
        public ?int $monthDay,
    ) {
    }

    /**
     * @param list<int> $weekdays
     */
    public static function weekly(array $weekdays, int $everyWeeks = 1): self
    {
        if ([] === $weekdays || [] !== array_filter($weekdays, static fn (int $day): bool => $day < 1 || $day > 7)) {
            throw new \InvalidArgumentException('Une récurrence revient au moins un jour de la semaine.');
        }
        if ($everyWeeks < 1 || $everyWeeks > self::MAX_EVERY_WEEKS) {
            throw new \InvalidArgumentException(\sprintf('Une récurrence revient au plus une semaine sur %d.', self::MAX_EVERY_WEEKS));
        }
        $weekdays = array_values(array_unique($weekdays));
        sort($weekdays);

        return new self(RhythmKind::Weekly, $weekdays, $everyWeeks, null, null);
    }

    /** Le n-ième $weekday du mois, de 1 à 4, ou le dernier (LAST). */
    public static function monthlyWeekday(int $weekday, int $week): self
    {
        if ($weekday < 1 || $weekday > 7 || (self::LAST !== $week && ($week < 1 || $week > 4))) {
            throw new \InvalidArgumentException('Un jour du mois se nomme du 1er au 4e, ou le dernier.');
        }

        return new self(RhythmKind::MonthlyWeekday, [$weekday], 1, $week, null);
    }

    public static function monthlyDate(int $day): self
    {
        if ($day < 1 || $day > 31) {
            throw new \InvalidArgumentException('Une date du mois va du 1er au 31.');
        }

        return new self(RhythmKind::MonthlyDate, [], 1, null, $day);
    }

    /** La récurrence partie de $first tombe ce jour-là, selon son rythme seul. */
    public function fallsOn(\DateTimeImmutable $date, \DateTimeImmutable $first): bool
    {
        $weekday = (int) $date->format('N');

        return match ($this->kind) {
            RhythmKind::Weekly => \in_array($weekday, $this->weekdays, true)
                && 0 === intdiv(self::daysBetween(self::monday($first), self::monday($date)), 7) % $this->everyWeeks,
            RhythmKind::MonthlyWeekday => \in_array($weekday, $this->weekdays, true)
                && (self::LAST === $this->monthWeek
                    ? $date->modify('+7 days')->format('m') !== $date->format('m')
                    : (int) ceil((int) $date->format('j') / 7) === $this->monthWeek),
            RhythmKind::MonthlyDate => (int) $date->format('j') === $this->monthDay,
        };
    }

    public function equals(self $other): bool
    {
        return $this->kind === $other->kind && $this->weekdays === $other->weekdays && $this->everyWeeks === $other->everyWeeks
            && $this->monthWeek === $other->monthWeek && $this->monthDay === $other->monthDay;
    }

    public function isMonthly(): bool
    {
        return RhythmKind::Weekly !== $this->kind;
    }

    /**
     * Un rythme mensuel que ce jour permet : le sien — son rang dans le mois, du 1er au 4e,
     * « le dernier » s'il l'est, ou sa date. La fenêtre ne propose que ceux-là ; un « 5e
     * jeudi » n'existe pas tous les mois. Un rythme à la semaine n'a pas à tomber ce jour-là :
     * créé un vendredi pour chaque lundi, le bloc n'en est simplement pas une fois.
     */
    public function permittedBy(\DateTimeImmutable $date): bool
    {
        return match ($this->kind) {
            RhythmKind::Weekly => true,
            RhythmKind::MonthlyWeekday => [(int) $date->format('N')] === $this->weekdays
                && (self::LAST === $this->monthWeek
                    ? $date->modify('+7 days')->format('m') !== $date->format('m')
                    : (int) ceil((int) $date->format('j') / 7) === $this->monthWeek),
            RhythmKind::MonthlyDate => (int) $date->format('j') === $this->monthDay,
        };
    }

    /**
     * Le jour où un rythme mensuel tombe dans ce mois, ou null s'il n'y tombe pas : le 31 d'un
     * mois de 30 jours. Un rythme à la semaine n'a pas de jour du mois.
     */
    public function dayIn(int $year, int $month): ?\DateTimeImmutable
    {
        $first = new \DateTimeImmutable(\sprintf('%04d-%02d-01', $year, $month), new \DateTimeZone('UTC'));
        $length = (int) $first->format('t');
        $weekday = $this->weekdays[0] ?? 1;
        $day = match ($this->kind) {
            RhythmKind::Weekly => null,
            RhythmKind::MonthlyDate => $this->monthDay <= $length ? $this->monthDay : null,
            RhythmKind::MonthlyWeekday => self::LAST === $this->monthWeek
                ? $length - ((int) $first->modify(\sprintf('+%d days', $length - 1))->format('N') - $weekday + 7) % 7
                : 1 + ($weekday - (int) $first->format('N') + 7) % 7 + 7 * (($this->monthWeek ?? 1) - 1),
        };

        return null === $day ? null : $first->modify(\sprintf('+%d days', $day - 1));
    }

    private static function monday(\DateTimeImmutable $date): \DateTimeImmutable
    {
        return $date->modify(\sprintf('-%d days', (int) $date->format('N') - 1));
    }

    /** Des dates à minuit, en heure universelle : la différence se compte en jours entiers. */
    private static function daysBetween(\DateTimeImmutable $from, \DateTimeImmutable $to): int
    {
        return (int) $from->diff($to)->format('%r%a');
    }
}
