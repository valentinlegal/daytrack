<?php

namespace App\Database;

/**
 * Ce qui sait prendre le verrou de la base, en début de transaction (LockedTransaction).
 */
interface Lockable
{
    /**
     * Une écriture qui ne change rien : dans une transaction, elle verrouille la base
     * jusqu'à la fin de celle-ci.
     */
    public function lock(): void;
}
