<?php

namespace App\Entity;

use App\Jira\JiraFailure;
use App\Repository\DaySendRepository;
use App\Sending\SendResult;
use App\Sending\TicketFailure;
use App\Sending\Worklog;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Uid\Uuid;

/**
 * L'envoi d'une journée sur Jira, tel que DayTrack le sait : ce qui est arrivé au
 * dernier envoi complet, ce qu'a donné le dernier essai s'il n'a pas tout envoyé, et
 * l'envoi en cours. « Envoyé », « non envoyé » et « modifié depuis l'envoi » s'en
 * déduisent (SendState) et survivent à un rechargement.
 *
 * Il appartient au Jira et au compte qui l'ont reçu : relié à un autre, DayTrack n'y a
 * jamais rien envoyé, et revenu au premier, il en retrouve l'état.
 */
#[ORM\Entity(repositoryClass: DaySendRepository::class)]
#[ORM\UniqueConstraint(columns: ['day_id', 'instance', 'account_id'])]
class DaySend
{
    /** Au-delà, un envoi en cours est tenu pour interrompu : le serveur a pu s'arrêter. */
    public const string SENDING_EXPIRES = '-5 minutes';

    #[ORM\Id]
    #[ORM\Column(type: UuidType::NAME)]
    public private(set) Uuid $id;

    #[ORM\ManyToOne]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    public private(set) Day $day;

    /**
     * Le Jira qui a reçu ce jour (JiraConnection::$instance). Vide pour un envoi d'avant
     * qu'on le retienne, qui n'appartient alors à aucun.
     */
    #[ORM\Column(length: 255, options: ['default' => ''])]
    public private(set) string $instance;

    /** Le compte sous lequel ce jour y est parti, à qui appartiennent ses heures. */
    #[ORM\Column(length: 128, options: ['default' => ''])]
    public private(set) string $accountId;

    /** La v1 l'avait envoyée, puis la journée a changé : elle ne gardait pas l'heure de cet envoi. */
    #[ORM\Column(options: ['default' => false])]
    public private(set) bool $sentByV1 = false;

    /** Le dernier envoi que la relecture a confirmé en entier ; null tant qu'aucun. */
    #[ORM\Column(type: Types::DATETIME_IMMUTABLE, nullable: true)]
    public private(set) ?\DateTimeImmutable $sentAt = null;

    /**
     * Les saisies que ce dernier envoi a laissées dans Jira ; null dès qu'un essai a pu y
     * écrire depuis, ou s'est interrompu : Jira ne se sait plus égal à rien, et seul un
     * envoi complet le redit.
     *
     * @var list<array{ticket: string, comment: ?string, started: string, seconds: int}>|null
     */
    #[ORM\Column(type: Types::JSON, nullable: true)]
    private ?array $sent = [];

    /**
     * Les tickets où DayTrack a pu écrire des heures de ce jour : l'envoi suivant les
     * relit, pour retirer ce qui n'est plus dans la journée.
     *
     * @var list<string>
     */
    #[ORM\Column(type: Types::JSON)]
    public private(set) array $touched = [];

    /** Le dernier essai, s'il n'a pas tout envoyé ; null après un envoi complet. */
    #[ORM\Column(length: 10, nullable: true, enumType: SendResult::class)]
    public private(set) ?SendResult $result = null;

    #[ORM\Column(type: Types::DATETIME_IMMUTABLE, nullable: true)]
    public private(set) ?\DateTimeImmutable $attemptedAt = null;

    /**
     * La journée que cet essai envoyait : modifiée depuis, elle rouvre la confirmation.
     *
     * @var list<array{ticket: string, comment: ?string, started: string, seconds: int}>
     */
    #[ORM\Column(type: Types::JSON)]
    private array $attempted = [];

