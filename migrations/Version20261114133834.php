<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * La récurrence coupée qu'une récurrence collée continue, et le jour de la coupe : nuls pour
 * celles d'avant, qui ne continuent rien.
 *
 * Les colonnes s'ajoutent et se retirent en place, sans recréer la table : les saisies et les
 * fois sautées y renvoient par clé étrangère, et supprimer la table, même un instant, délierait
 * les unes et effacerait les autres.
 */
final class Version20261114133834 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'La récurrence coupée que continue une récurrence collée';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE recurrence ADD COLUMN follows BLOB DEFAULT NULL');
        $this->addSql('ALTER TABLE recurrence ADD COLUMN cut_on DATE DEFAULT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE recurrence DROP COLUMN cut_on');
        $this->addSql('ALTER TABLE recurrence DROP COLUMN follows');
    }
}
