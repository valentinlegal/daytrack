<?php

namespace App\Day;

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
     *     blocks: list<array{start: string, end: string, kind: string, ticket: ?string, comment: ?string}>,
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
            ], $this->grid->blocks()),
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
