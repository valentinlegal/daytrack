<?php

namespace App\Dev\Jira;

/**
 * Tout ce que le Jira simulé a reçu : les saisies, et le journal des requêtes. Et
 * les deux pannes qu'on lui pose à la main : un jeton qui ne passe plus, un Jira qui
 * ne répond plus. Et les images que le registre dit publiées.
 */
final class State
{
    private const int JOURNAL_SIZE = 200;

    /** Ceux du vrai registre : aucune version à annoncer, tant qu'un parcours n'en publie pas. */
    public const array IMAGE_TAGS = ['1.1.0', '1.1', '1', 'latest', 'develop'];

    /**
     * @param list<Worklog>              $worklogs
     * @param list<array<string, mixed>> $journal
     * @param array<string, int>         $writesByIssue le nombre d'écritures reçues par ticket, pour MOITIE et QUOTA
     * @param array<string, int>         $remaining     le reste à faire des tickets dont les heures ont bougé, en secondes
     * @param bool                       $tokensRefused tout jeton est refusé, comme un jeton expiré ou révoqué
     * @param bool                       $down          Jira ne répond plus que par une erreur
     * @param list<string>               $imageTags     les tags des images publiées
     * @param array<string, int>         $mute          les tickets de MUET écrits depuis leur dernière lecture
     * @param array<string, int>         $vanishing     les tickets de DISPARU écrits depuis leur dernière lecture : elle sera la dernière
     * @param array<string, int>         $vanished      les tickets de DISPARU que Jira ne trouve plus
     */
    public function __construct(
        public array $worklogs = [],
        public array $journal = [],
        public array $writesByIssue = [],
        public int $nextId = 10000,
        public array $remaining = [],
        public bool $tokensRefused = false,
        public bool $down = false,
        public array $imageTags = self::IMAGE_TAGS,
        public array $mute = [],
        public array $vanishing = [],
        public array $vanished = [],
    ) {
    }

    /** Le reste à faire d'un ticket : celui de départ, tant que ses heures n'ont pas bougé. */
    public function remainingOf(string $key): int
    {
        return $this->remaining[$key] ?? Catalog::INITIAL_ESTIMATE_SECONDS;
    }

    /**
     * @param array<string, mixed> $entry
     */
    public function log(array $entry): void
    {
        $this->journal[] = $entry;
        $this->journal = \array_slice($this->journal, -self::JOURNAL_SIZE);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'worklogs' => array_map(static fn (Worklog $worklog): array => $worklog->toArray(), $this->worklogs),
            'journal' => $this->journal,
            'writesByIssue' => $this->writesByIssue,
            'nextId' => $this->nextId,
            'resteAFaire' => $this->remaining,
            'jetonsRefuses' => $this->tokensRefused,
            'enPanne' => $this->down,
            'imagesPubliees' => $this->imageTags,
            'muets' => $this->mute,
            'aDisparaitre' => $this->vanishing,
            'disparus' => $this->vanished,
        ];
    }

    /**
     * @param array<mixed> $data
     */
    public static function fromArray(array $data): self
    {
        $worklogs = [];
        foreach (\is_array($data['worklogs'] ?? null) ? $data['worklogs'] : [] as $worklog) {
            if (\is_array($worklog)) {
                $worklogs[] = Worklog::fromArray($worklog);
            }
        }

        $journal = [];
        foreach (\is_array($data['journal'] ?? null) ? $data['journal'] : [] as $entry) {
            if (\is_array($entry)) {
                $journal[] = array_filter($entry, static fn (mixed $key): bool => \is_string($key), \ARRAY_FILTER_USE_KEY);
            }
        }

        $nextId = $data['nextId'] ?? 10000;

        return new self(
            $worklogs,
            $journal,
            self::secondsByIssue($data['writesByIssue'] ?? null),
            \is_int($nextId) ? $nextId : 10000,
            self::secondsByIssue($data['resteAFaire'] ?? null),
            true === ($data['jetonsRefuses'] ?? false),
            true === ($data['enPanne'] ?? false),
            \is_array($data['imagesPubliees'] ?? null) ? array_values(array_filter($data['imagesPubliees'], \is_string(...))) : self::IMAGE_TAGS,
            self::secondsByIssue($data['muets'] ?? null),
            self::secondsByIssue($data['aDisparaitre'] ?? null),
            self::secondsByIssue($data['disparus'] ?? null),
        );
    }

    /**
     * @return array<string, int>
     */
    private static function secondsByIssue(mixed $data): array
    {
        $counts = [];
        foreach (\is_array($data) ? $data : [] as $key => $count) {
            if (\is_string($key) && \is_int($count)) {
                $counts[$key] = $count;
            }
        }

        return $counts;
    }
}
