<?php

declare(strict_types=1);

namespace App\Enum;

/**
 * Type d'une règle récurrente : bloc de travail, pause, ou objectif journalier.
 */
enum TemplateRuleType: string
{
    case WORK = 'work';
    case BREAK = 'break';
    case TARGET_OVERRIDE = 'target_override';
}
