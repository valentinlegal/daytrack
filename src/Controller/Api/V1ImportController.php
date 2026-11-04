<?php

namespace App\Controller\Api;

use App\Repository\V1ImportRepository;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

/**
 * Ce que la reprise de la v1 a laissé de côté : l'écran le dit une fois, puis on ne le
 * lui redemande plus. L'ancienne base garde ces saisies.
 */
final class V1ImportController extends AbstractController
{
    public function __construct(
        private readonly V1ImportRepository $imports,
        private readonly EntityManagerInterface $entityManager,
    ) {
    }

    #[Route('/api/v1-import/seen', name: 'api_v1_import_seen', methods: ['POST'], format: 'json')]
    public function seen(): Response
    {
        $this->imports->current()?->seen();
        $this->entityManager->flush();

        return new Response(status: Response::HTTP_NO_CONTENT);
    }
}
