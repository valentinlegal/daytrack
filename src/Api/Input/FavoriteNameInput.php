<?php

namespace App\Api\Input;

use App\Entity\Favorite;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\Constraints as Assert;
use Symfony\Component\Validator\Context\ExecutionContextInterface;

/**
 * Le nom d'un favori renommé. Vide, il rend au favori le titre venu de Jira.
 */
final readonly class FavoriteNameInput
{
    public ?string $name;

    public function __construct(?string $name = null)
    {
        $this->name = EntryText::line($name);
    }

    #[Assert\Callback]
    public function validateName(ExecutionContextInterface $context): void
    {
        $context->getValidator()->inContext($context)->atPath('name')->validate($this->name, self::constraints());
    }

    /**
     * @return list<Constraint>
     */
    public static function constraints(): array
    {
        return EntryText::lineConstraints(Favorite::NAME_MAX, 'Le nom');
    }
}
