<?php

declare(strict_types=1);

namespace App\Dto\Input;

use App\Enum\TemplateRuleType;
use Symfony\Component\Validator\Constraints as Assert;

readonly class CreateTemplateRuleInput
{
    public function __construct(
        #[Assert\NotBlank]
        #[Assert\Choice(choices: [
            TemplateRuleType::WORK->value,
            TemplateRuleType::BREAK->value,
            TemplateRuleType::TARGET_OVERRIDE->value,
        ])]
        public string $ruleType,

        #[Assert\NotBlank]
        #[Assert\Range(min: 1, max: 7)]
        public int $weekday,

        #[Assert\When(
            expression: 'this.ruleType !== "target_override"',
            constraints: [new Assert\NotBlank()],
        )]
        #[Assert\DateTime(format: 'H:i')]
        public ?string $startTime = null,

        #[Assert\When(
            expression: 'this.ruleType !== "target_override"',
            constraints: [new Assert\NotBlank(), new Assert\Positive()],
        )]
        #[Assert\Range(min: 1, max: 1440)]
        public ?int $durationMinutes = null,

        #[Assert\When(
            expression: 'this.ruleType === "work"',
            constraints: [new Assert\NotBlank()],
        )]
        #[Assert\Regex(pattern: '/^[A-Za-z0-9-]+$/', message: 'error.ticket_key_invalid')]
        public ?string $ticketKey = null,

        #[Assert\Length(max: 255)]
        public ?string $ticketSummary = null,

        #[Assert\Length(max: 50)]
        public ?string $ticketType = null,

        #[Assert\Length(max: 500)]
        public ?string $comment = null,

        #[Assert\When(
            expression: 'this.ruleType === "target_override"',
            constraints: [new Assert\NotBlank(), new Assert\Positive()],
        )]
        public ?int $targetMinutes = null,

        #[Assert\Positive]
        public int $intervalWeeks = 1,

        #[Assert\Date]
        public ?string $anchorDate = null,

        #[Assert\Date]
        public ?string $activeUntil = null,

        public bool $enabled = true,

        #[Assert\Uuid]
        public ?string $rotationGroupId = null,
    ) {}
}
