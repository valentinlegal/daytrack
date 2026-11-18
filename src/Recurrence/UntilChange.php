<?php

namespace App\Recurrence;

use App\Entity\Recurrence;

/**
 * La fin d'une récurrence, avant et après un geste : ce qu'annuler lui rend, et ce que
 * rétablir lui remet (assets/grid/history.ts). La fin d'une récurrence retirée est la
 * veille de son premier jour.
 */
final readonly class UntilChange
{
    public function __construct(
        public string $recurrence,
        public ?\DateTimeImmutable $before,
        public ?\DateTimeImmutable $after,
    ) {
    }

    public static function of(Recurrence $recurrence, ?\DateTimeImmutable $before): self
    {
        return new self($recurrence->id->toRfc4122(), $before, $recurrence->until);
    }

    /**
     * @return array{recurrence: string, before: ?string, after: ?string}
     */
    public function toArray(): array
    {
        return ['recurrence' => $this->recurrence, 'before' => $this->before?->format('Y-m-d'), 'after' => $this->after?->format('Y-m-d')];
    }
}
