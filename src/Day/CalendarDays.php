<?php

namespace App\Day;

/**
 * Ce que le calendrier montre d'une plage de jours, au-delà des jours travaillés des
 * réglages : la marque de chaque jour qui en a une, et les jours déclarés non travaillés
 * — leur objectif mis à 0h00 —, qu'il grise comme un samedi, saisis ou non.
 */
final readonly class CalendarDays
{
    /**
     * @param array<string, DayMark> $marks   par jour « AAAA-MM-JJ » ; un jour absent n'en a pas
     * @param list<string>           $daysOff en jours « AAAA-MM-JJ », dans l'ordre
     */
    public function __construct(
        public array $marks,
        public array $daysOff,
    ) {
    }
}
