<?php

namespace App\Day;

use App\Entity\Recurrence;
use App\Recurrence\RecurrenceView;
use App\Sending\SendView;

/**
 * Une journée telle que l'API la rend : ses blocs, son objectif, ses chiffres, l'état
 * de son envoi sur Jira, et ce que DayTrack sait des tickets de ses blocs — leur titre
 * et leur type venus de Jira.
 *
 * Un jour non travaillé n'a pas d'objectif : tout ce qui s'y saisit compte en plus.
 */
final readonly class DayView
{
    public function __construct(
        public \DateTimeImmutable $date,
        public int $version,
        public int $objective,
        /** Celui des réglages, où ramène « Revenir à … » de la fenêtre Objectif du jour. */
        public int $habitualObjective,
        public Grid $grid,
        public DayFigures $figures,
        /** Selon les réglages : sinon, l'écran le ferme à la saisie. */
        public bool $working,
        /**
         * Son objectif a été mis à 0h00 pour lui (Day::isDeclaredOff) : vide, l'écran le
         * ferme à la saisie comme un jour non travaillé, mais en garde l'objectif.
         */
        public bool $declaredOff,
        /**
         * Ceux des réglages, en jours de la semaine ISO : les flèches de la barre sautent
         * les autres.
         *
         * @var list<int>
         */
        public array $workingDays,
        public SendView $send,
        /**
         * Ceux des blocs, et ceux retirés depuis un envoi que la confirmation montre encore.
         *
         * @var array<string, array{title: ?string, type: ?string, color: ?string}>
         */
        public array $tickets = [],
        /**
         * Celles qui ont posé un bloc ce jour-là, par leur identifiant : leur rythme, que la
         * flèche du bloc et sa fenêtre disent.
         *
         * @var array<string, Recurrence>
         */
        public array $recurrences = [],
        /** Fermé et vide, alors qu'une récurrence y serait tombée : la journée vide le dit. */
        public bool $recurrencesHeld = false,
        /**
         * Toutes celles qui ont encore des jours après aujourd'hui : une récurrence qu'on y crée
         * ou qu'on y change ne doit tomber sur aucune, et la fenêtre le dit avant le serveur
         * (RecurrenceClash).
         *
         * @var array<string, Recurrence>
         */
        public array $ongoing = [],
        /**
         * Leurs fois détachées ou effacées après aujourd'hui, par récurrence : elles ne prennent
         * plus leur créneau, et ses prochaines fois ne les montrent pas.
         *
         * @var array<string, list<string>>
         */
        public array $skipped = [],
        /**
         * Les jours à venir déjà envoyés, « AAAA-MM-JJ » : leurs récurrences ne les changent plus
         * (DaySendRepository::closesToRecurrences), et la fenêtre d'une récurrence ne les annonce pas.
         *
         * @var list<string>
         */
        public array $settledAhead = [],
    ) {
    }

    /**
     * @return array{
     *     date: string,
     *     version: int,
     *     objective: int,
     *     habitualObjective: int,
     *     working: bool,
     *     declaredOff: bool,
     *     workingDays: list<int>,
     *     blocks: list<array{start: string, end: string, kind: string, ticket: ?string, comment: ?string, recurrence: ?string}>,
     *     recurrences: object,
     *     recurrencesHeld: bool,
     *     ongoing: object,
     *     settledAhead: list<string>,
     *     figures: array{worked: int, remaining: int, balance: int, projectedEnd: ?string},
     *     send: array{state: string, sentAt: ?array{date: string, time: string}, attemptedAt: ?array{date: string, time: string}, failure: ?string, outcomes: object, removed: list<string>, inJira: object},
     *     tickets: object,
     * }
     */
    public function toArray(): array
    {
        return [
            'date' => $this->date->format('Y-m-d'),
            'version' => $this->version,
            'objective' => $this->objective,
            'habitualObjective' => $this->habitualObjective,
            'working' => $this->working,
            'declaredOff' => $this->declaredOff,
            'workingDays' => $this->workingDays,
            'blocks' => array_map(static fn (Block $block): array => [
                'start' => Quarter::format($block->start),
                'end' => Quarter::format($block->end),
                'kind' => $block->content->kind->value,
                'ticket' => $block->content->ticket,
                'comment' => $block->content->comment,
                'recurrence' => $block->recurrence,
            ], $this->grid->blocks()),
            // Un objet même vide : le navigateur y cherche une récurrence par son identifiant.
            'recurrences' => (object) array_map(fn (Recurrence $recurrence): array => RecurrenceView::of($recurrence, $this->skipped[$recurrence->id->toRfc4122()] ?? []), $this->recurrences),
            'recurrencesHeld' => $this->recurrencesHeld,
            'ongoing' => (object) array_map(fn (Recurrence $recurrence): array => RecurrenceView::of($recurrence, $this->skipped[$recurrence->id->toRfc4122()] ?? []), $this->ongoing),
            'settledAhead' => $this->settledAhead,
            'figures' => [
                'worked' => $this->figures->worked,
                'remaining' => $this->figures->remaining,
                'balance' => $this->figures->balance,
                'projectedEnd' => null === $this->figures->projectedEnd ? null : Quarter::format($this->figures->projectedEnd),
            ],
            'send' => $this->send->toArray(),
            // Un objet même vide : le navigateur y cherche un ticket par son identifiant.
            'tickets' => (object) $this->tickets,
        ];
    }
}
