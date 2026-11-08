<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Le point de départ des jours vides, enfin repoussé par la reprise de la v1. La migration
 * qui l'a posé écrivait son identifiant en BLOB, quand Doctrine écrit et cherche les siens
 * en texte : pour SQLite, les deux ne sont jamais égaux. La reprise visait donc une ligne
 * introuvable, sans erreur, et le point de départ restait à l'heure du premier démarrage :
 * les jours vides de la v1 qui le suivaient se disaient « Incomplet ».
 *
 * L'identifiant passe en texte, octet pour octet, et le point de départ prend l'heure de la
 * reprise s'il est resté avant elle : ce qu'elle aurait écrit. Sans reprise, ou déjà après
 * elle, il ne bouge pas.
 */
final class Version20261106134806 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Le point de départ des jours vides, repoussé par la reprise de la v1';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("UPDATE empty_day_watch SET id = CAST(id AS TEXT) WHERE typeof(id) = 'blob'");
        $this->addSql('UPDATE empty_day_watch SET since = (SELECT imported_at FROM v1_import) WHERE since < (SELECT imported_at FROM v1_import)');
    }

    public function down(Schema $schema): void
    {
        // Rien à défaire : l'ancien identifiant, Doctrine ne le retrouvait pas, et l'heure
        // de la reprise est celle que le point de départ aurait dû prendre.
    }
}
