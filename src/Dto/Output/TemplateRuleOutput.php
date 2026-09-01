<?php

declare(strict_types=1);

namespace App\Dto\Output;

use App\Entity\TemplateRule;

readonly class TemplateRuleOutput
{
    public function __construct(
        public string $id,
        public string $ruleType,
        public int $weekday,
        public ?string $startTime,
        public ?int $durationMinutes,
        public ?string $ticketKey,
        public ?string $ticketSummary,
        public ?string $ticketType,
        public ?string $comment,
        public ?int $targetMinutes,
        public int $intervalWeeks,
        public string $anchorDate,
        public string $activeFrom,
        public ?string $activeUntil,
        public bool $enabled,
        public ?string $rotationGroupId,
        public int $position,
    ) {}

    public static function fromEntity(TemplateRule $rule): self
    {
        return new self(
            id: (string) $rule->id,
            ruleType: $rule->ruleType->value,
            weekday: $rule->weekday,
            startTime: $rule->startTime,
            durationMinutes: $rule->durationMinutes,
            ticketKey: $rule->ticketKey,
            ticketSummary: $rule->ticketSummary,
            ticketType: $rule->ticketType,
            comment: $rule->comment,
            targetMinutes: $rule->targetMinutes,
            intervalWeeks: $rule->intervalWeeks,
            anchorDate: $rule->anchorDate->format('Y-m-d'),
            activeFrom: $rule->activeFrom->format('Y-m-d'),
            activeUntil: $rule->activeUntil?->format('Y-m-d'),
            enabled: $rule->enabled,
            rotationGroupId: null !== $rule->rotationGroupId ? (string) $rule->rotationGroupId : null,
            position: $rule->position,
        );
    }
}
