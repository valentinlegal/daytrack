<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Ce que le dernier envoi complet a laissé dans Jira peut ne plus être su : un essai qui
 * a écrit depuis, ou un envoi interrompu, le remet à rien. La table est recopiée telle
 * quelle, SQLite ne sachant pas changer une colonne en place.
 */
final class Version20261028201421 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Ce que le dernier envoi a laissé dans Jira peut ne plus être su';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TEMPORARY TABLE __temp__day_send AS SELECT id, sent_at, sent, touched, result, attempted_at, attempted, outcomes, failure, sending_since, day_id FROM day_send');
        $this->addSql('DROP TABLE day_send');
        $this->addSql('CREATE TABLE day_send (id BLOB NOT NULL, sent_at DATETIME DEFAULT NULL, sent CLOB DEFAULT NULL, touched CLOB NOT NULL, result VARCHAR(10) DEFAULT NULL, attempted_at DATETIME DEFAULT NULL, attempted CLOB NOT NULL, outcomes CLOB NOT NULL, failure VARCHAR(20) DEFAULT NULL, sending_since DATETIME DEFAULT NULL, day_id BLOB NOT NULL, PRIMARY KEY (id), CONSTRAINT FK_C1BD7BB9C24126 FOREIGN KEY (day_id) REFERENCES day (id) ON UPDATE NO ACTION ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE)');
        $this->addSql('INSERT INTO day_send (id, sent_at, sent, touched, result, attempted_at, attempted, outcomes, failure, sending_since, day_id) SELECT id, sent_at, sent, touched, result, attempted_at, attempted, outcomes, failure, sending_since, day_id FROM __temp__day_send');
        $this->addSql('DROP TABLE __temp__day_send');
        $this->addSql('CREATE UNIQUE INDEX UNIQ_C1BD7BB9C24126 ON day_send (day_id)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('CREATE TEMPORARY TABLE __temp__day_send AS SELECT id, sent_at, sent, touched, result, attempted_at, attempted, outcomes, failure, sending_since, day_id FROM day_send');
        $this->addSql('DROP TABLE day_send');
        $this->addSql('CREATE TABLE day_send (id BLOB NOT NULL, sent_at DATETIME DEFAULT NULL, sent CLOB NOT NULL, touched CLOB NOT NULL, result VARCHAR(10) DEFAULT NULL, attempted_at DATETIME DEFAULT NULL, attempted CLOB NOT NULL, outcomes CLOB NOT NULL, failure VARCHAR(20) DEFAULT NULL, sending_since DATETIME DEFAULT NULL, day_id BLOB NOT NULL, PRIMARY KEY (id), CONSTRAINT FK_C1BD7BB9C24126 FOREIGN KEY (day_id) REFERENCES day (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE)');
        // Ce qui n'était plus su redevient une liste vide : la journée se dira modifiée.
        $this->addSql('INSERT INTO day_send (id, sent_at, sent, touched, result, attempted_at, attempted, outcomes, failure, sending_since, day_id) SELECT id, sent_at, COALESCE(sent, \'[]\'), touched, result, attempted_at, attempted, outcomes, failure, sending_since, day_id FROM __temp__day_send');
        $this->addSql('DROP TABLE __temp__day_send');
        $this->addSql('CREATE UNIQUE INDEX UNIQ_C1BD7BB9C24126 ON day_send (day_id)');
    }
}
