<?php

namespace App\Jira;

use App\Api\Input\NamesTickets;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;
use Symfony\Component\Validator\Exception\UnexpectedTypeException;
use Symfony\Component\Validator\Exception\UnexpectedValueException;

final class TicketsExistInJiraValidator extends ConstraintValidator
{
    public function __construct(private readonly TicketBook $tickets)
    {
    }

    public function validate(mixed $value, Constraint $constraint): void
    {
        if (!$constraint instanceof TicketsExistInJira) {
            throw new UnexpectedTypeException($constraint, TicketsExistInJira::class);
        }

        if (!$value instanceof NamesTickets) {
            throw new UnexpectedValueException($value, NamesTickets::class);
        }

        $named = $value->namedTickets();
        $missing = $this->tickets->verify(array_values(array_unique($named)), $constraint->describedOnly);

        foreach ($named as $path => $ticket) {
            if (\in_array($ticket, $missing, true)) {
                $this->context->buildViolation($constraint->message)
                    ->atPath($path)
                    ->setInvalidValue($ticket)
                    ->addViolation();
            }
        }
    }
}
