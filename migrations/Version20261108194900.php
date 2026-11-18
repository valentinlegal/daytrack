<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Les récurrences : ce qui revient, les fois détachées, et le lien de chaque saisie à la
 * récurrence qui l'a posée. Les saisies existantes n'en ont aucune.
 */
final class Version20261108194900 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Les récurrences, leurs fois détachées, et la récurrence qui pose chaque saisie';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE recurrence (id BLOB NOT NULL, kind VARCHAR(5) NOT NULL, ticket VARCHAR(50) DEFAULT NULL, comment VARCHAR(500) DEFAULT NULL, start SMALLINT NOT NULL, "end" SMALLINT NOT NULL, rhythm_kind VARCHAR(20) NOT NULL, weekdays CLOB NOT NULL, every_weeks SMALLINT NOT NULL, month_week SMALLINT DEFAULT NULL, month_day SMALLINT DEFAULT NULL, first_day DATE NOT NULL, until DATE DEFAULT NULL, posed_through DATE NOT NULL, PRIMARY KEY (id))');
        $this->addSql('CREATE TABLE recurrence_skip (id BLOB NOT NULL, date DATE NOT NULL, recurrence_id BLOB NOT NULL, PRIMARY KEY (id), CONSTRAINT FK_78D61BF52C414CE8 FOREIGN KEY (recurrence_id) REFERENCES recurrence (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE)');
        $this->addSql('CREATE UNIQUE INDEX recurrence_skip_day ON recurrence_skip (recurrence_id, date)');
        $this->addSql('CREATE INDEX IDX_78D61BF52C414CE8 ON recurrence_skip (recurrence_id)');
        $this->addSql('CREATE TEMPORARY TABLE __temp__slot AS SELECT id, start, kind, ticket, comment, day_id FROM slot');
        $this->addSql('DROP TABLE slot');
        $this->addSql('CREATE TABLE slot (id BLOB NOT NULL, start SMALLINT NOT NULL, kind VARCHAR(5) NOT NULL, ticket VARCHAR(50) DEFAULT NULL, comment VARCHAR(500) DEFAULT NULL, day_id BLOB NOT NULL, recurrence_id BLOB DEFAULT NULL, PRIMARY KEY (id), CONSTRAINT FK_AC0E20679C24126 FOREIGN KEY (day_id) REFERENCES day (id) ON UPDATE NO ACTION ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE, CONSTRAINT FK_AC0E20672C414CE8 FOREIGN KEY (recurrence_id) REFERENCES recurrence (id) ON DELETE SET NULL NOT DEFERRABLE INITIALLY IMMEDIATE)');
        $this->addSql('INSERT INTO slot (id, start, kind, ticket, comment, day_id) SELECT id, start, kind, ticket, comment, day_id FROM __temp__slot');
        $this->addSql('DROP TABLE __temp__slot');
        $this->addSql('CREATE INDEX IDX_AC0E20679C24126 ON slot (day_id)');
        $this->addSql('CREATE UNIQUE INDEX slot_quarter ON slot (day_id, start)');
        $this->addSql('CREATE INDEX IDX_AC0E20672C414CE8 ON slot (recurrence_id)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE recurrence');
        $this->addSql('DROP TABLE recurrence_skip');
        $this->addSql('CREATE TEMPORARY TABLE __temp__slot AS SELECT id, start, kind, ticket, comment, day_id FROM slot');
        $this->addSql('DROP TABLE slot');
        $this->addSql('CREATE TABLE slot (id BLOB NOT NULL, start SMALLINT NOT NULL, kind VARCHAR(5) NOT NULL, ticket VARCHAR(50) DEFAULT NULL, comment VARCHAR(500) DEFAULT NULL, day_id BLOB NOT NULL, PRIMARY KEY (id), CONSTRAINT FK_AC0E20679C24126 FOREIGN KEY (day_id) REFERENCES day (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE)');
        $this->addSql('INSERT INTO slot (id, start, kind, ticket, comment, day_id) SELECT id, start, kind, ticket, comment, day_id FROM __temp__slot');
        $this->addSql('DROP TABLE __temp__slot');
        $this->addSql('CREATE UNIQUE INDEX slot_quarter ON slot (day_id, start)');
        $this->addSql('CREATE INDEX IDX_AC0E20679C24126 ON slot (day_id)');
    }
}
