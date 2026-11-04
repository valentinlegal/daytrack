<?php

namespace App\Day;

/**
 * Ce qu'un quart d'heure contient : un ticket et son commentaire, ou une pause.
 *
 * Deux quarts d'heure voisins au même contenu forment un seul bloc : c'est cette
 * égalité-là, et aucune autre, qui découpe la journée en blocs.
 */
final readonly class SlotContent
{
    private function __construct(
        public SlotKind $kind,
        public ?string $ticket,
        public ?string $comment,
    ) {
    }

    /** Le ticket et le commentaire doivent déjà avoir passé la validation. */
    public static function work(string $ticket, ?string $comment): self
    {
        return new self(SlotKind::Work, $ticket, $comment);
    }

    public static function pause(): self
    {
        return new self(SlotKind::Pause, null, null);
    }

    public function equals(self $other): bool
    {
        return $this->kind === $other->kind && $this->ticket === $other->ticket && $this->comment === $other->comment;
    }

    public function isWork(): bool
    {
        return SlotKind::Work === $this->kind;
    }
}
