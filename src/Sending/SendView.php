<?php

namespace App\Sending;

use App\Day\UserCalendar;
use App\Entity\DaySend;
use App\Jira\JiraFailure;

/**
 * L'envoi d'une journée tel que l'écran le montre : l'état du bouton, l'heure du
 * dernier envoi, et ce que le dernier essai a donné, ticket par ticket.
 */
final readonly class SendView
{
    /**
     * @param array<string, ?TicketFailure> $outcomes ceux du dernier essai, quand il n'a pas tout envoyé
     * @param list<string>                  $removed  les tickets retirés de la journée : dont Jira a peut-être encore des heures, ou, une journée envoyée, dont le dernier envoi les a retirées
     * @param array<string, int>            $inJira   ce que la relecture a trouvé sur un ticket qui n'est pas arrivé tel quel, en secondes
     */
    private function __construct(
        public SendState $state,
        /** Dans le fuseau de l'utilisateur. */
        public ?\DateTimeImmutable $sentAt,
        public ?\DateTimeImmutable $attemptedAt,
        public ?JiraFailure $failure,
        public array $outcomes,
        public array $removed,
        public array $inJira,
    ) {
    }

    /**
     * @param list<Worklog> $worklogs les saisies de la journée telle qu'elle est
     */
    public static function of(?DaySend $send, array $worklogs, \DateTimeImmutable $now, UserCalendar $calendar): self
    {
        $state = SendState::of($send, $worklogs, $now);
        $failed = \in_array($state, [SendState::Partial, SendState::Unverified, SendState::Failed], true);
        $current = Worklog::ticketsOf($worklogs);

        return new self(
            $state,
            null === $send?->sentAt ? null : $calendar->local($send->sentAt),
            null === $send?->attemptedAt ? null : $calendar->local($send->attemptedAt),
            $failed ? $send?->failure : null,
            $failed && null !== $send ? $send->outcomes() : [],
            match (true) {
                SendState::Sent === $state => $send?->retired() ?? [],
                // Le résultat montre aussi ce que cet essai a retiré de Jira.
                $failed => array_values(array_unique(array_diff([...$send->touched ?? [], ...array_map('strval', array_keys($send?->outcomes() ?? []))], $current))),
                default => array_values(array_diff($send->touched ?? [], $current)),
            },
            $failed && null !== $send ? $send->inJira() : [],
        );
    }

    /**
     * @return array{
     *     state: string,
     *     sentAt: ?array{date: string, time: string},
     *     attemptedAt: ?array{date: string, time: string},
     *     failure: ?string,
     *     outcomes: object,
     *     removed: list<string>,
     *     inJira: object,
     * }
     */
    public function toArray(): array
    {
        return [
            'state' => $this->state->value,
            'sentAt' => self::moment($this->sentAt),
            'attemptedAt' => self::moment($this->attemptedAt),
            'failure' => $this->failure?->value,
            // Un objet même vide : le navigateur y cherche un ticket par son identifiant.
            'outcomes' => (object) array_map(static fn (?TicketFailure $failure): ?string => $failure?->value, $this->outcomes),
            'removed' => $this->removed,
            'inJira' => (object) array_map(static fn (int $seconds): int => (int) round($seconds / 60), $this->inJira),
        ];
    }

    /**
     * @return ?array{date: string, time: string}
     */
    private static function moment(?\DateTimeImmutable $at): ?array
    {
        return null === $at ? null : ['date' => $at->format('Y-m-d'), 'time' => $at->format('H:i')];
    }
}
