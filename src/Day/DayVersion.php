<?php

namespace App\Day;

use App\Entity\Day;
use App\Entity\Recurrence;

/**
 * La version d'une journée telle qu'un onglet l'a vue, et que ses écritures rapportent.
 *
 * Elle dit aussi ce que la journée montre sans que sa ligne change. Un jour à venir montre les
 * fois prévues de ses récurrences, que rien n'écrit : une récurrence changée depuis un autre
 * jour les change sans toucher à la journée. Et un bloc qu'une récurrence a posé perd sa flèche
 * quand elle s'arrête avant ce jour, depuis un autre jour (DayReader) : l'onglet qui la montre
 * encore rendrait par annuler un lien qui n'a plus où aller. Sa version dit donc lesquelles il
 * prévoit, et lesquelles ne vont plus jusqu'à lui — leur empreinte, au-dessus des 32 bits de la
 * version de la ligne —, et l'onglet qui ne l'a pas vu reçoit le refus habituel. Ce qu'elles
 * posent se déduit d'elles et des saisies du jour, que la version de la ligne couvre. Sans
 * l'une ni l'autre, c'est la version de la ligne : 0 pour un jour qui n'en a pas.
 */
final class DayVersion
{
    private const int ROW_BITS = 32;

    /** Ce que le navigateur lit sans perte : 2^53, soit 21 bits au-dessus de la ligne. */
    private const int PRINTS = (1 << 21) - 1;

    /**
     * @param ?Day                   $day     la journée telle qu'elle est en base, ou null si elle n'a pas de ligne
     * @param array<int, Recurrence> $planned les fois prévues, par quart d'heure (RecurrenceForecast)
     */
    public static function of(?Day $day, array $planned): int
    {
        $row = null === $day ? 0 : $day->version;
        if ($row < 0 || $row >= 1 << self::ROW_BITS) {
            throw new \OutOfRangeException(\sprintf('Une journée n\'a pas %d écritures.', $row));
        }
        $ended = null === $day ? [] : array_filter($day->linkedQuarters(), static fn (Recurrence $recurrence): bool => !$recurrence->reaches($day->date));
        if ([] === $planned && [] === $ended) {
            return $row;
        }
        $print = self::ids($planned);
        if ([] !== $ended) {
            $print .= ' / '.self::ids($ended);
        }

        // Jamais 0 : un jour qui prévoit quelque chose ne se lit pas comme un jour qui ne prévoit rien.
        return (1 + crc32($print) % self::PRINTS) << self::ROW_BITS | $row;
    }

    /**
     * @param array<array-key, Recurrence> $recurrences
     */
    private static function ids(array $recurrences): string
    {
        $ids = array_values(array_unique(array_map(static fn (Recurrence $recurrence): string => $recurrence->id->toRfc4122(), $recurrences)));
        sort($ids);

        return implode(' ', $ids);
    }
}
