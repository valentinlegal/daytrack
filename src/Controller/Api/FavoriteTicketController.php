<?php

declare(strict_types=1);

namespace App\Controller\Api;

use App\Dto\Input\CreateFavoriteInput;
use App\Dto\Input\ReorderFavoritesInput;
use App\Dto\Input\UpdateFavoriteInput;
use App\Dto\Output\FavoriteTicketOutput;
use App\Entity\FavoriteTicket;
use App\Repository\FavoriteTicketRepository;
use App\Service\JiraConfigProvider;
use App\Service\JiraService;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Uid\Uuid;
use Symfony\Contracts\Translation\TranslatorInterface;

/**
 * Gère les tickets favoris de l'utilisateur.
 */
#[Route('/api/favorites')]
class FavoriteTicketController extends AbstractController
{
    public function __construct(
        private readonly FavoriteTicketRepository $favoriteRepository,
        private readonly EntityManagerInterface $em,
        private readonly TranslatorInterface $translator,
        private readonly JiraService $jiraService,
        private readonly JiraConfigProvider $jiraConfig,
    ) {}

    /**
     * Retourne la liste de tous les favoris, triés par position.
     */
    #[Route('', name: 'api_favorites_list', methods: ['GET'])]
    public function list(): JsonResponse
    {
        $favorites = $this->favoriteRepository->findAllOrderedByPosition();

        return $this->json(array_map(
            static fn (FavoriteTicket $f) => FavoriteTicketOutput::fromEntity($f),
            $favorites,
        ));
    }

    /**
     * Ajoute un ticket en favori.
     * Si Jira est configuré, vérifie l'existence du ticket et enrichit le nom et le type.
     */
    #[Route('', name: 'api_favorites_create', methods: ['POST'])]
    public function create(#[MapRequestPayload] CreateFavoriteInput $input): JsonResponse
    {
        $ticketKey = strtoupper(trim($input->ticketKey));

        $existing = $this->favoriteRepository->findOneBy(['ticketKey' => $ticketKey]);
        if (null !== $existing) {
            return $this->json(
                ['error' => $this->translator->trans('error.favorite_already_exists')],
                Response::HTTP_CONFLICT,
            );
        }

        $favorite = new FavoriteTicket();
        $favorite->ticketKey = $ticketKey;
        $favorite->position = $this->favoriteRepository->getMaxPosition() + 1;

        if ($this->jiraConfig->isConfigured()) {
            try {
                $info = $this->jiraService->fetchTicketInfo($ticketKey);
                $favorite->ticketSummary = $info['summary'] ?? null;
                $favorite->ticketType = $info['type'] ?? null;
            } catch (\Throwable) {
                return $this->json(
                    ['error' => $this->translator->trans('error.jira_ticket_not_found')],
                    Response::HTTP_UNPROCESSABLE_ENTITY,
                );
            }
        }

        $this->em->persist($favorite);
        $this->em->flush();

        return $this->json(FavoriteTicketOutput::fromEntity($favorite), Response::HTTP_CREATED);
    }

    /**
     * Met à jour le nom personnalisé d'un favori.
     */
    #[Route('/{id}', name: 'api_favorites_update', methods: ['PATCH'])]
    public function update(string $id, #[MapRequestPayload] UpdateFavoriteInput $input): JsonResponse
    {
        $favorite = $this->favoriteRepository->find(Uuid::fromString($id));

        if (null === $favorite) {
            return $this->json(
                ['error' => $this->translator->trans('error.favorite_not_found')],
                Response::HTTP_NOT_FOUND,
            );
        }

        $favorite->customName = $input->customName;
        $this->em->flush();

        return $this->json(FavoriteTicketOutput::fromEntity($favorite));
    }

    /**
     * Supprime un favori.
     */
    #[Route('/{id}', name: 'api_favorites_delete', methods: ['DELETE'])]
    public function delete(string $id): JsonResponse
    {
        $favorite = $this->favoriteRepository->find(Uuid::fromString($id));

        if (null === $favorite) {
            return $this->json(
                ['error' => $this->translator->trans('error.favorite_not_found')],
                Response::HTTP_NOT_FOUND,
            );
        }

        $this->em->remove($favorite);
        $this->em->flush();

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }

    /**
     * Met à jour l'ordre des favoris suite à un drag & drop.
     * Le tableau ids doit contenir tous les IDs dans le nouvel ordre.
     */
    #[Route('/reorder', name: 'api_favorites_reorder', methods: ['POST'])]
    public function reorder(#[MapRequestPayload] ReorderFavoritesInput $input): JsonResponse
    {
        foreach ($input->ids as $position => $id) {
            $favorite = $this->favoriteRepository->find(Uuid::fromString($id));
            if (null !== $favorite) {
                $favorite->position = $position;
            }
        }

        $this->em->flush();

        $favorites = $this->favoriteRepository->findAllOrderedByPosition();

        return $this->json(array_map(
            static fn (FavoriteTicket $f) => FavoriteTicketOutput::fromEntity($f),
            $favorites,
        ));
    }
}
