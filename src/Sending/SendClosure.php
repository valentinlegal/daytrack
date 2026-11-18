<?php

namespace App\Sending;

use App\Day\SlotContent;
use App\Entity\Day;
use App\Entity\Recurrence;
use App\Recurrence\RecurrenceForecast;
use App\Repository\DayRepository;
use App\Repository\DaySendRepository;
use App\Repository\RecurrenceRepository;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Clock\ClockInterface;

/**
 * Ce qu'un envoi fixe d'une journée : tant qu'un envoi y a quelque chose à dire, ses
 * récurrences ne la changent plus (DaySendRepository::closesToRecurrences). Vidée de ses
 * tickets, une journée que ses envois laissent sans heures dans Jira — renvoyée vide, ou dont
 * l'envoi a échoué sans rien écrire — redevient une journée comme une autre : ses envois
 * s'oublient, et un jour à venir rend à ses récurrences ce qu'ils y avaient posé.
 *
 * Sous le verrou de l'écriture qui l'appelle (DayWriter, DaySender).
 */
final readonly class SendClosure
{
    public function __construct(
        private EntityManagerInterface $entityManager,
        private DayRepository $days,
        private DaySendRepository $sends,
        private RecurrenceRepository $recurrences,
        private RecurrenceForecast $forecast,
        private ClockInterface $clock,
    ) {
    }

    /**
     * Oublie ses envois qui n'ont plus rien à dire, sans rien changer à ce qu'elle montre : un
     * ticket saisi ensuite ne la refermerait pas aux récurrences qu'elle montre déjà.
     */
    public function forget(Day $day): void
    {
        $this->sends->forgetMute($day, $this->clock->now());
    }

    /**
     * Oublie ses envois qui n'ont plus rien à dire. Un jour à venir qu'aucun ne ferme plus rend
     * à ses récurrences les fois que ses envois y avaient posées : celles qu'elles y attendent
     * encore redeviennent prévues, sans s'écrire, et suivent de nouveau leur série ; celles d'une
     * récurrence arrêtée avant lui y restent comme une saisie ordinaire, telles qu'elles se
     * montraient déjà. Ce qu'une récurrence a posé le jour où elle est née d'un bloc reste à elle.
     *
     * Fermé, il ne comptait pour aucune (RecurrenceClash) : deux récurrences ont pu naître qui y
     * voudraient le même créneau. Rouvert, la seconde y cède sa fois, comme si elle avait été
     * effacée cette fois seulement — jamais deux récurrences sur un créneau (yieldDisputed).
     *
     * @param bool          $closed  un envoi la fermait avant l'écriture qui l'appelle : sinon, il n'y a rien à rouvrir
     * @param bool          $advance la journée avance de version si elle change ; une écriture qui l'a déjà avancée passe false
     * @param ?list<string> $before  les récurrences qui y avaient un bloc avant le geste qui l'appelle ; null sans geste
     */
    public function reopen(Day $day, bool $closed, bool $advance, ?array $before = null): void
    {
        $this->forget($day);
        if (!$closed || !$this->forecast->isAhead($day->date) || $this->sends->closesToRecurrences($day)) {
            return;
        }

        $grid = $day->grid();
        // Celles dont un bloc y est écrit, avant que ce que l'envoi y a posé redevienne prévu.
        $written = $grid->recurrences();
        /** @var array<int, ?SlotContent> $changes */
        $changes = [];
        foreach ($day->linkedQuarters() as $start => $recurrence) {
            if (RecurrenceForecast::treated($recurrence, $day->date)) {
                continue;
            }
            $changes[$start] = $this->forecast->awaits($recurrence, $day, $day->date) && !$this->recurrences->isSkipped($recurrence, $day->date)
                ? null
                : $grid->contentAt($start);
        }
        if ([] !== $changes) {
            if ($advance) {
                $this->days->advance($day->date);
                // La version vient d'avancer dans la base, pas dans la journée déjà chargée.
                $this->entityManager->refresh($day);
            }
            // Rendues entières, ou gardées entières sans lien : aucune fois n'y est détachée,
            // rien n'est à sauter.
            $day->change($changes);
        }
        $this->yieldDisputed($day, $written, $before ?? $written);
    }

    /**
     * Sur un jour rouvert, une récurrence qui voudrait le créneau d'une autre y cède sa fois :
     * celle dont le bloc y était écrit — posé par l'envoi, ou né ce jour-là — garde le sien, sinon
     * la plus ancienne, celle que la prévision place la première (RecurrenceForecast). Le veut
     * celle qui y tombe et dont la fois n'y est pas effacée ; retenue par un 0h00, elle le veut
     * encore, l'objectif rendu la ramènerait. Effacée par le geste même qui rouvre le jour, aussi :
     * annuler la ramène, sans qu'une autre l'y attende. Effacée avant, elle ne le veut plus.
     *
     * @param list<string> $written celles dont un bloc y était écrit avant la réouverture
     * @param list<string> $before  celles dont un bloc y était écrit avant le geste qui le rouvre
     */
    private function yieldDisputed(Day $day, array $written, array $before): void
    {
        $wanting = array_values(array_filter(
            $this->recurrences->fallingOn($day->date),
            fn (Recurrence $recurrence): bool => \in_array($recurrence->id->toRfc4122(), $before, true) || !$this->recurrences->isDetached($recurrence, $day->date),
        ));
        $written = array_values(array_unique([...$written, ...$before]));
        $wrote = static fn (Recurrence $recurrence): bool => \in_array($recurrence->id->toRfc4122(), $written, true);
        // Les blocs écrits d'abord, puis dans l'ordre de la prévision.
        usort($wanting, static fn (Recurrence $a, Recurrence $b): int => [!$wrote($a), $a->id->toRfc4122()] <=> [!$wrote($b), $b->id->toRfc4122()]);
        $kept = [];
        foreach ($wanting as $recurrence) {
            foreach ($kept as $other) {
                if ($recurrence->start < $other->end && $other->start < $recurrence->end && !$wrote($recurrence)) {
                    $this->recurrences->detachAgain($recurrence, $day->date);
                    continue 2;
                }
            }
            $kept[] = $recurrence;
        }
    }
}
