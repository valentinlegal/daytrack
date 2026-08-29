<?php

declare(strict_types=1);

namespace App\Controller\Api;

use App\Dto\Input\CreateTemplateRuleInput;
use App\Dto\Input\UpdateTemplateRuleInput;
use App\Dto\Output\TemplateRuleOutput;
use App\Entity\TemplateRule;
use App\Enum\TemplateRuleType;
use App\Repository\TemplateRuleRepository;
use App\Service\TemplateRuleMatcher;
use DateTimeImmutable;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Uid\Uuid;
use Symfony\Contracts\Translation\TranslatorInterface;

/**
 * Gère les règles récurrentes qui pré-remplissent automatiquement les journées vides.
 */
#[Route('/api/template-rules')]
class TemplateRuleController extends AbstractController
{
    public function __construct(
        private readonly TemplateRuleRepository $ruleRepository,
        private readonly TemplateRuleMatcher $matcher,
        private readonly EntityManagerInterface $em,
        private readonly TranslatorInterface $translator,
    ) {}

    /**
     * Retourne toutes les règles (activées et désactivées), triées par position.
     */
    #[Route('', name: 'api_template_rules_list', methods: ['GET'])]
    public function list(): JsonResponse
    {
        return $this->json(array_map(
            static fn (TemplateRule $r) => TemplateRuleOutput::fromEntity($r),
            $this->ruleRepository->findAllOrderedByPosition(),
        ));
    }

