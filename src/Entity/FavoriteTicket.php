<?php

declare(strict_types=1);

namespace App\Entity;

use App\Repository\FavoriteTicketRepository;
use DateTimeImmutable;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\IdGenerator\UuidGenerator;
use Symfony\Component\Uid\Uuid;

/**
 * Représente un ticket Jira marqué comme favori par l'utilisateur.
 */
#[ORM\Entity(repositoryClass: FavoriteTicketRepository::class)]
#[ORM\Table(name: 'favorite_ticket')]
class FavoriteTicket
{
    #[ORM\Id]
    #[ORM\Column(type: 'uuid', unique: true)]
    #[ORM\GeneratedValue(strategy: 'CUSTOM')]
    #[ORM\CustomIdGenerator(class: UuidGenerator::class)]
    public private(set) ?Uuid $id = null;

    // Clé du ticket Jira (ex : PROJ-123) — unique, normalisée en majuscules à l'écriture
    #[ORM\Column(length: 50, unique: true)]
    public string $ticketKey {
        set(string $value) => $this->ticketKey = strtoupper(trim($value));
    }

    // Titre du ticket tel que retourné par Jira à la création — figé, jamais modifié par l'utilisateur
    #[ORM\Column(length: 255, nullable: true)]
    public ?string $ticketSummary = null;

    // Étiquette personnalisée — remplace ticketSummary dans l'affichage des favoris si définie
    #[ORM\Column(length: 255, nullable: true)]
    public ?string $customName = null;

    // Type du ticket Jira (ex : Story, Bug, Epic) — utilisé pour la couleur de la pill
    #[ORM\Column(length: 50, nullable: true)]
    public ?string $ticketType = null;

    // Ordre d'affichage — modifiable par drag & drop
    #[ORM\Column]
    public int $position = 0;

    #[ORM\Column]
    public private(set) DateTimeImmutable $createdAt;

    public function __construct()
    {
        $this->createdAt = new DateTimeImmutable();
    }
}
