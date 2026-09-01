<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Auto-generated Migration: Please modify to your needs!
 */
final class Version20260829122249 extends AbstractMigration
{
    public function getDescription(): string
    {
        return '';
    }

    public function up(Schema $schema): void
    {
        // this up() migration is auto-generated, please modify it to your needs
        $this->addSql('CREATE TABLE template_rule (id BLOB NOT NULL, rule_type VARCHAR(20) NOT NULL, start_time VARCHAR(5) DEFAULT NULL, duration_minutes INTEGER DEFAULT NULL, ticket_key VARCHAR(50) DEFAULT NULL, ticket_summary VARCHAR(255) DEFAULT NULL, ticket_type VARCHAR(50) DEFAULT NULL, comment VARCHAR(500) DEFAULT NULL, target_minutes INTEGER DEFAULT NULL, weekday INTEGER NOT NULL, interval_weeks INTEGER NOT NULL, anchor_date DATE NOT NULL, active_from DATE NOT NULL, active_until DATE DEFAULT NULL, enabled BOOLEAN NOT NULL, rotation_group_id BLOB DEFAULT NULL, position INTEGER NOT NULL, PRIMARY KEY (id))');
    }

    public function down(Schema $schema): void
    {
        // this down() migration is auto-generated, please modify it to your needs
        $this->addSql('DROP TABLE template_rule');
    }
}
