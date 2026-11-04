<?php

namespace App\Settings;

use App\Day\Objective;
use App\Entity\IssueType;
use App\Entity\Settings;
use App\Repository\IssueTypeRepository;
use App\Repository\JiraConnectionRepository;
use App\Repository\SettingsRepository;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Uid\Uuid;

/**
 * Les réglages de DayTrack enregistrés par le serveur : l'objectif habituel, les
 * jours travaillés et la teinte de chaque type de ticket. Le thème, lui, se choisit
 * par navigateur et n'arrive jamais ici.
 *
 * Lire n'écrit rien : tant qu'aucun réglage n'a changé, les valeurs par défaut valent
 * sans ligne dans la base. Chaque écriture ne touche que ce qu'elle nomme, si bien
 * qu'un onglet resté ouvert ne défait pas ce qu'un autre a réglé entre-temps.
 */
final readonly class UserSettings
{
    public function __construct(
        private SettingsRepository $settings,
        private IssueTypeRepository $types,
        private JiraConnectionRepository $connections,
        private EntityManagerInterface $entityManager,
    ) {
    }

    /** L'objectif de chaque journée pas encore saisie. */
    public function habitualObjective(): int
    {
        return $this->settings->current()->habitualObjective ?? Objective::HABITUAL;
    }

    /**
     * @return list<int> en jours de la semaine ISO, du lundi (1) au dimanche (7)
     */
    public function workingDays(): array
    {
        return $this->settings->current()->workingDays ?? Settings::DEFAULT_WORKING_DAYS;
    }

    /**
     * Le jour est travaillé selon les réglages d'aujourd'hui, même passé : cocher le
     * samedi vaut pour tous les samedis, les anciens compris.
     */
    public function isWorkingDay(\DateTimeImmutable $date): bool
    {
        return self::worksOn($this->workingDays(), $date);
    }

    /**
     * La même règle, pour qui a déjà lu les jours travaillés et parcourt plusieurs jours.
     *
     * @param list<int> $workingDays
     */
    public static function worksOn(array $workingDays, \DateTimeImmutable $date): bool
    {
        return \in_array((int) $date->format('N'), $workingDays, true);
    }

    public function setHabitualObjective(int $objective): void
    {
        $this->write(static function (Settings $settings) use ($objective): void {
            $settings->habitualObjective = $objective;
        });
    }

    public function setWorkingDay(int $isoDay, bool $worked): void
    {
        $this->write(static function (Settings $settings) use ($isoDay, $worked): void {
            $settings->work($isoDay, $worked);
        });
    }

    /** Change la teinte d'un type ; faux s'il n'existe plus. */
    public function recolor(Uuid $id, Tint $color): bool
    {
        $type = $this->types->byId($id);

        if (!$type instanceof IssueType) {
            return false;
        }

        $type->color = $color;
        $this->entityManager->flush();

        return true;
    }

    /**
     * @return array{habitualObjective: int, workingDays: list<int>, issueTypes: list<array{id: string, name: string, color: string}>}
     */
    public function toArray(): array
    {
        return [
            'habitualObjective' => $this->habitualObjective(),
            'workingDays' => $this->workingDays(),
            'issueTypes' => array_map(
                static fn (IssueType $type): array => $type->toArray(),
                $this->types->encountered($this->connections->current()?->instance),
            ),
        ];
    }

    /**
     * Une écriture des réglages, d'un seul tenant : la ligne naît à la première.
     *
     * @param \Closure(Settings): void $change
     */
    private function write(\Closure $change): void
    {
        // Pas de wrapInTransaction() : il ferme le gestionnaire d'entités au premier
        // refus, et la requête doit encore répondre.
        $connection = $this->entityManager->getConnection();
        $connection->beginTransaction();

        try {
            // La première instruction est une écriture : elle verrouille la base jusqu'à
            // la fin de la transaction, et deux onglets ne créent pas chacun leur ligne.
            $this->settings->lock();
            $settings = $this->settings->current();

            if (null === $settings) {
                $settings = new Settings();
                $this->entityManager->persist($settings);
            }

            $change($settings);
            $this->entityManager->flush();
            $connection->commit();
        } catch (\Throwable $exception) {
            if ($connection->isTransactionActive()) {
                $connection->rollBack();
            }
            $this->entityManager->clear();

            throw $exception;
        }
    }
}
