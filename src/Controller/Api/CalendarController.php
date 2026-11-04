<?php

namespace App\Controller\Api;

use App\Day\CalendarMarks;
use App\Day\DayMark;
use App\Day\UserCalendar;
use App\Settings\UserSettings;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;

/**
 * Les marques du calendrier, du premier au dernier jour qu'il affiche — seuls les jours
 * marqués y figurent —, les jours déclarés non travaillés, et les jours
 * travaillés qui ont décidé des marques : le calendrier grise les autres, d'après la même
 * lecture des réglages.
 */
#[Route(
    '/api/calendar/{from}/{to}',
    name: 'api_calendar',
    requirements: ['from' => '\d{4}-\d{2}-\d{2}', 'to' => '\d{4}-\d{2}-\d{2}'],
    methods: ['GET'],
    format: 'json',
)]
final class CalendarController extends AbstractController
{
    public function __construct(
        private readonly CalendarMarks $marks,
        private readonly UserSettings $settings,
    ) {
    }

    public function __invoke(string $from, string $to): JsonResponse
    {
        $first = UserCalendar::date($from);
        $last = UserCalendar::date($to);
        // Au plus six semaines : une plage sans fin ferait lire toute la base.
        if (null === $first || null === $last || $first > $last || $first->diff($last)->days >= CalendarMarks::MAX_DAYS) {
            throw $this->createNotFoundException();
        }

        $days = $this->marks->between($first, $last);

        // json_encode et non le sérialiseur, qui rendrait un objet vide en tableau : le
        // navigateur y cherche un jour par sa date.
        return new JsonResponse([
            'marks' => (object) array_map(static fn (DayMark $mark): string => $mark->value, $days->marks),
            'daysOff' => $days->daysOff,
            'workingDays' => $this->settings->workingDays(),
        ]);
    }
}
