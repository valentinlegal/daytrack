<?php

namespace App\Recurrence;

use App\Entity\Recurrence;

/**
 * Deux récurrences qui voudraient le même créneau : leurs heures se croisent, et elles
 * tombent un même jour, chacune entre son premier jour et sa fin. Jamais deux tickets sur
 * un créneau : la seconde se refuse avant de s'enregistrer. Seuls comptent les jours qui
 * peuvent encore recevoir quelque chose — après aujourd'hui, pour le serveur — : un jour
 * déjà venu ne reçoit jamais rien après coup.
 *
 * Une fois détachée ou effacée « cette fois seulement » ne prend plus son créneau : seules
 * comptent les fois qui se poseraient encore. La même phase, plus loin, le prend toujours. Un
 * jour à venir déjà envoyé ne reçoit plus aucune récurrence (DaySendRepository::closedAfter) :
 * il compte comme une fois sautée pour toutes.
 *
 * Entre deux rythmes à la semaine, la recherche est exacte : leurs semaines se répètent
 * ensemble au bout du plus petit commun multiple de leurs « une semaine sur n », douze
 * semaines au plus. Avec un rythme mensuel, elle parcourt ses seules fois, mois par mois,
 * sur 28 ans au plus — le cycle des jours de la semaine d'un siècle. Ces bornes se comptent
 * après la dernière fois sautée. Si deux récurrences se croisaient malgré tout plus loin, la
 * plus ancienne se poserait, l'autre céderait : un quart d'heure n'a jamais qu'un contenu.
 *
 * Le navigateur fait la même recherche (assets/grid/recurrence.ts, firstClash), sur les
 * cas de tests/cases/recurrences.json : la fenêtre annonce le refus, le serveur le décide.
 */
final class RecurrenceClash
{
    public const int MONTHLY_YEARS = 28;

    /**
     * La première date où elles tombent toutes les deux au même créneau, après $after s'il
     * est donné, ou null.
     *
     * @param array<string, list<string>> $skipped les fois sautées de chacune, par identifiant (RecurrenceRepository::skippedAfter)
     * @param list<string>                $closed  les jours qu'un envoi ferme à toutes (DaySendRepository::closedAfter)
     */
    public static function first(Recurrence $a, Recurrence $b, ?\DateTimeImmutable $after = null, array $skipped = [], array $closed = []): ?\DateTimeImmutable
    {
        if ($a->start >= $b->end || $b->start >= $a->end) {
            return null;
        }
        $from = max($a->firstDay, $b->firstDay, ...(null === $after ? [] : [$after->modify('+1 day')]));
        $to = null === $a->until ? $b->until : (null === $b->until ? $a->until : min($a->until, $b->until));
        [$aRhythm, $bRhythm] = [$a->rhythm(), $b->rhythm()];
        $aSkipped = array_flip($skipped[$a->id->toRfc4122()] ?? []);
        $bSkipped = array_flip($skipped[$b->id->toRfc4122()] ?? []);
        $shut = array_flip($closed);
        $takes = static fn (Recurrence $recurrence, array $skips, \DateTimeImmutable $day): bool => $recurrence->fallsOn($day) && !isset($skips[$day->format('Y-m-d')]) && !isset($shut[$day->format('Y-m-d')]);
        // Les bornes se comptent après la dernière fois sautée : avant elle, chaque jour se juge.
        $last = max(['', ...array_map('strval', array_keys($aSkipped)), ...array_map('strval', array_keys($bSkipped)), ...$closed]);
        $base = '' === $last || $last < $from->format('Y-m-d') ? $from : max($from, new \DateTimeImmutable($last, $from->getTimezone())->modify('+1 day'));

        if ($aRhythm->isMonthly() || $bRhythm->isMonthly()) {
            [$monthly, $monthlySkipped, $other, $otherSkipped] = $aRhythm->isMonthly() ? [$a, $aSkipped, $b, $bSkipped] : [$b, $bSkipped, $a, $aSkipped];
            $rhythm = $monthly->rhythm();
            $limit = $base->modify(\sprintf('+%d years', self::MONTHLY_YEARS));
            $to = null === $to || $to > $limit ? $limit : $to;
            for ($month = $from->modify('first day of this month'); $month <= $to; $month = $month->modify('first day of next month')) {
                $day = $rhythm->dayIn((int) $month->format('Y'), (int) $month->format('n'));
                if (null !== $day && $day >= $from && $day <= $to && $takes($monthly, $monthlySkipped, $day) && $takes($other, $otherSkipped, $day)) {
                    return $day;
                }
            }

            return null;
        }

        $weeks = self::lcm($aRhythm->everyWeeks, $bRhythm->everyWeeks);
        // Une semaine de plus : la première, entamée, n'a pas ses jours d'avant le départ.
        $limit = $base->modify(\sprintf('+%d days', 7 * ($weeks + 1) - 1));
        $to = null === $to || $to > $limit ? $limit : $to;
        for ($day = $from; $day <= $to; $day = $day->modify('+1 day')) {
            if ($takes($a, $aSkipped, $day) && $takes($b, $bSkipped, $day)) {
                return $day;
            }
        }

        return null;
    }