    /**
     * Ce que cet essai a donné, ticket par ticket : null pour un ticket arrivé, sa raison
     * sinon, avec les secondes que la relecture a trouvées dans Jira quand elle les a dites.
     * Une journée envoyée y garde les tickets que cet envoi a retirés de Jira.
     *
     * @var array<string, string|array{failure: string, seconds: int}|null>
     */
    #[ORM\Column(type: Types::JSON)]
    private array $outcomes = [];

    /** Ce qui a tout arrêté : Jira muet, ou le jeton refusé. */
    #[ORM\Column(length: 20, nullable: true, enumType: JiraFailure::class)]
    public private(set) ?JiraFailure $failure = null;

    /** Un envoi part depuis cet instant ; un second attend qu'il ait fini. */
    #[ORM\Column(type: Types::DATETIME_IMMUTABLE, nullable: true)]
    public private(set) ?\DateTimeImmutable $sendingSince = null;

    /** Sans Jira relié, ce qui ne peut venir que de la v1, il n'appartient à aucun. */
    public function __construct(Day $day, ?JiraConnection $jira)
    {
        $this->id = Uuid::v7();
        $this->day = $day;
        $this->instance = $jira->instance ?? '';
        $this->accountId = $jira->accountId ?? '';
    }

    /**
     * Le dernier envoi de la v1 : elle le disait réussi, sans relire Jira. Sans heure
     * d'envoi, elle a été modifiée depuis, et seuls ses tickets restent.
     *
     * @param list<Worklog> $worklogs les saisies de la journée reprise
     * @param bool          $complete la journée reprise est celle qui a été envoyée
     * @param list<string>  $touched  les tickets du dernier envoi de la v1
     */
    public static function fromV1(Day $day, ?JiraConnection $jira, ?\DateTimeImmutable $sentAt, array $worklogs, bool $complete, array $touched): self
    {
        $send = new self($day, $jira);
        $send->sentByV1 = null === $sentAt;
        $send->touched = array_values(array_unique([...$touched, ...(null === $sentAt ? [] : Worklog::ticketsOf($worklogs))]));

        if (null !== $sentAt) {
            $send->sentAt = self::universal($sentAt);
            $send->sent = $complete ? array_map(static fn (Worklog $worklog): array => $worklog->toArray(), $worklogs) : null;
        }

        return $send;
    }

    public function belongsTo(JiraConnection $jira): bool
    {
        return $jira->instance === $this->instance && $jira->accountId === $this->accountId;
    }

    public function isSending(\DateTimeImmutable $now): bool
    {
        return null !== $this->sendingSince && $this->sendingSince > $now->modify(self::SENDING_EXPIRES);
    }

    /**
     * Ce que le dernier envoi complet a laissé dans Jira, s'il le décrit encore ; null
     * quand un essai a pu écrire depuis, ou qu'un envoi s'est arrêté en route — le serveur
     * a pu s'arrêter avec lui.
     *
     * @return list<Worklog>|null
     */
    public function sent(\DateTimeImmutable $now): ?array
    {
        $interrupted = null !== $this->sendingSince && !$this->isSending($now);

        return null === $this->sent || $interrupted ? null : Worklog::listFrom($this->sent);
    }

    /**
     * @return list<Worklog>
     */
    public function attempted(): array
    {
        return Worklog::listFrom($this->attempted);
    }

    /**
     * @return array<string, ?TicketFailure>
     */
    public function outcomes(): array
    {
        $outcomes = [];
        foreach ($this->outcomes as $ticket => $outcome) {
            $failure = \is_array($outcome) ? $outcome['failure'] : $outcome;
            $outcomes[$ticket] = null === $failure ? null : TicketFailure::tryFrom($failure) ?? TicketFailure::Mismatch;
        }

        return $outcomes;
    }

    /**
     * Ce que la relecture a trouvé dans Jira sur un ticket qui n'y est pas arrivé tel quel.
     *
     * @return array<string, int> en secondes
     */
    public function inJira(): array
    {
        $inJira = [];
        foreach ($this->outcomes as $ticket => $outcome) {
            if (\is_array($outcome)) {
                $inJira[$ticket] = $outcome['seconds'];
            }
        }

        return $inJira;
    }

