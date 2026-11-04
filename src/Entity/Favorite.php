<?php

namespace App\Entity;

use App\Api\Input\EntryText;
use App\Repository\FavoriteRepository;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Uid\Uuid;

/**
 * Un ticket qu'on pose souvent, gardé sous la main dans la colonne de gauche.
 *
 * Il n'a ni commentaire ni durée : le déposer sur la grille n'y met que son ticket.
 * Son nom, s'il a été renommé, ne sert qu'à la liste et n'entre jamais dans une
 * saisie. La base refuse elle-même deux favoris pour le même ticket.
 */
#[ORM\Entity(repositoryClass: FavoriteRepository::class)]
class Favorite
{
    public const int NAME_MAX = 255;

    #[ORM\Id]
    #[ORM\Column(type: UuidType::NAME)]
    public private(set) Uuid $id;

    #[ORM\Column(length: EntryText::TICKET_MAX, unique: true)]
    public private(set) string $ticket;

    /** Ce que la liste affiche à la place du titre venu de Jira ; null, le titre. */
    #[ORM\Column(length: self::NAME_MAX, nullable: true)]
    public ?string $name;

    /** Sa place dans la liste, de 0 en haut à la fin sans trou : seul FavoriteWriter la change. */
    #[ORM\Column]
    public int $position;

    public function __construct(string $ticket, ?string $name, int $position)
    {
        $this->id = Uuid::v7();
        $this->ticket = $ticket;
        $this->name = $name;
        $this->position = $position;
    }

    /**
     * @return array{id: string, ticket: string, name: ?string}
     */
    public function toArray(): array
    {
        return ['id' => $this->id->toRfc4122(), 'ticket' => $this->ticket, 'name' => $this->name];
    }
}
