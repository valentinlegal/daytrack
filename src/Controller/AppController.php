<?php

namespace App\Controller;

use App\Day\UserCalendar;
use App\Jira\JiraLink;
use App\Repository\V1ImportRepository;
use App\Settings\UserSettings;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

/**
 * La page qui porte l'application React, ouverte sur un jour.
 *
 * Le jour est dans l'adresse : c'est elle qu'on met en favori. Elle ne ment jamais
 * sur le jour affiché — un jour impossible, ou trop loin devant, ramène à
 * aujourd'hui par une redirection, pas seulement à l'écran.
 */
final class AppController extends AbstractController
{
    public function __construct(
        private readonly UserCalendar $calendar,
        private readonly JiraLink $jira,
        private readonly UserSettings $settings,
        private readonly V1ImportRepository $v1Imports,
        private readonly RequestStack $requests,
        #[Autowire('%env(DAYTRACK_TIMEZONE)%')]
        private readonly string $timezone,
        #[Autowire('%env(DAYTRACK_OLD_COMPOSE)%')]
        private readonly string $oldCompose,
    ) {
    }

    #[Route('/', name: 'app', methods: ['GET'])]
    public function today(): RedirectResponse
    {
        return $this->toToday();
    }

    /**
     * Toute adresse qui commence par un chiffre se lit comme un jour : « /2026-10-5 »,
     * tapé sans le zéro, ramène à aujourd'hui au lieu d'une page d'erreur.
     */
    #[Route('/{date}', name: 'app_day', requirements: ['date' => '\d[^/]*'], methods: ['GET'])]
    public function day(string $date): Response
    {
        $day = UserCalendar::date($date);
        if (null === $day || !$this->calendar->isOpen($day)) {
            return $this->toToday();
        }

        return $this->page('day', $date);
    }

    /**
     * La page Réglages : une adresse à elle, qu'un rechargement retrouve. On en revient
     * au jour qui était affiché, que l'onglet a retenu ; à défaut, à aujourd'hui.
     */
    #[Route('/reglages', name: 'app_settings', methods: ['GET'])]
    public function settings(): Response
    {
        return $this->page('settings', $this->calendar->today()->format('Y-m-d'));
    }

    /**
     * La bienvenue a son adresse tant que DayTrack n'est relié à aucun Jira : l'écran y
     * remet celle d'un jour qu'il ne montre pas. Relié, elle ramène à aujourd'hui.
     */
    #[Route('/bienvenue', name: 'app_welcome', methods: ['GET'])]
    public function welcome(): Response
    {
        return null === $this->jira->current() ? $this->page('day', $this->calendar->today()->format('Y-m-d')) : $this->toToday();
    }

    private function page(string $screen, string $date): Response
    {
        $connection = $this->jira->current();

        return $this->render('app.html.twig', [
            'screen' => $screen,
            'date' => $date,
            'timezone' => $this->timezone,
            'future_days' => UserCalendar::FUTURE_DAYS,
            // Les flèches de la barre les sautent dès le premier rendu ; chaque journée lue les redit.
            'working_days' => implode(' ', $this->settings->workingDays()),
            // Pas relié, la bienvenue tient lieu de journée ; refusé, le bandeau s'affiche
            // dès le premier rendu, et nomme les périmètres qui manquent au jeton.
            'jira' => null === $connection ? 'unlinked' : ($connection->refusal->value ?? 'connected'),
            'jira_scopes' => implode(' ', $connection->missingScopes ?? []),
            // L'ancien fichier de la v1 est encore là : le bandeau le dit tant qu'il y reste.
            'old_compose' => $this->oldCompose(),
            'v1_left_out' => $this->v1Imports->current()->leftOut ?? ['entries' => [], 'objectives' => [], 'favorites' => []],
        ]);
    }

    /**
     * Le démarrage ne lit que SERVER_NAME : un fichier de la v1 dont seuls les ports ont
     * changé y passe pour intact, et « Rechargez ensuite cette page » serait faux. La page,
     * elle, sait sur quel port elle est servie.
     */
    private function oldCompose(): string
    {
        $port = $this->requests->getCurrentRequest()?->getPort();

        return 'default' === $this->oldCompose && !\in_array($port, [80, 443], true) ? 'custom' : $this->oldCompose;
    }

    /** Aujourd'hui change à minuit : la redirection ne se garde pas en cache. */
    private function toToday(): RedirectResponse
    {
        $response = $this->redirectToRoute('app_day', ['date' => $this->calendar->today()->format('Y-m-d')]);
        $response->headers->set('Cache-Control', 'no-store');

        return $response;
    }
}