    /**
     * Parmi les autres, celle qui prend le créneau le plus tôt après $after — la plus ancienne, à date
     * égale —, et ce jour-là ; null si le créneau est libre.
     *
     * @param iterable<Recurrence>        $others
     * @param array<string, list<string>> $skipped les fois sautées de chacune, par identifiant
     * @param list<string>                $closed  les jours qu'un envoi ferme à toutes
     *
     * @return ?array{Recurrence, \DateTimeImmutable}
     */
    public static function earliest(Recurrence $candidate, iterable $others, ?\DateTimeImmutable $after = null, array $skipped = [], array $closed = []): ?array
    {
        $found = null;
        foreach ($others as $other) {
            if ($other === $candidate) {
                continue;
            }
            $day = self::first($candidate, $other, $after, $skipped, $closed);
            if (null === $day) {
                continue;
            }
            $key = $day->format('Y-m-d').$other->id->toRfc4122();
            if (null === $found || strcmp($key, $found[1]->format('Y-m-d').$found[0]->id->toRfc4122()) < 0) {
                $found = [$other, $day];
            }
        }

        return $found;
    }

    /**
     * Sa fois de ce jour-là est sautée, et une autre en a pris le créneau depuis : elle y tombe,
     * sa fois n'y est pas sautée, leurs heures se croisent, et rien ne les croisait jusque-là.
     * Rendre la fois les mènerait l'une sur l'autre. Deux récurrences nées avant ce refus, qui
     * se croisaient déjà, n'y gagnent rien de plus : la plus ancienne se pose, l'autre cède.
     * Null quand le créneau est libre.
     *
     * @param iterable<Recurrence>        $others
     * @param array<string, list<string>> $skipped les fois sautées de chacune, par identifiant, la sienne de ce jour-là comprise
     * @param list<string>                $closed  les jours qu'un envoi ferme à toutes
     */
    public static function takenWhileSkipped(Recurrence $recurrence, iterable $others, \DateTimeImmutable $date, \DateTimeImmutable $today, array $skipped, array $closed): ?Recurrence
    {
        $day = $date->format('Y-m-d');
        foreach ($others as $other) {
            if ($other !== $recurrence
                && $recurrence->start < $other->end && $other->start < $recurrence->end
                && $other->fallsOn($date)
                && !\in_array($day, $skipped[$other->id->toRfc4122()] ?? [], true)
                && !\in_array($day, $closed, true)
                && null === self::first($recurrence, $other, $today, $skipped, $closed)) {
                return $other;
            }
        }

        return null;
    }

    private static function lcm(int $a, int $b): int
    {
        [$x, $y] = [$a, $b];
        while (0 !== $y) {
            [$x, $y] = [$y, $x % $y];
        }

        return intdiv($a * $b, $x);
    }
}
