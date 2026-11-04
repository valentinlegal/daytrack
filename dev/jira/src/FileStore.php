<?php

namespace App\Dev\Jira;

/**
 * L'état dans un fichier JSON, verrouillé le temps d'une requête : le service du
 * développement sert plusieurs requêtes à la fois, et garde ce qu'il a reçu d'un
 * redémarrage à l'autre.
 */
final readonly class FileStore implements StateStore
{
    public function __construct(private string $path)
    {
    }

    public function update(callable $change): mixed
    {
        $directory = \dirname($this->path);
        if (!is_dir($directory) && !mkdir($directory, 0o775, true) && !is_dir($directory)) {
            throw new \RuntimeException(\sprintf('Impossible de créer %s.', $directory));
        }

        $handle = fopen($this->path, 'c+');
        if (false === $handle) {
            throw new \RuntimeException(\sprintf('Impossible d\'ouvrir %s.', $this->path));
        }

        try {
            flock($handle, \LOCK_EX);
            $content = stream_get_contents($handle);
            $data = \is_string($content) && '' !== $content ? json_decode($content, true, flags: \JSON_THROW_ON_ERROR) : [];
            $state = State::fromArray(\is_array($data) ? $data : []);

            $result = $change($state);

            ftruncate($handle, 0);
            rewind($handle);
            fwrite($handle, json_encode($state->toArray(), \JSON_THROW_ON_ERROR | \JSON_PRETTY_PRINT | \JSON_UNESCAPED_UNICODE | \JSON_UNESCAPED_SLASHES));
            fflush($handle);

            return $result;
        } finally {
            flock($handle, \LOCK_UN);
            fclose($handle);
        }
    }

    public function reset(): void
    {
        $this->update(static function (State $state): void {
            $state->worklogs = [];
            $state->journal = [];
            $state->writesByIssue = [];
            $state->remaining = [];
            $state->imageTags = State::IMAGE_TAGS;
        });
    }
}
