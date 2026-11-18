<?php

namespace App\Recurrence;

use App\Database\LockedTransaction;
use App\Day\UserCalendar;
use App\Entity\Day;
use App\Entity\Recurrence;
use App\Repository\DayRepository;
use App\Repository\DaySendRepository;
use App\Repository\RecurrenceRepository;
use App\Settings\UserSettings;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Pose les récurrences le jour venu, et sur les jours venus sans que DayTrack ait été
 * ouvert : le seul endroit où elles s'écrivent d'elles-mêmes. Il passe avant toute lecture
 * ou écriture d'une journée et du calendrier, quel que soit le jour qu'on regarde.
 *
 * Chaque récurrence se pose quart d'heure par quart d'heure, sur les seuls créneaux libres
 * — ce qui est déjà saisi l'emporte —, les jours où son rythme tombe, travaillés selon les
 * réglages, sans objectif mis à 0h00, et dont la fois n'a pas été détachée. Un jour déjà
 * traité ne l'est plus jamais : ce qu'on y a effacé n'y revient pas. Un jour envoyé d'avance
 * l'a été par son envoi, pour toutes ses récurrences, même nées après lui
 * (DaySendRepository::closesToRecurrences).
 *
 * Rien à poser, rien n'est écrit, sans même prendre le verrou. Sous le verrou, deux onglets
 * qui passent minuit ensemble posent une seule fois : le second voit le premier. Une journée
 * écrite avance de version, et l'onglet qui ne l'a pas vue reçoit le refus habituel.
 */
final readonly class RecurrencePoser
{
    public function __construct(
        private EntityManagerInterface $entityManager,
        private LockedTransaction $transaction,
        private DayRepository $days,
        private DaySendRepository $sends,
        private RecurrenceRepository $recurrences,
        private UserCalendar $calendar,
        private UserSettings $settings,
    ) {
    }

    public function pose(): void
    {
        $today = $this->calendar->today();
        if ([] === $this->recurrences->due($today)) {
            return;
        }

        $advanced = $this->transaction->run($this->days, function () use ($today): array {
            $advanced = [];
            // Les journées nées ici ne sont pas encore écrites : la base ne les rendrait pas
            // à la récurrence suivante, qui en créerait une seconde.
            $born = [];
            foreach ($this->recurrences->due($today) as $recurrence) {
                // Lue sous le verrou : un autre onglet a pu la poser entre-temps.
                $this->entityManager->refresh($recurrence);
                foreach ($this->daysToPose($recurrence, $today) as $date) {
                    $key = $date->format('Y-m-d');
                    $day = $this->poseOn($recurrence, $date, $born);
                    if (null !== $day && !isset($born[$key]) && !isset($advanced[$key]) && $this->days->advance($date)) {
                        $advanced[$key] = $day;
                    }
                }
                $recurrence->posedUntil($today);
            }

            return $advanced;
        });

        // La version vient d'avancer dans la base, pas dans les journées déjà chargées.
        foreach ($advanced as $day) {
            $this->entityManager->refresh($day);
        }
    }

    /**
     * Ses jours pas encore traités, du lendemain de son dernier passage — ou de son premier
     * jour — jusqu'à aujourd'hui, ou jusqu'à sa fin.
     *
     * @return iterable<\DateTimeImmutable>
     */
    private function daysToPose(Recurrence $recurrence, \DateTimeImmutable $today): iterable
    {
        $date = max($recurrence->posedThrough->modify('+1 day'), $recurrence->firstDay);
        $last = null === $recurrence->until ? $today : min($today, $recurrence->until);
        for (; $date <= $last; $date = $date->modify('+1 day')) {
            yield $date;
        }
    }

    /**
     * La journée où elle vient de poser, ou null si elle n'y a rien posé.
     *
     * @param array<string, Day> $born les journées nées pendant ce passage, par leur date
     */
    private function poseOn(Recurrence $recurrence, \DateTimeImmutable $date, array &$born): ?Day
    {
        if (!$recurrence->fallsOn($date) || !$this->settings->isWorkingDay($date) || $this->recurrences->isSkipped($recurrence, $date)) {
            return null;
        }
        $day = $born[$date->format('Y-m-d')] ?? $this->days->findWithSlots($date);
        if (null !== $day && ($day->isDeclaredOff() || $this->sends->closesToRecurrences($day))) {
            return null;
        }
        $free = array_values(array_filter($recurrence->quarters(), static fn (int $start): bool => null === $day || !$day->holds($start)));
        if ([] === $free) {
            return null;
        }
        if (null === $day) {
            // Lu sous le verrou, comme à la naissance de toute journée (DayWriter).
            $day = new Day($date, $this->settings->habitualObjective());
            $this->entityManager->persist($day);
            $born[$date->format('Y-m-d')] = $day;
        } elseif ($day->followsHabitual()) {
            // Vide et sans objectif choisi, elle reprend l'habituel du moment avant de se
            // remplir, comme une journée qui naît (DayWriter::write) : remplie, elle ne le
            // suivrait plus.
            $day->objective = $this->settings->habitualObjective();
        }
        $content = $recurrence->content();
        $day->change(array_fill_keys($free, $content), array_fill_keys($free, $recurrence));

        return $day;
    }
}
