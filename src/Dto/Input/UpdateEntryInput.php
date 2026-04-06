<?php

declare(strict_types=1);

namespace App\Dto\Input;

use App\Enum\EntryType;
use Symfony\Component\Validator\Constraints as Assert;

readonly class UpdateEntryInput
{
    public function __construct(
        #[Assert\DateTime(format: 'H:i')]
        public ?string $startedAt = null,

        #[Assert\DateTime(format: 'H:i')]
        public ?string $endedAt = null,

        #[Assert\Regex(pattern: '/^[A-Za-z0-9-]+$/', message: 'error.ticket_key_invalid')]
        public ?string $ticketKey = null,

        #[Assert\Length(max: 500)]
        public ?string $comment = null,

        #[Assert\Choice(choices: [EntryType::WORK->value, EntryType::BREAK->value])]
        public ?string $type = null,

        #[Assert\Length(max: 255)]
        public ?string $ticketSummary = null,

        #[Assert\Length(max: 50)]
        public ?string $ticketType = null,
    ) {}
}