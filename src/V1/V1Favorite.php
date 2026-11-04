<?php

namespace App\V1;

final readonly class V1Favorite
{
    public function __construct(
        public string $ticket,
        public ?string $name,
        public ?string $title,
    ) {
    }
}
