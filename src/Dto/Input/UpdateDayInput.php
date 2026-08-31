<?php

declare(strict_types=1);

namespace App\Dto\Input;

use Symfony\Component\Validator\Constraints as Assert;

readonly class UpdateDayInput
{
    public function __construct(
        #[Assert\NotNull]
        #[Assert\Range(min: 0, max: 1440)]
        public ?int $targetMinutes = null,
    ) {}
}