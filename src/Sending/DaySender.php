<?php

namespace App\Sending;

use App\Database\LockedTransaction;
use App\Day\DayVersion;
use App\Day\SlotContent;
use App\Day\StaleDay;
use App\Day\UserCalendar;
use App\Entity\Day;
use App\Entity\DaySend;
use App\Entity\Recurrence;
use App\Jira\JiraClient;
use App\Jira\JiraCredentials;
use App\Jira\JiraFailure;
use App\Jira\JiraLink;
use App\Jira\JiraWorklog;
use App\Jira\WorklogWrite;
use App\Jira\WriteOutcome;
use App\Recurrence\RecurrenceForecast;
use App\Recurrence\RecurrencePoser;
use App\Repository\DayRepository;
use App\Repository\DaySendRepository;
use App\Repository\RecurrenceRepository;
use App\Settings\UserSettings;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Clock\ClockInterface;

/**
 * Envoie une journée sur Jira, et ne la dit envoyée qu'une fois Jira relu.
 *
 * L'envoi remplace les heures de l'utilisateur ce jour-là, et seulement les siennes,
 * sur les tickets de la journée et ceux où DayTrack a déjà écrit pour ce jour. Il ne
 * change que ce qui diffère (WorklogPlan) : un envoi qui ne change rien n'écrit rien,
 * et Jira n'est jamais vidé en cours de route. Une écriture restée sans réponse a pu
 * passer : le prochain essai relit son ticket avant de le compléter, jamais à l'aveugle.
 */
