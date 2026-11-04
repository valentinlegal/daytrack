<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * L'envoi de chaque journée sur Jira : le dernier envoi complet, le dernier essai
 * s'il n'a pas tout envoyé, et l'envoi en cours. Aucune journée n'a encore été envoyée
 * par la v2 : la table naît vide.
 */
final class Version20261028183135 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'L\'envoi de chaque journée sur Jira';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE day_send (id BLOB NOT NULL, sent_at DATETIME DEFAULT NULL, sent CLOB NOT NULL, touched CLOB NOT NULL, result VARCHAR(10) DEFAULT NULL, attempted_at DATETIME DEFAULT NULL, attempted CLOB NOT NULL, outcomes CLOB NOT NULL, failure VARCHAR(20) DEFAULT NULL, sending_since DATETIME DEFAULT NULL, day_id BLOB NOT NULL, PRIMARY KEY (id), CONSTRAINT FK_C1BD7BB9C24126 FOREIGN KEY (day_id) REFERENCES day (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE)');
        $this->addSql('CREATE UNIQUE INDEX UNIQ_C1BD7BB9C24126 ON day_send (day_id)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE day_send');
    }
}
