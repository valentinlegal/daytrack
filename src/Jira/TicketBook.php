<?php

namespace App\Jira;

use App\Database\LockedTransaction;
use App\Entity\IssueType;
use App\Entity\Ticket;
use App\Repository\IssueTypeRepository;
use App\Repository\TicketRepository;
use App\Settings\Tint;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Clock\ClockInterface;

/**
 * Les tickets que DayTrack connaît, et ce que Jira en dit.
 *
 * Le titre et le type d'un ticket viennent de Jira et se gardent : l'écran les montre
 * sans attendre Jira, et les relit quand ils ont plus d'une heure. Un ticket tapé se
 * vérifie dans Jira avant d'entrer dans une saisie ou un favori : introuvable, il est
 * refusé ; Jira muet, jeton refusé ou DayTrack pas encore relié, il passe sans titre,
 * et sera vérifié à l'envoi.
 */
final readonly class TicketBook
{
    /** Au-delà, un titre se relit dans Jira à l'ouverture d'une journée. */
    private const string FRESHNESS = '-1 hour';

    /** Ce qu'une relecture demande à Jira, au plus : une journée et ses favoris y tiennent. */
    public const int REFRESH_MAX = 50;

    public function __construct(
        private TicketRepository $tickets,
        private IssueTypeRepository $types,
        private EntityManagerInterface $entityManager,
        private LockedTransaction $transaction,
        private JiraLink $link,
        private JiraClient $jira,
        private ClockInterface $clock,
    ) {
    }

    /**
     * Ce que DayTrack sait de ces tickets, pour l'écran : sans appeler Jira, et sans
     * rien écrire.
     *
     * @param list<string> $keys
     *
     * @return array<string, array{title: ?string, type: ?string, color: ?string}>
     */
    public function describe(array $keys): array
    {
        return array_map(static fn (Ticket $ticket): array => $ticket->toArray(), $this->tickets->byKeys($keys));
    }

    /**
     * Ce que Jira dit d'un ticket qu'on tape : décrit depuis moins d'une heure, il se
     * lit sans appeler Jira.
     */
    public function lookup(string $key): TicketLookup
    {
        $known = $this->tickets->byKeys([$key])[$key] ?? null;

        if (null !== $known && null !== $known->title && $this->isFresh($known)) {
            return TicketLookup::found($known);
        }

        [$credentials, $askedOf] = $this->asking();

        if (!$credentials instanceof JiraCredentials) {
            return TicketLookup::failed($credentials ?? JiraFailure::Unreachable, $known);
        }

        $answer = $this->jira->issue($credentials, $key);
        $this->link->record($answer);
        $stored = $this->store([$key => $answer], askedOf: $askedOf)[$key] ?? $known;

        return $answer instanceof JiraIssue && null !== $stored
            ? TicketLookup::found($stored)
            : TicketLookup::failed($answer instanceof JiraFailure ? $answer : JiraFailure::Unreachable, $stored);
    }

    /**
     * Les tickets qu'une écriture veut poser : ceux que Jira dit inexistants, qu'elle
     * doit refuser.
     *
     * Seul un ticket nouveau se vérifie : un ticket que DayTrack a déjà accepté, ou
     * qu'une saisie ou un favori porte déjà, passe sans appel. Agrandir un bloc, changer
     * son commentaire ou annuler sa suppression n'attend jamais Jira, et n'est jamais
     * refusé par lui. Un ticket nouveau se demande à Jira ; s'il ne répond pas, le ticket
     * passe, sans titre, et sera vérifié à l'envoi.
     *
     * @param list<string> $keys
     * @param bool         $describedOnly accepté sans que Jira l'ait jamais décrit, et plus
     *                                    rien ne le portant, un ticket se redemande : rien
     *                                    d'annulé n'attend ici, et Jira a pu revenir
     *
     * @return list<string>
     */
    public function verify(array $keys, bool $describedOnly = false): array
    {
        $keys = array_values(array_unique($keys));
        $known = array_keys(array_filter(
            $this->tickets->byKeys($keys),
            static fn (Ticket $ticket): bool => !$describedOnly || null !== $ticket->title,
        ));
        $inUse = $this->tickets->inUse($keys);
        $unknown = array_values(array_filter(
            $keys,
            static fn (string $key): bool => !\in_array($key, $known, true) && !\in_array($key, $inUse, true),
        ));

        if ([] === $unknown) {
            return [];
        }

        [$credentials, $askedOf] = $this->asking();
        $answers = $credentials instanceof JiraCredentials
            ? $this->jira->issues($credentials, $unknown)
            : array_fill_keys($unknown, $credentials ?? JiraFailure::Unreachable);

        $this->learnFrom($answers);
        $this->store($answers, pending: true, askedOf: $askedOf);

        return array_keys(array_filter($answers, static fn (JiraIssue|JiraFailure $answer): bool => JiraFailure::NotFound === $answer));
    }

    /**
     * Relit dans Jira ceux de ces tickets dont le titre a plus d'une heure, ou n'est
     * jamais venu. Rend ce que Jira reproche au jeton enregistré, une fois la relecture
     * faite : l'écran y règle son bandeau.
     *
     * @param list<string> $keys
     */
    public function refresh(array $keys): ?JiraFailure
    {
        $known = $this->tickets->byKeys($keys);
        $stale = array_values(array_filter(
            array_unique($keys),
            fn (string $key): bool => !isset($known[$key]) || !$this->isFresh($known[$key]),
        ));

        if ([] === $stale) {
            return $this->refusal();
        }

        [$credentials, $askedOf] = $this->asking();

        if (!$credentials instanceof JiraCredentials) {
            return $credentials;
        }

        $answers = $this->jira->issues($credentials, \array_slice($stale, 0, self::REFRESH_MAX));
        $this->learnFrom($answers);
        $this->store($answers, askedOf: $askedOf);

        return $this->refusal();
    }

    /** Ce que Jira reproche au jeton enregistré, d'après le dernier appel qui l'a dit. */
    public function refusal(): ?JiraFailure
    {
        return $this->link->current()?->refusal;
    }

    /**
     * De quoi demander à Jira, et le Jira à qui la question part : ses réponses ne valent
     * que pour lui (store()).
     *
     * @return array{JiraCredentials|JiraFailure|null, ?string}
     */
    private function asking(): array
    {
        return [$this->link->credentials(), $this->link->current()?->instance];
    }

    /**
     * Ce que des réponses apprennent du jeton : la première qui en dit quelque chose — un
     * ticket lu, ou un refus du jeton. Un ticket introuvable ou un Jira muet n'en disent rien.
     *
     * @param array<string, JiraIssue|JiraFailure> $answers
     */
    private function learnFrom(array $answers): void
    {
        foreach ($answers as $answer) {
            if ($answer instanceof JiraIssue || $answer->isTokenRefusal()) {
                $this->link->record($answer);

                return;
            }
        }
    }

    private function isFresh(Ticket $ticket): bool
    {
        return null !== $ticket->readAt && $ticket->readAt > $this->clock->now()->modify(self::FRESHNESS);
    }

    /**
     * Garde ce que Jira a répondu : un ticket décrit prend son titre et son type, un
     * ticket introuvable déjà connu garde les siens — sauf s'ils venaient d'un autre
     * Jira que celui qui est relié. Avec $pending, un ticket dont Jira n'a rien pu dire
     * entre sans titre, pour être relu plus tard.
     *
     * Des réponses d'un Jira qui n'est plus celui qui est relié — on en a relié un autre
     * pendant qu'il répondait — ne disent rien de ce Jira-ci : elles valent un Jira muet.
     *
     * @param array<string, JiraIssue|JiraFailure> $answers
     * @param ?string                              $askedOf le Jira à qui elles ont été demandées
     *
     * @return array<string, Ticket>
     */
    private function store(array $answers, bool $pending = false, ?string $askedOf = null): array
    {
        // Sous le verrou, deux onglets n'insèrent pas le même ticket.
        return $this->transaction->run($this->tickets, function () use ($answers, $pending, $askedOf): array {
            $tickets = $this->tickets->byKeys(array_keys($answers));
            $now = $this->clock->now();
            $instance = $this->link->current()?->instance;
            if ($instance !== $askedOf) {
                $answers = array_map(static fn (): JiraFailure => JiraFailure::Unreachable, $answers);
            }
            // Les types de cet enregistrement : deux tickets d'un même type nouveau n'en
            // créent qu'un, la base n'étant relue qu'une fois tout écrit.
            $types = [];

            foreach ($answers as $key => $answer) {
                $ticket = $tickets[$key] ?? null;

                if ($answer instanceof JiraIssue) {
                    if (null === $instance) {
                        throw new \LogicException('Jira a décrit un ticket sans être relié.');
                    }
                    $ticket ??= $this->create($key);
                    $type = $types[$answer->type->id] ??= $this->typeOf($instance, $answer->type, $types);
                    $type->describe($answer->type);
                    $ticket->describe($answer->title, $type, $now);
                } elseif (JiraFailure::NotFound === $answer) {
                    if (null !== $ticket?->type && $ticket->type->instance !== $instance) {
                        $ticket->forgetDescription();
                    }
                    $ticket?->checked($now);
                } elseif ($pending) {
                    $ticket ??= $this->create($key);
                }

                if (null !== $ticket) {
                    $tickets[$key] = $ticket;
                }
            }

            return $tickets;
        });
    }

    private function create(string $key): Ticket
    {
        $ticket = new Ticket($key);
        $this->entityManager->persist($ticket);

        return $ticket;
    }

    /**
     * Le type que DayTrack garde pour ce type de ce Jira, créé s'il ne le connaît pas
     * encore, avec sa teinte de départ.
     *
     * @param array<string, IssueType> $created ceux que cet enregistrement vient de créer, pas encore dans la base
     */
    private function typeOf(string $instance, JiraIssueType $described, array $created): IssueType
    {
        $type = $this->types->byJiraId($instance, $described->id);

        if (null === $type) {
            $taken = [...$this->types->tintsOf($instance), ...array_map(static fn (IssueType $type): Tint => $type->color, array_values($created))];
            $type = new IssueType($instance, $described, Tint::forNewType($described->name, $taken));
            $this->entityManager->persist($type);
        }

        return $type;
    }
}
