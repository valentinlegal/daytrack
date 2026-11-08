<?php

namespace App\Dev\Jira;

/**
 * Ce que le Jira simulé connaît : un compte, ses tickets, et les tickets qui
 * échouent exprès.
 *
 * Les tickets ordinaires sont ceux des exemples (SHOP-…, OPS-…), aux titres inventés,
 * et ceux des parcours de l'écran (ESSAI-…). Ceux qui échouent se reconnaissent à leur
 * projet, et existent pour n'importe quel numéro : FERME-1, FERME-2… On les joue par
 * l'écran, en tapant leur identifiant comme celui d'un vrai ticket.
 */
final class Catalog
{
    /** Le compte de développement, et son jeton sans périmètre. Aucun des deux ne vaut quoi que ce soit ailleurs. */
    public const string ACCOUNT_EMAIL = 'dev@daytrack.test';
    public const string API_TOKEN = 'jeton-de-developpement';
    public const string ACCOUNT_ID = '712020:simule-dev';
    public const string ACCOUNT_NAME = 'Compte de développement';

    /**
     * Les jetons à périmètres du même compte, qui ne passent que par la passerelle
     * d'Atlassian : celui que l'aide de DayTrack fait créer, un qui ne peut pas
     * écrire, un qui ne peut pas lire les tickets, et celui qu'a fait créer le README
     * de la v1, sans read:jira-user.
     */
    public const string SCOPED_TOKEN = 'jeton-a-perimetres';
    public const string READ_ONLY_TOKEN = 'jeton-sans-ecriture';
    public const string WRITE_ONLY_TOKEN = 'jeton-sans-lecture';
    public const string V1_SCOPED_TOKEN = 'jeton-de-la-v1';

    /** L'identifiant du site, que la passerelle demande dans son adresse et que /_edge/tenant_info donne. */
    public const string CLOUD_ID = '5d1e0c3a-7b42-4f8e-9c61-2a8f4b0d7e19';

    public const string READ_WORK = 'read:jira-work';
    public const string WRITE_WORK = 'write:jira-work';
    public const string READ_USER = 'read:jira-user';

    /**
     * Les périmètres de chaque jeton accepté ; null pour un jeton sans périmètre, qui
     * ne passe que par l'adresse du site.
     *
     * @var array<string, list<string>|null>
     */
    private const array TOKENS = [
        self::API_TOKEN => null,
        self::SCOPED_TOKEN => [self::READ_WORK, self::WRITE_WORK, self::READ_USER],
        self::READ_ONLY_TOKEN => [self::READ_WORK, self::READ_USER],
        self::WRITE_ONLY_TOKEN => [self::WRITE_WORK, self::READ_USER],
        self::V1_SCOPED_TOKEN => [self::READ_WORK, self::WRITE_WORK],
    ];

    /**
     * Un autre utilisateur, dont les heures ne doivent jamais être touchées. Il se
     * relie aussi, avec les mêmes jetons : c'est le compte vers lequel on change.
     */
    public const string COLLEAGUE_ID = '712020:simule-collegue';
    public const string COLLEAGUE_NAME = 'Collègue simulé';
    public const string COLLEAGUE_EMAIL = 'collegue@daytrack.test';

    /**
     * Les comptes qui se relient, par courriel.
     *
     * @var array<string, array{id: string, name: string}>
     */
    private const array ACCOUNTS = [
        self::ACCOUNT_EMAIL => ['id' => self::ACCOUNT_ID, 'name' => self::ACCOUNT_NAME],
        self::COLLEAGUE_EMAIL => ['id' => self::COLLEAGUE_ID, 'name' => self::COLLEAGUE_NAME],
    ];

    /** Le fuseau du compte : celui où se lisent les jours. */
    public const string TIME_ZONE = 'Europe/Paris';

    /** Le ticket où ce collègue déclare chaque jour une demi-heure, avant tout le monde. */
    public const string COLLEAGUE_ISSUE = 'OPS-12';

