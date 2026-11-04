<?php

namespace App\V1;

/**
 * Une journée de la v1 et ses saisies, dans l'ordre du jour.
 */
final readonly class V1Day
{
    /**
     * @param list<string>  $syncedTickets les tickets du dernier envoi, gardés même modifiée depuis
     * @param list<V1Entry> $entries
     */
    public function __construct(
        public string $date,
        public int $target,
        public ?string $syncedAt,
        public array $syncedTickets,
        public array $entries,
    ) {
    }
}
