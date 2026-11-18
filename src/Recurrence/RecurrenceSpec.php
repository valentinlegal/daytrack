<?php

namespace App\Recurrence;

/** Ce que la fenêtre d'un ticket règle d'une récurrence : son rythme et sa fin. */
final readonly class RecurrenceSpec
{
    public function __construct(
        public Rhythm $rhythm,
        public ?\DateTimeImmutable $until,
    ) {
    }
}
