<?php

namespace App\Api\Input;

use App\Day\Quarter;
use App\Day\SlotContent;
use App\Entity\Slot;
use Symfony\Component\Validator\Constraints as Assert;
use Symfony\Component\Validator\Context\ExecutionContextInterface;

/**
 * Un créneau que le geste remplit d'un ticket ou d'une pause, ou qu'il vide. Il porte la
 * récurrence qui le pose quand annuler ou rétablir la lui rend (LinksMatchRecurrences) ;
 * tout autre geste l'en détache.
 */
final readonly class SlotChangeInput
{
    public const string WORK = 'work';
    public const string PAUSE = 'pause';
    public const string EMPTY = 'empty';

    public ?string $ticket;

    public ?string $comment;

    public function __construct(
        public string $start,
        public string $end,
        #[Assert\Choice(choices: [self::WORK, self::PAUSE, self::EMPTY], message: 'Un créneau porte un ticket, une pause, ou rien.')]
        public string $kind,
        ?string $ticket = null,
        ?string $comment = null,
        #[Assert\Uuid(message: 'Récurrence inconnue.')]
        public ?string $recurrence = null,
    ) {
        $this->ticket = EntryText::ticket($ticket);
        $this->comment = EntryText::line($comment);
    }

    #[Assert\Callback]
    public function validateRange(ExecutionContextInterface $context): void
    {
        $start = Quarter::parse($this->start);
        $end = Quarter::parse($this->end);

        if (null === $start || !Quarter::isBoundary($start) || Quarter::DAY_END === $start) {
            $context->buildViolation(\sprintf('Un créneau commence sur un quart d\'heure, de %s à %s.', Quarter::format(Quarter::FIRST), Quarter::format(Quarter::DAY_END - Quarter::MINUTES)))->atPath('start')->addViolation();
        }
        if (null === $end || !Quarter::isBoundary($end) || Quarter::FIRST === $end) {
            $context->buildViolation(\sprintf('Un créneau finit sur un quart d\'heure, de %s à %s.', Quarter::format(Quarter::FIRST + Quarter::MINUTES), Quarter::format(Quarter::DAY_END)))->atPath('end')->addViolation();
        } elseif (null !== $start && $start >= $end) {
            $context->buildViolation('Un créneau finit après son début.')->atPath('end')->addViolation();
        }
    }

    #[Assert\Callback]
    public function validateContent(ExecutionContextInterface $context): void
    {
        if (self::WORK === $this->kind) {
            if (null === $this->ticket) {
                $context->buildViolation('Indiquez un ticket.')->atPath('ticket')->addViolation();
            }

            // Le format ne se juge que sur du travail : sur une pause, le seul défaut
            // d'un ticket est d'être là.
            $validator = $context->getValidator()->inContext($context);
            $validator->atPath('ticket')->validate($this->ticket, EntryText::ticketConstraints());
            $validator->atPath('comment')->validate($this->comment, EntryText::lineConstraints(Slot::COMMENT_MAX, 'Le commentaire'));

            return;
        }

        $message = self::PAUSE === $this->kind
            ? 'Une pause ne porte ni ticket ni commentaire.'
            : 'Un créneau vidé ne porte ni ticket ni commentaire.';
        foreach (['ticket' => $this->ticket, 'comment' => $this->comment] as $field => $value) {
            if (null !== $value) {
                $context->buildViolation($message)->atPath($field)->addViolation();
            }
        }
    }

    /**
     * Les débuts des quarts d'heure que le créneau couvre ; aucun tant que ses
     * heures ne sont pas valides.
     *
     * @return list<int>
     */
    public function quarters(): array
    {
        $start = Quarter::parse($this->start);
        $end = Quarter::parse($this->end);
        if (null === $start || null === $end || !Quarter::isBoundary($start) || !Quarter::isBoundary($end)) {
            return [];
        }

        return Quarter::between($start, $end);
    }

    /** Ce que le créneau devient, une fois la validation passée ; null s'il se vide. */
    public function content(): ?SlotContent
    {
        return match ($this->kind) {
            self::WORK => SlotContent::work($this->ticket ?? throw new \LogicException('Un créneau de travail sans ticket a passé la validation.'), $this->comment),
            self::PAUSE => SlotContent::pause(),
            default => null,
        };
    }
}
