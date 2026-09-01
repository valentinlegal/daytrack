<?php

declare(strict_types=1);

namespace App\Dto\Input;

use Symfony\Component\Validator\Constraints as Assert;

readonly class UpdateTemplateRuleInput
{
    public function __construct(
        #[Assert\DateTime(format: 'H:i')]
        public ?string $startTime = null,

        #[Assert\Range(min: 1, max: 1440)]
        public ?int $durationMinutes = null,

        #[Assert\Regex(pattern: '/^[A-Za-z0-9-]+$/', message: 'error.ticket_key_invalid')]
        public ?string $ticketKey = null,

        #[Assert\Length(max: 255)]
        public ?string $ticketSummary = null,

        #[Assert\Length(max: 50)]
        public ?string $ticketType = null,

        #[Assert\Length(max: 500)]
        public ?string $comment = null,

        #[Assert\PositiveOrZero]
        public ?int $targetMinutes = null,

        #[Assert\Range(min: 1, max: 7)]
        public ?int $weekday = null,

        #[Assert\Positive]
        public ?int $intervalWeeks = null,

        #[Assert\Date]
        public ?string $anchorDate = null,

        #[Assert\Date]
        public ?string $activeUntil = null,

        public ?bool $enabled = null,
    ) {}
}
