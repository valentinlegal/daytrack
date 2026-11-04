<?php

namespace App\Jira;

use App\Entity\Ticket;

/**
 * Ce que l'écran apprend d'un ticket qu'on tape : Jira l'a décrit, ou pourquoi il
 * ne l'a pas fait — avec ce que DayTrack en savait déjà, s'il le connaissait.
 */
final readonly class TicketLookup
{
    private function __construct(
        public ?JiraFailure $failure,
        public ?Ticket $ticket,
    ) {
    }

    public static function found(Ticket $ticket): self
    {
        return new self(null, $ticket);
    }

    public static function failed(JiraFailure $failure, ?Ticket $known): self
    {
        return new self($failure, $known);
    }

    /**
     * @return array{status: string, ticket: array{title: ?string, type: ?string, color: ?string}|null}
     */
    public function toArray(): array
    {
        return [
            'status' => $this->failure->value ?? 'found',
            'ticket' => JiraFailure::NotFound === $this->failure ? null : $this->ticket?->toArray(),
        ];
    }
}
