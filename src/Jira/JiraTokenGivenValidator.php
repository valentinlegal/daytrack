<?php

namespace App\Jira;

use App\Api\Input\JiraConnectionInput;
use App\Repository\JiraConnectionRepository;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;
use Symfony\Component\Validator\Exception\UnexpectedTypeException;
use Symfony\Component\Validator\Exception\UnexpectedValueException;

final class JiraTokenGivenValidator extends ConstraintValidator
{
    public function __construct(private readonly JiraConnectionRepository $connections)
    {
    }

    public function validate(mixed $value, Constraint $constraint): void
    {
        if (!$constraint instanceof JiraTokenGiven) {
            throw new UnexpectedTypeException($constraint, JiraTokenGiven::class);
        }

        if (!$value instanceof JiraConnectionInput) {
            throw new UnexpectedValueException($value, JiraConnectionInput::class);
        }

        if (null === $value->token && null === $this->connections->current()) {
            $this->context->buildViolation($constraint->message)->atPath('token')->addViolation();
        }
    }
}
