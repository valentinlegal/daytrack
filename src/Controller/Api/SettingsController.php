<?php

namespace App\Controller\Api;

use App\Api\Input\HabitualObjectiveInput;
use App\Api\Input\TintInput;
use App\Api\Input\WorkingDayInput;
use App\Settings\UserSettings;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Routing\Requirement\Requirement;
use Symfony\Component\Serializer\Normalizer\AbstractNormalizer;
use Symfony\Component\Serializer\Normalizer\DenormalizerInterface;
use Symfony\Component\Uid\Uuid;

/**
 * Les réglages enregistrés par DayTrack : l'objectif habituel, les jours travaillés et
 * la teinte des types de ticket. Ils s'appliquent sans bouton, un à la fois.
 *
 * Chaque réponse rend tous les réglages, tels que la base les tient : un onglet resté
 * ouvert s'y remet, et ne défait rien de ce qu'un autre a réglé entre-temps.
 */
#[Route('/api/settings', format: 'json')]
final class SettingsController extends AbstractController
{
    /** Un champ inconnu est refusé comme une valeur de travers, champ par champ. */
    private const array STRICT = [
        AbstractNormalizer::ALLOW_EXTRA_ATTRIBUTES => false,
        DenormalizerInterface::COLLECT_EXTRA_ATTRIBUTES_ERRORS => true,
    ];

    public function __construct(
        private readonly UserSettings $settings,
    ) {
    }

    #[Route('', name: 'api_settings_show', methods: ['GET'])]
    public function show(): JsonResponse
    {
        return $this->json($this->settings->toArray());
    }

    #[Route('/habitual-objective', name: 'api_settings_objective', methods: ['PUT'])]
    public function setHabitualObjective(#[MapRequestPayload(acceptFormat: 'json', serializationContext: self::STRICT)] HabitualObjectiveInput $input): JsonResponse
    {
        $this->settings->setHabitualObjective($input->objective);

        return $this->json($this->settings->toArray());
    }

    /** Le jour de la semaine ISO, du lundi (1) au dimanche (7). */
    #[Route('/working-days/{day}', name: 'api_settings_working_day', requirements: ['day' => '[1-7]'], methods: ['PUT'])]
    public function setWorkingDay(int $day, #[MapRequestPayload(acceptFormat: 'json', serializationContext: self::STRICT)] WorkingDayInput $input): JsonResponse
    {
        $this->settings->setWorkingDay($day, $input->worked);

        return $this->json($this->settings->toArray());
    }

    #[Route('/issue-types/{id}', name: 'api_settings_issue_type', requirements: ['id' => Requirement::UUID], methods: ['PUT'])]
    public function recolor(Uuid $id, #[MapRequestPayload(acceptFormat: 'json', serializationContext: self::STRICT)] TintInput $input): JsonResponse
    {
        if (!$this->settings->recolor($id, $input->color)) {
            return $this->json(['error' => 'not_found'] + $this->settings->toArray(), Response::HTTP_NOT_FOUND);
        }

        return $this->json($this->settings->toArray());
    }
}
