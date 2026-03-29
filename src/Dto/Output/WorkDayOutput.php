<?php

declare(strict_types=1);

namespace App\Dto\Output;

use App\Entity\TimeEntry;
use App\Entity\WorkDay;

readonly class WorkDayOutput
{
    /**
     * @param TimeEntryOutput[] $entries
     */
    public function __construct(
        public string $id,
        public string $date,
        public int $targetMinutes,
        public int $workedMinutes,
        public int $balanceMinutes,
        public array $entries,
        public ?string $jiraSyncedAt,
    ) {}

    public static function fromEntity(WorkDay $workDay): self
    {
        return new self(
            id: (string) $workDay->id,
            date: $workDay->date->format('Y-m-d'),
            targetMinutes: $workDay->targetMinutes,
            workedMinutes: $workDay->getWorkedMinutes(),
            balanceMinutes: $workDay->getBalanceMinutes(),
            entries: array_values(
                $workDay->entries
                    ->map(fn (TimeEntry $e) => TimeEntryOutput::fromEntity($e))
                    ->toArray()
            ),
            jiraSyncedAt: $workDay->jiraSyncedAt?->format(\DateTimeInterface::ATOM),
        );
    }
}