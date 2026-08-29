<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\TemplateRule;
use DateTimeImmutable;

/**
 * Détermine si une règle récurrente s'applique à une date donnée, et si deux règles
 * WORK/BREAK peuvent réellement tomber le même jour (même jour de semaine, même
 * cadence, même phase) avec des horaires qui se recoupent.
 */
final class TemplateRuleMatcher
{
    private const string EPOCH = '1970-01-01';

    public function matches(TemplateRule $rule, DateTimeImmutable $date): bool
    {
        if (!$rule->enabled) {
            return false;
        }

        $day = $date->setTime(0, 0);

        if ($day < $rule->activeFrom) {
            return false;
        }

        if (null !== $rule->activeUntil && $day > $rule->activeUntil) {
            return false;
        }

        if ((int) $day->format('N') !== $rule->weekday) {
            return false;
        }

        return $this->weekIndex($day) % $rule->intervalWeeks === $this->weekPhase($rule);
    }

    /**
     * Indique si deux règles WORK/BREAK partagent le même jour de semaine, la même
     * cadence et la même phase (elles peuvent donc réellement tomber le même jour),
     * et si leurs plages horaires se recoupent dans ce cas.
     */
    public function overlaps(TemplateRule $a, TemplateRule $b): bool
    {
        if ($a->weekday !== $b->weekday || $a->intervalWeeks !== $b->intervalWeeks) {
            return false;
        }

        if ($this->weekPhase($a) !== $this->weekPhase($b)) {
            return false;
        }

        $startA = $this->toMinutes((string) $a->startTime);
        $endA = $startA + (int) $a->durationMinutes;
        $startB = $this->toMinutes((string) $b->startTime);
        $endB = $startB + (int) $b->durationMinutes;

        return $startA < $endB && $startB < $endA;
    }

    private function weekPhase(TemplateRule $rule): int
    {
        return $this->weekIndex($rule->anchorDate) % $rule->intervalWeeks;
    }

    private function weekIndex(DateTimeImmutable $date): int
    {
        $epoch = new DateTimeImmutable(self::EPOCH);

        return intdiv((int) $epoch->diff($date)->days, 7);
    }

    private function toMinutes(string $time): int
    {
        [$hours, $minutes] = explode(':', $time);

        return ((int) $hours * 60) + (int) $minutes;
    }
}
