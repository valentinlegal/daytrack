<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\WorkDay;
use App\Enum\EntryType;

/**
 * Orchestre la synchronisation des entrées locales d'une journée vers JIRA.
 *
 * Stratégie de déduplication : suppression puis recréation des worklogs de l'utilisateur
 * pour les tickets concernés sur la date cible. On ne touche jamais les worklogs des autres.
 *
 * Pour gérer le cas "journée vidée entre deux synchros", on conserve la liste des tickets
 * du dernier sync (jiraSyncedTickets) afin de pouvoir nettoyer JIRA même si la journée
 * locale est désormais vide.
 *
 * Optimisation des requêtes : les appels JIRA sont regroupés en 3 phases parallèles
 * (lecture / suppression / création) pour minimiser le temps d'attente total.
 */
class JiraSyncService
{
    public function __construct(
        private readonly JiraService $jira,
    ) {}

    /**
     * Synchronise les entrées WORK d'une journée vers JIRA.
     * Retourne un résultat détaillant les worklogs créés, supprimés et les éventuelles erreurs.
     */
    public function sync(WorkDay $workDay): JiraSyncResult
    {
        // 1. Filtrer les entrées WORK avec ticket et durée calculable
        $validEntries = [];
        foreach ($workDay->entries as $entry) {
            if (
                EntryType::WORK === $entry->type
                && null !== $entry->ticketKey
                && null !== $entry->endedAt
            ) {
                $validEntries[] = $entry;
            }
        }

        // 2. Déterminer les tickets à requêter depuis les données locales uniquement
        $currentKeys = array_values(array_unique(array_map(fn ($e) => $e->ticketKey, $validEntries)));
        $previousKeys = $workDay->jiraSyncedTickets ?? [];
        // Les tickets à nettoyer = tickets actuels + tickets du dernier sync (cas journée vidée)
        $ticketsToClean = array_values(array_unique(array_merge($currentKeys, $previousKeys)));

        // 3. Phase 1 (parallèle) : fetch des worklogs existants uniquement
        //    Les titres des tickets ne sont plus récupérés ici : ils sont désormais stockés localement
        //    dans TimeEntry::ticketSummary et n'ont pas à être comparés au commentaire.
        $fetched = $this->jira->batchFetchSummariesAndWorklogs([], $ticketsToClean, $workDay->date);
        $worklogsByTicket = $fetched['worklogs'];

        // 4. Grouper les entrées par (ticketKey, commentaire) — le commentaire est envoyé tel quel
        /** @var array<string, array{ticketKey: string, comment: string|null, seconds: int}> $groups */
        $groups = [];
        foreach ($validEntries as $entry) {
            $comment = $entry->comment;

            $groupKey = $entry->ticketKey.'|'.($comment ?? '');
            if (!isset($groups[$groupKey])) {
                $groups[$groupKey] = [
                    'ticketKey' => $entry->ticketKey,
                    'comment' => $comment,
                    'seconds' => 0,
                ];
            }
            $groups[$groupKey]['seconds'] += ($entry->endedAt->getTimestamp() - $entry->startedAt->getTimestamp());
        }

        // 5. Phase 2 (parallèle) : supprimer tous les worklogs existants en une seule vague
        $deleteErrors = $this->jira->batchDeleteWorklogs($worklogsByTicket);
        $deletedCount = array_sum(array_map('count', $worklogsByTicket));

        // Si aucune entrée à créer, on s'arrête après le nettoyage
        if ([] === $groups) {
            return new JiraSyncResult(syncedCount: 0, deletedCount: $deletedCount, errors: $deleteErrors);
        }

        // 6. Phase 3 (parallèle) : créer les worklogs groupés, en ignorant les tickets en erreur
        $groupsToCreate = array_values(array_filter(
            $groups,
            fn ($g) => !isset($deleteErrors[$g['ticketKey']]),
        ));

        $createErrors = $this->jira->batchCreateWorklogs($groupsToCreate, $workDay->date);
        $syncedCount = count($groupsToCreate) - count($createErrors);

        $errors = array_merge($deleteErrors, $createErrors);

        return new JiraSyncResult(syncedCount: $syncedCount, deletedCount: $deletedCount, errors: $errors);
    }
}