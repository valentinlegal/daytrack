<?php

declare(strict_types=1);

namespace App\Dto\Input;

use Symfony\Component\Validator\Constraints as Assert;

readonly class ReorderFavoritesInput
{
    public function __construct(
        /**
         * Liste ordonnée des UUIDs de favoris — la position est déduite de l'index.
         *
         * @var string[]
         */
        #[Assert\NotNull]
        #[Assert\Type('array')]
        #[Assert\All([new Assert\Uuid()])]
        public array $ids,
    ) {}
}
