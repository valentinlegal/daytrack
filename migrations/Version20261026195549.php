<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Les réglages de la journée (objectif habituel, jours travaillés), et les types de
 * ticket rattachés à leur Jira, avec leur teinte.
 *
 * Une connexion déjà enregistrée prend son site pour Jira, et ses types le suivent ;
 * Story, Bug, Tâche et Epic prennent leur teinte de départ, les autres le gris.
 */
final class Version20261026195549 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Les réglages de la journée, et les types rattachés à leur Jira avec leur teinte';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE settings (id BLOB NOT NULL, single SMALLINT NOT NULL, habitual_objective SMALLINT NOT NULL, working_days CLOB NOT NULL, PRIMARY KEY (id))');
        $this->addSql('CREATE UNIQUE INDEX UNIQ_E545A0C5CAA72719 ON settings (single)');
        // SQLite n'ajoute pas une colonne obligatoire sans valeur par défaut : la table
        // se refait, et la connexion enregistrée prend son site pour Jira.
        $this->addSql('CREATE TEMPORARY TABLE __temp__jira_connection AS SELECT id, single, site, api, email, encrypted_token, account_id, account_name, refusal, missing_scopes FROM jira_connection');
        $this->addSql('DROP TABLE jira_connection');
        $this->addSql('CREATE TABLE jira_connection (id BLOB NOT NULL, single SMALLINT NOT NULL, site VARCHAR(255) NOT NULL, api VARCHAR(255) NOT NULL, instance VARCHAR(255) NOT NULL, email VARCHAR(255) NOT NULL, encrypted_token CLOB NOT NULL, account_id VARCHAR(128) NOT NULL, account_name VARCHAR(255) NOT NULL, refusal VARCHAR(20) DEFAULT NULL, missing_scopes CLOB DEFAULT \'[]\' NOT NULL, PRIMARY KEY (id))');
        $this->addSql('INSERT INTO jira_connection (id, single, site, api, instance, email, encrypted_token, account_id, account_name, refusal, missing_scopes) SELECT id, single, site, api, site, email, encrypted_token, account_id, account_name, refusal, missing_scopes FROM __temp__jira_connection');
        $this->addSql('DROP TABLE __temp__jira_connection');
        $this->addSql('CREATE UNIQUE INDEX UNIQ_980D9021CAA72719 ON jira_connection (single)');
        // Refaire la table des types vide le type des tickets, que la base remet à null
        // en la supprimant : ils se gardent à côté, puis se rendent.
        $this->addSql('CREATE TEMPORARY TABLE __temp__ticket_type AS SELECT id, type_id FROM ticket WHERE type_id IS NOT NULL');
        $this->addSql('CREATE TEMPORARY TABLE __temp__issue_type AS SELECT id, jira_id, name, level FROM issue_type');
        $this->addSql('DROP TABLE issue_type');
        $this->addSql('CREATE TABLE issue_type (id BLOB NOT NULL, jira_id VARCHAR(50) NOT NULL, name VARCHAR(255) NOT NULL, level SMALLINT NOT NULL, instance VARCHAR(255) NOT NULL, color VARCHAR(10) NOT NULL, PRIMARY KEY (id))');
        $this->addSql(<<<'SQL'
            INSERT INTO issue_type (id, jira_id, name, level, instance, color)
            SELECT id, jira_id, name, level,
                COALESCE((SELECT instance FROM jira_connection), ''),
                CASE lower(name)
                    WHEN 'story' THEN 'vert'
                    WHEN 'bug' THEN 'rouge'
                    WHEN 'task' THEN 'bleu'
                    WHEN 'tâche' THEN 'bleu'
                    WHEN 'epic' THEN 'violet'
                    WHEN 'épopée' THEN 'violet'
                    WHEN 'Épopée' THEN 'violet'
                    ELSE 'gris'
                END
            FROM __temp__issue_type
            SQL);
        $this->addSql('DROP TABLE __temp__issue_type');
        $this->addSql('CREATE UNIQUE INDEX issue_type_instance ON issue_type (instance, jira_id)');
        $this->addSql('UPDATE ticket SET type_id = (SELECT saved.type_id FROM __temp__ticket_type saved WHERE saved.id = ticket.id) WHERE id IN (SELECT id FROM __temp__ticket_type)');
        $this->addSql('DROP TABLE __temp__ticket_type');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE settings');
        $this->addSql('CREATE TEMPORARY TABLE __temp__ticket_type AS SELECT id, type_id FROM ticket WHERE type_id IS NOT NULL');
        $this->addSql('CREATE TEMPORARY TABLE __temp__issue_type AS SELECT id, jira_id, name, level FROM issue_type');
        $this->addSql('DROP TABLE issue_type');
        $this->addSql('CREATE TABLE issue_type (id BLOB NOT NULL, jira_id VARCHAR(50) NOT NULL, name VARCHAR(255) NOT NULL, level SMALLINT NOT NULL, PRIMARY KEY (id))');
        $this->addSql('INSERT INTO issue_type (id, jira_id, name, level) SELECT id, jira_id, name, level FROM __temp__issue_type');
        $this->addSql('DROP TABLE __temp__issue_type');
        $this->addSql('CREATE UNIQUE INDEX UNIQ_D4399FE54D9ADAC ON issue_type (jira_id)');
        $this->addSql('UPDATE ticket SET type_id = (SELECT saved.type_id FROM __temp__ticket_type saved WHERE saved.id = ticket.id) WHERE id IN (SELECT id FROM __temp__ticket_type)');
        $this->addSql('DROP TABLE __temp__ticket_type');
        $this->addSql('CREATE TEMPORARY TABLE __temp__jira_connection AS SELECT id, single, site, api, email, encrypted_token, account_id, account_name, refusal, missing_scopes FROM jira_connection');
        $this->addSql('DROP TABLE jira_connection');
        $this->addSql('CREATE TABLE jira_connection (id BLOB NOT NULL, single SMALLINT NOT NULL, site VARCHAR(255) NOT NULL, api VARCHAR(255) NOT NULL, email VARCHAR(255) NOT NULL, encrypted_token CLOB NOT NULL, account_id VARCHAR(128) NOT NULL, account_name VARCHAR(255) NOT NULL, refusal VARCHAR(20) DEFAULT NULL, missing_scopes CLOB DEFAULT \'[]\' NOT NULL, PRIMARY KEY (id))');
        $this->addSql('INSERT INTO jira_connection (id, single, site, api, email, encrypted_token, account_id, account_name, refusal, missing_scopes) SELECT id, single, site, api, email, encrypted_token, account_id, account_name, refusal, missing_scopes FROM __temp__jira_connection');
        $this->addSql('DROP TABLE __temp__jira_connection');
        $this->addSql('CREATE UNIQUE INDEX UNIQ_980D9021CAA72719 ON jira_connection (single)');
    }
}
