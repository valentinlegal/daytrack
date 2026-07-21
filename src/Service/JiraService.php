<?php

declare(strict_types=1);

namespace App\Service;

use DateTimeImmutable;
use Symfony\Contracts\HttpClient\HttpClientInterface;
use Symfony\Contracts\HttpClient\ResponseInterface;
use Throwable;

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
     * Récupère le titre et le type d'un ticket Jira.
     * Si le ticket est une sous-tâche, remonte au type du parent (mais conserve le titre de la sous-tâche).
     *
     * @return array{summary: string, type: string}
     * @throws Throwable si le ticket est introuvable ou si l'API est inaccessible
     */
    public function fetchTicketInfo(string $ticketKey): array
    {
        $response = $this->httpClient->request(
            'GET',
            $this->config->getBaseUrl().'/rest/api/3/issue/'.$ticketKey,
            [
                'headers' => [
                    'Authorization' => $this->config->getAuthHeader(),
                    'Accept' => 'application/json',
                ],
                'query' => ['fields' => 'summary,issuetype,parent'],
            ],
        );

        $data = $response->toArray();
        $fields = $data['fields'] ?? [];

        $summary = $fields['summary'] ?? $ticketKey;
        $issueType = $fields['issuetype'] ?? [];

        // Si c'est une sous-tâche, on remonte au type de la tâche parente
        $type = $issueType['name'] ?? 'Task';
        if (($issueType['subtask'] ?? false) && isset($fields['parent']['fields']['issuetype']['name'])) {
            $type = $fields['parent']['fields']['issuetype']['name'];
        }

        return [
            'summary' => $summary,
            'type' => $type,
        ];
    }

    /**
     * Phase 1 — lecture seule : récupère en parallèle les titres des tickets et les worklogs existants.
     *
     * Toutes les requêtes GET sont lancées avant qu'une seule réponse ne soit lue,
     * permettant à Symfony HttpClient de les traiter en parallèle.
     *
     * @param string[] $summaryKeys   Tickets dont on veut le titre (pour filtre commentaire)
     * @param string[] $worklogKeys   Tickets dont on veut les worklogs existants (pour nettoyage)
     * @return array{summaries: array<string, string>, worklogs: array<string, string[]>, errors: array<string, string>}
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
        $errors = [];

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
            } catch (Throwable $e) {
                // Lecture échouée : on ne connaît pas l'état existant du ticket sur JIRA — remonter
                // l'erreur permet à JiraSyncService d'exclure ce ticket de la phase de création,
                // évitant de créer des doublons sans avoir pu vérifier/nettoyer les worklogs existants.
                $worklogs[$key] = [];
                $errors[$key] = $e->getMessage();
            }
        }

        return [
            'summaries' => $summaries,
            'worklogs' => $worklogs,
            'errors' => $errors,
        ];
    }

    /**
     * Phase 2 — suppression : supprime tous les worklogs listés en parallèle.
     * notifyUsers=false pour limiter le spam de notifications aux autres membres.
     * adjustEstimate=auto pour restaurer le temps restant du temps du worklog supprimé
     * (symétrique de la création, qui le décompte via le même paramètre).
     * getStatusCode() ne lève jamais d'exception sur un statut 4xx/5xx (Symfony HttpClient) : le
     * statut est donc vérifié explicitement pour ne pas traiter un échec JIRA comme un succès.
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
                            'query' => [
                                'notifyUsers' => 'false',
                                'adjustEstimate' => 'auto',
                            ],
                        ],
                    ),
                ];
            }
        }

        $errors = [];
        foreach ($pending as $item) {
            try {
                $statusCode = $item['response']->getStatusCode();
                if ($statusCode < 200 || $statusCode >= 300) {
                    $errors[$item['ticketKey']] = $this->extractErrorMessage($item['response']);
                }
            } catch (Throwable $e) {
                $errors[$item['ticketKey']] = $e->getMessage();
            }
        }

        return $errors;
    }

    /**
     * Phase 3 — création : crée tous les worklogs en parallèle.
     * La date utilisée est celle du jour synchronisé, l'heure est fixée à midi UTC.
     * notifyUsers=false pour limiter le spam de notifications aux autres membres.
     * adjustEstimate=auto pour décompter le temps restant du temps loggué (symétrique
     * de la suppression, qui le restaure) — nécessaire pour que le temps restant reste
     * correct même après plusieurs synchros dans la même journée.
     * getStatusCode() ne lève jamais d'exception sur un statut 4xx/5xx (Symfony HttpClient) : le
     * statut est donc vérifié explicitement pour ne pas traiter un échec JIRA comme un succès.
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
                            'adjustEstimate' => 'auto',
                        ],
                        'json' => $body,
                    ],
                ),
            ];
        }

        $errors = [];
        foreach ($pending as $item) {
            try {
                $statusCode = $item['response']->getStatusCode();
                if ($statusCode < 200 || $statusCode >= 300) {
                    $errors[$item['ticketKey']] = $this->extractErrorMessage($item['response']);
                }
            } catch (Throwable $e) {
                $errors[$item['ticketKey']] = $e->getMessage();
            }
        }

        return $errors;
    }

    /**
     * Construit un message d'erreur lisible à partir d'une réponse HTTP en échec (statut hors 2xx).
     * JIRA retourne généralement un corps JSON avec "errorMessages"/"errors" ; à défaut, on retombe
     * sur le corps brut de la réponse.
     */
    private function extractErrorMessage(ResponseInterface $response): string
    {
        $statusCode = $response->getStatusCode();
        $body = $response->getContent(false);

        $decoded = json_decode($body, true);
        if (is_array($decoded)) {
            $messages = array_merge(
                $decoded['errorMessages'] ?? [],
                array_values($decoded['errors'] ?? []),
            );
            if ([] !== $messages) {
                return sprintf('HTTP %d : %s', $statusCode, implode(' ', $messages));
            }
        }

        $trimmedBody = trim($body);

        return sprintf('HTTP %d%s', $statusCode, '' !== $trimmedBody ? ' : '.$trimmedBody : '');
    }
}