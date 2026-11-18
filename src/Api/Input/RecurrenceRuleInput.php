<?php

namespace App\Api\Input;

use App\Day\UserCalendar;
use App\Recurrence\RecurrenceSpec;
use App\Recurrence\Rhythm;
use App\Recurrence\RhythmKind;
use Symfony\Component\Validator\Constraints as Assert;
use Symfony\Component\Validator\Context\ExecutionContextInterface;

/**
 * Le rythme et la fin d'une récurrence, tels que la fenêtre les règle : chaque semaine ou
 * une semaine sur 2, 3 ou 4, ses jours de la semaine ; ou chaque mois, le n-ième jour de la
 * semaine, le dernier, ou une date ; et « Jusqu'au », facultatif.
 *
 * Que le jour du bloc permette un rythme mensuel se juge avec lui (DayWriter).
 */
final readonly class RecurrenceRuleInput
{
    /**
     * @param list<int> $weekdays en jours de la semaine ISO, du lundi (1) au dimanche (7) ;
     *                            un seul pour le n-ième du mois, aucun pour une date
     */
    public function __construct(
        #[Assert\Count(max: 7, maxMessage: 'Un jour de la semaine va du lundi au dimanche.')]
        #[Assert\Unique(message: 'Un jour ne se choisit qu\'une fois.')]
        #[Assert\All([new Assert\Range(notInRangeMessage: 'Un jour de la semaine va du lundi au dimanche.', min: 1, max: 7)])]
        public array $weekdays,
        #[Assert\Date(message: 'Une date s\'écrit AAAA-MM-JJ.')]
        public ?string $until = null,
        #[Assert\Choice(callback: [self::class, 'kinds'], message: 'Rythme inconnu.')]
        public string $kind = RhythmKind::Weekly->value,
        #[Assert\Range(notInRangeMessage: 'Une récurrence revient chaque semaine, ou une semaine sur 2, 3 ou 4.', min: 1, max: Rhythm::MAX_EVERY_WEEKS)]
        public int $everyWeeks = 1,
        #[Assert\Choice(choices: [1, 2, 3, 4, Rhythm::LAST], message: 'Un jour du mois se nomme du 1er au 4e, ou le dernier.')]
        public ?int $monthWeek = null,
        #[Assert\Range(notInRangeMessage: 'Une date du mois va du 1er au 31.', min: 1, max: 31)]
        public ?int $monthDay = null,
    ) {
    }

    /** @return list<string> */
    public static function kinds(): array
    {
        return array_map(static fn (RhythmKind $kind): string => $kind->value, RhythmKind::cases());
    }

    /**
     * Chaque rythme a ses champs, et seulement les siens : une semaine a ses jours, un mois
     * son rang et son jour, ou sa date.
     */
    #[Assert\Callback]
    public function validateRhythm(ExecutionContextInterface $context): void
    {
        $refuse = static function (string $path, string $message) use ($context): void {
            $context->buildViolation($message)->atPath($path)->addViolation();
        };
        switch (RhythmKind::tryFrom($this->kind)) {
            case RhythmKind::Weekly:
                if ([] === $this->weekdays) {
                    $refuse('weekdays', 'Choisissez au moins un jour.');
                }
                if (null !== $this->monthWeek || null !== $this->monthDay) {
                    $refuse('kind', 'Chaque semaine n\'a pas de jour du mois.');
                }
                break;
            case RhythmKind::MonthlyWeekday:
                if (1 !== \count($this->weekdays) || null === $this->monthWeek || null !== $this->monthDay || 1 !== $this->everyWeeks) {
                    $refuse('kind', 'Le n-ième jour du mois a un seul jour de la semaine et son rang.');
                }
                break;
            case RhythmKind::MonthlyDate:
                if ([] !== $this->weekdays || null !== $this->monthWeek || null === $this->monthDay || 1 !== $this->everyWeeks) {
                    $refuse('kind', 'Une date du mois n\'a que sa date.');
                }
                break;
            case null:
                break;
        }
    }

    /** Une fois la validation passée. */
    public function spec(): RecurrenceSpec
    {
        return new RecurrenceSpec(
            match (RhythmKind::from($this->kind)) {
                RhythmKind::Weekly => Rhythm::weekly($this->weekdays, $this->everyWeeks),
                RhythmKind::MonthlyWeekday => Rhythm::monthlyWeekday($this->weekdays[0] ?? 0, $this->monthWeek ?? 0),
                RhythmKind::MonthlyDate => Rhythm::monthlyDate($this->monthDay ?? 0),
            },
            null === $this->until ? null : UserCalendar::date($this->until),
        );
    }
}
