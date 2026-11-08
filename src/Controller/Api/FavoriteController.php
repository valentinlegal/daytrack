<?php

namespace App\Controller\Api;

use App\Api\ApiError;
use App\Api\FieldRefusal;
use App\Api\Input\FavoriteInput;
use App\Api\Input\FavoriteNameInput;
use App\Api\Input\FavoriteOrderInput;
use App\Api\JsonPayload;
use App\Entity\Favorite;
use App\Favorite\DuplicateFavorite;
use App\Favorite\FavoriteWriter;
use App\Favorite\NotAlreadyFavorite;
use App\Jira\TicketBook;
use App\Repository\FavoriteRepository;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Routing\Requirement\Requirement;
use Symfony\Component\Uid\Uuid;

/**
 * La liste des favoris : la lire, y ajouter, renommer, retirer, changer l'ordre.
 *
 * Chaque réponse rend la liste entière, telle que la base la tient. Un geste sur un
 * favori qu'un autre onglet a retiré, ou un ordre qui ne nomme plus les favoris de la
 * liste, n'écrit rien : la réponse rend la liste à jour, pour que l'écran s'y remette.
 */
#[Route('/api/favorites', format: 'json')]
final class FavoriteController extends AbstractController
{
    public function __construct(
        private readonly FavoriteRepository $favorites,
        private readonly FavoriteWriter $writer,
        private readonly TicketBook $tickets,
    ) {
    }

    #[Route('', name: 'api_favorites_show', methods: ['GET'])]
    public function show(): JsonResponse
    {
        return $this->list();
    }

    #[Route('', name: 'api_favorites_add', methods: ['POST'])]
    public function add(#[JsonPayload] FavoriteInput $input): JsonResponse
    {
        try {
            $this->writer->add($input->ticket(), $input->name, $input->position);
        } catch (DuplicateFavorite) {
            // Ajouté par un autre onglet entre la validation et l'écriture : le même refus
            // que celui de la validation, sous le champ.
            $constraint = new NotAlreadyFavorite();

            throw FieldRefusal::under($input, 'ticket', $constraint, $constraint->message, ['{{ ticket }}' => $input->ticket()], $input->ticket());
        }

        return $this->list(Response::HTTP_CREATED);
    }

    #[Route('/{id}', name: 'api_favorites_rename', requirements: ['id' => Requirement::UUID], methods: ['PATCH'])]
    public function rename(Uuid $id, #[JsonPayload] FavoriteNameInput $input): JsonResponse
    {
        return $this->writer->rename($id, $input->name) ? $this->list() : $this->list(Response::HTTP_NOT_FOUND, ApiError::NotFound);
    }

    #[Route('/{id}', name: 'api_favorites_remove', requirements: ['id' => Requirement::UUID], methods: ['DELETE'])]
    public function remove(Uuid $id): JsonResponse
    {
        return $this->writer->remove($id) ? $this->list() : $this->list(Response::HTTP_NOT_FOUND, ApiError::NotFound);
    }

    #[Route('/order', name: 'api_favorites_order', methods: ['PUT'])]
    public function reorder(#[JsonPayload] FavoriteOrderInput $input): JsonResponse
    {
        return $this->writer->reorder($input->uuids()) ? $this->list() : $this->list(Response::HTTP_CONFLICT, ApiError::Stale);
    }

    private function list(int $status = Response::HTTP_OK, ?ApiError $error = null): JsonResponse
    {
        $ordered = $this->favorites->ordered();
        $body = [
            'favorites' => array_map(static fn (Favorite $favorite): array => $favorite->toArray(), $ordered),
            // Ce que DayTrack sait de leurs tickets, le titre de Jira tenant lieu de nom. Un
            // objet même vide : le navigateur y cherche un ticket par son identifiant.
            'tickets' => (object) $this->tickets->describe(array_map(static fn (Favorite $favorite): string => $favorite->ticket, $ordered)),
        ];

        return $this->json(null === $error ? $body : $error->body() + $body, $status);
    }
}
