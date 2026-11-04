<?php

namespace App\Entity;

use App\Jira\JiraAccount;
use App\Jira\JiraFailure;
use App\Repository\JiraConnectionRepository;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Uid\Uuid;

/**
 * Le Jira auquel DayTrack est relié : une installation, un utilisateur, un compte.
 *
 * Le jeton n'y est que chiffré, avec une clé gardée hors de la base (TokenCipher) : ni la
 * base copiée, ni une réponse au navigateur ne le livrent. La base refuse elle-même une
 * seconde connexion.
 */
#[ORM\Entity(repositoryClass: JiraConnectionRepository::class)]
class JiraConnection
{
    /**
     * Le compte d'une connexion reprise de la v1, tant que Jira n'a pas répondu : son
     * fichier ne le disait pas. Rien ne part sur Jira sous ce compte-là (DaySender).
     */
    public const string UNCONFIRMED = '';

    #[ORM\Id]
    #[ORM\Column(type: UuidType::NAME)]
    public private(set) Uuid $id;

    /** Toujours 1 : une seconde ligne heurterait l'index unique. */
    #[ORM\Column(type: Types::SMALLINT, unique: true)]
    private int $single = 1;

    /** L'adresse que l'utilisateur voit et corrige : celle de son site, https://exemple.atlassian.net. */
    #[ORM\Column(length: 255)]
    public private(set) string $site;

    /** Où DayTrack appelle l'API : le site, ou la passerelle d'Atlassian pour un jeton à périmètres. */
    #[ORM\Column(length: 255)]
    public private(set) string $api;

    /**
     * De quel Jira il s'agit : l'identifiant du site, ou à défaut son adresse. Passer au
     * jeton à périmètres change l'adresse de l'API, pas le Jira ; ses types (IssueType)
     * lui appartiennent.
     */
    #[ORM\Column(length: 255)]
    public private(set) string $instance;

    #[ORM\Column(length: 255)]
    public private(set) string $email;

    #[ORM\Column(type: Types::TEXT)]
    public private(set) string $encryptedToken;

    /** Le compte que le jeton représente : c'est à lui qu'appartiennent les heures que DayTrack remplace. */
    #[ORM\Column(length: 128)]
    public private(set) string $accountId;

    #[ORM\Column(length: 255)]
    public private(set) string $accountName;

    /** Ce que Jira reproche au jeton enregistré depuis son dernier refus ; null tant qu'il l'accepte. */
    #[ORM\Column(length: 20, nullable: true, enumType: JiraFailure::class)]
    public private(set) ?JiraFailure $refusal = null;

    /**
     * Les périmètres qui manquent au jeton enregistré, quand c'est ce que Jira lui
     * reproche : le bandeau les nomme. Vide sinon.
     *
     * @var list<string>
     */
    #[ORM\Column(type: Types::JSON, options: ['default' => '[]'])]
    public private(set) array $missingScopes = [];

    public function __construct(string $site, string $api, string $instance, string $email, string $encryptedToken, JiraAccount $account)
    {
        $this->id = Uuid::v7();
        $this->relink($site, $api, $instance, $email, $encryptedToken, $account);
    }

    public function isConfirmed(): bool
    {
        return self::UNCONFIRMED !== $this->accountId;
    }

    /** Une connexion testée qui remplace la précédente en entier : rien ne reste de l'ancienne. */
    public function relink(string $site, string $api, string $instance, string $email, string $encryptedToken, JiraAccount $account): void
    {
        $this->site = $site;
        $this->api = $api;
        $this->instance = $instance;
        $this->email = $email;
        $this->encryptedToken = $encryptedToken;
        $this->accountId = $account->id;
        $this->accountName = $account->name;
        $this->refusal = null;
        $this->missingScopes = [];
    }

    /**
     * Jira a refusé le jeton enregistré, ou un périmètre lui manque.
     *
     * @param list<string> $missingScopes ceux qui lui manquent, quand Jira l'a dit
     */
    public function refuse(JiraFailure $refusal, array $missingScopes = []): void
    {
        if (!$refusal->isTokenRefusal()) {
            throw new \LogicException(\sprintf('« %s » n\'est pas un refus du jeton.', $refusal->value));
        }

        $this->refusal = $refusal;
        $this->missingScopes = JiraFailure::MissingScope === $refusal ? $missingScopes : [];
    }

    /** Jira a de nouveau accepté le jeton enregistré. */
    public function accept(?JiraAccount $account = null): void
    {
        $this->refusal = null;
        $this->missingScopes = [];

        if (null !== $account && !$this->isConfirmed()) {
            $this->accountId = $account->id;
        }

        if (null !== $account && $account->id === $this->accountId) {
            $this->accountName = $account->name;
        }
    }
}
