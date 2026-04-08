<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Auto-generated Migration: Please modify to your needs!
 */
final class Version20260408182652 extends AbstractMigration
{
    public function getDescription(): string
    {
        return '';
    }

    public function up(Schema $schema): void
    {
        // this up() migration is auto-generated, please modify it to your needs
        $this->addSql('CREATE TABLE favorite_ticket (id BLOB NOT NULL, ticket_key VARCHAR(50) NOT NULL, name VARCHAR(255) DEFAULT NULL, ticket_type VARCHAR(50) DEFAULT NULL, position INTEGER NOT NULL, created_at DATETIME NOT NULL, PRIMARY KEY (id))');
        $this->addSql('CREATE UNIQUE INDEX UNIQ_AB15C15989E97085 ON favorite_ticket (ticket_key)');
    }

    public function down(Schema $schema): void
    {
        // this down() migration is auto-generated, please modify it to your needs
        $this->addSql('DROP TABLE favorite_ticket');
    }
}
