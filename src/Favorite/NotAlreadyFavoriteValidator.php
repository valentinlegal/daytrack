<?php

namespace App\Favorite;

use App\Repository\FavoriteRepository;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;
use Symfony\Component\Validator\Exception\UnexpectedTypeException;

final class NotAlreadyFavoriteValidator extends ConstraintValidator
{
    public function __construct(private readonly FavoriteRepository $favorites)
    {
    }

    public function validate(mixed $value, Constraint $constraint): void
    {
        if (!$constraint instanceof NotAlreadyFavorite) {
            throw new UnexpectedTypeException($constraint, NotAlreadyFavorite::class);
        }
        if (!\is_string($value) || null === $this->favorites->findOneBy(['ticket' => $value])) {
            return;
        }

        $this->context->buildViolation($constraint->message)
            ->setParameter('{{ ticket }}', $value)
            ->addViolation();
    }
}
