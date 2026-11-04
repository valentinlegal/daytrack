<?php

namespace App\Sending;

use App\Jira\JiraFailure;

/**
 * Ce qu'un envoi a donné : chaque ticket arrivé ou non, et pourquoi, ce que Jira en a
 * gardé quand la relecture l'a dit, et ce qui a tout arrêté.
 */
final readonly class Delivery
{
    /**
     * @param array<string, ?TicketFailure> $outcomes null pour un ticket que Jira, relu, a tel que la journée le dit
     * @param list<string>                  $written  les tickets où une écriture est partie : Jira a pu en garder des heures
     * @param array<string, int>            $inJira   les secondes que la relecture a trouvées sur un ticket qui n'est pas arrivé tel quel
     */
    public function __construct(
        public array $outcomes,
        public ?JiraFailure $failure = null,
        public array $written = [],
        public array $inJira = [],
    ) {
    }

    /** Rien n'est parti : Jira n'a rien reçu de cet envoi. */
    public static function failed(JiraFailure $failure): self
    {
        return new self([], $failure);
    }

    public function isComplete(): bool
    {
        return null === $this->failure && [] === array_filter($this->outcomes);
    }

    /** Ce que retient un envoi qui n'a pas tout envoyé. */
    public function result(): SendResult
    {
        foreach ($this->outcomes as $outcome) {
            if (true === $outcome?->isUnverified()) {
                return SendResult::Unverified;
            }
        }

        return null === $this->failure ? SendResult::Partial : SendResult::Failed;
    }

    /**
     * Les tickets que la journée a quittés, dont Jira, relu, n'a plus rien.
     *
     * @param list<Worklog> $worklogs
     *
     * @return list<string>
     */
    public function retired(array $worklogs): array
    {
        $arrived = array_keys(array_filter($this->outcomes, static fn (?TicketFailure $outcome): bool => null === $outcome));

        return array_values(array_diff(array_map('strval', $arrived), Worklog::ticketsOf($worklogs)));
    }
}