    /**
     * Les tickets que le dernier envoi complet a retirés de Jira.
     *
     * @return list<string>
     */
    public function retired(): array
    {
        return null === $this->result ? array_map('strval', array_keys($this->outcomes)) : [];
    }

    /**
     * Un envoi part : ses tickets s'ajoutent à ceux que DayTrack a pu toucher avant
     * d'écrire quoi que ce soit, pour qu'un envoi interrompu ne fasse rien oublier.
     *
     * @param list<string> $tickets
     * @param bool         $interrupted l'envoi d'avant s'est arrêté en route
     */
    public function begin(array $tickets, \DateTimeImmutable $now, bool $interrupted = false): void
    {
        // L'envoi d'avant s'est arrêté en route : ce qu'il a laissé dans Jira ne se sait plus.
        if ($interrupted) {
            $this->sent = null;
        }

        $this->touched = array_values(array_unique([...$this->touched, ...$tickets]));
        $this->sendingSince = self::universal($now);
    }

    /**
     * Jira, relu, a exactement ces saisies : les tickets retirés de la journée n'y ont
     * plus rien.
     *
     * @param list<Worklog> $worklogs
     * @param list<string>  $retired  les tickets que cet envoi a retirés de Jira
     */
    public function succeed(array $worklogs, array $retired, \DateTimeImmutable $now): void
    {
        $this->sentAt = self::universal($now);
        $this->sent = array_map(static fn (Worklog $worklog): array => $worklog->toArray(), $worklogs);
        $this->touched = Worklog::ticketsOf($worklogs);
        $this->result = null;
        $this->attemptedAt = null;
        $this->attempted = [];
        $this->outcomes = array_fill_keys($retired, null);
        $this->failure = null;
        $this->sendingSince = null;
    }

    /**
     * @param list<Worklog>                 $worklogs
     * @param array<string, ?TicketFailure> $outcomes
     * @param list<string>                  $touched  ceux où DayTrack a pu écrire : avant cet essai, et pendant
     * @param bool                          $wrote    une écriture a pu changer Jira
     * @param array<string, int>            $inJira   les secondes que la relecture a trouvées
     */
    public function fail(SendResult $result, array $worklogs, array $outcomes, ?JiraFailure $failure, array $touched, bool $wrote, array $inJira, \DateTimeImmutable $now): void
    {
        if ($wrote) {
            $this->sent = null;
        }
        // Un ticket où rien n'est parti n'a pas d'heures de DayTrack : il ne retient pas
        // une journée vidée ensuite.
        $this->touched = array_values(array_unique($touched));
        $this->result = $result;
        $this->attemptedAt = self::universal($now);
        $this->attempted = array_map(static fn (Worklog $worklog): array => $worklog->toArray(), $worklogs);
        $this->outcomes = [];
        foreach ($outcomes as $ticket => $outcome) {
            $this->outcomes[$ticket] = null !== $outcome && isset($inJira[$ticket])
                ? ['failure' => $outcome->value, 'seconds' => $inJira[$ticket]]
                : $outcome?->value;
        }
        $this->failure = $failure;
        $this->sendingSince = null;
    }

    /** L'envoi pris ne part pas : rien n'a été écrit, rien ne change de ce qu'on savait. */
    public function abandon(): void
    {
        $this->sendingSince = null;
    }

    /** L'envoi s'arrête sans résultat à garder, sur une erreur imprévue : il a pu écrire. */
    public function release(): void
    {
        $this->sent = null;
        $this->sendingSince = null;
    }

    /** La base garde l'heure sans son fuseau : elle s'y écrit, et s'en relit, en heure universelle. */
    public static function universal(\DateTimeImmutable $at): \DateTimeImmutable
    {
        return $at->setTimezone(new \DateTimeZone('UTC'));
    }
}
