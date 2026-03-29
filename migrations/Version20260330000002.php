<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Schéma initial complet — migration de référence consolidant toutes les migrations précédentes.
 */
final class Version20260330000002 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Schéma initial complet (work_day + time_entry)';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE work_day (id BLOB NOT NULL, date DATE NOT NULL, target_minutes INTEGER NOT NULL, jira_synced_at DATETIME DEFAULT NULL, jira_synced_tickets CLOB DEFAULT NULL, PRIMARY KEY (id))');
        $this->addSql('CREATE UNIQUE INDEX UNIQ_9FCE7E0CAA9E377A ON work_day (date)');
        $this->addSql('CREATE TABLE time_entry (id BLOB NOT NULL, ticket_key VARCHAR(50) DEFAULT NULL, started_at DATETIME NOT NULL, ended_at DATETIME DEFAULT NULL, type VARCHAR(10) NOT NULL, work_day_id BLOB NOT NULL, comment VARCHAR(500) DEFAULT NULL, PRIMARY KEY (id), CONSTRAINT FK_6E537C0CA23B8704 FOREIGN KEY (work_day_id) REFERENCES work_day (id) NOT DEFERRABLE INITIALLY IMMEDIATE)');
        $this->addSql('CREATE INDEX IDX_6E537C0CA23B8704 ON time_entry (work_day_id)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE time_entry');
        $this->addSql('DROP TABLE work_day');
    }
}