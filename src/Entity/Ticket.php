<?php

namespace App\Entity;

use App\Api\Input\EntryText;
use App\Day\UserCalendar;
use App\Repository\TicketRepository;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Uid\Uuid;

/**
 * Un ticket que DayTrack connaît : son titre et son type, tels que Jira les a
 * décrits la dernière fois.
 *
 * Un ticket enregistré quand Jira ne répondait pas, ou refusait le jeton, n'a encore
 * ni titre ni type : le bloc garde l'identifiant seul jusqu'à ce que Jira réponde.
 * La base refuse elle-même deux lignes pour le même ticket.
 */
#[ORM\Entity(repositoryClass: TicketRepository::class)]
class Ticket
{
    /** La longueur d'un titre de Jira. */
    public const int TITLE_MAX = 255;

    #[ORM\Id]
    #[ORM\Column(type: UuidType::NAME)]
    public private(set) Uuid $id;

    #[ORM\Column(name: 'ticket_key', length: EntryText::TICKET_MAX, unique: true)]
    public private(set) string $key;

    #[ORM\Column(length: self::TITLE_MAX, nullable: true)]
    public private(set) ?string $title = null;

    #[ORM\ManyToOne]
    #[ORM\JoinColumn(onDelete: 'SET NULL')]
    public private(set) ?IssueType $type = null;

    /**
     * Quand Jira l'a décrit pour la dernière fois, en heure universelle ; null tant
     * qu'il ne l'a jamais fait, ou que le site a changé.
     */
    #[ORM\Column(type: Types::DATETIME_IMMUTABLE, nullable: true)]
    public private(set) ?\DateTimeImmutable $readAt = null;

    public function __construct(string $key)
    {
        $this->id = Uuid::v7();
        $this->key = $key;
    }

    public function describe(string $title, IssueType $type, \DateTimeImmutable $at): void
    {
        $this->title = mb_substr($title, 0, self::TITLE_MAX);
        $this->type = $type;
        $this->readAt = UserCalendar::universal($at);
    }

    /** Le titre que la v1 gardait : il s'affiche en attendant que Jira le redise. */
    public function remember(string $title): void
    {
        $this->title = mb_substr($title, 0, self::TITLE_MAX);
    }

    /** Jira l'a cherché sans le trouver : il garde ce qu'il avait, et n'est pas redemandé tout de suite. */
    public function checked(\DateTimeImmutable $at): void
    {
        $this->readAt = UserCalendar::universal($at);
    }

    /** Le Jira relié ne le connaît pas, et ce qu'on en savait venait d'un autre : rien n'en reste. */
    public function forgetDescription(): void
    {
        $this->title = null;
        $this->type = null;
    }

    /**
     * @return array{title: ?string, type: ?string, color: ?string}
     */
    public function toArray(): array
    {
        return ['title' => $this->title, 'type' => $this->type?->name, 'color' => $this->type?->color->value];
    }
}
