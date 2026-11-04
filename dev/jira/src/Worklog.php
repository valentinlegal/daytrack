<?php

namespace App\Dev\Jira;

/**
 * Une saisie d'heures enregistrée par le Jira simulé, telle que Jira la rend.
 */
final readonly class Worklog
{
    public function __construct(
        public string $id,
        public string $issueKey,
        public string $authorId,
        public string $started,
        public int $timeSpentSeconds,
        public mixed $comment = null,
    ) {
    }

    /** Le jour de la saisie, tel qu'écrit dans « started » : celui de l'utilisateur. */
    public function day(): string
    {
        return substr($this->started, 0, 10);
    }

    /** L'instant du début, en millisecondes : ce que comparent startedAfter et startedBefore. */
    public function startedAt(): int
    {
        $started = \DateTimeImmutable::createFromFormat('Y-m-d\TH:i:s.vO', $this->started);

        if (false === $started) {
            throw new \UnexpectedValueException('Début illisible : '.$this->started);
        }

        return (int) $started->format('Uv');
    }

    /**
     * @return array<string, mixed>
     */
    public function toJira(): array
    {
        $isColleague = Catalog::COLLEAGUE_ID === $this->authorId;

        // Comme Jira Cloud : l'identifiant numérique du ticket, pas sa clé, et pas
        // d'adresse e-mail pour l'auteur — Jira la masque le plus souvent. Les
        // saisies d'un utilisateur se reconnaissent à son accountId, et à rien d'autre.
        return array_filter([
            'id' => $this->id,
            'issueId' => Catalog::issueId($this->issueKey),
            'author' => [
                'accountId' => $this->authorId,
                'displayName' => $isColleague ? Catalog::COLLEAGUE_NAME : Catalog::ACCOUNT_NAME,
            ],
            'started' => $this->started,
            'timeSpentSeconds' => $this->timeSpentSeconds,
            'comment' => $this->comment,
        ], static fn (mixed $value): bool => null !== $value);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'issueKey' => $this->issueKey,
            'authorId' => $this->authorId,
            'started' => $this->started,
            'timeSpentSeconds' => $this->timeSpentSeconds,
            'comment' => $this->comment,
        ];
    }

    /**
     * @param array<mixed> $data
     */
    public static function fromArray(array $data): self
    {
        $id = $data['id'] ?? null;
        $issueKey = $data['issueKey'] ?? null;
        $authorId = $data['authorId'] ?? null;
        $started = $data['started'] ?? null;
        $seconds = $data['timeSpentSeconds'] ?? null;

        if (!\is_string($id) || !\is_string($issueKey) || !\is_string($authorId) || !\is_string($started) || !\is_int($seconds)) {
            throw new \UnexpectedValueException('Saisie illisible dans l\'état du Jira simulé.');
        }

        return new self($id, $issueKey, $authorId, $started, $seconds, $data['comment'] ?? null);
    }
}
