<?php

namespace App\Recurrence;

/** Comment une récurrence revient : de semaine en semaine, ou de mois en mois. */
enum RhythmKind: string
{
    /** Ses jours de la semaine, chaque semaine ou une semaine sur 2, 3 ou 4. */
    case Weekly = 'weekly';
    /** Le n-ième — ou le dernier — jour de la semaine du mois : le 3e vendredi. */
    case MonthlyWeekday = 'monthly_weekday';
    /** Une date du mois : le 16. Un mois qui ne l'a pas n'en a pas. */
    case MonthlyDate = 'monthly_date';
}
