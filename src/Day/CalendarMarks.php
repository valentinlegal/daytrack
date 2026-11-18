<?php

namespace App\Day;

use App\Entity\Day;
use App\Recurrence\RecurrencePoser;
use App\Repository\DayRepository;
use App\Repository\DaySendRepository;
use App\Repository\EmptyDayWatchRepository;
use App\Repository\JiraConnectionRepository;
use App\Sending\SendState;
use App\Sending\Worklog;
use App\Settings\UserSettings;
use Symfony\Component\Clock\ClockInterface;

/**
 * Les marques des jours que montre le calendrier, date après date, lues sans rien
 * écrire : un jour sans ligne se lit vide, à l'objectif habituel, comme dans la journée.
 *
 * Un jour à venir se marque sur ses seules saisies : ses fois prévues ne le disent pas
 * « Non envoyé ». Déjà envoyé, il n'en prévoit plus aucune (DaySendRepository::closesToRecurrences) :
 * ses saisies sont tout ce qu'il montre, comme pour son bouton.
 */
final readonly class CalendarMarks
{
    /** Six semaines : le mois le plus long que le calendrier affiche. */
    public const int MAX_DAYS = 42;

    public function __construct(
        private DayRepository $days,
        private DaySendRepository $sends,
        private JiraConnectionRepository $connections,
        private EmptyDayWatchRepository $watch,
        private UserCalendar $calendar,
        private UserSettings $settings,
        private ClockInterface $clock,
        private RecurrencePoser $poser,
    ) {
    }

    /** De $from à $to compris, les récurrences posées sur les jours venus. */
    public function between(\DateTimeImmutable $from, \DateTimeImmutable $to): CalendarDays
    {
        $this->poser->pose();
        $today = $this->calendar->today()->format('Y-m-d');
        $habitual = $this->settings->habitualObjective();
        $workingDays = $this->settings->workingDays();
        // Un jour vide se signale s'il vient après celui du point de départ, dans le fuseau
        // de l'utilisateur ; sans point de départ, aucun.
        $since = $this->watch->since();
        $watchedAfter = null === $since ? null : $this->calendar->local($since)->format('Y-m-d');

        // L'état d'envoi est celui du Jira relié : un autre n'a jamais rien reçu.
        $sends = $this->sends->between($from, $to, $this->connections->current());
        $now = $this->clock->now();

        /** @var array<string, Day> $rows */
        $rows = [];
        foreach ($this->days->findBetweenWithSlots($from, $to) as $day) {
            $rows[$day->date->format('Y-m-d')] = $day;
        }

        $marks = [];
        $daysOff = [];
        // Des dates à minuit en heure universelle : un jour en vaut toujours vingt-quatre.
        foreach (new \DatePeriod($from, new \DateInterval('P1D'), $to, \DatePeriod::INCLUDE_END_DATE) as $date) {
            $key = $date->format('Y-m-d');
            $day = $rows[$key] ?? null;
            $grid = $day?->grid() ?? Grid::empty();
            $sent = $sends[$key] ?? null;
            if (true === $day?->isDeclaredOff()) {
                $daysOff[] = $key;
            }

            $mark = DayMark::of(
                $grid,
                $day?->objectiveFollowing($habitual) ?? $habitual,
                // Des dates « AAAA-MM-JJ » se comparent dans l'ordre du calendrier.
                $key < $today,
                UserSettings::worksOn($workingDays, $date),
                null !== $watchedAfter && $key > $watchedAfter,
                SendState::settled($sent, Worklog::ofDay($grid, $date, $this->calendar), $now),
            );
            if (null !== $mark) {
                $marks[$key] = $mark;
            }
        }

        return new CalendarDays($marks, $daysOff);
    }
}
