<?php

namespace App\Day;

/**
 * Le quart d'heure, l'unité de la grille.
 *
 * Un quart d'heure se désigne par son début, en minutes depuis minuit, à l'heure
 * de l'utilisateur : 09:15 vaut 555. C'est une heure affichée sur la grille, pas un
 * instant — le changement d'heure, la nuit, ne la déplace pas.
 */
final class Quarter
{
    public const int MINUTES = 15;

    /** 07:00, le premier quart d'heure de la grille. */
    public const int FIRST = 420;

    /** 20:00, la fin de la grille : le dernier quart d'heure commence à 19:45. */
    public const int DAY_END = 1200;

    /** 13h00, toute la grille. */
    public const int GRID_MINUTES = self::DAY_END - self::FIRST;

    /**
     * Lit une heure écrite « HH:MM ». Rend null pour tout ce qui n'en est pas une,
     * qu'elle tombe sur un quart d'heure ou non.
     */
    public static function parse(string $time): ?int
    {
        if (1 !== preg_match('/^([01]\d|2[0-3]):([0-5]\d)$/D', $time, $parts)) {
            return null;
        }

        return (int) $parts[1] * 60 + (int) $parts[2];
    }

    public static function format(int $minutes): string
    {
        return \sprintf('%02d:%02d', intdiv($minutes, 60), $minutes % 60);
    }

    /** Une heure où un quart d'heure de la grille commence ou finit : 07:00 à 20:00. */
    public static function isBoundary(int $minutes): bool
    {
        return $minutes >= self::FIRST && $minutes <= self::DAY_END && 0 === $minutes % self::MINUTES;
    }

    /**
     * Les débuts des quarts d'heure de [$start, $end[.
     *
     * @return list<int>
     */
    public static function between(int $start, int $end): array
    {
        return $start < $end ? range($start, $end - self::MINUTES, self::MINUTES) : [];
    }
}
