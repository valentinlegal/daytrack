<?php

namespace App\Api\Input;

/**
 * Une écriture qui pose des tickets : chacun se vérifie dans Jira avant d'entrer
 * (TicketsExistInJira).
 */
interface NamesTickets
{
    /**
     * Les tickets de travail que l'écriture pose, par le champ qui les porte.
     *
     * @return array<string, string>
     */
    public function namedTickets(): array;
}
