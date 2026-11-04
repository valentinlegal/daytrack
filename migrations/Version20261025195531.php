<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Les favoris, un par ticket, dans l'ordre de la liste.
 */
final class Version20261025195531 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Les favoris';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE favorite (id BLOB NOT NULL, ticket VARCHAR(50) NOT NULL, name VARCHAR(255) DEFAULT NULL, position INTEGER NOT NULL, PRIMARY KEY (id))');
        $this->addSql('CREATE UNIQUE INDEX UNIQ_68C58ED997A0ADA3 ON favorite (ticket)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE favorite');
    }
}
