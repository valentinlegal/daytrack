<?php

declare(strict_types=1);

namespace App\Controller\Api;

use App\Dto\Input\UpdateDayInput;
use App\Dto\Output\WorkDayOutput;
use App\Repository\WorkDayRepository;
use App\Service\DayMaterializer;
use DateTimeImmutable;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Contracts\Translation\TranslatorInterface;

/**
 * Gère la récupération et la création automatique des journées de travail.
 */
#[Route('/api/days')]
class DayController extends AbstractController
{
    public function __construct(
        private readonly WorkDayRepository $workDayRepository,
        private readonly EntityManagerInterface $em,
        private readonly TranslatorInterface $translator,
        private readonly DayMaterializer $materializer,
    ) {}

    /**
     * Retourne la journée pour la date donnée.
     * Si elle n'existe pas encore en base, retourne une journée virtuelle avec les valeurs par défaut.
     */
    #[Route('/{date}', name: 'api_days_get', methods: ['GET'])]
    public function get(string $date): JsonResponse
    {
        $parsedDate = DateTimeImmutable::createFromFormat('Y-m-d', $date);

        if (false === $parsedDate) {
            return $this->json(
                ['error' => $this->translator->trans('error.invalid_date_format')],
                Response::HTTP_BAD_REQUEST,
            );
        }

        // Comparaison par chaîne pour éviter les décalages liés à la partie heure de createFromFormat
        if ($parsedDate->format('Y-m-d') > (new DateTimeImmutable('+30 days'))->format('Y-m-d')) {
            return $this->json(
                ['error' => $this->translator->trans('error.future_day_forbidden')],
                Response::HTTP_UNPROCESSABLE_ENTITY,
            );
        }

        $day = $this->materializer->preview($parsedDate);

        return $this->json(WorkDayOutput::fromEntity($day));
    }

    /**
     * Met à jour l'objectif de la journée (targetMinutes).
     */
    #[Route('/{date}', name: 'api_days_patch', methods: ['PATCH'])]
    public function patch(string $date, #[MapRequestPayload] UpdateDayInput $input): JsonResponse
    {
        $parsedDate = DateTimeImmutable::createFromFormat('Y-m-d', $date);

        if (false === $parsedDate) {
            return $this->json(
                ['error' => $this->translator->trans('error.invalid_date_format')],
                Response::HTTP_BAD_REQUEST,
            );
        }

        // Comparaison par chaîne pour éviter les décalages liés à la partie heure de createFromFormat
        if ($parsedDate->format('Y-m-d') > (new DateTimeImmutable('+30 days'))->format('Y-m-d')) {
            return $this->json(
                ['error' => $this->translator->trans('error.future_day_forbidden')],
                Response::HTTP_UNPROCESSABLE_ENTITY,
            );
        }

        // materialize() = findByDate() ?? buildFromRules(persist) — inutile de refaire findByDate() ici.
        $day = $this->materializer->materialize($parsedDate);

        $day->targetMinutes = $input->targetMinutes;
        $this->em->flush();

        return $this->json(WorkDayOutput::fromEntity($day));
    }

    /**
     * Matérialise la journée depuis les règles actives si elle n'existe pas encore en
     * base — idempotent. Utilisé par le front juste avant la première édition/suppression
     * d'un bloc pré-rempli par template, pour obtenir un id réel avant l'appel PUT/DELETE.
     */
    #[Route('/{date}/materialize', name: 'api_days_materialize', methods: ['POST'])]
    public function materialize(string $date): JsonResponse
    {
        $parsedDate = DateTimeImmutable::createFromFormat('Y-m-d', $date);

        if (false === $parsedDate) {
            return $this->json(
                ['error' => $this->translator->trans('error.invalid_date_format')],
                Response::HTTP_BAD_REQUEST,
            );
        }

        if ($parsedDate->format('Y-m-d') > (new DateTimeImmutable('+30 days'))->format('Y-m-d')) {
            return $this->json(
                ['error' => $this->translator->trans('error.future_day_forbidden')],
                Response::HTTP_UNPROCESSABLE_ENTITY,
            );
        }

        $day = $this->materializer->materialize($parsedDate);

        return $this->json(WorkDayOutput::fromEntity($day));
    }
}