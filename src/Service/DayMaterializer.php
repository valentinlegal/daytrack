<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\TemplateRule;
use App\Entity\TimeEntry;
use App\Entity\WorkDay;
use App\Enum\EntryType;
use App\Enum\TemplateRuleType;
use App\Repository\TemplateRuleRepository;
use App\Repository\WorkDayRepository;
use DateTimeImmutable;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Résout une journée à partir des règles récurrentes actives : soit en mémoire
 * sans effet de bord (preview, pour la simple consultation), soit persistée
 * (materialize, dès qu'une mutation réelle a lieu sur cette journée).
 */
final class DayMaterializer
{
    public function __construct(
        private readonly WorkDayRepository $workDayRepository,
        private readonly TemplateRuleRepository $templateRuleRepository,
        private readonly TemplateRuleMatcher $matcher,
        private readonly EntityManagerInterface $em,
    ) {}

    /**
     * Retourne le jour existant, ou un WorkDay calculé à partir des règles actives
     * mais jamais persisté.
     */
    public function preview(DateTimeImmutable $date): WorkDay
    {
        return $this->workDayRepository->findByDate($date) ?? $this->buildFromRules($date, persist: false);
    }

    /**
     * Retourne le jour existant, ou le matérialise (persiste) à partir des règles actives.
     * Idempotent : si le jour existe déjà, ne le recalcule jamais.
     */
    public function materialize(DateTimeImmutable $date): WorkDay
    {
        return $this->workDayRepository->findByDate($date) ?? $this->buildFromRules($date, persist: true);
    }

    private function buildFromRules(DateTimeImmutable $date, bool $persist): WorkDay
    {
        $day = new WorkDay($date);

        $matching = array_values(array_filter(
            $this->templateRuleRepository->findAllEnabled(),
            fn (TemplateRule $rule) => $this->matcher->matches($rule, $date),
        ));

        $targetRule = $this->highestPosition(array_filter(
            $matching,
            static fn (TemplateRule $r) => TemplateRuleType::TARGET_OVERRIDE === $r->ruleType,
        ));
        if (null !== $targetRule) {
            $day->targetMinutes = (int) $targetRule->targetMinutes;
        }

        $entryRules = array_filter(
            $matching,
            static fn (TemplateRule $r) => TemplateRuleType::TARGET_OVERRIDE !== $r->ruleType,
        );

        foreach ($this->deduplicateOverlaps($entryRules) as $rule) {
            $day->addEntry($this->buildEntry($day, $date, $rule));
        }

        if ($persist) {
            $this->em->persist($day);
            $this->em->flush();
        }

        return $day;
    }

    private function buildEntry(WorkDay $day, DateTimeImmutable $date, TemplateRule $rule): TimeEntry
    {
        $startedAt = DateTimeImmutable::createFromFormat('Y-m-d H:i', $date->format('Y-m-d').' '.$rule->startTime);
        $entry = new TimeEntry(
            workDay: $day,
            startedAt: $startedAt,
            type: TemplateRuleType::BREAK === $rule->ruleType ? EntryType::BREAK : EntryType::WORK,
        );
        $entry->endedAt = $startedAt->modify('+'.$rule->durationMinutes.' minutes');

        if (EntryType::WORK === $entry->type) {
            $entry->ticketKey = $rule->ticketKey;
            $entry->ticketSummary = $rule->ticketSummary;
            $entry->ticketType = $rule->ticketType;
            $entry->comment = $rule->comment;
        }

        return $entry;
    }

    /**
     * @param TemplateRule[] $rules
     * @return TemplateRule[] règles ne se chevauchant plus entre elles, la plus grande
     *                        position gagnant sur un chevauchement (cas limite, ne devrait
     *                        pas arriver via l'UI d'édition normale)
     */
    private function deduplicateOverlaps(array $rules): array
    {
        $sorted = $rules;
        usort($sorted, static fn (TemplateRule $a, TemplateRule $b) => $b->position <=> $a->position);

        $kept = [];
        foreach ($sorted as $rule) {
            $overlapsKept = false;
            foreach ($kept as $existing) {
                if ($this->matcher->overlaps($rule, $existing)) {
                    $overlapsKept = true;
                    break;
                }
            }
            if (!$overlapsKept) {
                $kept[] = $rule;
            }
        }

        return $kept;
    }

    /**
     * @param TemplateRule[] $rules
     */
    private function highestPosition(array $rules): ?TemplateRule
    {
        $best = null;
        foreach ($rules as $rule) {
            if (null === $best || $rule->position > $best->position) {
                $best = $rule;
            }
        }

        return $best;
    }
}
