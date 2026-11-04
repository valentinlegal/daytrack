<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * La v1 avait envoyé une journée, puis elle a changé : la v1 n'en gardait pas l'heure.
 */
final class Version20261030164527 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Une journée envoyée par la v1 puis modifiée';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE day_send ADD COLUMN sent_by_v1 BOOLEAN DEFAULT 0 NOT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('CREATE TEMPORARY TABLE __temp__day_send AS SELECT id, instance, account_id, sent_at, sent, touched, result, attempted_at, attempted, outcomes, failure, sending_since, day_id FROM day_send');
        $this->addSql('DROP TABLE day_send');
        $this->addSql('CREATE TABLE day_send (id BLOB NOT NULL, instance VARCHAR(255) DEFAULT \'\' NOT NULL, account_id VARCHAR(128) DEFAULT \'\' NOT NULL, sent_at DATETIME DEFAULT NULL, sent CLOB DEFAULT NULL, touched CLOB NOT NULL, result VARCHAR(10) DEFAULT NULL, attempted_at DATETIME DEFAULT NULL, attempted CLOB NOT NULL, outcomes CLOB NOT NULL, failure VARCHAR(20) DEFAULT NULL, sending_since DATETIME DEFAULT NULL, day_id BLOB NOT NULL, PRIMARY KEY (id), CONSTRAINT FK_C1BD7BB9C24126 FOREIGN KEY (day_id) REFERENCES day (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE)');
        $this->addSql('INSERT INTO day_send (id, instance, account_id, sent_at, sent, touched, result, attempted_at, attempted, outcomes, failure, sending_since, day_id) SELECT id, instance, account_id, sent_at, sent, touched, result, attempted_at, attempted, outcomes, failure, sending_since, day_id FROM __temp__day_send');
        $this->addSql('DROP TABLE __temp__day_send');
        $this->addSql('CREATE UNIQUE INDEX UNIQ_C1BD7BB9C241264230B1DE9B6B5FBA ON day_send (day_id, instance, account_id)');
        $this->addSql('CREATE INDEX IDX_C1BD7BB9C24126 ON day_send (day_id)');
    }
}
