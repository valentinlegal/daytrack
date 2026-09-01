<?php

declare(strict_types=1);

namespace App\Controller\Api;

use App\Dto\Output\WorkDayOutput;
use App\Service\DayMaterializer;
use App\Service\JiraConfigProvider;
use App\Service\JiraSyncService;
use DateTimeImmutable;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Contracts\Translation\TranslatorInterface;

/**
 * Déclenche la synchronisation des saisies d'une journée vers JIRA.
 */
class JiraSyncController extends AbstractController
{
    public function __construct(
        private readonly DayMaterializer $materializer,
        private readonly JiraSyncService $syncService,
        private readonly JiraConfigProvider $jiraConfig,
        private readonly EntityManagerInterface $em,
        private readonly TranslatorInterface $translator,
    ) {}

    /**
     * Lance la synchronisation des entrées WORK du jour donné vers JIRA.
     * Retourne la journée mise à jour ainsi qu'un résumé de la synchronisation.
     */
    #[Route('/api/days/{date}/jira-sync', name: 'api_jira_sync', methods: ['POST'])]
    public function sync(string $date): JsonResponse
    {
        if (!$this->jiraConfig->isConfigured()) {
            return $this->json(
                ['error' => $this->translator->trans('error.jira_not_configured')],
                Response::HTTP_SERVICE_UNAVAILABLE,
            );
        }

        $parsedDate = DateTimeImmutable::createFromFormat('Y-m-d', $date);

        if (false === $parsedDate) {
            return $this->json(
                ['error' => $this->translator->trans('error.invalid_date_format')],
                Response::HTTP_BAD_REQUEST,
            );
        }

        // Même borne que DayController / EntryController : matérialiser (donc persister)
        // une journée hors fenêtre polluerait la base.
        if ($parsedDate->format('Y-m-d') > (new DateTimeImmutable('+30 days'))->format('Y-m-d')) {
            return $this->json(
                ['error' => $this->translator->trans('error.future_day_forbidden')],
                Response::HTTP_UNPROCESSABLE_ENTITY,
            );
        }

        $day = $this->materializer->materialize($parsedDate);

        $result = $this->syncService->sync($day);

        // Mise à jour du statut de sync uniquement en cas de succès total
        if (!$result->hasErrors()) {
            $day->jiraSyncedAt = new DateTimeImmutable();
            // Mémoriser les tickets syncés pour permettre le nettoyage lors du prochain sync
            $day->jiraSyncedTickets = array_values(
                array_unique(array_column(
                    array_filter(
                        $day->entries->toArray(),
                        fn ($e) => null !== $e->ticketKey,
                    ),
                    'ticketKey',
                ))
            ) ?: null;
            $this->em->flush();
        }

        return $this->json([
            'workDay' => WorkDayOutput::fromEntity($day),
            'syncedCount' => $result->syncedCount,
            'deletedCount' => $result->deletedCount,
            'errors' => $result->errors,
        ]);
    }
}
