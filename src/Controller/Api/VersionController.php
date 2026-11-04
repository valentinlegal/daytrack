<?php

namespace App\Controller\Api;

use App\Version\AvailableVersion;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;

/**
 * La version à installer, que le pied de colonne annonce. Une lecture, sans jeton ni donnée
 * de l'utilisateur : rien de ce que DayTrack garde ne part vers le registre.
 */
final class VersionController extends AbstractController
{
    public function __construct(
        private readonly AvailableVersion $version,
    ) {
    }

    #[Route('/api/version', name: 'api_version', methods: ['GET'], format: 'json')]
    public function available(): JsonResponse
    {
        return $this->json(['available' => $this->version->find()]);
    }
}
