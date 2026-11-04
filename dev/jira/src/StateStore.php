<?php

namespace App\Dev\Jira;

/**
 * Où vit l'état du Jira simulé : en mémoire pour un test, dans un fichier pour le
 * service du développement.
 */
interface StateStore
{
    /**
     * Passe l'état à $change et garde ce qu'il en a fait, d'un seul tenant : deux
     * requêtes simultanées ne s'écrasent pas.
     *
     * @template T
     *
     * @param callable(State): T $change
     *
     * @return T
     */
    public function update(callable $change): mixed;

    public function reset(): void;
}
