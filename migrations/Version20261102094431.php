<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\ParameterType;
use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;
use Symfony\Component\Uid\Uuid;

/**
 * Le point de départ des jours vides : un jour vide se signale désormais « Incomplet »,
 * mais seulement s'il suit le premier démarrage de cette version. Une migration ne joue
 * qu'une fois, à ce démarrage-là : l'instant où elle joue est ce point de départ, sur une
 * installation neuve comme sur une mise à jour. Les congés passés, ceux de la v1 compris,
 * restent sans marque.
 */
final class Version20261102094431 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Le point de départ des jours vides';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE empty_day_watch (id BLOB NOT NULL, single SMALLINT NOT NULL, since DATETIME NOT NULL, PRIMARY KEY (id))');
        $this->addSql('CREATE UNIQUE INDEX UNIQ_C24A922DCAA72719 ON empty_day_watch (single)');
        // CURRENT_TIMESTAMP est en heure universelle, comme tout instant de la base.
        $this->addSql(
            'INSERT INTO empty_day_watch (id, single, since) VALUES (?, 1, CURRENT_TIMESTAMP)',
            [Uuid::v7()->toBinary()],
            [ParameterType::BINARY],
        );
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE empty_day_watch');
    }
}
