<?php

declare(strict_types=1);

namespace App\Controller;

use App\Service\JiraConfigProvider;
use Symfony\Bridge\Twig\Attribute\Template;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\Routing\Attribute\Route;

class AppController extends AbstractController
{
    public function __construct(
        private readonly JiraConfigProvider $jiraConfig,
    ) {}

    #[Route(
        path: '/{reactRouting}',
        name: 'app',
        requirements: ['reactRouting' => '^(?!api/).*'],
        defaults: ['reactRouting' => '']
    )]
    #[Template('base.html.twig')]
    public function index(): array
    {
        return [
            'jiraConfigured' => $this->jiraConfig->isConfigured(),
            'jiraTicketTypes' => json_encode($this->jiraConfig->getTicketTypeColors()),
        ];
    }
}
