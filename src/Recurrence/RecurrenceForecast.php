<?php

namespace App\Recurrence;

use App\Day\Grid;
use App\Day\Quarter;
use App\Day\UserCalendar;
use App\Entity\Day;
use App\Entity\Recurrence;
use App\Repository\DaySendRepository;
use App\Repository\RecurrenceRepository;
use App\Settings\UserSettings;

/**
 * Les fois prévues d'un jour à venir : ce que ses récurrences y poseront le jour venu,
 * montré dès maintenant, compté dans les chiffres, et jamais écrit avant ce jour-là, son
 * envoi, ou un geste qui les touche. Changer une récurrence change ainsi tous les jours à
 * venir d'un coup, sans rien réécrire.
 *
 * Elles suivent la règle du poseur (RecurrencePoser) : un jour travaillé selon les
 * réglages, sans objectif mis à 0h00, dont la fois n'est pas détachée, sur les seuls quarts
 * d'heure libres. Un jour déjà traité par une récurrence — celui où elle est née d'un bloc
 * qu'on a écrit — n'en prévoit rien : ce qu'elle y a posé est déjà écrit. Un jour envoyé
 * d'avance n'en prévoit plus aucune : son envoi les y a posées, comme le jour venu
 * (DaySendRepository::closesToRecurrences).
 */
final readonly class RecurrenceForecast
{
    public function __construct(
        private RecurrenceRepository $recurrences,
        private DaySendRepository $sends,
        private UserCalendar $calendar,
        private UserSettings $settings,
    ) {
    }

    /**
     * Les fois prévues ce jour-là, par quart d'heure : aucune un jour déjà venu ou envoyé,
     * non travaillé, ou mis à 0h00.
     *
     * @return array<int, Recurrence>
     */
    public function on(?Day $day, \DateTimeImmutable $date): array
    {
        if (!$this->isAhead($date) || !$this->settings->isWorkingDay($date) || true === $day?->isDeclaredOff() || (null !== $day && $this->sends->closesToRecurrences($day))) {
            return [];
        }
        $planned = [];
        foreach ($this->recurrences->fallingOn($date) as $recurrence) {
            if (self::treated($recurrence, $date) || $this->recurrences->isSkipped($recurrence, $date)) {
                continue;
            }
            $planned[$recurrence->id->toRfc4122()] = $recurrence;
        }
        if ([] === $planned) {
            return [];
        }

        $saved = $day?->grid() ?? Grid::empty();
        $shown = $saved->withPlanned(array_values(array_map(
            static fn (Recurrence $recurrence): array => [$recurrence->content(), $recurrence->start, $recurrence->end, $recurrence->id->toRfc4122()],
            $planned,
        )));
        $placed = [];
        foreach (Quarter::between(Quarter::FIRST, Quarter::DAY_END) as $quarter) {
            $link = $shown->linkAt($quarter);
            if (null !== $link && null === $saved->contentAt($quarter)) {
                $placed[$quarter] = $planned[$link];
            }
        }

        return $placed;
    }

    /**
     * La journée telle qu'elle se montre : ses saisies, et ses fois prévues.
     *
     * @param array<int, Recurrence> $planned celles de on()
     */
    public static function shown(Grid $saved, array $planned): Grid
    {
        $occurrences = [];
        foreach ($planned as $quarter => $recurrence) {
            $occurrences[] = [$recurrence->content(), $quarter, $quarter + Quarter::MINUTES, $recurrence->id->toRfc4122()];
        }

        return $saved->withPlanned($occurrences);
    }

    /**
     * Cette récurrence prévoit encore sa fois ce jour-là, si rien ne la détache : un lien
     * qu'annuler lui rend n'a rien à écrire, la fois redevient prévue.
     */
    public function plans(Recurrence $recurrence, Day $day, \DateTimeImmutable $date): bool
    {
        return $this->settings->isWorkingDay($date) && $this->awaits($recurrence, $day, $date);
    }

    /**
     * Cette fois ne s'écrit pas encore : la récurrence la prévoit, ou la prévoira quand le jour
     * redeviendra travaillé selon les réglages. Un jour à venir, ni déjà traité par elle, ni mis à
     * 0h00, ni envoyé.
     */
    public function awaits(Recurrence $recurrence, Day $day, \DateTimeImmutable $date): bool
    {
        return $this->isAhead($date) && !self::treated($recurrence, $date) && $recurrence->fallsOn($date)
            && !$day->isDeclaredOff() && !$this->sends->closesToRecurrences($day);
    }

    /** Après aujourd'hui, à l'heure de l'utilisateur. */
    public function isAhead(\DateTimeImmutable $date): bool
    {
        return $date->format('Y-m-d') > $this->calendar->today()->format('Y-m-d');
    }

    /** Ce jour-là a déjà été traité par elle : le jour de sa naissance d'un bloc, ou un jour déjà venu. */
    public static function treated(Recurrence $recurrence, \DateTimeImmutable $date): bool
    {
        return $date->format('Y-m-d') <= $recurrence->posedThrough->format('Y-m-d');
    }
}
