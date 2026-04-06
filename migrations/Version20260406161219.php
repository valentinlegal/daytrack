<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Auto-generated Migration: Please modify to your needs!
 */
final class Version20260406161219 extends AbstractMigration
{
    public function getDescription(): string
    {
        return '';
    }

    public function up(Schema $schema): void
    {
        // this up() migration is auto-generated, please modify it to your needs
        $this->addSql('ALTER TABLE time_entry ADD COLUMN ticket_summary VARCHAR(255) DEFAULT NULL');
        $this->addSql('ALTER TABLE time_entry ADD COLUMN ticket_type VARCHAR(50) DEFAULT NULL');
    }

    public function down(Schema $schema): void
    {
        // this down() migration is auto-generated, please modify it to your needs
        $this->addSql('CREATE TEMPORARY TABLE __temp__time_entry AS SELECT id, ticket_key, comment, started_at, ended_at, type, work_day_id FROM time_entry');
        $this->addSql('DROP TABLE time_entry');
        $this->addSql('CREATE TABLE time_entry (id BLOB NOT NULL, ticket_key VARCHAR(50) DEFAULT NULL, comment VARCHAR(500) DEFAULT NULL, started_at DATETIME NOT NULL, ended_at DATETIME DEFAULT NULL, type VARCHAR(10) NOT NULL, work_day_id BLOB NOT NULL, PRIMARY KEY (id), CONSTRAINT FK_6E537C0CA23B8704 FOREIGN KEY (work_day_id) REFERENCES work_day (id) NOT DEFERRABLE INITIALLY IMMEDIATE)');
        $this->addSql('INSERT INTO time_entry (id, ticket_key, comment, started_at, ended_at, type, work_day_id) SELECT id, ticket_key, comment, started_at, ended_at, type, work_day_id FROM __temp__time_entry');
        $this->addSql('DROP TABLE __temp__time_entry');
        $this->addSql('CREATE INDEX IDX_6E537C0CA23B8704 ON time_entry (work_day_id)');
    }
}
