<?php

namespace App\Api\Input;

use Symfony\Component\Uid\Uuid;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * La liste des favoris dans son nouvel ordre : tous, de haut en bas.
 */
final readonly class FavoriteOrderInput
{
    /**
     * @param list<string> $ids
     */
    public function __construct(
        #[Assert\All(new Assert\Uuid(message: 'Un favori se désigne par son identifiant.'))]
        public array $ids,
    ) {
    }

    /**
     * @return list<Uuid>
     */
    public function uuids(): array
    {
        return array_map(static fn (string $id): Uuid => Uuid::fromString($id), $this->ids);
    }
}