    /** Ticket fermé : Jira refuse d'y ajouter des heures. */
    public const string CLOSED = 'FERME';
    /**
     * Ticket terminé dont Jira accepte encore les heures, comme le flux par défaut de
     * Jira Cloud : DayTrack n'y voit rien à refuser, il n'y a que Jira qui refuse.
     */
    public const string DONE = 'TERMINE';
    private const string DONE_SUMMARY = 'Simulation : ticket terminé, Jira accepte encore les heures';
    /** Ticket ouvert dont Jira refuse les heures à ce compte : un droit qui manque. */
    public const string FORBIDDEN = 'INTERDIT';
    /** Jira tombe en panne sur les heures de ce ticket. */
    public const string BROKEN = 'PANNE';
    /** Jira met vingt secondes à répondre, puis enregistre quand même. */
    public const string SLOW = 'LENT';
    /** Jira n'accepte qu'une écriture d'heures sur deux : l'envoi est à moitié fait. */
    public const string HALF = 'MOITIE';
    /** Jira accepte les heures, puis ne les montre pas à la relecture. */
    public const string LOST = 'ECART';
    /** Jira accepte les heures, puis tombe en panne à la relecture ; la lecture suivante répond. */
    public const string MUTE = 'MUET';
    /** Jira enregistre les heures sans répondre, puis tombe en panne à la relecture ; la lecture suivante répond. */
    public const string DEAF = 'SOURD';
    /** Jira accepte les heures, puis refuse tout jeton, jusqu'à ce qu'on lève ce refus. */
    public const string TOKEN_LOST = 'JETON';
    /** Jira limite le débit : une écriture d'heures sur deux reçoit 429, à refaire après Retry-After. */
    public const string QUOTA = 'QUOTA';
    /**
     * Jira accepte les heures et les relit, puis ne trouve plus le ticket, ni ses heures :
     * le compte a perdu le droit de voir son projet. Elles y restent pourtant, comme dans
     * un vrai Jira, qui répond de même à un ticket supprimé.
     */
    public const string VANISHING = 'DISPARU';

    public const int SLOW_SECONDS = 20;
    /** Le reste à faire de chaque ticket avant qu'on y saisisse : 4h00. */
    public const int INITIAL_ESTIMATE_SECONDS = 14400;
    public const int RETRY_AFTER_SECONDS = 1;

    /** @var array<string, array{type: string, summary: string, parent?: string}> */
    private const array ISSUES = [
        'OPS-12' => ['type' => 'Tâche', 'summary' => "Cérémonies d'équipe"],
        'OPS-7' => ['type' => 'Tâche', 'summary' => 'Support applicatif niveau 2'],
        'OPS-21' => ['type' => 'Tâche', 'summary' => 'Revue des alertes de production'],
        'SHOP-377' => ['type' => 'Epic', 'summary' => 'Refonte du tunnel de commande'],
        'SHOP-482' => ['type' => 'Story', 'summary' => 'Export CSV des commandes filtrées par période et par statut'],
        'SHOP-498' => ['type' => 'Story', 'summary' => 'Filtre par marque dans la recherche produits'],
        'SHOP-501' => ['type' => 'Story', 'summary' => 'Relance automatique des paniers abandonnés'],
        'SHOP-512' => ['type' => 'Tâche', 'summary' => 'Mise à jour des dépendances du front'],
        'SHOP-519' => ['type' => 'Bug', 'summary' => 'Le total du panier ignore la remise quand le code est saisi en minuscules'],
        'SHOP-530' => ['type' => 'Bug', 'summary' => 'Le bouton Payer reste désactivé après une erreur de validation'],
        'SHOP-531' => ['type' => 'Sous-tâche', 'summary' => 'Reproduire le blocage du bouton Payer', 'parent' => 'SHOP-530'],
    ];

    /**
     * Les tickets des parcours de l'écran (tests/e2e) : ceux du projet ESSAI, pour
     * n'importe quel numéro, et quelques autres. Ils s'enregistrent aussi quand
     * l'application de développement est reliée au Jira simulé.
     */
    public const string TRIAL = 'ESSAI';

    /** @var list<string> */
    private const array TRIAL_ISSUES = ['OPS-1', 'OPS-2', 'OPS-3', 'OPS-5', 'OPS-13', 'OPS-99', 'PROJ-7', 'SHOP-1', 'SHOP-2'];

    /** @var array<string, string> */
    private const array FAILING_PROJECTS = [
        self::CLOSED => 'Simulation : ticket fermé, Jira refuse les heures',
        self::FORBIDDEN => 'Simulation : ticket ouvert, Jira refuse les heures à ce compte',
        self::BROKEN => 'Simulation : Jira tombe en panne sur ce ticket',
        self::SLOW => 'Simulation : Jira met vingt secondes à répondre',
        self::HALF => "Simulation : Jira n'accepte qu'une écriture sur deux",
        self::LOST => 'Simulation : Jira accepte puis perd les heures',
        self::MUTE => 'Simulation : Jira accepte puis ne répond plus à la relecture',
        self::DEAF => 'Simulation : Jira enregistre sans répondre, puis ne répond plus à la relecture',
        self::TOKEN_LOST => 'Simulation : Jira accepte puis refuse le jeton à la relecture',
        self::QUOTA => 'Simulation : Jira limite le débit, il faut réessayer',
        self::VANISHING => 'Simulation : Jira accepte et relit les heures, puis ne trouve plus ce ticket',
    ];

