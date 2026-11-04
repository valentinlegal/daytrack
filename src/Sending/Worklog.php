<?php

namespace App\Sending;

use App\Day\Grid;
use App\Day\UserCalendar;

/**
 * Une saisie d'heures telle que DayTrack la veut dans Jira : un ticket et un
 * commentaire de la journée, leur temps, à l'heure de leur premier quart d'heure.
 *
 * Comme dans la v1, les quarts d'heure d'un même ticket au même commentaire n'en font
 * qu'une, même séparés. Jira range une saisie au jour de son début : il tombe dans le
 * jour travaillé, quel que soit celui de l'envoi, et ne bouge pas d'un renvoi à l'autre.
 */
final readonly class Worklog
{
    /** Le format de « started » dans Jira : 2026-10-06T09:30:00.000+0200. */
    public const string STARTED = 'Y-m-d\TH:i:s.vO';

    public function __construct(
        public string $ticket,
        public ?string $comment,
        public \DateTimeImmutable $started,
        public int $seconds,
    ) {
    }

    /**
     * Les saisies d'une journée, dans l'ordre du jour. Une pause n'en est jamais une.
     *
     * @return list<self>
     */
    public static function ofDay(Grid $grid, \DateTimeImmutable $date, UserCalendar $calendar): array
    {
        /** @var array<string, array{string, ?string, int, int}> $groups ticket, commentaire, premier quart d'heure, secondes */
        $groups = [];
        foreach ($grid->blocks() as $block) {
            $ticket = $block->content->ticket;
            if (null === $ticket) {
                continue;
            }

            $key = $ticket."\0".$block->content->comment;
            $groups[$key] ??= [$ticket, $block->content->comment, $block->start, 0];
            $groups[$key][3] += $block->minutes() * 60;
        }

        return array_values(array_map(
            static fn (array $group): self => new self($group[0], $group[1], $calendar->at($date, $group[2]), $group[3]),
            $groups,
        ));
    }

    /** Le même ticket, le même commentaire, la même heure et le même temps. */
    public function sameAs(self $other): bool
    {
        return $this->ticket === $other->ticket
            && $this->comment === $other->comment
            && $this->started->getTimestamp() === $other->started->getTimestamp()
            && $this->seconds === $other->seconds;
    }

    /**
     * Deux listes de saisies qui disent la même chose, dans n'importe quel ordre.
     *
     * @param list<self> $one
     * @param list<self> $other
     */
    public static function sameList(array $one, array $other): bool
    {
        if (\count($one) !== \count($other)) {
            return false;
        }

        foreach ($one as $worklog) {
            $index = array_find_key($other, static fn (self $candidate): bool => $candidate->sameAs($worklog));
            if (null === $index) {
                return false;
            }
            unset($other[$index]);
        }

        return true;
    }

    /**
     * @return array{ticket: string, comment: ?string, started: string, seconds: int}
     */
    public function toArray(): array
    {
        return ['ticket' => $this->ticket, 'comment' => $this->comment, 'started' => $this->started->format(self::STARTED), 'seconds' => $this->seconds];
    }

    /**
     * Des saisies gardées en base ; ce qui ne se lit pas est ignoré, et ne fait que
     * rendre la journée « modifiée depuis l'envoi ».
     *
     * @return list<self>
     */
    public static function listFrom(mixed $data): array
    {
        $worklogs = [];
        foreach (\is_array($data) ? $data : [] as $item) {
            $ticket = \is_array($item) ? ($item['ticket'] ?? null) : null;
            $comment = \is_array($item) ? ($item['comment'] ?? null) : null;
            $started = \is_array($item) && \is_string($item['started'] ?? null) ? \DateTimeImmutable::createFromFormat(self::STARTED, $item['started']) : false;
            $seconds = \is_array($item) ? ($item['seconds'] ?? null) : null;

            if (\is_string($ticket) && (null === $comment || \is_string($comment)) && false !== $started && \is_int($seconds)) {
                $worklogs[] = new self($ticket, $comment, $started, $seconds);
            }
        }

        return $worklogs;
    }

    /**
     * @param list<self> $worklogs
     *
     * @return list<string> leurs tickets, chacun une fois
     */
    public static function ticketsOf(array $worklogs): array
    {
        return array_values(array_unique(array_map(static fn (self $worklog): string => $worklog->ticket, $worklogs)));
    }
}