    /**
     * Crée une nouvelle règle récurrente.
     */
    #[Route('', name: 'api_template_rules_create', methods: ['POST'])]
    public function create(#[MapRequestPayload] CreateTemplateRuleInput $input): JsonResponse
    {
        $ruleType = TemplateRuleType::from($input->ruleType);
        $today = new DateTimeImmutable('today');

        $anchorDate = null !== $input->anchorDate
            ? DateTimeImmutable::createFromFormat('Y-m-d', $input->anchorDate)->setTime(0, 0)
            : $this->nextOccurrence($input->weekday, $today);

        if ((int) $anchorDate->format('N') !== $input->weekday) {
            return $this->json(
                ['error' => $this->translator->trans('error.template_rule_anchor_weekday_mismatch')],
                Response::HTTP_UNPROCESSABLE_ENTITY,
            );
        }

        if ($anchorDate < $today) {
            return $this->json(
                ['error' => $this->translator->trans('error.template_rule_anchor_in_past')],
                Response::HTTP_UNPROCESSABLE_ENTITY,
            );
        }

        $rule = new TemplateRule($ruleType, $input->weekday, $anchorDate);
        $rule->intervalWeeks = $input->intervalWeeks;
        $rule->enabled = $input->enabled;
        $rule->position = $this->ruleRepository->getMaxPosition() + 1;

        if (null !== $input->activeUntil) {
            $rule->activeUntil = DateTimeImmutable::createFromFormat('Y-m-d', $input->activeUntil)->setTime(0, 0);
        }

        if (null !== $input->rotationGroupId) {
            $rule->rotationGroupId = Uuid::fromString($input->rotationGroupId);
        }

        if (TemplateRuleType::TARGET_OVERRIDE === $ruleType) {
            $rule->targetMinutes = $input->targetMinutes;
        } else {
            $rule->startTime = $input->startTime;
            $rule->durationMinutes = $input->durationMinutes;

            if (TemplateRuleType::WORK === $ruleType) {
                $rule->ticketKey = $input->ticketKey;
                $rule->ticketSummary = $input->ticketSummary;
                $rule->ticketType = $input->ticketType;
                $rule->comment = $input->comment;
            }

            if ($rule->enabled && $this->hasOverlap($rule)) {
                return $this->json(
                    ['error' => $this->translator->trans('error.template_rule_overlap')],
                    Response::HTTP_CONFLICT,
                );
            }
        }

        $this->em->persist($rule);
        $this->em->flush();

        return $this->json(TemplateRuleOutput::fromEntity($rule), Response::HTTP_CREATED);
    }

    /**
     * Met à jour une règle existante (patch partiel).
     */
    #[Route('/{id}', name: 'api_template_rules_update', methods: ['PUT'])]
    public function update(string $id, #[MapRequestPayload] UpdateTemplateRuleInput $input): JsonResponse
    {
        $rule = $this->ruleRepository->find(Uuid::fromString($id));

        if (null === $rule) {
            return $this->json(
                ['error' => $this->translator->trans('error.template_rule_not_found')],
                Response::HTTP_NOT_FOUND,
            );
        }

        if (null !== $input->weekday) {
            $rule->weekday = $input->weekday;
        }

        if (null !== $input->intervalWeeks) {
            $rule->intervalWeeks = $input->intervalWeeks;
        }

        if (null !== $input->anchorDate) {
            $rule->anchorDate = DateTimeImmutable::createFromFormat('Y-m-d', $input->anchorDate)->setTime(0, 0);
        }

        if (null !== $input->activeUntil) {
            $rule->activeUntil = DateTimeImmutable::createFromFormat('Y-m-d', $input->activeUntil)->setTime(0, 0);
        }

        if (null !== $input->enabled) {
            $rule->enabled = $input->enabled;
        }

        // Si le jour de semaine ou l'ancrage a changé, revalider les mêmes invariants qu'à
        // la création (l'ancrage doit tomber sur le jour de semaine, jamais dans le passé) —
        // sinon TemplateRuleMatcher calculerait une phase de récurrence incorrecte.
        if (null !== $input->weekday || null !== $input->anchorDate) {
            if ((int) $rule->anchorDate->format('N') !== $rule->weekday) {
                return $this->json(
                    ['error' => $this->translator->trans('error.template_rule_anchor_weekday_mismatch')],
                    Response::HTTP_UNPROCESSABLE_ENTITY,
                );
            }

            if ($rule->anchorDate < new DateTimeImmutable('today')) {
                return $this->json(
                    ['error' => $this->translator->trans('error.template_rule_anchor_in_past')],
                    Response::HTTP_UNPROCESSABLE_ENTITY,
                );
            }
        }

        if (TemplateRuleType::TARGET_OVERRIDE === $rule->ruleType) {
            if (null !== $input->targetMinutes) {
                $rule->targetMinutes = $input->targetMinutes;
            }
        } else {
            if (null !== $input->startTime) {
                $rule->startTime = $input->startTime;
            }
            if (null !== $input->durationMinutes) {
                $rule->durationMinutes = $input->durationMinutes;
            }
            if (TemplateRuleType::WORK === $rule->ruleType) {
                if (null !== $input->ticketKey) {
                    $rule->ticketKey = $input->ticketKey;
                }
                if (null !== $input->ticketSummary) {
                    $rule->ticketSummary = $input->ticketSummary;
                }
                if (null !== $input->ticketType) {
                    $rule->ticketType = $input->ticketType;
                }
                if (null !== $input->comment) {
                    $rule->comment = $input->comment;
                }
            }
        }

        $this->em->flush();

        return $this->json(TemplateRuleOutput::fromEntity($rule));
    }

    /**
     * Supprime une règle. Si elle appartenait à un groupe d'alternance qui ne
     * contient alors plus qu'un seul membre, celui-ci redevient une règle
     * hebdomadaire simple (sinon il resterait actif une semaine sur deux avec
     * un créneau vide silencieux l'autre semaine).
     */
    #[Route('/{id}', name: 'api_template_rules_delete', methods: ['DELETE'])]
    public function delete(string $id): JsonResponse
    {
        $rule = $this->ruleRepository->find(Uuid::fromString($id));

        if (null === $rule) {
            return $this->json(
                ['error' => $this->translator->trans('error.template_rule_not_found')],
                Response::HTTP_NOT_FOUND,
            );
        }

        $rotationGroupId = $rule->rotationGroupId;

        $this->em->remove($rule);
        $this->em->flush();

        if (null !== $rotationGroupId) {
            $this->collapseRotationGroupIfSingleMember($rotationGroupId);
        }

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }

    /**
     * Retourne la première occurrence du jour de semaine donné à partir de $from (incluse).
     */
    private function nextOccurrence(int $weekday, DateTimeImmutable $from): DateTimeImmutable
    {
        $from = $from->setTime(0, 0);
        $diff = ($weekday - (int) $from->format('N') + 7) % 7;

        return $from->modify("+{$diff} days");
    }

    /**
     * Vérifie que la règle candidate ne chevauche aucune règle WORK/BREAK activée existante.
     */
    private function hasOverlap(TemplateRule $candidate): bool
    {
        foreach ($this->ruleRepository->findAllEnabled() as $existing) {
            if (TemplateRuleType::TARGET_OVERRIDE !== $existing->ruleType
                && $existing !== $candidate
                && $this->matcher->overlaps($candidate, $existing)
            ) {
                return true;
            }
        }

        return false;
    }

    private function collapseRotationGroupIfSingleMember(Uuid $rotationGroupId): void
    {
        $remaining = $this->ruleRepository->findBy(['rotationGroupId' => $rotationGroupId]);

        if (1 !== count($remaining)) {
            return;
        }

        $last = $remaining[0];
        $last->intervalWeeks = 1;
        $last->rotationGroupId = null;
        $this->em->flush();
    }
}