    /**
     * Les types d'un Jira tout juste créé, en français : leur identifiant, leur nom
     * et leur niveau (1 parent, 0 standard, −1 sous-tâche).
     *
     * @var array<string, array{id: string, level: int}>
     */
    private const array TYPES = [
        'Epic' => ['id' => '10000', 'level' => 1],
        'Story' => ['id' => '10001', 'level' => 0],
        'Tâche' => ['id' => '10002', 'level' => 0],
        'Sous-tâche' => ['id' => '10003', 'level' => -1],
        'Bug' => ['id' => '10004', 'level' => 0],
    ];

    /**
     * Le jeton d'un en-tête « Authorization » du compte de développement, s'il en est
     * un que le Jira simulé connaît.
     *
     * @return array{token: string, scopes: list<string>|null, account: array{id: string, name: string, email: string}}|null
     */
    public static function token(?string $authorization): ?array
    {
        if (null === $authorization || 1 !== preg_match('/^Basic\s+(\S+)$/i', $authorization, $matches)) {
            return null;
        }

        $credentials = base64_decode($matches[1], true);
        if (false === $credentials || !str_contains($credentials, ':')) {
            return null;
        }

        [$email, $token] = explode(':', $credentials, 2);
        if (!isset(self::ACCOUNTS[$email]) || !\array_key_exists($token, self::TOKENS)) {
            return null;
        }

        return ['token' => $token, 'scopes' => self::TOKENS[$token], 'account' => self::ACCOUNTS[$email] + ['email' => $email]];
    }

    /**
     * @return array{type: string, summary: string, parent?: string}|null
     */
    public static function issue(string $key): ?array
    {
        if (isset(self::ISSUES[$key])) {
            return self::ISSUES[$key];
        }

        if (\in_array($key, self::TRIAL_ISSUES, true) || 1 === preg_match('/^'.self::TRIAL.'-[1-9]\d*$/', $key)) {
            return ['type' => 'Tâche', 'summary' => 'Ticket des parcours de l\'écran'];
        }

        if (self::isDoneProject($key)) {
            return ['type' => 'Tâche', 'summary' => self::DONE_SUMMARY];
        }

        $project = self::failingProject($key);

        return null === $project ? null : ['type' => 'Tâche', 'summary' => self::FAILING_PROJECTS[$project]];
    }

    /** Le ticket est-il à l'état terminé : fermé, ou terminé et ouvert aux heures. */
    public static function isDone(string $key): bool
    {
        return self::CLOSED === self::failingProject($key) || self::isDoneProject($key);
    }

    private static function isDoneProject(string $key): bool
    {
        return 1 === preg_match('/^'.self::DONE.'-[1-9]\d*$/', $key);
    }

    /**
     * Ce que le Jira simulé connaît, pour qui le joue à la main : ses tickets et leur
     * titre, puis les projets où tout numéro existe — ESSAI-1, TERMINE-3, FERME-12… — et ce qu'ils
     * font. Tout autre identifiant est introuvable.
     *
     * @return array{tickets: array<string, string>, projets: array<string, string>}
     */
    public static function catalog(): array
    {
        $tickets = array_map(static fn (array $issue): string => $issue['summary'], self::ISSUES);
        foreach (self::TRIAL_ISSUES as $key) {
            $tickets[$key] = 'Ticket des parcours de l\'écran';
        }

        return ['tickets' => $tickets, 'projets' => [self::TRIAL => 'Tickets des parcours de l\'écran', self::DONE => self::DONE_SUMMARY] + self::FAILING_PROJECTS];
    }

    /** L'identifiant numérique d'un ticket, celui que Jira met dans « id » et « issueId ». */
    public static function issueId(string $key): string
    {
        return (string) (10000 + crc32($key) % 90000);
    }

    /** Le projet qui échoue exprès auquel appartient ce ticket, s'il y en a un. */
    public static function failingProject(string $key): ?string
    {
        if (1 !== preg_match('/^([A-Z]+)-[1-9]\d*$/', $key, $matches)) {
            return null;
        }

        return isset(self::FAILING_PROJECTS[$matches[1]]) ? $matches[1] : null;
    }

    /**
     * @return array{id: string, name: string, subtask: bool, hierarchyLevel: int}
     */
    public static function issueType(string $name): array
    {
        $type = self::TYPES[$name] ?? self::TYPES['Tâche'];

        return ['id' => $type['id'], 'name' => $name, 'subtask' => -1 === $type['level'], 'hierarchyLevel' => $type['level']];
    }
}
