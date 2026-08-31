<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Normalise les alternances : avant le plafond à 2 membres, une alternance pouvait
 * rester à interval_weeks = 3 ou 4 avec seulement 2 membres (reliquat de la
 * fonctionnalité « jusqu'à 4 tickets »). L'invariant est désormais :
 * interval_weeks = nombre de membres du groupe de rotation, et les 2 membres d'une
 * alternance sont ancrés à 7 jours d'écart (semaines opposées, parité mod 2).
 *
 * Migration de données uniquement (aucun changement de schéma). SQL SQLite.
 */
final class Version20260831072500 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Normalise interval_weeks et anchor_date des alternances (plafond 2 membres, une semaine sur deux).';
    }

    public function up(Schema $schema): void
    {
        // interval_weeks = taille du groupe de rotation.
        $this->addSql(<<<'SQL'
            UPDATE template_rule
            SET interval_weeks = (
                SELECT COUNT(*) FROM template_rule AS s
                WHERE s.rotation_group_id = template_rule.rotation_group_id
            )
            WHERE rotation_group_id IS NOT NULL
            SQL);

        // Pour une alternance à 2 membres : réancre le 2e membre exactement 7 jours
        // après le 1er (le plus ancien par anchor_date, puis position), afin de
        // garantir des semaines opposées quel que soit l'historique d'ancrage.
        $this->addSql(<<<'SQL'
            UPDATE template_rule
            SET anchor_date = date((
                SELECT s.anchor_date FROM template_rule AS s
                WHERE s.rotation_group_id = template_rule.rotation_group_id
                ORDER BY s.anchor_date, s.position LIMIT 1
            ), '+7 days')
            WHERE rotation_group_id IN (
                SELECT rotation_group_id FROM template_rule
                WHERE rotation_group_id IS NOT NULL
                GROUP BY rotation_group_id
                HAVING COUNT(*) = 2
            )
            AND id <> (
                SELECT s.id FROM template_rule AS s
                WHERE s.rotation_group_id = template_rule.rotation_group_id
                ORDER BY s.anchor_date, s.position LIMIT 1
            )
            SQL);
    }

    public function down(Schema $schema): void
    {
        // Normalisation de données : l'ancienne cadence / l'ancien ancrage ne sont pas récupérables.
        $this->throwIrreversibleMigrationException();
    }
}
