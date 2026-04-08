<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Auto-generated Migration: Please modify to your needs!
 */
final class Version20260408195500 extends AbstractMigration
{
    public function getDescription(): string
    {
        return '';
    }

    public function up(Schema $schema): void
    {
        // this up() migration is auto-generated, please modify it to your needs
        $this->addSql('CREATE TEMPORARY TABLE __temp__favorite_ticket AS SELECT id, ticket_key, name, ticket_type, position, created_at FROM favorite_ticket');
        $this->addSql('DROP TABLE favorite_ticket');
        $this->addSql('CREATE TABLE favorite_ticket (id BLOB NOT NULL, ticket_key VARCHAR(50) NOT NULL, ticket_summary VARCHAR(255) DEFAULT NULL, ticket_type VARCHAR(50) DEFAULT NULL, position INTEGER NOT NULL, created_at DATETIME NOT NULL, custom_name VARCHAR(255) DEFAULT NULL, PRIMARY KEY (id))');
        $this->addSql('INSERT INTO favorite_ticket (id, ticket_key, ticket_summary, ticket_type, position, created_at) SELECT id, ticket_key, name, ticket_type, position, created_at FROM __temp__favorite_ticket');
        $this->addSql('DROP TABLE __temp__favorite_ticket');
        $this->addSql('CREATE UNIQUE INDEX UNIQ_AB15C15989E97085 ON favorite_ticket (ticket_key)');
    }

    public function down(Schema $schema): void
    {
        // this down() migration is auto-generated, please modify it to your needs
        $this->addSql('CREATE TEMPORARY TABLE __temp__favorite_ticket AS SELECT id, ticket_key, ticket_type, position, created_at FROM favorite_ticket');
        $this->addSql('DROP TABLE favorite_ticket');
        $this->addSql('CREATE TABLE favorite_ticket (id BLOB NOT NULL, ticket_key VARCHAR(50) NOT NULL, ticket_type VARCHAR(50) DEFAULT NULL, position INTEGER NOT NULL, created_at DATETIME NOT NULL, name VARCHAR(255) DEFAULT NULL, PRIMARY KEY (id))');
        $this->addSql('INSERT INTO favorite_ticket (id, ticket_key, ticket_type, position, created_at) SELECT id, ticket_key, ticket_type, position, created_at FROM __temp__favorite_ticket');
        $this->addSql('DROP TABLE __temp__favorite_ticket');
        $this->addSql('CREATE UNIQUE INDEX UNIQ_AB15C15989E97085 ON favorite_ticket (ticket_key)');
    }
}
