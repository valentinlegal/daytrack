<?php

namespace App\V1;

/**
 * Lit une base de la v1, 1.1.0 ou plus avancée : une préversion de la v1, deux migrations
 * plus loin, y a une table de plus, qui n'est pas lue.
 *
 * La lecture se fait sur une copie, avec son journal s'il en reste un : SQLite répare
 * une base interrompue en écrivant dedans, et l'ancienne base, qui est le retour
 * arrière vers la v1, ne doit jamais changer d'un octet.
 */
final readonly class V1Database
{
    /** Ce que la reprise lit : une base qui ne l'a pas n'est pas une base de la v1 qu'on connaît. */
    private const array REQUIRED = [
        'work_day' => ['id', 'date', 'target_minutes', 'jira_synced_at', 'jira_synced_tickets'],
        'time_entry' => ['work_day_id', 'started_at', 'ended_at', 'type', 'ticket_key', 'comment', 'ticket_summary'],
        'favorite_ticket' => ['ticket_key', 'custom_name', 'ticket_summary', 'position'],
    ];

    /**
     * @param list<V1Day>      $days
     * @param list<V1Favorite> $favorites dans l'ordre de la liste
     */
    private function __construct(
        public array $days,
        public array $favorites,
    ) {
    }

    /**
     * @throws \RuntimeException une base illisible, ou d'une forme inconnue : rien n'est repris
     */
    public static function read(string $path): self
    {
        $directory = sys_get_temp_dir().'/daytrack-v1-'.bin2hex(random_bytes(8));
        if (!mkdir($directory, 0o700)) {
            throw new \RuntimeException(\sprintf('Le dossier %s ne peut pas être créé.', $directory));
        }
        $copy = $directory.'/v1.db';

        try {
            foreach (['', '-journal', '-wal', '-shm'] as $suffix) {
                if (is_file($path.$suffix) && !copy($path.$suffix, $copy.$suffix)) {
                    throw new \RuntimeException(\sprintf('La base %s ne peut pas être copiée.', $path.$suffix));
                }
            }

            $pdo = new \PDO('sqlite:'.$copy, options: [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION, \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC]);
            self::check($pdo);

            return new self(self::days($pdo), self::favorites($pdo));
        } catch (\PDOException $exception) {
            throw new \RuntimeException(\sprintf('La base %s ne se lit pas : %s', $path, $exception->getMessage()), previous: $exception);
        } finally {
            array_map(unlink(...), array_filter((array) glob($directory.'/*'), \is_string(...)));
            rmdir($directory);
        }
    }

    /** Aucune table : une v1 arrêtée avant ses migrations n'a rien à reprendre. */
    private static function check(\PDO $pdo): void
    {
        if ([] === self::rows($pdo, "SELECT name FROM sqlite_master WHERE type = 'table'")) {
            return;
        }

        foreach (self::REQUIRED as $table => $columns) {
            $found = array_map(static fn (array $column): string => self::text($column['name']), self::rows($pdo, \sprintf('PRAGMA table_info(%s)', $table)));
            $missing = array_diff($columns, $found);

            if ([] !== $missing) {
                throw new \RuntimeException(\sprintf('La base de la v1 n\'a pas la forme attendue : il manque %s dans %s.', implode(', ', $missing), $table));
            }
        }
    }

    /**
     * @return list<V1Day>
     */
    private static function days(\PDO $pdo): array
    {
        if ([] === self::rows($pdo, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'work_day'")) {
            return [];
        }

        $entries = [];
        foreach (self::rows($pdo, 'SELECT d.date AS day, e.started_at, e.ended_at, e.type, e.ticket_key, e.comment, e.ticket_summary FROM time_entry e JOIN work_day d ON d.id = e.work_day_id ORDER BY e.started_at, e.ended_at') as $row) {
            $entries[self::text($row['day'])][] = new V1Entry(
                self::text($row['started_at']),
                self::textOrNull($row['ended_at']),
                self::text($row['type']),
                self::textOrNull($row['ticket_key']),
                self::textOrNull($row['comment']),
                self::textOrNull($row['ticket_summary']),
            );
        }

        $days = [];
        foreach (self::rows($pdo, 'SELECT date, target_minutes, jira_synced_at, jira_synced_tickets FROM work_day ORDER BY date') as $row) {
            $date = self::text($row['date']);
            $days[] = new V1Day(
                $date,
                is_numeric($row['target_minutes']) ? (int) $row['target_minutes'] : 0,
                self::textOrNull($row['jira_synced_at']),
                self::tickets(self::textOrNull($row['jira_synced_tickets'])),
                $entries[$date] ?? [],
            );
        }

        return $days;
    }

    /**
     * @return list<V1Favorite>
     */
    private static function favorites(\PDO $pdo): array
    {
        if ([] === self::rows($pdo, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'favorite_ticket'")) {
            return [];
        }

        return array_map(
            static fn (array $row): V1Favorite => new V1Favorite(self::text($row['ticket_key']), self::textOrNull($row['custom_name']), self::textOrNull($row['ticket_summary'])),
            self::rows($pdo, 'SELECT ticket_key, custom_name, ticket_summary FROM favorite_ticket ORDER BY position, created_at'),
        );
    }

    /**
     * @return list<string>
     */
    private static function tickets(?string $json): array
    {
        $tickets = null === $json ? null : json_decode($json, true);

        return \is_array($tickets) ? array_values(array_filter($tickets, \is_string(...))) : [];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function rows(\PDO $pdo, string $sql): array
    {
        $statement = $pdo->query($sql);
        if (false === $statement) {
            throw new \RuntimeException(\sprintf('La requête « %s » n\'a pas abouti.', $sql));
        }

        /** @var list<array<string, mixed>> $rows */
        $rows = $statement->fetchAll();

        return $rows;
    }

    private static function text(mixed $value): string
    {
        return \is_scalar($value) ? (string) $value : '';
    }

    private static function textOrNull(mixed $value): ?string
    {
        return null === $value ? null : self::text($value);
    }
}
