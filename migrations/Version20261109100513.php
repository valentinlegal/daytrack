<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Les fois qu'une journée mise à 0h00 a retirées, que revenir à un objectif lui rend. Les
 * fois détachées existantes ne le sont pas.
 */
final class Version20261109100513 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Les fois retirées par une journée mise à 0h00';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE recurrence_skip ADD COLUMN held BOOLEAN DEFAULT 0 NOT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('CREATE TEMPORARY TABLE __temp__recurrence_skip AS SELECT id, date, recurrence_id FROM recurrence_skip');
        $this->addSql('DROP TABLE recurrence_skip');
        $this->addSql('CREATE TABLE recurrence_skip (id BLOB NOT NULL, date DATE NOT NULL, recurrence_id BLOB NOT NULL, PRIMARY KEY (id), CONSTRAINT FK_78D61BF52C414CE8 FOREIGN KEY (recurrence_id) REFERENCES recurrence (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE)');
        $this->addSql('INSERT INTO recurrence_skip (id, date, recurrence_id) SELECT id, date, recurrence_id FROM __temp__recurrence_skip');
        $this->addSql('DROP TABLE __temp__recurrence_skip');
        $this->addSql('CREATE UNIQUE INDEX recurrence_skip_day ON recurrence_skip (recurrence_id, date)');
        $this->addSql('CREATE INDEX IDX_78D61BF52C414CE8 ON recurrence_skip (recurrence_id)');
    }
}
