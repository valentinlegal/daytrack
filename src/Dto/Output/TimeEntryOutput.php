<?php

declare(strict_types=1);

namespace App\Dto\Output;

use App\Entity\TimeEntry;

readonly class TimeEntryOutput
{
    public function __construct(
        public string $id,
        public ?string $ticketKey,
        public ?string $comment,
        public string $startedAt,
        public ?string $endedAt,
        public string $type,
        public ?int $durationMinutes,
    ) {}

    public static function fromEntity(TimeEntry $entry): self
    {
        return new self(
            id: (string) $entry->id,
            ticketKey: $entry->ticketKey,
            comment: $entry->comment,
            startedAt: $entry->startedAt->format('H:i'),
            endedAt: $entry->endedAt?->format('H:i'),
            type: $entry->type->value,
            durationMinutes: $entry->getDurationMinutes(),
        );
    }
}