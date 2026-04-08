<?php

declare(strict_types=1);

namespace App\Dto\Output;

use App\Entity\FavoriteTicket;

readonly class FavoriteTicketOutput
{
    public function __construct(
        public string $id,
        public string $ticketKey,
        public ?string $ticketSummary,
        public ?string $customName,
        public ?string $ticketType,
        public int $position,
    ) {}

    public static function fromEntity(FavoriteTicket $favorite): self
    {
        return new self(
            id: (string) $favorite->id,
            ticketKey: $favorite->ticketKey,
            ticketSummary: $favorite->ticketSummary,
            customName: $favorite->customName,
            ticketType: $favorite->ticketType,
            position: $favorite->position,
        );
    }
}
