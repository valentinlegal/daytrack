<?php

namespace App\Tests\Support;

/**
 * Une base de la v1, créée avec le schéma exact de ses versions : celui de la 1.1.0, ou
 * celui d'une préversion de la v1, deux migrations plus loin. Elle n'existe que pour un
 * test, et n'a que de faux tickets.
 */
final class V1Base
{
    public const string RELEASE = '1.1.0';
    public const string PREVIEW = 'preview';

    private const array SCHEMA = [
        'CREATE TABLE doctrine_migration_versions (version VARCHAR(191) NOT NULL, executed_at DATETIME DEFAULT NULL, execution_time INTEGER DEFAULT NULL, PRIMARY KEY (version))',
        'CREATE TABLE work_day (id BLOB NOT NULL, date DATE NOT NULL, target_minutes INTEGER NOT NULL, jira_synced_at DATETIME DEFAULT NULL, jira_synced_tickets CLOB DEFAULT NULL, PRIMARY KEY (id))',
        'CREATE UNIQUE INDEX UNIQ_9FCE7E0CAA9E377A ON work_day (date)',
        'CREATE TABLE time_entry (id BLOB NOT NULL, ticket_key VARCHAR(50) DEFAULT NULL, started_at DATETIME NOT NULL, ended_at DATETIME DEFAULT NULL, type VARCHAR(10) NOT NULL, work_day_id BLOB NOT NULL, comment VARCHAR(500) DEFAULT NULL, ticket_summary VARCHAR(255) DEFAULT NULL, ticket_type VARCHAR(50) DEFAULT NULL, PRIMARY KEY (id), CONSTRAINT FK_6E537C0CA23B8704 FOREIGN KEY (work_day_id) REFERENCES work_day (id) NOT DEFERRABLE INITIALLY IMMEDIATE)',
        'CREATE INDEX IDX_6E537C0CA23B8704 ON time_entry (work_day_id)',
        'CREATE TABLE favorite_ticket (id BLOB NOT NULL, ticket_key VARCHAR(50) NOT NULL, ticket_summary VARCHAR(255) DEFAULT NULL, ticket_type VARCHAR(50) DEFAULT NULL, position INTEGER NOT NULL, created_at DATETIME NOT NULL, custom_name VARCHAR(255) DEFAULT NULL, PRIMARY KEY (id))',
        'CREATE UNIQUE INDEX UNIQ_AB15C15989E97085 ON favorite_ticket (ticket_key)',
    ];

    private const string TEMPLATE_RULE = 'CREATE TABLE template_rule (id BLOB NOT NULL, rule_type VARCHAR(20) NOT NULL, start_time VARCHAR(5) DEFAULT NULL, duration_minutes INTEGER DEFAULT NULL, ticket_key VARCHAR(50) DEFAULT NULL, ticket_summary VARCHAR(255) DEFAULT NULL, ticket_type VARCHAR(50) DEFAULT NULL, comment VARCHAR(500) DEFAULT NULL, target_minutes INTEGER DEFAULT NULL, weekday INTEGER NOT NULL, interval_weeks INTEGER NOT NULL, anchor_date DATE NOT NULL, active_from DATE NOT NULL, active_until DATE DEFAULT NULL, enabled BOOLEAN NOT NULL, rotation_group_id BLOB DEFAULT NULL, position INTEGER NOT NULL, PRIMARY KEY (id))';

    private \PDO $pdo;
    public readonly string $path;

    public function __construct(string $version = self::RELEASE)
    {
        $directory = \dirname(__DIR__, 2).'/var/test';
        if (!is_dir($directory)) {
            mkdir($directory, 0o777, true);
        }

        $this->path = $directory.'/v1-'.bin2hex(random_bytes(6)).'.db';
        $this->pdo = new \PDO('sqlite:'.$this->path, options: [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION]);

        foreach (self::SCHEMA as $statement) {
            $this->pdo->exec($statement);
        }

        foreach (['20260330000002', '20260406161219', '20260408182652', '20260408195500'] as $migration) {
            $this->pdo->exec("INSERT INTO doctrine_migration_versions (version) VALUES ('DoctrineMigrations\\Version{$migration}')");
        }

        if (self::PREVIEW === $version) {
            $this->pdo->exec(self::TEMPLATE_RULE);
            $this->pdo->exec("INSERT INTO template_rule VALUES (x'01', 'break', '12:30', 60, NULL, NULL, NULL, NULL, NULL, 1, 1, '2026-01-05', '2026-01-05', NULL, 1, NULL, 0)");
            foreach (['20260829122249', '20260831072500'] as $migration) {
                $this->pdo->exec("INSERT INTO doctrine_migration_versions (version) VALUES ('DoctrineMigrations\\Version{$migration}')");
            }
        }
    }

    public function __destruct()
    {
        if (is_file($this->path)) {
            unlink($this->path);
        }
    }

    /**
     * @param list<string>|null $syncedTickets
     */
    public function day(string $date, int $target = 450, ?string $syncedAt = null, ?array $syncedTickets = null): string
    {
        $id = random_bytes(16);
        $statement = $this->pdo->prepare('INSERT INTO work_day (id, date, target_minutes, jira_synced_at, jira_synced_tickets) VALUES (?, ?, ?, ?, ?)');
        $statement->bindValue(1, $id, \PDO::PARAM_LOB);
        $statement->bindValue(2, $date);
        $statement->bindValue(3, $target, \PDO::PARAM_INT);
        $statement->bindValue(4, $syncedAt);
        $statement->bindValue(5, null === $syncedTickets ? null : json_encode($syncedTickets, \JSON_THROW_ON_ERROR));
        $statement->execute();

        return $id;
    }

    public function entry(string $day, string $date, string $start, ?string $end, ?string $ticket, ?string $comment = null, ?string $title = null, string $type = 'work'): void
    {
        $statement = $this->pdo->prepare('INSERT INTO time_entry (id, ticket_key, started_at, ended_at, type, work_day_id, comment, ticket_summary, ticket_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)');
        $statement->bindValue(1, random_bytes(16), \PDO::PARAM_LOB);
        $statement->bindValue(2, $ticket);
        $statement->bindValue(3, $date.' '.$start.':00');
        $statement->bindValue(4, null === $end ? null : $date.' '.$end.':00');
        $statement->bindValue(5, $type);
        $statement->bindValue(6, $day, \PDO::PARAM_LOB);
        $statement->bindValue(7, $comment);
        $statement->bindValue(8, $title);
        $statement->execute();
    }

    public function pause(string $day, string $date, string $start, string $end): void
    {
        $this->entry($day, $date, $start, $end, null, type: 'break');
    }

    public function favorite(string $ticket, int $position, ?string $name = null, ?string $title = null): void
    {
        $statement = $this->pdo->prepare("INSERT INTO favorite_ticket (id, ticket_key, ticket_summary, ticket_type, position, created_at, custom_name) VALUES (?, ?, ?, 'Story', ?, '2026-05-01 10:00:00', ?)");
        $statement->bindValue(1, random_bytes(16), \PDO::PARAM_LOB);
        $statement->bindValue(2, $ticket);
        $statement->bindValue(3, $title);
        $statement->bindValue(4, $position, \PDO::PARAM_INT);
        $statement->bindValue(5, $name);
        $statement->execute();
    }

    public function exec(string $sql): void
    {
        $this->pdo->exec($sql);
    }
}
