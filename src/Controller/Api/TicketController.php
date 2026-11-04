<?php

namespace App\Controller\Api;

use App\Api\Input\TicketsInput;
use App\Jira\TicketBook;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Serializer\Normalizer\AbstractNormalizer;
use Symfony\Component\Serializer\Normalizer\DenormalizerInterface;

/**
 * Les tickets, tels que Jira les décrit : celui qu'on tape dans une fenêtre, et ceux
 * de l'écran, dont le titre se relit quand il a vieilli.
 */
#[Route('/api/tickets', format: 'json')]
final class TicketController extends AbstractController
{
    /** Un champ inconnu est refusé comme une valeur de travers, champ par champ. */
    private const array STRICT = [
        AbstractNormalizer::ALLOW_EXTRA_ATTRIBUTES => false,
        DenormalizerInterface::COLLECT_EXTRA_ATTRIBUTES_ERRORS => true,
    ];

    public function __construct(
        private readonly TicketBook $tickets,
    ) {
    }

    /**
     * Ce que Jira dit d'un ticket qu'on tape : son titre et son type, ou pourquoi il
     * ne les donne pas — introuvable, jeton refusé, Jira muet. Et ce que Jira reproche au
     * jeton enregistré, une fois la recherche faite : un titre lu sans appeler Jira ne dit
     * pas que le jeton passe de nouveau.
     *
     * Une recherche écrit : le titre se garde, un refus du jeton se note. Elle passe donc
     * en POST, comme la relecture, et seule la page de DayTrack la demande
     * (SameOriginGuard).
     */
    #[Route('/{key}/lookup', name: 'api_tickets_lookup', requirements: ['key' => '[A-Z][A-Z0-9_]+-[1-9][0-9]*'], methods: ['POST'])]
    public function lookup(string $key): JsonResponse
    {
        $lookup = $this->tickets->lookup($key)->toArray();

        return $this->json($lookup + ['refusal' => $this->tickets->refusal()?->value]);
    }

    /**
     * Relit dans Jira les titres de plus d'une heure parmi ces tickets, et rend ce que
     * DayTrack en sait ensuite. L'écran le demande après avoir affiché la journée : il
     * ne l'attend pas pour se montrer.
     */
    #[Route('/refresh', name: 'api_tickets_refresh', methods: ['POST'])]
    public function refresh(#[MapRequestPayload(acceptFormat: 'json', serializationContext: self::STRICT)] TicketsInput $input): JsonResponse
    {
        $refusal = $this->tickets->refresh($input->tickets);

        return $this->json([
            'tickets' => $this->tickets->describe($input->tickets),
            'refusal' => $refusal?->value,
        ]);
    }
}
