<?php

declare(strict_types=1);

namespace App\Enum;

/**
 * Type d'une entrée de temps : travail facturable ou pause non comptabilisée.
 */
enum EntryType: string
{
    case WORK = 'work';
    case BREAK = 'break';
}
