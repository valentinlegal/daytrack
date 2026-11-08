<?php

namespace App\Entity;

use App\Jira\JiraIssueType;
use App\Repository\IssueTypeRepository;
use App\Settings\Tint;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Uid\Uuid;

/**
 * Un type de ticket rencontré dans Jira, retenu par son identifiant : un type
 * renommé dans Jira garde sa teinte, et son nouveau nom s'affiche.
 *
 * Chaque instance Jira a les siens, et ses identifiants recommencent à 10000 : un
 * type appartient à son Jira, et celui d'un autre Jira n'est jamais le même, même
 * identifiant à l'appui. La base refuse deux types pour le même identifiant d'un Jira.
 */
#[ORM\Entity(repositoryClass: IssueTypeRepository::class)]
#[ORM\UniqueConstraint(name: 'issue_type_instance', columns: ['instance', 'jira_id'])]
class IssueType
{
    /** La longueur d'un nom de type gardé : Jira n'en donne pas de plus long. */
    public const int NAME_MAX = 255;

    #[ORM\Id]
    #[ORM\Column(type: UuidType::NAME)]
    public private(set) Uuid $id;

    /** Le Jira qui l'a décrit (JiraConnection::$instance). */
    #[ORM\Column(length: 255)]
    public private(set) string $instance;

    #[ORM\Column(length: 50)]
    public private(set) string $jiraId;

    #[ORM\Column(length: self::NAME_MAX)]
    public private(set) string $name;

    /** Son niveau dans la hiérarchie de Jira : 1 parent, 0 standard, −1 sous-tâche. */
    #[ORM\Column(type: Types::SMALLINT)]
    public private(set) int $level;

    #[ORM\Column(length: 10, enumType: Tint::class)]
    public Tint $color;

    public function __construct(string $instance, JiraIssueType $type, Tint $color)
    {
        $this->id = Uuid::v7();
        $this->instance = $instance;
        $this->jiraId = $type->id;
        $this->color = $color;
        $this->describe($type);
    }

    public function describe(JiraIssueType $type): void
    {
        $this->name = mb_substr($type->name, 0, self::NAME_MAX);
        $this->level = $type->level;
    }

    /**
     * @return array{id: string, name: string, color: string}
     */
    public function toArray(): array
    {
        return ['id' => $this->id->toRfc4122(), 'name' => $this->name, 'color' => $this->color->value];
    }
}
