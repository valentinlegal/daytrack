<?php

namespace App\Day;

/**
 * Les chiffres du jour, et leur seule définition côté serveur.
 *
 * Le navigateur les calcule aussi, pour suivre l'heure qui tourne : les cas de
 * tests/cases/day-figures.json éprouvent les deux calculs, et toute différence
 * entre eux est un bug.
 */
final readonly class DayFigures
{
    private const int MIDNIGHT = 1440;

    public function __construct(
        /** Les quarts d'heure saisis, pauses exclues, ceux posés plus tard dans la journée compris. */
        public int $worked,
        /** Ce qui manque pour atteindre l'objectif, jamais négatif. */
        public int $remaining,
        /** Le travaillé moins l'objectif. */
        public int $balance,
        /**
         * L'heure, en minutes depuis minuit, où l'objectif sera atteint, au quart
         * d'heure supérieur ; null quand il n'y en a pas.
         */
        public ?int $projectedEnd,
    ) {
    }

    /**
     * @param ?int $now l'heure qu'il est, en minutes depuis minuit, si la journée est
     *                  celle d'aujourd'hui ; null pour tout autre jour
     */
    public static function of(Grid $grid, int $objective, ?int $now): self
    {
        $worked = $grid->workedMinutes();
        $remaining = max(0, $objective - $worked);

        return new self(
            $worked,
            $remaining,
            $worked - $objective,
            null === $now || 0 === $remaining ? null : self::projectedEnd($grid, $objective, $now),
        );
    }

    /**
     * L'heure où l'objectif sera atteint en continuant à travailler, en respectant
     * les pauses déjà posées. Le créneau en cours compte comme travaillé, saisi ou
     * non, sauf si c'est une pause : on y travaille, et il se saisira entier. Le
     * saisir ne déplace donc pas la fin. Rien ne se saisit avant 07:00 : on ne compte
     * pas avant. Le compte se fait au quart d'heure, l'unité de la grille, et la fin
     * tombe sur un quart d'heure. À minuit ou après, il n'y a plus de fin prévue,
     * « Reste » suffit.
     */
    private static function projectedEnd(Grid $grid, int $objective, int $now): ?int
    {
        $quarter = max($now - $now % Quarter::MINUTES, Quarter::FIRST);
        $toWork = $objective - $grid->workedBefore($quarter);

        // Les pauses ne vivent que sur la grille : passé 20:00, chaque quart d'heure
        // compte, et la boucle s'arrête toujours.
        while ($toWork > 0) {
            if (!$grid->isPauseAt($quarter)) {
                $toWork -= Quarter::MINUTES;
            }
            $quarter += Quarter::MINUTES;
        }

        return $quarter < self::MIDNIGHT ? $quarter : null;
    }
}
