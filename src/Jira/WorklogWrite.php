<?php

namespace App\Jira;

/**
 * Une écriture d'heures dans Jira : ajouter une saisie, la corriger sur place, ou la
 * retirer. Une correction ne porte que ce qui change : seul cela s'inscrit dans
 * l'historique du ticket.
 */
final readonly class WorklogWrite
{
    private function __construct(
        public string $ticket,
        /** La saisie corrigée ou retirée ; null pour un ajout. */
        public ?string $id,
        public ?\DateTimeImmutable $started,
        public ?int $seconds,
        /** Le commentaire, s'il change ; une chaîne vide l'efface. */
        public ?string $comment,
        public bool $delete = false,
        /** Elle prend du reste à faire : un ajout, ou une correction qui allonge. */
        public bool $consumes = false,
    ) {
    }

    public static function add(string $ticket, \DateTimeImmutable $started, int $seconds, ?string $comment): self
    {
        return new self($ticket, null, $started, $seconds, $comment, false, true);
    }

    /** Ce qui sépare la saisie de Jira de celle que DayTrack veut : le reste ne part pas. */
    public static function update(JiraWorklog $existing, \DateTimeImmutable $started, int $seconds, ?string $comment): self
    {
        return new self(
            $existing->ticket,
            $existing->id,
            $existing->started->getTimestamp() === $started->getTimestamp() ? null : $started,
            $existing->seconds === $seconds ? null : $seconds,
            $existing->comment === $comment ? null : ($comment ?? ''),
            false,
            $seconds > $existing->seconds,
        );
    }

    public static function delete(JiraWorklog $existing): self
    {
        return new self($existing->ticket, $existing->id, null, null, null, true);
    }

    public function isAdd(): bool
    {
        return null === $this->id;
    }
}
