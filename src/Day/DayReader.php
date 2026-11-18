<?php

namespace App\Day;

use App\Entity\Day;
use App\Entity\DaySend;
use App\Jira\TicketBook;
use App\Recurrence\RecurrenceForecast;
use App\Recurrence\RecurrencePoser;
use App\Repository\DayRepository;
use App\Repository\DaySendRepository;
use App\Repository\JiraConnectionRepository;
use App\Repository\RecurrenceRepository;
use App\Sending\SendView;
use App\Sending\Worklog;
use App\Settings\UserSettings;
use Symfony\Component\Clock\ClockInterface;
use Symfony\Component\Uid\Uuid;

/**
 * Lit une journée sans jamais rien y écrire : un jour sans ligne se lit vide, en
 * version 0, avec l'objectif habituel des réglages. Un jour non travaillé se lit sans
 * objectif, quel qu'ait été le sien. Seules les récurrences se posent avant, le jour
 * venu, quel que soit le jour lu (RecurrencePoser).
 *
 * Un jour à venir montre aussi les fois prévues de ses récurrences, comme ses autres
 * blocs, comptées dans ses chiffres et ce qu'il enverrait, sans qu'elles soient écrites
 * (RecurrenceForecast). Sa version les dit (DayVersion), comme les flèches qu'il ne montre plus.
 */
final readonly class DayReader
{
    public function __construct(
        private DayRepository $days,
        private DaySendRepository $sends,
        private JiraConnectionRepository $connections,
        private UserCalendar $calendar,
        private TicketBook $tickets,
        private UserSettings $settings,
        private ClockInterface $clock,
        private RecurrencePoser $poser,
        private RecurrenceRepository $recurrences,
        private RecurrenceForecast $forecast,
    ) {
    }

    public function view(\DateTimeImmutable $date): DayView
    {
        $this->poser->pose();
        $day = $this->days->findWithSlots($date);
        if (null !== $day) {
            return $this->viewOf($day);
        }

        $habitual = $this->settings->habitualObjective();
        $planned = $this->forecast->on(null, $date);

        return $this->build($date, DayVersion::of(null, $planned), $habitual, $habitual, false, RecurrenceForecast::shown(Grid::empty(), $planned), null);
    }

    public function viewOf(Day $day): DayView
    {
        $habitual = $this->settings->habitualObjective();
        $planned = $this->forecast->on($day, $day->date);

        return $this->build($day->date, DayVersion::of($day, $planned), $day->objectiveFollowing($habitual), $habitual, $day->isDeclaredOff(), RecurrenceForecast::shown($day->grid(), $planned), $this->sends->forDate($day->date, $this->connections->current()));
    }

    private function build(\DateTimeImmutable $date, int $version, int $objective, int $habitual, bool $declaredOff, Grid $grid, ?DaySend $send): DayView
    {
        $working = $this->settings->isWorkingDay($date);
        $objective = $working ? $objective : 0;
        $sending = SendView::of($send, Worklog::ofDay($grid, $date, $this->calendar), $this->clock->now(), $this->calendar);

        // Une récurrence arrêtée ou retirée avant ce jour n'y a plus de fois : ce qu'elle y avait
        // posé se montre comme une saisie ordinaire, sans flèche, fondu avec un quart d'heure
        // voisin au même contenu. Son lien reste en base, qu'annuler et rétablir lui rendent
        // avec sa fin ; la version de la journée change avec elle (DayVersion).
        $linked = [];
        $ended = [];
        foreach ($grid->recurrences() as $id) {
            $recurrence = $this->recurrences->byId(Uuid::fromString($id));
            if (null !== $recurrence && $recurrence->reaches($date)) {
                $linked[$id] = $recurrence;
            } else {
                $ended[] = $id;
            }
        }
        $grid = $grid->unlinking($ended);

        return new DayView(
            $date,
            $version,
            $objective,
            $habitual,
            $grid,
            DayFigures::of($grid, $objective, $this->calendar->minuteOf($date)),
            $working,
            $declaredOff,
            $this->settings->workingDays(),
            $sending,
            $this->tickets->describe([...$grid->tickets(), ...$sending->removed]),
            $linked,
            // Fermé, et vide : la journée dit que ses récurrences ne s'y posent pas, s'il en
            // tombe une ce jour-là.
            (!$working || $declaredOff) && $grid->isEmpty() && [] !== $this->recurrences->fallingOn($date),
            $this->recurrences->ongoing($this->calendar->today()),
            $this->recurrences->skippedAfter($this->calendar->today()),
            $this->sends->closedAfter($this->calendar->today()),
        );
    }
}
