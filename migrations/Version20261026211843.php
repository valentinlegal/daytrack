<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * L'objectif choisi pour un jour précis, qui tient même quand la journée est vide.
 *
 * Avant les réglages, l'objectif habituel valait toujours 7h30 : une journée qui a un
 * autre objectif l'a reçu de la fenêtre Objectif du jour — un jour de congé à 0h00 —,
 * et le garde. Les autres, vides, suivent désormais l'objectif habituel.
 */
final class Version20261026211843 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'L\'objectif choisi pour un jour précis';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE day ADD COLUMN objective_chosen BOOLEAN DEFAULT 0 NOT NULL');
        $this->addSql('UPDATE day SET objective_chosen = 1 WHERE objective <> 450');
    }

    public function down(Schema $schema): void
    {
        // Pas de table refaite : la supprimer effacerait ses saisies, par leur clé étrangère.
        $this->addSql('ALTER TABLE day DROP COLUMN objective_chosen');
    }
}
