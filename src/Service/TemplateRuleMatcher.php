<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\TemplateRule;
use DateTimeImmutable;

/**
 * Détermine si une règle récurrente s'applique à une date donnée, et si deux règles
 * WORK/BREAK peuvent réellement tomber le même jour (même jour de semaine, et une
 * semaine commune à leurs deux récurrences) avec des horaires qui se recoupent.
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
     * Indique si deux règles WORK/BREAK peuvent réellement tomber le même jour
     * (même jour de semaine, et il existe une semaine où leurs deux récurrences
     * se déclenchent), auquel cas leurs plages horaires se recoupent-elles.
     *
     * Deux règles de cadences respectives iA et iB coïncident une semaine w si
     * w ≡ ancreA (mod iA) et w ≡ ancreB (mod iB). Ce système admet une solution
     * ⇔ (weekIndex(ancreA) − weekIndex(ancreB)) est divisible par pgcd(iA, iB)
     * (théorème des restes chinois). Pour iA = iB ça se réduit à l'égalité des
     * phases — le cas d'une alternance (mêmes cadence et créneau, phases opposées)
     * reste donc non-chevauchant.
     */
    public function overlaps(TemplateRule $a, TemplateRule $b): bool
    {
        if ($a->weekday !== $b->weekday) {
            return false;
        }

        $gcd = $this->gcd($a->intervalWeeks, $b->intervalWeeks);
        if (0 !== ($this->weekIndex($a->anchorDate) - $this->weekIndex($b->anchorDate)) % $gcd) {
            return false;
        }

        $startA = $this->toMinutes((string) $a->startTime);
        $endA = $startA + (int) $a->durationMinutes;
        $startB = $this->toMinutes((string) $b->startTime);
        $endB = $startB + (int) $b->durationMinutes;

        return $startA < $endB && $startB < $endA;
    }

    private function gcd(int $x, int $y): int
    {
        while (0 !== $y) {
            [$x, $y] = [$y, $x % $y];
        }

        return abs($x);
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
