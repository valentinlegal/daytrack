<?php

namespace App\Sending;

/**
 * Un envoi qui n'a pas tout envoyé.
 */
enum SendResult: string
{
    /** Jira a répondu, mais au moins un ticket n'y est pas tel que la journée le dit. */
    case Partial = 'partial';
    /** Jira a accepté des écritures, puis n'a pas pu être relu. */
    case Unverified = 'unverified';
    /** Rien n'a pu partir : Jira ne répond pas, ou il refuse le jeton. */
    case Failed = 'failed';
}
