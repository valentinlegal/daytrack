<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Jira relié depuis l'application : la connexion, son jeton chiffré, et les tickets
 * et les types que Jira a décrits.
 */
final class Version20261026133249 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'La connexion à Jira, les tickets et les types de ticket';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE issue_type (id BLOB NOT NULL, jira_id VARCHAR(50) NOT NULL, name VARCHAR(255) NOT NULL, level SMALLINT NOT NULL, PRIMARY KEY (id))');
        $this->addSql('CREATE UNIQUE INDEX UNIQ_D4399FE54D9ADAC ON issue_type (jira_id)');
        $this->addSql('CREATE TABLE jira_connection (id BLOB NOT NULL, single SMALLINT NOT NULL, site VARCHAR(255) NOT NULL, api VARCHAR(255) NOT NULL, email VARCHAR(255) NOT NULL, encrypted_token CLOB NOT NULL, account_id VARCHAR(128) NOT NULL, account_name VARCHAR(255) NOT NULL, refusal VARCHAR(20) DEFAULT NULL, PRIMARY KEY (id))');
        $this->addSql('CREATE UNIQUE INDEX UNIQ_980D9021CAA72719 ON jira_connection (single)');
        $this->addSql('CREATE TABLE ticket (id BLOB NOT NULL, ticket_key VARCHAR(50) NOT NULL, title VARCHAR(255) DEFAULT NULL, read_at DATETIME DEFAULT NULL, type_id BLOB DEFAULT NULL, PRIMARY KEY (id), CONSTRAINT FK_97A0ADA3C54C8C93 FOREIGN KEY (type_id) REFERENCES issue_type (id) ON DELETE SET NULL NOT DEFERRABLE INITIALLY IMMEDIATE)');
        $this->addSql('CREATE UNIQUE INDEX UNIQ_97A0ADA389E97085 ON ticket (ticket_key)');
        $this->addSql('CREATE INDEX IDX_97A0ADA3C54C8C93 ON ticket (type_id)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE ticket');
        $this->addSql('DROP TABLE jira_connection');
        $this->addSql('DROP TABLE issue_type');
    }
}