final readonly class DaySender
{
    /**
     * Le temps qu'un envoi peut prendre, en secondes : chaque appel à Jira s'arrête au
     * bout de dix, et un envoi fait une lecture, deux vagues d'écritures quatre à quatre
     * — avec les attentes que Jira demande —, puis une relecture.
     */
    public const int TIME_LIMIT = 120;

    public function __construct(
        private EntityManagerInterface $entityManager,
        private LockedTransaction $transaction,
        private DayRepository $days,
        private DaySendRepository $sends,
        private JiraLink $link,
        private JiraClient $jira,
        private UserCalendar $calendar,
        private ClockInterface $clock,
        private RecurrencePoser $poser,
        private RecurrenceForecast $forecast,
        private UserSettings $settings,
        private SendClosure $closure,
        private RecurrenceRepository $recurrences,
    ) {
    }

    /**
     * Envoie la journée telle que l'écran l'a vue, en version $version, et garde ce que
     * l'envoi a donné.
     *
     * @throws StaleDay       la journée a changé depuis, dans un autre onglet
     * @throws NothingToSend
     * @throws AlreadySending
     * @throws NotLinked
     */
    public function send(\DateTimeImmutable $date, int $version): void
    {
        // Ce qui part est ce que la journée montre, ce qu'elle a reçu le jour venu compris.
        $this->poser->pose();
        // Repris de la v1, le compte n'est pas encore connu, et les heures à remplacer se
        // reconnaissent à lui : Jira doit le dire avant que quoi que ce soit parte.
        $confirmation = null;
        if (false === $this->link->current()?->isConfirmed()) {
            $confirmation = $this->link->check();
            $this->entityManager->clear();
        }

        [$send, $worklogs, $before] = $this->begin($date, $version);

        // Le compte se relit à chaque lecture : relié à un autre depuis que l'envoi est
        // pris, dans un autre onglet, rien ne part sous un compte que cet envoi ne connaît
        // pas, et il n'a rien à retenir. L'écran relit la journée, sous le compte relié.
        $credentials = $this->link->credentials();
        $jira = $this->link->current();
        if (null === $jira || !$send->belongsTo($jira)) {
            $this->finish($send, static function (DaySend $send): void {
                $send->abandon();
            });
            $this->entityManager->clear();

            throw new StaleDay();
        }

        if (!$jira->isConfirmed()) {
            $credentials = $confirmation instanceof JiraFailure ? $confirmation : JiraFailure::Unreachable;
        }

        try {
            $delivery = $this->deliver($send, $credentials, $jira->accountId, $date, $worklogs, $before);
        } catch (\Throwable $exception) {
            $this->finish($send, static function (DaySend $send): void {
                $send->release();
            });

            throw $exception;
        }

        $now = $this->clock->now();
        $delivery = self::withWhatJiraMayHold($delivery, $send, $worklogs, $before, $now);
        $this->finish($send, function (DaySend $send) use ($date, $delivery, $worklogs, $before, $now): void {
            if (!$delivery->isComplete()) {
                $send->fail(
                    $delivery->result(),
                    $worklogs,
                    $delivery->outcomes,
                    $delivery->failure,
                    // Un ticket retiré que Jira, relu, n'a plus ne se retirera pas deux fois. Celui
                    // qu'il ne trouve plus se relira au prochain essai : c'est l'envoi complet qui
                    // le dira.
                    array_values(array_diff([...$before, ...$delivery->written], $delivery->retired($worklogs))),
                    [] !== $delivery->written,
                    $delivery->inJira,
                    $delivery->vanished,
                    $now,
                );
            } else {
                // Une journée vidée dont Jira ne trouve plus un ticket garde de quoi le dire.
                $send->succeed($worklogs, $delivery->retired($worklogs), $delivery->vanished, $now);
            }
            // Une journée vidée, et Jira vidé avec elle — ou qu'un essai sans rien écrire a laissée
            // vide, pendant qu'on la vidait ailleurs — : son envoi n'a plus rien à en dire. Sans
            // envoi sous aucun compte, elle redevient une journée comme une autre (SendClosure).
            $day = $this->days->findWithSlots($date);
            if (null !== $day) {
                $this->entityManager->refresh($day);
                // Lues avant l'appel à Jira, leurs fins ont pu changer depuis dans un autre onglet.
                $this->recurrences->refreshAll();
                // L'envoi en cours la fermait : il avait au moins un ticket où écrire.
                $this->closure->reopen($day, true, true);
            }
        });

        // La journée a pu changer pendant l'envoi, dans un autre onglet : ce qui suit la
        // relit dans la base, pas dans la mémoire de cette requête.
        $this->entityManager->clear();
    }

    /**
     * Prend l'envoi de la journée, d'un seul tenant : la journée est celle qu'a vue
     * l'écran, et aucun autre envoi ne part en même temps. Un jour à venir y reçoit ses
     * fois prévues pour de bon : ce qui part est ce que la journée montre, et ce que la
     * relecture comparera. Il les a reçues pour de bon, comme le jour venu : une récurrence
     * qui naît, change ou s'étend ensuite ne le change plus, que l'envoi aboutisse ou non, tant
     * qu'un envoi y a quelque chose à dire (DaySendRepository::closesToRecurrences).
     *
     * @return array{DaySend, list<Worklog>, list<string>} l'envoi, les saisies de la journée, et les tickets touchés avant lui
     */
    private function begin(\DateTimeImmutable $date, int $version): array
    {
        $jira = $this->link->current();
        if (null === $jira) {
            throw new NotLinked();
        }

        return $this->transaction->run($this->days, function () use ($date, $version, $jira): array {
            $day = $this->days->findWithSlots($date);
            if (null !== $day) {
                $this->entityManager->refresh($day);
            }
            // Les récurrences aussi : ce que la journée prévoit, et les flèches qu'elle montre, se
            // jugent sur leurs fins du moment.
            $this->recurrences->refreshAll();
            $planned = $this->forecast->on($day, $date);
            if (DayVersion::of($day, $planned) !== $version) {
                throw new StaleDay();
            }
            if ([] !== $planned) {
                $day = $this->pose($day, $date, $planned);
            }
            if (null === $day) {
                throw new NothingToSend();
            }

            $worklogs = Worklog::ofDay($day->grid(), $day->date, $this->calendar);
            $send = $this->sends->forDate($date, $jira);

            if (null === $send) {
                if ([] === $worklogs) {
                    throw new NothingToSend();
                }
                $send = new DaySend($day, $jira);
                $this->entityManager->persist($send);
                $this->entityManager->flush();
            } elseif ([] === $worklogs && [] === $send->touched) {
                throw new NothingToSend();
            }

            $now = $this->clock->now();
            // Le nouvel envoi efface la trace d'un envoi interrompu : elle se lit avant.
            $interrupted = null === $send->sent($now);
            if (!$this->sends->claim($send, $now)) {
                throw new AlreadySending();
            }

            $this->entityManager->refresh($send);
            $before = $send->touched;
            $send->begin(Worklog::ticketsOf($worklogs), $now, $interrupted);

            return [$send, $worklogs, $before];
        });
    }

    /**
     * Pose les fois prévues d'un jour à venir, liées à leur récurrence, comme le poseur le
     * jour venu : la journée change, et l'onglet qui ne l'a pas vue reçoit le refus habituel.
     *
     * @param array<int, Recurrence> $planned
     */
    private function pose(?Day $day, \DateTimeImmutable $date, array $planned): Day
    {
        if (null === $day) {
            // Lu sous le verrou, comme à la naissance de toute journée.
            $day = new Day($date, $this->settings->habitualObjective());
            $this->entityManager->persist($day);
        } else {
            $this->days->advance($date);
            $this->entityManager->refresh($day);
            if ($day->followsHabitual()) {
                // Vide et sans objectif choisi, elle reprend l'habituel du moment avant de se remplir.
                $day->objective = $this->settings->habitualObjective();
            }
        }
        $day->change(array_map(static fn (Recurrence $recurrence): SlotContent => $recurrence->content(), $planned), $planned);

        return $day;
    }

    /**
     * Lit Jira — les tickets de la journée, et ceux où DayTrack a déjà écrit ce jour sous
     * ce compte —, écrit ce qui diffère, puis relit ce qui a été écrit : c'est la relecture
     * qui dit si un ticket est arrivé, et ce que Jira en a gardé. Sans elle, DayTrack ne
     * sait pas : un ticket écrit se dit non vérifié, jamais non envoyé. Rien ne s'écrit deux
     * fois dans un même envoi. Une écriture restée sans réponse a pu être enregistrée après
     * la relecture : la compléter tout de suite risquerait un double. Le prochain essai
     * relit, puis complète.
     *
     * @param list<Worklog> $worklogs
     * @param list<string>  $before   les tickets où DayTrack a pu écrire avant cet envoi
     */
    private function deliver(DaySend $send, JiraCredentials|JiraFailure|null $credentials, string $accountId, \DateTimeImmutable $date, array $worklogs, array $before): Delivery
    {
        if (!$credentials instanceof JiraCredentials) {
            return Delivery::failed($credentials ?? JiraFailure::Refused);
        }

        $tickets = $send->touched;

        /** @var array<string, list<Worklog>> $wanted la journée d'abord, puis ce qu'elle a quitté */
        $wanted = array_fill_keys([...Worklog::ticketsOf($worklogs), ...$tickets], []);
        foreach ($worklogs as $worklog) {
            $wanted[$worklog->ticket][] = $worklog;
        }

        [$from, $to] = $this->calendar->bounds($date);
        $read = $this->jira->worklogs($credentials, $accountId, array_keys($wanted), $from, $to);

        if (null !== ($refusal = self::tokenRefusal($read))) {
            return $this->refused($send, $refusal);
        }

        // Rien n'a pu se lire : Jira ne répond pas, et rien n'est parti.
        if ([] === array_filter($read, static fn (array|JiraFailure $found): bool => \is_array($found))
            && [] !== array_filter($read, static fn (array|JiraFailure $found): bool => JiraFailure::Unreachable === $found)) {
            return Delivery::failed(JiraFailure::Unreachable);
        }

        /** @var array<string, ?TicketFailure> $outcomes */
        $outcomes = [];
        /** @var list<string> $vanished */
        $vanished = [];
        /** @var list<WorklogWrite> $writes */
        $writes = [];
        /** @var list<string> $owners le ticket de chaque écriture */
        $owners = [];

        foreach (array_keys($wanted) as $ticket) {
            $found = $read[$ticket] ?? JiraFailure::Unreachable;

            if (JiraFailure::NotFound === $found && [] === $wanted[$ticket]) {
                // Retiré de la journée, et Jira ne le trouve plus : supprimé, ou ce compte ne le
                // voit plus — Jira répond de même aux deux. Il ne retient pas la journée : rien
                // ne le ferait revenir. Mais ses heures sont peut-être restées, et l'écran le dit.
                $outcomes[$ticket] = null;
                $vanished[] = $ticket;
                continue;
            }

            if ($found instanceof JiraFailure) {
                // Illisible, un ticket déjà écrit ne se dit pas absent de Jira.
                $outcomes[$ticket] = JiraFailure::NotFound !== $found && \in_array($ticket, $before, true)
                    ? self::unverifiedFailure($send, $ticket, $worklogs)
                    : TicketFailure::fromJira($found);
                continue;
            }

            $plan = WorklogPlan::between($wanted[$ticket], $found);
            if ($plan->isEmpty()) {
                $outcomes[$ticket] = null;
                continue;
            }

            foreach ($plan->writes as $write) {
                $writes[] = $write;
                $owners[] = $ticket;
            }
        }

        /** @var array<string, true> $written les tickets où une écriture a pu changer Jira */
        $written = [];
        /** @var array<string, true> $accepted ceux dont Jira a accepté au moins une écriture */
        $accepted = [];
        /** @var array<string, true> $unknown ceux dont une écriture est restée sans réponse */
        $unknown = [];
        $refusal = null;

        // Ce qui rend du reste à faire part avant ce qui en prend : Jira ne le fait jamais
        // descendre sous zéro, et l'ordre changerait sinon ce qu'il en reste.
        foreach ([false, true] as $consumes) {
            $phase = array_keys(array_filter($writes, static fn (WorklogWrite $write): bool => $write->consumes === $consumes));
            if ([] === $phase) {
                continue;
            }

            $results = $this->jira->write($credentials, array_map(static fn (int $index): WorklogWrite => $writes[$index], $phase));

            // Tous les résultats se lisent, même après un refus du jeton : les écritures
            // parties ensemble ont pu passer, et aucune ne s'oublie.
            foreach ($results as $position => $result) {
                $ticket = $owners[$phase[$position]];

                match ($result) {
                    WriteOutcome::Done => $written[$ticket] = $accepted[$ticket] = true,
                    WriteOutcome::Unknown => $written[$ticket] = $unknown[$ticket] = true,
                    WriteOutcome::Rejected => $outcomes[$ticket] ??= TicketFailure::Rejected,
                    WriteOutcome::NotFound => $outcomes[$ticket] ??= TicketFailure::NotFound,
                    WriteOutcome::Throttled => $outcomes[$ticket] ??= TicketFailure::Throttled,
                    WriteOutcome::Refused, WriteOutcome::MissingScope => $refusal ??= $result->failure(),
                };
            }

            if (null !== $refusal) {
                break;
            }
        }

        // Tout ticket où une écriture a été tentée se relit : même refusée en partie, c'est
        // la relecture qui dit ce que Jira en a gardé.
        $check = array_values(array_unique($owners));
        $reread = null !== $refusal || [] === $check ? [] : $this->jira->worklogs($credentials, $accountId, $check, $from, $to);
        $refusal ??= self::tokenRefusal($reread);

        /** @var array<string, int> $inJira */
        $inJira = [];

        foreach ($check as $ticket) {
            $found = null === $refusal ? $reread[$ticket] ?? JiraFailure::Unreachable : $refusal;
            $reason = $outcomes[$ticket] ?? null;

            if ($found instanceof JiraFailure) {
                $outcomes[$ticket] = match (true) {
                    isset($accepted[$ticket]) => TicketFailure::Unverified,
                    isset($unknown[$ticket]) => TicketFailure::Unanswered,
                    null !== $reason => $reason,
                    default => TicketFailure::fromJira($found),
                };

                // La première lecture de cet envoi les a vues : Jira les garde.
                $first = $read[$ticket] ?? null;
                $seen = \is_array($first) ? self::secondsOf($first) : 0;
                if ($seen > 0 && !$outcomes[$ticket]->isUnverified()) {
                    $inJira[$ticket] = $seen;
                }
                continue;
            }

            if (WorklogPlan::matches($wanted[$ticket], $found)) {
                $outcomes[$ticket] = null;
                continue;
            }

            $has = self::secondsOf($found);

            // Une écriture sans réponse peut encore arriver : rien de relu ne dit qu'elle n'est pas partie.
            if (0 === $has && isset($unknown[$ticket]) && !isset($accepted[$ticket])) {
                $outcomes[$ticket] = TicketFailure::Unanswered;
                continue;
            }

            $outcomes[$ticket] = $reason ?? (isset($unknown[$ticket]) ? TicketFailure::Unreachable : TicketFailure::Mismatch);

            // Ce que Jira en a gardé. Rien du tout après un refus : la raison suffit.
            if ($has > 0 || TicketFailure::Mismatch === $outcomes[$ticket]) {
                $inJira[$ticket] = $has;
            }
        }

        // Rien n'est parti avant le refus du jeton : Jira n'a rien reçu de cet envoi.
        if (null !== $refusal && [] === $written) {
            return $this->refused($send, $refusal);
        }

        $rejected = array_keys(array_filter($outcomes, static fn (?TicketFailure $failure): bool => TicketFailure::Rejected === $failure));
        foreach (null !== $refusal || [] === $rejected ? [] : $this->jira->closed($credentials, array_map('strval', $rejected)) as $ticket) {
            $outcomes[$ticket] = TicketFailure::Closed;
        }

        // Chaque ticket a son résultat, dans l'ordre de la journée.
        $ordered = [];
        foreach (array_keys($wanted) as $ticket) {
            $ordered[$ticket] = \array_key_exists($ticket, $outcomes) ? $outcomes[$ticket] : TicketFailure::Mismatch;
        }

        if (null !== $refusal) {
            $this->record($send, $refusal);
        }

        return new Delivery($ordered, $refusal, array_map('strval', array_keys($written)), $inJira, $vanished);
    }

    /**
     * Un envoi arrêté avant d'écrire n'a rien envoyé, mais Jira peut garder ce qu'un envoi
     * d'avant y a laissé : l'écran ne dit pas Jira vide. Après un essai qui a pu écrire,
     * ses tickets restent non vérifiés. Après un envoi complet, on sait ce qu'il garde des
     * tickets retirés depuis de la journée.
     *
     * @param list<Worklog> $worklogs
     * @param list<string>  $before   les tickets où DayTrack a pu écrire avant cet envoi
     */
    private static function withWhatJiraMayHold(Delivery $delivery, DaySend $send, array $worklogs, array $before, \DateTimeImmutable $now): Delivery
    {
        if (SendResult::Failed !== $delivery->result() || [] === $before) {
            return $delivery;
        }

        $reason = TicketFailure::fromJira($delivery->failure ?? JiraFailure::Unreachable);
        $current = Worklog::ticketsOf($worklogs);
        $removed = array_values(array_diff($before, $current));
        // La v1 ne gardait pas ce qu'elle avait envoyé : ces heures-là ne se connaissent pas.
        $last = $send->sentByV1 ? null : $send->sent($now);

        $outcomes = [];
        $inJira = [];

        if (null === $last) {
            foreach ([...$current, ...$removed] as $ticket) {
                $outcomes[$ticket] = \in_array($ticket, $before, true) ? self::unverifiedFailure($send, $ticket, $worklogs) : $reason;
            }
        } else {
            foreach ($removed as $ticket) {
                $outcomes[$ticket] = $reason;
                $inJira[$ticket] = array_sum(array_map(static fn (Worklog $worklog): int => $worklog->ticket === $ticket ? $worklog->seconds : 0, $last));
            }
        }

        return new Delivery($outcomes, $delivery->failure, [], array_filter($inJira, static fn (int $seconds): bool => $seconds > 0));
    }

    /**
     * Un ticket déjà écrit, que cet envoi n'a pas pu relire : Jira n'a « accepté » que ce
     * que le dernier essai a dit accepté, sur cette journée-là.
     *
     * @param list<Worklog> $worklogs
     */
    private static function unverifiedFailure(DaySend $send, string $ticket, array $worklogs): TicketFailure
    {
        $outcomes = $send->outcomes();

        return Worklog::sameList($send->attempted(), $worklogs)
            && \array_key_exists($ticket, $outcomes)
            && TicketFailure::Unanswered !== $outcomes[$ticket]
                ? TicketFailure::Unverified
                : TicketFailure::Unanswered;
    }

    /**
     * @param list<JiraWorklog> $worklogs
     */
    private static function secondsOf(array $worklogs): int
    {
        return array_sum(array_map(static fn (JiraWorklog $worklog): int => $worklog->seconds, $worklogs));
    }

    /**
     * @param array<string, list<JiraWorklog>|JiraFailure> $read
     */
    private static function tokenRefusal(array $read): ?JiraFailure
    {
        foreach ($read as $found) {
            if ($found instanceof JiraFailure && $found->isTokenRefusal()) {
                return $found;
            }
        }

        return null;
    }

    /** Jira refuse le jeton avant que rien ne parte : Jira n'a rien reçu de cet envoi. */
    private function refused(DaySend $send, JiraFailure $refusal): Delivery
    {
        $this->record($send, $refusal);

        return Delivery::failed($refusal);
    }

    /** Jira refuse le jeton : le bandeau le dira aussi, et plus rien ne part. */
    private function record(DaySend $send, JiraFailure $refusal): void
    {
        // Le refus est celui du jeton de cet envoi : relié à un autre compte depuis, le
        // bandeau n'en dirait rien de juste.
        $jira = $this->link->current();
        if (null !== $jira && $send->belongsTo($jira)) {
            $this->link->record($refusal);
        }
    }

    /**
     * Garde ce que l'envoi a donné, d'un seul tenant, sur l'envoi tel qu'il est en base.
     *
     * @param \Closure(DaySend): void $record
     */
    private function finish(DaySend $send, \Closure $record): void
    {
        $this->transaction->run($this->sends, function () use ($send, $record): void {
            $current = $this->sends->find($send->id);
            if (null !== $current) {
                $this->entityManager->refresh($current);
                $record($current);
            }
        });
    }
}
