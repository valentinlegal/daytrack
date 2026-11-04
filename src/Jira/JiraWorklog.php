<?php

namespace App\Jira;

/**
 * Une saisie d'heures de l'utilisateur, telle que Jira la rend : son identifiant, son
 * début, son temps et le texte de son commentaire.
 */
final readonly class JiraWorklog
{
    public function __construct(
        public string $id,
        public string $ticket,
        public \DateTimeImmutable $started,
        public int $seconds,
        public ?string $comment,
    ) {
    }

    /**
     * Le texte d'un commentaire au format des documents d'Atlassian, comme DayTrack le
     * garde : une ligne, les espaces répétées réduites à une ; null s'il est vide.
     */
    public static function textOf(mixed $document): ?string
    {
        if (\is_string($document)) {
            return self::line($document);
        }

        $parts = [];
        self::collect($document, $parts);

        return self::line(implode(' ', $parts));
    }

    /**
     * Le commentaire d'une saisie au format des documents d'Atlassian, que l'API v3
     * demande ; un document vide efface celui d'une saisie corrigée.
     *
     * @return array{type: string, version: int, content: list<mixed>}
     */
    public static function documentOf(?string $comment): array
    {
        return [
            'type' => 'doc',
            'version' => 1,
            'content' => null === $comment ? [] : [['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => $comment]]]],
        ];
    }

    /**
     * @param list<string> $parts
     */
    private static function collect(mixed $node, array &$parts): void
    {
        if (!\is_array($node)) {
            return;
        }

        if ('text' === ($node['type'] ?? null) && \is_string($node['text'] ?? null)) {
            $parts[] = $node['text'];
        }

        foreach (\is_array($node['content'] ?? null) ? $node['content'] : [] as $child) {
            self::collect($child, $parts);
        }
    }

    private static function line(string $text): ?string
    {
        $text = trim(preg_replace('/[\p{Zs}\s]+/u', ' ', $text) ?? $text);

        return '' === $text ? null : $text;
    }
}
