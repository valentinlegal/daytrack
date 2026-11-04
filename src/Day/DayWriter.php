<?php

namespace App\Day;

use App\Entity\Day;
use App\Repository\DayRepository;
use App\Settings\UserSettings;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Le seul chemin par lequel une journée s'écrit.
 *
 * Un geste s'applique en entier ou pas du tout, et seulement sur la version de la
 * journée qu'il a vue : celui d'un onglet en retard est refusé, sans rien écrire.
 */
final readonly class DayWriter
{
    public function __construct(
        private EntityManagerInterface $entityManager,
        private DayRepository $days,
        private UserSettings $settings,
    ) {
    }

    /**
     * @param array<int, ?SlotContent> $changes chaque quart d'heure nommé, par son début, et ce qu'il devient
     *
     * @return ?Day la journée écrite, ou null si le geste ne fait que vider une
     *              journée qui n'existe pas encore : elle reste sans ligne
     *
     * @throws StaleDay
     */
    public function changeSlots(\DateTimeImmutable $date, int $version, array $changes): ?Day
    {
        // Effacer sur un jour jamais saisi ne le crée pas : il prendrait l'objectif
        // habituel du moment, et ne suivrait plus celui des réglages.
        $creates = [] !== array_filter($changes, static fn (?SlotContent $content): bool => null !== $content);

        return $this->write($date, $version, $creates, static function (Day $day) use ($changes): void {
            $day->change($changes);
        });
    }

    /**
     * @throws StaleDay
     * @throws NonWorkingDay
     */
    public function setObjective(\DateTimeImmutable $date, int $version, int $objective): Day
    {
        // Hors du verrou, sans risque : un objectif écrit sur un jour décoché au même
        // instant dans un autre onglet ne se lit pas, un jour non travaillé se lisant sans
        // objectif (DayReader).
        if (!$this->settings->isWorkingDay($date)) {
            throw new NonWorkingDay();
        }

        return $this->write($date, $version, true, function (Day $day) use ($objective): void {
            // Lu sous le verrou, comme à la naissance d'une journée.
            $habitual = $this->settings->habitualObjective();
            if ($objective === $habitual) {
                $day->returnToHabitual($habitual);
            } else {
                $day->chooseObjective($objective);
            }
        }) ?? throw new \LogicException('Un objectif crée toujours sa journée.');
    }

    /**
     * @param \Closure(Day): void $gesture
     *
     * @throws StaleDay
     */
    private function write(\DateTimeImmutable $date, int $version, bool $creates, \Closure $gesture): ?Day
    {
        // Pas de wrapInTransaction() : il ferme le gestionnaire d'entités au premier
        // refus, et la réponse à un onglet en retard doit encore lire la journée.
        $connection = $this->entityManager->getConnection();
        $connection->beginTransaction();

        try {
            // La première instruction est une écriture : elle verrouille la base
            // jusqu'à la fin de la transaction. Deux écritures simultanées passent
            // l'une après l'autre, et la seconde voit la version de la première.
            $claimed = $this->days->claim($date, $version);

            $day = $this->days->findWithSlots($date);
            if (null !== $day) {
                // La version vient d'avancer dans la base, pas dans l'objet déjà chargé.
                $this->entityManager->refresh($day);
                if (!$claimed) {
                    throw new StaleDay();
                }
                // Vide et sans objectif choisi, elle reprend l'habituel du moment, comme
                // une journée qui naît.
                if ($day->followsHabitual()) {
                    $day->objective = $this->settings->habitualObjective();
                }
            } elseif (0 !== $version) {
                throw new StaleDay();
            } elseif (!$creates) {
                $connection->rollBack();

                return null;
            } else {
                // Lu sous le verrou : un objectif habituel changé dans un autre onglet
                // vaut pour la journée qui naît ici.
                $day = new Day($date, $this->settings->habitualObjective());
                $this->entityManager->persist($day);
            }

            $gesture($day);
            $this->entityManager->flush();
            $connection->commit();

            return $day;
        } catch (\Throwable $exception) {
            if ($connection->isTransactionActive()) {
                $connection->rollBack();
            }
            // Ce que la mémoire tient ne correspond plus à la base : on l'oublie.
            $this->entityManager->clear();

            throw $exception;
        }
    }
}
