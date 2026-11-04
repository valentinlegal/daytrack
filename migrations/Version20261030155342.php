<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * La reprise de la v1 a eu lieu, et ce qu'elle a laissé de côté.
 */
final class Version20261030155342 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'La reprise de la v1';
    }

    public function up(Schema $schema): void
    {
        $this->addSql(<<<'SQL'
            CREATE TABLE v1_import (
              id BLOB NOT NULL,
              single SMALLINT NOT NULL,
              imported_at DATETIME NOT NULL,
              left_out CLOB NOT NULL,
              PRIMARY KEY (id)
            )
        SQL);
        $this->addSql('CREATE UNIQUE INDEX UNIQ_D5C60BF2CAA72719 ON v1_import (single)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE v1_import');
    }
}
