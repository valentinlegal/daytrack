<?php

declare(strict_types=1);

namespace App\Dto\Input;

use Symfony\Component\Validator\Constraints as Assert;

readonly class CreateFavoriteInput
{
    public function __construct(
        #[Assert\NotBlank]
        #[Assert\Length(max: 50)]
        #[Assert\Regex(pattern: '/^[A-Za-z0-9-]+$/', message: 'error.ticket_key_invalid')]
        public string $ticketKey,
    ) {}
}
