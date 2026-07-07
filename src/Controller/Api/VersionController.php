<?php

declare(strict_types=1);

namespace App\Controller\Api;

use App\Service\VersionChecker;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;

/**
 * Expose la version courante de l'application et indique si une version plus récente
 * est disponible sur le registre d'images (ghcr.io).
 */
class VersionController extends AbstractController
{
    public function __construct(
        private readonly VersionChecker $versionChecker,
    ) {}

    #[Route('/api/version', name: 'api_version', methods: ['GET'])]
    public function check(): JsonResponse
    {
        return $this->json($this->versionChecker->check());
    }
}
