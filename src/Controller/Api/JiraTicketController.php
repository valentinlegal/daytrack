<?php

declare(strict_types=1);

namespace App\Controller\Api;

use App\Service\JiraConfigProvider;
use App\Service\JiraService;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Contracts\Translation\TranslatorInterface;

/**
 * Fournit les informations d'un ticket Jira (titre, type) pour l'affichage dans la timeline.
 */
class JiraTicketController extends AbstractController
{
    public function __construct(
        private readonly JiraService $jiraService,
        private readonly JiraConfigProvider $config,
        private readonly TranslatorInterface $translator,
    ) {}

    /**
     * Retourne le titre et le type d'un ticket Jira.
     * Si le ticket est une sous-tâche, le type retourné est celui de la tâche parente.
     */
    #[Route('/api/jira/ticket/{ticketKey}', name: 'api_jira_ticket_info', methods: ['GET'])]
    public function info(string $ticketKey): JsonResponse
    {
        if (!$this->config->isConfigured()) {
            return $this->json(
                ['error' => $this->translator->trans('error.jira_not_configured')],
                Response::HTTP_NOT_FOUND,
            );
        }

        try {
            $info = $this->jiraService->fetchTicketInfo($ticketKey);
        } catch (\Throwable) {
            return $this->json(
                ['error' => $this->translator->trans('error.jira_ticket_not_found')],
                Response::HTTP_NOT_FOUND,
            );
        }

        return $this->json($info);
    }
}