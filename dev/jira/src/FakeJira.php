<?php

namespace App\Dev\Jira;

/**
 * Le Jira simulé du développement et des tests.
 *
 * Il répond aux appels que DayTrack fait à l'API REST v3 de Jira Cloud — le compte,
 * un ticket, une recherche, les saisies d'heures d'un ticket — avec les formes, les
 * statuts et les exigences de Jira : un test vert contre lui doit le rester contre
 * un vrai. Là où Jira est strict, il l'est autant ; là où Jira laisse passer une
 * erreur sans rien dire, il la laisse passer aussi, et c'est au test de la voir.
 *
 * Il sait aussi échouer : un jeton refusé ou à qui manque un périmètre, un Jira en panne,
 * et les tickets des projets de Catalog qui échouent exprès. Il répond par l'adresse du
 * site comme par la passerelle d'Atlassian des jetons à périmètres. Aucun test n'atteint
 * un vrai Jira : c'est lui qui en tient lieu. Il joue aussi le registre des images, pour
 * annoncer une version sans que rien n'atteigne ghcr.io. Il n'entre jamais dans l'image
 * publiée.
 */
final readonly class FakeJira
{
    private const string API = '/rest/api/3/';
    private const string STARTED_FORMAT = '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4}$/';
    private const array ISSUE_FIELDS = ['summary', 'issuetype', 'parent', 'status', 'timetracking'];
    private const string REGISTRY_TOKEN = 'jeton-du-registre';

    /** Le nombre de saisies que Jira rend par page quand on ne le précise pas. */
    private const int WORKLOGS_PER_PAGE = 5000;

    public function __construct(
        private StateStore $store,
        private string $baseUrl = 'https://jira',
    ) {
    }

    public function handle(FakeJiraRequest $request): FakeJiraResponse
    {
        $path = rtrim($request->path, '/');

        if (str_starts_with($path, '/_simulation')) {
            return $this->simulation($request, $path);
        }

        if ($this->store->update(static fn (State $state): bool => $state->down)) {
            return FakeJiraResponse::error(503, ['Service unavailable']);
        }

        // Le registre des images : un jeton anonyme, puis les tags que ce jeton laisse lire.
        if ('/token' === $path && 'GET' === $request->method) {
            return new FakeJiraResponse(200, ['token' => self::REGISTRY_TOKEN]);
        }
        if ('/v2/valentinlegal/daytrack/tags/list' === $path && 'GET' === $request->method) {
            return 'Bearer '.self::REGISTRY_TOKEN === $request->authorization
                ? new FakeJiraResponse(200, ['name' => 'valentinlegal/daytrack', 'tags' => $this->store->update(static fn (State $state): array => $state->imageTags)])
                : new FakeJiraResponse(401, ['errors' => [['code' => 'UNAUTHORIZED', 'message' => 'authentication required']]]);
        }

        // Ce que tout le monde peut lire d'un site Jira Cloud, sans jeton : son identifiant.
        if ('/_edge/tenant_info' === $path && 'GET' === $request->method) {
            return new FakeJiraResponse(200, ['cloudId' => Catalog::CLOUD_ID]);
        }

        // La passerelle d'Atlassian, par où passent les jetons à périmètres :
        // https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/…
        $gateway = 1 === preg_match('#^/ex/jira/([^/]+)(/.*)$#', $path, $matches);
        if ($gateway) {
            if (Catalog::CLOUD_ID !== $matches[1]) {
                return FakeJiraResponse::gateway(404, 'Not Found');
            }
            $path = $matches[2];
        }

        if (!str_starts_with($path, rtrim(self::API, '/'))) {
            return FakeJiraResponse::error(404, ['Cette adresse n\'existe pas dans le Jira simulé.']);
        }

        $route = substr($path, \strlen(self::API));

        if ('serverInfo' === $route && 'GET' === $request->method) {
            return new FakeJiraResponse(200, ['baseUrl' => $this->baseUrl, 'version' => '1001.0.0-SNAPSHOT', 'deploymentType' => 'Cloud', 'serverTitle' => 'Jira simulé']);
        }

        $response = $this->refusal($request, $route, $gateway) ?? $this->route($request, $route, Catalog::token($request->authorization)['account'] ?? throw new \LogicException('Un appel accepté a son compte.'));

        $this->journal($request, $response);

        return $response;
    }

    /**
     * Pourquoi Jira refuse cette requête, s'il la refuse.
     *
     * Un jeton sans périmètre ne passe que par l'adresse du site, un jeton à
     * périmètres que par la passerelle, comme chez Atlassian. La passerelle vérifie
     * le périmètre avant que Jira ne regarde la requête : un ajout d'heures sur un
     * ticket qui n'existe pas y est refusé faute de write:jira-work, et sinon par Jira,
     * faute de ticket.
     */
    private function refusal(FakeJiraRequest $request, string $route, bool $gateway): ?FakeJiraResponse
    {
        $token = Catalog::token($request->authorization);
        $refused = $this->store->update(static fn (State $state): bool => $state->tokensRefused);

        if (null === $token || $refused || $gateway === (null === $token['scopes'])) {
            return $gateway
                ? FakeJiraResponse::gateway(401, 'Unauthorized')
                : FakeJiraResponse::error(401, ['Client must be authenticated to access this resource.']);
        }

        if ($gateway && !\in_array(self::scopeFor($request->method, $route), $token['scopes'] ?? [], true)) {
            return FakeJiraResponse::gateway(401, 'Unauthorized; scope does not match');
        }

        return null;
    }

    /** Le périmètre classique qu'Atlassian demande pour cet appel (spécification de l'API v3). */
    private static function scopeFor(string $method, string $route): ?string
    {
        return match (true) {
            'myself' === $route => Catalog::READ_USER,
            'GET' !== $method && 1 === preg_match('#^issue/[^/]+/worklog(/[^/]+)?$#', $route) => Catalog::WRITE_WORK,
            'GET' === $method && 1 === preg_match('#^(issue/|search/jql$)#', $route) => Catalog::READ_WORK,
            // La passerelle refuse ce qu'elle ne reconnaît pas pour une erreur de périmètre.
            default => null,
        };
    }

    /**
     * Ce qui ne fait pas partie de Jira : relire ce qu'il a reçu, les tickets qu'il
     * connaît, repartir de zéro, poser la demi-heure du collègue sur un jour donné.
     */
    private function simulation(FakeJiraRequest $request, string $path): FakeJiraResponse
    {
        return match (true) {
            '/_simulation' === $path && 'GET' === $request->method => new FakeJiraResponse(200, $this->store->update(static fn (State $state): array => $state->toArray())),
            '/_simulation/tickets' === $path && 'GET' === $request->method => new FakeJiraResponse(200, Catalog::catalog()),
            '/_simulation/reinitialiser' === $path && 'POST' === $request->method => $this->reset(),
            '/_simulation/collegue' === $path && 'POST' === $request->method => $this->seedColleague($request->body),
            '/_simulation/images' === $path && 'POST' === $request->method => $this->publishImages($request->body),
            '/_simulation/jeton' === $path && 'POST' === $request->method => $this->toggle($request->body, 'refuse', static function (State $state, bool $on): void {
                $state->tokensRefused = $on;
            }),
            '/_simulation/panne' === $path && 'POST' === $request->method => $this->toggle($request->body, 'panne', static function (State $state, bool $on): void {
                $state->down = $on;
            }),
            default => FakeJiraResponse::error(404, ['Cette adresse n\'existe pas dans le Jira simulé.']),
        };
    }

    /**
     * Pose ou lève une panne : {"refuse": true} fait refuser tout jeton, comme un jeton
     * expiré ; {"panne": true} fait répondre Jira par une erreur à tout appel.
     *
     * @param callable(State, bool): void $apply
     */
    private function toggle(string $body, string $field, callable $apply): FakeJiraResponse
    {
        $data = json_decode($body, true);
        $on = \is_array($data) ? ($data[$field] ?? null) : null;

        if (!\is_bool($on)) {
            return FakeJiraResponse::error(400, [\sprintf('Le corps attendu est {"%s": true} ou {"%s": false}.', $field, $field)]);
        }

        $this->store->update(static function (State $state) use ($apply, $on): void {
            $apply($state, $on);
        });

        return new FakeJiraResponse(204);
    }

    /** Pose les tags des images publiées : {"tags": ["2.5.0"]}. */
    private function publishImages(string $body): FakeJiraResponse
    {
        $data = json_decode($body, true);
        $tags = \is_array($data) ? ($data['tags'] ?? null) : null;

        if (!\is_array($tags) || array_filter($tags, \is_string(...)) !== $tags || !array_is_list($tags)) {
            return FakeJiraResponse::error(400, ['Le corps attendu est {"tags": ["2.5.0"]}.']);
        }

        $this->store->update(static function (State $state) use ($tags): void {
            $state->imageTags = $tags;
        });

        return new FakeJiraResponse(204);
    }

    private function reset(): FakeJiraResponse
    {
        $this->store->reset();

        return new FakeJiraResponse(204);
    }

    private function seedColleague(string $body): FakeJiraResponse
    {
        $data = json_decode($body, true);
        $day = \is_array($data) ? ($data['jour'] ?? null) : null;

        if (!\is_string($day) || false === \DateTimeImmutable::createFromFormat('!Y-m-d', $day)) {
            return FakeJiraResponse::error(400, ['Le corps attendu est {"jour": "AAAA-MM-JJ"}.']);
        }

        $this->store->update(static function (State $state) use ($day): void {
            self::ensureColleagueWorklog($state, $day);
        });

        return new FakeJiraResponse(204);
    }

    /**
     * @param array{id: string, name: string, email: string} $account le compte du jeton
     */
    private function route(FakeJiraRequest $request, string $route, array $account): FakeJiraResponse
    {
        if ('myself' === $route && 'GET' === $request->method) {
            return new FakeJiraResponse(200, [
                'accountId' => $account['id'],
                'emailAddress' => $account['email'],
                'displayName' => $account['name'],
                'active' => true,
                'timeZone' => Catalog::TIME_ZONE,
            ]);
        }

        if ('search/jql' === $route && 'GET' === $request->method) {
            return $this->search($request->query['jql'] ?? '', $request->query['fields'] ?? '');
        }

        if (1 === preg_match('#^issue/([A-Z][A-Z0-9]*-[1-9]\d*)(/worklog(?:/(\d+))?)?$#', $route, $matches)) {
            $key = $matches[1];

            if (!$this->exists($key)) {
                return FakeJiraResponse::error(404, ['Issue does not exist or you do not have permission to see it.']);
            }

            $worklogId = $matches[3] ?? '';

            return match (true) {
                !isset($matches[2]) && 'GET' === $request->method => new FakeJiraResponse(200, $this->issue($key, self::ISSUE_FIELDS)),
                isset($matches[2]) && '' === $worklogId && 'GET' === $request->method => $this->listWorklogs($key, $request->query),
                isset($matches[2]) && '' === $worklogId && 'POST' === $request->method => $this->addWorklog($key, $request->body, $request->query, $account['id']),
                '' !== $worklogId && 'PUT' === $request->method => $this->updateWorklog($key, $worklogId, $request->body, $request->query, $account['id']),
                '' !== $worklogId && 'DELETE' === $request->method => $this->deleteWorklog($key, $worklogId, $request->query, $account['id']),
                default => FakeJiraResponse::error(405, ['Méthode non prise en charge par le Jira simulé.']),
            };
        }

        return FakeJiraResponse::error(404, ['Cette adresse n\'existe pas dans le Jira simulé.']);
    }

    /** Un ticket que Jira connaît, et que ce compte voit encore : pas un ticket de DISPARU qui a disparu. */
    private function exists(string $key): bool
    {
        return null !== Catalog::issue($key)
            && (Catalog::VANISHING !== Catalog::failingProject($key)
                || !$this->store->update(static fn (State $state): bool => isset($state->vanished[$key])));
    }

    /**
     * @param list<string> $fields les champs demandés, parmi ISSUE_FIELDS
     *
     * @return array<string, mixed>
     */
    private function issue(string $key, array $fields): array
    {
        $issue = Catalog::issue($key) ?? throw new \LogicException($key);
        $done = Catalog::isDone($key);
        $all = [
            'summary' => $issue['summary'],
            'issuetype' => Catalog::issueType($issue['type']),
            'status' => [
                'name' => Catalog::CLOSED === Catalog::failingProject($key) ? 'Fermé' : ($done ? 'Terminé' : 'À faire'),
                'statusCategory' => ['key' => $done ? 'done' : 'new'],
            ],
            'timetracking' => $this->store->update(static fn (State $state): array => array_filter([
                'remainingEstimateSeconds' => $state->remainingOf($key),
                'timeSpentSeconds' => array_sum(array_map(
                    static fn (Worklog $worklog): int => $worklog->timeSpentSeconds,
                    array_filter($state->worklogs, static fn (Worklog $worklog): bool => $worklog->issueKey === $key),
                )),
            ], static fn (?int $seconds): bool => null !== $seconds)),
        ];

        if (isset($issue['parent'])) {
            $parent = Catalog::issue($issue['parent']) ?? throw new \LogicException($issue['parent']);
            $all['parent'] = ['key' => $issue['parent'], 'fields' => ['summary' => $parent['summary'], 'issuetype' => Catalog::issueType($parent['type'])]];
        }

        return [
            'id' => Catalog::issueId($key),
            'key' => $key,
            'self' => $this->baseUrl.self::API.'issue/'.$key,
            'fields' => (object) array_intersect_key($all, array_flip($fields)),
        ];
    }

    /**
     * La seule recherche que DayTrack fait : des tickets par leur identifiant,
     * « issueKey in (SHOP-482, OPS-7) » ou « key = SHOP-482 ».
     *
     * Comme la recherche de Jira Cloud (/search/jql) : sans « fields », elle ne rend
     * que l'identifiant numérique de chaque ticket. Un identifiant seul qui n'existe
     * pas, ou une liste dont aucun n'existe, fait refuser la requête entière.
     */
    private function search(string $jql, string $fields): FakeJiraResponse
    {
        if (1 !== preg_match('/^\s*(?:issue)?key\s*(?:=\s*([A-Z0-9-]+)|in\s*\(([^)]*)\))\s*$/i', $jql, $matches)) {
            return FakeJiraResponse::error(400, ['Le Jira simulé ne comprend que « issueKey in (…) » et « key = … ».']);
        }

        $keys = '' !== $matches[1] ? [$matches[1]] : self::split($matches[2]);
        $known = array_values(array_filter($keys, $this->exists(...)));

        if ([] === $known) {
            return FakeJiraResponse::error(400, [\sprintf("An issue with key '%s' does not exist for field 'key'.", $keys[0] ?? '')]);
        }

        $requested = self::split($fields);
        $requested = [] !== array_intersect(['*all', '*navigable'], $requested) ? self::ISSUE_FIELDS : array_values(array_intersect($requested, self::ISSUE_FIELDS));

        $issues = array_map(
            fn (string $key): array => [] === $requested ? ['id' => Catalog::issueId($key)] : $this->issue($key, $requested),
            $known,
        );

        return new FakeJiraResponse(200, ['issues' => $issues, 'isLast' => true]);
    }

    /**
     * @param array<string, string> $query
     */
    private function listWorklogs(string $key, array $query): FakeJiraResponse
    {
        if (Catalog::BROKEN === Catalog::failingProject($key)) {
            return FakeJiraResponse::error(500, ['Internal server error']);
        }

        $after = isset($query['startedAfter']) ? (int) $query['startedAfter'] : null;
        $before = isset($query['startedBefore']) ? (int) $query['startedBefore'] : null;
        $startAt = max(0, (int) ($query['startAt'] ?? 0));
        $perPage = min(self::WORKLOGS_PER_PAGE, max(1, (int) ($query['maxResults'] ?? self::WORKLOGS_PER_PAGE)));

        // Muet : écrit depuis sa dernière lecture, il ne se relit pas. La lecture suivante répond.
        $silent = \in_array(Catalog::failingProject($key), [Catalog::MUTE, Catalog::DEAF], true) && $this->store->update(static function (State $state) use ($key): bool {
            $written = isset($state->mute[$key]);
            unset($state->mute[$key]);

            return $written;
        });

        if ($silent) {
            return FakeJiraResponse::error(500, ['Internal server error']);
        }

        // Disparu : écrit depuis sa dernière lecture, il se relit une dernière fois, puis Jira
        // ne le trouve plus.
        if (Catalog::VANISHING === Catalog::failingProject($key)) {
            $this->store->update(static function (State $state) use ($key): void {
                if (isset($state->vanishing[$key])) {
                    unset($state->vanishing[$key]);
                    $state->vanished[$key] = 1;
                }
            });
        }

        $worklogs = $this->store->update(static function (State $state) use ($key, $after, $before): array {
            // Lire les heures d'un jour avant d'en avoir envoyé y montre déjà celle du
            // collègue, comme dans un vrai Jira où d'autres déclarent avant soi.
            if (null !== $after) {
                self::ensureColleagueWorklog($state, new \DateTimeImmutable('@'.intdiv($after, 1000))->setTimezone(new \DateTimeZone(Catalog::TIME_ZONE))->format('Y-m-d'));
            }

            return array_values(array_filter(
                $state->worklogs,
                static fn (Worklog $worklog): bool => $worklog->issueKey === $key
                    && (null === $after || $worklog->startedAt() >= $after)
                    && (null === $before || $worklog->startedAt() < $before),
            ));
        });

        return new FakeJiraResponse(200, [
            'startAt' => $startAt,
            'maxResults' => $perPage,
            'total' => \count($worklogs),
            'worklogs' => array_map(static fn (Worklog $worklog): array => $worklog->toJira(), \array_slice($worklogs, $startAt, $perPage)),
        ]);
    }

    /**
     * @param array<string, string> $query
     */
    private function addWorklog(string $key, string $body, array $query, string $author): FakeJiraResponse
    {
        $data = self::decode($body);

        if (!\is_array($data)) {
            return FakeJiraResponse::error(400, ['Unexpected character in the request body.']);
        }

        $invalid = self::invalidWorklog($data, true) ?? self::invalidEstimate($query);
        $project = Catalog::failingProject($key);

        if (null !== ($refusal = $invalid ?? self::refusedWrite($project))) {
            return $refusal;
        }

        /** @var string $started */
        $started = $data['started'];
        /** @var int $seconds */
        $seconds = $data['timeSpentSeconds'];
        $comment = $data['comment'] ?? null;

        return $this->store->update(static function (State $state) use ($key, $started, $seconds, $comment, $project, $query, $author): FakeJiraResponse {
            $limited = self::limited($state, $key, $project);

            if (null !== $limited) {
                return $limited;
            }

            self::ensureColleagueWorklog($state, substr($started, 0, 10), substr($started, -5));

            $worklog = new Worklog((string) $state->nextId++, $key, $author, $started, $seconds, $comment);

            // Perdu : Jira répond comme s'il avait enregistré, et la relecture ne le
            // retrouve pas.
            if (Catalog::LOST !== $project) {
                $state->worklogs[] = $worklog;
                self::adjustEstimate($state, $key, -$seconds, $query);
            }

            if (Catalog::MUTE === $project || Catalog::DEAF === $project) {
                $state->mute[$key] = 1;
            }

            if (Catalog::VANISHING === $project) {
                $state->vanishing[$key] = 1;
            }

            if (Catalog::DEAF === $project) {
                return FakeJiraResponse::error(503, ['Service temporarily unavailable']);
            }

            if (Catalog::TOKEN_LOST === $project) {
                $state->tokensRefused = true;
            }

            return new FakeJiraResponse(201, $worklog->toJira(), self::delayOf($project));
        });
    }

    /**
     * Une saisie corrigée sur place : elle garde son identifiant, et seul ce que le corps
     * nomme change. Comme Jira, un champ absent ou nul reste tel quel : un commentaire
     * s'efface par un document vide.
     *
     * @param array<string, string> $query
     */
    private function updateWorklog(string $key, string $id, string $body, array $query, string $author): FakeJiraResponse
    {
        $data = self::decode($body);

        if (!\is_array($data)) {
            return FakeJiraResponse::error(400, ['Unexpected character in the request body.']);
        }

        $invalid = self::invalidWorklog($data, false) ?? self::invalidEstimate($query);
        $project = Catalog::failingProject($key);

        if (null !== ($refusal = $invalid ?? self::refusedWrite($project))) {
            return $refusal;
        }

        return $this->store->update(static function (State $state) use ($key, $id, $data, $project, $query, $author): FakeJiraResponse {
            $index = self::indexOf($state, $key, $id);

            if (null === $index) {
                return FakeJiraResponse::error(404, ['Cannot find worklog with id: '.$id]);
            }

            $limited = self::limited($state, $key, $project);

            if (null !== $limited) {
                return $limited;
            }

            $old = $state->worklogs[$index];
            $started = $data['started'] ?? null;
            $seconds = $data['timeSpentSeconds'] ?? null;
            $new = new Worklog(
                $old->id,
                $key,
                $old->authorId,
                \is_string($started) ? $started : $old->started,
                \is_int($seconds) ? $seconds : $old->timeSpentSeconds,
                $data['comment'] ?? $old->comment,
            );

            // Comme un compte qui a « Edit all worklogs » : Jira corrige aussi les heures
            // d'un autre, sans un mot. Le journal le signale.
            if ($author !== $old->authorId) {
                $state->log(['at' => gmdate('Y-m-d\TH:i:s\Z'), 'alerte' => 'Saisie d\'un autre utilisateur modifiée', 'worklog' => $old->toArray()]);
            }

            array_splice($state->worklogs, $index, 1, [$new]);
            self::adjustEstimate($state, $key, $old->timeSpentSeconds - $new->timeSpentSeconds, $query);

            if (Catalog::VANISHING === $project) {
                $state->vanishing[$key] = 1;
            }

            return new FakeJiraResponse(200, $new->toJira(), self::delayOf($project));
        });
    }

    /**
     * @param array<string, string> $query
     */
    private function deleteWorklog(string $key, string $id, array $query, string $author): FakeJiraResponse
    {
        $project = Catalog::failingProject($key);

        if (null !== ($refusal = self::invalidEstimate($query) ?? self::refusedWrite($project))) {
            return $refusal;
        }

        return $this->store->update(static function (State $state) use ($key, $id, $project, $query, $author): FakeJiraResponse {
            $index = self::indexOf($state, $key, $id);

            if (null === $index) {
                return FakeJiraResponse::error(404, ['Cannot find worklog with id: '.$id]);
            }

            $limited = self::limited($state, $key, $project);

            if (null !== $limited) {
                return $limited;
            }

            $worklog = $state->worklogs[$index];

            // Comme un compte qui a « Delete all worklogs », souvent un responsable
            // de projet : Jira supprime aussi les heures d'un autre, sans un mot.
            // C'est le cas dangereux, donc celui qu'on simule ; le journal le
            // signale, et c'est au test de vérifier qu'elles sont toujours là.
            if ($author !== $worklog->authorId) {
                $state->log(['at' => gmdate('Y-m-d\TH:i:s\Z'), 'alerte' => 'Saisie d\'un autre utilisateur supprimée', 'worklog' => $worklog->toArray()]);
            }

            array_splice($state->worklogs, $index, 1);
            self::adjustEstimate($state, $key, $worklog->timeSpentSeconds, $query);

            if (Catalog::VANISHING === $project) {
                $state->vanishing[$key] = 1;
            }

            return new FakeJiraResponse(204, null, self::delayOf($project));
        });
    }

    /**
     * Ce qu'une saisie a de travers : au premier envoi, son début et sa durée sont
     * obligatoires ; à une correction, seulement justes s'ils sont là.
     *
     * @param array<mixed> $data
     */
    private static function invalidWorklog(array $data, bool $create): ?FakeJiraResponse
    {
        $started = $data['started'] ?? null;
        $seconds = $data['timeSpentSeconds'] ?? null;
        $comment = $data['comment'] ?? null;

        if (($create || null !== $started) && (!\is_string($started) || 1 !== preg_match(self::STARTED_FORMAT, $started))) {
            return FakeJiraResponse::error(400, [], ['started' => 'Started date is required in the format yyyy-MM-ddTHH:mm:ss.SSSZ.']);
        }

        if (($create || null !== $seconds) && (!\is_int($seconds) || $seconds < 60)) {
            return FakeJiraResponse::error(400, [], ['timeLogged' => 'Time spent must be at least one minute.']);
        }

        // L'API v3 n'accepte un commentaire qu'au format des documents d'Atlassian
        // (ADF) : un texte brut y est refusé.
        if (null !== $comment && !self::isDocument($comment)) {
            return FakeJiraResponse::error(400, [], ['comment' => 'Comment must be in Atlassian Document Format.']);
        }

        return null;
    }

    /**
     * Le reste à faire se règle par adjustEstimate : « auto » par défaut, comme Jira,
     * ou « leave ». Les autres demandent une valeur que DayTrack ne donne jamais.
     *
     * @param array<string, string> $query
     */
    private static function invalidEstimate(array $query): ?FakeJiraResponse
    {
        $mode = $query['adjustEstimate'] ?? 'auto';

        return 'auto' === $mode || 'leave' === $mode
            ? null
            : FakeJiraResponse::error(400, ['Le Jira simulé ne connaît que adjustEstimate=auto et adjustEstimate=leave.']);
    }

    /** Ce qu'un ticket qui échoue exprès répond à toute écriture de ses heures. */
    private static function refusedWrite(?string $project): ?FakeJiraResponse
    {
        return match ($project) {
            Catalog::CLOSED => FakeJiraResponse::error(400, ['You can not log work on an issue that is closed.']),
            Catalog::FORBIDDEN => FakeJiraResponse::error(403, ['You do not have the permission to associate a worklog to this issue.']),
            Catalog::BROKEN => FakeJiraResponse::error(500, ['Internal server error']),
            default => null,
        };
    }

    /** Une écriture de trop pour un ticket à moitié fait ou à débit limité. */
    private static function limited(State $state, string $key, ?string $project): ?FakeJiraResponse
    {
        $count = ($state->writesByIssue[$key] ?? 0) + 1;
        $state->writesByIssue[$key] = $count;

        if (Catalog::HALF === $project && 0 === $count % 2) {
            return FakeJiraResponse::error(503, ['Service temporarily unavailable']);
        }

        if (Catalog::QUOTA === $project && 1 === $count % 2) {
            return new FakeJiraResponse(429, ['errorMessages' => ['Rate limit exceeded.'], 'errors' => (object) []], 0, ['Retry-After' => (string) Catalog::RETRY_AFTER_SECONDS]);
        }

        return null;
    }

    private static function delayOf(?string $project): int
    {
        return Catalog::SLOW === $project ? Catalog::SLOW_SECONDS : 0;
    }

    /**
     * Le reste à faire suit les heures, comme dans Jira en « auto » : un ajout le
     * diminue, une suppression le rend, une correction l'ajuste de la différence. Il ne
     * descend jamais sous zéro.
     *
     * @param array<string, string> $query
     */
    private static function adjustEstimate(State $state, string $key, int $seconds, array $query): void
    {
        if ('leave' === ($query['adjustEstimate'] ?? 'auto')) {
            return;
        }

        $state->remaining[$key] = max(0, $state->remainingOf($key) + $seconds);
    }

    private static function indexOf(State $state, string $key, string $id): ?int
    {
        foreach ($state->worklogs as $index => $worklog) {
            if ($worklog->issueKey === $key && $worklog->id === $id) {
                return $index;
            }
        }

        return null;
    }

    private static function decode(string $body): mixed
    {
        try {
            return json_decode($body, true, flags: \JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return null;
        }
    }

    /**
     * Un jour qui reçoit des heures, ou qu'on lit, trouve déjà sur OPS-12 la
     * demi-heure d'un collègue : un envoi qui remplacerait plus que les heures de son
     * utilisateur la ferait disparaître.
     */
    private static function ensureColleagueWorklog(State $state, string $day, ?string $offset = null): void
    {
        foreach ($state->worklogs as $worklog) {
            if (Catalog::COLLEAGUE_ID === $worklog->authorId && $worklog->day() === $day) {
                return;
            }
        }

        $offset ??= new \DateTimeImmutable($day.' 09:30', new \DateTimeZone(Catalog::TIME_ZONE))->format('O');
        $state->worklogs[] = new Worklog((string) $state->nextId++, Catalog::COLLEAGUE_ISSUE, Catalog::COLLEAGUE_ID, $day.'T09:30:00.000'.$offset, 1800);
    }

    /**
     * @return list<string> les éléments non vides d'une liste séparée par des virgules
     */
    private static function split(string $list): array
    {
        return array_values(array_filter(array_map('trim', explode(',', $list)), static fn (string $item): bool => '' !== $item));
    }

    private static function isDocument(mixed $comment): bool
    {
        return \is_array($comment)
            && 'doc' === ($comment['type'] ?? null)
            && 1 === ($comment['version'] ?? null)
            && \is_array($comment['content'] ?? null);
    }

    private function journal(FakeJiraRequest $request, FakeJiraResponse $response): void
    {
        if ('GET' === $request->method) {
            return;
        }

        $this->store->update(static function (State $state) use ($request, $response): void {
            $state->log([
                'at' => gmdate('Y-m-d\TH:i:s\Z'),
                'method' => $request->method,
                'path' => $request->path,
                'query' => [] === $request->query ? null : $request->query,
                'body' => '' === $request->body ? null : json_decode($request->body, true),
                'status' => $response->status,
            ]);
        });
    }
}
