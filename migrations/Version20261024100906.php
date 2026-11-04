<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Les journées et leurs créneaux, un par quart d'heure occupé.
 */
final class Version20261024100906 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Les journées et leurs créneaux';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE day (id BLOB NOT NULL, date DATE NOT NULL, objective SMALLINT NOT NULL, version INTEGER NOT NULL, PRIMARY KEY (id))');
        $this->addSql('CREATE UNIQUE INDEX UNIQ_E5A02990AA9E377A ON day (date)');
        $this->addSql('CREATE TABLE slot (id BLOB NOT NULL, start SMALLINT NOT NULL, kind VARCHAR(5) NOT NULL, ticket VARCHAR(50) DEFAULT NULL, comment VARCHAR(500) DEFAULT NULL, day_id BLOB NOT NULL, PRIMARY KEY (id), CONSTRAINT FK_AC0E20679C24126 FOREIGN KEY (day_id) REFERENCES day (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE)');
        $this->addSql('CREATE UNIQUE INDEX slot_quarter ON slot (day_id, start)');
        $this->addSql('CREATE INDEX IDX_AC0E20679C24126 ON slot (day_id)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE slot');
        $this->addSql('DROP TABLE day');
    }
}
