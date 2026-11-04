<?php

namespace App\Api\Input;

use Symfony\Component\Validator\Constraints as Assert;

/**
 * Un envoi sur Jira : la version de la journée que la confirmation a montrée.
 */
final readonly class SendInput
{
    public function __construct(
        #[Assert\PositiveOrZero(message: 'Version invalide.')]
        public int $version,
    ) {
    }
}
