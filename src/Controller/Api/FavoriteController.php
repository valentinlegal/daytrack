<?php

namespace App\Controller\Api;

use App\Api\Input\FavoriteInput;
use App\Api\Input\FavoriteNameInput;
use App\Api\Input\FavoriteOrderInput;
use App\Entity\Favorite;
use App\Favorite\DuplicateFavorite;
use App\Favorite\FavoriteWriter;
use App\Favorite\NotAlreadyFavorite;
use App\Jira\TicketBook;
use App\Repository\FavoriteRepository;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\HttpKernel\Exception\UnprocessableEntityHttpException;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Routing\Requirement\Requirement;
use Symfony\Component\Serializer\Normalizer\AbstractNormalizer;
use Symfony\Component\Serializer\Normalizer\DenormalizerInterface;
use Symfony\Component\Uid\Uuid;
use Symfony\Component\Validator\ConstraintViolation;
use Symfony\Component\Validator\ConstraintViolationList;
use Symfony\Component\Validator\Exception\ValidationFailedException;

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
    /** Un champ inconnu est refusé comme une valeur de travers, champ par champ. */
    private const array STRICT = [
        AbstractNormalizer::ALLOW_EXTRA_ATTRIBUTES => false,
        DenormalizerInterface::COLLECT_EXTRA_ATTRIBUTES_ERRORS => true,
    ];

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
    public function add(#[MapRequestPayload(acceptFormat: 'json', serializationContext: self::STRICT)] FavoriteInput $input): JsonResponse
    {
        try {
            $this->writer->add($input->ticket(), $input->name, $input->position);
        } catch (DuplicateFavorite) {
            // Ajouté par un autre onglet entre la validation et l'écriture : le même refus
            // que celui de la validation, sous le champ.
            $constraint = new NotAlreadyFavorite();
            $violation = new ConstraintViolation(
                str_replace('{{ ticket }}', $input->ticket(), $constraint->message),
                $constraint->message,
                ['{{ ticket }}' => $input->ticket()],
                $input,
                'ticket',
                $input->ticket(),
                constraint: $constraint,
            );

            throw new UnprocessableEntityHttpException(previous: new ValidationFailedException($input, new ConstraintViolationList([$violation])));
        }

        return $this->list(Response::HTTP_CREATED);
    }

    #[Route('/{id}', name: 'api_favorites_rename', requirements: ['id' => Requirement::UUID], methods: ['PATCH'])]
    public function rename(Uuid $id, #[MapRequestPayload(acceptFormat: 'json', serializationContext: self::STRICT)] FavoriteNameInput $input): JsonResponse
    {
        return $this->writer->rename($id, $input->name) ? $this->list() : $this->list(Response::HTTP_NOT_FOUND, 'not_found');
    }

    #[Route('/{id}', name: 'api_favorites_remove', requirements: ['id' => Requirement::UUID], methods: ['DELETE'])]
    public function remove(Uuid $id): JsonResponse
    {
        return $this->writer->remove($id) ? $this->list() : $this->list(Response::HTTP_NOT_FOUND, 'not_found');
    }

    #[Route('/order', name: 'api_favorites_order', methods: ['PUT'])]
    public function reorder(#[MapRequestPayload(acceptFormat: 'json', serializationContext: self::STRICT)] FavoriteOrderInput $input): JsonResponse
    {
        return $this->writer->reorder($input->uuids()) ? $this->list() : $this->list(Response::HTTP_CONFLICT, 'stale');
    }

    private function list(int $status = Response::HTTP_OK, ?string $error = null): JsonResponse
    {
        $ordered = $this->favorites->ordered();
        $body = [
            'favorites' => array_map(static fn (Favorite $favorite): array => $favorite->toArray(), $ordered),
            // Ce que DayTrack sait de leurs tickets : le titre de Jira tient lieu de nom.
            'tickets' => (object) $this->tickets->describe(array_map(static fn (Favorite $favorite): string => $favorite->ticket, $ordered)),
        ];

        return $this->json(null === $error ? $body : ['error' => $error] + $body, $status);
    }
}
