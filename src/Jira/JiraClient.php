<?php

namespace App\Jira;

use App\Sending\Worklog;
use Symfony\Component\Clock\ClockInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\DependencyInjection\Attribute\Target;
use Symfony\Contracts\HttpClient\Exception\ExceptionInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;
use Symfony\Contracts\HttpClient\ResponseInterface;

/**
 * Ce que DayTrack demande à Jira Cloud, par l'API REST v3, et ce qu'il comprend de
 * ses réponses.
 *
 * Chaque appel distingue ce qui demande un geste différent à l'écran : un jeton refusé,
 * un périmètre qui manque, un ticket qui n'existe pas, et un Jira qui ne répond pas. Rien
 * ne part ailleurs qu'en HTTPS, et le jeton ne voyage que dans l'en-tête Basic, jamais
 * dans une adresse ni un message.
 */
final readonly class JiraClient
{
    private const string API = '/rest/api/3/';

    /**
     * Un ticket qui ne peut pas exister — les numéros commencent à 1 —, pour vérifier
     * qu'un jeton peut ajouter des heures sans en ajouter : Jira juge le périmètre
     * avant de chercher le ticket.
     */
    private const string PROBE_TICKET = 'DAYTRACK-0';

    /** Ce que la passerelle d'Atlassian répond quand le jeton passe sans le périmètre de l'appel. */
    private const string SCOPE_MISMATCH = 'scope does not match';

    /** Les périmètres classiques dont DayTrack a besoin, dans l'ordre où l'aide les fait cocher. */
    public const array SCOPES = ['read:jira-work', 'write:jira-work', 'read:jira-user'];

    /** Les écritures d'heures qui partent ensemble, au plus : Jira n'a pas d'envoi groupé. */
    public const int PARALLEL_WRITES = 4;

    /** Les fois où une écriture ralentie par Jira repart, et l'attente qu'on accepte entre deux. */
    private const int THROTTLE_ATTEMPTS = 4;
    private const int THROTTLE_MAX_WAIT = 10;

    /** Ce que Jira rend d'heures par page, au plus. */
    private const int WORKLOGS_PER_PAGE = 5000;

    /** Ce que Jira ne doit pas faire à chaque écriture d'heures : prévenir les observateurs, et laisser le reste à faire. */
    private const array WRITE_QUERY = ['notifyUsers' => 'false', 'adjustEstimate' => 'auto'];

    public function __construct(
        #[Target('jira.client')]
        private HttpClientInterface $jiraClient,
        #[Autowire('%env(JIRA_GATEWAY_URL)%')]
        private string $gateway,
        private ClockInterface $clock,
    ) {
    }

    /** Où appeler l'API pour cette adresse, sans rien demander à Jira. */
    public function apiFor(JiraAddress $address): string
    {
        return null === $address->cloudId ? $address->site : $this->gatewayFor($address->cloudId);
    }

    /**
     * Relie DayTrack à ce compte : le jeton doit le faire connaître, lire les tickets
     * et pouvoir ajouter des heures.
     *
     * Un jeton sans périmètre passe par le site ; un jeton à périmètres, par la
     * passerelle d'Atlassian, dont DayTrack trouve seul l'adresse : l'utilisateur ne
     * tape jamais que celle de son site.
     */
    public function connect(JiraAddress $address, string $email, #[\SensitiveParameter] string $token): JiraConnected|JiraFailure
    {
        $cloudId = $address->cloudId;
        $api = $this->apiFor($address);
        $account = $this->myself(new JiraCredentials($api, $email, $token));

        if (JiraFailure::Refused === $account && !$address->isGateway()) {
            $cloudId = $this->cloudId($address->site);

            if (null !== $cloudId) {
                $gateway = $this->gatewayFor($cloudId);
                $throughGateway = $this->myself(new JiraCredentials($gateway, $email, $token));

                // Le site a déjà dit que ce jeton n'était pas le sien : une passerelle
                // muette ne change pas ce refus en panne.
                if (JiraFailure::Unreachable !== $throughGateway) {
                    [$api, $account] = [$gateway, $throughGateway];
                }
            }
        }

        if (!$account instanceof JiraAccount) {
            return $account;
        }

        // Les deux épreuves partent ensemble : lire un ticket, et lui ajouter des heures.
        // Chaque réponse se lit, même après un refus : une réponse laissée de côté lève
        // une exception quand elle disparaît.
        $credentials = new JiraCredentials($api, $email, $token);
        $probes = [$this->readProbe($credentials), $this->logWorkProbe($credentials)];
        $refusals = array_filter(array_map(self::reachedJira(...), $probes), static fn (true|JiraFailure $passed): bool => true !== $passed);

        $refusal = array_values($refusals)[0] ?? null;

        // L'identifiant du site dit de quel Jira il s'agit : un jeton à périmètres passe
        // par une autre adresse que le site, mais c'est le même Jira, et ses types aussi.
        return $refusal ?? new JiraConnected($api, $account, $cloudId ?? $this->cloudId($address->site));
    }

    /**
     * Le compte que ce jeton représente : c'est aussi la vérification qu'il passe
     * toujours. Une adresse sans compte à rendre n'est pas celle d'un Jira.
     */
    public function myself(JiraCredentials $credentials): JiraAccount|JiraFailure
    {
        $account = $this->read($this->get($credentials, 'myself'), static function (array $body): JiraAccount|JiraFailure {
            $id = $body['accountId'] ?? null;
            $name = $body['displayName'] ?? null;

            return \is_string($id) && '' !== $id && \is_string($name)
                ? new JiraAccount($id, $name)
                : JiraFailure::Unreachable;
        });

        return JiraFailure::NotFound === $account ? JiraFailure::Unreachable : $account;
    }

    public function issue(JiraCredentials $credentials, string $key): JiraIssue|JiraFailure
    {
        return $this->issues($credentials, [$key])[$key];
    }

    /**
     * Plusieurs tickets d'un coup : les requêtes partent ensemble, et chaque ticket a
     * sa réponse — l'un peut ne pas exister sans que les autres échouent.
     *
     * @param list<string> $keys
     *
     * @return array<string, JiraIssue|JiraFailure>
     */
    public function issues(JiraCredentials $credentials, array $keys): array
    {
        $responses = [];
        foreach (array_unique($keys) as $key) {
            $responses[$key] = $this->get($credentials, 'issue/'.rawurlencode($key), ['fields' => 'summary,issuetype,parent']);
        }

        $issues = [];
        foreach ($responses as $key => $response) {
            $issues[$key] = $this->read($response, static fn (array $body): JiraIssue|JiraFailure => self::issueOf($key, $body));
        }

        return $issues;
    }

    /**
     * Les saisies d'heures de ce compte sur ces tickets, commencées entre $from et $to :
     * un auteur se reconnaît à son identifiant de compte, jamais à son e-mail, que Jira
     * peut masquer. Chaque ticket a sa réponse, et les lectures partent ensemble.
     *
     * @param list<string> $keys
     *
     * @return array<string, list<JiraWorklog>|JiraFailure>
     */
    public function worklogs(JiraCredentials $credentials, string $accountId, array $keys, \DateTimeImmutable $from, \DateTimeImmutable $to): array
    {
        $range = ['startedAfter' => $from->format('Uv'), 'startedBefore' => $to->format('Uv'), 'maxResults' => (string) self::WORKLOGS_PER_PAGE];

        $responses = [];
        foreach (array_unique($keys) as $key) {
            $responses[$key] = $this->get($credentials, 'issue/'.rawurlencode($key).'/worklog', $range);
        }

        $worklogs = [];
        foreach ($responses as $key => $response) {
            $found = [];
            $page = $response;

            // Une page de plus tant que Jira en annonce : une journée n'en a jamais tant,
            // mais une relecture qui s'arrêterait à la première laisserait des doubles.
            do {
                $read = $this->read($page, static fn (array $body): array|JiraFailure => self::worklogPage($key, $accountId, $body));
                if ($read instanceof JiraFailure) {
                    $found = $read;
                    break;
                }

                [$items, $next] = $read;
                $found = [...$found, ...$items];
                $page = null === $next ? null : $this->get($credentials, 'issue/'.rawurlencode($key).'/worklog', ['startAt' => (string) $next] + $range);
            } while (null !== $page);

            $worklogs[$key] = $found;
        }

        return $worklogs;
    }

    /**
     * Les écritures d'heures, quatre à la fois au plus. Une écriture que Jira ralentit
     * attend ce qu'il demande, puis repart ; une écriture restée sans réponse ne repart
     * jamais : elle a pu passer, c'est à l'appelant de relire.
     *
     * @param list<WorklogWrite> $writes
     *
     * @return list<WriteOutcome> dans l'ordre des écritures
     */
    public function write(JiraCredentials $credentials, array $writes): array
    {
        /** @var array<int, WriteOutcome> $outcomes */
        $outcomes = [];
        $queue = array_keys($writes);
        /** @var array<int, int> $attempts */
        $attempts = [];
        /** @var array<int, float> $notBefore */
        $notBefore = [];
        /** @var array<int, array{int, ResponseInterface}> $running */
        $running = [];

        while ([] !== $queue || [] !== $running) {
            $now = $this->now();

            foreach ($queue as $position => $index) {
                if (\count($running) >= self::PARALLEL_WRITES) {
                    break;
                }
                if (($notBefore[$index] ?? 0.0) > $now) {
                    continue;
                }

                unset($queue[$position]);
                $response = $this->startWrite($credentials, $writes[$index]);

                if (null === $response) {
                    $outcomes[$index] = WriteOutcome::Unknown;
                } else {
                    $running[spl_object_id($response)] = [$index, $response];
                }
            }

            if ([] === $running) {
                if ([] !== $queue) {
                    $this->clock->sleep(max(0.0, min(array_map(static fn (int $index): float => $notBefore[$index] ?? 0.0, $queue)) - $now));
                }

                continue;
            }

            // La première réponse arrivée libère une place.
            foreach ($this->jiraClient->stream(array_column($running, 1)) as $response => $chunk) {
                try {
                    // Lire le statut dès la première réponse : sinon le client lève un
                    // refus de Jira comme une exception, au milieu des autres écritures.
                    if ($chunk->isFirst()) {
                        $response->getStatusCode();
                    }
                    if (!$chunk->isLast()) {
                        continue;
                    }
                } catch (ExceptionInterface) {
                    // Délai dépassé ou réseau coupé : la réponse se lit comme sans réponse.
                }

                [$index] = $running[spl_object_id($response)];
                unset($running[spl_object_id($response)]);

                $outcome = self::writeOutcomeOf($writes[$index], $response);
                $attempts[$index] = ($attempts[$index] ?? 0) + 1;

                if (WriteOutcome::Throttled === $outcome && $attempts[$index] < self::THROTTLE_ATTEMPTS) {
                    $notBefore[$index] = $this->now() + self::retryAfter($response);
                    $queue[] = $index;
                } else {
                    $outcomes[$index] = $outcome;
                }

                break;
            }
        }

        ksort($outcomes);

        return array_values($outcomes);
    }

    /**
     * Les tickets que Jira dit fermés, parmi ceux-ci : ce qui explique le plus souvent
     * qu'il en refuse les heures.
     *
     * @param list<string> $keys
     *
     * @return list<string>
     */
    public function closed(JiraCredentials $credentials, array $keys): array
    {
        $responses = [];
        foreach (array_unique($keys) as $key) {
            $responses[$key] = $this->get($credentials, 'issue/'.rawurlencode($key), ['fields' => 'status']);
        }

        $closed = [];
        foreach ($responses as $key => $response) {
            $done = $this->read($response, static function (array $body): bool {
                $fields = \is_array($body['fields'] ?? null) ? $body['fields'] : [];
                $status = \is_array($fields['status'] ?? null) ? $fields['status'] : [];
                $category = \is_array($status['statusCategory'] ?? null) ? $status['statusCategory'] : [];

                return 'done' === ($category['key'] ?? null);
            });

            if (true === $done) {
                $closed[] = $key;
            }
        }

        return $closed;
    }

    /**
     * Les périmètres qui manquent à ce jeton, parmi ceux dont DayTrack a besoin. Chacun
     * s'éprouve par un appel qui n'écrit rien, et que la passerelle juge avant Jira : un
     * ticket qui ne peut pas exister, lu puis complété d'heures, et le compte. Rien ne
     * manque à un jeton sans périmètre, ni quand Jira ne répond pas.
     *
     * @return list<string>
     */
    public function missingScopes(JiraCredentials $credentials): array
    {
        $probes = [
            'read:jira-work' => $this->readProbe($credentials),
            'write:jira-work' => $this->logWorkProbe($credentials),
            'read:jira-user' => $this->get($credentials, 'myself'),
        ];

        return array_keys(array_filter($probes, static fn (?ResponseInterface $response): bool => self::lacksScope($response)));
    }

    /**
     * Vrai si l'épreuve est arrivée jusqu'à Jira : elle vise un ticket qui n'existe pas,
     * Jira la refuse toujours, et c'est la raison du refus qui répond — le ticket
     * inconnu, ou le périmètre qui manque. Rien n'est jamais écrit.
     */
    private static function reachedJira(?ResponseInterface $response): true|JiraFailure
    {
        if (null === $response) {
            return JiraFailure::Unreachable;
        }

        try {
            $status = $response->getStatusCode();

            return match (true) {
                400 === $status, 404 === $status => true,
                401 === $status, 403 === $status => self::refusalOf($response),
                default => JiraFailure::Unreachable,
            };
        } catch (ExceptionInterface) {
            return JiraFailure::Unreachable;
        }
    }

    private function startWrite(JiraCredentials $credentials, WorklogWrite $write): ?ResponseInterface
    {
        $route = 'issue/'.rawurlencode($write->ticket).'/worklog';

        if ($write->delete) {
            return $this->request('DELETE', $credentials, $route.'/'.rawurlencode((string) $write->id), ['query' => self::WRITE_QUERY]);
        }

        $body = array_filter([
            'started' => $write->started?->format(Worklog::STARTED),
            'timeSpentSeconds' => $write->seconds,
            // Une chaîne vide efface le commentaire : un document vide.
            'comment' => null === $write->comment ? null : JiraWorklog::documentOf('' === $write->comment ? null : $write->comment),
        ], static fn (mixed $value): bool => null !== $value);

        // Un ajout sans commentaire n'en porte pas, plutôt qu'un document vide.
        if ($write->isAdd() && [] === ($body['comment']['content'] ?? null)) {
            unset($body['comment']);
        }

        return null === $write->id
            ? $this->request('POST', $credentials, $route, ['query' => self::WRITE_QUERY, 'json' => $body])
            : $this->request('PUT', $credentials, $route.'/'.rawurlencode($write->id), ['query' => self::WRITE_QUERY, 'json' => (object) $body]);
    }

    private static function writeOutcomeOf(WorklogWrite $write, ResponseInterface $response): WriteOutcome
    {
        try {
            $status = $response->getStatusCode();
        } catch (ExceptionInterface) {
            return WriteOutcome::Unknown;
        }

        return match (true) {
            $status >= 200 && $status < 300 => WriteOutcome::Done,
            429 === $status => WriteOutcome::Throttled,
            401 === $status => JiraFailure::MissingScope === self::refusalOf($response) ? WriteOutcome::MissingScope : WriteOutcome::Refused,
            // Un 403 de Jira refuse ce ticket à ce compte ; celui de la passerelle, le jeton.
            403 === $status => JiraFailure::MissingScope === self::refusalOf($response) ? WriteOutcome::MissingScope : WriteOutcome::Rejected,
            // Le ticket existait à la lecture : c'est la saisie qui a disparu. Retirée,
            // c'est ce qu'on voulait ; corrigée, il faut relire puis la recréer.
            404 === $status => match (true) {
                $write->delete => WriteOutcome::Done,
                null !== $write->id => WriteOutcome::Unknown,
                default => WriteOutcome::NotFound,
            },
            400 === $status => WriteOutcome::Rejected,
            // Une panne de Jira peut avoir enregistré : on relira.
            default => WriteOutcome::Unknown,
        };
    }

    /** L'attente que Jira demande avant de repartir, en secondes, bornée. */
    private static function retryAfter(ResponseInterface $response): float
    {
        try {
            $value = $response->getHeaders(false)['retry-after'][0] ?? null;
        } catch (ExceptionInterface) {
            $value = null;
        }

        if (null !== $value && is_numeric($value)) {
            return min((float) self::THROTTLE_MAX_WAIT, max(0.0, (float) $value));
        }

        $date = null === $value ? false : strtotime($value);

        return false === $date ? 1.0 : min((float) self::THROTTLE_MAX_WAIT, max(0.0, (float) ($date - time())));
    }

    private function now(): float
    {
        return (float) $this->clock->now()->format('U.u');
    }

    /**
     * Une page de saisies d'heures : celles de ce compte, et où commence la suivante.
     *
     * @param array<mixed> $body
     *
     * @return array{list<JiraWorklog>, ?int}|JiraFailure
     */
    private static function worklogPage(string $key, string $accountId, array $body): array|JiraFailure
    {
        if (!\is_array($body['worklogs'] ?? null)) {
            return JiraFailure::Unreachable;
        }

        $worklogs = [];
        foreach ($body['worklogs'] as $item) {
            $author = \is_array($item) && \is_array($item['author'] ?? null) ? $item['author'] : [];
            if (!\is_array($item) || ($author['accountId'] ?? null) !== $accountId) {
                continue;
            }

            $id = $item['id'] ?? null;
            $started = \is_string($item['started'] ?? null) ? \DateTimeImmutable::createFromFormat(Worklog::STARTED, $item['started']) : false;
            $seconds = $item['timeSpentSeconds'] ?? null;

            // Une saisie de l'utilisateur qu'on ne sait pas lire fausserait la différence.
            if (!\is_string($id) || false === $started || !\is_int($seconds)) {
                return JiraFailure::Unreachable;
            }

            $worklogs[] = new JiraWorklog($id, $key, $started, $seconds, JiraWorklog::textOf($item['comment'] ?? null));
        }

        $startAt = \is_int($body['startAt'] ?? null) ? $body['startAt'] : 0;
        $total = \is_int($body['total'] ?? null) ? $body['total'] : 0;
        $next = $startAt + \count($body['worklogs']);

        return [$worklogs, [] !== $body['worklogs'] && $next < $total ? $next : null];
    }

    /** La lecture d'un ticket qui ne peut pas exister. */
    private function readProbe(JiraCredentials $credentials): ?ResponseInterface
    {
        return $this->get($credentials, 'issue/'.self::PROBE_TICKET, ['fields' => 'summary']);
    }

    /** Un ajout d'heures invalide, sur un ticket qui ne peut pas exister : il n'écrit jamais rien. */
    private function logWorkProbe(JiraCredentials $credentials): ?ResponseInterface
    {
        return $this->request('POST', $credentials, 'issue/'.self::PROBE_TICKET.'/worklog', ['query' => ['notifyUsers' => 'false'], 'json' => (object) []]);
    }

    /** L'identifiant d'un site Jira Cloud, que la passerelle demande ; il se lit sans jeton. */
    private function cloudId(string $site): ?string
    {
        $response = $this->send('GET', $site.'/_edge/tenant_info', []);

        try {
            $body = null === $response || 200 !== $response->getStatusCode() ? null : $response->toArray(false);
        } catch (ExceptionInterface) {
            return null;
        }

        $cloudId = $body['cloudId'] ?? null;

        return \is_string($cloudId) && 1 === preg_match('/^[0-9a-f-]{36}$/i', $cloudId) ? strtolower($cloudId) : null;
    }

    private function gatewayFor(string $cloudId): string
    {
        return rtrim($this->gateway, '/').'/ex/jira/'.$cloudId;
    }

    /**
     * @param array<string, string> $query
     */
    private function get(JiraCredentials $credentials, string $route, array $query = []): ?ResponseInterface
    {
        return $this->request('GET', $credentials, $route, [] === $query ? [] : ['query' => $query]);
    }

    /**
     * @param array<string, mixed> $options
     */
    private function request(string $method, JiraCredentials $credentials, string $route, array $options): ?ResponseInterface
    {
        return $this->send($method, rtrim($credentials->api, '/').self::API.$route, $options + $credentials->httpOptions());
    }

    /**
     * La requête, partie sans attendre sa réponse ; null si elle ne peut pas partir,
     * dont toute adresse qui ne serait pas en HTTPS. Une redirection ne se suit pas :
     * elle pourrait repartir en clair, et l'API de Jira Cloud n'en fait pas.
     *
     * @param array<string, mixed> $options
     */
    private function send(string $method, string $url, array $options): ?ResponseInterface
    {
        if (!str_starts_with($url, 'https://')) {
            return null;
        }

        try {
            return $this->jiraClient->request($method, $url, ['max_redirects' => 0] + $options);
        } catch (ExceptionInterface) {
            return null;
        }
    }

    /**
     * Ce qu'une réponse veut dire : le résultat que $success tire de son corps, ou ce
     * qui l'en a empêché.
     *
     * @template T
     *
     * @param callable(array<mixed>): (T|JiraFailure) $success
     *
     * @return T|JiraFailure
     */
    private function read(?ResponseInterface $response, callable $success): mixed
    {
        if (null === $response) {
            return JiraFailure::Unreachable;
        }

        try {
            return match ($response->getStatusCode()) {
                200 => $success($response->toArray()),
                401, 403 => self::refusalOf($response),
                404 => JiraFailure::NotFound,
                default => JiraFailure::Unreachable,
            };
        } catch (ExceptionInterface) {
            return JiraFailure::Unreachable;
        }
    }

    /** La passerelle a refusé cet appel faute de son périmètre. */
    private static function lacksScope(?ResponseInterface $response): bool
    {
        if (null === $response) {
            return false;
        }

        try {
            $status = $response->getStatusCode();
        } catch (ExceptionInterface) {
            return false;
        }

        return (401 === $status || 403 === $status) && JiraFailure::MissingScope === self::refusalOf($response);
    }

    /** Un refus de la passerelle pour un périmètre manquant, ou un refus du jeton. */
    private static function refusalOf(ResponseInterface $response): JiraFailure
    {
        try {
            $body = $response->toArray(false);
        } catch (ExceptionInterface) {
            return JiraFailure::Refused;
        }

        $message = $body['message'] ?? null;

        return \is_string($message) && str_contains(strtolower($message), self::SCOPE_MISMATCH)
            ? JiraFailure::MissingScope
            : JiraFailure::Refused;
    }

    /**
     * @param array<mixed> $body
     */
    private static function issueOf(string $key, array $body): JiraIssue|JiraFailure
    {
        $fields = \is_array($body['fields'] ?? null) ? $body['fields'] : [];
        $title = $fields['summary'] ?? null;
        $type = self::typeOf($fields['issuetype'] ?? null);

        if (!\is_string($title) || null === $type) {
            return JiraFailure::Unreachable;
        }

        if (JiraIssueType::SUBTASK_LEVEL === $type->level) {
            $parent = \is_array($fields['parent'] ?? null) && \is_array($fields['parent']['fields'] ?? null) ? $fields['parent']['fields'] : [];
            $type = self::typeOf($parent['issuetype'] ?? null) ?? $type;
        }

        return new JiraIssue($key, $title, $type);
    }

    private static function typeOf(mixed $type): ?JiraIssueType
    {
        if (!\is_array($type) || !\is_string($type['id'] ?? null) || !\is_string($type['name'] ?? null)) {
            return null;
        }

        $level = $type['hierarchyLevel'] ?? null;

        return new JiraIssueType(
            $type['id'],
            $type['name'],
            \is_int($level) ? $level : (true === ($type['subtask'] ?? false) ? JiraIssueType::SUBTASK_LEVEL : 0),
        );
    }
}
