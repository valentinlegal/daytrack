<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * L'envoi d'un jour appartient au Jira et au compte qui l'ont reçu. Un envoi d'avant
 * n'appartient à aucun : la journée se redira non envoyée, rien n'en est perdu. La
 * table est recopiée telle quelle, SQLite ne sachant pas changer une contrainte en place.
 */
final class Version20261030074449 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'L\'envoi d\'un jour appartient au Jira et au compte qui l\'ont reçu';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TEMPORARY TABLE __temp__day_send AS SELECT id, sent_at, sent, touched, result, attempted_at, attempted, outcomes, failure, sending_since, day_id FROM day_send');
        $this->addSql('DROP TABLE day_send');
        $this->addSql('CREATE TABLE day_send (id BLOB NOT NULL, sent_at DATETIME DEFAULT NULL, sent CLOB DEFAULT NULL, touched CLOB NOT NULL, result VARCHAR(10) DEFAULT NULL, attempted_at DATETIME DEFAULT NULL, attempted CLOB NOT NULL, outcomes CLOB NOT NULL, failure VARCHAR(20) DEFAULT NULL, sending_since DATETIME DEFAULT NULL, day_id BLOB NOT NULL, instance VARCHAR(255) DEFAULT \'\' NOT NULL, account_id VARCHAR(128) DEFAULT \'\' NOT NULL, PRIMARY KEY (id), CONSTRAINT FK_C1BD7BB9C24126 FOREIGN KEY (day_id) REFERENCES day (id) ON UPDATE NO ACTION ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE)');
        $this->addSql('INSERT INTO day_send (id, sent_at, sent, touched, result, attempted_at, attempted, outcomes, failure, sending_since, day_id) SELECT id, sent_at, sent, touched, result, attempted_at, attempted, outcomes, failure, sending_since, day_id FROM __temp__day_send');
        $this->addSql('DROP TABLE __temp__day_send');
        $this->addSql('CREATE UNIQUE INDEX UNIQ_C1BD7BB9C241264230B1DE9B6B5FBA ON day_send (day_id, instance, account_id)');
        $this->addSql('CREATE INDEX IDX_C1BD7BB9C24126 ON day_send (day_id)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('CREATE TEMPORARY TABLE __temp__day_send AS SELECT id, sent_at, sent, touched, result, attempted_at, attempted, outcomes, failure, sending_since, day_id, instance, account_id FROM day_send');
        $this->addSql('DROP TABLE day_send');
        $this->addSql('CREATE TABLE day_send (id BLOB NOT NULL, sent_at DATETIME DEFAULT NULL, sent CLOB DEFAULT NULL, touched CLOB NOT NULL, result VARCHAR(10) DEFAULT NULL, attempted_at DATETIME DEFAULT NULL, attempted CLOB NOT NULL, outcomes CLOB NOT NULL, failure VARCHAR(20) DEFAULT NULL, sending_since DATETIME DEFAULT NULL, day_id BLOB NOT NULL, PRIMARY KEY (id), CONSTRAINT FK_C1BD7BB9C24126 FOREIGN KEY (day_id) REFERENCES day (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE)');
        // Un seul envoi par jour : celui du compte relié, à défaut le plus récent.
        $this->addSql('INSERT INTO day_send (id, sent_at, sent, touched, result, attempted_at, attempted, outcomes, failure, sending_since, day_id) SELECT id, sent_at, sent, touched, result, attempted_at, attempted, outcomes, failure, sending_since, day_id FROM __temp__day_send kept WHERE kept.id = (SELECT candidate.id FROM __temp__day_send candidate LEFT JOIN jira_connection jira ON jira.instance = candidate.instance AND jira.account_id = candidate.account_id WHERE candidate.day_id = kept.day_id ORDER BY jira.id IS NULL, COALESCE(candidate.attempted_at, candidate.sent_at) DESC, candidate.id DESC LIMIT 1)');
        $this->addSql('DROP TABLE __temp__day_send');
        $this->addSql('CREATE UNIQUE INDEX UNIQ_C1BD7BB9C24126 ON day_send (day_id)');
    }
}
