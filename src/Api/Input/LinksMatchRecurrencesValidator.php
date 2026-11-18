<?php

namespace App\Api\Input;

use App\Repository\RecurrenceRepository;
use Symfony\Component\Uid\Uuid;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;
use Symfony\Component\Validator\Exception\UnexpectedTypeException;

final class LinksMatchRecurrencesValidator extends ConstraintValidator
{
    public function __construct(private readonly RecurrenceRepository $recurrences)
    {
    }

    public function validate(mixed $value, Constraint $constraint): void
    {
        if (!$constraint instanceof LinksMatchRecurrences) {
            throw new UnexpectedTypeException($constraint, LinksMatchRecurrences::class);
        }
        if (!$value instanceof SlotsInput) {
            throw new UnexpectedTypeException($value, SlotsInput::class);
        }

        foreach ($value->changes as $index => $change) {
            // Un identifiant ou un ticket de travers a déjà son refus.
            if (null === $change->recurrence || !Uuid::isValid($change->recurrence) || (SlotChangeInput::WORK === $change->kind && null === $change->ticket)) {
                continue;
            }
            // Une définition ne change jamais (Recurrence) : la vérifier hors du verrou suffit.
            $recurrence = $this->recurrences->byId(Uuid::fromString($change->recurrence));
            $content = $change->content();
            $quarters = $change->quarters();
            if (null === $recurrence || null === $content || !$content->equals($recurrence->content())
                || [] === $quarters || [] !== array_diff($quarters, $recurrence->quarters())) {
                $this->context->buildViolation($constraint->message)
                    ->atPath(\sprintf('changes[%d].recurrence', $index))
                    ->addViolation();
            }
        }
    }
}
