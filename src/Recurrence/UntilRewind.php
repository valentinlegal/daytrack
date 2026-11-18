<?php

namespace App\Recurrence;

use Symfony\Component\Uid\Uuid;

/**
 * Annuler ou rétablir rend à une récurrence la fin qu'elle avait : seulement si elle a
 * encore celle d'après. Un autre onglet a pu la changer depuis, et annuler ne défait
 * jamais ce qu'il a écrit.
 */
final readonly class UntilRewind
{
    public function __construct(
        public Uuid $recurrence,
        public ?\DateTimeImmutable $from,
        public ?\DateTimeImmutable $to,
    ) {
    }
}
