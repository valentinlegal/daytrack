<?php

namespace App\Day;

use App\Entity\Day;
use App\Entity\DaySend;
use App\Jira\TicketBook;
use App\Repository\DayRepository;
use App\Repository\DaySendRepository;
use App\Repository\JiraConnectionRepository;
use App\Sending\SendView;
use App\Sending\Worklog;
use App\Settings\UserSettings;
use Psr\Clock\ClockInterface;

/**
 * Lit une journée sans jamais rien écrire : un jour sans ligne se lit vide, en
 * version 0, avec l'objectif habituel des réglages. Un jour non travaillé se lit sans
 * objectif, quel qu'ait été le sien.
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
    ) {
    }

    public function view(\DateTimeImmutable $date): DayView
    {
        $day = $this->days->findWithSlots($date);
        $habitual = $this->settings->habitualObjective();

        return null !== $day
            ? $this->build($day->date, $day->version, $day->objectiveFollowing($habitual), $habitual, $day->isDeclaredOff(), $day->grid(), $this->sends->forDate($date, $this->connections->current()))
            : $this->build($date, 0, $habitual, $habitual, false, Grid::empty(), null);
    }

    public function viewOf(Day $day): DayView
    {
        $habitual = $this->settings->habitualObjective();

        return $this->build($day->date, $day->version, $day->objectiveFollowing($habitual), $habitual, $day->isDeclaredOff(), $day->grid(), $this->sends->forDate($day->date, $this->connections->current()));
    }

    private function build(\DateTimeImmutable $date, int $version, int $objective, int $habitual, bool $declaredOff, Grid $grid, ?DaySend $send): DayView
    {
        $working = $this->settings->isWorkingDay($date);
        $objective = $working ? $objective : 0;
        $sending = SendView::of($send, Worklog::ofDay($grid, $date, $this->calendar), $this->clock->now(), $this->calendar);

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
        );
    }
}
