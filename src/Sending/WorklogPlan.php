<?php

namespace App\Sending;

use App\Jira\JiraWorklog;
use App\Jira\WorklogWrite;

/**
 * Ce qu'il faut écrire dans Jira pour qu'un ticket y ait, pour ce jour, exactement les
 * saisies de la journée : rien de plus que ce qui a changé.
 *
 * Les saisies s'apparient d'abord à l'identique, puis par commentaire, puis dans
 * l'ordre du jour. Une saisie déjà dans Jira est corrigée sur place, jamais retirée puis
 * recréée : elle garde son identifiant, et seul ce qui change s'inscrit dans
 * l'historique du ticket. Ce qui manque s'ajoute, ce qui est en trop se retire.
 */
final readonly class WorklogPlan
{
    /**
     * @param list<WorklogWrite> $writes
     */
    private function __construct(public array $writes)
    {
    }

    /**
     * @param list<Worklog>     $wanted   celles de la journée pour ce ticket
     * @param list<JiraWorklog> $existing celles de l'utilisateur dans Jira, ce jour, sur ce ticket
     */
    public static function between(array $wanted, array $existing): self
    {
        usort($wanted, static fn (Worklog $one, Worklog $other): int => $one->started <=> $other->started);
        usort($existing, static fn (JiraWorklog $one, JiraWorklog $other): int => [$one->started, (int) $one->id] <=> [$other->started, (int) $other->id]);

        $pairs = [];
        foreach ([self::identical(...), self::sameComment(...), static fn (): bool => true] as $matches) {
            foreach ($wanted as $w => $worklog) {
                $e = array_find_key($existing, static fn (JiraWorklog $candidate): bool => $matches($worklog, $candidate));
                if (null !== $e) {
                    $pairs[] = [$worklog, $existing[$e]];
                    unset($wanted[$w], $existing[$e]);
                }
            }
        }

        $writes = [];
        // Retirer d'abord rend du reste à faire, que les ajouts reprennent : Jira ne le
        // fait jamais descendre sous zéro.
        foreach ($existing as $extra) {
            $writes[] = WorklogWrite::delete($extra);
        }
        foreach ($pairs as [$worklog, $jira]) {
            if (!self::identical($worklog, $jira)) {
                $writes[] = WorklogWrite::update($jira, $worklog->started, $worklog->seconds, $worklog->comment);
            }
        }
        foreach ($wanted as $missing) {
            $writes[] = WorklogWrite::add($missing->ticket, $missing->started, $missing->seconds, $missing->comment);
        }

        return new self($writes);
    }

    public function isEmpty(): bool
    {
        return [] === $this->writes;
    }

    /**
     * Jira a exactement ce que la journée veut pour ce ticket : rien à écrire.
     *
     * @param list<Worklog>     $wanted
     * @param list<JiraWorklog> $existing
     */
    public static function matches(array $wanted, array $existing): bool
    {
        return self::between($wanted, $existing)->isEmpty();
    }

    private static function identical(Worklog $worklog, JiraWorklog $jira): bool
    {
        return $worklog->started->getTimestamp() === $jira->started->getTimestamp()
            && $worklog->seconds === $jira->seconds
            && $worklog->comment === $jira->comment;
    }

    private static function sameComment(Worklog $worklog, JiraWorklog $jira): bool
    {
        return $worklog->comment === $jira->comment;
    }
}
