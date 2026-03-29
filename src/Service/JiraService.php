<?php

declare(strict_types=1);

namespace App\Service;

use DateTimeImmutable;
use Symfony\Contracts\HttpClient\HttpClientInterface;

/**
 * Wrapping des appels à l'API REST JIRA Cloud v3.
 *
 * Toutes les méthodes "batch" exploitent la concurrence native de Symfony HttpClient :
 * on lance toutes les requêtes avant de lire la première réponse, ce qui les exécute en parallèle.
 */
class JiraService
{
    public function __construct(
        private readonly HttpClientInterface $httpClient,
        private readonly JiraConfigProvider $config,
    ) {}

    /**
     * Phase 1 — lecture seule : récupère en parallèle les titres des tickets et les worklogs existants.
     *
     * Toutes les requêtes GET sont lancées avant qu'une seule réponse ne soit lue,
     * permettant à Symfony HttpClient de les traiter en parallèle.
     *
     * @param string[] $summaryKeys   Tickets dont on veut le titre (pour filtre commentaire)
     * @param string[] $worklogKeys   Tickets dont on veut les worklogs existants (pour nettoyage)
     * @return array{summaries: array<string, string>, worklogs: array<string, string[]>}
     */
    public function batchFetchSummariesAndWorklogs(
        array $summaryKeys,
        array $worklogKeys,
        DateTimeImmutable $date,
    ): array {
        // Lancer toutes les requêtes en parallèle avant de lire une seule réponse
        $summaryResponse = null;

        if ([] !== $summaryKeys) {
            $jql = 'issueKey in ('.implode(', ', $summaryKeys).')';
            $summaryResponse = $this->httpClient->request('GET', $this->config->getBaseUrl().'/rest/api/3/search/jql', [
                'headers' => [
                    'Authorization' => $this->config->getAuthHeader(),
                    'Accept' => 'application/json',
                ],
                'query' => [
                    'jql' => $jql,
                    'fields' => 'summary',
                    'maxResults' => count($summaryKeys),
                ],
            ]);
        }

        $worklogResponses = [];
        foreach ($worklogKeys as $key) {
            $worklogResponses[$key] = $this->httpClient->request(
                'GET',
                $this->config->getBaseUrl().'/rest/api/3/issue/'.$key.'/worklog',
                [
                    'headers' => [
                        'Authorization' => $this->config->getAuthHeader(),
                        'Accept' => 'application/json',
                    ],
                ],
            );
        }

        // Lire les réponses — Symfony HttpClient les a traitées en parallèle
        $summaries = [];
        if (null !== $summaryResponse) {
            try {
                foreach ($summaryResponse->toArray()['issues'] ?? [] as $issue) {
                    $summaries[$issue['key']] = $issue['fields']['summary'] ?? '';
                }
            } catch (\Throwable) {
                // On continue sans les titres — le filtre commentaire sera désactivé
            }
        }

        $targetDate = $date->format('Y-m-d');
        $userEmail = $this->config->getUserEmail();
        $worklogs = [];

        foreach ($worklogResponses as $key => $response) {
            try {
                $ids = [];
                foreach ($response->toArray()['worklogs'] ?? [] as $worklog) {
                    $authorEmail = $worklog['author']['emailAddress'] ?? '';
                    // Le champ "started" est au format "2024-01-15T09:00:00.000+0000"
                    $startedDate = substr($worklog['started'] ?? '', 0, 10);
                    if ($authorEmail === $userEmail && $startedDate === $targetDate) {
                        $ids[] = (string) $worklog['id'];
                    }
                }
                $worklogs[$key] = $ids;
            } catch (\Throwable) {
                $worklogs[$key] = [];
            }
        }

        return [
            'summaries' => $summaries,
            'worklogs' => $worklogs,
        ];
    }

    /**
     * Phase 2 — suppression : supprime tous les worklogs listés en parallèle.
     * notifyUsers=false pour limiter le spam de notifications aux autres membres.
     *
     * @param array<string, string[]> $worklogsByTicket Tableau indexé par ticket → liste d'IDs
     * @return array<string, string> Erreurs indexées par clé de ticket
     */
    public function batchDeleteWorklogs(array $worklogsByTicket): array
    {
        // Lancer toutes les suppressions en parallèle
        $pending = [];
        foreach ($worklogsByTicket as $ticketKey => $worklogIds) {
            foreach ($worklogIds as $worklogId) {
                $pending[] = [
                    'ticketKey' => $ticketKey,
                    'response' => $this->httpClient->request(
                        'DELETE',
                        $this->config->getBaseUrl().'/rest/api/3/issue/'.$ticketKey.'/worklog/'.$worklogId,
                        [
                            'headers' => ['Authorization' => $this->config->getAuthHeader()],
                            'query' => ['notifyUsers' => 'false'],
                        ],
                    ),
                ];
            }
        }

        $errors = [];
        foreach ($pending as $item) {
            try {
                $item['response']->getStatusCode();
            } catch (\Throwable $e) {
                $errors[$item['ticketKey']] = $e->getMessage();
            }
        }

        return $errors;
    }

    /**
     * Phase 3 — création : crée tous les worklogs en parallèle.
     * La date utilisée est celle du jour synchronisé, l'heure est fixée à midi UTC.
     * notifyUsers=false + adjustEstimate=leave pour limiter l'impact sur les autres.
     *
     * @param array<string, array{ticketKey: string, comment: string|null, seconds: int}> $groups
     * @return array<string, string> Erreurs indexées par clé de ticket
     */
    public function batchCreateWorklogs(array $groups, DateTimeImmutable $date): array
    {
        // Midi UTC sur la date cible — garantit la bonne date quelle que soit la timezone serveur
        $startedStr = $date->format('Y-m-d').'T12:00:00.000+0000';

        // Lancer toutes les créations en parallèle
        $pending = [];
        foreach ($groups as $group) {
            $body = [
                'timeSpentSeconds' => $group['seconds'],
                'started' => $startedStr,
            ];

            if (null !== $group['comment'] && '' !== $group['comment']) {
                // JIRA Cloud v3 exige le format ADF (Atlassian Document Format) pour les commentaires
                $body['comment'] = [
                    'type' => 'doc',
                    'version' => 1,
                    'content' => [
                        [
                            'type' => 'paragraph',
                            'content' => [
                                [
                                    'type' => 'text',
                                    'text' => $group['comment'],
                                ],
                            ],
                        ],
                    ],
                ];
            }

            $pending[] = [
                'ticketKey' => $group['ticketKey'],
                'response' => $this->httpClient->request(
                    'POST',
                    $this->config->getBaseUrl().'/rest/api/3/issue/'.$group['ticketKey'].'/worklog',
                    [
                        'headers' => [
                            'Authorization' => $this->config->getAuthHeader(),
                            'Content-Type' => 'application/json',
                            'Accept' => 'application/json',
                        ],
                        'query' => [
                            'notifyUsers' => 'false',
                            'adjustEstimate' => 'leave',
                        ],
                        'json' => $body,
                    ],
                ),
            ];
        }

        $errors = [];
        foreach ($pending as $item) {
            try {
                $item['response']->getStatusCode();
            } catch (\Throwable $e) {
                $errors[$item['ticketKey']] = $e->getMessage();
            }
        }

        return $errors;
    }
}