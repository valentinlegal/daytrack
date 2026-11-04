<?php

namespace App\V1;

/**
 * Une ligne de la table des saisies de la v1, telle qu'elle y est écrite : la v1 ne
 * vérifiait ni le quart d'heure, ni les bornes de la journée, ni les chevauchements.
 */
final readonly class V1Entry
{
    public function __construct(
        public string $startedAt,
        public ?string $endedAt,
        public string $type,
        public ?string $ticket,
        public ?string $comment,
        public ?string $title,
    ) {
    }
}
