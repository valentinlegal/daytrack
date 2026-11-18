<?php

namespace App\Recurrence;

use App\Day\Quarter;
use App\Entity\Recurrence;

/**
 * Une récurrence telle que l'API la rend : de quoi dire son rythme sur la flèche du bloc,
 * la remettre dans sa fenêtre, la nommer quand une autre voudrait son créneau, et savoir
 * quelles fois à venir ne le prennent plus (assets/grid/recurrence.ts).
 */
final class RecurrenceView
{
    /**
     * @param list<string> $skipped ses fois détachées ou effacées après aujourd'hui (RecurrenceRepository::skippedAfter)
     *
     * @return array{start: string, end: string, kind: string, weekdays: list<int>, everyWeeks: int, monthWeek: ?int, monthDay: ?int, firstDay: string, until: ?string, slot: array{kind: string, ticket: ?string, comment: ?string}, skipped: list<string>}
     */
    public static function of(Recurrence $recurrence, array $skipped = []): array
    {
        $rhythm = $recurrence->rhythm();
        $content = $recurrence->content();

        return [
            'start' => Quarter::format($recurrence->start),
            'end' => Quarter::format($recurrence->end),
            'kind' => $rhythm->kind->value,
            'weekdays' => $rhythm->weekdays,
            'everyWeeks' => $rhythm->everyWeeks,
            'monthWeek' => $rhythm->monthWeek,
            'monthDay' => $rhythm->monthDay,
            'firstDay' => $recurrence->firstDay->format('Y-m-d'),
            'until' => $recurrence->until?->format('Y-m-d'),
            'slot' => ['kind' => $content->kind->value, 'ticket' => $content->ticket, 'comment' => $content->comment],
            'skipped' => $skipped,
        ];
    }
}
