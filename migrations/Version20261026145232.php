<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Les périmètres qui manquent au jeton enregistré, que le bandeau du jeton refusé nomme.
 */
final class Version20261026145232 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Les périmètres qui manquent au jeton enregistré';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE jira_connection ADD COLUMN missing_scopes CLOB DEFAULT \'[]\' NOT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('CREATE TEMPORARY TABLE __temp__jira_connection AS SELECT id, single, site, api, email, encrypted_token, account_id, account_name, refusal FROM jira_connection');
        $this->addSql('DROP TABLE jira_connection');
        $this->addSql('CREATE TABLE jira_connection (id BLOB NOT NULL, single SMALLINT NOT NULL, site VARCHAR(255) NOT NULL, api VARCHAR(255) NOT NULL, email VARCHAR(255) NOT NULL, encrypted_token CLOB NOT NULL, account_id VARCHAR(128) NOT NULL, account_name VARCHAR(255) NOT NULL, refusal VARCHAR(20) DEFAULT NULL, PRIMARY KEY (id))');
        $this->addSql('INSERT INTO jira_connection (id, single, site, api, email, encrypted_token, account_id, account_name, refusal) SELECT id, single, site, api, email, encrypted_token, account_id, account_name, refusal FROM __temp__jira_connection');
        $this->addSql('DROP TABLE __temp__jira_connection');
        $this->addSql('CREATE UNIQUE INDEX UNIQ_980D9021CAA72719 ON jira_connection (single)');
    }
}
